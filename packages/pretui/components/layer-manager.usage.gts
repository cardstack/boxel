// Pretui — LayerManager usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { LayerManager } from './layer-manager';
import type { LayerNode } from './layer-manager';
import { Token } from './token';
import { ARTBOARD } from '../demo-design-layers';

// ── LayerManager ─────────────────────────────────────────────────────────
class LayerManagerUsage extends Component {
  @tracked layers: readonly LayerNode[] = ARTBOARD;
  @tracked chosen = 'none';
  @tracked lastFlag = '—';
  @tracked mode: 'none' | 'single' | 'multi' = 'multi';
  @tracked density: 'compact' | 'comfortable' = 'comfortable';
  @tracked indent = 14;
  @tracked reorderable = true;
  @tracked showVisibility = true;
  @tracked showLock = true;

  modeOptions = ['none', 'single', 'multi'];
  densityOptions = ['compact', 'comfortable'];

  setMode = (v: string) => (this.mode = v as 'none' | 'single' | 'multi');
  setDensity = (v: string) =>
    (this.density = v as 'compact' | 'comfortable');
  setIndent = (v: number | null) => (this.indent = v ?? 14);
  setReorderable = (v: boolean) => (this.reorderable = v);
  setShowVisibility = (v: boolean) => (this.showVisibility = v);
  setShowLock = (v: boolean) => (this.showLock = v);

  /** The whole host contract: one tree in, one tree out. */
  takeLayers = (next: LayerNode[]) => {
    this.layers = next;
  };
  noteSelection = (ids: string[]) => {
    this.chosen = ids.length === 0 ? 'none' : ids.join(', ');
  };
  noteVisibility = (node: LayerNode, hidden: boolean) => {
    this.lastFlag = `${node.name} ${hidden ? 'hidden' : 'shown'}`;
  };
  noteLock = (node: LayerNode, locked: boolean) => {
    this.lastFlag = `${node.name} ${locked ? 'locked' : 'unlocked'}`;
  };
  reset = () => {
    this.layers = ARTBOARD;
  };

