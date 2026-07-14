import { escapeHtml } from './helpers/html.ts';
import { resolveRRIReference, trimJsonExtension } from './url.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import { FITTED_FORMATS } from './formats.ts';
import type { TokenizerAndRendererExtension } from './marked.mts';

// Regex patterns for stripping code before extraction.
// These avoid backtick-in-regex issues that break content-tag in .gts files.
const FENCED_CODE_RE = /```[\s\S]*?```/g;
// Match code spans with any number of consecutive backticks as delimiter
// (e.g. `code`, ``code``, ```code```). Content may span soft line breaks but
// not a blank line: a paragraph break ends the span (per CommonMark). Without
// the blank-line guard a stray lone backtick pairs lazily across blank lines
// with a later fence, producing a spurious code region that swallows real
// directives. The `\r?` on each newline makes the paragraph-break guard fire
// on CRLF line endings too, not just LF.
const INLINE_CODE_RE = new RegExp(
  '(`+)((?:(?!\\r?\\n[ \\t]*\\r?\\n)[\\s\\S])*?)\\1',
  'g',
);

function resolveUrl(ref: string, baseUrl: string | undefined): string | null {
  let resolved: string;
  try {
    // Identifiers are canonical RRI; resolve the reference against the base in
    // RRI space (no VirtualNetwork). The search index tolerates the resulting
    // canonical-RRI value for the `in:{id}` / `in:{url}` reference queries.
    resolved = resolveRRIReference(
      ref,
      baseUrl ? (baseUrl as RealmResourceIdentifier) : undefined,
    );
  } catch {
    return null;
  }
  // Keep only references that resolved to an absolute identifier — a URL or a
  // prefix-form RRI. A reference that couldn't be made absolute (e.g. a
  // relative ref with no base) is dropped rather than emitted as a bare,
  // unmatchable query value.
  return resolved.startsWith('http://') ||
    resolved.startsWith('https://') ||
    resolved.startsWith('@')
    ? resolved
    : null;
}

// ── BFM size spec parsing ──

export interface BfmSizeSpec {
  format: 'atom' | 'fitted' | 'isolated' | 'embedded';
  width?: number | string; // number = px, string = e.g. "50%"
  height?: number;
}

// Build a flat lookup from FITTED_FORMATS canonical IDs → dimensions
const SIZE_CONSTANTS = new Map<string, { width: number; height: number }>();
for (const group of FITTED_FORMATS) {
  for (const spec of group.specs) {
    SIZE_CONSTANTS.set(spec.id, { width: spec.width, height: spec.height });
  }
}
// BFM spec shorthand aliases → canonical IDs
SIZE_CONSTANTS.set('strip', SIZE_CONSTANTS.get('single-strip')!);
SIZE_CONSTANTS.set('tile', SIZE_CONSTANTS.get('regular-tile')!);
SIZE_CONSTANTS.set('grid-tile', SIZE_CONSTANTS.get('cardsgrid-tile')!);

/**
 * Parses a BFM size specifier (the part after `|` in `::card[url | spec]`).
 *
 * Supported forms:
 *  - `atom`                              — atom format
 *  - `isolated`                          — isolated format
 *  - `embedded`                          — embedded format (explicit)
 *  - `fitted`                            — fitted at the container's natural size
 *  - Named constant: `strip`, `tile`, `compact-card`, etc. (fitted implied)
 *  - `fitted <named-constant>`           — e.g. `fitted strip` (same as `strip`)
 *  - WxH: `400x200` (fitted implied)
 *  - `fitted <WxH>`                      — e.g. `fitted 400x200` (same as `400x200`)
 *  - Explicit keys: `w:400 h:200`, `h:300`, `w:50%` (fitted implied)
 */
