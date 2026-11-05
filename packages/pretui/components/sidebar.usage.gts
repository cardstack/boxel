// Pretui — Sidebar usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Sidebar, SidebarGroup, SidebarItem, SidebarTrigger } from './sidebar';
import type {
  ShellPlacementAlias,
  SidebarCollapsible,
  SidebarScroll,
} from './sidebar';
import Folder from '@cardstack/boxel-icons/folder';
import Globe from '@cardstack/boxel-icons/globe';
import Eye from '@cardstack/boxel-icons/eye';
import Copy from '@cardstack/boxel-icons/copy';
import { FreestyleUsage } from './freestyle-usage';
import { Toolbar } from './toolbar';
import { LIBRARY, ORIGINS } from '../internal/structure-shell-fixtures';

// ── Sidebar ──────────────────────────────────────────────────────────────

export class SidebarUsage extends Component {
  @tracked open = true;
  @tracked collapsible = 'rail';
  @tracked placement = 'start';
  @tracked mobile = false;
  @tracked bordered = true;
  @tracked activeId = 'lib-0';
  @tracked toggles = 0;
  @tracked railBreakpoint = 1024;
  @tracked scroll = 'content';
  @tracked resizable = true;

  collapsibleOptions = ['rail', 'offcanvas', 'none'];
  placementOptions = ['start', 'end'];
  scrollOptions = ['page', 'content'];
  filler = [1, 2, 3, 4, 5, 6];
  // A different glyph per row: `<:icon>` takes any icon, not only a dot.
  library = LIBRARY.map((row, i) => ({ ...row, icon: [Folder, Eye, Copy][i % 3] }));
  origins = ORIGINS.map((row, i) => ({ ...row, icon: [Globe, Copy][i % 2] }));

  setOpen = (v: boolean) => {
    this.open = v;
    this.toggles = this.toggles + 1;
  };
  setCollapsible = (v: string) => {
    this.collapsible = v;
  };
  setPlacement = (v: string) => {
    this.placement = v;
  };
  setMobile = (v: boolean) => {
    this.mobile = v;
  };
  setRailBreakpoint = (v: number) => {
    this.railBreakpoint = v;
  };
  setScroll = (v: string) => {
    this.scroll = v;
  };
  setResizable = (v: boolean) => {
    this.resizable = v;
  };
  setBordered = (v: boolean) => {
    this.bordered = v;
  };
  isActive = (id: string) => id === this.activeId;
  select = (id: string) => {
    this.activeId = id;
  };
  selectFor = (id: string) => () => this.select(id);

  // The knob rows carry plain strings; the component takes exhaustive unions.
  // One narrowing getter per knob keeps the cast at the boundary.
  get collapsibleValue(): SidebarCollapsible {
    return this.collapsible as SidebarCollapsible;
  }
  get scrollValue(): SidebarScroll {
    return this.scroll as SidebarScroll;
  }
  get placementValue(): ShellPlacementAlias {
    return this.placement as ShellPlacementAlias;
  }

