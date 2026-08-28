// ===== 静态加密（P0-02-E GSC OAuth 凭证存储） =====
// AES-256-GCM。密钥来自环境变量 GSC_TOKEN_ENCRYPTION_KEY：
//   - 64 位 hex / 44 位 base64（32 字节）直接使用
//   - 其他非空字符串经 scrypt 派生（开发友好；生产建议使用随机 32 字节密钥）
// 未配置密钥时 encrypt/decrypt 抛出 SecureStoreNotConfiguredError——
// 调用方必须将其映射为 GSC_NOT_CONFIGURED，绝不允许明文落库。

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export class SecureStoreNotConfiguredError extends Error {
  constructor() {
    super("未配置 GSC_TOKEN_ENCRYPTION_KEY，无法安全存取 OAuth 凭证");
    this.name = "SecureStoreNotConfiguredError";
  }
}

export class SecureStoreDecryptError extends Error {
  constructor() {
    super("GSC 凭证解密失败（密钥不匹配或数据损坏）");
    this.name = "SecureStoreDecryptError";
  }
}

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.GSC_TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new SecureStoreNotConfiguredError();
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return Buffer.from(secret, "hex");
  try {
    const b64 = Buffer.from(secret, "base64");
    if (b64.length === 32) return b64;
  } catch {
    // 非 base64，走派生
  }
  return scryptSync(secret, "seeo:gsc:credentials:v1", 32);
}

/** 密文格式：v1.<iv-base64>.<authTag-base64>.<ciphertext-base64> */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new Error("encryptSecret: 明文不能为空");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new SecureStoreDecryptError();
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new SecureStoreDecryptError();
  }
}
