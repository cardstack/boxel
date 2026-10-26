// Pretui — DiffBlock: a before/after change rendered as a line diff, syntax-highlighted when it knows the language.
import Component from '@glimmer/component';
import CheckIcon from '@cardstack/boxel-icons/check';
import { cached, tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import { DiffStat } from './diff-stat';
import { languageForFilename, tokenizeCode } from './code-block';
import type { CodeToken } from './code-block';

export interface DiffLine {
  op?: 'add' | 'del';
  text: string;
  /** this line stands for that many unchanged lines left out between two
   * hunks; `text` is ignored */
  skip?: number;
  /** the line's number: in the new file, or the old one for a removal */
  n?: number;
}

// Above this many cells the middle of a diff is not aligned line by line: it
// reads as everything removed, then everything added. A file the runner
// rewrites wholesale says so honestly, and the tab never stalls on it.
const MAX_DIFF_CELLS = 4_000_000;

function splitLines(text: string | undefined): string[] {
  if (!text) {
    return [];
  }
  let lines = text.split('\n');
  // a trailing newline ends the last line; it does not start another
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * The lines that changed from `before` to `after`, with `context` unchanged
 * lines around each change and a `skip` line for each run left out. An
 * absent `before` is a new file: every line is added.
 *
 * Common lines at either end are trimmed before the middle is aligned by
 * longest common subsequence, so an edit to a long file costs its changed
 * region, not the whole file.
 */
export function lineDiff(
  before: string | undefined,
  after: string | undefined,
  options: { context?: number } = {},
): DiffLine[] {
  let context = Math.max(0, options.context ?? 3);
  let a = splitLines(before);
  let b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  let middle: DiffLine[] = [];
  let n = endA - start;
  let m = endB - start;
  if (n * m > MAX_DIFF_CELLS) {
    for (let i = start; i < endA; i++) {
      middle.push({ op: 'del', text: a[i]! });
    }
    for (let j = start; j < endB; j++) {
      middle.push({ op: 'add', text: b[j]! });
    }
  } else {
    // lcs[i][j]: the longest common run of a[start+i..] and b[start+j..]
    let width = m + 1;
    let lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] =
          a[start + i] === b[start + j]
            ? lcs[(i + 1) * width + j + 1]! + 1
            : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        middle.push({ text: a[start + i]! });
        i++;
        j++;
      } else if (
        i < n &&
        (j === m || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)
      ) {
        // a removal reads before the line that replaces it
        middle.push({ op: 'del', text: a[start + i]! });
        i++;
      } else {
        middle.push({ op: 'add', text: b[start + j]! });
        j++;
      }
    }
  }
  if (!middle.some((line) => line.op)) {
    return [];
  }
  let all: DiffLine[] = [
    ...a.slice(0, start).map((text) => ({ text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ text })),
  ];
  let oldN = 0;
  let newN = 0;
  for (let line of all) {
    if (line.op === 'del') {
      line.n = ++oldN;
    } else if (line.op === 'add') {
      line.n = ++newN;
    } else {
      oldN++;
      line.n = ++newN;
    }
  }
  // keep each unchanged line within `context` of a change; fold the rest
  let keep = all.map(() => false);
  all.forEach((line, index) => {
    if (line.op) {
      for (
        let k = Math.max(0, index - context);
        k <= Math.min(all.length - 1, index + context);
        k++
      ) {
        keep[k] = true;
      }
    }
  });
  let out: DiffLine[] = [];
  let skipped = 0;
  all.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) {
        out.push({ text: '', skip: skipped });
        skipped = 0;
      }
      out.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped) {
    out.push({ text: '', skip: skipped });
  }
  return out;
}


/** which file a line number counts in: the old file for a removed line, the
 * new file for an added or unchanged one */
export type DiffSide = 'old' | 'new';

