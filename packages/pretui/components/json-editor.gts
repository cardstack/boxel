// Pretui — JsonEditor: a structural JSON editor (APG treegrid).
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Input } from './input';
import { Select } from './select';
import { Textarea } from './textarea';
import { EmptyState } from './empty-state';
import { focusWhen, listen, rovingTabindex } from '../focus';
import { JsonHistory, addEntry, addItem, allContainerPaths, changeKind, emptyNodeOfKind, fromPlainValue, moveChild, parseJson, readScalar, removeAt, renameKey, setNode, stringifyJson, toPlainValue } from '../json-model';
import type { EditResult, JsonDiagnostic, JsonKind, JsonNode } from '../json-model';
import { JsonRowsBase, KIND_OPTIONS } from '../internal/json-tree';
import type { ViewRow } from '../internal/json-tree';

/* ------------------------------------------------------------------ *
 * JsonEditor — structural editing on top of the same row engine
 * ------------------------------------------------------------------ */

export interface JsonEditorSignature {
  Args: {
    /** Starting document as text. Parsed once; the editor owns it afterwards. */
    json?: string;
    /** Starting document as a plain JavaScript value. */
    value?: unknown;
    /** Accessible name for the grid. */
    label?: string;
    /** Open every container on first render. */
    expandAll?: boolean;
    /** Case-insensitive filter over property names and scalar values. */
    query?: string;
    /** Children rendered per container before truncating. Default 100. */
    pageSize?: number;
    /** Spaces per indent level in the emitted text. Default 2; 0 is compact. */
    indent?: number;
    /** Undo depth. Default 200. */
    historyLimit?: number;
    /** Nothing can be edited; the grid still navigates and copies. */
    readonly?: boolean;
    /**
     * Fires after every committed edit, ALWAYS with a valid document — the
     * serialised text and the plain value. Never fires for a pending or
     * rejected edit, so a caller can persist the payload unconditionally.
     */
    onChange?: (json: string, value: unknown) => void;
    /**
     * Fires when an edit is rejected or degraded — an unreadable number, a
     * duplicate property name, a lossy type change. Invalid state is surfaced
     * for the caller to render; it is never resolved by coercing the data.
     */
    onIssue?: (diagnostics: ReadonlyArray<JsonDiagnostic>) => void;
  };
  Blocks: {
    empty?: [];
  };
  Element: HTMLDivElement;
}

/** `{}` and `[]` parse cleanly but render no rows. */
function isEmptyContainer(node: JsonNode): boolean {
  if (node.kind === 'object') {
    return node.entries.length === 0;
  }
  if (node.kind === 'array') {
    return node.items.length === 0;
  }
  return false;
}

export class JsonEditor extends JsonRowsBase<JsonEditorSignature> {
  /** The live document once the reader has edited; `undefined` means the
   * args are still authoritative. */
  @tracked private edited: JsonNode | undefined = undefined;
  /** The row currently in edit mode — the APG treegrid contract: one row's
   * cells are reachable at a time, Escape returns to row navigation. */
  @tracked private editingId: string | undefined = undefined;
  /** Uncommitted text for a scalar whose current draft cannot be read as its
   * type. The DOCUMENT keeps its last good value; the draft is held here so
   * the keystrokes are never thrown away. */
  @tracked private pendingText: string | undefined = undefined;
  @tracked private pendingId: string | undefined = undefined;
  @tracked private pendingMessage: string | undefined = undefined;
  /** Draft property name, same contract as `pendingText`. */
  @tracked private keyDraft: string | undefined = undefined;
  @tracked private keyDraftId: string | undefined = undefined;
  @tracked private keyMessage: string | undefined = undefined;
  @tracked private historyTick = 0;

  private history = new JsonHistory(this.args.historyLimit ?? 200);

  kindOptions = KIND_OPTIONS;

