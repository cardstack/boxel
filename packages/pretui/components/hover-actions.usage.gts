// Pretui — HoverActions usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import type { PretuiSize } from '../pretui-primitives';
import { HoverActions } from './hover-actions';
import type { HoverAction } from './hover-actions';
import { SIZES } from '../internal/toggle-controls-fixtures';

// ── HoverActions ← listing-hover-card + catalog-image-overlay ────────────
class HoverActionsUsage extends Component {
  sizes = SIZES;
  spaces = ['overlay', 'reserve'];
  placements = ['top-start', 'top-end', 'bottom-start', 'bottom-end'];
  reveals = ['hover', 'always'];

  @tracked space = 'overlay';
  @tracked placement = 'top-end';
  @tracked reveal = 'hover';
  @tracked maxVisible = 3;
  @tracked sizeName = 's';
  @tracked fired = 'nothing yet';

  setSpace = (v: string) => (this.space = v);
  setPlacement = (v: string) => (this.placement = v);
  setReveal = (v: string) => (this.reveal = v);
  setMaxVisible = (v: number | null) => (this.maxVisible = v ?? 0);
  setSize = (v: string) => (this.sizeName = v);

  note = (id: string) => {
    this.fired = id;
  };

  actions: HoverAction[] = [
    { id: 'preview', label: 'Preview', icon: 'eye', onSelect: () => this.note('preview') },
    { id: 'edit', label: 'Edit', icon: 'pencil', onSelect: () => this.note('edit') },
    { id: 'duplicate', label: 'Duplicate', icon: 'copy', onSelect: () => this.note('duplicate') },
    { id: 'link', label: 'Copy link', icon: 'link', onSelect: () => this.note('link') },
    {
      id: 'remove',
      label: 'Delete',
      icon: 'circle-minus',
      destructive: true,
      onSelect: () => this.note('remove'),
    },
  ];

  get spaceVal() {
    return this.space as 'overlay' | 'reserve';
  }
  get placementVal() {
    return this.placement as 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
  }
  get revealVal() {
    return this.reveal as 'hover' | 'always';
  }
  get sizeVal() {
    return this.sizeName as PretuiSize;
  }
  get usage() {
    let bits = ["@label='Actions for Q3 roadmap'", '@actions={{this.actions}}'];
    if (this.space !== 'overlay') bits.push(`@space='${this.space}'`);
    if (this.maxVisible) bits.push(`@maxVisible={{${this.maxVisible}}}`);
    return `<HoverActions ${bits.join(' ')}>…</HoverActions>`;
  }

