declare module '@deepseek-ai/dsh-http-proxy' {
  export type ProxyRoute =
    | { readonly proxied: true; readonly proxy: string; readonly dispatcher: import('undici').Dispatcher }
    | { readonly proxied: false }
  export function proxyRouteFor(url: URL): ProxyRoute
}
