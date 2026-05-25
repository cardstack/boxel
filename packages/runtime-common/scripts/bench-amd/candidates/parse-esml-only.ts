// Theoretical floor: es-module-lexer (Rust+wasm) parse-only. We don't
// use it in production because it only exposes import/export byte
// ranges — no full AST, so it can't drive scope-aware identifier
// rewriting — but it's a useful "what's the absolute floor?" data
// point for benchmarking.
import { parse, init } from 'es-module-lexer';

let initialized = false;

export const name = 'parse-esml-only';

export async function transform(
  src: string,
  _moduleId: string,
): Promise<string> {
  if (!initialized) {
    await init;
    initialized = true;
  }
  parse(src);
  return src; // not real output — parse-cost only.
}