  get usage(): string {
    return [
      '<LayerManager',
      '  @layers={{this.layers}}',
      '  @onLayersChange={{this.takeLayers}}',
      "  @selectionMode='multi'",
      '  @onSelectionChange={{this.stage}}',
      '  @onVisibilityChange={{this.repaint}}',
      '  @onLockChange={{this.repaint}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='LayerManager'
      @description="The layers panel from a design tool: ordered, nestable, with visibility and lock per row — and a complete keyboard path for every one of those, which is what the five drag implementations in the sourcing audit did not have. Arrow to a handle, Enter or Space to pick a layer up, then up and down to reorder it AMONG ITS SIBLINGS, right to nest it inside the layer above, left to move it back out, Enter to drop, Escape to cancel. Every step is announced in a live region with a level and a position, because a reader who cannot see the rows move has no other channel. It is an APG treegrid rather than a tree for a structural reason: a treeitem is one tab stop, so a tree with per-row buttons has to either bury them or break the pattern; a treegrid gives every control in every row a cell of its own. The pointer path is written on top of the keyboard path — vertical travel is reorder, horizontal travel is nesting — so it needs no hit-testing and reads exactly one rect per gesture, where the sources did two forced layouts per pointermove."
      @source={{this.usage}}
    >
      <:example>
        <LayerManager
          @layers={{this.layers}}
          @onLayersChange={{this.takeLayers}}
          @selectionMode={{this.mode}}
          @density={{this.density}}
          @indent={{this.indent}}
          @reorderable={{this.reorderable}}
          @showVisibility={{this.showVisibility}}
          @showLock={{this.showLock}}
          @label='Artboard layers'
          @onSelectionChange={{this.noteSelection}}
          @onVisibilityChange={{this.noteVisibility}}
          @onLockChange={{this.noteLock}}
        />
        <p class='ddl-readout'>
          <span class='ddl-readoutLabel'>selected</span>
          <Token @value={{this.chosen}} />
          <span class='ddl-readoutLabel'>last flag</span>
          <Token @value={{this.lastFlag}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.Array
          @name='layers'
          @value={{this.layers}}
          @description='Controlled tree, front-to-back — the top row is the front-most layer, as in every design tool. Each LayerNode is id, name, optional kind, optional hidden and locked flags, and optional children. Omit the arg for the uncontrolled case and seed with defaultLayers.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onLayersChange'
          @description='(next) with the NEXT WHOLE TREE after any structural change — a move, a visibility flip, a lock flip. One channel, so a host stores the result rather than reassembling it from deltas. Nothing is ever mutated in place: every operation returns a fresh tree with fresh arrays, which is what keeps a Glimmer consumer re-rendering.'
        />
        <Args.String
          @name='selectionMode'
          @value={{this.mode}}
          @options={{this.modeOptions}}
          @defaultValue='single'
          @description='In multi, Ctrl or Cmd click toggles, Shift click ranges over the visible rows, and both have keyboard twins — Space toggles, Shift with the up and down arrows ranges, Ctrl or Cmd A takes everything, Escape clears.'
          @onInput={{this.setMode}}
        />
        <Args.String
          @name='density'
          @value={{this.density}}
          @options={{this.densityOptions}}
          @defaultValue='comfortable'
          @description='Row height preset — 22px compact, 26px comfortable. On a coarse pointer both grow to 36px, because a 26px row is not a touch target.'
          @onInput={{this.setDensity}}
        />
        <Args.Number
          @name='indent'
          @value={{this.indent}}
          @min={{6}}
          @max={{32}}
          @defaultValue={{14}}
          @description='px of indent per nesting level. It is also the horizontal distance that counts as one nesting step during a pointer drag, so the gesture and the geometry can never disagree.'
          @onInput={{this.setIndent}}
        />
        <Args.Bool
          @name='reorderable'
          @value={{this.reorderable}}
          @defaultValue={{true}}
          @description='Offer the grab handle and the whole move contract. Turning it off removes a column, and the cursor clamps rather than stranding the tab stop on a cell that no longer exists.'
          @onInput={{this.setReorderable}}
        />
        <Args.Bool
          @name='showVisibility'
          @value={{this.showVisibility}}
          @defaultValue={{true}}
          @description='The eye column. The eye is drawn in CSS rather than set as a glyph, so the hidden state is a SHAPE — a slash — and not a tint.'
          @onInput={{this.setShowVisibility}}
        />
        <Args.Bool
          @name='showLock'
          @value={{this.showLock}}
          @defaultValue={{true}}
          @description='The padlock column, on the same terms: unlocked tilts the shackle open rather than changing colour.'
          @onInput={{this.setShowLock}}
        />
        <Args.Array
          @name='expanded'
          @description='Controlled expansion, as ids. Uncontrolled and unseeded, every branch starts open — a layers panel that hides the tree it exists to show is not a useful default.'
          @hideControls={{true}}
        />
        <Args.Array
          @name='selected'
          @description='Controlled selection, as ids. defaultSelected seeds the uncontrolled case.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onSelectionChange'
          @description='(ids, nodes) with the next selection, in visible-row order.'
        />
        <Args.Action
          @name='onVisibilityChange'
          @description='(node, hidden) — the delta, for hosts that want it narrower than the whole tree.'
        />
        <Args.Action
          @name='onLockChange'
          @description='(node, locked), on the same terms.'
        />
        <Args.Action
          @name='onActivate'
          @description='(node) on double-click, and on Enter in the name cell.'
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @description='Dimmed; nothing moves and nothing toggles. Rows stay focusable and readable, because a disabled panel is still information — this is why the toggles use aria-disabled rather than the disabled attribute.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='name'
          @description="Replaces the name cell's contents; receives the row, including its resolved level, position and inherited state."
        />
        <Args.Yield
          @name='trailing'
          @description='Trailing content inside the name cell — a blend-mode chip, an opacity readout. Keep focusable controls out of it: the row is a grid and a stray tab stop breaks the composite.'
        />
        <Args.Yield
          @name='empty'
          @description='Replaces the built-in empty state.'
        />
      </:api>

      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-lm-indent'
          @type='dimension'
          @description='Indent per level. Set through @indent.'
        />
        <Css.Basic
          @name='pretui-lm-row-h'
          @type='dimension'
          @description='Row height. Set by @density, raised on coarse pointers.'
        />
        <Css.Basic
          @name='pretui-lm-transition'
          @type='duration'
          @description='Twisty rotation and shackle tilt. Zeroed under prefers-reduced-motion.'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .ddl-readout {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2, 6px);
        margin: var(--space-3, 8px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .ddl-readoutLabel {
        font-weight: var(--weight-medium, 500);
      }
    </style>
  </template>
}

export const DEMOS_LAYER_MANAGER: Record<string, unknown> = {
  LayerManager: LayerManagerUsage,
};