  private get seeded(): JsonNode {
    const text = this.args.json;
    if (text !== undefined) {
      const result = parseJson(text);
      if (result.ok) {
        return result.root;
      }
      return { kind: 'object', entries: [] };
    }
    if (this.args.value !== undefined) {
      return fromPlainValue(this.args.value);
    }
    return { kind: 'object', entries: [] };
  }

  protected get root(): JsonNode | undefined {
    return this.edited ?? this.seeded;
  }
  private get doc(): JsonNode {
    return this.root!;
  }

  protected get seedExpanded(): string[] {
    if (this.args.expandAll) {
      return Array.from(allContainerPaths(this.doc));
    }
    return [''];
  }
  protected get treeLabel(): string {
    return this.args.label ?? 'JSON editor';
  }
  protected get pageSize(): number {
    return Math.max(1, this.args.pageSize ?? 100);
  }
  protected get query(): string {
    return (this.args.query ?? '').trim();
  }
  private get indent(): number {
    return this.args.indent ?? 2;
  }
  get isReadonly(): boolean {
    return this.args.readonly === true;
  }
  get canUndo(): boolean {
    // `historyTick` is read so the getter re-runs after every mutation —
    // JsonHistory is a plain object, deliberately, so it stays unit-testable
    // without a tracking frame.
    return this.historyTick >= 0 && this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.historyTick >= 0 && this.history.canRedo;
  }
  get emptyMessage(): string {
    return this.hasQuery
      ? 'No property name or value matches this search.'
      : 'This document is empty. Add a property to begin.';
  }

  /* ---- the blank document ------------------------------------------ *
   * An empty JSON field is a blank page, not an announcement. A titled
   * EmptyState with an illustration reads as "something is missing"; what
   * is actually true is "nothing has been written yet". So the empty state
   * IS the input: a bare textarea whose only chrome is a one-word hint that
   * JSON is what goes here. Paste or type, and on the keystroke the text
   * becomes valid it parses straight into the tree and this input is gone.
   * ------------------------------------------------------------------- */

  /** Raw text held while the document is still empty. */
  @tracked private seedText = '';
  /** Set on blur only — a half-typed `{` is not an error while you type. */
  @tracked private seedIssue: string | undefined = undefined;

  /** Editable and unfiltered: show the input. A no-match search or a
   * read-only document still wants a notice, because in those cases the
   * emptiness is a *result*, not an invitation. */
  get showSeedInput(): boolean {
    return !this.isReadonly && !this.hasQuery;
  }
  get seedLabel(): string {
    return this.args.label ?? 'JSON editor';
  }
  get seedInvalid(): boolean | undefined {
    return this.seedIssue ? true : undefined;
  }
  /** The whole of the empty-state copy. One word when all is well. */
  get seedHint(): string {
    return this.seedIssue ?? 'JSON';
  }

  seedInput = (text: string): void => {
    this.seedText = text;
    this.seedIssue = undefined;
    if (text.trim() === '') {
      return;
    }
    const result = parseJson(text);
    // An empty `{}` parses fine but yields no rows, which would silently
    // swallow what was typed and leave the field looking untouched. Hold it
    // until there is something to show.
    if (result.ok && !isEmptyContainer(result.root)) {
      this.history.push(this.doc);
      this.edited = result.root;
      this.historyTick = this.historyTick + 1;
      this.seedText = '';
      this.announce('JSON parsed into the editor.');
      this.emit(result.root);
    }
  };

  seedBlur = (): void => {
    const text = this.seedText.trim();
    if (text === '') {
      this.seedIssue = undefined;
      return;
    }
    const result = parseJson(text);
    this.seedIssue = result.ok
      ? undefined
      : (result.diagnostics[0]?.message ?? 'That is not valid JSON.');
  };

  get cannotUndo(): boolean {
    return !this.canUndo;
  }
  get cannotRedo(): boolean {
    return !this.canRedo;
  }