  get usage(): string {
    return [
      '<Sidebar',
      "  @label='Workspace'",
      "  @persistKey='studio'",
      "  @collapsible='" + this.collapsible + "'",
      "  @placement='" + this.placement + "'",
      '  @railBreakpoint={{' + this.railBreakpoint + '}}',
      "  @scroll='" + this.scroll + "'",
      '  @resizable={{' + this.resizable + '}}',
      '>',
      '  <:header as |bar|>…</:header>',
      '  <:nav as |bar|>…</:nav>',
      '  <:default as |bar|>…</:default>',
      '</Sidebar>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Sidebar'
      @description='App chrome: a collapsible rail beside a page. The handle on the seam is a real tab stop with a name that states the action and an aria-expanded that states the state — shadcn ships its rail with tabindex minus one and no ARIA at all, and Ant cannot collapse its sider by keyboard in any way. Cmd or Ctrl plus B toggles it, and unlike the source that shortcut stays out of the way while you are typing in a field.'
      @source={{this.usage}}
    >
      <:example>
        <div class='shell-stage'>
          <Sidebar
            @label='Workspace'
            @open={{this.open}}
            @onOpenChange={{this.setOpen}}
            @collapsible={{this.collapsibleValue}}
            @placement={{this.placementValue}}
            @mobile={{if this.mobile true}}
            @railBreakpoint={{this.railBreakpoint}}
            @bordered={{this.bordered}}
            @scroll={{this.scrollValue}}
            @resizable={{this.resizable}}
          >
            <:header as |bar|>
              <div class='shell-brand' data-compact={{if bar.collapsed 'true' 'false'}}>
                <span class='shell-mark' aria-hidden='true'>P</span>
                {{#unless bar.collapsed}}
                  <span class='shell-brand-name'>Pretui Estates</span>
                {{/unless}}
              </div>
            </:header>

            <:nav as |bar|>
              <SidebarGroup @label='Library'>
                {{#each this.library key='id' as |row|}}
                  <SidebarItem
                    @label={{row.label}}
                    @badge={{row.badge}}
                    @active={{this.isActive row.id}}
                    @collapsed={{bar.collapsed}}
                    @onClick={{this.selectFor row.id}}
                    @icon={{row.icon}}
                  />
                {{/each}}
              </SidebarGroup>

              <SidebarGroup @label='Origins'>
                {{#each this.origins key='id' as |row|}}
                  <SidebarItem
                    @label={{row.label}}
                    @active={{this.isActive row.id}}
                    @collapsed={{bar.collapsed}}
                    @onClick={{this.selectFor row.id}}
                    @icon={{row.icon}}
                  />
                {{/each}}
                <SidebarItem
                  @label='Archived origins'
                  @disabled={{true}}
                  @collapsed={{bar.collapsed}}
                  @icon={{Folder}}
                />
              </SidebarGroup>
            </:nav>

            <:footer as |bar|>
              {{#unless bar.collapsed}}
                <p class='shell-foot'>Pretui Estates · Catalog</p>
              {{/unless}}
            </:footer>

            <:default as |bar|>
              <div class='shell-page'>
                <Toolbar @title={{this.activeId}} @eyebrow='Selected'>
                  <SidebarTrigger
                    @open={{bar.open}}
                    @onToggle={{bar.toggle}}
                    @controls={{bar.controls}}
                    @label='workspace rail'
                  />
                </Toolbar>
                <p class='shell-copy'>The rail is one grid track, so collapsing
                  it animates the track rather than sliding a pinned panel and
                  a matching ghost spacer. In the offcanvas mode the rail also
                  leaves the tab order and the accessibility tree, which the
                  libraries that only translate it off screen do not do.</p>
                <p class='shell-copy'>Narrow this pane past the breakpoint and
                  the rail becomes a drawer — measured from the shell&apos;s own
                  inline size with a resize observer, not from the viewport,
                  because a card does not know the window it is in.</p>
                <p class='shell-copy'>Drag this stage&apos;s corner to resize
                  it: at or above the rail breakpoint the rail is full, between
                  it and the mobile breakpoint it folds to icons, and below
                  that it becomes a drawer. A manual toggle holds until the
                  pane crosses into another band.</p>
                <p class='shell-copy'>With scroll set to content the shell
                  keeps its stage&apos;s height and only this pane scrolls; the
                  rail stays where it is. With resizable on, drag the seam (or
                  focus it and press the arrow keys) to set the rail&apos;s
                  width; dragging below the minimum folds it, and a click still
                  toggles.</p>
                {{#each this.filler}}
                  <p class='shell-copy'>Filler paragraph so this pane is taller
                    than the stage and scrolls on its own.</p>
                {{/each}}
                <p class='shell-count'>onOpenChange fired
                  <b>{{this.toggles}}</b>
                  times</p>
              </div>
            </:default>
          </Sidebar>
        </div>
        <p class='shell-note'>The icon rail, pinned collapsed: icons only. Item
          names live on the tooltip and the accessible name, group labels
          become hairlines and badges are dropped.</p>
        <div class='shell-stage shell-stage-rail' data-test-sidebar-rail-example>
          <Sidebar
            @label='Collapsed workspace'
            @mobile={{false}}
            @open={{false}}
            @bordered={{true}}
          >
            <:nav as |bar|>
              <SidebarGroup @label='Library'>
                {{#each this.library key='id' as |row|}}
                  <SidebarItem
                    @label={{row.label}}
                    @badge={{row.badge}}
                    @active={{this.isActive row.id}}
                    @collapsed={{bar.collapsed}}
                    @onClick={{this.selectFor row.id}}
                  >
                    <:icon><row.icon aria-hidden='true' /></:icon>
                  </SidebarItem>
                {{/each}}
              </SidebarGroup>
              <SidebarGroup @label='Origins'>
                {{#each this.origins key='id' as |row|}}
                  <SidebarItem
                    @label={{row.label}}
                    @collapsed={{bar.collapsed}}
                    @onClick={{this.selectFor row.id}}
                  >
                    <:icon><row.icon aria-hidden='true' /></:icon>
                  </SidebarItem>
                {{/each}}
              </SidebarGroup>
            </:nav>
          </Sidebar>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='open'
          @description='Controlled expanded state. Leave it undefined for the uncontrolled half; the callback fires either way.'
          @defaultValue={{true}}
          @value={{this.open}}
          @onInput={{this.setOpen}}
        />
        <Args.Bool
          @name='defaultOpen'
          @description='The uncontrolled initial state.'
          @defaultValue={{true}}
        />
        <Args.Action
          @name='onOpenChange'
          @description='Fires on every toggle with the next state.'
        />
        <Args.String
          @name='persistKey'
          @description='Persist the collapse preference under this key, namespaced in local storage. Opt-in: with no key this component reads and writes no storage at all. shadcn writes a cookie on every toggle with a hardcoded name and max age, even when the consumer controls the state, and never reads it back.'
        />
        <Args.String
          @name='collapsible'
          @description='rail shrinks to icon width and keeps the rail reachable; offcanvas removes it from layout, the tab order and the accessibility tree; none pins it open and hides the handle.'
          @options={{this.collapsibleOptions}}
          @value={{this.collapsible}}
          @onInput={{this.setCollapsible}}
          @defaultValue='rail'
        />
        <Args.String
          @name='placement'
          @description='Logical start or end. left and right are accepted and mapped, because every React kit spells this physically — but the CSS is logical, so RTL is a dir attribute rather than a second stylesheet.'
          @options={{this.placementOptions}}
          @value={{this.placement}}
          @onInput={{this.setPlacement}}
          @defaultValue='start'
        />
        <Args.String
          @name='label'
          @description='Accessible name for the rail landmark, and the noun in the handle name.'
          @defaultValue='Sidebar'
        />
        <Args.String
          @name='width'
          @description='Expanded rail width; any kit-valid CSS length. In shadcn this is a module constant with no prop.'
          @defaultValue='16rem'
        />
        <Args.String
          @name='railWidth'
          @description='Collapsed rail width in the rail mode.'
          @defaultValue='3.25rem'
        />
        <Args.Bool
          @name='shortcut'
          @description='Bind the Cmd or Ctrl shortcut. With several sidebars mounted, one press toggles one rail: the one holding focus, or the first mounted when focus is in none.'
          @defaultValue={{true}}
        />
        <Args.String
          @name='shortcutKey'
          @description='The shortcut letter, matched case-insensitively because a real browser reports b with caps off and B with shift or caps on.'
          @defaultValue='b'
        />
        <Args.Bool
          @name='mobile'
          @description='Force the drawer mode on, bypassing the pane measurement (the demo leaves it unset when off so the pane bands show). The drawer is the kit Drawer, so the focus trap, Escape and stacking come from the native dialog top layer.'
          @defaultValue={{false}}
          @value={{this.mobile}}
          @onInput={{this.setMobile}}
        />
        <Args.Number
          @name='railBreakpoint'
          @description='Opt-in, rail mode only. Pane width in px below which the rail folds to icons on its own; a manual toggle holds within a band, and the automatic change arrives through onOpenChange.'
          @value={{this.railBreakpoint}}
          @onInput={{this.setRailBreakpoint}}
        />
        <Args.String
          @name='scroll'
          @description='What scrolls when the content is taller than the shell. page lets the page scroll, rail and all; content locks the shell to its container height, keeps the rail in place and scrolls only the content pane. The container needs a definite height.'
          @options={{this.scrollOptions}}
          @value={{this.scroll}}
          @onInput={{this.setScroll}}
          @defaultValue='page'
        />
        <Args.Bool
          @name='resizable'
          @description='Drag the seam, or press the arrow keys on it, to set the expanded width between minWidth and maxWidth. The seam is a separator with aria-valuenow, valuemin and valuemax; dragging below minWidth folds the rail, and a click still toggles. With persistKey the width is remembered.'
          @defaultValue={{false}}
          @value={{this.resizable}}
          @onInput={{this.setResizable}}
        />
        <Args.String
          @name='minWidth'
          @description='Smallest dragged width: a px number or a px or rem string.'
          @defaultValue='12rem'
        />
        <Args.String
          @name='maxWidth'
          @description='Largest dragged width: a px number or a px or rem string, floored at minWidth.'
          @defaultValue='24rem'
        />
        <Args.Number
          @name='mobileBreakpoint'
          @description='Pane width in px below which the rail becomes a drawer. Measured against the shell, not the viewport.'
          @defaultValue={{640}}
        />
        <Args.Bool
          @name='bordered'
          @description='Draw the hairline between rail and content.'
          @defaultValue={{false}}
          @value={{this.bordered}}
          @onInput={{this.setBordered}}
        />
        <Args.Yield
          @name='header / nav / footer / default'
          @description='Each block is yielded a hash of open, collapsed and mobile; nav and default also get toggle, and default gets controls, the rail element id. State is passed down through block params rather than sideways through a context — there is no provider to forget and the dependency is visible in the template.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-sidebar-width'
          @type='dimension'
          @description='Expanded rail width.'
          @defaultValue='16rem'
        />
        <Css.Basic
          @name='pretui-sidebar-rail-width'
          @type='dimension'
          @description='Collapsed rail width in the rail mode.'
          @defaultValue='3.25rem'
        />
        <Css.Basic
          @name='pretui-sidebar-bg'
          @type='color'
          @description='The rail surface.'
          @defaultValue='var(--inset)'
        />
        <Css.Basic
          @name='pretui-drawer-size'
          @type='dimension'
          @description='Rail width in the mobile drawer mode.'
          @defaultValue='360px'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .shell-stage {
        block-size: 340px;
        max-inline-size: 100%;
        overflow: hidden;
        resize: horizontal;
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .shell-stage-rail {
        resize: none;
        inline-size: 14rem;
      }
      .shell-note {
        margin: 0 0 var(--space-3, 0.5rem);
        font-size: var(--text-ui-sm, 0.72rem);
        color: var(--muted-foreground);
      }
      .shell-brand {
        display: flex;
        align-items: center;
        gap: var(--space-3, 8px);
        min-inline-size: 0;
      }
      .shell-brand[data-compact='true'] {
        justify-content: center;
      }
      .shell-mark {
        flex: none;
        display: grid;
        place-items: center;
        inline-size: 22px;
        block-size: 22px;
        border-radius: var(--radius-chip, 6px);
        background: var(--primary);
        color: var(--primary-foreground);
        font-family: var(--font-serif);
        font-style: italic;
        font-weight: 600;
      }
      .shell-brand-name {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
      }
      .shell-foot {
        margin: 0;
        font-size: var(--text-ui-xs, 11px);
        color: var(--ink-3, var(--boxel-400));
      }
      .shell-page {
        padding: var(--space-5, 14px);
        display: grid;
        gap: var(--space-4, 11px);
        align-content: start;
      }
      .shell-copy {
        margin: 0;
        max-inline-size: 52ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.55;
        color: var(--muted-foreground);
      }
      .shell-count {
        margin: 0;
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        color: var(--ink-3, var(--boxel-400));
      }
    </style>
  </template>
}

export const DEMOS_SIDEBAR: Record<string, unknown> = {
  Sidebar: SidebarUsage,
};
