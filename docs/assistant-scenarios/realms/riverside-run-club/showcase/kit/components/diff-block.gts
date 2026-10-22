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
    /** with it, a line's number is a button that opens a comment there */
    onComment?: (line: number, text: string) => unknown;
    /** 'unified' (default), 'split' (old left, new right), or 'auto':
     * split once the block is 640px wide */
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
  op?: 'add' | 'del';
  n?: number;
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
  /** the line it is on: the new file's number, or the old one for a removal */
  line: number;
  author: string;
  text: string;
}

export type DiffHunkState = 'kept' | 'reverted';

interface SplitRow {
  left?: ShownLine;
  right?: ShownLine;
  skip?: string;
}

// Staged change with an immutable receipt line; long diffs collapse.
export class DiffBlock extends Component<DiffBlockSignature> {
  @tracked collapsed = true;
  @tracked renderAnyway = false;
  @tracked wide = false;
  @tracked commentingOn: number | undefined;
  @tracked commentDraft = '';

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
  watchWidth = modifier((element: HTMLElement, [view]: [string | undefined]) => {
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
  });

  @cached
  get hunks(): DiffHunk[] {
    return diffHunks(this.args.lines);
  }
  get reviews(): boolean {
    return Boolean(this.args.onKeepHunk || this.args.onRevertHunk);
  }
  /** the hunk that starts at a line index, for its bar */
  hunkAt = (index: number): DiffHunk | undefined =>
    this.reviews ? this.hunks.find((h) => h.start === index) : undefined;
  hunkOf = (index: number): DiffHunk | undefined =>
    this.hunks.find((h) => index >= h.start && index <= h.end);
  stateOf = (hunk: DiffHunk) => this.args.hunkStates?.[hunk.index];
  isKept = (hunk: DiffHunk) => this.stateOf(hunk) === 'kept';
  lineState = (index: number) => {
    let hunk = this.hunkOf(index);
    return hunk ? this.stateOf(hunk) : undefined;
  };
  hunkLabel = (hunk: DiffHunk) =>
    `Change ${hunk.index + 1} of ${this.hunks.length} · +${hunk.added} −${hunk.removed}`;
  keepHunk = (hunk: DiffHunk) => this.args.onKeepHunk?.(hunk);
  revertHunk = (hunk: DiffHunk) => this.args.onRevertHunk?.(hunk);

  commentsOn = (n: number | undefined) =>
    n === undefined ? [] : (this.args.comments ?? []).filter((c) => c.line === n);
  isCommenting = (n: number | undefined) =>
    n !== undefined && this.commentingOn === n;
  openComment = (n: number) => {
    this.commentingOn = n;
    this.commentDraft = '';
  };
  typeComment = (event: Event) =>
    (this.commentDraft = (event.target as HTMLTextAreaElement).value);
  cancelComment = () => (this.commentingOn = undefined);
  saveComment = async () => {
    let n = this.commentingOn;
    let text = this.commentDraft.trim();
    if (n !== undefined && text) {
      await this.args.onComment?.(n, text);
    }
    this.commentingOn = undefined;
  };
  commentKey = (e: Event) => {
    let event = e as KeyboardEvent;
    if (event.key === 'Escape') {
      this.cancelComment();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.saveComment();
    }
  };
  focusComment = modifier((element: HTMLTextAreaElement) => element.focus());

