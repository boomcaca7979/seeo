// ===== IndexNow 协议层测试 =====
// 覆盖：响应码分类、结论映射、Key 发现、URL 白名单、payload、重试预算、202 不重发。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildPayload,
  classifyHttpStatus,
  classifyNetworkError,
  conclusionFor,
  findKeyFile,
  partitionSubmittable,
  submitIndexNow,
  verifyKeyFile,
  KEY_FILE_PATTERN,
} from "./indexnow";

const noSleep = async (): Promise<void> => undefined;

function response(status: number, body = ""): Response {
  return new Response(body, { status });
}

/** 按序列返回响应的 fetch 替身，并记录调用次数 */
function sequenceFetch(steps: Array<number | Error>): { impl: typeof fetch; calls: () => number } {
  let i = 0;
  const impl = (async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step instanceof Error) throw step;
    return response(step, step === 200 ? "OK" : "");
  }) as unknown as typeof fetch;
  return { impl, calls: () => i };
}

describe("classifyHttpStatus", () => {
  it("200 → received，不可重试", () => {
    const c = classifyHttpStatus(200);
    expect(c.outcome).toBe("received");
    expect(c.retryable).toBe(false);
    expect(c.reason).toContain("not crawled");
  });

  it("202 → accepted_pending_key，不可重试（禁止重发整批）", () => {
    const c = classifyHttpStatus(202);
    expect(c.outcome).toBe("accepted_pending_key");
    expect(c.retryable).toBe(false);
    expect(c.reason).toContain("key validation pending");
  });

  it.each([400, 403, 422])("%i → rejected，不可重试", (status) => {
    const c = classifyHttpStatus(status);
    expect(c.outcome).toBe("rejected");
    expect(c.retryable).toBe(false);
  });

  it.each([429, 500, 503])("%i → retryable", (status) => {
    const c = classifyHttpStatus(status);
    expect(c.outcome).toBe("retryable");
    expect(c.retryable).toBe(true);
  });

  it("200 与 202 的 conclusion 必须不同", () => {
    expect(conclusionFor("received")).toBe("success");
    expect(conclusionFor("accepted_pending_key")).toBe("neutral");
    expect(conclusionFor("rejected")).toBe("failure");
    expect(conclusionFor("retryable")).toBe("action_required");
  });

  it("网络异常归类为 retryable", () => {
    const c = classifyNetworkError(new Error("ECONNRESET"));
    expect(c.retryable).toBe(true);
    expect(c.reason).toContain("ECONNRESET");
  });
});

