// Pretui — JsonTree: a read-only JSON viewer (APG treeview).
import { on } from '@ember/modifier';
import { Button } from './button';
import { EmptyState } from './empty-state';
import { focusWhen, listen, rovingTabindex } from '../focus';
import { allContainerPaths, fromPlainValue, parseJson } from '../json-model';
import type { JsonDiagnostic, JsonNode, JsonPath } from '../json-model';
import { JsonRowsBase, reportDiagnostics } from '../internal/json-tree';

/* ------------------------------------------------------------------ *
 * JsonTree — the read-only view
 * ------------------------------------------------------------------ */

export interface JsonTreeSignature {
  Args: {
    /** The document as text. Takes precedence over `@value` when both are set. */
    json?: string;
    /** The document as a plain JavaScript value — object, array or scalar. */
    value?: unknown;
    /** Accessible name for the tree. Defaulted, so nothing is required (Law 7). */
    label?: string;
    /** Container paths open on first render, as `pathKey` strings; `'$'` is
     * the root. Ignored once the reader expands anything themselves. */
    defaultExpanded?: string[];
    /** Open every container on first render. */
    expandAll?: boolean;
    /** Case-insensitive filter over property names and scalar values. */
    query?: string;
    /** Children rendered per container before truncating. Default 100. */
    pageSize?: number;
    /** Hide the toolbar (name, match count, expand/collapse all). */
    hideToolbar?: boolean;
    /** Fires with the node and its path on Enter, Space or click. */
    onSelect?: (node: JsonNode, path: JsonPath) => void;
    /** Fires when `@json` could not be parsed. Half-typed input reports too —
     * check `isIncomplete` before treating it as a mistake. */
    onParseError?: (diagnostics: ReadonlyArray<JsonDiagnostic>) => void;
  };
  Blocks: {
    /** Replaces the default EmptyState when there is nothing to show. */
    empty?: [];
  };
  Element: HTMLDivElement;
}

export class JsonTree extends JsonRowsBase<JsonTreeSignature> {
  /** The parse of `@json`. */
  private get parsed() {
    const text = this.args.json;
    return text === undefined ? undefined : parseJson(text);
  }

  protected get root(): JsonNode | undefined {
    const result = this.parsed;
    if (result !== undefined) {
      return result.ok ? result.root : undefined;
    }
    return this.args.value === undefined ? undefined : fromPlainValue(this.args.value);
  }

  protected get seedExpanded(): string[] {
    if (this.args.expandAll) {
      const doc = this.root;
      return doc === undefined ? [] : Array.from(allContainerPaths(doc));
    }
    const seed = this.args.defaultExpanded;
    if (seed !== undefined) {
      return seed.map((entry) => (entry === '$' ? '' : entry));
    }
    // Open the root so a document is never a single collapsed line.
    return [''];
  }

  /** Warnings the document carries — duplicate keys, imprecise numbers. */
  get warnings(): ReadonlyArray<JsonDiagnostic> {
    const result = this.parsed;
    return result !== undefined && result.ok ? result.diagnostics : [];
  }
  get hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  get parseError(): JsonDiagnostic | undefined {
    const result = this.parsed;
    if (result === undefined || result.ok) {
      return undefined;
    }
    return result.diagnostics.find((entry) => entry.severity === 'error');
  }

  /** Every diagnostic from the failed parse, for `@onParseError`. */
  get parseDiagnostics(): ReadonlyArray<JsonDiagnostic> {
    const result = this.parsed;
    return result !== undefined && !result.ok ? result.diagnostics : [];
  }

  /** TRUE when the text merely ran out — a pending state, not a wrong one. */
  get isIncomplete(): boolean {
    const result = this.parsed;
    return result !== undefined && !result.ok && result.incomplete;
  }

  protected get treeLabel(): string {
    return this.args.label ?? 'JSON document';
  }
  protected get pageSize(): number {
    return Math.max(1, this.args.pageSize ?? 100);
  }
  protected get query(): string {
    return (this.args.query ?? '').trim();
  }
  get showToolbar(): boolean {
    return !this.args.hideToolbar;
  }
  get noteSeverity(): string {
    return this.isIncomplete ? 'pending' : 'error';
  }
  get noteMark(): string {
    return this.isIncomplete ? '…' : '!';
  }