export interface DiffBlockSignature {
  Args: {
    lines: DiffLine[];
    receipt?: string;
    maxLines?: number;
    /** highlight each line with CodeBlock's grammar for this language */
    language?: string;
    /** shown as a header with the change counts; also guesses the
     * language when @language is absent */
    filename?: string;
    /** the collapsed toggle's verb, before its count: 'Show all' reads
     * "Show all · 14 more lines". Default: "14 more lines" */
    expandLabel?: string;
    /** a gutter with each line's number, where the lines carry one */
    lineNumbers?: boolean;
    /** review a hunk at a time: each hunk gets Keep and Revert on its bar */
    onKeepHunk?: (hunk: DiffHunk) => unknown;
    onRevertHunk?: (hunk: DiffHunk) => unknown;
    /** what was decided per hunk, by index: a kept hunk says so, a
     * reverted one is struck */
    hunkStates?: Record<number, DiffHunkState>;
    /** comments on lines, shown under their line */
    comments?: DiffComment[];
    /** with it, a line's number is a button that opens a comment there.
     * `side` says which file `line` counts in, so a removed line and the
     * added line that replaces it, which can share a number, stay apart */
    onComment?: (line: number, text: string, side: DiffSide) => unknown;
    /** 'unified' (default), 'split' (old left, new right), or 'auto':
     * split once the block is 640px wide. Both views carry the same review
     * controls and comments */
    view?: 'unified' | 'split' | 'auto';
    /** soft-wrap long lines instead of scrolling them */
    wrap?: boolean;
    /** above this many characters the diff is not drawn until asked:
     * "Large diff · 12,400 lines · Render anyway" */
    maxBytes?: number;
  };
  Element: HTMLDivElement;
}

interface ShownLine {
  /** the line's index in @lines */
  index: number;
  op?: 'add' | 'del';
  n?: number;
  side: DiffSide;
  sign: string;
  tokens: CodeToken[];
  skip?: string;
}

function skipText(count: number): string {
  return `${count} unchanged ${count === 1 ? 'line' : 'lines'}`;
}

/** a run of changed lines between two skips: what Keep and Revert act on */
export interface DiffHunk {
  index: number;
  /** the first and last line of the hunk, as indexes into the lines */
  start: number;
  end: number;
  added: number;
  removed: number;
}

/** the hunks of a diff: the runs of lines between skip lines that change
 * something */
export function diffHunks(lines: DiffLine[]): DiffHunk[] {
  let hunks: DiffHunk[] = [];
  let start = -1;
  let flush = (end: number) => {
    if (start < 0) {
      return;
    }
    let run = lines.slice(start, end + 1);
    let added = run.filter((l) => l.op === 'add').length;
    let removed = run.filter((l) => l.op === 'del').length;
    if (added || removed) {
      hunks.push({ index: hunks.length, start, end, added, removed });
    }
    start = -1;
  };
  lines.forEach((line, i) => {
    if (line.skip) {
      flush(i - 1);
    } else if (start < 0) {
      start = i;
    }
  });
  flush(lines.length - 1);
  return hunks;
}

export interface DiffComment {
  /** the line it is on, numbered in the file `side` names */
  line: number;
  /** 'old' for a comment on a removed line; 'new' (the default) for an
   * added or unchanged one */
  side?: DiffSide;
  author: string;
  text: string;
}

export type DiffHunkState = 'kept' | 'reverted';

/** one line's place in a row: the whole row in the unified view, one half
 * of it in the split view */
interface DiffCell {
  line?: ShownLine;
  /** whether the line's number opens a comment and its comments show here.
   * In the split view an unchanged line shows on both halves, and only the
   * new half carries its comments */
  commentable: boolean;
}

interface DiffRow {
  key: string;
  /** the hunk whose bar sits above this row, when hunks are reviewed */
  hunk?: DiffHunk;
  skip?: string;
  cells: DiffCell[];
}

// Staged change with an immutable receipt line; long diffs collapse.
export class DiffBlock extends Component<DiffBlockSignature> {
  @tracked collapsed = true;
  @tracked renderAnyway = false;
  @tracked wide = false;
  @tracked commentingOn: { side: DiffSide; n: number } | undefined;
  @tracked commentDraft = '';
  /** the hunk whose Keep or Revert was just pressed: its decision takes the
   * focus the removed button held */
  private focusHunk: number | undefined;
  /** the line number that opened the comment editor, to take focus back */
  private commentOpener: HTMLElement | undefined;

