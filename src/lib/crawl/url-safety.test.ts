import { describe, it, expect } from "vitest";
import { validateUrlSafety, CrawlError } from "@/lib/crawl";

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
