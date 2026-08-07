// ===== Next.js Instrumentation：服务端启动时初始化 =====
// 在代理环境下（如本地开发使用 HTTP_PROXY/HTTPS_PROXY）配置 undici 全局 dispatcher，
// 使 Node.js 原生 fetch 能走代理（默认不读系统代理变量）

export async function register(): Promise<void> {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (proxyUrl) {
    try {
      const { setGlobalDispatcher, ProxyAgent } = await import("undici");
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
      console.log(`[instrumentation] ProxyAgent configured: ${proxyUrl}`);
    } catch {
      // undici 不可用或代理配置失败，静默忽略（不影响服务启动）
    }
  }
}
