// Pretui — the streaming projection behind MarkdownStream: a fence-aware
// block splitter, an incremental projector, and a tail healer. Pure
// functions, no DOM, no markdown engine (Law 9): turning a block's markdown
// into HTML is the caller's renderer's job. What this module decides is
// where blocks begin and end, which of them are finished, and how to make a
// half-written tail render sensibly. The split is line-based, so the kit
// carries no markdown parser.

export type BlockKind = 'text' | 'code' | 'directive';
export type BlockMode = 'frozen' | 'live';
/** `markdown` is CommonMark/GFM; `bfm` is Boxel Flavored Markdown, which
 * adds `$`/`$$` math, `:card[…]`/`:file[…]` references (inline and, with
 * `::`, block) and treats Mermaid fences as diagrams. */
export type MarkdownFlavor = 'markdown' | 'bfm';

export interface ProjectedBlock {
  /** stable across updates: the block's start offset plus its kind */
  key: string;
  /** offset of the block's first character in the full text */
  start: number;
  kind: BlockKind;
  /** the block's markdown exactly as written */
  raw: string;
  mode: BlockMode;
  /** code blocks: the source between the fences */
  source?: string;
  /** code blocks: the info string's first word */
  language?: string;
  /** code blocks: whether the closing fence has arrived */
  complete?: boolean;
  /** directive blocks */
  directive?: Directive;
  /** bfm text blocks: a `$$` display-math block whose closing `$$` has not
   * arrived. It must not reach the renderer half-written. */
  pendingMath?: boolean;
}

export interface Directive {
  name: string;
  /** the text inside the brackets before the first `|` */
  body: string;
  /** the `|`-separated arguments after it, trimmed */
  args: string[];
  /** false while the closing `]` has not arrived (bfm references only) */
  complete: boolean;
}

export interface Projection {
  text: string;
  blocks: ProjectedBlock[];
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const DIRECTIVE = /^::([A-Za-z][\w-]*)\[(.*)\]\s*$/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])\s/;
const CONTINUATION = /^( {2,}|\t)\S/;
const MATH_OPEN = /^ {0,3}\$\$/;
const PARTIAL_REF = /^::(card|file)\[([^\]\n]*)$/;

/** Parse `::name[body | arg | arg]`. */
export function parseDirective(line: string): Directive | undefined {
  let match = DIRECTIVE.exec(line);
  if (!match) {
    return undefined;
  }
  let [body = '', ...args] = match[2]!.split('|').map((part) => part.trim());
  return { name: match[1]!, body, args, complete: true };
}

interface Line {
  text: string;
  start: number;
}

function linesOf(text: string, offset: number): Line[] {
  let lines: Line[] = [];
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) {
      if (start < text.length) {
        lines.push({ text: text.slice(start), start: offset + start });
      }
      break;
    }
    lines.push({ text: text.slice(start, end), start: offset + start });
    start = end + 1;
  }
  return lines;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/**
 * Split `text` (which starts at `offset` in the full message) into blocks.
 * Every block is returned `frozen`; the projector decides which is live.
 */
