/**
 * Post-processes math placeholder elements in an HTML document by rendering
 * them with KaTeX. The placeholders are emitted by the `markedKatexPlaceholder`
 * extension in `bfm-math.ts`.
 *
 * This operates on a DOMParser document (string-level processing) so that the
 * resulting HTML can be set via Glimmer's tracked rendering without being
 * overwritten by re-renders.
 */
export function processKatexPlaceholders(
  doc: Document,
  katex: { renderToString(expr: string, opts: object): string },
): void {
  for (let el of Array.from(
    doc.querySelectorAll<HTMLElement>('.math-placeholder'),
  )) {
    let math = el.getAttribute('data-math');
    if (!math) continue;
    let displayMode = el.getAttribute('data-display') === 'true';
    try {
      el.innerHTML = katex.renderToString(math, {
        displayMode,
        throwOnError: false,
      });
    } catch {
      // leave placeholder as-is
    }
  }
}