  isEditing = (row: ViewRow): boolean => this.editingId === row.id && !this.isReadonly;
  editingKey = (row: ViewRow): boolean => this.isEditing(row) && row.inObject;
  editingScalar = (row: ViewRow): boolean => this.isEditing(row) && this.isTextual(row);
  editingBool = (row: ViewRow): boolean => this.isEditing(row) && row.kind === 'boolean';
  /** The pending draft for this row, or the committed text. */
  valueText = (row: ViewRow): string => {
    if (this.pendingId === row.id && this.pendingText !== undefined) {
      return this.pendingText;
    }
    const node = row.node;
    if (node.kind === 'string') {
      return node.value;
    }
    if (node.kind === 'number') {
      return node.literal;
    }
    return '';
  };
  keyText = (row: ViewRow): string =>
    this.keyDraftId === row.id && this.keyDraft !== undefined ? this.keyDraft : row.keyLabel;
  rowInvalid = (row: ViewRow): boolean => this.pendingId === row.id && this.pendingMessage !== undefined;
  rowMessage = (row: ViewRow): string | undefined =>
    this.pendingId === row.id ? this.pendingMessage : undefined;
  keyInvalid = (row: ViewRow): boolean => this.keyDraftId === row.id && this.keyMessage !== undefined;
  keyMessageFor = (row: ViewRow): string | undefined =>
    this.keyDraftId === row.id ? this.keyMessage : undefined;
  isBoolTrue = (row: ViewRow): boolean => row.node.kind === 'boolean' && row.node.value;
  boolLabel = (row: ViewRow): string =>
    row.node.kind === 'boolean' && row.node.value ? 'true' : 'false';
  isTextual = (row: ViewRow): boolean => row.kind === 'string' || row.kind === 'number';
  valueLabelFor = (row: ViewRow): string => 'Value at ' + row.pathLabel;
  keyLabelFor = (row: ViewRow): string => 'Property name at ' + row.pathLabel;
  kindLabelFor = (row: ViewRow): string => 'Type of ' + row.pathLabel;
  addLabelFor = (row: ViewRow): string =>
    (row.kind === 'array' ? 'Add an item to ' : 'Add a property to ') + row.pathLabel;
  removeLabelFor = (row: ViewRow): string => 'Remove ' + row.pathLabel;
  upLabelFor = (row: ViewRow): string => 'Move ' + row.pathLabel + ' up';
  downLabelFor = (row: ViewRow): string => 'Move ' + row.pathLabel + ' down';
  canMove = (row: ViewRow): boolean => !row.isOverflow && row.parentId !== undefined;
  canRemove = (row: ViewRow): boolean => !row.isOverflow && row.parentId !== undefined;

  /* --- committing ------------------------------------------------- */

  /** Apply an `EditResult`, recording undo and emitting `@onChange`. */
  private apply(result: EditResult): boolean {
    if (result.diagnostics.length > 0) {
      this.args.onIssue?.(result.diagnostics);
    }
    if (!result.changed) {
      if (result.diagnostics.length > 0) {
        this.announce(result.announcement);
      }
      return false;
    }
    this.history.push(this.doc);
    this.edited = result.root;
    this.historyTick = this.historyTick + 1;
    this.announce(result.announcement);
    this.emit(result.root);
    return true;
  }

  private emit(root: JsonNode): void {
    this.args.onChange?.(stringifyJson(root, this.indent), toPlainValue(root));
  }

  private clearPending(): void {
    this.pendingId = undefined;
    this.pendingText = undefined;
    this.pendingMessage = undefined;
  }
  private clearKeyDraft(): void {
    this.keyDraftId = undefined;
    this.keyDraft = undefined;
    this.keyMessage = undefined;
  }

  /* --- edit operations -------------------------------------------- */

  setValueText = (row: ViewRow, text: string): void => {
    const read = readScalar(row.kind, text);
    if (read === undefined) {
      // The draft is held, the document keeps its last good value, and the
      // row is marked invalid with a reason. Nothing is coerced or dropped.
      this.pendingId = row.id;
      this.pendingText = text;
      this.pendingMessage =
        row.kind === 'number'
          ? 'Not a JSON number yet. JSON has no leading +, no leading zeros, no bare .5, and no Infinity or NaN.'
          : 'This is not a valid ' + row.kind + ' value.';
      this.args.onIssue?.([
        {
          severity: 'error',
          code: 'pending-value',
          message: this.pendingMessage,
          offset: 0,
          line: 1,
          column: 1,
          path: row.path,
        },
      ]);
      return;
    }
    this.clearPending();
    this.apply(setNode(this.doc, row.path, read));
  };

