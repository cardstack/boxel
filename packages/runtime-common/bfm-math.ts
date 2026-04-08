import { escapeHtml } from './helpers/html';
import type { MarkedExtension, TokenizerAndRendererExtension } from 'marked';

// Regex patterns adapted from marked-katex-extension.
// Inline: $...$ or $$...$$ on one line, with standard spacing rules.
const inlineRule =
  /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1(?=[\s?!.,:\uFF1F\uFF01\u3002\uFF0C\uFF1A]|$)/;
// Block: $$ on its own line, content, $$ on its own line.
const blockRule = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;

/**
 * A marked extension that tokenizes LaTeX math (`$...$` inline, `$$...$$`
 * block) and emits lightweight placeholder HTML instead of rendering with
 * KaTeX at parse time. This keeps the heavy KaTeX library (~268 KB min) out
 * of the initial bundle.
 *
 * Placeholders:
 *   Inline:  <span class="math-placeholder" data-math="..." data-display="false">$...$</span>
 *   Block:   <div  class="math-placeholder" data-math="..." data-display="true">$$...$$</div>
 *
 * A client-side modifier should query `.math-placeholder` elements, lazy-load
 * KaTeX via `import('katex')`, and call `katex.render()` on each one.
 */
export function markedKatexPlaceholder(): MarkedExtension {
  return {
    extensions: [inlineKatex(), blockKatex()],
  };
}

function inlineKatex(): TokenizerAndRendererExtension {
  return {
    name: 'inlineKatex',
    level: 'inline',
    start(src: string) {
      let indexSrc = src;
      while (indexSrc) {
        let index = indexSrc.indexOf('$');
        if (index === -1) return undefined;
        if (index === 0 || indexSrc.charAt(index - 1) === ' ') {
          let possibleKatex = indexSrc.substring(index);
          if (possibleKatex.match(inlineRule)) {
            return index;
          }
        }
        indexSrc = indexSrc.substring(index + 1).replace(/^\$+/, '');
      }
      return undefined;
    },
    tokenizer(src: string) {
      let match = src.match(inlineRule);
      if (match) {
        return {
          type: 'inlineKatex',
          raw: match[0],
          text: match[2].trim(),
          displayMode: match[1].length === 2,
        };
      }
      return undefined;
    },
    renderer(token) {
      let math = escapeHtml((token as any).text);
      let raw = escapeHtml((token as any).raw);
      return `<span class="math-placeholder" data-math="${math}" data-display="false">${raw}</span>`;
    },
  };
}

function blockKatex(): TokenizerAndRendererExtension {
  return {
    name: 'blockKatex',
    level: 'block',
    tokenizer(src: string) {
      let match = src.match(blockRule);
      if (match) {
        return {
          type: 'blockKatex',
          raw: match[0],
          text: match[2].trim(),
          displayMode: match[1].length === 2,
        };
      }
      return undefined;
    },
    renderer(token) {
      let math = escapeHtml((token as any).text);
      let raw = escapeHtml((token as any).raw);
      return `<div class="math-placeholder" data-math="${math}" data-display="true">${raw}</div>\n`;
    },
  };
}
