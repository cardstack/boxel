import { sanitizeHtml } from './dompurify-runtime.ts';
import { MAX_MARKDOWN_RENDER_LENGTH } from './constants.ts';
import { escapeHtml } from './helpers/html.ts';
import {
  bfmCardReferenceExtensions,
  bfmExtensionsForKeyword,
} from './bfm-card-references.ts';
import { markedKatexPlaceholder } from './bfm-math.ts';
import {
  REPLACE_MARKER_PATTERN,
  SEARCH_MARKER_PATTERN,
} from './search-replace-markers.ts';

import {
  Marked,
  gfmHeadingId,
  markedAlert,
  markedFootnote,
  markedExtendedTables,
} from './marked.mts';

import type * as _MonacoSDK from 'monaco-editor';
type MonacoSDK = typeof _MonacoSDK;

// Use a dedicated Marked instance instead of the global singleton.
// IMPORTANT: Do NOT call bfmMarked.use() inside markedSync() — each use()
// call wraps the previous renderer in a new closure, creating an ever-growing
// closure chain that leaks memory over many calls (e.g. during test runs).
const bfmMarked = new Marked();

// Register BFM card reference extensions.
bfmMarked.use({ extensions: bfmCardReferenceExtensions() });

// Register BFM file reference extensions (`:file[URL]` / `::file[URL]`).
// FileDef extends BaseDef rather than CardDef, so it needs its own keyword.
bfmMarked.use({ extensions: bfmExtensionsForKeyword('file') });

// Register community marked extensions for BFM layers 3+ (GFM enhancements).
bfmMarked.use(gfmHeadingId({ prefix: 'user-content-' }));
bfmMarked.use(markedAlert());
bfmMarked.use(markedFootnote());
bfmMarked.use(markedExtendedTables());
bfmMarked.use(markedKatexPlaceholder());

// Per-call options for the code renderer. Set before each parse() call.
// Safe because JS is single-threaded and parse() is synchronous.
let _codeRenderOpts: {
  escapeHtmlInCodeBlocks?: boolean;
  enableMonacoSyntaxHighlighting?: boolean;
  monacoTheme?: string;
  monaco?: MonacoSDK | null;
  tabSize?: number;
} = {};

// Register the code renderer ONCE to avoid closure chain accumulation.
bfmMarked.use({
  renderer: {
    code(code: string, language = '') {
      if (language === 'mermaid') {
        return `<pre class="mermaid">${escapeHtml(code)}</pre>\n`;
      }

      let highlighted = renderWithMonaco(code, language, _codeRenderOpts);
      if (highlighted) {
        return highlighted;
      }

      if (_codeRenderOpts.escapeHtmlInCodeBlocks) {
        return `<pre data-code-language="${escapeHtml(language)}">${escapeHtml(code)}</pre>`;
      } else {
        return `<pre data-code-language="${escapeHtml(language)}">${code}</pre>`;
      }
    },
  },
});

// The trailing `\s+|\r?$` alternation keeps a bullet that ends its line —
// with or without trailing text — normalizable; split('\n') has already
// consumed the newline the old whole-string pattern used to match.
const DECORATIVE_BULLET_PATTERN =
  // eslint-disable-next-line no-misleading-character-class -- match pictographic symbols plus a few geometric glyphs not covered by the Unicode class
  /^(\s*)([\p{Extended_Pictographic}★•▪●❖✦✧◉◦◾◽⬢⬡☑✔☑️➤➔➜➡→])(\s+|\r?$)/u;