export function parseBfmSizeSpec(specifier: string): BfmSizeSpec | null {
  let trimmed = specifier.trim().toLowerCase();

  if (trimmed === 'atom') {
    return { format: 'atom' };
  }

  if (trimmed === 'isolated') {
    return { format: 'isolated' };
  }

  if (trimmed === 'embedded') {
    return { format: 'embedded' };
  }

  if (trimmed === 'fitted') {
    return { format: 'fitted' };
  }

  // Strip optional `fitted` prefix followed by any whitespace;
  // everything below already implies fitted.
  let body = trimmed.replace(/^fitted\s+/, '');

  // Named size constant
  let constant = SIZE_CONSTANTS.get(body);
  if (constant) {
    return { format: 'fitted', width: constant.width, height: constant.height };
  }

  // WxH (e.g. "400x200")
  let wxhMatch = body.match(/^(\d+)\s*x\s*(\d+)$/);
  if (wxhMatch) {
    return {
      format: 'fitted',
      width: parseInt(wxhMatch[1], 10),
      height: parseInt(wxhMatch[2], 10),
    };
  }

  // Explicit key syntax: w:N, h:N, w:N%
  let wMatch = body.match(/\bw:(\d+)(%?)/);
  let hMatch = body.match(/\bh:(\d+)\b/);

  if (wMatch || hMatch) {
    let spec: BfmSizeSpec = { format: 'fitted' };
    if (wMatch) {
      spec.width =
        wMatch[2] === '%' ? `${wMatch[1]}%` : parseInt(wMatch[1], 10);
    }
    if (hMatch) {
      spec.height = parseInt(hMatch[1], 10);
    }
    return spec;
  }

  return null;
}

/**
 * Serializes a `BfmSizeSpec` back into the specifier string that goes after
 * `|` in `::card[url | spec]` — the inverse of `parseBfmSizeSpec`.
 *
 * `atom` / `isolated` / `embedded` round-trip to their keyword. Fitted specs
 * serialize to the explicit-key form (`w:<w> h:<h>`, `w:50%`, `h:200`, or bare
 * `fitted` when no dimensions are present). Named variants are intentionally
 * NOT reconstructed here: a `BfmSizeSpec` only carries dimensions, not the
 * named identity, so callers that want the friendlier `tall-tile` form must
 * emit it themselves (the chooser pane does this off the user's explicit
 * selection). The `w:`/`h:` output still parses back to a dimensionally-
 * identical spec.
 */
export function serializeBfmSizeSpec(spec: BfmSizeSpec): string {
  if (
    spec.format === 'atom' ||
    spec.format === 'isolated' ||
    spec.format === 'embedded'
  ) {
    return spec.format;
  }
  let parts: string[] = [];
  if (spec.width !== undefined) {
    parts.push(`w:${spec.width}`);
  }
  if (spec.height !== undefined) {
    parts.push(`h:${spec.height}`);
  }
  return parts.length ? parts.join(' ') : 'fitted';
}

export interface BfmRefOptions {
  // 'inline' produces `:<refType>[url]` (or `:<refType>[url | size]`),
  // 'block' produces `::<refType>[url]` (or `::<refType>[url | size]`).
  // Default: 'block'.
  kind?: 'inline' | 'block';
  // Size specifier appended after `|` (e.g. 'fitted', 'tall-tile',
  // 'w:300 h:200'). Supported in both inline and block placements.
  size?: string;
}

/**
 * Builds a BFM reference directive (`:card[url]`, `::file[url | size]`, …) for
 * a single reference by keyword + url. Returns `''` for a missing url. This is
 * the single source of truth for BFM directive syntax, shared by the base-realm
 * markdown helpers and host-side serializers (the `extract*`/`parse*` functions
 * above are the matching readers).
 */
export function serializeBfmRef(
  refType: string,
  url: string | null | undefined,
  options?: BfmRefOptions,
): string {
  if (!url) {
    return '';
  }
  let kind = options?.kind ?? 'block';
  let prefix = kind === 'inline' ? ':' : '::';
  let size = options?.size;
  return size
    ? `${prefix}${refType}[${url} | ${size}]`
    : `${prefix}${refType}[${url}]`;
}

export type BfmRefFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';

