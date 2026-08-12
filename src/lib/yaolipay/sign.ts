// ===== 耀立支付 V2 签名工具（SHA256WithRSA） =====
// 严格遵循官方签名规则：
//   1. 收集所有非空参数（排除 sign / sign_type，排除文件、字节流）
//   2. 按 key 的 ASCII 升序排序
//   3. 用 & 拼接为 "k1=v1&k2=v2&..."
//   4. 使用商户私钥 SHA256WithRSA 签名
//
// 验签：
//   1. 同上 1~3 生成待签名字符串
//   2. 使用平台公钥 SHA256WithRSA 验签

import crypto from "node:crypto";

/**
 * 构造待签名字符串
 * 1. 过滤 sign / sign_type / 空值 / 数组/字节流
 * 2. 按 key ASCII 升序排序
 * 3. 用 & 拼接 "k=v"
 */
export function buildSignString(params: Record<string, unknown>): string {
  const filtered: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(params)) {
    // 排除 sign / sign_type
    if (key === "sign" || key === "sign_type") continue;
    // 排除空值
    if (value === null || value === undefined) continue;
    if (value === "") continue;
    // 排除数组、对象、Buffer
    if (Array.isArray(value)) continue;
    if (typeof value === "object") continue;
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) continue;
    // 转字符串
    filtered.push([key, String(value)]);
  }

  // 按 key ASCII 升序排序
  filtered.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  // 用 & 拼接
  return filtered.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * 规范化 PEM 格式私钥
 * 用户在 .env 中可能填写为单行，或带不带 PEM 头
 */
function normalizePrivateKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed;
  // 单行 base64，重新包装为 PEM
  const header = "-----BEGIN PRIVATE KEY-----";
  const footer = "-----END PRIVATE KEY-----";
  const body = trimmed.replace(/\s+/g, "");
  // 每 64 字符一行
  const lines = body.match(/.{1,64}/g) ?? [body];
  return `${header}\n${lines.join("\n")}\n${footer}`;
}

/**
 * 规范化 PEM 格式公钥
 */
function normalizePublicKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed;
  const header = "-----BEGIN PUBLIC KEY-----";
  const footer = "-----END PUBLIC KEY-----";
  const body = trimmed.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [body];
  return `${header}\n${lines.join("\n")}\n${footer}`;
}

/**
 * 使用商户私钥对待签名字符串计算 SHA256WithRSA 签名
 * 返回 base64 编码的签名字符串
 */
export function signWithPrivateKey(
  signString: string,
  privateKeyPem: string
): string {
  const pem = normalizePrivateKey(privateKeyPem);
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signString, "utf8");
  return signer.sign(pem, "base64");
}

/**
 * 使用平台公钥对待签名字符串与签名进行 SHA256WithRSA 验签
 */
export function verifyWithPublicKey(
  signString: string,
  signature: string,
  publicKeyPem: string
): boolean {
  try {
    const pem = normalizePublicKey(publicKeyPem);
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(signString, "utf8");
    return verifier.verify(pem, signature, "base64");
  } catch {
    return false;
  }
}

/**
 * 完整签名流程：传入参数对象，返回 sign 字符串
 */
export function signParams(
  params: Record<string, unknown>,
  privateKeyPem: string
): string {
  const signString = buildSignString(params);
  return signWithPrivateKey(signString, privateKeyPem);
}

/**
 * 完整验签流程：传入参数对象（含 sign 字段），返回是否验签通过
 */
export function verifyParams(
  params: Record<string, unknown>,
  signature: string,
  publicKeyPem: string
): boolean {
  const signString = buildSignString(params);
  return verifyWithPublicKey(signString, signature, publicKeyPem);
}