describe("Key 文件发现", () => {
  function makeDir(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-indexnow-"));
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  const key = "101113d675942a33d43e6a984d64ce63";

  it("文件名与内容一致时命中", () => {
    const dir = makeDir({ [`${key}.txt`]: key });
    expect(findKeyFile(dir)).toEqual({ key, file: `${key}.txt` });
  });

  it("ads.txt 不会被误认为 Key", () => {
    const dir = makeDir({ [`${key}.txt`]: key, "ads.txt": "google.com, pub-1, DIRECT" });
    expect(findKeyFile(dir).key).toBe(key);
  });

  it("内容与文件名不一致 → 抛错", () => {
    const dir = makeDir({ [`${key}.txt`]: "deadbeef" });
    expect(() => findKeyFile(dir)).toThrow(/没有合法的 IndexNow Key/);
  });

  it("多个合法 Key → 抛错（不允许歧义）", () => {
    const other = "ffffffffffffffffffffffffffffffff";
    const dir = makeDir({ [`${key}.txt`]: key, [`${other}.txt`]: other });
    expect(() => findKeyFile(dir)).toThrow(/多个合法 Key/);
  });

  it("KEY_FILE_PATTERN 边界：7 位太短、129 位太长", () => {
    expect(KEY_FILE_PATTERN.test("a".repeat(7) + ".txt")).toBe(false);
    expect(KEY_FILE_PATTERN.test("a".repeat(8) + ".txt")).toBe(true);
    expect(KEY_FILE_PATTERN.test("a".repeat(128) + ".txt")).toBe(true);
    expect(KEY_FILE_PATTERN.test("a".repeat(129) + ".txt")).toBe(false);
    expect(KEY_FILE_PATTERN.test("ABC.txt")).toBe(false); // 大写不允许
  });
});

describe("URL 白名单", () => {
  it("只接受本站两种 canonical 形态", () => {
    const { accepted, rejected } = partitionSubmittable([
      "https://www.seeo.asia",
      "https://www.seeo.asia/pricing",
      "https://www.seeo.asia/zh/pricing",
      "https://www.seeo.asia/", // 尾部斜杠：非 sitemap canonical 形态，拒绝而非改写
      "https://seeo.asia/pricing", // apex
      "http://www.seeo.asia/pricing", // 非 https
      "https://www.seeo.asia/pricing/", // 尾斜杠
      "https://www.seeo.asia/en/pricing", // /en 前缀
      "https://www.seeo.asia/login", // noindex
      "https://www.seeo.asia/app/dashboard", // 私有
      "https://www.seeo.asia/tools/backlink-checker", // 已停用
      "https://example.com/pricing",
    ]);
    expect(accepted).toEqual([
      "https://www.seeo.asia",
      "https://www.seeo.asia/pricing",
      "https://www.seeo.asia/zh/pricing",
    ]);
    expect(rejected).toHaveLength(9);
  });

  it("重复 URL 只保留一条", () => {
    const { accepted } = partitionSubmittable(["https://www.seeo.asia/a", "https://www.seeo.asia/a"]);
    expect(accepted).toHaveLength(1);
  });
});

describe("payload", () => {
  it("根目录 Key 文件 → 省略 keyLocation", () => {
    const p = buildPayload("k".repeat(32), ["https://www.seeo.asia/"], "www.seeo.asia");
    expect(p).toEqual({ host: "www.seeo.asia", key: "k".repeat(32), urlList: ["https://www.seeo.asia/"] });
    expect("keyLocation" in p).toBe(false);
  });

  it("空 urlList 或超上限 → 拒绝", () => {
    expect(() => buildPayload("k", [])).toThrow(/urlList 为空/);
    expect(() => buildPayload("k", Array.from({ length: 10_001 }, (_, i) => `https://www.seeo.asia/${i}`))).toThrow(/超过单次上限/);
  });
});

describe("submitIndexNow", () => {
  const urls = ["https://www.seeo.asia/pricing"];

  it("200 → received，仅 1 次 POST", async () => {
    const f = sequenceFetch([200]);
    const r = await submitIndexNow({ key: "k".repeat(32), urls, fetchImpl: f.impl, sleep: noSleep });
    expect(r.outcome).toBe("received");
    expect(r.attempts).toBe(1);
    expect(f.calls()).toBe(1);
  });

  it("500 后 200 → 2 次 POST，最终 received", async () => {
    const f = sequenceFetch([500, 200]);
    const r = await submitIndexNow({ key: "k".repeat(32), urls, fetchImpl: f.impl, sleep: noSleep });
    expect(r.outcome).toBe("received");
    expect(r.attempts).toBe(2);
    expect(f.calls()).toBe(2);
  });

  it("持续 429 → 达上限后返回 retryable", async () => {
    const f = sequenceFetch([429, 429, 429, 429]);
    const r = await submitIndexNow({ key: "k".repeat(32), urls, fetchImpl: f.impl, sleep: noSleep, maxAttempts: 3 });
    expect(r.outcome).toBe("retryable");
    expect(r.attempts).toBe(3);
    expect(f.calls()).toBe(3);
  });

  it("202 → 只发 1 次，绝不重发整批", async () => {
    const f = sequenceFetch([202, 202]);
    const r = await submitIndexNow({ key: "k".repeat(32), urls, fetchImpl: f.impl, sleep: noSleep });
    expect(r.outcome).toBe("accepted_pending_key");
    expect(r.attempts).toBe(1);
    expect(f.calls()).toBe(1);
  });

  it("400/403/422 → 不重试", async () => {
    for (const status of [400, 403, 422]) {
      const f = sequenceFetch([status, 200]);
      const r = await submitIndexNow({ key: "k".repeat(32), urls, fetchImpl: f.impl, sleep: noSleep });
      expect(r.outcome).toBe("rejected");
      expect(f.calls()).toBe(1);
    }
  });

  it("网络异常 → retryable，且不超过预算", async () => {
    const f = sequenceFetch([new Error("ETIMEDOUT"), new Error("ETIMEDOUT"), new Error("ETIMEDOUT")]);
    const r = await submitIndexNow({ key: "k".repeat(32), urls, fetchImpl: f.impl, sleep: noSleep, maxAttempts: 2 });
    expect(r.outcome).toBe("retryable");
    expect(r.attempts).toBe(2);
  });

  it("全部 URL 被白名单拒绝 → 抛错，不发请求", async () => {
    const f = sequenceFetch([200]);
    await expect(
      submitIndexNow({ key: "k".repeat(32), urls: ["https://evil.example/x"], fetchImpl: f.impl, sleep: noSleep }),
    ).rejects.toThrow(/没有任何可提交的 URL/);
    expect(f.calls()).toBe(0);
  });

  it("发送的 body 是合法 JSON 且含 host/key/urlList", async () => {
    let captured = "";
    const impl = (async (_url: string, init: RequestInit) => {
      captured = String(init.body);
      return response(200);
    }) as unknown as typeof fetch;
    await submitIndexNow({ key: "k".repeat(32), urls, fetchImpl: impl, sleep: noSleep });
    const body = JSON.parse(captured);
    expect(body.host).toBe("www.seeo.asia");
    expect(body.urlList).toEqual(urls);
  });
});

describe("verifyKeyFile", () => {
  it("内容一致 → ok", async () => {
    const key = "101113d675942a33d43e6a984d64ce63";
    const impl = (async () => response(200, key)) as unknown as typeof fetch;
    await expect(verifyKeyFile(key, impl)).resolves.toMatchObject({ ok: true, status: 200 });
  });

  it("内容不一致 / 404 → 不 ok", async () => {
    const key = "101113d675942a33d43e6a984d64ce63";
    const mismatch = (async () => response(200, "other")) as unknown as typeof fetch;
    expect((await verifyKeyFile(key, mismatch)).reason).toContain("mismatch");

    const missing = (async () => response(404)) as unknown as typeof fetch;
    expect((await verifyKeyFile(key, missing)).ok).toBe(false);
  });
});