/**
 * Derives the render format and an optional inline sizing style
 * (`width`/`height`) from a BFM ref element's `data-boxel-bfm-*` attributes.
 * Works for both inline and block refs — only `defaultFormat` differs by
 * placement (block embeds default to `embedded`, inline embeds to `atom`).
 * Shared so that resolved cards, the loading shimmer, and the broken-link
 * placeholder all occupy the same footprint as the eventual card.
 */
export function bfmRefFormatAndSize(
  formatAttr: string | undefined,
  widthAttr: string | undefined,
  heightAttr: string | undefined,
  defaultFormat: BfmRefFormat = 'embedded',
): { format: BfmRefFormat; sizeStyle?: string } {
  let format: BfmRefFormat =
    formatAttr === 'atom' ||
    formatAttr === 'embedded' ||
    formatAttr === 'fitted' ||
    formatAttr === 'isolated'
      ? formatAttr
      : defaultFormat;
  if (format !== 'fitted') {
    return { format };
  }
  let parts: string[] = [];
  if (widthAttr && /^\d+%$/.test(widthAttr)) {
    parts.push(`width: ${widthAttr}`);
  } else if (widthAttr && /^\d+$/.test(widthAttr)) {
    parts.push(`width: ${widthAttr}px`);
  }
  if (heightAttr && /^\d+$/.test(heightAttr)) {
    parts.push(`height: ${heightAttr}px`);
  }
  return { format, sizeStyle: parts.length ? parts.join('; ') : undefined };
}

/**
 * Builds the `data-boxel-bfm-format` / `-width` / `-height` attribute string
 * for a BFM size specifier (the part after `|`). Returns `''` when there is no
 * specifier or it doesn't parse. Shared by the inline and block renderers so
 * both placements emit identical size attributes.
 */
function bfmSizeAttrs(specifier: string | undefined): string {
  if (!specifier) {
    return '';
  }
  let sizeSpec = parseBfmSizeSpec(specifier);
  if (!sizeSpec) {
    return '';
  }
  let attrs = ` data-boxel-bfm-format="${sizeSpec.format}"`;
  if (sizeSpec.width !== undefined) {
    attrs += ` data-boxel-bfm-width="${sizeSpec.width}"`;
  }
  if (sizeSpec.height !== undefined) {
    attrs += ` data-boxel-bfm-height="${sizeSpec.height}"`;
  }
  return attrs;
}

/**
 * Splits the content between `[` and `]` in a BFM directive into the URL
 * part and an optional size specifier (after `|`).
 */
function splitBfmContent(content: string): {
  url: string;
  specifier: string | undefined;
} {
  let pipeIndex = content.indexOf('|');
  if (pipeIndex >= 0) {
    return {
      url: content.substring(0, pipeIndex).trim(),
      specifier: content.substring(pipeIndex + 1).trim(),
    };
  }
  return { url: content.trim(), specifier: undefined };
}

export interface BfmReference {
  url: string;
  keyword: string;
}

/**
 * Extracts and deduplicates BFM reference URLs from markdown content for the
 * given keywords (e.g. 'card', 'file'). Supports `:keyword[URL]` (inline) and
 * `::keyword[URL]` (block) syntax. References inside fenced code blocks and
 * inline code are ignored. Returns resolved absolute URLs in document order.
 */
