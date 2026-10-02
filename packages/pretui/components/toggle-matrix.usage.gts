// Pretui — ToggleMatrix usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { PretuiSize, PretuiTone } from '../pretui-primitives';
import { FreestyleUsage } from './freestyle-usage';
import { ToggleMatrix } from './toggle-matrix';
import type { ToggleCell, ToggleMatrixColumn, ToggleMatrixRow } from './toggle-matrix';
import { SIZES, TONES } from '../internal/toggle-controls-fixtures';

// ── ToggleMatrix ← beat-maker step grid ──────────────────────────────────
const ROLES: ToggleMatrixRow[] = [
  { id: 'owner', label: 'Owner', hint: 'Billing and deletion' },
  { id: 'admin', label: 'Admin', hint: 'Manages the workspace' },
  { id: 'editor', label: 'Editor', hint: 'Writes and publishes' },
  { id: 'author', label: 'Author', hint: 'Writes drafts only' },
  { id: 'viewer', label: 'Viewer', hint: 'Read-only' },
  { id: 'guest', label: 'Guest', hint: 'Invited to one item', disabled: true },
];

const PERMISSIONS: ToggleMatrixColumn[] = [
  { id: 'view', label: 'View' },
  { id: 'comment', label: 'Comment' },
  { id: 'edit', label: 'Edit' },
  { id: 'publish', label: 'Publish' },
  { id: 'share', label: 'Share' },
  { id: 'invite', label: 'Invite' },
  { id: 'billing', label: 'Billing' },
  { id: 'delete', label: 'Delete' },
];

const GRANTS: ToggleCell[] = [
  { row: 'owner', column: 'view' },
  { row: 'owner', column: 'comment' },
  { row: 'owner', column: 'edit' },
  { row: 'owner', column: 'publish' },
  { row: 'owner', column: 'share' },
  { row: 'owner', column: 'invite' },
  { row: 'owner', column: 'billing' },
  { row: 'owner', column: 'delete' },
  { row: 'admin', column: 'view' },
  { row: 'admin', column: 'comment' },
  { row: 'admin', column: 'edit' },
  { row: 'admin', column: 'publish' },
  { row: 'admin', column: 'share' },
  { row: 'admin', column: 'invite' },
  { row: 'editor', column: 'view' },
  { row: 'editor', column: 'comment' },
  { row: 'editor', column: 'edit' },
  { row: 'editor', column: 'publish' },
  { row: 'author', column: 'view' },
  { row: 'author', column: 'comment' },
  { row: 'author', column: 'edit' },
  { row: 'viewer', column: 'view' },
];

class ToggleMatrixUsage extends Component {
  tones = TONES;
  sizes = SIZES;
  rows = ROLES;
  columns = PERMISSIONS;

  @tracked grants: ToggleCell[] = GRANTS;
  @tracked bulk = true;
  @tracked groupEvery = 4;
  @tracked activeColumn = 'publish';
  @tracked rowAxisLabel = 'Role';
  @tracked tone = 'primary';
  @tracked sizeName = 'm';
  @tracked lastChange = 'nothing yet';

  setGrants = (v: ToggleCell[]) => (this.grants = v);
  setBulk = (v: boolean) => (this.bulk = v);
  setGroupEvery = (v: number | null) => (this.groupEvery = v ?? 0);
  setActiveColumn = (v: string) => (this.activeColumn = v);
  setRowAxisLabel = (v: string) => (this.rowAxisLabel = v);
  setTone = (v: string) => (this.tone = v);
  setSize = (v: string) => (this.sizeName = v);
  noteChange = (row: string, column: string, live: boolean) => {
    this.lastChange = `${row} · ${column} → ${live ? 'granted' : 'revoked'}`;
  };

  get columnIds() {
    return ['', ...this.columns.map((column) => column.id)];
  }
  get toneVal() {
    return this.tone as PretuiTone;
  }
  get sizeVal() {
    return this.sizeName as PretuiSize;
  }
  get grantCount() {
    return this.grants.length;
  }
  get usage() {
    let bits = [
      "@label='Role permissions'",
      '@rows={{this.roles}}',
      '@columns={{this.permissions}}',
      '@value={{this.grants}}',
      '@onValueChange={{this.setGrants}}',
    ];
    if (this.groupEvery) bits.push(`@groupEvery={{${this.groupEvery}}}`);
    return `<ToggleMatrix ${bits.join(' ')} />`;
  }