  <template>
    <FreestyleUsage
      @name='HoverActions'
      @description="An action cluster over a row, card or cell. The reason it is not trivial: hover-only actions do not exist on a touchscreen and are a keyboard tax everywhere else. So the reveal is hover OR focus-within in pure CSS, coarse pointers get the cluster pinned on with no JS, the cluster is a toolbar with roving tabindex — one tab stop per host rather than one per button — Escape hands focus back to the host, and anything past the control budget folds into the kit's Menu instead of being dropped by a container query. Sourced from listing-hover-card, whose no-portal absolute-inset approach is kept wholesale, and catalog-image-overlay, which is the cautionary half."
      @source={{this.usage}}
    >
      <:example>
        <div class='ha-demo-grid'>
          <HoverActions
            class='ha-demo-tile'
            @label='Actions for Q3 roadmap'
            @actions={{this.actions}}
            @space={{this.spaceVal}}
            @placement={{this.placementVal}}
            @reveal={{this.revealVal}}
            @maxVisible={{this.maxVisible}}
            @size={{this.sizeVal}}
          >
            <h4 class='ha-demo-title'>Q3 roadmap</h4>
            <p class='ha-demo-body'>
              Twelve initiatives across four teams. Hover or tab in to reach
              the actions; arrows move between them, Escape returns to the
              tile.
            </p>
          </HoverActions>
          <HoverActions
            class='ha-demo-tile'
            @label='Actions for Pricing experiments'
            @actions={{this.actions}}
            @space={{this.spaceVal}}
            @placement={{this.placementVal}}
            @reveal={{this.revealVal}}
            @maxVisible={{this.maxVisible}}
            @size={{this.sizeVal}}
          >
            <h4 class='ha-demo-title'>Pricing experiments</h4>
            <p class='ha-demo-body'>
              Every tile names its own toolbar, so a list of fifty does not
              announce fifty identical ones.
            </p>
          </HoverActions>
        </div>
        <p class='pretui-demo-readout' data-test-ha-readout>
          last action = {{this.fired}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='actions'
          @description='The cluster contents: id, a required label, an optional icon-registry name, disabled and destructive flags, and onSelect. The label is required because an icon-only control with no name is not a control — the source used arrow characters as button text, which announce as their Unicode names.'
          @value={{this.actions}}
        />
        <Args.String
          @name='label'
          @required={{true}}
          @defaultValue='Actions for Q3 roadmap'
          @description='The toolbar name, and it must say which thing the actions act on. Fifty rows of identically-named toolbars is a list nobody can navigate.'
        />
        <Args.Number
          @name='maxVisible'
          @defaultValue={{0}}
          @value={{this.maxVisible}}
          @min={{0}}
          @max={{5}}
          @description='Total control budget. Past it, the remainder folds into an overflow Menu — and the menu trigger counts against the budget, which is the arithmetic most implementations get wrong.'
          @onInput={{this.setMaxVisible}}
        />
        <Args.String
          @name='space'
          @defaultValue='overlay'
          @value={{this.space}}
          @options={{this.spaces}}
          @description='Overlay floats the cluster inside the host bounds; reserve gives it a real grid column. Both are layout-stable, which is what layout stability actually asks for. Overlay is the default because a permanently empty gutter fails the still-frame test; choose reserve for dense text rows, where an overlay would sit on the words.'
          @onInput={{this.setSpace}}
        />
        <Args.String
          @name='placement'
          @defaultValue='top-end'
          @value={{this.placement}}
          @options={{this.placements}}
          @description='Which corner the cluster occupies in overlay mode. Written with logical properties, so RTL is free.'
          @onInput={{this.setPlacement}}
        />
        <Args.String
          @name='reveal'
          @defaultValue='hover'
          @value={{this.reveal}}
          @options={{this.reveals}}
          @description='Hover reveals on hover or focus-within; always keeps the cluster on, which is what dense lists want. Coarse pointers get always for free — hover is not an input on a touchscreen.'
          @onInput={{this.setReveal}}
        />
        <Args.String
          @name='size'
          @defaultValue='s'
          @value={{this.sizeName}}
          @options={{this.sizes}}
          @description='Scale for the cluster buttons.'
          @onInput={{this.setSize}}
        />
        <Args.Action
          @name='onSelect'
          @description='Fires for every action, inline or overflow, after that action own onSelect.'
        />
        <Args.Yield
          @name='actions'
          @description='Custom cluster contents replacing the actions array. Roving tabindex applies only to the array path — the component cannot know what is inside a block. Opening this block moves the host content into an explicit default block.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-hoveractions-gap'
          @type='length'
          @description='Space between cluster members, and between the host and a reserved cluster.'
        />
        <Css.Basic
          @name='pretui-hoveractions-inset'
          @type='length'
          @description='Distance from the host edge in overlay mode.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .ha-demo-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
        gap: 12px;
      }
      .ha-demo-tile {
        padding: 14px;
        border-radius: var(--radius);
        background: var(--card);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }
      .ha-demo-title {
        margin: 0 0 6px;
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 600;
        color: var(--foreground);
      }
      .ha-demo-body {
        margin: 0;
        font-size: var(--text-ui-xs, 11px);
        line-height: 1.5;
        color: var(--muted-foreground);
      }
      .pretui-demo-readout {
        margin: 12px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_HOVER_ACTIONS: Record<string, unknown> = {
  HoverActions: HoverActionsUsage,
};