  get emptyMessage(): string {
    if (this.hasQuery) {
      return 'No property name or value matches this search.';
    }
    if (this.isIncomplete) {
      return 'Keep typing — this document is not finished yet.';
    }
    return 'There is no JSON to display.';
  }

  onClick = (event: Event): void => {
    const row = this.rowFromEvent(event);
    if (row === undefined) {
      return;
    }
    // The pointer already moved focus (tabindex=-1 elements are mouse
    // focusable) — do not let focusWhen fire a second time.
    this.navigating = false;
    this.focusId = row.id;

    const target = event.target as HTMLElement | null;
    const action = target === null ? null : target.closest('[data-json-action]');
    if (action !== null) {
      const which = (action as HTMLElement).dataset['jsonAction'];
      if (which === 'path') {
        this.copyPath(row);
      } else if (which === 'value') {
        this.copyValue(row);
      }
      return;
    }
    if (row.isOverflow) {
      this.reveal(row);
      return;
    }
    if (target !== null && target.closest('[data-json-twisty]') !== null && row.expandable) {
      this.setExpanded(row.id, !row.expanded);
      return;
    }
    this.selectedId = row.id;
    this.args.onSelect?.(row.node, row.path);
  };

  onKeydown = (event: Event): void => {
    const ev = event as KeyboardEvent;
    const rows = this.rows;
    const index = rows.findIndex((row) => row.id === this.rovingId);
    if (index < 0) {
      return;
    }
    const row = rows[index]!;

    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      if (row.isOverflow) {
        this.reveal(row);
        return;
      }
      if (row.expandable) {
        this.setExpanded(row.id, !row.expanded);
      }
      this.selectedId = row.id;
      this.args.onSelect?.(row.node, row.path);
      return;
    }
    if (this.handleNavigationKey(ev, rows, index)) {
      return;
    }
    this.handleTypeahead(ev, rows, index);
  };

  <template>
    <div class='pretui-json' data-test-pretui-json-tree ...attributes>
      {{#if this.showToolbar}}
        <div class='pretui-json-bar'>
          <span class='pretui-json-bar-name'>{{this.treeLabel}}</span>
          {{#if this.hasQuery}}
            <span class='pretui-json-count' data-test-pretui-json-matches>
              {{this.matchLabel}}
            </span>
          {{/if}}
          <span class='pretui-json-gap'></span>
          <Button
            @tone='neutral'
            @appearance='plain'
            @size='xs'
            data-test-pretui-json-expand-all
            {{on 'click' this.expandAll}}
          >Expand all</Button>
          <Button
            @tone='neutral'
            @appearance='plain'
            @size='xs'
            data-test-pretui-json-collapse-all
            {{on 'click' this.collapseAll}}
          >Collapse all</Button>
        </div>
      {{/if}}

      {{#if this.parseError}}
        <p
          class='pretui-json-note'
          data-severity={{this.noteSeverity}}
          data-test-pretui-json-parse-error
          {{reportDiagnostics this.parseDiagnostics @onParseError}}
        >
          <span class='pretui-json-note-mark' aria-hidden='true'>{{this.noteMark}}</span>
          <span>
            {{#unless this.isIncomplete}}
              <span class='pretui-json-note-at'>
                Line
                {{this.parseError.line}}, column
                {{this.parseError.column}}:
              </span>
            {{/unless}}
            {{this.parseError.message}}
          </span>
        </p>
      {{/if}}

      {{#if this.hasWarnings}}
        <ul class='pretui-json-notes' data-test-pretui-json-warnings>
          {{#each this.warnings key='message' as |warning|}}
            <li class='pretui-json-note' data-severity='warning'>
              <span class='pretui-json-note-mark' aria-hidden='true'>!</span>
              <span>{{warning.message}}</span>
            </li>
          {{/each}}
        </ul>
      {{/if}}

      {{#if this.hasRows}}
        <ul
          class='pretui-json-list'
          role='tree'
          aria-label={{this.treeLabel}}
          {{listen 'click' this.onClick}}
          {{listen 'keydown' this.onKeydown}}
          {{listen 'focusin' this.onFocusIn}}
        >
          {{#each this.rows key='id' as |row|}}
            <li
              class='pretui-json-row'
              role='treeitem'
              data-json-id={{row.id}}
              data-kind={{row.kind}}
              data-matched={{this.matchedAttr row}}
              aria-level={{row.level}}
              aria-posinset={{row.posinset}}
              aria-setsize={{row.setsize}}
              aria-expanded={{this.expandedAttr row}}
              aria-selected={{this.selectedAttr row}}
              style={{row.style}}
              {{rovingTabindex (this.isRoving row)}}
              {{focusWhen (this.isFocusTarget row)}}
            >
              {{#if row.isOverflow}}
                <span class='pretui-json-more' data-test-pretui-json-overflow>
                  {{row.overflowLabel}}
                  <span class='pretui-json-more-cue'>· Enter shows more</span>
                </span>
              {{else}}
                <span
                  class='pretui-json-twisty'
                  data-json-twisty
                  data-open={{if row.expanded 'true'}}
                  data-leaf={{unless row.expandable 'true'}}
                  aria-hidden='true'
                ></span>
                <span class='pretui-json-key'>{{row.keyLabel}}</span>
                <span class='pretui-json-kind' aria-hidden='true'>{{row.kindLabel}}</span>
                <span class='pretui-json-value'>{{row.preview}}</span>
                {{#if row.countLabel}}
                  <span class='pretui-json-n' aria-hidden='true'>{{row.countLabel}}</span>
                {{/if}}
                {{! Pointer affordances only. They CANNOT be buttons: a
                    <button> inside role='treeitem' is nested-interactive, and
                    its label would be folded into the treeitem's accessible
                    name. The keyboard path is on the row itself — Ctrl/Cmd+C
                    copies the value, Ctrl/Cmd+Shift+C copies the path — so
                    nothing here is pointer-only. }}
                <span class='pretui-json-acts' aria-hidden='true'>
                  <span class='pretui-json-act' data-json-action='path'>path</span>
                  <span class='pretui-json-act' data-json-action='value'>copy</span>
                </span>
              {{/if}}
            </li>
          {{/each}}
        </ul>
      {{else if (has-block 'empty')}}
        {{yield to='empty'}}
      {{else}}
        <EmptyState
          @title='Nothing to show'
          @message={{this.emptyMessage}}
          @texture={{false}}
        />
      {{/if}}

      <p class='pretui-json-live' aria-live='polite' data-test-pretui-json-live>
        {{this.announcement}}
      </p>
    </div>

    <style scoped>
      /* Every value is var(--token, lightFallback); zero dark branches — the
         season re-resolves the tokens and the whole component re-tints. */
      .pretui-json {
        --_indent: var(--pretui-json-indent, 14px);
        --_row-h: var(--pretui-json-row-height, 24px);
        display: flex;
        flex-direction: column;
        gap: var(--space-2, 6px);
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
        container-type: inline-size;
      }

      .pretui-json-bar {
        display: flex;
        align-items: center;
        gap: var(--space-3, 8px);
        min-height: var(--control-h, 28px);
      }
      .pretui-json-bar-name {
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-json-count {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .pretui-json-gap {
        flex: 1 1 auto;
      }

      /* Notes never signal by colour alone — each carries a glyph and a word. */
      .pretui-json-notes {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .pretui-json-note {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2, 6px);
        margin: 0;
        padding: var(--space-2, 6px) var(--space-3, 8px);
        border-radius: var(--radius-chip, 6px);
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.45;
        background: color-mix(in oklch, var(--muted-foreground) 8%, transparent);
        color: var(--foreground);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }
      .pretui-json-note[data-severity='error'] {
        background: color-mix(in oklch, var(--destructive) 10%, transparent);
      }
      .pretui-json-note[data-severity='warning'] {
        background: color-mix(in oklch, var(--warning, var(--boxel-warning)) 12%, transparent);
      }
      .pretui-json-note-mark {
        flex: 0 0 auto;
        width: 14px;
        text-align: center;
        font-weight: 700;
      }
      .pretui-json-note-at {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }

      .pretui-json-list {
        list-style: none;
        margin: 0;
        padding: var(--space-2, 6px) 0;
        border-radius: var(--radius-surface, 10px);
        background: var(--inset, var(--boxel-100));
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        overflow: auto;
        max-height: var(--pretui-json-max-height, 26rem);
      }

      .pretui-json-row {
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
        min-height: var(--_row-h);
        padding-inline-start: calc(var(--space-3, 8px) + (var(--_level, 1) - 1) * var(--_indent));
        padding-inline-end: var(--space-3, 8px);
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        font-variant-numeric: tabular-nums;
        cursor: default;
        outline: none;
      }
      .pretui-json-row:hover {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-json-row:focus-visible {
        box-shadow: inset 0 0 0 2px var(--ring);
        border-radius: var(--radius-chip, 6px);
      }
      /* A search hit is marked by a rule AND a background, never colour alone. */
      .pretui-json-row[data-matched='true'] {
        background: color-mix(in oklch, var(--primary) 12%, transparent);
        box-shadow: inset 3px 0 0 0 var(--primary);
      }

      .pretui-json-twisty {
        flex: 0 0 auto;
        width: 10px;
        height: 10px;
        position: relative;
      }
      .pretui-json-twisty[data-leaf='true'] {
        visibility: hidden;
      }
      .pretui-json-twisty::before {
        content: '';
        position: absolute;
        inset-block-start: 1px;
        inset-inline-start: 2px;
        width: 5px;
        height: 5px;
        border-inline-end: 1.5px solid var(--muted-foreground);
        border-block-end: 1.5px solid var(--muted-foreground);
        transform: rotate(-45deg);
        transition: transform var(--pretui-dur-snap, 120ms) var(--pretui-ease-snap, ease);
      }
      .pretui-json-twisty[data-open='true']::before {
        transform: rotate(45deg);
      }

      .pretui-json-key {
        flex: 0 0 auto;
        color: var(--foreground);
        font-weight: 600;
        max-width: 16rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-json-kind {
        flex: 0 0 auto;
        padding: 0 4px;
        border-radius: var(--radius-chip, 6px);
        font-size: var(--text-ui-xs, 11px);
        line-height: 1.5;
        color: var(--muted-foreground);
        background: color-mix(in oklch, var(--muted-foreground) 12%, transparent);
      }
      /* Type identity is a WORD in the badge; the tint is redundant emphasis. */
      .pretui-json-row[data-kind='string'] .pretui-json-value {
        color: var(--chart-1);
      }
      .pretui-json-row[data-kind='number'] .pretui-json-value {
        color: var(--chart-2);
      }
      .pretui-json-row[data-kind='boolean'] .pretui-json-value {
        color: var(--chart-4);
      }
      .pretui-json-row[data-kind='null'] .pretui-json-value {
        color: var(--muted-foreground);
        font-style: italic;
      }
      .pretui-json-row[data-kind='array'] .pretui-json-value,
      .pretui-json-row[data-kind='object'] .pretui-json-value {
        color: var(--muted-foreground);
      }

      .pretui-json-value {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-json-n {
        flex: 0 0 auto;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }

      .pretui-json-acts {
        flex: 0 0 auto;
        display: flex;
        gap: 2px;
        opacity: 0;
        transition: opacity var(--pretui-dur-snap, 120ms) var(--pretui-ease-snap, ease);
      }
      .pretui-json-row:hover .pretui-json-acts,
      .pretui-json-row:focus-visible .pretui-json-acts,
      .pretui-json-acts:focus-within {
        opacity: 1;
      }
      /* Coarse pointers have no hover, so the actions are always present. */
      @media (any-pointer: coarse) {
        .pretui-json-acts {
          opacity: 1;
        }
      }
      .pretui-json-act {
        appearance: none;
        border: 0;
        min-height: 18px;
        padding: 1px 5px;
        border-radius: var(--radius-chip, 6px);
        font: inherit;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        background: var(--card);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        cursor: pointer;
      }
      .pretui-json-act:hover {
        color: var(--foreground);
      }
      /* Selection reads as a rule plus a tint, never colour alone. */
      .pretui-json-row[aria-selected='true'] {
        background: color-mix(in oklch, var(--primary) 8%, transparent);
        box-shadow: inset 2px 0 0 0 var(--foreground);
      }

      .pretui-json-more {
        flex: 1 1 auto;
        color: var(--muted-foreground);
        font-style: italic;
      }
      .pretui-json-more-cue {
        font-size: var(--text-ui-xs, 11px);
        opacity: 0.8;
      }

      /* The live region is announced, never seen. */
      .pretui-json-live {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }

      @container (max-width: 30rem) {
        .pretui-json-key {
          max-width: 8rem;
        }
        .pretui-json-kind {
          display: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .pretui-json-twisty::before,
        .pretui-json-acts {
          transition: none;
        }
      }
    </style>
  </template>
}
