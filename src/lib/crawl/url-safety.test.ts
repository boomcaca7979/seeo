import { describe, it, expect } from "vitest";
import { validateUrlSafety, assertSupportedUserScheme, normalizeUrl, CrawlError } from "@/lib/crawl";

/** 取 CrawlError 的 code/reason，非 CrawlError 直接失败 */
function catchCrawlError(fn: () => unknown): CrawlError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CrawlError);
    return e as CrawlError;
  }
  throw new Error("expected CrawlError");
}

describe("validateUrlSafety SSRF 防护", () => {
  it("合法 https URL 通过", () => {
    const url = validateUrlSafety("https://example.com/page");
    expect(url.hostname).toBe("example.com");
  });

  it("合法 http URL 通过", () => {
    const url = validateUrlSafety("http://example.com");
    expect(url.protocol).toBe("http:");
  });

  it("localhost 被拒绝", () => {
    expect(() => validateUrlSafety("http://localhost:3000")).toThrow(CrawlError);
    expect(() => validateUrlSafety("http://localhost")).toThrow(CrawlError);
  });

  it("127.0.0.1 被拒绝", () => {
    expect(() => validateUrlSafety("http://127.0.0.1")).toThrow(CrawlError);
    expect(() => validateUrlSafety("http://127.0.0.1:8080")).toThrow(CrawlError);
  });

  it("10.x 私网被拒绝", () => {
    expect(() => validateUrlSafety("http://10.0.0.1")).toThrow(CrawlError);
    expect(() => validateUrlSafety("http://10.255.255.255")).toThrow(CrawlError);
  });

  it("192.168.x 私网被拒绝", () => {
    expect(() => validateUrlSafety("http://192.168.1.1")).toThrow(CrawlError);
    expect(() => validateUrlSafety("http://192.168.0.0")).toThrow(CrawlError);
  });

  it("172.16-31.x 私网被拒绝", () => {
    expect(() => validateUrlSafety("http://172.16.0.1")).toThrow(CrawlError);
    expect(() => validateUrlSafety("http://172.31.255.255")).toThrow(CrawlError);
  });

  it("172.15.x 非私网通过", () => {
    expect(() => validateUrlSafety("http://172.15.0.1")).not.toThrow();
  });

  it("172.32.x 非私网通过", () => {
    expect(() => validateUrlSafety("http://172.32.0.1")).not.toThrow();
  });

  it("169.254.x 链路本地被拒绝", () => {
    expect(() => validateUrlSafety("http://169.254.1.1")).toThrow(CrawlError);
  });

  it("0.0.0.0 被拒绝", () => {
    expect(() => validateUrlSafety("http://0.0.0.0")).toThrow(CrawlError);
  });

  it("224+ 组播/保留地址被拒绝", () => {
    expect(() => validateUrlSafety("http://224.0.0.1")).toThrow(CrawlError);
    expect(() => validateUrlSafety("http://240.0.0.1")).toThrow(CrawlError);
  });

  it(".local 域名被拒绝", () => {
    expect(() => validateUrlSafety("http://myapp.local")).toThrow(CrawlError);
  });

  it(".internal 域名被拒绝", () => {
    expect(() => validateUrlSafety("http://myapp.internal")).toThrow(CrawlError);
  });

  it(".localhost 域名被拒绝", () => {
    expect(() => validateUrlSafety("http://myapp.localhost")).toThrow(CrawlError);
  });

  it("非 http/https 协议被拒绝", () => {
    expect(() => validateUrlSafety("file:///etc/passwd")).toThrow(CrawlError);
    expect(() => validateUrlSafety("ftp://example.com")).toThrow(CrawlError);
    expect(() => validateUrlSafety("javascript:alert(1)")).toThrow(CrawlError);
  });

  it("无效 URL 格式被拒绝", () => {
    expect(() => validateUrlSafety("not-a-url")).toThrow(CrawlError);
    expect(() => validateUrlSafety("")).toThrow(CrawlError);
  });
});

describe("BUG-44b assertSupportedUserScheme：协议必须在补全 https:// 之前判断", () => {
  it.each(["example.com", "https://example.com", "HTTP://example.com/x", "  https://example.com  "])(
    "放行 %s",
    (input) => {
      expect(() => assertSupportedUserScheme(input)).not.toThrow();
    }
  );

  it.each(["ftp://example.com/page", "ws://example.com", "file:///etc/passwd"])(
    "拒绝 %s，并带 scheme reason",
    (input) => {
      const e = catchCrawlError(() => assertSupportedUserScheme(input));
      expect(e.code).toBe("INVALID_URL");
      expect(e.reason).toBe("scheme");
    }
  );

  it("根因复现：normalizeUrl 会把 ftp:// 伪装成可解析的 https URL", () => {
    // 这条不是「期望的行为」，而是缺陷存在的证据：少了预检，SSRF 白名单就会放行怪 URL，
    // 用户最终看到「无法连接该站点」而不是「协议写错」。
    const mangled = normalizeUrl("ftp://example.com/page");
    expect(mangled).toBe("https://ftp://example.com/page");
    expect(() => validateUrlSafety(mangled)).not.toThrow();
  });

  it("无 // 的伪协议交给格式校验，不在这里报协议错", () => {
    expect(() => assertSupportedUserScheme("javascript:alert(1)")).not.toThrow();
    const e = catchCrawlError(() => validateUrlSafety(normalizeUrl("javascript:alert(1)")));
    expect(e.reason).toBe("malformed");
  });
});