export function splitBlocks(
  text: string,
  offset = 0,
  flavor: MarkdownFlavor = 'markdown',
): ProjectedBlock[] {
  let bfm = flavor === 'bfm';
  let lines = linesOf(text, offset);
  let blocks: ProjectedBlock[] = [];
  let i = 0;
  let sliceRaw = (from: number, to: number) =>
    text.slice(from - offset, to - offset);

  while (i < lines.length) {
    let line = lines[i]!;
    if (isBlank(line.text)) {
      i++;
      continue;
    }

    let fence = FENCE_OPEN.exec(line.text);
    if (fence) {
      let marker = fence[1]!;
      let close = new RegExp(
        `^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`,
      );
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j]!.text)) {
        j++;
      }
      let complete = j < lines.length;
      let bodyLines = lines.slice(i + 1, j).map((l) => l.text);
      let last = complete ? lines[j]! : lines[lines.length - 1]!;
      let end = last.start + last.text.length;
      // an open fence's source keeps its trailing newline state as typed, so
      // the code grows by exactly the appended characters
      let source = complete
        ? bodyLines.join('\n')
        : text.slice(
            Math.min(line.start + line.text.length + 1, offset + text.length) -
              offset,
          );
      blocks.push({
        key: `${line.start}:code`,
        start: line.start,
        kind: 'code',
        raw: sliceRaw(line.start, end),
        mode: 'frozen',
        source,
        language: fence[2]!.trim().split(/\s+/, 1)[0] || undefined,
        complete,
      });
      i = complete ? j + 1 : lines.length;
      continue;
    }

    // bfm display math: `$$` to the line ending in `$$`, blank lines included,
    // so a formula is never cut into separately rendered pieces
    if (bfm && MATH_OPEN.test(line.text)) {
      let single =
        line.text.trim().length > 2 && line.text.trim().endsWith('$$');
      let j = i;
      if (!single) {
        j = i + 1;
        while (j < lines.length && !lines[j]!.text.trim().endsWith('$$')) {
          j++;
        }
      }
      let closed = j < lines.length;
      let last = closed ? lines[j]! : lines[lines.length - 1]!;
      blocks.push({
        key: `${line.start}:text`,
        start: line.start,
        kind: 'text',
        raw: sliceRaw(line.start, last.start + last.text.length),
        mode: 'frozen',
        pendingMath: !closed,
      });
      i = closed ? j + 1 : lines.length;
      continue;
    }

    // a bfm block reference still arriving: the last line, no closing `]`
    let partial =
      bfm && i === lines.length - 1 ? PARTIAL_REF.exec(line.text) : null;
    if (partial) {
      let [body = '', ...args] = partial[2]!.split('|').map((p) => p.trim());
      blocks.push({
        key: `${line.start}:directive`,
        start: line.start,
        kind: 'directive',
        raw: line.text,
        mode: 'frozen',
        directive: { name: partial[1]!, body, args, complete: false },
      });
      i++;
      continue;
    }

    let directive = parseDirective(line.text);
    if (directive) {
      blocks.push({
        key: `${line.start}:directive`,
        start: line.start,
        kind: 'directive',
        raw: line.text,
        mode: 'frozen',
        directive,
      });
      i++;
      continue;
    }

    if (HEADING.test(line.text)) {
      blocks.push({
        key: `${line.start}:text`,
        start: line.start,
        kind: 'text',
        raw: line.text,
        mode: 'frozen',
      });
      i++;
      continue;
    }

    // A text block runs to a blank line, a fence, a directive or a heading.
    // A list keeps going across a blank line when the next line is another
    // item or an indented continuation, so a loose list stays one block.
    let isList = LIST_ITEM.test(line.text);
    let j = i + 1;
    while (j < lines.length) {
      let next = lines[j]!.text;
      if (
        FENCE_OPEN.test(next) ||
        DIRECTIVE.test(next) ||
        HEADING.test(next) ||
        (bfm && (MATH_OPEN.test(next) || PARTIAL_REF.test(next)))
      ) {
        break;
      }
      if (isBlank(next)) {
        let after = lines[j + 1]?.text;
        if (
          isList &&
          after !== undefined &&
          (LIST_ITEM.test(after) || CONTINUATION.test(after))
        ) {
          j++;
          continue;
        }
        break;
      }
      j++;
    }
    let last = lines[j - 1]!;
    blocks.push({
      key: `${line.start}:text`,
      start: line.start,
      kind: 'text',
      raw: sliceRaw(line.start, last.start + last.text.length),
      mode: 'frozen',
    });
    i = j;
  }
  return blocks;
}

function markLive(
  blocks: ProjectedBlock[],
  streaming: boolean,
): ProjectedBlock[] {
  if (!streaming || blocks.length === 0) {
    return blocks;
  }
  let last = blocks[blocks.length - 1]!;
  // an open fence grows by appending; a closed one is finished
  if (last.kind === 'code') {
    return blocks;
  }
  return [...blocks.slice(0, -1), { ...last, mode: 'live' }];
}

/**
 * Project `text` into blocks, reusing `previous` where the new text extends
 * it: only the region from the previous last block onwards is re-split, so
 * an update costs the tail, not the whole message.
 */
export function project(
  previous: Projection | undefined,
  text: string,
  streaming: boolean,
  flavor: MarkdownFlavor = 'markdown',
): Projection {
  if (
    previous &&
    previous.blocks.length > 0 &&
    text.startsWith(previous.text)
  ) {
    let tailStart = previous.blocks[previous.blocks.length - 1]!.start;
    let kept = previous.blocks
      .slice(0, -1)
      .map((block) =>
        block.mode === 'frozen' ? block : { ...block, mode: 'frozen' as const },
      );
    let tail = splitBlocks(text.slice(tailStart), tailStart, flavor);
    return { text, blocks: markLive([...kept, ...tail], streaming) };
  }
  return { text, blocks: markLive(splitBlocks(text, 0, flavor), streaming) };
}

