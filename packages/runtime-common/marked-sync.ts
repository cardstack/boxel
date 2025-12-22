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
  // always preload TypeScript and JSON support
  const langs = new Set(['typescript', 'json']);

  // Collect additional languages to preload from ```lang fences
  const fenceRE = /```(\S+)?\s*[\r\n]/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRE.exec(md)) !== null) {
    const lang = (match[1] || '').trim();
    if (lang) langs.add(lang.toLowerCase());
  }

  const registered = monaco.languages.getLanguages();

  const languagePromises: Promise<unknown>[] = [];
  const seenLanguageIds = new Set<string>();

  const contributionLoaders: Record<string, () => Promise<unknown>> = {
    json: () =>
      import('monaco-editor/esm/vs/language/json/monaco.contribution.js'),
    typescript: () =>
      import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
  };

  for (const lang of langs) {
    let entry =
      registered.find((l) => l.id.toLowerCase() === lang) ||
      registered.find((l) =>
        (l.aliases || []).some((a: string) => a.toLowerCase() === lang),
      );
    if (!entry) {
      continue;
    }
    if (seenLanguageIds.has(entry.id)) {
      continue;
    }
    seenLanguageIds.add(entry.id);
    languagePromises.push(
      (async () => {
        if (contributionLoaders[lang]) {
          await contributionLoaders[lang]!();
        }
        // If the language is lazily loaded, force the loader to run so tokenization is registered.
        if (typeof (entry as any).loader === 'function') {
          await (entry as any).loader();
        }
        // Wait for the language to finish activating (onLanguage fires after contribution setup).
        await waitForLanguage(monaco, entry.id);
        // Warm up using Monaco's async colorize, which waits for tokenization readiness internally.
        // Without this, when we use the sync colorizeLine later, the language may not be loaded and tokenization may fallback to a no-op entry.
        await warmUpColorize(monaco, entry.id);
        // Create a model to force tokenization registration for synchronous colorizeModelLine usage.
        warmUpModelTokenization(monaco, entry.id);
        // Ensure tokenization is registered (TokenizationRegistry may lag after activation).
        await waitForTokenizationSupport(monaco, entry.id);
      })(),
    );
  }

  await Promise.all(languagePromises);
}

function waitForLanguage(monaco: MonacoSDK, id: string): Promise<void> {
  // getEncodedLanguageId returns 0 when unknown/unregistered
  if (monaco.languages.getEncodedLanguageId(id) !== 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const disposable = monaco.languages.onLanguage(id, () => {
      disposable.dispose();
      resolve();
    });
  });
}

function waitForTokenizationSupport(
  monaco: MonacoSDK,
  id: string,
): Promise<void> {
  return getTokenizationRegistry(monaco).then(async (registry) => {
    if (!registry) {
      return;
    }
    // Resolve tokenization support via the registry's factory if present.
    try {
      const support = await registry.getOrCreate?.(id);
      if (support) {
        return;
      }
    } catch (err) {
      console.error(
        `[markdown preload] getOrCreate threw for "${id}": ${String(err)}`,
      );
    }
    // Some Monaco builds never emit onDidChange; poll briefly instead.
    const maxAttempts = 20;
    const delayMs = 25;
    for (let i = 0; i < maxAttempts; i++) {
      if (registry.get(id)) {
        // the tokenization support is now registered
        return;
      }
      await sleep(delayMs);
    }
    console.error(
      `[markdown preload] tokenization NOT found for "${id}" after polling`,
    );
  });
}

async function getTokenizationRegistry(monaco: MonacoSDK): Promise<{
  get(id: string): unknown;
  getOrCreate?(id: string | number): Promise<unknown>;
  onDidChange(cb: (e: any) => void): { dispose(): void };
} | null> {
  let registry = (monaco.languages as any).TokenizationRegistry;
  if (registry) {
    return registry;
  }
  try {
    let mod = await import('monaco-editor/esm/vs/editor/common/languages.js');
    if (mod.TokenizationRegistry) {
      // Wire it onto monaco.languages so subsequent lookups share the singleton.
      (monaco.languages as any).TokenizationRegistry = mod.TokenizationRegistry;
      registry = mod.TokenizationRegistry;
      return registry;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function warmUpColorize(monaco: MonacoSDK, id: string) {
  if (typeof monaco.editor?.colorize !== 'function') {
    return;
  }
  if (id === 'json') {
    // Monaco's JSON colorizer chokes on empty input.
    await monaco.editor.colorize(
      `
      \`\`\`json
        { "foo": "bar" }
      \`\`\``,
      id,
      {},
    );
    return;
  }
  if (id === 'typescript') {
    // Monaco's TypeScript colorizer chokes on empty input.
    await monaco.editor.colorize(
      `
      \`\`\`typescript
        const x: number = 42;
      \`\`\``,
      id,
      {},
    );
    return;
  }
  await monaco.editor.colorize('', id, {});
}

function warmUpModelTokenization(monaco: MonacoSDK, id: string) {
  if (
    typeof monaco.editor?.createModel !== 'function' ||
    typeof monaco.editor?.colorizeModelLine !== 'function'
  ) {
    return;
  }
  let code = '';
  if (id === 'json') {
    code = '{ "foo": "bar" }';
  } else if (id === 'typescript') {
    code = 'const x: number = 42;';
  }
  if (!code) {
    return;
  }
  let model = monaco.editor.createModel(code, id);
  try {
    monaco.editor.colorizeModelLine(model, 1, 2);
  } catch (_error) {
    // Ignore warmup failures; we fall back to plaintext.
  } finally {
    model.dispose();
  }
}