  get tooLarge(): boolean {
    let max = this.args.maxBytes;
    if (!max || this.renderAnyway) {
      return false;
    }
    let size = 0;
    for (let line of this.args.lines) {
      size += line.text.length + 1;
      if (size > max) {
        return true;
      }
    }
    return false;
  }
  get largeLabel(): string {
    let n = this.args.lines.length;
    return `Large diff · ${n.toLocaleString()} ${n === 1 ? 'line' : 'lines'}`;
  }
  showLarge = () => (this.renderAnyway = true);

  get split(): boolean {
    let view = this.args.view ?? 'unified';
    return view === 'split' || (view === 'auto' && this.wide);
  }
  // 'auto' measures its own width: split from 640px
  watchWidth = modifier(
    (element: HTMLElement, [view]: [string | undefined]) => {
      if (view !== 'auto' || typeof ResizeObserver !== 'function') {
        return;
      }
      let observer = new ResizeObserver(([entry]) => {
        let wide = (entry?.contentRect.width ?? 0) >= 640;
        if (wide !== this.wide) {
          this.wide = wide;
        }
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
  );

  @cached
  get hunks(): DiffHunk[] {
    return diffHunks(this.args.lines);
  }
  get reviews(): boolean {
    return Boolean(this.args.onKeepHunk || this.args.onRevertHunk);
  }
  /** the hunk that starts at a line index, for its bar */
  private hunkAt(index: number): DiffHunk | undefined {
    return this.reviews
      ? this.hunks.find((h) => h.start === index)
      : undefined;
  }
  private hunkOf(index: number): DiffHunk | undefined {
    return this.hunks.find((h) => index >= h.start && index <= h.end);
  }
  stateOf = (hunk: DiffHunk) => this.args.hunkStates?.[hunk.index];
  isKept = (hunk: DiffHunk) => this.stateOf(hunk) === 'kept';
  lineState = (line: ShownLine) => {
    let hunk = this.hunkOf(line.index);
    return hunk ? this.stateOf(hunk) : undefined;
  };
  hunkLabel = (hunk: DiffHunk) =>
    `Change ${hunk.index + 1} of ${this.hunks.length} · +${hunk.added} −${hunk.removed}`;
  keepHunk = (hunk: DiffHunk) => {
    this.focusHunk = hunk.index;
    return this.args.onKeepHunk?.(hunk);
  };
  revertHunk = (hunk: DiffHunk) => {
    this.focusHunk = hunk.index;
    return this.args.onRevertHunk?.(hunk);
  };
  /** a decision replaces the Keep and Revert buttons; when one of them had
   * focus, the decision takes it, so the keyboard keeps its place */
  claimHunkFocus = modifier((element: HTMLElement, [index]: [number]) => {
    if (this.focusHunk !== index) {
      return;
    }
    this.focusHunk = undefined;
    let active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      element.focus({ preventScroll: true });
    }
  });

  commentsOn = (line: ShownLine) =>
    (this.args.comments ?? []).filter(
      (c) => c.line === line.n && (c.side ?? 'new') === line.side,
    );
  isCommenting = (line: ShownLine) =>
    this.commentingOn !== undefined &&
    this.commentingOn.n === line.n &&
    this.commentingOn.side === line.side;
  commentLabel = (line: ShownLine) =>
    line.side === 'old'
      ? `Comment on removed line ${line.n}`
      : `Comment on line ${line.n}`;
  openComment = (line: ShownLine, event: Event) => {
    if (line.n === undefined) {
      return;
    }
    this.commentOpener = event.currentTarget as HTMLElement;
    this.commentingOn = { side: line.side, n: line.n };
    this.commentDraft = '';
  };
  typeComment = (event: Event) =>
    (this.commentDraft = (event.target as HTMLTextAreaElement).value);
  private closeComment() {
    this.commentingOn = undefined;
    let opener = this.commentOpener;
    this.commentOpener = undefined;
    if (opener?.isConnected) {
      opener.focus({ preventScroll: true });
    }
  }
  cancelComment = () => this.closeComment();
  saveComment = async () => {
    let target = this.commentingOn;
    let text = this.commentDraft.trim();
    if (target && text) {
      await this.args.onComment?.(target.n, text, target.side);
    }
    this.closeComment();
  };
  commentKey = (e: Event) => {
    let event = e as KeyboardEvent;
    if (event.key === 'Escape') {
      // the editor handles Escape; a host listening for it must not also act
      event.stopPropagation();
      this.cancelComment();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.saveComment();
    }
  };
  focusComment = modifier((element: HTMLTextAreaElement) => element.focus());

  /** The rows either view draws. Unified: one line per row. Split: removals
   * on the left and additions on the right, paired within each change, and
   * unchanged lines on both sides. A hunk's bar sits above the row its first
   * line is in. */
  @cached
  get rows(): DiffRow[] {
    let rows: DiffRow[] = [];
    let hunkFor = (...lines: (ShownLine | undefined)[]) => {
      for (let line of lines) {
        let hunk = line ? this.hunkAt(line.index) : undefined;
        if (hunk) {
          return hunk;
        }
      }
      return undefined;
    };
    if (!this.split) {
      for (let line of this.shown) {
        rows.push(
          line.skip
            ? { key: `s${line.index}`, skip: line.skip, cells: [] }
            : {
                key: `l${line.index}`,
                hunk: hunkFor(line),
                cells: [{ line, commentable: true }],
              },
        );
      }
      return rows;
    }
    let dels: ShownLine[] = [];
    let adds: ShownLine[] = [];
    let flush = () => {
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        let left = dels[k];
        let right = adds[k];
        rows.push({
          key: `p${(left ?? right)!.index}`,
          // a pending hunk opens with a removal or an addition: whichever
          // comes first in the file
          hunk: hunkFor(left, right),
          cells: [
            { line: left, commentable: true },
            { line: right, commentable: true },
          ],
        });
      }
      dels = [];
      adds = [];
    };
    for (let line of this.shown) {
      if (line.skip) {
        flush();
        rows.push({ key: `s${line.index}`, skip: line.skip, cells: [] });
      } else if (line.op === 'del') {
        dels.push(line);
      } else if (line.op === 'add') {
        adds.push(line);
      } else {
        flush();
        rows.push({
          key: `c${line.index}`,
          hunk: hunkFor(line),
          cells: [
            { line, commentable: false },
            { line, commentable: true },
          ],
        });
      }
    }
    flush();
    return rows;
  }
  get maxLines() {
    return this.args.maxLines ?? 8;
  }
  get overflows() {
    return this.args.lines.length > this.maxLines;
  }
  get language(): string | undefined {
    return this.args.language ?? languageForFilename(this.args.filename);
  }
  @cached
  get shown(): ShownLine[] {
    let lines =
      this.collapsed && this.overflows
        ? this.args.lines.slice(0, this.maxLines)
        : this.args.lines;
    let language = this.language;
    // Each line is tokenized on its own: a diff shows fragments, and a
    // fragment that opens a string or comment must not colour the lines
    // after it.
    return lines.map((line, index): ShownLine => {
      let side: DiffSide = line.op === 'del' ? 'old' : 'new';
      return line.skip
        ? { index, side, sign: '', tokens: [], skip: skipText(line.skip) }
        : {
            index,
            op: line.op,
            n: line.n,
            side,
            sign: line.op === 'add' ? '+ ' : line.op === 'del' ? '- ' : '  ',
            tokens: tokenizeCode(line.text, language),
          };
    });
  }
  get added(): number {
    return this.args.lines.filter((line) => line.op === 'add' && !line.skip)
      .length;
  }
  get removed(): number {
    return this.args.lines.filter((line) => line.op === 'del').length;
  }
  get toggleLabel() {
    if (!this.collapsed) {
      return 'collapse';
    }
    let hidden = this.args.lines.length - this.maxLines;
    let more = `${hidden} more ${hidden === 1 ? 'line' : 'lines'}`;
    return this.args.expandLabel ? `${this.args.expandLabel} · ${more}` : more;
  }
  get toggleExpanded() {
    return this.collapsed ? 'false' : 'true';
  }
  toggle = () => {
    this.collapsed = !this.collapsed;
  };
  <template>
    <div
      class='pretui-diff'
      data-language={{this.language}}
      data-numbered={{if @lineNumbers 'true'}}
      data-wrap={{if @wrap 'true'}}
      data-view={{if this.split 'split' 'unified'}}
      {{this.watchWidth @view}}
      data-test-pretui-diff-block
      ...attributes
    >
      {{#if @filename}}
        <div class='pretui-diff-head' data-test-pretui-diff-head>
          <span class='pretui-diff-file'>{{@filename}}</span>
          {{! the change's size at a glance, as DiffStat draws it }}
          <DiffStat
            class='pretui-diff-counts'
            @added={{this.added}}
            @removed={{this.removed}}
          />
        </div>
      {{/if}}
      {{#if this.tooLarge}}
        <div class='pretui-diff-large' data-test-pretui-diff-large>
          <span>{{this.largeLabel}}</span>
          <button
            type='button'
            class='pretui-diff-action'
            {{on 'click' this.showLarge}}
            data-test-pretui-diff-render-anyway
          >Render anyway</button>
        </div>
      {{else}}
        {{#each this.rows key='key' as |row|}}
          {{#if row.hunk}}
            {{#let row.hunk as |hunk|}}
              <div
                class='pretui-diff-hunk'
                data-state={{this.stateOf hunk}}
                data-test-pretui-diff-hunk={{hunk.index}}
              >
                <span class='pretui-diff-hunk-label'>{{this.hunkLabel
                    hunk
                  }}</span>
                {{#if (this.stateOf hunk)}}
                  <span
                    class='pretui-diff-hunk-state'
                    tabindex='-1'
                    {{this.claimHunkFocus hunk.index}}
                    data-test-pretui-diff-hunk-state={{hunk.index}}
                  >{{#if (this.isKept hunk)}}<CheckIcon
                        width='11'
                        height='11'
                        aria-hidden='true'
                      />{{/if}}{{this.stateOf hunk}}</span>
                {{else}}
                  {{#if @onKeepHunk}}<button
                      type='button'
                      class='pretui-diff-action'
                      {{on 'click' (fn this.keepHunk hunk)}}
                      data-test-pretui-diff-keep={{hunk.index}}
                    >Keep</button>{{/if}}
                  {{#if @onRevertHunk}}<button
                      type='button'
                      class='pretui-diff-action'
                      data-kind='quiet'
                      {{on 'click' (fn this.revertHunk hunk)}}
                      data-test-pretui-diff-revert={{hunk.index}}
                    >Revert</button>{{/if}}
                {{/if}}
              </div>
            {{/let}}
          {{/if}}
          {{#if row.skip}}
            <div
              class='pretui-diff-line pretui-diff-skip'
              data-skip
              data-test-pretui-diff-skip
            >{{row.skip}}</div>
          {{else}}
            <div class='pretui-diff-row' data-test-pretui-diff-row>
              {{#each row.cells as |cell|}}
                <div
                  class='pretui-diff-cell'
                  data-side={{if cell.line cell.line.side}}
                  data-test-pretui-diff-cell
                >
                  {{#if cell.line}}
                    {{#let cell.line as |line|}}
                      <div
                        class='pretui-diff-line'
                        data-op={{line.op}}
                        data-state={{this.lineState line}}
                        data-test-pretui-diff-line
                      >{{#if @lineNumbers}}{{#if
                            (if @onComment cell.commentable false)
                          }}<button
                              type='button'
                              class='pretui-diff-n'
                              aria-label={{this.commentLabel line}}
                              {{on 'click' (fn this.openComment line)}}
                              data-test-pretui-diff-comment-on='{{line.side}}:{{line.n}}'
                            >{{line.n}}</button>{{else}}<span
                              class='pretui-diff-n'
                              aria-hidden='true'
                            >{{line.n}}</span>{{/if}}{{/if}}<span
                          class='pretui-diff-sign'
                        >{{line.sign}}</span>{{#each
                          line.tokens key='@index'
                          as |part|
                        }}<span
                            class={{part.cls}}
                          >{{part.text}}</span>{{/each}}</div>
                      {{#if cell.commentable}}
                        {{#each (this.commentsOn line) as |comment|}}
                          <div
                            class='pretui-diff-comment'
                            data-test-pretui-diff-comment='{{line.side}}:{{comment.line}}'
                          >
                            <span
                              class='pretui-diff-comment-author'
                            >{{comment.author}}</span>
                            <span
                              class='pretui-diff-comment-text'
                            >{{comment.text}}</span>
                          </div>
                        {{/each}}
                        {{#if (this.isCommenting line)}}
                          <div
                            class='pretui-diff-comment pretui-diff-comment-new'
                            data-test-pretui-diff-comment-editor='{{line.side}}:{{line.n}}'
                          >
                            <textarea
                              class='pretui-diff-comment-field'
                              aria-label={{this.commentLabel line}}
                              rows='2'
                              value={{this.commentDraft}}
                              {{on 'input' this.typeComment}}
                              {{on 'keydown' this.commentKey}}
                              {{this.focusComment}}
                              data-test-pretui-diff-comment-field
                            ></textarea>
                            <span class='pretui-diff-comment-actions'>
                              <button
                                type='button'
                                class='pretui-diff-action'
                                data-kind='quiet'
                                {{on 'click' this.cancelComment}}
                                data-test-pretui-diff-comment-cancel
                              >Cancel</button>
                              <button
                                type='button'
                                class='pretui-diff-action'
                                {{on 'click' this.saveComment}}
                                data-test-pretui-diff-comment-save
                              >Comment</button>
                            </span>
                          </div>
                        {{/if}}
                      {{/if}}
                    {{/let}}
                  {{/if}}
                </div>
              {{/each}}
            </div>
          {{/if}}
        {{/each}}
      {{/if}}
      {{#if (if this.overflows (if this.tooLarge false true))}}
        <button
          type='button'
          class='pretui-diff-line pretui-diff-toggle'
          aria-expanded={{this.toggleExpanded}}
          {{on 'click' this.toggle}}
          data-test-pretui-diff-toggle
        >{{this.toggleLabel}}</button>
      {{/if}}
      {{#if @receipt}}<div
          class='pretui-diff-receipt'
          data-test-pretui-diff-receipt
        >{{@receipt}}</div>{{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        /* a diff is pasteable: mono at the data size, on the inset well */
        .pretui-diff {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          background-color: var(--inset);
          color: var(--foreground);
          border-radius: var(--boxel-border-radius-sm);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          overflow: hidden;
        }
        .pretui-diff[data-wrap] .pretui-diff-line {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .pretui-diff[data-view='split'] .pretui-diff-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
        .pretui-diff-cell {
          min-width: 0;
        }
        .pretui-diff[data-view='split'] .pretui-diff-cell:first-child {
          box-shadow: inset -1px 0 0 var(--border);
        }
        .pretui-diff-hunk {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: 1.625rem;
          padding: 0 var(--boxel-sp-sm);
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--muted-foreground);
          box-shadow: inset 0 1px 0 var(--border);
        }
        /* "Change 1 of 3 · +2 −1" is a count, not a string to paste: sans */
        .pretui-diff-hunk-label {
          margin-inline-end: auto;
          font-variant-numeric: tabular-nums;
        }
        .pretui-diff-hunk-state {
          font-weight: 600;
        }
        .pretui-diff-hunk-state:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        /* kept is done: ink with a check, not green */
        .pretui-diff-hunk[data-state='kept'] .pretui-diff-hunk-state {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          color: var(--foreground);
        }
        .pretui-diff-line[data-state='reverted'] {
          text-decoration: line-through;
          opacity: 0.55;
        }
        .pretui-diff-action {
          height: 1.375rem;
          padding: 0 var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          box-shadow: inset 0 0 0 1px var(--border-strong);
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 400;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-diff-action[data-kind='quiet'] {
          box-shadow: none;
          color: var(--muted-foreground);
        }
        .pretui-diff-action:hover {
          color: var(--primary-ink);
        }
        .pretui-diff-action:focus-visible,
        button.pretui-diff-n:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        button.pretui-diff-n {
          padding: 0;
          border: 0;
          background-color: transparent;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          color: inherit;
          cursor: pointer;
        }
        button.pretui-diff-n:hover {
          color: var(--primary-ink);
        }
        .pretui-diff-comment {
          display: grid;
          gap: var(--boxel-sp-6xs);
          margin: var(--boxel-sp-6xs) var(--boxel-sp-xs) var(--boxel-sp-4xs)
            2.5rem;
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--card);
          box-shadow: 0 0 0 1px var(--border);
          font-family: var(--font-sans);
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--card-foreground);
          white-space: normal;
        }
        .pretui-diff-comment-author {
          font-weight: 600;
        }
        .pretui-diff-comment-field {
          width: 100%;
          box-sizing: border-box;
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-xs);
          background-color: var(--field);
          box-shadow: inset 0 0 0 1px var(--input);
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          color: var(--foreground);
          resize: vertical;
        }
        .pretui-diff-comment-actions {
          display: flex;
          justify-content: flex-end;
          gap: var(--boxel-sp-4xs);
        }
        .pretui-diff-large {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-sm);
          font-family: var(--font-sans);
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--muted-foreground);
        }
        .pretui-diff-head {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-4xs) var(--boxel-sp-sm);
          font-family: var(--font-sans);
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 400;
          box-shadow: 0 1px 0 var(--border);
        }
        /* the file is a path, a pasteable string: mono at the data size */
        .pretui-diff-file {
          min-width: 0;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
        }
        /* the counts are figures: sans, tabular */
        .pretui-diff-counts {
          display: flex;
          gap: var(--boxel-sp-4xs);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
        }
        .pretui-diff-line {
          padding: 0 var(--boxel-sp-sm);
          white-space: pre;
        }
        /* the tint is the fill, the line's text is the hue's ink */
        .pretui-diff-line[data-op='add'] {
          background-color: color-mix(
            in oklch,
            var(--success) 12%,
            transparent
          );
          color: var(--success-ink);
        }
        .pretui-diff-line[data-op='del'] {
          background-color: color-mix(
            in oklch,
            var(--destructive) 10%,
            transparent
          );
          color: var(--destructive-ink);
        }
        .pretui-diff-sign {
          user-select: none;
        }
        /* the number gutter: the line's place in the file, out of the way */
        .pretui-diff-n {
          display: inline-block;
          width: 3ch;
          margin-inline-end: 1ch;
          text-align: end;
          /* muted, not subtle: the number sits on the add and remove tints,
             where the subtle ink falls under 4.5:1 */
          color: var(--muted-foreground);
          user-select: none;
        }
        /* With a language, the tint says added or removed and the tokens
           keep their own colours, as in CodeBlock; the sign keeps the op's
           colour so the change still reads in greyscale. */
        .pretui-diff[data-language] .pretui-diff-line[data-op] {
          color: var(--foreground);
        }
        .pretui-diff[data-language]
          .pretui-diff-line[data-op='add']
          .pretui-diff-sign {
          color: var(--success-ink);
        }
        .pretui-diff[data-language]
          .pretui-diff-line[data-op='del']
          .pretui-diff-sign {
          color: var(--destructive-ink);
        }
        .pretui-code-t {
          color: inherit;
        }
        .pretui-code-comment {
          color: color-mix(
            in oklch,
            var(--foreground) 8%,
            var(--pretui-code-comment, var(--muted-foreground))
          );
          font-style: italic;
        }
        .pretui-code-string {
          color: color-mix(
            in oklch,
            var(--foreground) 18%,
            var(--pretui-code-string, var(--chart-1))
          );
        }
        .pretui-code-number {
          color: color-mix(
            in oklch,
            var(--foreground) 18%,
            var(--pretui-code-number, var(--chart-3))
          );
        }
        .pretui-code-keyword {
          color: color-mix(
            in oklch,
            var(--foreground) 18%,
            var(--pretui-code-keyword, var(--chart-4))
          );
          font-weight: 400;
        }
        .pretui-code-name {
          color: color-mix(
            in oklch,
            var(--foreground) 18%,
            var(--pretui-code-name, var(--chart-2))
          );
        }
        .pretui-code-punct {
          color: color-mix(
            in oklch,
            var(--muted-foreground) 70%,
            var(--foreground)
          );
        }
        .pretui-diff-toggle {
          display: block;
          width: 100%;
          text-align: left;
          border: 0;
          background-color: transparent;
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
          color: var(--primary-ink);
          cursor: pointer;
        }
        /* the unchanged run between two hunks: a quiet gap, never a line
           of the file */
        .pretui-diff-skip {
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--muted-foreground);
          background-color: color-mix(in oklch, var(--border) 35%, transparent);
          user-select: none;
        }
        .pretui-diff-receipt {
          padding: var(--boxel-sp-4xs) var(--boxel-sp-sm);
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
          color: var(--subtle-foreground);
          box-shadow: 0 -1px 0 var(--border);
        }
      }
    </style>
  </template>
}
