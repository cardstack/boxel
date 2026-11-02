// Pretui — ToolGroup: a run of consecutive tool calls folded into one receipt line ("Used 12 tools · Read, Patch fields and Search"), with a rolling count while the run grows, a header that stays in view while you read inside it, and merging of repetitive runs.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { cssNumber } from '../pretui-css';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import type { SafeString } from '@ember/template';
import { Collapse } from '../internal/agentic-chat';
import { Odometer } from './odometer';
import { PlanMark } from './plan-mark';
import PointIcon from '@cardstack/boxel-icons/point';
import StackIcon from '@cardstack/boxel-icons/stack-2';
import { ToolRow, humanizeToolName } from './tool-row';
import type { ToolRenderers, ToolSource } from './tool-row';
import {
  KIND_PHRASES,
  joinPhrases,
  listSeparators,
  phraseRun,
} from '../internal/tool-phrases';
import type {
  PhraseItem,
  ToolKind,
  ToolPhrase,
} from '../internal/tool-phrases';
import { workTone } from './work-item';
import type { WorkTone } from './work-item';

export interface ToolPart {
  /** stable: the tool call id */
  id: string;
  name: string;
  state: string;
  subtitle?: string;
  source?: ToolSource;
  /** seconds */
  duration?: number;
  error?: string;
  params?: unknown;
  result?: unknown;
  /** drives phrasing and merging. Default: the renderer's kind, else
   * 'other' */
  kind?: ToolKind;
}

/** How the receipt reads: what the calls did ('kind', the default: "Read 3
 * files and edited 1 file"), or which tools they used ('names': "Used 4
 * tools · Read and Patch fields"). */
export type ToolGroupPhrasing = 'kind' | 'names';

export type ToolGroupMerge = 'none' | 'reads' | 'all';

/** One rendered row: a single call, or a merged run of reads or writes. */
export interface ToolGroupEntry {
  /** the first call's id, so a run that grows keeps its key */
  id: string;
  merged: boolean;
  kind: ToolKind;
  parts: ToolPart[];
  title: string;
  subtitle?: string;
  state: string;
  duration?: number;
}

export interface ToolGroupSummary {
  /** what the calls did, grouped by phrase in order of first use */
  phrases: PhraseItem[];
  /** the phrases as one list, in English */
  text: string;
  count: number;
  names: string[];
  /** the names as one list, in English, truncated after @maxNames */
  list: string;
  failed: number;
  tone: WorkTone;
  pending: boolean;
}

export interface ToolGroupSignature {
  Args: {
    /** the calls in this group, in order */
    tools: ToolPart[];
    renderers?: ToolRenderers;
    /** controlled disclosure */
    open?: boolean;
    /** uncontrolled initial disclosure. Default false */
    defaultOpen?: boolean;
    /** fires when the reader toggles the group */
    onOpenChange?: (open: boolean) => void;
    /** more calls may still arrive: the count rolls and a spinner shows */
    pending?: boolean;
    /** override the derived receipt text */
    summary?: string;
    /** 'kind' (default): what the calls did. 'names': which tools they used */
    phrasing?: ToolGroupPhrasing;
    /** whether a settled, closed group recedes. Default: when it is done and
     * not pending. It only shows inside a container that sets
     * --pretui-recede-opacity */
    recede?: boolean;
    /** while open, the header sticks inside the scroll container. Default true */
    sticky?: boolean;
    /** CSS length below which the header sticks. Default 0 */
    stickyOffset?: string;
    /** an open group shows about this many rows and scrolls the rest inside
     * itself, so forty calls never push the transcript forty rows down.
     * Default 8; 0 for no limit */
    maxRows?: number;
    /** merge consecutive reads ('reads'), and writes to distinct targets too
     * ('all', the default), into one row */
    merge?: ToolGroupMerge;
    /** tool names listed before "N more". Default 4 */
    maxNames?: number;
  };
  Blocks: {
    tool: [ToolGroupEntry];
    summary: [ToolGroupSummary];
  };
  Element: HTMLDivElement;
}

