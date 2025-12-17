import { marked } from 'marked';
import { sanitizeHtml } from './dompurify-runtime';
import { escapeHtml } from './helpers/html';
import type * as _MonacoSDK from 'monaco-editor';
type MonacoSDK = typeof _MonacoSDK;

const DECORATIVE_BULLET_PATTERN =
  // eslint-disable-next-line no-misleading-character-class -- match pictographic symbols plus a few geometric glyphs not covered by the Unicode class
  /(^|\n)(\s*)([\p{Extended_Pictographic}★•▪●❖✦✧◉◦◾◽⬢⬡☑✔☑️➤➔➜➡→])(\s+)/gu;

const DEFAULT_MARKED_SYNC_OPTIONS = {
  escapeHtmlInCodeBlocks: true,
  enableMonacoSyntaxHighlighting: false,
};

function renderWithMonaco(
  code: string,
  language: string,
  opts: {
    monaco?: MonacoSDK | null;
    monacoTheme?: string;
    tabSize?: number;
    enableMonacoSyntaxHighlighting?: boolean;
  },
): string | null {
  if (!opts.enableMonacoSyntaxHighlighting) {
    return null;
  }

  let monaco = opts.monaco;
  let editor = (monaco as MonacoSDK | undefined)?.editor;
  if (!editor?.createModel || !editor?.colorizeModelLine) {
    return null;
  }

  let model: _MonacoSDK.editor.ITextModel | null = null;
  try {
    model = editor.createModel(code, language || undefined);
    if (opts.monacoTheme && editor.setTheme) {
      editor.setTheme(opts.monacoTheme);
    }
    let lineCount = model.getLineCount();
    let highlightedLines: string[] = [];

    for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
      highlightedLines.push(
        editor.colorizeModelLine(model, lineNumber, opts.tabSize),
      );
    }

    return `<pre data-code-language="${language}"><code class="monaco-tokenized-source monaco-highlight">${highlightedLines.join(
      '\n',
    )}</code></pre>`;
  } catch (_error) {
    return null;
  } finally {
    model?.dispose?.();
  }
}

export function markedSync(
  markdown: string,
  opts: {
    escapeHtmlInCodeBlocks?: boolean;
    enableMonacoSyntaxHighlighting?: boolean;
    monacoTheme?: string;
    monaco?: MonacoSDK | null;
    tabSize?: number;
  } = DEFAULT_MARKED_SYNC_OPTIONS,
): string {
  let options = { ...DEFAULT_MARKED_SYNC_OPTIONS, ...opts };

  return marked
    .use({
      renderer: {
        code(code, language = '') {
          let highlighted = renderWithMonaco(code, language, options);
          if (highlighted) {
            return highlighted;
          }

          if (options.escapeHtmlInCodeBlocks) {
            return `<pre data-code-language="${language}">${escapeHtml(code)}</pre>`;
          } else {
            return `<pre data-code-language="${language}">${code}</pre>`;
          }
        },
      },
    })
    .parse(markdown, { async: false }) as string;
}

const DEFAULT_OPTS = {
  sanitize: true,
  escapeHtmlInCodeBlocks: true,
  enableMonacoSyntaxHighlighting: false,
};

// Note that this helper depends on some async setup having happened.
// Call and await preloadMarkdownLanguages to ensure that monaco highlighting
// and languages are loaded before calling this sync function.
export function markdownToHtml(
  markdown: string | null | undefined,
  opts: {
    sanitize?: boolean;
    escapeHtmlInCodeBlocks?: boolean;
    enableMonacoSyntaxHighlighting?: boolean;
    monacoTheme?: string;
    monaco?: MonacoSDK | null;
    tabSize?: number;
  } = DEFAULT_OPTS,
): string {
  opts = { ...DEFAULT_OPTS, ...opts };
  if (!markdown) {
    return '';
  }
  // Marked only treats ASCII list markers, so prefix decorative bullets with a standard marker.
  let normalizedMarkdown = markdown.replace(
    DECORATIVE_BULLET_PATTERN,
    (_match, boundary, indentation, bullet, whitespace) =>
      `${boundary}${indentation}* ${bullet}${whitespace}`,
  );
  let html = markedSync(normalizedMarkdown, {
    escapeHtmlInCodeBlocks: opts.escapeHtmlInCodeBlocks,
    enableMonacoSyntaxHighlighting: opts.enableMonacoSyntaxHighlighting,
    monacoTheme: opts.monacoTheme,
    monaco: opts.monaco,
    tabSize: opts.tabSize,
  });
  if (opts.sanitize) {
    html = sanitizeHtml(html);
  }
  return html;
}

/**
 * Preload Monaco language contributions referenced in fenced code blocks.
 * @param {string} markdown
 * @param {typeof import('monaco-editor')} monaco
 */
export async function preloadMarkdownLanguages(md: string, monaco: MonacoSDK) {
  // Collect language ids from ```lang fences
  const langs = new Set();
  const fenceRE = /```(\S+)?\s*[\r\n]/g;
  let m;
  while ((m = fenceRE.exec(md)) !== null) {
    const lang = (m[1] || '').trim();
    if (lang) langs.add(lang.toLowerCase());
  }
  if (!langs.size) return;

  const registered = monaco.languages.getLanguages();

  const languagePromises: Promise<unknown>[] = [];
  const seenLanguageIds = new Set<string>();

  for (let lang of langs) {
    // Try exact id first
    let entry =
      registered.find((l) => l.id.toLowerCase() === lang) ||
      registered.find((l) =>
        (l.aliases || []).some((a: string) => a.toLowerCase() === lang),
      );
    if (entry) {
      if (seenLanguageIds.has(entry.id)) {
        continue;
      }
      seenLanguageIds.add(entry.id);
      languagePromises.push(
        (async () => {
          // Warm up using Monaco's async colorize, which waits for tokenization readiness internally.
          // Without this, when we use colorizeLine later, the language may not be loaded and tokenization may fail.
          if (typeof monaco.editor?.colorize === 'function') {
            await monaco.editor.colorize('', entry.id, {});
          }
        })(),
      );
    }
  }

  await Promise.all(languagePromises);
}