export function extractBfmReferences(
  markdown: string,
  baseUrl: string,
  keywords: string[],
): BfmReference[] {
  // Strip code blocks so references inside them are not extracted
  let stripped = markdown
    .replace(FENCED_CODE_RE, '')
    .replace(INLINE_CODE_RE, '');

  // Collect all matches with their position so we can sort by document order
  let matches: { index: number; url: string; keyword: string }[] = [];

  for (let keyword of keywords) {
    let blockRe = new RegExp(`^::${keyword}\\[([^\\]]+)\\]`, 'gm');
    // Negative lookbehind excludes ::keyword[ (block syntax) from inline matches
    let inlineRe = new RegExp(`(?<!:):${keyword}\\[([^\\]]+)\\]`, 'g');

    for (let match of stripped.matchAll(blockRe)) {
      let { url: rawUrl } = splitBfmContent(match[1]);
      let resolved = resolveUrl(rawUrl, baseUrl);
      if (resolved) {
        matches.push({
          index: match.index!,
          url: trimJsonExtension(resolved),
          keyword,
        });
      }
    }
    for (let match of stripped.matchAll(inlineRe)) {
      let { url: rawUrl } = splitBfmContent(match[1]);
      let resolved = resolveUrl(rawUrl, baseUrl);
      if (resolved) {
        matches.push({
          index: match.index!,
          url: trimJsonExtension(resolved),
          keyword,
        });
      }
    }
  }

  // Sort by position in the document, then deduplicate by URL (keeping first)
  matches.sort((a, b) => a.index - b.index);

  let seen = new Set<string>();
  let refs: BfmReference[] = [];
  for (let m of matches) {
    if (!seen.has(m.url)) {
      seen.add(m.url);
      refs.push({ url: m.url, keyword: m.keyword });
    }
  }

  return refs;
}

// ── Markdown embed chooser bridge ──
//
// Lets the base-realm markdown editor (in `packages/base/`) open the host-
// side combined chooser modal without importing host services directly. The
// host modal registers itself on `globalThis` at mount time; runtime-common
// exposes the typed accessors below. Mirrors the `chooseCard` / `chooseFile`
// pattern used by other host-side modals.

export interface MarkdownEmbedResult {
  refType: 'card' | 'file';
  url: string;
  bfm: string;
}

export type MarkdownEmbedResolution =
  | MarkdownEmbedResult
  | { remove: true }
  | undefined;

export interface MarkdownEmbedInitialTarget {
  refType: 'card' | 'file';
  url: string;
  // Either a pre-parsed `BfmSizeSpec` or the raw specifier text after `|`.
  sizeSpec?: BfmSizeSpec | string;
  // The directive's placement (`::` block vs `:` inline), carried separately
  // from `sizeSpec` so a size-less block directive seeds block placement
  // instead of collapsing to an inline atom.
  kind?: 'inline' | 'block';
}

export interface MarkdownEmbedChooser {
  chooseCardOrFile(opts: {
    defaultTab?: 'card' | 'file';
  }): Promise<MarkdownEmbedResolution>;
  editEmbed(
    target: MarkdownEmbedInitialTarget,
  ): Promise<MarkdownEmbedResolution>;
}

export interface BfmRefRange {
  kind: 'inline' | 'block';
  // Half-open range into the original markdown string as UTF-16 code-unit
  // offsets (i.e. JS string indices, the same units CodeMirror positions use):
  // `markdown.slice(from, to)` reproduces the directive verbatim. Suitable for
  // a CodeMirror dispatch that replaces or deletes the directive in place.
  from: number;
  to: number;
  refType: string;
  // Unresolved URL as written between `[` and `]` — callers resolve against
  // a base URL when they need the canonical form.
  url: string;
  // Raw size specifier after `|` (e.g. `'embedded'`, `'tall-tile'`,
  // `'w:400 h:200'`). Undefined when the directive has no `|` segment.
  sizeSpec?: string;
}

/**
 * Locates every BFM reference site in `markdown` and returns its source
 * character range (UTF-16 code-unit offsets), refType, URL, and size specifier
 * (verbatim — no URL resolution).
 *
 * Differs from `extractBfmReferences` in two ways: indices are into the
 * ORIGINAL markdown (not a code-stripped copy), and matches are not
 * deduplicated — every site is its own range. References inside fenced code
 * blocks and inline code are skipped.
 *
 * Intended for editor-side tooling — cursor-over-ref detection, in-place
 * replacement, deletion — where every directive needs its own `[from, to]`.
 */
