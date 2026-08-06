// 账号系统总开关
// false = 演示模式（无后端，纯前端 mock 数据）
// true  = 启用 Supabase 真实登录与数据库
//
// 所有跟"是否启用账号"相关的逻辑都只读这个常量，不要直接读 process.env。
export const isAuthEnabled =
  process.env.NEXT_PUBLIC_ENABLE_AUTH === "true";