// ── healing ──────────────────────────────────────────────────────────────

const INLINE_CODE = /`[^`\n]*`/g;

/**
 * Make a half-written block render sensibly: close unbalanced inline code
 * and emphasis, and reduce an unterminated link to its text. Only ever
 * applied to the live tail; the raw text is what freezes.
 */
export function heal(src: string): string {
  let out = src;

  // an image or link whose URL is still arriving: keep the text, drop the rest
  out = out.replace(/!\[([^\]\n]*)\]\([^)\n]*$/, '$1');
  out = out.replace(/\[([^\]\n]*)\]\([^)\n]*$/, '$1');
  out = out.replace(/!?\[([^\]\n]*)$/, '$1');

  // an odd number of single backticks: the last code span is still open
  let ticks = (out.match(/`/g) ?? []).length;
  if (ticks % 2 === 1) {
    return `${out}\``;
  }

  // emphasis markers outside code spans, closed innermost (latest) first
  let bare = out.replace(INLINE_CODE, (span) => ' '.repeat(span.length));
  let open: { marker: string; at: number }[] = [];
  for (let marker of ['**', '__', '~~']) {
    let positions: number[] = [];
    let index = bare.indexOf(marker);
    while (index !== -1) {
      positions.push(index);
      index = bare.indexOf(marker, index + marker.length);
    }
    if (positions.length % 2 === 1) {
      open.push({ marker, at: positions[positions.length - 1]! });
    }
  }
  // a single `*` that is not a list bullet and not part of `**`
  let singles: number[] = [];
  let withoutDoubles = bare.replace(/\*\*/g, '  ');
  for (let i = 0; i < withoutDoubles.length; i++) {
    if (withoutDoubles[i] !== '*') {
      continue;
    }
    let lineStart = withoutDoubles.lastIndexOf('\n', i - 1) + 1;
    let isBullet =
      withoutDoubles.slice(lineStart, i).trim() === '' &&
      withoutDoubles[i + 1] === ' ';
    if (!isBullet) {
      singles.push(i);
    }
  }
  if (singles.length % 2 === 1) {
    open.push({ marker: '*', at: singles[singles.length - 1]! });
  }
  open.sort((a, b) => b.at - a.at);
  return out + open.map((o) => o.marker).join('');
}

/**
 * BFM's additions to healing, applied before `heal`: an inline `:card[` or
 * `:file[` reference whose `]` has not arrived renders as nothing yet (a
 * half-written URL is neither text nor a card), and a lone unclosed `$` is
 * escaped so it renders as a dollar sign rather than an open formula.
 */
export function healBfm(src: string): string {
  let out = src.replace(/(^|[^:]):(?:card|file)\[[^\]\n]*$/, '$1');
  let bare = out.replace(INLINE_CODE, (span) => ' '.repeat(span.length));
  let singles: number[] = [];
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] !== '$' || bare[i - 1] === '\\') {
      continue;
    }
    if (bare[i + 1] === '$' || bare[i - 1] === '$') {
      continue;
    }
    singles.push(i);
  }
  if (singles.length % 2 === 1) {
    let at = singles[singles.length - 1]!;
    out = `${out.slice(0, at)}\\${out.slice(at)}`;
  }
  return out;
}

const DEFINITION = /^ {0,3}\[(\^?)[^\]\n]+\]:[ \t]*\S.*$/gm;

/**
 * Every link-reference and footnote definition in the document, one per
 * line. A block rendered on its own cannot see definitions that live in
 * another block, so the renderer receives them as context.
 */
export function collectDefinitions(text: string): string {
  return (text.match(DEFINITION) ?? []).join('\n');
}

// ── links ────────────────────────────────────────────────────────────────

const PATH_LIKE =
  /^(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z0-9]{1,8}(?::\d+(?:-\d+)?)?(?:#L\d+(?:-L?\d+)?)?$/;

/** Whether inline code text looks like a file path worth resolving:
 * `src/a.gts`, `a.gts:42`, `card.json#L4-L9`. */
export function isPathLike(text: string): boolean {
  let trimmed = text.trim();
  return trimmed.length > 2 && trimmed.length < 300 && PATH_LIKE.test(trimmed);
}

/** Whether an href leaves the app (and so needs no lookup). */
export function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

// ── default rendering ────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The renderer used when the caller supplies none: the text escaped, one
 * paragraph per block, line breaks kept. Safe by construction. */
export function renderPlain(src: string): string {
  return `<p>${escapeHtml(src).replace(/\n/g, '<br>')}</p>`;
}