export function extractBfmRefRanges(
  markdown: string,
  keywords: string[] = ['card', 'file'],
): BfmRefRange[] {
  // Collect code regions to skip. Sorted spans in the original markdown.
  let codeRegions: Array<[number, number]> = [];
  for (let m of markdown.matchAll(FENCED_CODE_RE)) {
    codeRegions.push([m.index!, m.index! + m[0].length]);
  }
  for (let m of markdown.matchAll(INLINE_CODE_RE)) {
    codeRegions.push([m.index!, m.index! + m[0].length]);
  }
  codeRegions.sort((a, b) => a[0] - b[0]);
  let isInCode = (pos: number) =>
    codeRegions.some(([s, e]) => pos >= s && pos < e);

  let ranges: BfmRefRange[] = [];

  for (let keyword of keywords) {
    let escaped = escapeRegExp(keyword);
    // Block directive must be alone on its line — mirror the render-side
    // tokenizer's trailing `\s*(?:\n|$)` and the editor widget's `[ \t]*$` so
    // detection and rendering stay in lockstep (a directive with trailing text
    // is not an embed). `[^\]\n]+` keeps a `]`-less directive from spanning
    // lines. The trailing `[ \t]*` is folded into the range so `to` reaches the
    // line end, matching the block widget's decorated span.
    let blockRe = new RegExp(`^::${escaped}\\[([^\\]\\n]+)\\][ \\t]*$`, 'gm');
    let inlineRe = new RegExp(`(?<!:):${escaped}\\[([^\\]]+)\\]`, 'g');

    for (let match of markdown.matchAll(blockRe)) {
      if (isInCode(match.index!)) continue;
      let { url, specifier } = splitBfmContent(match[1]);
      ranges.push({
        kind: 'block',
        from: match.index!,
        to: match.index! + match[0].length,
        refType: keyword,
        url,
        sizeSpec: specifier,
      });
    }
    for (let match of markdown.matchAll(inlineRe)) {
      if (isInCode(match.index!)) continue;
      let { url, specifier } = splitBfmContent(match[1]);
      ranges.push({
        kind: 'inline',
        from: match.index!,
        to: match.index! + match[0].length,
        refType: keyword,
        url,
        sizeSpec: specifier,
      });
    }
  }

  ranges.sort((a, b) => a.from - b.from);
  return ranges;
}

/**
 * Convenience wrapper that extracts only `:card[URL]` / `::card[URL]`
 * references and returns just the resolved URL strings.
 */
export function extractCardReferenceUrls(
  markdown: string,
  baseUrl: string,
): string[] {
  return extractBfmReferences(markdown, baseUrl, ['card']).map((r) => r.url);
}

/**
 * Convenience wrapper that extracts only `:file[URL]` / `::file[URL]`
 * references and returns just the resolved URL strings.
 */
export function extractFileReferenceUrls(
  markdown: string,
  baseUrl: string,
): string[] {
  return extractBfmReferences(markdown, baseUrl, ['file']).map((r) => r.url);
}

/**
 * Creates marked v12 extensions for a given BFM keyword.
 *
 * Block: `::keyword[URL]` → `<div data-boxel-bfm-block-ref="URL" data-boxel-bfm-type="keyword">URL</div>`
 * Inline: `:keyword[URL]` → `<span data-boxel-bfm-inline-ref="URL" data-boxel-bfm-type="keyword">URL</span>`
 *
 * The URL text content serves as fallback text shown before referenced cards
 * load or when they cannot be resolved. URLs are emitted as-is (unresolved).
 * The consumer is responsible for resolving them against a base URL before
 * matching to instance IDs.
 */