  setBool = (row: ViewRow, checked: boolean): void => {
    this.apply(setNode(this.doc, row.path, { kind: 'boolean', value: checked }));
  };

  setKeyText = (row: ViewRow, text: string): void => {
    this.keyDraftId = row.id;
    this.keyDraft = text;
    this.keyMessage = undefined;
  };

  commitKey = (row: ViewRow): void => {
    if (this.keyDraftId !== row.id || this.keyDraft === undefined) {
      return;
    }
    const next = this.keyDraft;
    const result = renameKey(this.doc, row.parentPath, row.index, next);
    if (!result.changed && result.diagnostics.length > 0) {
      // The clash is reported and the draft is KEPT — the reader can fix it.
      this.keyMessage = result.diagnostics[0]!.message;
      this.args.onIssue?.(result.diagnostics);
      return;
    }
    this.clearKeyDraft();
    this.apply(result);
  };

  setKind = (row: ViewRow, kind: string): void => {
    this.clearPending();
    this.apply(changeKind(this.doc, row.path, kind as JsonKind));
  };

  addChild = (row: ViewRow): void => {
    if (row.node.kind === 'array') {
      this.apply(addItem(this.doc, row.path, emptyNodeOfKind('null')));
    } else if (row.node.kind === 'object') {
      // Name the new property deterministically — no Math.random, no Date.now.
      const taken = new Set(row.node.entries.map((entry) => entry.key));
      let name = 'newProperty';
      let suffix = 2;
      while (taken.has(name)) {
        name = 'newProperty' + String(suffix);
        suffix = suffix + 1;
      }
      this.apply(addEntry(this.doc, row.path, name, emptyNodeOfKind('null')));
    }
    this.setExpanded(row.id, true);
  };

  removeRow = (row: ViewRow): void => {
    if (!this.canRemove(row)) {
      return;
    }
    this.clearPending();
    this.clearKeyDraft();
    this.editingId = undefined;
    this.apply(removeAt(this.doc, row.parentPath, row.index));
  };

  moveUp = (row: ViewRow): void => {
    this.apply(moveChild(this.doc, row.parentPath, row.index, row.index - 1));
  };
  moveDown = (row: ViewRow): void => {
    this.apply(moveChild(this.doc, row.parentPath, row.index, row.index + 1));
  };

  undo = (): void => {
    const previous = this.history.undo(this.doc);
    if (previous === undefined) {
      this.announce('Nothing to undo.');
      return;
    }
    this.clearPending();
    this.clearKeyDraft();
    this.edited = previous;
    this.historyTick = this.historyTick + 1;
    this.announce('Undone.');
    this.emit(previous);
  };

  redo = (): void => {
    const next = this.history.redo(this.doc);
    if (next === undefined) {
      this.announce('Nothing to redo.');
      return;
    }
    this.clearPending();
    this.clearKeyDraft();
    this.edited = next;
    this.historyTick = this.historyTick + 1;
    this.announce('Redone.');
    this.emit(next);
  };

  private beginEdit(row: ViewRow): void {
    if (this.isReadonly || row.isOverflow) {
      return;
    }
    this.editingId = row.id;
    this.announce('Editing ' + row.pathLabel + '. Escape returns to the list.');
  }

  private endEdit(): void {
    this.editingId = undefined;
    this.navigating = true;
  }

  /* --- events ------------------------------------------------------ */

