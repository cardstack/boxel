// The card-facing doorway to the host's vendored pdf.js: a zero-cost
// function whose call performs the lazy chunk load (see `./pdfjs` for what
// the chunk wires up). It exists as a real module — not only a virtual-
// network shim id — because host-bundled copies of card code (test builds
// import base source directly) resolve the specifier through the bundler,
// while loader-served card code reaches it through the `shimModule`
// registration in `externals.ts`. Both paths land here.
export async function loadPdfjs(): Promise<any> {
  return (await import('./pdfjs.js')).default;
}