  /** the split view: removals on the left, additions on the right, paired
   * within each change; unchanged lines on both sides */
  @cached
  get splitRows(): SplitRow[] {
    let rows: SplitRow[] = [];
    let dels: ShownLine[] = [];
    let adds: ShownLine[] = [];
    let flush = () => {
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        rows.push({ left: dels[k], right: adds[k] });
      }
      dels = [];
      adds = [];
    };
    for (let line of this.shown) {
      if (line.skip) {
        flush();
        rows.push({ skip: line.skip });
      } else if (line.op === 'del') {
        dels.push(line);
      } else if (line.op === 'add') {
        adds.push(line);
      } else {
        flush();
        rows.push({ left: line, right: line });
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
    return lines.map((line) =>
      line.skip
        ? { sign: '', tokens: [], skip: skipText(line.skip) }
        : {
            op: line.op,
            n: line.n,
            sign: line.op === 'add' ? '+ ' : line.op === 'del' ? '- ' : '  ',
            tokens: tokenizeCode(line.text, language),
          },
    );
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
    return this.args.expandLabel
      ? `${this.args.expandLabel} · ${more}`
      : more;
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
      data-test-pretui-diff-block
      {{this.watchWidth @view}}
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
            data-test-pretui-diff-render-anyway
            {{on 'click' this.showLarge}}
          >Render anyway</button>
        </div>
      {{else if this.split}}
        {{#each this.splitRows as |row|}}
          {{#if row.skip}}
            <div class='pretui-diff-line pretui-diff-skip' data-skip>{{row.skip}}</div>
          {{else}}
            <div class='pretui-diff-split' data-test-pretui-diff-split-row>
              <div class='pretui-diff-line' data-op={{row.left.op}} data-side='old'>{{#if row.left}}{{#if @lineNumbers}}<span class='pretui-diff-n' aria-hidden='true'>{{row.left.n}}</span>{{/if}}<span class='pretui-diff-sign'>{{row.left.sign}}</span>{{#each row.left.tokens key='@index' as |part|}}<span class={{part.cls}}>{{part.text}}</span>{{/each}}{{/if}}</div>
              <div class='pretui-diff-line' data-op={{row.right.op}} data-side='new'>{{#if row.right}}{{#if @lineNumbers}}<span class='pretui-diff-n' aria-hidden='true'>{{row.right.n}}</span>{{/if}}<span class='pretui-diff-sign'>{{row.right.sign}}</span>{{#each row.right.tokens key='@index' as |part|}}<span class={{part.cls}}>{{part.text}}</span>{{/each}}{{/if}}</div>
            </div>
          {{/if}}
        {{/each}}
      {{else}}
      {{#each this.shown as |line index|}}
        {{#let (this.hunkAt index) as |hunk|}}
          {{#if hunk}}
            <div
              class='pretui-diff-hunk'
              data-state={{this.stateOf hunk}}
              data-test-pretui-diff-hunk={{hunk.index}}
            >
              <span class='pretui-diff-hunk-label'>{{this.hunkLabel hunk}}</span>
              {{#if (this.stateOf hunk)}}
                <span class='pretui-diff-hunk-state' data-test-pretui-diff-hunk-state>{{#if (this.isKept hunk)}}<CheckIcon
                      width='11'
                      height='11'
                      aria-hidden='true'
                    />{{/if}}{{this.stateOf hunk}}</span>
              {{else}}
                {{#if @onKeepHunk}}<button
                    type='button'
                    class='pretui-diff-action'
                    data-test-pretui-diff-keep={{hunk.index}}
                    {{on 'click' (fn this.keepHunk hunk)}}
                  >Keep</button>{{/if}}
                {{#if @onRevertHunk}}<button
                    type='button'
                    class='pretui-diff-action'
                    data-kind='quiet'
                    data-test-pretui-diff-revert={{hunk.index}}
                    {{on 'click' (fn this.revertHunk hunk)}}
                  >Revert</button>{{/if}}
              {{/if}}
            </div>
          {{/if}}
        {{/let}}
        {{#if line.skip}}
          <div
            class='pretui-diff-line pretui-diff-skip'
            data-skip
          >{{line.skip}}</div>
        {{else}}<div class='pretui-diff-line' data-op={{line.op}} data-state={{this.lineState index}}>{{#if
              @lineNumbers
            }}{{#if @onComment}}<button
                  type='button'
                  class='pretui-diff-n'
                  aria-label='Comment on line {{line.n}}'
                  data-test-pretui-diff-comment-on={{line.n}}
                  {{on 'click' (fn this.openComment line.n)}}
                >{{line.n}}</button>{{else}}<span
                class='pretui-diff-n'
                aria-hidden='true'
              >{{line.n}}</span>{{/if}}{{/if}}<span
            class='pretui-diff-sign'
          >{{line.sign}}</span>{{#each line.tokens key='@index' as |part|}}<span
              class={{part.cls}}
            >{{part.text}}</span>{{/each}}</div>
          {{#each (this.commentsOn line.n) as |comment|}}
            <div class='pretui-diff-comment' data-test-pretui-diff-comment={{comment.line}}>
              <span class='pretui-diff-comment-author'>{{comment.author}}</span>
              <span class='pretui-diff-comment-text'>{{comment.text}}</span>
            </div>
          {{/each}}
          {{#if (this.isCommenting line.n)}}
            <div class='pretui-diff-comment pretui-diff-comment-new' data-test-pretui-diff-comment-editor>
              <textarea
                class='pretui-diff-comment-field'
                aria-label='Comment on line {{line.n}}'
                rows='2'
                value={{this.commentDraft}}
                {{on 'input' this.typeComment}}
                {{on 'keydown' this.commentKey}}
                {{this.focusComment}}
              ></textarea>
              <span class='pretui-diff-comment-actions'>
                <button type='button' class='pretui-diff-action' data-kind='quiet' {{on 'click' this.cancelComment}}>Cancel</button>
                <button type='button' class='pretui-diff-action' data-test-pretui-diff-comment-save {{on 'click' this.saveComment}}>Comment</button>
              </span>
            </div>
          {{/if}}
        {{/if}}
      {{/each}}
      {{/if}}
      {{#if (if this.overflows (if this.tooLarge false true))}}
        <button
          type='button'
          class='pretui-diff-line pretui-diff-toggle'
          aria-expanded={{this.toggleExpanded}}
          data-test-pretui-diff-toggle
          {{on 'click' this.toggle}}
        >{{this.toggleLabel}}</button>
      {{/if}}
      {{#if @receipt}}<div class='pretui-diff-receipt'>{{@receipt}}</div>{{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-diff[data-wrap] .pretui-diff-line {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .pretui-diff-split {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
        .pretui-diff-split .pretui-diff-line[data-side='old'] {
          box-shadow: inset -1px 0 0 var(--border);
        }
        .pretui-diff-hunk {
          display: flex;
          align-items: center;
          gap: var(--step-8, 8px);
          min-height: 26px;
          padding: 0 var(--step-12, 12px);
          font-family: var(--font-sans, inherit);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-2, var(--muted-foreground));
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
        /* kept is done: ink with a check, not green */
        .pretui-diff-hunk[data-state='kept'] .pretui-diff-hunk-state {
          display: inline-flex;
          align-items: center;
          gap: var(--step-4, 4px);
          color: var(--foreground);
        }
        .pretui-diff-line[data-state='reverted'] {
          text-decoration: line-through;
          opacity: 0.55;
        }
        .pretui-diff-action {
          height: 22px;
          padding: 0 var(--step-8, 8px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          box-shadow: inset 0 0 0 1px var(--border-strong, var(--border));
          font: inherit;
          font-family: var(--font-sans, inherit);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 400;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-diff-action[data-kind='quiet'] {
          box-shadow: none;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-diff-action:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-diff-action:focus-visible,
        button.pretui-diff-n:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        button.pretui-diff-n {
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          color: inherit;
          cursor: pointer;
        }
        button.pretui-diff-n:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-diff-comment {
          display: grid;
          gap: 2px;
          margin: 2px var(--step-8, 8px) var(--step-4, 4px) 40px;
          padding: var(--step-4, 4px) var(--step-8, 8px);
          border-radius: var(--round-row, 8px);
          background: var(--card);
          box-shadow: 0 0 0 1px var(--border);
          font-family: var(--font-sans, inherit);
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--foreground);
          white-space: normal;
        }
        .pretui-diff-comment-author {
          font-weight: 600;
        }
        .pretui-diff-comment-field {
          width: 100%;
          box-sizing: border-box;
          padding: var(--step-4, 4px) var(--step-8, 8px);
          border: 0;
          border-radius: var(--round-chip, 4px);
          background: var(--field, var(--inset));
          box-shadow: inset 0 0 0 1px var(--input, var(--border));
          font: inherit;
          color: var(--foreground);
          resize: vertical;
        }
        .pretui-diff-comment-actions {
          display: flex;
          justify-content: flex-end;
          gap: var(--step-4, 4px);
        }
        .pretui-diff-large {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--step-8, 8px);
          padding: var(--step-12, 12px);
          font-family: var(--font-sans, inherit);
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--ink-2, var(--muted-foreground));
        }
        /* a diff is pasteable: mono at the data size */
        .pretui-diff {
          font-family: var(--font-mono);
          font-size: var(--type-data, 12px);
          line-height: var(--leading-data, 18px);
          background: var(--inset, var(--boxel-100));
          border-radius: var(--round-row, 8px);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          overflow: hidden;
        }
        .pretui-diff-head {
          display: flex;
          align-items: center;
          gap: var(--step-8, 8px);
          padding: var(--step-4, 4px) var(--step-12, 12px);
          font-family: var(--font-sans, inherit);
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
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
          font-size: var(--type-data, 12px);
          line-height: var(--leading-data, 18px);
        }
        /* the counts are figures: sans, tabular */
        .pretui-diff-counts {
          display: flex;
          gap: var(--step-4, 4px);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-variant-numeric: tabular-nums;
        }
        .pretui-diff-line {
          padding: 0 var(--step-12, 12px);
          white-space: pre;
        }
        .pretui-diff-line[data-op='add'] {
          background: color-mix(
            in oklch,
            var(--success, var(--boxel-success)) 12%,
            transparent
          );
          color: color-mix(
            in oklch,
            var(--foreground) 30%,
            var(--success, var(--boxel-success))
          );
        }
        .pretui-diff-line[data-op='del'] {
          background: color-mix(in oklch, var(--destructive) 10%, transparent);
          color: color-mix(in oklch, var(--foreground) 30%, var(--destructive));
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
          /* ink-2, not ink-3: the number sits on the add and remove tints,
             where ink-3 falls under 4.5:1 */
          color: var(--ink-2, var(--muted-foreground));
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
          color: var(--success, var(--boxel-success));
        }
        .pretui-diff[data-language]
          .pretui-diff-line[data-op='del']
          .pretui-diff-sign {
          color: var(--destructive);
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
          background: none;
          font: inherit;
          font-family: var(--font-sans, inherit);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-variant-numeric: tabular-nums;
          color: var(--pretui-primary-ink, var(--primary));
          cursor: pointer;
        }
        /* the unchanged run between two hunks: a quiet gap, never a line
           of the file */
        .pretui-diff-skip {
          font-family: var(--font-sans, inherit);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-2, var(--muted-foreground));
          background: color-mix(in oklch, var(--border) 35%, transparent);
          user-select: none;
        }
        .pretui-diff-receipt {
          padding: var(--step-4, 4px) var(--step-12, 12px);
          font-family: var(--font-sans, inherit);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-variant-numeric: tabular-nums;
          color: var(--ink-3, var(--boxel-400));
          box-shadow: 0 -1px 0 var(--border);
        }
      }
    </style>
  </template>
}
