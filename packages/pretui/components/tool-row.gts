// Pretui — ToolRow: one tool call in an agent transcript. WorkItem's state vocabulary, plus a subtitle naming what the tool acted on, a disclosure the reader owns once they touch it, a lazily mounted body, and the skill that granted the tool.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { htmlSafe } from '@ember/template';
import type { SafeString } from '@ember/template';
import type { ComponentLike } from '@glint/template';
import { modifier } from 'ember-modifier';
import { Collapse } from '../internal/agentic-chat';
import { scheduleMount } from '../internal/mount-queue';
import type { ToolKind, ToolPhrase } from '../internal/tool-phrases';
export type { ToolKind, ToolPhrase } from '../internal/tool-phrases';
import ArrowRight from '@cardstack/boxel-icons/arrow-right';

import { Chip } from './chip';
import { CodeBlock } from './code-block';
import { DiffBlock, lineDiff } from './diff-block';
import { StateGlyph } from './state-glyph';
import { VisuallyHidden } from './visually-hidden';
import type { DiffBlockSignature, DiffLine } from './diff-block';
import { PlanMark } from './plan-mark';
import { toolIcon } from './tool-icon';
import type { ToolIcon } from './tool-icon';
import { workStatus, workTone } from './work-item';
import type { WorkTone } from './work-item';

// ── Renderer registry ────────────────────────────────────────────────────
// An argument, never a global: a realm can host several apps, each with its
// own tools. ToolGroup passes one registry down to every row; a ToolRow used
// alone can take @title, @subtitle and <:body> directly instead.

export interface ToolBodySignature {
  Args: {
    /** the call's arguments: parsed, or the raw text while still streaming */
    params?: unknown;
    /** the call's result, once there is one */
    result?: unknown;
    state: string;
  };
}

export interface ToolResultSignature {
  Args: {
    /** the call's arguments, partial while they stream */
    params?: unknown;
    result?: unknown;
    /** 'streaming' while the arguments arrive */
    state: string;
    /** answer the call from inside its card: present only while the call
     * waits on the reader, so a settled card cannot answer twice */
    resolve?: (value: unknown) => unknown;
  };
}

export interface ToolRenderer {
  /** the tool's display name: 'Read', 'Patch fields' */
  title?: string;
  /** derive the subtitle (the thing the tool acted on) from the arguments */
  subtitle?: (params: unknown) => string | undefined;
  /** the body that renders arguments and result */
  body?: ComponentLike<ToolBodySignature>;
  /** what the tool does, which ToolGroup uses to phrase a run ("Read 3
   * files, ran 2 commands") and to merge runs of reads and of writes.
   * Default 'other' */
  kind?: ToolKind;
  /** the tool's own phrase, when its kind's is not right: { active:
   * 'Cupping', done: 'Cupped', one: 'lot', many: 'lots' } */
  phrase?: ToolPhrase;
  /** the tool's UI: rendered into `<:result>` under the row's quiet line,
   * usually a CardEmbed or LiveCard around the card the call made. A
   * host's own `<:result>` block wins */
  result?: ComponentLike<ToolResultSignature>;
  /** 'standalone' (default when `result` is set): the call's card is
   * surfaced in the turn, so a grouping helper never folds the call into
   * a ToolGroup; 'inline' lets it fold */
  display?: 'inline' | 'standalone';
}

export type ToolRenderers = Record<string, ToolRenderer>;

export interface ToolSource {
  kind: 'skill' | 'builtin';
  name: string;
}

/** How much of the transcript a call claims, set by the tool, never by the
 * message: a `step` reads or moves the UI, an `action` writes, a `run` works
 * in the background and outlives the page, a `script` is a program that can
 * do all three. */
export type ToolDensity = 'step' | 'action' | 'run' | 'script';

/** A multi-step call reporting where it is: step `step` of `of`, and how far
 * through the current step (0–1, default 0.5). The bar fills only as steps
 * finish, so it is never full while work remains. */
export interface ToolProgress {
  step: number;
  of: number;
  label?: string;
  fraction?: number;
}

/** "Step 2 of 4 · Reading menus"; the label is optional. */
export function progressText(progress: ToolProgress): string {
  let head = `Step ${progress.step} of ${progress.of}`;
  return progress.label ? `${head} · ${progress.label}` : head;
}

/** The bar's fill, 0–100: finished steps plus the current one's fraction,
 * capped below 100 until the last step is done. */
export function progressPercent(progress: ToolProgress): number {
  let of = Math.max(1, progress.of);
  let step = Math.min(Math.max(1, progress.step), of);
  let fraction = Math.min(Math.max(progress.fraction ?? 0.5, 0), 1);
  return Math.round(((step - 1 + fraction) / of) * 100);
}

/** 'read_realm_file' → 'Read realm file'; 'patchFields' → 'Patch fields'. */
export function humanizeToolName(name: string): string {
  let words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.:/]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}