  <template>
    <FreestyleUsage
      @name='ToggleMatrix'
      @description="A two-dimensional grid of toggles with real header semantics: a table with role='grid', scoped row and column headers, select-all boxes carrying a true indeterminate state, and two-axis keyboard navigation over one tab stop — arrows in both directions, Home and End along the row, Ctrl+Home and Ctrl+End to the corners. Shift-activate paints the rectangle from the anchor, and Shift+Arrow does exactly the same thing from the keyboard, which is why drag-to-paint was not built. The mechanism comes from the beat-maker step grid with the music thrown away; the unnamed colour-only pads did not survive the trip."
      @source={{this.usage}}
    >
      <:example>
        <ToggleMatrix
          @rows={{this.rows}}
          @columns={{this.columns}}
          @label='Role permissions'
          @value={{this.grants}}
          @onValueChange={{this.setGrants}}
          @onToggle={{this.noteChange}}
          @rowAxisLabel={{this.rowAxisLabel}}
          @bulk={{this.bulk}}
          @groupEvery={{this.groupEvery}}
          @activeColumn={{this.activeColumn}}
          @tone={{this.toneVal}}
          @size={{this.sizeVal}}
        />
        <p class='pretui-demo-readout' data-test-tm-readout>
          {{this.grantCount}} grants · last change:
          {{this.lastChange}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='rows'
          @description='Row descriptors: id, label, an optional hint line and an optional disabled flag. Data-driven, unlike the source, whose rows were a literal array of drum names.'
          @value={{this.rows}}
        />
        <Args.Object
          @name='columns'
          @description='Column descriptors: id, label, an optional abbr drawn when the full label will not fit (assistive tech still hears the full one), and an optional disabled flag.'
          @value={{this.columns}}
        />
        <Args.String
          @name='label'
          @required={{true}}
          @defaultValue='Role permissions'
          @description='The grid name. Required for the same reason as ToggleGroup label.'
        />
        <Args.Object
          @name='value'
          @description='Controlled value: every switched-on intersection, as row and column ids. An array of pairs rather than interpolated string keys, which cannot survive an id containing the separator.'
          @value={{this.grants}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Receives the whole next value, always rebuilt in rows-by-columns order — so two identical selections serialize identically no matter how they were reached.'
        />
        <Args.Action
          @name='onToggle'
          @description='Fires once per cell that actually changed, including inside a bulk or span operation, so an audit log records individual grants rather than a diff.'
        />
        <Args.Bool
          @name='bulk'
          @defaultValue={{true}}
          @value={{this.bulk}}
          @description='Show the row, column and whole-matrix select-all boxes. They live in row and column minus-one of the same navigation space, so they are reachable by arrowing rather than by Tab, and they are aria-disabled rather than disabled so a tab stop can never land somewhere unfocusable.'
          @onInput={{this.setBulk}}
        />
        <Args.Number
          @name='groupEvery'
          @defaultValue={{0}}
          @value={{this.groupEvery}}
          @min={{0}}
          @max={{8}}
          @description='Draw a heavier rule before every Nth column — the scanning aid the source hardcoded as three separate equality comparisons.'
          @onInput={{this.setGroupEvery}}
        />
        <Args.String
          @name='activeColumn'
          @value={{this.activeColumn}}
          @options={{this.columnIds}}
          @description='Marks one column as current — a playhead, today, the live shift. Carried by aria-current and a drawn caret, never by colour alone.'
          @onInput={{this.setActiveColumn}}
        />
        <Args.String
          @name='rowAxisLabel'
          @value={{this.rowAxisLabel}}
          @description='Names the row axis in the corner cell, e.g. Role or Shift.'
          @onInput={{this.setRowAxisLabel}}
        />
        <Args.String
          @name='tone'
          @defaultValue='primary'
          @value={{this.tone}}
          @options={{this.tones}}
          @description='Semantic hue for switched-on cells and the current-column caret.'
          @onInput={{this.setTone}}
        />
        <Args.String
          @name='size'
          @defaultValue='m'
          @value={{this.sizeName}}
          @options={{this.sizes}}
          @description='Scale for the whole grid. Cells are em, so one declaration moves everything.'
          @onInput={{this.setSize}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @description='Dims and inerts the whole grid.'
        />
        <Args.Yield
          @name='empty'
          @description='Replaces the built-in line shown when there are no rows or no columns.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-togglematrix-cell'
          @type='length'
          @description='Cell size, in em so it rides the size scale. Grows to a 44px-class target on coarse pointers.'
        />
        <Css.Basic
          @name='pretui-togglematrix-radius'
          @type='length'
          @description='Corner radius of one cell.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-readout {
        margin: 12px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_TOGGLE_MATRIX: Record<string, unknown> = {
  ToggleMatrix: ToggleMatrixUsage,
};