const TONE_RANK: Record<WorkTone, number> = {
  attention: 4,
  failed: 3,
  running: 2,
  idle: 1,
  done: 0,
};

function toneOf(state: string): WorkTone {
  return state === 'streaming' ? 'running' : workTone(state);
}

function scrollParent(el: HTMLElement): HTMLElement | undefined {
  let node = el.parentElement;
  while (node) {
    let overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return undefined;
}

function firstPart(entry: ToolGroupEntry): ToolPart {
  return entry.parts[0]!;
}

const registerElement = modifier(
  (el: HTMLElement, [register]: [(el: HTMLElement) => void]) => {
    register(el);
  },
);

/** Reports the open state on install and on change, so the rows render
 * after the first open even when a call needing the reader opened it. */
const noteOpen = modifier(
  (_el: HTMLElement, [callback, open]: [(open: boolean) => void, boolean]) => {
    callback(open);
  },
);

/**
 * A run of tool calls as one receipt.
 *
 * ```hbs
 * <ToolGroup @tools={{group.tools}} @renderers={{this.toolRenderers}}
 *            @pending={{group.isLive}} @stickyOffset='var(--session-header-height)' />
 * ```
 *
 * The attention state is part of the group's tone, so a call that needs
 * the reader opens a collapsed group instead of hiding inside it; merging
 * is a knob; and the rows inside a group that has never been opened are not
 * rendered at all.
 */
export class ToolGroup extends Component<ToolGroupSignature> {
  @tracked private userOpen: boolean | undefined;
  /** rows render only once the group has been open: a closed group of forty
   * calls costs one header */
  @tracked private everOpened = false;
  readonly bodyId = guidFor(this) + '-rows';
  private root: HTMLElement | undefined;

  get tools(): ToolPart[] {
    return this.args.tools ?? [];
  }
  get maxNames(): number {
    return Math.max(1, this.args.maxNames ?? 4);
  }
  get merge(): ToolGroupMerge {
    return this.args.merge ?? 'all';
  }

  private titleOf(part: ToolPart): string {
    return (
      this.args.renderers?.[part.name]?.title ?? humanizeToolName(part.name)
    );
  }
  private kindOf(part: ToolPart): ToolKind {
    return part.kind ?? this.args.renderers?.[part.name]?.kind ?? 'other';
  }
  private phraseOf = (part: ToolPart): ToolPhrase =>
    this.args.renderers?.[part.name]?.phrase ?? KIND_PHRASES[this.kindOf(part)];

  get phrasing(): ToolGroupPhrasing {
    return this.args.phrasing ?? 'kind';
  }
  /** The call the run is on now, whose phrase reads in the present tense:
   * the newest call while the group is pending or it is still running. */
  private get activeIndex(): number | undefined {
    let last = this.tools.length - 1;
    if (last < 0) {
      return undefined;
    }
    let lastRunning = toneOf(this.tools[last]!.state) === 'running';
    return this.args.pending || lastRunning ? last : undefined;
  }
  get phrases(): PhraseItem[] {
    return phraseRun(this.tools, this.phraseOf, this.activeIndex);
  }
  /** each phrase with the literal separator that goes before it, so the
   * template can give every count its own Odometer and still read as one
   * grammatical list */
  get phraseParts(): { item: PhraseItem; before: string }[] {
    let phrases = this.phrases;
    let separators = listSeparators(phrases.length);
    return phrases.map((item, i) => ({ item, before: separators[i] ?? '' }));
  }
  get phraseText(): string {
    return joinPhrases(this.phrases.map((p) => p.text));
  }
  get byKind(): boolean {
    return this.phrasing === 'kind';
  }

  // ── summary ────────────────────────────────────────────────────────────

  get names(): string[] {
    let seen = new Set<string>();
    let names: string[] = [];
    for (let part of this.tools) {
      let title = this.titleOf(part);
      if (!seen.has(title)) {
        seen.add(title);
        names.push(title);
      }
    }
    return names;
  }
  get nameList(): string {
    let names = this.names;
    if (names.length <= this.maxNames) {
      return joinPhrases(names);
    }
    let shown = names.slice(0, this.maxNames);
    return joinPhrases([...shown, `${names.length - shown.length} more`]);
  }
  get failedCount(): number {
    return this.tools.filter((part) => toneOf(part.state) === 'failed').length;
  }
  get tone(): WorkTone {
    let worst: WorkTone = 'done';
    for (let part of this.tools) {
      let tone = toneOf(part.state);
      if (TONE_RANK[tone] > TONE_RANK[worst]) {
        worst = tone;
      }
    }
    if (this.args.pending && TONE_RANK[worst] < TONE_RANK.running) {
      worst = 'running';
    }
    if (worst === 'idle') {
      worst = 'done';
    }
    return worst;
  }
  get isRunning(): boolean {
    return this.tone === 'running';
  }
  get isAttention(): boolean {
    return this.tone === 'attention';
  }
  get countNoun(): string {
    return this.tools.length === 1 ? 'tool' : 'tools';
  }
  get statusText(): string | undefined {
    if (this.isAttention) {
      return 'needs you';
    }
    if (this.isRunning) {
      return 'running…';
    }
    return undefined;
  }
  /** The whole receipt in words: the header's accessible name, which does
   * not depend on the rolling digits or the glyph. */
  get receipt(): string {
    if (this.args.summary) {
      return this.args.summary;
    }
    let parts: string[] = [];
    if (this.byKind) {
      if (this.phraseText) {
        parts.push(this.phraseText);
      }
    } else {
      parts.push(`Used ${this.tools.length} ${this.countNoun}`);
      if (this.nameList) {
        parts.push(this.nameList);
      }
    }
    if (this.failedCount) {
      parts.push(`${this.failedCount} failed`);
    }
    if (this.statusText) {
      parts.push(this.isAttention ? 'needs you' : 'running');
    }
    return parts.join(' · ');
  }
  get summary(): ToolGroupSummary {
    return {
      phrases: this.phrases,
      text: this.phraseText,
      count: this.tools.length,
      names: this.names,
      list: this.nameList,
      failed: this.failedCount,
      tone: this.tone,
      pending: Boolean(this.args.pending),
    };
  }

  // ── entries (merging) ──────────────────────────────────────────────────

  get entries(): ToolGroupEntry[] {
    let entries: ToolGroupEntry[] = [];
    let run: ToolPart[] = [];
    let runKind: 'read' | 'write' | undefined;

    let flush = () => {
      if (run.length === 1) {
        entries.push(this.single(run[0]!));
      } else if (run.length > 1 && runKind) {
        entries.push(this.merged(run, runKind));
      }
      run = [];
      runKind = undefined;
    };

    for (let part of this.tools) {
      let kind = this.kindOf(part);
      // a failed call keeps its own row for its error, and a call that
      // needs the reader keeps its own for its gate and body: a merged row
      // is a plain list with nothing to act on
      let tone = toneOf(part.state);
      let mergeable =
        tone !== 'failed' &&
        tone !== 'attention' &&
        ((kind === 'read' && this.merge !== 'none') ||
          (kind === 'write' && this.merge === 'all'));
      if (!mergeable) {
        flush();
        entries.push(this.single(part));
        continue;
      }
      let k = kind as 'read' | 'write';
      let repeatsTarget =
        k === 'write' &&
        part.subtitle !== undefined &&
        run.some((p) => p.subtitle === part.subtitle);
      if (runKind !== k || repeatsTarget) {
        flush();
        runKind = k;
      }
      run.push(part);
    }
    flush();
    return entries;
  }

  private single(part: ToolPart): ToolGroupEntry {
    return {
      id: part.id,
      merged: false,
      kind: this.kindOf(part),
      parts: [part],
      title: this.titleOf(part),
      subtitle: part.subtitle,
      state: part.state,
      duration: part.duration,
    };
  }

  /** "Read 3 files", "Editing 2 files": the run's own phrase when its
   * calls share one, else its kind's. */
  private mergedTitle(
    parts: ToolPart[],
    kind: ToolKind,
    running: boolean,
  ): string {
    let phrases = new Set(parts.map((p) => this.phraseOf(p)));
    let phrase = phrases.size === 1 ? [...phrases][0]! : KIND_PHRASES[kind];
    let verb = running ? phrase.active : phrase.done;
    let noun = parts.length === 1 ? phrase.one : phrase.many;
    return `${verb} ${parts.length} ${noun}`;
  }

  private merged(parts: ToolPart[], kind: 'read' | 'write'): ToolGroupEntry {
    let worst = parts[0]!;
    for (let part of parts) {
      if (TONE_RANK[toneOf(part.state)] > TONE_RANK[toneOf(worst.state)]) {
        worst = part;
      }
    }
    let durations = parts.map((p) => p.duration);
    let duration = durations.every((d) => d !== undefined)
      ? (durations as number[]).reduce((a, b) => a + b, 0)
      : undefined;
    let targets = parts
      .map((p) => p.subtitle)
      .filter((s): s is string => Boolean(s));
    return {
      id: parts[0]!.id,
      merged: true,
      kind,
      parts,
      title: this.mergedTitle(parts, kind, toneOf(worst.state) === 'running'),
      subtitle: targets.length ? targets.join(', ') : undefined,
      state: worst.state,
      duration,
    };
  }

  // ── disclosure ─────────────────────────────────────────────────────────

  get isOpen(): boolean {
    if (this.args.open !== undefined) {
      return this.args.open;
    }
    // a call that needs the reader opens the group, whatever they chose
    if (this.isAttention) {
      return true;
    }
    return this.userOpen ?? this.args.defaultOpen ?? false;
  }
  get recedes(): boolean {
    if (this.args.recede !== undefined) {
      return this.args.recede;
    }
    return this.tone === 'done' && !this.isOpen;
  }
  get renderRows(): boolean {
    return this.isOpen || this.everOpened;
  }
  get sticky(): boolean {
    return (this.args.sticky ?? true) && this.isOpen;
  }
  get headerStyle(): SafeString | undefined {
    // inline rather than in the stylesheet: the offset is the caller's
    // value, and position and offset belong together
    if (!this.sticky) {
      return undefined;
    }
    let top = this.args.stickyOffset ?? '0px';
    return htmlSafe(`position: sticky; top: ${top}; z-index: 1`);
  }
  get rootStyle(): SafeString {
    // what a nested sticky header (a diff's file header) sticks below
    let top = this.args.stickyOffset ?? '0px';
    let rows = cssNumber(this.args.maxRows ?? 8, 0, 1000) ?? 8;
    let max = rows > 0 ? `calc(${rows} * 1.875rem + 0.375rem)` : 'none';
    return htmlSafe(
      `--pretui-tool-group-header: calc(${top} + 2rem); --pretui-tool-group-max: ${max}`,
    );
  }

  noteOpen = (open: boolean) => {
    if (open && !this.everOpened) {
      // after this render, not during it: renderRows already read the flag
      queueMicrotask(() => {
        if (!this.isDestroying && !this.isDestroyed) {
          this.everOpened = true;
        }
      });
    }
  };

  toggle = (event: Event) => {
    let next = !this.isOpen;
    if (!next) {
      this.keepHeaderInPlace(event.currentTarget as HTMLElement);
    }
    if (this.args.open === undefined) {
      this.userOpen = next;
    }
    if (next) {
      this.everOpened = true;
    }
    this.args.onOpenChange?.(next);
  };

  /** Collapsing from the stuck position would leave the reader far below
   * the group: the shorter content clamps scrollTop. So first scroll up by
   * how far the header is stuck, which puts it back at its natural place in
   * the same spot on screen, then collapse. */
  private keepHeaderInPlace(header: HTMLElement) {
    let root = this.root;
    if (!root) {
      return;
    }
    let stuck =
      header.getBoundingClientRect().top - root.getBoundingClientRect().top;
    if (stuck <= 0.5) {
      return;
    }
    let scroller = scrollParent(root);
    if (!scroller) {
      return;
    }
    // rects are transformed by any scaled ancestor; scrollTop is not
    let rendered = scroller.getBoundingClientRect().height;
    let scale =
      scroller.offsetHeight > 0 && rendered > 0
        ? rendered / scroller.offsetHeight
        : 1;
    scroller.scrollTop -= stuck / scale;
  }

  registerRoot = (el: HTMLElement) => {
    this.root = el;
  };

  <template>
    <div
      class='pretui-toolgroup'
      role='group'
      aria-label={{this.receipt}}
      data-tone={{this.tone}}
      data-open={{if this.isOpen 'true' 'false'}}
      data-recede={{if this.recedes 'true'}}
      style={{this.rootStyle}}
      {{registerElement this.registerRoot}}
      data-test-pretui-tool-group
      ...attributes
    >
      <button
        type='button'
        class='pretui-toolgroup-header'
        aria-expanded={{if this.isOpen 'true' 'false'}}
        aria-controls={{this.bodyId}}
        aria-label={{this.receipt}}
        style={{this.headerStyle}}
        data-sticky={{if this.sticky 'true'}}
        {{on 'click' this.toggle}}
        data-test-pretui-tool-group-header
      >
        <span
          class='pretui-toolgroup-disc'
          data-tone={{this.tone}}
          aria-hidden='true'
        >
          {{#if this.isRunning}}<PlanMark
              @state='current'
              @size={{14}}
            />{{else}}<StackIcon
              class='pretui-toolgroup-icon'
              width='14'
              height='14'
            />{{/if}}
        </span>
        <span
          class='pretui-toolgroup-receipt'
          aria-hidden='true'
          data-test-pretui-tool-group-receipt
        >
          {{#if (has-block 'summary')}}
            {{yield this.summary to='summary'}}
          {{else if @summary}}
            {{@summary}}
          {{else if this.byKind}}
            <span
              class='pretui-toolgroup-phrases'
              data-test-pretui-tool-group-phrases
            >
              {{#each
                this.phraseParts key='item.key'
                as |part|
              }}{{part.before}}<span
                  class='pretui-toolgroup-phrase'
                  data-active={{if part.item.active 'true'}}
                  data-test-pretui-tool-group-phrase
                >{{part.item.verb}}
                  <Odometer @value={{part.item.count}} />
                  {{part.item.noun}}</span>{{/each}}
            </span>
            {{#if this.failedCount}}
              <PointIcon
                class='pretui-toolgroup-sep'
                width='10'
                height='10'
                aria-hidden='true'
              />
              <span
                class='pretui-toolgroup-failed'
                data-test-pretui-tool-group-failed
              >{{this.failedCount}}
                failed</span>
            {{/if}}
          {{else}}
            <span class='pretui-toolgroup-used'>Used
              <Odometer
                @value={{this.tools.length}}
                data-test-pretui-tool-group-count
              />
              {{this.countNoun}}</span>
            {{#if this.nameList}}
              <PointIcon
                class='pretui-toolgroup-sep'
                width='10'
                height='10'
                aria-hidden='true'
              />
              <span
                class='pretui-toolgroup-names'
                data-test-pretui-tool-group-names
              >{{this.nameList}}</span>
            {{/if}}
            {{#if this.failedCount}}
              <PointIcon
                class='pretui-toolgroup-sep'
                width='10'
                height='10'
                aria-hidden='true'
              />
              <span
                class='pretui-toolgroup-failed'
                data-test-pretui-tool-group-failed
              >{{this.failedCount}}
                failed</span>
            {{/if}}
          {{/if}}
        </span>
        {{#if this.statusText}}
          <span
            class='pretui-toolgroup-status'
            data-tone={{this.tone}}
            aria-hidden='true'
            data-test-pretui-tool-group-status
          >{{this.statusText}}</span>
        {{/if}}
        <span
          class='pretui-toolgroup-chevron'
          data-open={{if this.isOpen 'true'}}
          aria-hidden='true'
        ></span>
      </button>
      <Collapse
        @open={{this.isOpen}}
        id={{this.bodyId}}
        {{noteOpen this.noteOpen this.isOpen}}
      >
        <div class='pretui-toolgroup-rows' data-test-pretui-tool-group-rows>
          {{#if this.renderRows}}
            {{#each this.entries key='id' as |entry|}}
              {{#if (has-block 'tool')}}
                {{yield entry to='tool'}}
              {{else if entry.merged}}
                <ToolRow
                  @name={{entry.kind}}
                  @title={{entry.title}}
                  @subtitle={{entry.subtitle}}
                  @state={{entry.state}}
                  @duration={{entry.duration}}
                  @recede={{false}}
                  data-merged='true'
                  data-transcript-id={{entry.id}}
                >
                  <:body>
                    <ul
                      class='pretui-toolgroup-merged'
                      data-test-pretui-tool-group-merged
                    >
                      {{#each entry.parts key='id' as |part|}}
                        <li>{{if part.subtitle part.subtitle part.name}}</li>
                      {{/each}}
                    </ul>
                  </:body>
                </ToolRow>
              {{else}}
                {{#let (firstPart entry) as |part|}}
                  <ToolRow
                    @name={{part.name}}
                    @subtitle={{part.subtitle}}
                    @state={{part.state}}
                    @source={{part.source}}
                    @duration={{part.duration}}
                    @error={{part.error}}
                    @params={{part.params}}
                    @result={{part.result}}
                    @renderers={{@renderers}}
                    @recede={{false}}
                    data-transcript-id={{entry.id}}
                  />
                {{/let}}
              {{/if}}
            {{/each}}
          {{/if}}
        </div>
      </Collapse>
    </div>
    <style scoped>
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-toolgroup {
          display: flex;
          flex-direction: column;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
        }
        .pretui-toolgroup-header {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: 2rem;
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          color: inherit;
          font-family: inherit;
          font-size: inherit;
          font-weight: inherit;
          line-height: inherit;
          text-align: start;
          cursor: pointer;
          min-width: 0;
        }
        .pretui-toolgroup-header {
          transition: opacity 200ms linear;
        }
        .pretui-toolgroup[data-recede] > .pretui-toolgroup-header {
          opacity: var(--pretui-recede-opacity, 1);
        }
        .pretui-toolgroup[data-recede]
          > .pretui-toolgroup-header:is(:hover, :focus-visible) {
          opacity: 1;
        }
        .pretui-toolgroup-header:hover {
          background-color: var(--inset);
        }
        .pretui-toolgroup-header:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-toolgroup-header[data-sticky] {
          background-color: var(--card);
          box-shadow: 0 1px 0 var(--border);
          border-radius: 0;
        }
        /* the group's mark is a stack of calls in the quiet ink, as each
           row's is its tool's icon; a failure or a question tints it */
        .pretui-toolgroup-disc {
          width: var(--boxel-sp);
          height: var(--boxel-sp);
          display: grid;
          place-items: center;
          flex: none;
          color: var(--subtle-foreground);
        }
        .pretui-toolgroup-icon {
          display: block;
          stroke-width: 1.75;
        }
        .pretui-toolgroup-disc[data-tone='failed'] {
          color: var(--destructive-ink);
        }
        .pretui-toolgroup-disc[data-tone='attention'] {
          color: var(--attention-ink);
        }
        .pretui-toolgroup-receipt {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          min-width: 0;
          flex: 1;
          color: var(--muted-foreground);
        }
        .pretui-toolgroup-phrases {
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--foreground);
          font-variant-numeric: tabular-nums;
        }
        /* what the run is doing now shimmers; what it did is still */
        .pretui-toolgroup-phrase[data-active] {
          font-weight: 600;
          background: linear-gradient(
            90deg,
            var(--foreground) 0%,
            var(--muted-foreground) 50%,
            var(--foreground) 100%
          );
          background-size: 200% 100%;
          background-clip: text;
          -webkit-background-clip: text;
          color: transparent;
          animation: pretui-toolgroup-shimmer 1.6s linear infinite;
        }
        @keyframes pretui-toolgroup-shimmer {
          to {
            background-position: -200% 0;
          }
        }
        /* the dot between the summary's parts, as a boxel-icons mark */
        .pretui-toolgroup-sep {
          flex: none;
          align-self: center;
          color: var(--subtle-foreground);
        }
        .pretui-toolgroup-used {
          flex: none;
          color: var(--foreground);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .pretui-toolgroup-names {
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* a state colours the word ("2 failed"), never the row */
        .pretui-toolgroup-failed {
          flex: none;
          font-variant-numeric: tabular-nums;
          color: var(--destructive-ink);
        }
        .pretui-toolgroup-status {
          flex: none;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
          color: var(--subtle-foreground);
        }
        .pretui-toolgroup-status[data-tone='attention'] {
          color: var(--attention-ink);
          font-weight: 600;
        }
        .pretui-toolgroup-chevron {
          flex: none;
          width: 0.375rem;
          height: 0.375rem;
          border-inline-end: 1.5px solid var(--subtle-foreground);
          border-block-end: 1.5px solid var(--subtle-foreground);
          transform: rotate(-45deg);
          transition: transform 160ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        .pretui-toolgroup-chevron[data-open] {
          transform: rotate(45deg);
        }
        /* the group's rows hang on ToolRow's grid: the rail runs under the
           group's disc centre (the inset plus half the disc), and the
           padding after it plus each row's own inset puts every child's
           disc on the group's text edge. A group nested in a group repeats
           the same step. */
        .pretui-toolgroup-rows {
          display: flex;
          flex-direction: column;
          /* past @maxRows the rows scroll inside the group; the header
             above them stays put */
          max-height: var(--pretui-tool-group-max, none);
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          gap: 1px;
          padding: var(--boxel-sp-6xs) 0 var(--boxel-sp-4xs) var(--boxel-sp-xs);
          margin-inline-start: var(--boxel-sp);
          box-shadow: inset 1px 0 0 var(--border);
        }
        /* rows inside a group are one step quieter than rows on their own:
           the group sets ToolRow's header knobs from its own, which a
           container sets to retune grouped rows */
        .pretui-toolgroup-rows {
          --pretui-toolrow-header-min-h: var(
            --pretui-toolgroup-header-min-h,
            1.75rem
          );
          --pretui-toolrow-header-pad-block: var(
            --pretui-toolgroup-header-pad-block,
            0.3125rem
          );
        }
        .pretui-toolgroup-merged {
          margin: 0;
          padding: 0 0 0 var(--boxel-sp);
          /* each line is a call's subtitle (a path, a command) or its name:
             a pasteable string, so the mono voice */
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          color: var(--muted-foreground);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-6xs);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-toolgroup-chevron {
            transition: none;
          }
          .pretui-toolgroup-phrase[data-active] {
            animation: none;
            color: var(--foreground);
            background: none;
          }
        }
      }
    </style>
  </template>
}
