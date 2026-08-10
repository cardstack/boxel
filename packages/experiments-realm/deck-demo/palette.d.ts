// `palette` has no file in this realm. The Version Lock card resolves it at
// runtime, and TypeScript has no way to know that — a decklist is data in a
// card instance, read by the host after the type checker has long finished.
// So the specifier needs an ambient declaration, exactly as it would under a
// plain import map.
//
// Worth being clear about what this costs: the shape below is hand-written
// and nothing checks it against either build. It describes the v2 API. Under
// a v1 pin the runtime disagrees with this file, which is why the card
// branches on `VERSION` at runtime rather than trusting these types.
declare module 'palette' {
  export const VERSION: string;
  export function pick(name: string): string;
  export function names(): string[];
}
