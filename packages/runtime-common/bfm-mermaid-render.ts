/**
 * Utilities for extracting mermaid diagram definitions from markdown and
 * replacing placeholder elements with pre-rendered SVG output.
 *
 * The placeholder `<pre class="mermaid">...escaped source...</pre>` is emitted
 * by the custom code renderer in `marked-sync.ts`. This module provides the
 * helpers used by the markdown component to lazily render those placeholders.
 */

import DOMPurify from 'dompurify';

const MERMAID_FENCE_RE = new RegExp(
  '```mermaid[^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)```',
  'g',
);

/**
 * Extract mermaid code block contents from raw markdown source.
 *
 * Returns an array of trimmed mermaid diagram definitions, in document order.
 */
export function extractMermaidBlocks(markdown: string): string[] {
  let blocks: string[] = [];
  // Reset lastIndex in case of reuse (global regex).
  MERMAID_FENCE_RE.lastIndex = 0;
  let match;
  while ((match = MERMAID_FENCE_RE.exec(markdown)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

/**
 * Replace `<pre class="mermaid">` placeholder elements in a parsed HTML
 * document with pre-rendered SVG strings.
 *
 * Matching is done by comparing the text content of each `<pre>` element
 * (trimmed) against the keys in the `svgs` map.
 */
export function replaceMermaidSvgs(
  doc: Document,
  svgs: Map<string, string>,
): void {
  for (let el of Array.from(
    doc.querySelectorAll<HTMLPreElement>('pre.mermaid'),
  )) {
    let code = el.textContent?.trim() || '';
    let svg = svgs.get(code);
    if (svg) {
      // Mermaid SVG output is derived from user-authored markdown, so sanitize
      // it before insertion to prevent XSS. USE_PROFILES allows SVG elements.
      el.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
      el.setAttribute('data-processed', 'true');
    }
  }
}