export function bfmExtensionsForKeyword(
  keyword: string,
): TokenizerAndRendererExtension[] {
  let blockType = `bfm${capitalize(keyword)}Block`;
  let inlineType = `bfm${capitalize(keyword)}Inline`;
  let colonKeyword = `:${keyword}[`;
  let doubleColonKeyword = `::${keyword}[`;

  return [
    {
      name: blockType,
      level: 'block',
      start(src: string) {
        let re = new RegExp(`^${escapeRegExp(doubleColonKeyword)}`, 'm');
        let match = src.match(re);
        return match?.index;
      },
      tokenizer(src: string) {
        let re = new RegExp(
          `^::${escapeRegExp(keyword)}\\[([^\\]]+)\\]\\s*(?:\\n|$)`,
        );
        let match = src.match(re);
        if (match) {
          let { url, specifier } = splitBfmContent(match[1]);
          return {
            type: blockType,
            raw: match[0],
            url,
            specifier,
          };
        }
        return undefined;
      },
      renderer(token) {
        let url = escapeHtml((token as any).url);
        let specifier: string | undefined = (token as any).specifier;
        let attrs =
          `data-boxel-bfm-block-ref="${url}" data-boxel-bfm-type="${keyword}"` +
          bfmSizeAttrs(specifier);
        return `<div ${attrs}>${url}</div>\n`;
      },
    },
    {
      name: inlineType,
      level: 'inline',
      start(src: string) {
        let idx = 0;
        while (idx < src.length) {
          let pos = src.indexOf(colonKeyword, idx);
          if (pos === -1) return undefined;
          // Skip if preceded by ':' (block syntax ::keyword[)
          if (pos > 0 && src[pos - 1] === ':') {
            idx = pos + 1;
            continue;
          }
          return pos;
        }
        return undefined;
      },
      tokenizer(src: string) {
        let re = new RegExp(`^:${escapeRegExp(keyword)}\\[([^\\]]+)\\]`);
        let match = src.match(re);
        if (match) {
          let { url, specifier } = splitBfmContent(match[1]);
          return {
            type: inlineType,
            raw: match[0],
            url,
            specifier,
          };
        }
        return undefined;
      },
      renderer(token) {
        let url = escapeHtml((token as any).url);
        let specifier: string | undefined = (token as any).specifier;
        let attrs =
          `data-boxel-bfm-inline-ref="${url}" data-boxel-bfm-type="${keyword}"` +
          bfmSizeAttrs(specifier);
        return `<span ${attrs}>${url}</span>`;
      },
    },
  ];
}

/**
 * Returns marked extensions for the default set of BFM keywords.
 * Currently registers 'card'. Add new keywords here as they are introduced.
 */
export function bfmCardReferenceExtensions(): TokenizerAndRendererExtension[] {
  return bfmExtensionsForKeyword('card');
}

/**
 * Extracts a human-readable card type name from a card URL or path.
 *
 * Card URLs follow the pattern `<base>/<TypeName>/<id>`, so the type name is
 * the second-to-last path segment. The last segment is typically a UUID or
 * slug and is not human-readable.
 *
 * Examples:
 *  - `https://example.com/Pet/a3b2c1d4-...` → `"Pet"`
 *  - `./Author/jane-doe`                    → `"Author"`
 *  - `./BlogPost/some-id.json`              → `"BlogPost"`
 *  - `./Foo`                                → `"Foo"`
 *  - `""`                                   → `"Card"`
 */
export function cardTypeName(url: string): string {
  let path = url;

  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL; treat as a path/reference string.
  }

  let cleaned = path
    .split(/[?#]/, 1)[0]
    .replace(/\/+$/, '')
    .replace(/\.json$/, '');
  let segments = cleaned.split('/').filter((s) => s && s !== '.' && s !== '..');
  if (segments.length >= 2) {
    return segments[segments.length - 2];
  }
  if (segments.length === 1) {
    return segments[0];
  }
  return 'Card';
}

/**
 * Extracts a human-readable file name from a `:file[URL]` reference.
 *
 * Unlike card URLs (`<base>/<TypeName>/<id>`, whose human-readable label is the
 * second-to-last segment), a file reference's label is its file name — the last
 * path segment.
 *
 * Examples:
 *  - `https://example.com/path/photo.jpg` → `"photo.jpg"`
 *  - `./assets/data.csv`                  → `"data.csv"`
 *  - `""`                                 → `"File"`
 */
export function fileNameFromUrl(url: string): string {
  let path = url;

  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL; treat as a path/reference string.
  }

  let cleaned = path.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  let segments = cleaned.split('/').filter((s) => s && s !== '.' && s !== '..');
  return segments.length ? segments[segments.length - 1] : 'File';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