// `.` never matches `\r`, so on CRLF input the greedy group stops before a
// trailing `\r`; the explicit `\r?` lets `$` still anchor. Without it no
// fence line would ever match CRLF content and the tracker would rewrite
// fenced code.
const CODE_FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})(.*)\r?$/;
// Markdown can open a fence on the same line as a list marker (`- ```gts`);
// marked treats that as fenced code, so the tracker must too. Only openers
// take this form — a closing fence cannot carry an info string, let alone a
// list marker.
const LIST_PREFIXED_CODE_FENCE_PATTERN =
  /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(`{3,}|~{3,})(.*)\r?$/;
// Where a line sits relative to fenced code: it opens a fence, closes one,
// is content inside one, or is ordinary prose outside any fence. Every pass
// that rewrites prose asks this before touching a line, so fenced content —
// which the applier matches against the target file — survives verbatim.
type FencePosition = 'open' | 'close' | 'inside' | 'outside';

class FenceTracker {
  private inFence = false;
  private fenceChar = '';
  private fenceLength = 0;

  // Feed the next line and learn where it sits. A fence closes only on a run
  // of the same character at least as long as the one that opened it, with
  // nothing after it.
  feed(line: string): FencePosition {
    if (this.inFence) {
      let closeMatch = line.match(CODE_FENCE_PATTERN);
      if (
        closeMatch &&
        closeMatch[2][0] === this.fenceChar &&
        closeMatch[2].length >= this.fenceLength &&
        closeMatch[3].trim() === ''
      ) {
        this.inFence = false;
        return 'close';
      }
      return 'inside';
    }
    let openMatch =
      line.match(CODE_FENCE_PATTERN) ??
      line.match(LIST_PREFIXED_CODE_FENCE_PATTERN);
    if (openMatch) {
      this.inFence = true;
      this.fenceChar = openMatch[2][0];
      this.fenceLength = openMatch[2].length;
      return 'open';
    }
    return 'outside';
  }
}

// Prefix decorative bullets with a standard list marker so marked treats them
// as list items — but never inside fenced code blocks. Fenced content must
// survive rendering verbatim: search/replace patches are extracted back out
// of the rendered HTML, and an inserted marker makes the patch text no longer
// match the file it targets.
//
// Only *fenced* blocks are protected. A 4-space indented line is an indented
// code block to marked in some contexts, but inside a list item the same
// indentation is ordinary list content (a nested bullet); telling the two
// apart needs block context that only the lexer has. Since the patch format
// is always fenced, indented code blocks are left to the rewrite.
function normalizeDecorativeBullets(markdown: string): string {
  let fences = new FenceTracker();
  return markdown
    .split('\n')
    .map((line) => {
      if (fences.feed(line) !== 'outside') {
        return line;
      }
      return line.replace(
        DECORATIVE_BULLET_PATTERN,
        (_match, indentation, bullet, whitespace) =>
          `${indentation}* ${bullet}${whitespace}`,
      );
    })
    .join('\n');
}

// A code patch is a fenced block whose first line is a file url and whose
// second line is the SEARCH marker. When the file being written is itself
// markdown with fenced code inside — a plan document with an ASCII layout,
// say — the first bare ``` in that content closes the patch's fence early.
// The rest of the file content renders as prose, and the fence meant to
// close the patch opens a new block that swallows the *next* patch: its url
// is then not on the block's first line, the host reports "Missing file URL",
// and that file is never written. A fence closes only on a run at least as
// long as the one that opened it, so lengthening the patch's opening and
// closing fence past every run inside it keeps the patch as one block.
//
// Only the two fence lines change. The patch text between the markers, which
// the applier matches against the target file, is not touched. A patch whose
// REPLACE marker has not streamed in yet gets only its opener widened, so a
// partially received plan file already renders as one block. A patch that
// closed its fence without ever writing the REPLACE marker is left alone, so
// the model's omission costs that one block and not the blocks after it.
const FILE_URL_LINE_PATTERN = /^\s*https?:\/\/\S+(\s*\(\s*new\s*\))?\s*\r?$/;

// A fence opens a code block only at the start of a line. A model that ends a
// sentence and starts the patch on the same line — "Let's write the block!```json"
// — has written a patch the renderer reads as prose: the url, the markers and
// the file content collapse into one paragraph, the host finds no code block
// and applies nothing, and the bot, which counts patches by their markers,
// waits for a result that never comes. The block itself is correct; only the
// line break before the fence is missing. Put it back when the two lines after
// the fence are a file url and the SEARCH marker, which is what makes this a
// patch rather than prose that happens to end in backticks.
//
// The prose group is lazy and must end on a character that is neither
// whitespace nor a backtick, so a four-backtick fence is split before its
// first backtick rather than after it. Only horizontal whitespace may sit
// between the fence and the line end, so a CRLF line's `\r` reaches its own
// group and both produced lines keep it.
const FENCE_GLUED_TO_PROSE_PATTERN = /^(.*?[^\s`])(`{3,}\w*)[ \t]*(\r?)$/;

//
// Only prose outside any fenced block is split. A patch that writes a document
// about the patch format carries this very anti-example inside its own halves;
// splitting it there would change the file the model asked for, or stop the
// SEARCH half from matching its target. When a split does fire, the fence line
// it produces opens a block, and the tracker is told so.
export function splitCodePatchFencesGluedToProse(markdown: string): string {
  let lines = markdown.split('\n');
  let fences = new FenceTracker();
  for (let i = 0; i < lines.length; i++) {
    if (fences.feed(lines[i]) !== 'outside') {
      continue;
    }
    let glued = lines[i].match(FENCE_GLUED_TO_PROSE_PATTERN);
    if (
      glued &&
      i + 2 < lines.length &&
      FILE_URL_LINE_PATTERN.test(lines[i + 1]) &&
      SEARCH_MARKER_PATTERN.test(lines[i + 2])
    ) {
      let [, prose, fence, cr] = glued;
      let fenceLine = `${fence}${cr}`;
      lines.splice(i, 1, `${prose}${cr}`, fenceLine);
      i++;
      fences.feed(fenceLine);
    }
  }
  return lines.join('\n');
}

export function widenFencesAroundCodePatches(markdown: string): string {
  let lines = markdown.split('\n');
  let i = 0;
  while (i < lines.length) {
    let open =
      lines[i].match(CODE_FENCE_PATTERN) ??
      lines[i].match(LIST_PREFIXED_CODE_FENCE_PATTERN);
    if (!open) {
      i++;
      continue;
    }
    let fenceChar = open[2][0];
    let fenceLength = open[2].length;
    let isPatch =
      fenceChar === '`' &&
      FILE_URL_LINE_PATTERN.test(lines[i + 1] ?? '') &&
      SEARCH_MARKER_PATTERN.test(lines[i + 2] ?? '');
    if (!isPatch) {
      let close = indexOfClosingFence(lines, i + 1, fenceChar, fenceLength);
      i = close === -1 ? lines.length : close + 1;
      continue;
    }

    let replaceIndex = indexOfLine(lines, i + 3, (line) =>
      REPLACE_MARKER_PATTERN.test(line),
    );
    // A block whose own closing fence comes before any REPLACE marker is a
    // finished patch with the marker left out, not one still streaming. Its
    // fence is the only bound it has: widening past it would count that
    // fence as inner content, leave the block open to the end of the message,
    // and hand the next patch's REPLACE marker to this one, so the two blocks
    // become one and the file after this one is written into it. Leave the
    // block as written; the parser reports it as malformed, bounded by its
    // fence, and the patch after it stays its own block.
    let ownClose = indexOfPatchClosingFence(
      lines,
      i + 1,
      fenceLength,
      replaceIndex,
    );
    if (ownClose !== -1) {
      i = ownClose + 1;
      continue;
    }
    let contentEnd = replaceIndex === -1 ? lines.length : replaceIndex;
    let longestInnerRun = 0;
    for (let j = i + 1; j < contentEnd; j++) {
      let inner = lines[j].match(CODE_FENCE_PATTERN);
      if (inner && inner[2][0] === '`') {
        longestInnerRun = Math.max(longestInnerRun, inner[2].length);
      }
    }

    if (longestInnerRun < fenceLength) {
      // Nothing inside can close this fence early; skip past its closer.
      if (replaceIndex === -1) {
        break;
      }
      let close = indexOfClosingFence(
        lines,
        replaceIndex + 1,
        '`',
        fenceLength,
      );
      i = close === -1 ? lines.length : close + 1;
      continue;
    }

    let widened = '`'.repeat(longestInnerRun + 1);
    lines[i] = lines[i].replace(open[2], widened);
    if (replaceIndex === -1) {
      break;
    }
    // The first bare backtick fence after the REPLACE marker is the one the
    // model wrote to close this patch, whatever its length.
    let close = indexOfLine(lines, replaceIndex + 1, (line) => {
      let m = line.match(CODE_FENCE_PATTERN);
      return !!m && m[2][0] === '`' && m[3].trim() === '';
    });
    if (close === -1) {
      break;
    }
    lines[close] = lines[close].replace(/`+/, widened);
    i = close + 1;
  }
  return lines.join('\n');
}

function indexOfLine(
  lines: string[],
  from: number,
  predicate: (line: string) => boolean,
): number {
  for (let i = from; i < lines.length; i++) {
    if (predicate(lines[i])) {
      return i;
    }
  }
  return -1;
}

// The bare fence that closes a patch before its REPLACE marker, or -1 when
// the patch runs on to the marker (or to the end of a message still
// streaming). Fenced blocks inside the patch's content are skipped: an opener
// with an info string is unmistakably inner, and the next bare fence closes
// it. A bare fence met while no inner block is open is either the patch's own
// close or a bare inner opener, and what follows it tells them apart: the
// patch's own close is followed by no fenced text at all, or by another
// patch's opener before any REPLACE marker; a bare inner opener is followed
// by its closer and then the rest of the patch.
function indexOfPatchClosingFence(
  lines: string[],
  from: number,
  fenceLength: number,
  replaceIndex: number,
): number {
  let end = replaceIndex === -1 ? lines.length : replaceIndex;
  let openInnerBlocks = 0;
  for (let j = from; j < lines.length; j++) {
    let m = lines[j].match(CODE_FENCE_PATTERN);
    if (!m || m[2][0] !== '`') {
      continue;
    }
    if (j >= end) {
      return -1;
    }
    let bare = m[3].trim() === '' && m[2].length >= fenceLength;
    if (!bare) {
      openInnerBlocks++;
      continue;
    }
    if (openInnerBlocks > 0) {
      openInnerBlocks--;
      continue;
    }
    if (
      hasPatchOpener(lines, j + 1, end) ||
      indexOfLine(lines, j + 1, (line) => CODE_FENCE_PATTERN.test(line)) === -1
    ) {
      return j;
    }
    openInnerBlocks++;
  }
  return -1;
}

// Whether a patch opens between `from` and `to`: a fence line followed by a
// file url line and the SEARCH marker.
function hasPatchOpener(lines: string[], from: number, to: number): boolean {
  for (let j = from; j + 2 < Math.min(to, lines.length); j++) {
    let open =
      lines[j].match(CODE_FENCE_PATTERN) ??
      lines[j].match(LIST_PREFIXED_CODE_FENCE_PATTERN);
    if (
      open &&
      open[2][0] === '`' &&
      FILE_URL_LINE_PATTERN.test(lines[j + 1]) &&
      SEARCH_MARKER_PATTERN.test(lines[j + 2])
    ) {
      return true;
    }
  }
  return false;
}

function indexOfClosingFence(
  lines: string[],
  from: number,
  fenceChar: string,
  fenceLength: number,
): number {
  return indexOfLine(lines, from, (line) => {
    let m = line.match(CODE_FENCE_PATTERN);
    return (
      !!m &&
      m[2][0] === fenceChar &&
      m[2].length >= fenceLength &&
      m[3].trim() === ''
    );
  });
}

const DEFAULT_MARKED_SYNC_OPTIONS = {
  escapeHtmlInCodeBlocks: true,
  enableMonacoSyntaxHighlighting: false,
};

/**
 * Renders code with syntax highlighting using the Monaco editor SDK.
 *
 * This function tokenizes code using Monaco's editor capabilities to generate
 * HTML with syntax highlighting spans. Each line is colorized separately and
 * combined into a pre/code block with Monaco token classes.
 *
 * @param code - The source code string to highlight
 * @param language - The programming language for syntax highlighting (e.g., 'typescript', 'javascript')
 * @param opts - Configuration options
 * @param opts.monaco - Optional Monaco SDK instance. Required for highlighting to occur
 * @param opts.monacoTheme - Optional theme name to apply before colorizing (e.g., 'vs-dark', 'vs-light')
 * @param opts.tabSize - Optional tab size for indentation rendering
 * @param opts.enableMonacoSyntaxHighlighting - Flag to enable/disable Monaco syntax highlighting. If false, function returns null immediately
 *
  let editor = monaco?.editor;
  if (monaco === null || !editor?.createModel || !editor?.colorizeModelLine) {
 * or an error occurs during colorization
 *
 * @throws Does not throw; catches all errors and returns null instead
 */
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
  let editor = monaco?.editor;
  if (monaco === null || !editor?.createModel || !editor?.colorizeModelLine) {
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

    return `<pre data-code-language="${escapeHtml(language)}"><code class="monaco-tokenized-source monaco-highlight">${highlightedLines.join(
      '\n',
    )}</code></pre>`;
  } catch (error) {
    console.debug('[marked-sync] Monaco syntax highlighting failed:', error);
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
  // Set per-call options for the code renderer (registered once above).
  _codeRenderOpts = { ...DEFAULT_MARKED_SYNC_OPTIONS, ...opts };

  return bfmMarked.parse(markdown, { async: false }) as string;
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
  let normalizedMarkdown = normalizeDecorativeBullets(markdown);
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

// How many leading characters of over-limit content to show as an escaped
// plain-text preview, so the field is not opaque without parsing all of it.
export const OVERSIZED_MARKDOWN_PREVIEW_LENGTH = 2000;

// Whether content is past the render bound and should skip the synchronous
// markdown pipeline. Compares character length (a cheap proxy for the byte
// length the card size limit bounds); see MAX_MARKDOWN_RENDER_LENGTH.
export function isMarkdownOverRenderLimit(
  content: string | null | undefined,
): content is string {
  return (
    typeof content === 'string' && content.length > MAX_MARKDOWN_RENDER_LENGTH
  );
}

// Approximate a content length (in string characters) as a human-readable size.
function markdownContentSizeLabel(length: number): string {
  if (length >= 1024 * 1024) {
    return `${(length / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(length / 1024)} KB`;
}

// The fallback rendered for over-limit content in place of the parsed markdown:
// a short notice plus an escaped, truncated plain-text preview. Returns an HTML
// string; callers wrap it in their framework's html-safe marker. The preview is
// escaped so the raw content is never interpreted as HTML.
export function markdownOversizedNoticeHtml(content: string): string {
  let preview = escapeHtml(content.slice(0, OVERSIZED_MARKDOWN_PREVIEW_LENGTH));
  let sizeLabel = markdownContentSizeLabel(content.length);
  return (
    `<div class="markdown-oversized" data-test-markdown-oversized>` +
    `<p class="markdown-oversized-notice">This content is too large to render as Markdown (${sizeLabel}). Showing the beginning as plain text:</p>` +
    `<pre class="markdown-oversized-preview">${preview}…</pre>` +
    `</div>`
  );
}

export function hasCodeBlocks(markdown: string | null | undefined): boolean {
  if (!markdown) {
    return false;
  }
  const fenceRE = /```(\S+)?\s*[\r\n]/g;
  return fenceRE.test(markdown);
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
    // @ts-expect-error -- dynamic import of untyped module
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
