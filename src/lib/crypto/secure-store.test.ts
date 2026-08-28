// ===== secure-store 单元测试（P0-02-E） =====

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("encryptSecret / decryptSecret", () => {
  it("hex 密钥下加解密往返一致，密文含随机 iv（同明文不同密文）", async () => {
    vi.stubEnv("GSC_TOKEN_ENCRYPTION_KEY", "a".repeat(64));
    const { encryptSecret, decryptSecret } = await import("./secure-store");
    const cipher1 = encryptSecret('{"refreshToken":"secret-token"}');
    const cipher2 = encryptSecret('{"refreshToken":"secret-token"}');
    expect(decryptSecret(cipher1)).toBe('{"refreshToken":"secret-token"}');
    expect(decryptSecret(cipher2)).toBe('{"refreshToken":"secret-token"}');
    expect(cipher1).not.toBe(cipher2); // 随机 iv
  });

  it("base64 密钥可用", async () => {
    vi.stubEnv("GSC_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const { encryptSecret, decryptSecret } = await import("./secure-store");
    const cipher = encryptSecret("payload");
    expect(decryptSecret(cipher)).toBe("payload");
  });

  it("密钥不匹配时解密失败且不泄露内容", async () => {
    vi.stubEnv("GSC_TOKEN_ENCRYPTION_KEY", "b".repeat(64));
    const { encryptSecret } = await import("./secure-store");
    const cipher = encryptSecret("top secret");
    vi.stubEnv("GSC_TOKEN_ENCRYPTION_KEY", "c".repeat(64));
    const { decryptSecret, SecureStoreDecryptError } = await import("./secure-store");
    expect(() => decryptSecret(cipher)).toThrow(SecureStoreDecryptError);
  });

  it("未配置密钥时抛 SecureStoreNotConfiguredError（绝不明文落库）", async () => {
    vi.stubEnv("GSC_TOKEN_ENCRYPTION_KEY", "");
    const { encryptSecret, SecureStoreNotConfiguredError } = await import("./secure-store");
    expect(() => encryptSecret("x")).toThrow(SecureStoreNotConfiguredError);
  });
});