  onClick = (event: Event): void => {
    const row = this.rowFromEvent(event);
    if (row === undefined) {
      return;
    }
    this.navigating = false;
    this.focusId = row.id;

    const target = event.target as HTMLElement | null;
    if (target !== null && target.closest('[data-json-action]') !== null) {
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
    if (target !== null && target.closest('[data-json-cell]') !== null) {
      this.beginEdit(row);
    }
  };

  onKeydown = (event: Event): void => {
    const ev = event as KeyboardEvent;
    const rows = this.rows;
    const index = rows.findIndex((row) => row.id === this.rovingId);
    if (index < 0) {
      return;
    }
    const row = rows[index]!;

    if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z')) {
      ev.preventDefault();
      if (ev.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    }

    // Edit mode: the row's controls own the keyboard. Only Escape (and Enter
    // on a single-line control) belongs to the grid. This is the APG treegrid
    // contract — without it, arrows in a text box would move the selection.
    if (this.editingId !== undefined) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.endEdit();
      } else if (ev.key === 'Enter') {
        const target = ev.target as HTMLElement | null;
        if (target !== null && target.tagName === 'INPUT') {
          ev.preventDefault();
          this.commitKey(row);
          this.endEdit();
        }
      }
      return;
    }

    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault();
      if (!this.isReadonly && this.canMove(row)) {
        if (ev.key === 'ArrowUp') {
          this.moveUp(row);
        } else {
          this.moveDown(row);
        }
      }
      return;
    }

    if (ev.key === 'Enter' || ev.key === 'F2') {
      ev.preventDefault();
      if (row.isOverflow) {
        this.reveal(row);
        return;
      }
      this.beginEdit(row);
      return;
    }
    if (ev.key === ' ') {
      ev.preventDefault();
      if (row.expandable) {
        this.setExpanded(row.id, !row.expanded);
      }
      return;
    }
    if (ev.key === 'Delete') {
      ev.preventDefault();
      if (!this.isReadonly) {
        this.removeRow(row);
      }
      return;
    }
    if (this.handleNavigationKey(ev, rows, index)) {
      return;
    }
    this.handleTypeahead(ev, rows, index);
  };

  <template>
    <div class='pretui-json pretui-json-edit' data-test-pretui-json-editor ...attributes>
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
          @disabled={{this.cannotUndo}}
          data-test-pretui-json-undo
          {{on 'click' this.undo}}
        >Undo</Button>
        <Button
          @tone='neutral'
          @appearance='plain'
          @size='xs'
          @disabled={{this.cannotRedo}}
          data-test-pretui-json-redo
          {{on 'click' this.redo}}
        >Redo</Button>
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

      {{#if this.hasRows}}
        <div
          class='pretui-json-list'
          role='treegrid'
          aria-label={{this.treeLabel}}
          aria-readonly={{if this.isReadonly 'true'}}
          {{listen 'click' this.onClick}}
          {{listen 'keydown' this.onKeydown}}
          {{listen 'focusin' this.onFocusIn}}
        >
          {{#each this.rows key='id' as |row|}}
            <div
              class='pretui-json-row'
              role='row'
              data-json-id={{row.id}}
              data-kind={{row.kind}}
              data-matched={{this.matchedAttr row}}
              data-editing={{if (this.isEditing row) 'true'}}
              aria-level={{row.level}}
              aria-posinset={{row.posinset}}
              aria-setsize={{row.setsize}}
              aria-expanded={{this.expandedAttr row}}
              style={{row.style}}
              {{rovingTabindex (this.isRoving row)}}
              {{focusWhen (this.isFocusTarget row)}}
            >
              {{#if row.isOverflow}}
                <span class='pretui-json-cell pretui-json-more' role='gridcell'>
                  {{row.overflowLabel}}
                  <span class='pretui-json-more-cue'>· Enter shows more</span>
                </span>
              {{else}}
                <span class='pretui-json-cell pretui-json-cell-key' role='gridcell'>
                  <span
                    class='pretui-json-twisty'
                    data-json-twisty
                    data-open={{if row.expanded 'true'}}
                    data-leaf={{unless row.expandable 'true'}}
                    aria-hidden='true'
                  ></span>
                  {{#if (this.editingKey row)}}
                    <Input
                      @value={{this.keyText row}}
                      @invalid={{this.keyInvalid row}}
                      @errorMessage={{this.keyMessageFor row}}
                      @onInput={{fn this.setKeyText row}}
                      aria-label={{this.keyLabelFor row}}
                      data-json-cell='key'
                      {{on 'blur' (fn this.commitKey row)}}
                    />
                  {{else}}
                    <span class='pretui-json-key' data-json-cell='key'>{{row.keyLabel}}</span>
                  {{/if}}
                </span>

                <span class='pretui-json-cell pretui-json-cell-kind' role='gridcell'>
                  {{#if (this.isEditing row)}}
                    <Select
                      @options={{this.kindOptions}}
                      @value={{row.kind}}
                      @onValueChange={{fn this.setKind row}}
                      aria-label={{this.kindLabelFor row}}
                      data-json-cell='kind'
                    />
                  {{else}}
                    <span class='pretui-json-kind' aria-hidden='true'>{{row.kindLabel}}</span>
                  {{/if}}
                </span>

                <span class='pretui-json-cell pretui-json-cell-value' role='gridcell'>
                  {{#if (this.editingScalar row)}}
                    <Input
                      @value={{this.valueText row}}
                      @invalid={{this.rowInvalid row}}
                      @errorMessage={{this.rowMessage row}}
                      @onInput={{fn this.setValueText row}}
                      aria-label={{this.valueLabelFor row}}
                      data-json-cell='value'
                    />
                  {{else if (this.editingBool row)}}
                    <Checkbox
                      @label={{this.boolLabel row}}
                      @checked={{this.isBoolTrue row}}
                      @onCheckedChange={{fn this.setBool row}}
                      data-json-cell='value'
                    />
                  {{else}}
                    <span class='pretui-json-value' data-json-cell='value'>{{row.preview}}</span>
                    {{#if row.countLabel}}
                      <span class='pretui-json-n' aria-hidden='true'>{{row.countLabel}}</span>
                    {{/if}}
                  {{/if}}
                </span>

                <span class='pretui-json-cell pretui-json-acts' role='gridcell'>
                  {{#if row.isContainerRow}}
                    <button
                      type='button'
                      class='pretui-json-act'
                      data-json-action='add'
                      tabindex='-1'
                      aria-label={{this.addLabelFor row}}
                      {{on 'click' (fn this.addChild row)}}
                    >+</button>
                  {{/if}}
                  {{#if (this.canMove row)}}
                    <button
                      type='button'
                      class='pretui-json-act'
                      data-json-action='up'
                      tabindex='-1'
                      aria-label={{this.upLabelFor row}}
                      {{on 'click' (fn this.moveUp row)}}
                    >↑</button>
                    <button
                      type='button'
                      class='pretui-json-act'
                      data-json-action='down'
                      tabindex='-1'
                      aria-label={{this.downLabelFor row}}
                      {{on 'click' (fn this.moveDown row)}}
                    >↓</button>
                  {{/if}}
                  <button
                    type='button'
                    class='pretui-json-act'
                    data-json-action='path'
                    tabindex='-1'
                    aria-label={{this.copyPathLabel row}}
                    {{on 'click' (fn this.copyPath row)}}
                  >path</button>
                  {{#if (this.canRemove row)}}
                    <button
                      type='button'
                      class='pretui-json-act pretui-json-act-danger'
                      data-json-action='remove'
                      tabindex='-1'
                      aria-label={{this.removeLabelFor row}}
                      {{on 'click' (fn this.removeRow row)}}
                    >×</button>
                  {{/if}}
                </span>
              {{/if}}
            </div>
          {{/each}}
        </div>
      {{else if (has-block 'empty')}}
        {{yield to='empty'}}
      {{else if this.showSeedInput}}
        <div class='pretui-json-seed'>
          <Textarea
            @value={{this.seedText}}
            @placeholder='{ "name": "value" }'
            @invalid={{this.seedInvalid}}
            @helperText={{this.seedHint}}
            @onInput={{this.seedInput}}
            aria-label={{this.seedLabel}}
            {{on 'blur' this.seedBlur}}
            data-test-pretui-json-seed
          />
        </div>
      {{else}}
        <EmptyState @title='Empty document' @message={{this.emptyMessage}} @texture={{false}} />
      {{/if}}

      <p class='pretui-json-live' aria-live='polite' data-test-pretui-json-live>
        {{this.announcement}}
      </p>
    </div>

    <style scoped>
      .pretui-json {
        --_indent: var(--pretui-json-indent, 14px);
        --_row-h: var(--pretui-json-row-height, 26px);
        display: flex;
        flex-direction: column;
        gap: var(--space-2, 6px);
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
        container-type: inline-size;
      }
      /* The blank document. Deliberately almost no dress: the textarea
         inherits the field tokens and the hint is the smallest legible
         label the scale has. Reserves the rows' own minimum height so the
         field does not jump when the first paste lands (Law 8's corollary
         — a value that arrives late reserves its space). */
      .pretui-json-seed {
        display: flex;
        flex-direction: column;
      }
      .pretui-json-seed :is(textarea) {
        min-height: calc(var(--_row-h) * 4);
        font-family: var(--font-mono);
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-json-bar {
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
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

      .pretui-json-list {
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
        outline: none;
      }
      .pretui-json-row:hover {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-json-row:focus-visible {
        box-shadow: inset 0 0 0 2px var(--ring);
        border-radius: var(--radius-chip, 6px);
      }
      .pretui-json-row[data-matched='true'] {
        background: color-mix(in oklch, var(--primary) 12%, transparent);
        box-shadow: inset 3px 0 0 0 var(--primary);
      }
      .pretui-json-row[data-editing='true'] {
        background: var(--card);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        min-height: calc(var(--control-h, 28px) + 8px);
      }

      .pretui-json-cell {
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
        min-width: 0;
      }
      .pretui-json-cell-key {
        flex: 0 0 auto;
        max-width: 14rem;
      }
      .pretui-json-cell-kind {
        flex: 0 0 auto;
      }
      .pretui-json-cell-value {
        flex: 1 1 auto;
      }
      .pretui-json-row[data-editing='true'] .pretui-json-cell-key,
      .pretui-json-row[data-editing='true'] .pretui-json-cell-kind {
        flex: 0 0 9rem;
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
        color: var(--foreground);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: text;
      }
      .pretui-json-kind {
        padding: 0 4px;
        border-radius: var(--radius-chip, 6px);
        font-size: var(--text-ui-xs, 11px);
        line-height: 1.5;
        color: var(--muted-foreground);
        background: color-mix(in oklch, var(--muted-foreground) 12%, transparent);
      }
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
      .pretui-json-value {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: text;
      }
      .pretui-json-n {
        flex: 0 0 auto;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }

      .pretui-json-acts {
        flex: 0 0 auto;
        gap: 2px;
        opacity: 0;
        transition: opacity var(--pretui-dur-snap, 120ms) var(--pretui-ease-snap, ease);
      }
      .pretui-json-row:hover .pretui-json-acts,
      .pretui-json-row:focus-visible .pretui-json-acts,
      .pretui-json-row[data-editing='true'] .pretui-json-acts,
      .pretui-json-acts:focus-within {
        opacity: 1;
      }
      @media (any-pointer: coarse) {
        .pretui-json-acts {
          opacity: 1;
        }
        .pretui-json-act {
          min-width: 30px;
          min-height: 30px;
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
      .pretui-json-act-danger:hover {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .pretui-json-act:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
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

      @container (max-width: 34rem) {
        .pretui-json-row[data-editing='true'] {
          flex-wrap: wrap;
        }
        .pretui-json-cell-key,
        .pretui-json-row[data-editing='true'] .pretui-json-cell-key,
        .pretui-json-row[data-editing='true'] .pretui-json-cell-kind {
          flex: 1 1 100%;
          max-width: none;
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
