// This declaration is needed to satisfy the type checker.
declare module '@cardstack/boxel-host/tools/*' {
  const mod: any;
  export default mod;
}

// Pre-rename spelling of the tools/ specifiers; resolves to the same modules.
declare module '@cardstack/boxel-host/commands/*' {
  const mod: any;
  export default mod;
}

// Host library modules card code may import, declared per module with their
// named exports so they type-check in programs that compile base without
// host sources — and without `esModuleInterop`, which rules out an `any`
// wildcard here. Programs with host sources map the
// `@cardstack/boxel-host/lib/*` prefix onto the real modules via `paths`.
declare module '@cardstack/boxel-host/lib/pdfjs-loader' {
  // Matches `loadPdfjs` in `packages/host/app/lib/pdfjs-loader.ts`.
  export function loadPdfjs(): Promise<any>;
}
