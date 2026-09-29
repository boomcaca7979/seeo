// ===== I｜用户案例基地 统一出口 =====
// 内部资产体系。不得被客户端组件或公开页面引用
// （守卫测试：src/lib/cases/cases.test.ts）。
// 本轮不创建 /case-studies /customer-stories /testimonials 等公开页面（§18）。

export * from "./schema.ts";
export * from "./validate.ts";
export * from "./store.ts";
