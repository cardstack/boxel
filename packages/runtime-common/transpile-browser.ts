// Browser stub for transpile. The real module (transpile.ts) pulls in
// glimmer-scoped-css/ast-transform → postcss → source-map-js, which the
// browser bundler can't resolve. transpileJS is only called by the realm
// server, so this stub throws rather than ever running in a browser.
export async function transpileJS(
  _content: string,
  _debugFilename: string,
): Promise<string> {
  throw new Error(`transpileJS is not available in the browser`);
}