/** Seconds as a short duration: 0.4s, 12s, 2m 05s. */
export function formatToolDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  if (seconds < 10) {
    return `${Math.round(seconds * 10) / 10}s`;
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  let minutes = Math.floor(seconds / 60);
  let rest = Math.round(seconds % 60);
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

/** True when any value is truthy: a template helper, since Glimmer has no `or`. */
const either = (...values: unknown[]): boolean => values.some(Boolean);

function asText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

// ── GenericToolBody ──────────────────────────────────────────────────────
// What a tool with no renderer shows: its arguments and its result as code.
// Arguments that are still a string are mid-stream, so they render as the
// plain text they are rather than as a JSON parse that would fail.

class GenericToolBody extends Component<ToolBodySignature> {
  get hasArgs() {
    return this.args.params !== undefined && this.args.params !== '';
  }
  get hasResult() {
    return this.args.result !== undefined;
  }
  get argsText() {
    return asText(this.args.params);
  }
  get argsLanguage() {
    return typeof this.args.params === 'string' ? undefined : 'json';
  }
  get resultText() {
    return asText(this.args.result);
  }
  get resultLanguage() {
    return typeof this.args.result === 'string' ? undefined : 'json';
  }
  <template>
    <div class='pretui-toolrow-generic' data-test-pretui-tool-row-generic>
      {{#if this.hasArgs}}
        <CodeBlock
          @code={{this.argsText}}
          @language={{this.argsLanguage}}
          @label='Arguments'
          @maxLines={{12}}
          @wrap={{true}}
          data-scroll-region
        />
      {{/if}}
      {{#if this.hasResult}}
        <CodeBlock
          @code={{this.resultText}}
          @language={{this.resultLanguage}}
          @label='Result'
          @maxLines={{12}}
          @wrap={{true}}
          data-scroll-region
        />
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-toolrow-generic {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

// ── ToolLine ─────────────────────────────────────────────────────────────
// One thing that happened inside a call: a page read, a failure with its
// reason, an auto-fix, a repair. It sits on the row's grid: a glyph column
// as wide as the row's disc, the same gap, then the text. Nesting is a
// hairline rail under the parent's glyph, and the child's glyph lands under
// the parent's text, so any depth lines up with the rows around it.

export type ToolLineTone = 'done' | 'live' | 'failed' | 'attention' | 'muted';

export interface ToolLineSignature {
  Args: {
    /** colours the glyph, and for failed, attention and muted the text */
    tone?: ToolLineTone;
    /** the line's mark: ✓ ✕ ↻ ! ? for outcomes; ◐ (or 'current') for a
     * line under way, drawn as the thin turning ring; · ○ or none for a note,
     * which keeps the column empty */
    glyph?: string;
    /** 0 (default) on the row's text edge; 1–3 nests under the line above */
    depth?: number;
    /** a second, quieter line: the model used, a size, a count */
    sub?: string;
    /** set the text in the mono voice, for paths and calls */
    mono?: boolean;
    /** an image the line made (a written PNG, a generated cover), shown
     * small under its text */
    thumb?: string;
    /** the thumbnail's alternative text. Default: none (decorative, since
     * the line's text already names the file) */
    thumbAlt?: string;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

// the glyphs that mark a note, not an outcome: they draw nothing
const NOTE_GLYPHS = new Set([
  '',
  '·',
  '○',
  'next',
  'note',
  'skipped',
  '–',
  '-',
]);
const UNDER_WAY_GLYPHS = new Set(['◐', 'current']);

// the glyph and its colour are decorative, so a tone a reader must not miss
// is also said in words, before the line's text
const SPOKEN_TONES: Partial<Record<ToolLineTone, string>> = {
  failed: 'Failed:',
  attention: 'Needs attention:',
};

export class ToolLine extends Component<ToolLineSignature> {
  get underWay(): boolean {
    return UNDER_WAY_GLYPHS.has(this.args.glyph ?? '');
  }
  get marked(): boolean {
    return !NOTE_GLYPHS.has(this.args.glyph ?? '');
  }
  get depth(): number {
    return Math.min(Math.max(Math.round(this.args.depth ?? 0), 0), 3);
  }
  get spokenTone(): string | undefined {
    return this.args.tone ? SPOKEN_TONES[this.args.tone] : undefined;
  }
  <template>
    <div
      class='pretui-toolline'
      data-tone={{@tone}}
      data-depth={{if this.depth this.depth}}
      data-mono={{if @mono 'true'}}
      data-test-pretui-tool-line
      ...attributes
    >
      {{! outcomes keep their mark; a line under way turns the thin ring;
          a note (· ○ or none) has no mark, only the text edge }}
      {{#if this.underWay}}
        <PlanMark class='pretui-toolline-glyph' @state='current' @size={{12}} />
      {{else if this.marked}}
        <StateGlyph class='pretui-toolline-glyph' @glyph={{@glyph}} />
      {{else}}
        <span class='pretui-toolline-glyph' aria-hidden='true'></span>
      {{/if}}
      <span class='pretui-toolline-text'>
        {{#if this.spokenTone}}<VisuallyHidden
            data-test-pretui-tool-line-tone
          >{{this.spokenTone}} </VisuallyHidden>{{/if}}
        {{yield}}
        {{#if @sub}}<span
            class='pretui-toolline-sub'
            data-test-pretui-tool-line-sub
          >{{@sub}}</span>{{/if}}
        {{#if @thumb}}<img
            class='pretui-toolline-thumb'
            src={{@thumb}}
            alt={{if @thumbAlt @thumbAlt ''}}
            loading='lazy'
            data-test-pretui-tool-line-thumb
          />{{/if}}
      </span>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-toolline {
          /* a ToolLine reads the row's grid; alone it falls back to it */
          --pretui-toolline-disc: var(--pretui-toolrow-disc, var(--boxel-sp));
          --pretui-toolline-gap: var(--pretui-toolrow-gap, var(--boxel-sp-xs));
          --pretui-toolline-step: calc(
            var(--pretui-toolline-disc) + var(--pretui-toolline-gap)
          );
          display: grid;
          grid-template-columns: var(--pretui-toolline-disc) minmax(0, 1fr);
          column-gap: var(--pretui-toolline-gap);
          align-items: baseline;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          /* what happened reads in the settled ink; only a line still in
             progress takes the bright foreground */
          color: var(--pretui-toolrow-settled-ink, var(--foreground));
        }
        .pretui-toolline[data-tone='live'] {
          color: var(--foreground);
        }
        /* the rail sits under the parent glyph's centre; the padding then
           carries this glyph to the parent's text edge */
        .pretui-toolline[data-depth] {
          box-shadow: inset 1px 0 0 var(--border);
          padding-inline-start: calc(
            var(--pretui-toolline-step) - var(--pretui-toolline-disc) / 2
          );
        }
        .pretui-toolline[data-depth='1'] {
          margin-inline-start: calc(var(--pretui-toolline-disc) / 2);
        }
        .pretui-toolline[data-depth='2'] {
          margin-inline-start: calc(
            var(--pretui-toolline-step) + var(--pretui-toolline-disc) / 2
          );
          box-shadow: inset 1px 0 0 var(--border-strong);
        }
        .pretui-toolline[data-depth='3'] {
          margin-inline-start: calc(
            var(--pretui-toolline-step) * 2 + var(--pretui-toolline-disc) / 2
          );
          box-shadow: inset 1px 0 0 var(--border-strong);
        }
        .pretui-toolline-glyph {
          text-align: center;
          font-size: var(--boxel-caption-font-size);
          color: var(--subtle-foreground);
        }
        /* done is ink with its check, not green; a state colours the mark
           only, and the line's words stay in the row's ink */
        .pretui-toolline[data-tone='done'] .pretui-toolline-glyph {
          color: var(--foreground);
        }
        .pretui-toolline[data-tone='live'] .pretui-toolline-glyph {
          color: var(--primary-ink);
        }
        .pretui-toolline[data-tone='failed'] .pretui-toolline-glyph {
          color: var(--destructive-ink);
        }
        .pretui-toolline[data-tone='attention'] .pretui-toolline-glyph {
          color: var(--attention-ink);
        }
        .pretui-toolline[data-tone='muted'] .pretui-toolline-text {
          color: var(--muted-foreground);
        }
        .pretui-toolline[data-mono] .pretui-toolline-text {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
        }
        .pretui-toolline-text {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        /* square, small, inside the text column: a look, not a preview */
        .pretui-toolline-thumb {
          display: block;
          width: 4.5rem;
          height: 4.5rem;
          margin-block: var(--boxel-sp-4xs) var(--boxel-sp-6xs);
          border-radius: var(--boxel-border-radius-xs);
          object-fit: cover;
          background-color: var(--inset);
          box-shadow: 0 0 0 1px var(--border);
        }
        .pretui-toolline-sub {
          display: block;
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
          color: var(--subtle-foreground);
        }
      }
    </style>
  </template>
}

// ── ToolChange ───────────────────────────────────────────────────────────
// One value a call changed: the field's label, what it was, what it is now.
// A write says what changed, never only which paths it touched. It sits on
// the same grid as ToolLine, its label column in the glyph's place widened
// to a fixed measure so a stack of changes lines up.

export interface ToolChangeSignature {
  Args: {
    /** the field's label, as the card shows it: "Base width" */
    label: string;
    /** the value before; omit when it is not known */
    from?: string;
    /** the value after */
    to?: string;
    /** "×42": the change applies to that many cards */
    count?: string;
    /** how sure the assistant is of the new value: 'guessed' (inferred,
     * not read) or 'unclear' (it found more than one answer). Omit when
     * it read the value plainly */
    confidence?: 'guessed' | 'unclear';
  };
  Element: HTMLDivElement;
}

export class ToolChange extends Component<ToolChangeSignature> {
  <template>
    <div class='pretui-toolchange' data-test-pretui-tool-change ...attributes>
      <span
        class='pretui-toolchange-label'
        title={{@label}}
        data-test-pretui-tool-change-label
      >{{@label}}</span>
      <span class='pretui-toolchange-values'>
        {{#if @from}}
          <del
            class='pretui-toolchange-from'
            data-test-pretui-tool-change-from
          >{{@from}}</del>
          <ArrowRight
            class='pretui-toolchange-arrow'
            width='12'
            height='12'
            role='img'
            aria-label='changed to'
          />
        {{/if}}
        {{#if @to}}<ins
            class='pretui-toolchange-to'
            data-test-pretui-tool-change-to
          >{{@to}}</ins>{{/if}}
        {{#if @count}}<span
            class='pretui-toolchange-count'
          >{{@count}}</span>{{/if}}
        {{#if @confidence}}<span
            class='pretui-toolchange-confidence'
            data-confidence={{@confidence}}
            data-test-pretui-tool-change-confidence={{@confidence}}
          >{{@confidence}}</span>{{/if}}
      </span>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-toolchange {
          display: grid;
          grid-template-columns: minmax(0, 7.5em) minmax(0, 1fr);
          column-gap: var(--boxel-sp-sm);
          align-items: baseline;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
        }
        .pretui-toolchange-label {
          color: var(--muted-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-toolchange-values {
          min-width: 0;
          overflow-wrap: anywhere;
          /* a long value wraps to the width, up to three lines */
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 3;
          overflow: hidden;
        }
        /* the values are field values, so they quote in the mono voice */
        .pretui-toolchange-from,
        .pretui-toolchange-to {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
        }
        .pretui-toolchange-from {
          color: var(--muted-foreground);
          text-decoration-color: var(--subtle-foreground);
        }
        .pretui-toolchange-arrow {
          margin-inline: var(--boxel-sp-4xs);
          vertical-align: -0.1em;
          color: var(--subtle-foreground);
        }
        .pretui-toolchange-to {
          text-decoration: none;
          font-weight: 400;
          color: var(--foreground);
        }
        /* a value the assistant did not read plainly says so, in the
           attention ink: the reader checks it before keeping it */
        .pretui-toolchange-confidence {
          margin-inline-start: var(--boxel-sp-xs);
          padding: 0 var(--boxel-sp-4xs);
          border-radius: var(--boxel-border-radius-xs);
          box-shadow: inset 0 0 0 1px var(--attention);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--attention-ink);
        }
        .pretui-toolchange-count {
          margin-inline-start: var(--boxel-sp-xs);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }
      }
    </style>
  </template>
}

// ── ToolDiff ─────────────────────────────────────────────────────────────
// What a write did to one source file, under the row's rows: the file, its
// +/− counts, a few lines of context around each change, then "Show all".
// A write never whispers: the change itself is on the row, not behind the
// disclosure. It is DiffBlock on the row's text column, fed by lineDiff.

export interface ToolDiffSignature {
  Args: {
    /** the file as the reader knows it: the path inside the workspace */
    path: string;
    /** the file before the call; absent for a file the call created */
    before?: string;
    /** the file after the call; absent for a file the call deleted */
    after?: string;
    /** a diff already worked out (a result that carries one); used instead
     * of before and after */
    lines?: DiffLine[];
    /** unchanged lines kept on each side of a change. Default 2 */
    context?: number;
    /** lines shown before "Show all". Default 6 */
    maxLines?: number;
    /** DiffBlock's review arguments, passed through: per-hunk Keep and
     * Revert, line comments, the split view, wrapping, the size guard */
    onKeepHunk?: DiffBlockSignature['Args']['onKeepHunk'];
    onRevertHunk?: DiffBlockSignature['Args']['onRevertHunk'];
    hunkStates?: DiffBlockSignature['Args']['hunkStates'];
    comments?: DiffBlockSignature['Args']['comments'];
    onComment?: DiffBlockSignature['Args']['onComment'];
    view?: DiffBlockSignature['Args']['view'];
    wrap?: boolean;
    maxBytes?: number;
  };
  Element: HTMLDivElement;
}

export class ToolDiff extends Component<ToolDiffSignature> {
  get lines(): DiffLine[] {
    return (
      this.args.lines ??
      lineDiff(this.args.before, this.args.after, {
        context: this.args.context ?? 2,
      })
    );
  }
  get receipt(): string | undefined {
    if (this.args.lines) {
      return undefined;
    }
    if (this.args.before === undefined) {
      return 'new file';
    }
    return this.args.after === undefined ? 'deleted' : undefined;
  }
  <template>
    {{#if this.lines.length}}
      <DiffBlock
        class='pretui-tooldiff'
        @lines={{this.lines}}
        @filename={{@path}}
        @maxLines={{if @maxLines @maxLines 6}}
        @expandLabel='Show all'
        @lineNumbers={{true}}
        @receipt={{this.receipt}}
        @onKeepHunk={{@onKeepHunk}}
        @onRevertHunk={{@onRevertHunk}}
        @hunkStates={{@hunkStates}}
        @comments={{@comments}}
        @onComment={{@onComment}}
        @view={{@view}}
        @wrap={{@wrap}}
        @maxBytes={{@maxBytes}}
        data-test-pretui-tool-diff={{@path}}
        ...attributes
      />
    {{/if}}
    <style scoped>
      @layer PretComponent {
        /* the diff sits a step below the row's card, as the design board
           draws it: a darker well with no ring, a quiet file header, and
           the change tints mixed into that well */
        .pretui-tooldiff {
          /* the well follows the theme: its muted surface by default, light
             on a light theme and dark on a dark one, so the code always
             reads in the foreground ink. A theme that wants a deeper well
             sets --pretui-code-well */
          --pretui-tooldiff-well: var(--pretui-code-well, var(--muted));
          margin-block: var(--boxel-sp-6xs) 0;
          min-width: 0;
          overflow-x: auto;
          /* square: inside a row, only the row rounds */
          border-radius: 0;
          background-color: var(--pretui-tooldiff-well);
          box-shadow: none;
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
        }
        .pretui-tooldiff :deep(.pretui-diff-head) {
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 400;
          color: var(--muted-foreground);
          box-shadow: 0 1px 0
            color-mix(in oklch, var(--border) 60%, transparent);
        }
        .pretui-tooldiff :deep(.pretui-diff-line) {
          padding-inline: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        }
        .pretui-tooldiff :deep(.pretui-diff-line[data-op='add']) {
          /* mixed in sRGB: oklch would carry a teal through blue on its
             way to a purple well, and an added line must read green */
          background-color: color-mix(
            in srgb,
            var(--success) 9%,
            var(--pretui-tooldiff-well)
          );
        }
        .pretui-tooldiff :deep(.pretui-diff-line[data-op='del']) {
          background-color: color-mix(
            in srgb,
            var(--destructive) 11%,
            var(--pretui-tooldiff-well)
          );
        }
        .pretui-tooldiff :deep(.pretui-diff-skip) {
          background: none;
          padding-inline-start: var(--boxel-sp-xs);
        }
        .pretui-tooldiff :deep(.pretui-diff-toggle) {
          padding-inline-start: var(--boxel-sp-xs);
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 600;
        }
        .pretui-tooldiff :deep(.pretui-diff-receipt) {
          box-shadow: none;
          padding: var(--boxel-sp-6xs) var(--boxel-sp-xs) var(--boxel-sp-4xs);
        }
      }
    </style>
  </template>
}

// ── ToolReceiptAction ────────────────────────────────────────────────────
// The one action a receipt still offers: Undo, Revert, Stop. It acts once.
// While its action runs it is busy and refuses a second press, so an Undo
// can never be applied twice by an impatient click; the host keeps the
// durable gate (the call's state), this keeps the instant one. Busy and
// disabled are aria-disabled, never the disabled attribute, so a pressed
// button keeps focus.

export interface ToolReceiptActionSignature {
  Args: {
    /** the verb: 'Undo', 'Stop', 'Undo 2' */
    label: string;
    /** what it reads while the action runs. Default: the label and "…" */
    busyLabel?: string;
    /** the action; a returned promise keeps the button busy until it
     * settles */
    onAct: () => unknown;
    disabled?: boolean;
    /** the action was refused, and why: "Not undone · file changed since
     * the run". The button gives way to the refusal, in words, in a live
     * region; when the button had focus, the refusal takes it */
    refusal?: string;
  };
  Element: HTMLButtonElement;
}

export class ToolReceiptAction extends Component<ToolReceiptActionSignature> {
  @tracked busy = false;
  /** the button holds focus, or held it when it was removed */
  private hadFocus = false;
  get text(): string {
    return this.busy
      ? (this.args.busyLabel ?? `${this.args.label}…`)
      : this.args.label;
  }
  get inert(): boolean {
    return this.busy || Boolean(this.args.disabled);
  }
  act = async () => {
    if (this.busy || this.args.disabled) {
      return;
    }
    this.busy = true;
    try {
      await this.args.onAct();
    } finally {
      if (!this.isDestroying && !this.isDestroyed) {
        this.busy = false;
      }
    }
  };
  noteFocus = () => {
    this.hadFocus = true;
  };
  // a removed button can blur with no related target: only focus that moved
  // somewhere real clears the flag
  noteBlur = (event: Event) => {
    if ((event as FocusEvent).relatedTarget) {
      this.hadFocus = false;
    }
  };
  /** the refusal takes focus when the button it replaced had it, so a
   * keyboard reader is not left on the page's body */
  takeFocus = modifier((element: HTMLElement) => {
    let active = document.activeElement;
    if (this.hadFocus && (!active || active === document.body)) {
      element.focus({ preventScroll: true });
    }
    this.hadFocus = false;
  });
  <template>
    {{! one live region, present from the first render, whose text changes:
        a region created already holding its text is often not announced }}
    <span class='pretui-toolaction-status' role='status'>{{#if
        @refusal
      }}<span
          class='pretui-toolaction-refusal'
          tabindex='-1'
          {{this.takeFocus}}
          data-test-pretui-tool-receipt-refusal
        >{{@refusal}}</span>{{/if}}</span>
    {{#unless @refusal}}
      <button
        type='button'
        class='pretui-toolaction'
        aria-disabled={{if this.inert 'true'}}
        {{on 'click' this.act}}
        {{on 'focus' this.noteFocus}}
        {{on 'blur' this.noteBlur}}
        data-test-pretui-tool-receipt-action={{@label}}
        ...attributes
      >{{this.text}}</button>
    {{/unless}}
    <style scoped>
      @layer PretComponent {
        /* the receipt's one verb, as text: the settled ink at rest, the
           foreground under the pointer. 1.5rem tall, the smallest target
           a pointer is asked to hit */
        .pretui-toolaction {
          flex: none;
          min-height: 1.5rem;
          margin-inline-end: calc(-1 * var(--boxel-sp-xs));
          padding: 0 var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-xs);
          background-color: transparent;
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 600;
          color: var(--pretui-toolrow-settled-ink, var(--muted-foreground));
          cursor: pointer;
        }
        /* a text action says it acts under the pointer in the link ink */
        .pretui-toolaction:hover:not([aria-disabled='true']) {
          color: var(--primary-ink);
        }
        .pretui-toolaction:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-toolaction-refusal {
          font-family: var(--font-sans);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--attention-ink);
        }
        .pretui-toolaction-refusal:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-toolaction[aria-disabled='true'] {
          cursor: default;
          color: var(--subtle-foreground);
        }
      }
    </style>
  </template>
}

// ── The header's contents ────────────────────────────────────────────────
// Shared by the button form (the row has a body) and the static form (it
// does not), so the two read identically.

interface ToolRowHeadingSignature {
  Args: {
    tone: WorkTone;
    /** the raw state, for the words: a canceled call is struck, a queued
     * one dimmed */
    state: string;
    /** the tool's own icon, the row's one fixed mark */
    icon: ToolIcon;
    verb?: string;
    running: boolean;
    title: string;
    subtitle?: string;
    source?: ToolSource;
    sourceTitle?: string;
    duration?: string;
    status: string;
    chevron: boolean;
    /** the duration stands in for the status word, so it never steps aside */
    timed?: boolean;
    open?: boolean;
    choice?: string;
    /** set in the machine register: the call shows in the title's place */
    call?: string;
  };
}

class ToolRowHeading extends Component<ToolRowHeadingSignature> {
  <template>
    {{! the tool's own icon is the row's mark; only a running call swaps it
        for the thin turning ring. The state is in the words }}
    <span class='pretui-toolrow-disc' data-tone={{@tone}} aria-hidden='true'>
      {{#if @running}}<PlanMark @state='current' @size={{14}} />{{else}}<@icon
          class='pretui-toolrow-icon'
          width='14'
          height='14'
        />{{/if}}
    </span>
    {{#if @verb}}
      <span
        class='pretui-toolrow-verb'
        data-test-pretui-tool-row-verb
      >{{@verb}}</span>
    {{/if}}
    {{#if @call}}
      {{! the machine register: the call itself, in the mono voice }}
      <span
        class='pretui-toolrow-title'
        data-tone={{@tone}}
        data-register='machine'
        data-state={{@state}}
        title={{@call}}
        data-test-pretui-tool-row-title
      >{{@call}}</span>
    {{else}}
      <span
        class='pretui-toolrow-title'
        data-tone={{@tone}}
        data-state={{@state}}
        title={{@title}}
        data-test-pretui-tool-row-title
      >{{@title}}</span>
    {{/if}}
    {{#if @choice}}
      <span
        class='pretui-toolrow-choice'
        data-test-pretui-tool-row-choice
      >{{@choice}}</span>
    {{/if}}
    {{#if @subtitle}}
      <span
        class='pretui-toolrow-subtitle'
        title={{@subtitle}}
        data-test-pretui-tool-row-subtitle
      >{{@subtitle}}</span>
    {{/if}}
    {{#if @source}}
      <span
        class='pretui-toolrow-source'
        title={{@sourceTitle}}
        data-source-kind={{@source.kind}}
        data-test-pretui-tool-row-source
      >
        <Chip @label={{@source.name}} @dot={{false}} />
      </span>
    {{/if}}
    <span
      class='pretui-toolrow-status'
      data-tone={{@tone}}
      data-state={{@state}}
      data-timed={{if @timed 'true'}}
      data-test-pretui-tool-row-status
    >
      {{#if @duration}}<span
          class='pretui-toolrow-duration'
          data-test-pretui-tool-row-duration
        >{{@duration}}</span>{{/if}}
      {{@status}}
    </span>
    {{#if @chevron}}
      <span
        class='pretui-toolrow-chevron'
        data-open={{if @open 'true'}}
        aria-hidden='true'
      ></span>
    {{/if}}
    <style scoped>
      @layer PretComponent {
        /* the verb is no kicker: the row's icon (toolIcon(name, verb))
           already says what kind of call this is, so the word is kept for a
           screen reader only. Density has no label of its own either: it
           is the row's frame (steps plain, the rest boxed). */
        .pretui-toolrow-verb {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-toolrow-disc {
          width: var(--pretui-toolrow-disc, var(--boxel-sp));
          height: var(--pretui-toolrow-disc, var(--boxel-sp));
          display: grid;
          place-items: center;
          flex: none;
          margin-block-start: calc(
            (
                var(--boxel-ui-label-line-height) -
                  var(--pretui-toolrow-disc, var(--boxel-sp))
              ) /
              2
          );
          /* the tool's icon in the quiet ink; a failure or a question tints
             it, and the words beside it say which */
          color: var(--subtle-foreground);
        }
        .pretui-toolrow-icon {
          display: block;
          stroke-width: 1.75;
        }
        .pretui-toolrow-disc[data-tone='failed'] {
          color: var(--destructive-ink);
        }
        .pretui-toolrow-disc[data-tone='attention'] {
          color: var(--attention-ink);
        }
        /* titles can be a whole sentence (an assistant's description of the
           call), so the title shrinks before the status does: the state in
           words must always stay visible */
        .pretui-toolrow-title[data-register='machine'] {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
        }
        /* the reader's answer, kept in the settled title as the thing they
           picked, not as prose */
        .pretui-toolrow-choice {
          flex: none;
          display: inline-flex;
          align-items: center;
          max-width: 40%;
          height: 1.125rem;
          padding: 0 var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--inset);
          box-shadow: inset 0 0 0 1px var(--border);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 400;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-toolrow-title {
          font-size: var(
            --pretui-toolrow-title-size,
            var(--boxel-ui-label-font-size)
          );
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 600;
          flex: 0 1 auto;
          min-width: 3em;
          /* one line: a column of calls stays short, and a long title runs
             off its end (whole on hover, and wrapped once the row is open) */
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* settled work says so in a quieter ink, never by fading: a screen
           of history must stay readable */
        .pretui-toolrow-title[data-tone='done'],
        .pretui-toolrow-title[data-tone='idle'] {
          font-weight: 400;
          color: var(--pretui-toolrow-settled-ink, var(--muted-foreground));
        }
        /* the state in the words: a running call's title shimmers, a queued
           one waits dimmed, a canceled or superseded one is struck */
        .pretui-toolrow-title[data-tone='running'] {
          background: linear-gradient(
              90deg,
              var(--foreground) 0%,
              var(--foreground) 40%,
              color-mix(in oklch, var(--foreground) 45%, transparent) 50%,
              var(--foreground) 60%,
              var(--foreground) 100%
            )
            0 0 / 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: pretui-toolrow-shimmer 2.4s linear infinite;
        }
        @keyframes pretui-toolrow-shimmer {
          from {
            background-position: 100% 0;
          }
          to {
            background-position: 0% 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-toolrow-title[data-tone='running'] {
            animation: none;
            background: none;
            color: var(--foreground);
          }
        }
        /* queued: the quietest ink, never faded with opacity */
        .pretui-toolrow-title[data-state='pending'] {
          color: var(--subtle-foreground);
        }
        .pretui-toolrow-title[data-state='canceled'],
        .pretui-toolrow-title[data-state='superseded'],
        .pretui-toolrow-title[data-state='reverted'] {
          text-decoration: line-through;
          text-decoration-color: color-mix(
            in oklch,
            currentColor 55%,
            transparent
          );
        }
        .pretui-toolrow-subtitle {
          min-width: 0;
          flex: 0 1 auto;
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          color: var(--muted-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-toolrow-source {
          flex: none;
          --pretui-chip-font-size: var(--boxel-caption-font-size);
        }
        .pretui-toolrow-status {
          margin-inline-start: auto;
          /* a caption line centred on the title's first line */
          margin-block-start: 1px;
          flex: none;
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--subtle-foreground);
          font-variant-numeric: tabular-nums;
        }
        /* a state colours the word, never the row */
        .pretui-toolrow-status[data-tone='attention'] {
          color: var(--attention-ink);
          font-weight: 600;
        }
        .pretui-toolrow-status[data-tone='failed'] {
          color: var(--destructive-ink);
          font-weight: 600;
        }
        .pretui-toolrow-duration {
          color: var(--muted-foreground);
          font-weight: 400;
        }
        .pretui-toolrow-chevron {
          flex: none;
          width: 0.375rem;
          height: 0.375rem;
          margin-block-start: 0.375rem;
          border-inline-end: 1.5px solid var(--subtle-foreground);
          border-block-end: 1.5px solid var(--subtle-foreground);
          transform: rotate(-45deg);
          transition: transform 160ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        .pretui-toolrow-chevron[data-open] {
          transform: rotate(45deg);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-toolrow-chevron {
            transition: none;
          }
        }
      }
    </style>
  </template>
}

// ── ToolRow ──────────────────────────────────────────────────────────────

export interface ToolRowSignature {
  Args: {
    /** the tool's name, e.g. 'patch-fields', 'read_realm_file'. It picks
     * the row's icon (toolIcon) unless `@icon` does */
    name: string;
    /** the row's mark: a boxel-icons component. Default: toolIcon(name, verb) */
    icon?: ToolIcon;
    /** WorkItem's open state vocabulary, plus `streaming` while the
     * arguments are still arriving */
    state?: string;
    /** default: the renderer's title, else the humanized name */
    title?: string;
    /** what the tool acted on: the file, the command, the query. Default:
     * the renderer's subtitle(params) */
    subtitle?: string;
    /** which skill (or the platform) granted this tool */
    source?: ToolSource;
    /** overrides the state's default phrase, as in WorkItem */
    status?: string;
    /** seconds the call took; shown once it settles */
    duration?: number;
    /** the failure; its first line shows under the row, the whole of it in
     * the body */
    error?: string;
    /** the call's arguments (raw text while streaming) and result, handed
     * to the body. `@params` because `@args` is reserved in templates. */
    params?: unknown;
    result?: unknown;
    renderers?: ToolRenderers;
    /** controlled disclosure */
    open?: boolean;
    /** uncontrolled initial disclosure. Default: open when the call failed
     * or needs the reader, closed otherwise */
    defaultOpen?: boolean;
    /** fires when the reader toggles the row */
    onOpenChange?: (open: boolean) => void;
    /** mount the body through the shared bottom-first queue. Default true */
    lazy?: boolean;
    /** CSS length the body reserves while it waits to mount. Default 0 */
    reserve?: string;
    /** whether settled work recedes. Default: a done, canceled or reverted
     * call recedes; a running, failed or needs-you call never does. It only
     * shows inside a container that sets --pretui-recede-opacity */
    recede?: boolean;
    /* Knobs a container sets on the row's class:
     * --pretui-toolrow-settled-pill-ink / --pretui-toolrow-settled-pill-weight
     *   the color and weight of card pills in a settled row
     * --pretui-toolrow-header-pad-block / --pretui-toolrow-header-min-h
     *   the header's block padding and least height (0.4375rem, 2rem) */
    /** how much of the transcript the call claims. It sets `data-density`;
     * the row says it through its frame (@framed), never with a label */
    density?: ToolDensity;
    /** a fixed verb before the title: READ, UPDATE, RESEARCH. The verb never
     * moves; only the title after it changes */
    verb?: string;
    /** a multi-step call's position; shows under the header while the call
     * is not settled */
    progress?: ToolProgress;
    /** draw the row as a box: for actions, runs and scripts, whose rows,
     * gate, result and receipt belong together. Steps stay unframed */
    framed?: boolean;
    /** a closing line: run id, preview hash, bytes read. Its action goes in
     * the `receipt` block */
    receipt?: string;
    /** answer the call from its result renderer (`renderer.result`); the
     * row hands it on only while the call needs the reader */
    resolve?: (value: unknown) => unknown;
    /** what the reader picked, kept in the settled title as a pill:
     * "Chose the layout [Compact]" */
    choice?: string;
    /** the call as the machine wrote it: `read_file("plan.gts")` */
    call?: string;
    /** 'editorial' (default) titles the row in words; 'machine' shows
     * @call in the title's place, for a reader who wants the calls */
    register?: 'editorial' | 'machine';
  };
  Blocks: {
    body: [];
    actions: [];
    error: [];
    /** lines on the rail under the header, always visible: what happened.
     * Use ToolLine */
    rows: [];
    /** the decision this call waits on, inside the row */
    gate: [];
    /** the final thing the call produced, such as the card it made */
    result: [];
    /** the one action the receipt still offers: Undo, Stop */
    receipt: [];
  };
  Element: HTMLDivElement;
}

/** Calls back on install and whenever the value changes. */
const watch = modifier(
  (
    _el: HTMLElement,
    [callback, value]: [(value: unknown) => void, unknown],
  ) => {
    callback(value);
  },
);

/**
 * One tool call.
 *
 * ```hbs
 * <ToolRow @name='patch-fields' @subtitle='Model/base-plate' @state={{call.state}}
 *          @source={{hash kind='skill' name='3d-modeling'}} @duration={{call.seconds}}>
 *   <:body><FieldDiff @changes={{call.result.changes}} /></:body>
 *   <:actions><Button @size='s'>Apply</Button></:actions>
 * </ToolRow>
 * ```
 *
 * Better than WorkItem for this job, on the gaps WorkItem's own write-up
 * lists: state changes into "needs you" and "failed" are announced through a
 * live region present from the first render, the glyph is aria-hidden, the
 * row is a labelled group, and the disclosure is a real button.
 */
export class ToolRow extends Component<ToolRowSignature> {
  /** the reader's choice; once set, @defaultOpen no longer moves the row */
  @tracked private userOpen: boolean | undefined;
  @tracked mounted = false;
  private cancelMount: (() => void) | undefined;
  readonly bodyId = guidFor(this) + '-body';

  get state(): string {
    return this.args.state ?? 'pending';
  }
  get machineCall(): string | undefined {
    return this.args.register === 'machine' ? this.args.call : undefined;
  }
  get isStreaming(): boolean {
    return this.state === 'streaming';
  }
  get tone(): WorkTone {
    return this.isStreaming ? 'running' : workTone(this.state);
  }
  get icon(): ToolIcon {
    return this.args.icon ?? toolIcon(this.args.name, this.args.verb);
  }
  get isRunning(): boolean {
    return this.tone === 'running';
  }
  /** a completed call whose time is its whole state */
  get isTimed(): boolean {
    return (
      !this.args.status && this.state === 'completed' && !!this.durationText
    );
  }
  get statusText(): string {
    if (this.args.status) {
      return this.args.status;
    }
    // a completed call with a time says only the time: its title in the
    // settled ink already reads as finished. The other done states (kept,
    // delivered, partly kept) say more than "finished", so their word stays
    if (this.isTimed) {
      return '';
    }
    return this.isStreaming ? 'preparing…' : workStatus(this.state);
  }
  get renderer(): ToolRenderer | undefined {
    return this.args.renderers?.[this.args.name];
  }
  get title(): string {
    return (
      this.args.title ??
      this.renderer?.title ??
      humanizeToolName(this.args.name)
    );
  }
  get subtitle(): string | undefined {
    if (this.args.subtitle !== undefined) {
      return this.args.subtitle;
    }
    if (this.isStreaming || !this.renderer?.subtitle) {
      return undefined;
    }
    try {
      return this.renderer.subtitle(this.args.params);
    } catch {
      return undefined;
    }
  }
  get rendererResult(): ComponentLike<ToolResultSignature> | undefined {
    return this.renderer?.result;
  }
  /** the resolver, only while the call waits on the reader */
  get resolver(): ((value: unknown) => unknown) | undefined {
    return this.tone === 'attention' ? this.args.resolve : undefined;
  }
  // When the gate's controls leave (the decision was made) while focus is
  // in them, focus would fall to the page; it goes to the row's header
  // instead, so a keyboard reader stays where they were. Runtime lookups use
  // the data-toolrow attributes, never the styling classes.
  watchGate = modifier((element: HTMLElement) => {
    // the control in the gate that last had focus; cleared once focus
    // moves somewhere real outside the gate, or once it is handed on
    let held: Element | undefined;
    // whether the reader reached the gate by keyboard: only then does the
    // header show its ring when focus lands on it
    let keyboard = false;
    let onFocusIn = (event: FocusEvent) => {
      held = event.target as Element;
      keyboard = held.matches(':focus-visible');
    };
    // focus that moves somewhere real outside the gate clears `held`. A
    // blur with no related target is either a removed control (the
    // decision) or the reader leaving for blank page space or another
    // window; only the second leaves the control connected, and then the
    // reader has moved on, so a later change in the gate moves no focus
    let onFocusOut = (event: FocusEvent) => {
      let to = event.relatedTarget as Node | null;
      if (to) {
        if (!element.contains(to)) {
          held = undefined;
        }
        return;
      }
      let left = event.target as Element;
      queueMicrotask(() => {
        if (held === left && left.isConnected) {
          held = undefined;
        }
      });
    };
    let observer = new MutationObserver(() => {
      if (!held || held.isConnected) {
        return;
      }
      held = undefined;
      let active = document.activeElement;
      if (active && active !== document.body) {
        // focus already went somewhere on purpose
        return;
      }
      let header = element
        .closest('[data-toolrow]')
        ?.querySelector<HTMLElement>('[data-toolrow-header]');
      if (header) {
        if (header.tagName !== 'BUTTON' && !header.hasAttribute('tabindex')) {
          header.setAttribute('tabindex', '-1');
        }
        if (!keyboard) {
          header.setAttribute('data-quiet-focus', '');
          header.addEventListener(
            'blur',
            () => header.removeAttribute('data-quiet-focus'),
            { once: true },
          );
        }
        header.focus({ preventScroll: true });
      }
    });
    observer.observe(element, { childList: true, subtree: true });
    element.addEventListener('focusin', onFocusIn);
    element.addEventListener('focusout', onFocusOut);
    return () => {
      observer.disconnect();
      element.removeEventListener('focusin', onFocusIn);
      element.removeEventListener('focusout', onFocusOut);
    };
  });
  get rendererBody(): ComponentLike<ToolBodySignature> | undefined {
    return this.renderer?.body;
  }
  get hasDefaultBody(): boolean {
    return (
      this.args.params !== undefined ||
      this.args.result !== undefined ||
      Boolean(this.args.error)
    );
  }
  get errorFirstLine(): string | undefined {
    return this.args.error?.split('\n', 1)[0];
  }
  get durationText(): string | undefined {
    if (
      this.args.duration === undefined ||
      (this.tone !== 'done' && this.tone !== 'failed')
    ) {
      return undefined;
    }
    return formatToolDuration(this.args.duration);
  }
  get sourceTitle(): string | undefined {
    let source = this.args.source;
    if (!source) {
      return undefined;
    }
    return source.kind === 'skill'
      ? `Granted by the ${source.name} skill`
      : `Built-in tool: ${source.name}`;
  }
  get defaultOpen(): boolean {
    return (
      this.args.defaultOpen ??
      (this.tone === 'failed' || this.tone === 'attention')
    );
  }
  get isOpen(): boolean {
    return this.args.open ?? this.userOpen ?? this.defaultOpen;
  }
  get recedes(): boolean {
    if (this.args.recede !== undefined) {
      return this.args.recede;
    }
    // a run reconnecting after a reload is still live work, only unseen
    return (
      this.tone === 'done' ||
      (this.tone === 'idle' && this.state !== 'reconnecting')
    );
  }
  get lazy(): boolean {
    return this.args.lazy ?? true;
  }
  get showBody(): boolean {
    return !this.lazy || this.mounted;
  }
  get reserveStyle(): SafeString | undefined {
    return this.args.reserve
      ? htmlSafe(`min-height: ${this.args.reserve}`)
      : undefined;
  }
  /** What the live region says. Only the two transitions a reader must hear
   * about are announced: the call now needs them, or it failed. */
  get announcement(): string {
    if (this.tone === 'attention') {
      return `${this.title}: needs you`;
    }
    if (this.tone === 'failed') {
      return `${this.title}: failed`;
    }
    return '';
  }
  /** Polite, so a group whose calls fail together does not interrupt the
   * reader once per row; only a call that now needs them is assertive. */
  get liveness(): 'assertive' | 'polite' {
    return this.tone === 'attention' ? 'assertive' : 'polite';
  }

  /** Progress belongs to work in flight; a settled call says what it did in
   * its title and rows instead. */
  get showProgress(): boolean {
    return (
      Boolean(this.args.progress) &&
      this.tone !== 'done' &&
      this.tone !== 'failed' &&
      this.tone !== 'idle'
    );
  }
  get progressLabel(): string {
    return this.args.progress ? progressText(this.args.progress) : '';
  }
  get progressFill(): SafeString {
    let percent = this.args.progress ? progressPercent(this.args.progress) : 0;
    return htmlSafe(`width: ${percent}%`);
  }
  get progressValue(): number {
    return this.args.progress ? progressPercent(this.args.progress) : 0;
  }

  toggle = () => {
    let next = !this.isOpen;
    if (this.args.open === undefined) {
      this.userOpen = next;
    }
    this.args.onOpenChange?.(next);
  };

  /** Runs on install and on every change of the effective open state. */
  openChanged = (value: unknown) => {
    if (!value) {
      // closed before its turn came: it never mounts
      this.cancelMount?.();
      this.cancelMount = undefined;
      return;
    }
    if (!this.lazy || this.mounted || this.cancelMount) {
      return;
    }
    this.cancelMount = scheduleMount(() => {
      this.cancelMount = undefined;
      if (!this.isDestroying && !this.isDestroyed) {
        this.mounted = true;
      }
    });
  };

  willDestroy() {
    super.willDestroy();
    this.cancelMount?.();
  }

  <template>
    <div
      class='pretui-toolrow'
      role='group'
      data-toolrow
      aria-label={{this.title}}
      data-state={{this.state}}
      data-tone={{this.tone}}
      data-open={{if this.isOpen 'true' 'false'}}
      data-mounted={{if this.showBody 'true' 'false'}}
      data-recede={{if this.recedes 'true'}}
      data-framed={{if @framed 'true'}}
      data-density={{@density}}
      data-test-pretui-tool-row
      ...attributes
    >
      {{#let
        (either (has-block 'body') this.rendererBody this.hasDefaultBody)
        as |hasBody|
      }}
        <div class='pretui-toolrow-row' {{watch this.openChanged this.isOpen}}>
          {{#if hasBody}}
            <button
              type='button'
              class='pretui-toolrow-header'
              aria-expanded={{if this.isOpen 'true' 'false'}}
              aria-controls={{this.bodyId}}
              data-toolrow-header
              {{on 'click' this.toggle}}
              data-test-pretui-tool-row-toggle
            >
              <ToolRowHeading
                @tone={{this.tone}}
                @state={{this.state}}
                @icon={{this.icon}}
                @verb={{@verb}}
                @running={{this.isRunning}}
                @title={{this.title}}
                @subtitle={{this.subtitle}}
                @source={{@source}}
                @sourceTitle={{this.sourceTitle}}
                @duration={{this.durationText}}
                @status={{this.statusText}}
                @timed={{this.isTimed}}
                @chevron={{true}}
                @open={{this.isOpen}}
                @choice={{@choice}}
                @call={{this.machineCall}}
              />
            </button>
          {{else}}
            <div class='pretui-toolrow-header' data-toolrow-header>
              <ToolRowHeading
                @tone={{this.tone}}
                @state={{this.state}}
                @icon={{this.icon}}
                @verb={{@verb}}
                @running={{this.isRunning}}
                @title={{this.title}}
                @subtitle={{this.subtitle}}
                @source={{@source}}
                @sourceTitle={{this.sourceTitle}}
                @duration={{this.durationText}}
                @status={{this.statusText}}
                @timed={{this.isTimed}}
                @chevron={{false}}
                @choice={{@choice}}
                @call={{this.machineCall}}
              />
            </div>
          {{/if}}
          {{#if (has-block 'actions')}}
            <div
              class='pretui-toolrow-actions'
              data-test-pretui-tool-row-actions
            >
              {{yield to='actions'}}
            </div>
          {{/if}}
        </div>
        {{#if this.showProgress}}
          <div
            class='pretui-toolrow-progress'
            data-test-pretui-tool-row-progress
          >
            <span
              class='pretui-toolrow-progress-label'
            >{{this.progressLabel}}</span>
            <span
              class='pretui-toolrow-progress-track'
              role='progressbar'
              aria-label={{this.progressLabel}}
              aria-valuemin='0'
              aria-valuemax='100'
              aria-valuenow={{this.progressValue}}
            ><span
                class='pretui-toolrow-progress-fill'
                style={{this.progressFill}}
              ></span></span>
          </div>
        {{/if}}
        {{#if (has-block 'rows')}}
          <div class='pretui-toolrow-rows' data-test-pretui-tool-row-rows>
            {{yield to='rows'}}
          </div>
        {{/if}}
        {{#if this.errorFirstLine}}
          {{#unless this.isOpen}}
            <div
              class='pretui-toolrow-errorline'
              data-test-pretui-tool-row-error-line
            >
              {{this.errorFirstLine}}
            </div>
          {{/unless}}
        {{/if}}
        {{#if hasBody}}
          <Collapse @open={{this.isOpen}} id={{this.bodyId}}>
            <div class='pretui-toolrow-body' data-test-pretui-tool-row-body>
              {{#if this.showBody}}
                {{#if @error}}
                  {{#if (has-block 'error')}}
                    {{yield to='error'}}
                  {{else}}
                    <pre
                      class='pretui-toolrow-error'
                      data-test-pretui-tool-row-error
                    >{{@error}}</pre>
                  {{/if}}
                {{/if}}
                {{#if (has-block 'body')}}
                  {{yield to='body'}}
                {{else if this.rendererBody}}
                  <this.rendererBody
                    @params={{@params}}
                    @result={{@result}}
                    @state={{this.state}}
                  />
                {{else}}
                  <GenericToolBody
                    @params={{@params}}
                    @result={{@result}}
                    @state={{this.state}}
                  />
                {{/if}}
              {{else}}
                <div
                  class='pretui-toolrow-reserve'
                  style={{this.reserveStyle}}
                  aria-hidden='true'
                  data-test-pretui-tool-row-reserve
                ></div>
              {{/if}}
            </div>
          </Collapse>
        {{/if}}
      {{/let}}
      {{#if (has-block 'gate')}}
        <div
          class='pretui-toolrow-gate'
          {{this.watchGate}}
          data-test-pretui-tool-row-gate
        >
          {{yield to='gate'}}
        </div>
      {{/if}}
      {{#if (has-block 'result')}}
        <div class='pretui-toolrow-result' data-test-pretui-tool-row-result>
          {{yield to='result'}}
        </div>
      {{else if this.rendererResult}}
        <div class='pretui-toolrow-result' data-test-pretui-tool-row-result>
          <this.rendererResult
            @params={{@params}}
            @result={{@result}}
            @state={{this.state}}
            @resolve={{this.resolver}}
          />
        </div>
      {{/if}}
      {{#if (either @receipt (has-block 'receipt'))}}
        <div class='pretui-toolrow-receipt' data-test-pretui-tool-row-receipt>
          <span
            class='pretui-toolrow-receipt-text'
            data-test-pretui-tool-row-receipt-text
          >{{@receipt}}</span>
          {{#if (has-block 'receipt')}}
            <span class='pretui-toolrow-receipt-action'>{{yield
                to='receipt'
              }}</span>
          {{/if}}
        </div>
      {{/if}}
      <span
        class='pretui-toolrow-live'
        role='status'
        aria-live={{this.liveness}}
        data-test-pretui-tool-row-live
      >{{this.announcement}}</span>
    </div>
    <style scoped>
      @layer PretComponent {
        /* ── one grid ─────────────────────────────────────────────────
           Every part of a row hangs off three numbers: the inset, the
           disc, and the gap after it. Everything under the header starts
           at the text column (inset + disc + gap), so the progress line,
           the rows, the body, the gate, the result and the receipt all
           share one left edge with the title, and a nested ToolLine puts
           its own glyph on that edge. Framed rows widen the inset and
           nothing else, so the parts recombine the same way in both. */
        /* every row, framed or not, hangs its inset outside the text edge:
           its disc sits in the transcript's one mark column (with the
           speaker's initial, the system lines' icons and the fold row's
           check) and its title on the one title edge, so a column of steps
           and boxed calls never zig-zags. A frame is drawn in the gutter */
        .pretui-toolrow {
          margin-inline: calc(-1 * var(--pretui-toolrow-inset));
        }
        .pretui-toolrow {
          --pretui-toolrow-inset: var(--boxel-sp-xs);
          --pretui-toolrow-disc: var(--boxel-sp);
          --pretui-toolrow-gap: var(--boxel-sp-xs);
          --pretui-toolrow-text: calc(
            var(--pretui-toolrow-inset) + var(--pretui-toolrow-disc) +
              var(--pretui-toolrow-gap)
          );
          display: flex;
          flex-direction: column;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          border-radius: var(--boxel-border-radius-sm);
          /* one rounded box per row: it clips what meets its edge (the
             header's hover, the receipt's rule), and nothing inside it
             rounds again */
          overflow: clip;
          /* the row answers its own width, not the window's: the same row
             in a 320px side panel and a 680px one reads right in both */
          container-type: inline-size;
          container-name: pretui-toolrow;
          /* off-screen rows skip layout and paint; the browser remembers each
             row's last size, so the scrollbar does not jump */
          content-visibility: auto;
          contain-intrinsic-size: auto 2rem;
        }
        /* the prominence ramp: settled work recedes, the live frontier and
           anything needing the reader stay at full strength. Off unless a
           container sets the token; hover or focus brings a row back. */
        .pretui-toolrow-row {
          transition: opacity 200ms linear;
        }
        .pretui-toolrow[data-recede] > .pretui-toolrow-row {
          opacity: var(--pretui-recede-opacity, 1);
        }
        .pretui-toolrow[data-recede]:is(:hover, :focus-within)
          > .pretui-toolrow-row {
          opacity: 1;
        }
        /* a settled row hands its card pills the ink and weight its
           container names for them, so they recede with the row instead
           of standing out bright over it. Unset, the settled values are
           invalid and the pills fall back to their own knobs */
        .pretui-toolrow[data-recede] {
          --pretui-cardpill-settled-ink: var(--pretui-toolrow-settled-pill-ink);
          --pretui-cardpill-settled-weight: var(
            --pretui-toolrow-settled-pill-weight
          );
        }
        /* an open row has room to say all of it, and a row that needs the
           reader says all of what it asks: its title wraps */
        .pretui-toolrow:is([data-open='true'], [data-tone='attention'])
          > .pretui-toolrow-row
          :deep(.pretui-toolrow-title) {
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .pretui-toolrow-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          min-width: 0;
        }
        /* everything in the header sits on the title's first line, so a
           title that wraps keeps its icon, status and chevron level with
           the words they belong to: the block padding plus one label
           line is the 2rem row */
        .pretui-toolrow-header {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: flex-start;
          gap: var(--pretui-toolrow-gap);
          padding: var(--pretui-toolrow-header-pad-block, 0.4375rem)
            var(--pretui-toolrow-inset);
          min-height: var(--pretui-toolrow-header-min-h, 2rem);
          box-sizing: border-box;
          border: 0;
          /* square: the row is the one box that rounds, and clips this */
          border-radius: 0;
          background-color: transparent;
          color: inherit;
          font-family: inherit;
          font-size: inherit;
          font-weight: inherit;
          line-height: inherit;
          text-align: start;
        }
        button.pretui-toolrow-header {
          cursor: pointer;
        }
        button.pretui-toolrow-header:hover {
          background-color: var(--inset);
        }
        /* both header forms: the static one takes focus when a gate hands
           it back on a row with no body */
        .pretui-toolrow-header:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        /* focus handed over after a click on the gate: kept for the next
           Tab, but drawn only for a keyboard reader */
        .pretui-toolrow-header[data-quiet-focus]:focus-visible {
          outline: none;
        }
        .pretui-toolrow-actions {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          flex: none;
          padding-inline-end: var(--pretui-toolrow-inset);
        }
        /* a failure's first line reads in ink: the status word and the
           mark carry the state, never red text */
        .pretui-toolrow-errorline {
          padding: 0 var(--pretui-toolrow-inset) var(--boxel-sp-xs)
            var(--pretui-toolrow-text);
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-toolrow-body {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-6xs) var(--pretui-toolrow-inset)
            var(--boxel-sp-xs) var(--pretui-toolrow-text);
          min-width: 0;
        }
        /* the sections under the header, in reading order. Each owns its
           bottom spacing, so any subset stacks evenly. */
        .pretui-toolrow-progress {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
          padding: 0 var(--pretui-toolrow-inset) var(--boxel-sp-xs)
            var(--pretui-toolrow-text);
        }
        .pretui-toolrow-progress-label {
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
        }
        .pretui-toolrow-progress-track {
          display: block;
          height: 0.1875rem;
          border-radius: var(--boxel-border-radius-2xs);
          overflow: hidden;
          background-color: var(--inset);
        }
        .pretui-toolrow-progress-fill {
          display: block;
          height: 100%;
          background-color: var(--primary);
          transition: width 200ms
            var(--pretui-ease, cubic-bezier(0.2, 0, 0.2, 1));
        }
        .pretui-toolrow-rows {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
          padding: 0 var(--pretui-toolrow-inset) var(--boxel-sp-xs)
            var(--pretui-toolrow-text);
          min-width: 0;
        }
        .pretui-toolrow-gate {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          margin: 0 var(--pretui-toolrow-inset) var(--boxel-sp-xs)
            var(--pretui-toolrow-text);
          padding: var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-sm);
          /* the question is a surface, not an alarm: the row's status word
             and mark carry the attention colour */
          background-color: var(--inset);
          box-shadow: inset 0 0 0 1px var(--border);
        }
        /* a framed row is already the box (and ringed in the attention
           colour while it needs the reader): its gate draws no second box,
           it is the row's next lines. A gate waiting on someone else, in an
           idle row, gets no attention box either */
        .pretui-toolrow[data-framed] > .pretui-toolrow-gate {
          padding: 0;
          border-radius: 0;
          background-color: transparent;
          box-shadow: none;
        }
        .pretui-toolrow-result {
          padding: 0 var(--pretui-toolrow-inset) var(--boxel-sp-xs)
            var(--pretui-toolrow-text);
          min-width: 0;
        }
        .pretui-toolrow-receipt {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: 1.875rem;
          padding: 0 var(--pretui-toolrow-inset) 0 var(--pretui-toolrow-text);
          box-shadow: 0 -1px 0 var(--border);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
          color: var(--subtle-foreground);
        }
        .pretui-toolrow-receipt-text {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-toolrow-receipt-action {
          flex: none;
          font-family: var(--font-sans);
        }
        /* three widths, one grid. Narrow (a 320px panel): the subtitle and
           the duration step aside so the title and its state keep their
           room; the verb stays, it says what kind of call this is. Wide
           (680px): the subtitle may run longer. The grid itself never
           changes, so nothing under the header moves. */
        @container pretui-toolrow (max-width: 359px) {
          .pretui-toolrow-subtitle,
          .pretui-toolrow-status:not([data-timed]) .pretui-toolrow-duration {
            display: none;
          }
          /* narrow, the grid gives its width back to the words: the small
             inset framed or not, and a smaller gap. Every part reads these,
             so they move together */
          .pretui-toolrow > * {
            --pretui-toolrow-inset: var(--boxel-sp-xs);
            --pretui-toolrow-gap: var(--boxel-sp-2xs);
            --pretui-toolrow-text: calc(
              var(--pretui-toolrow-inset) + var(--pretui-toolrow-disc) +
                var(--pretui-toolrow-gap)
            );
          }
          /* a completed call's title in the settled ink already reads as
             finished, so its word steps aside. The other done states (kept,
             delivered, partly kept) keep theirs, and a time always stays */
          .pretui-toolrow-status[data-state='completed']:not([data-timed]) {
            display: none;
          }
        }
        @container pretui-toolrow (min-width: 600px) {
          .pretui-toolrow-subtitle {
            flex-shrink: 0.4;
          }
        }
        /* Glimmer passes a named block or not, never "sometimes", so a host
           whose gate or rows are conditional passes the block and lets its
           content come and go. A section that renders no element takes no
           space: no empty box, no stray gap. */
        .pretui-toolrow-actions:not(:has(:not([hidden]))),
        .pretui-toolrow-receipt:has(.pretui-toolrow-receipt-text:empty):not(
            :has(.pretui-toolrow-receipt-action *)
          ),
        .pretui-toolrow-rows:not(:has(*)),
        .pretui-toolrow-gate:not(:has(*)),
        .pretui-toolrow-result:not(:has(*)) {
          display: none;
        }
        /* framed: the same grid with a wider inset, in a box whose ring
           carries the state. A framed row closes with its own padding when
           it has no receipt to close it. */
        .pretui-toolrow[data-framed] {
          --pretui-toolrow-inset: var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--card);
          box-shadow: 0 0 0 1px var(--border);
          overflow: hidden;
        }
        /* a sliver above the header and below the last section, added to
           each section's own bottom spacing. A receipt is the box's floor,
           so it takes the sliver back and sits flush */
        .pretui-toolrow[data-framed] {
          --_toolrow-edge: var(--boxel-sp-6xs);
          padding-block: var(--_toolrow-edge);
        }
        .pretui-toolrow[data-framed] > .pretui-toolrow-receipt {
          margin-block-end: calc(-1 * var(--_toolrow-edge));
        }
        /* a receipt with neither words nor an action takes no line */
        .pretui-toolrow-receipt:not(
            :has(.pretui-toolrow-receipt-text:not(:empty))
          ):not(:has(.pretui-toolrow-receipt-action *)) {
          display: none;
        }
        /* a framed row with nothing under its header (a settled call whose
           detail is closed) is one line: it reads as a plain row, so a
           column of finished calls does not become a column of boxes. The
           frame returns as soon as anything shows under the header */
        .pretui-toolrow[data-framed]:not([data-open='true']):not(
            [data-tone='attention'],
            [data-tone='failed'],
            [data-tone='running']
          ):not(
            :has(
              > .pretui-toolrow-progress,
              > .pretui-toolrow-rows > *,
              > .pretui-toolrow-gate > *,
              > .pretui-toolrow-result > *,
              > .pretui-toolrow-receipt .pretui-toolrow-receipt-text:not(:empty)
            )
          ) {
          --pretui-toolrow-inset: var(--boxel-sp-xs);
          background-color: transparent;
          box-shadow: none;
          padding-block: 0;
        }
        /* a framed row's ring stays the border in every state: a state
           colours the mark and the word, never the row */
        .pretui-toolrow[data-framed] button.pretui-toolrow-header:hover {
          background-color: var(--hover);
        }
        /* the whole failure is pasteable text: mono, in ink, on the inset
           well, not a red box */
        .pretui-toolrow-error {
          margin: 0;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-xs);
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          color: var(--foreground);
          background-color: var(--inset);
        }
        .pretui-toolrow-live {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
      }
    </style>
  </template>
}
