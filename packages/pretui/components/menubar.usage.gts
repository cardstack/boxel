// Pretui — Menubar usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Menubar } from './menubar';
import type { MenuEntry, ShortcutPlatform } from '../internal/menu';
import { PLATFORM_OPTIONS } from '../demo-menu';

// ── Menubar ──────────────────────────────────────────────────────────────
class MenubarState extends GlimmerComponent {
  @tracked platform: string = 'apple';
  @tracked log = '—';
  @tracked wrapLines = false;
  @tracked zoom = 'fit';

  setPlatform = (value: string) => (this.platform = value);
  setZoom = (value: string) => {
    this.zoom = value;
    this.log = 'Zoom: ' + value;
  };
  setWrap = (next: boolean) => {
    this.wrapLines = next;
    this.log = next ? 'Wrap lines on' : 'Wrap lines off';
  };

  get platformValue() {
    return this.platform as ShortcutPlatform;
  }

  private ran = (what: string) => () => (this.log = what);

  get items(): MenuEntry[] {
    return [
      {
        kind: 'submenu',
        label: 'File',
        items: [
          { label: 'New lot', kbd: 'Mod+N', onSelect: this.ran('New lot') },
          {
            label: 'Open lot',
            kbd: 'Mod+O',
            needsInput: true,
            onSelect: this.ran('Open lot…'),
          },
          '---',
          {
            kind: 'submenu',
            label: 'Export as',
            items: [
              { label: 'CSV', onSelect: this.ran('Export CSV') },
              { label: 'Contract PDF', onSelect: this.ran('Export PDF') },
              { label: 'Cupping sheet', onSelect: this.ran('Export sheet') },
            ],
          },
          {
            label: 'Publish to catalog',
            disabled: true,
          },
          '---',
          {
            label: 'Withdraw lot',
            kbd: 'Mod+Backspace',
            destructive: true,
            needsInput: true,
            onSelect: this.ran('Withdraw lot…'),
          },
        ],
      },
      {
        kind: 'submenu',
        label: 'Edit',
        items: [
          { label: 'Undo', kbd: 'Mod+Z', onSelect: this.ran('Undo') },
          {
            label: 'Redo',
            kbd: 'Mod+Shift+Z',
            disabled: true,
            onSelect: this.ran('Redo'),
          },
          '---',
          {
            kind: 'toggle',
            label: 'Wrap long notes',
            checked: this.wrapLines,
            onChange: this.setWrap,
          },
        ],
      },
      {
        kind: 'submenu',
        label: 'View',
        items: [
          {
            kind: 'section',
            label: 'Zoom',
            items: [
              {
                kind: 'radio',
                group: 'zoom',
                label: 'Fit to pane',
                checked: this.zoom === 'fit',
                onSelect: () => this.setZoom('fit'),
              },
              {
                kind: 'radio',
                group: 'zoom',
                label: 'Actual size',
                checked: this.zoom === 'actual',
                onSelect: () => this.setZoom('actual'),
              },
            ],
          },
        ],
      },
      {
        kind: 'submenu',
        label: 'Window',
        disabled: true,
        items: [{ label: 'Never reachable' }],
      },
      { label: 'Help', kbd: 'F1', onSelect: this.ran('Help') },
    ];
  }
}

class MenubarUsage extends MenubarState {
  <template>
    <FreestyleUsage
      @name='Menubar'
      @description='An application menu bar — the WAI-ARIA menubar pattern, which is a different pattern from the menu button Menu implements rather than a horizontal skin of it. The axis flips: ←/→ move between titles and wrap, ↓ opens onto the first item and ↑ opens onto the last, Home/End jump to the first and last title. With a menu already down, ←/→ close it, step to the adjacent title and open THAT one with focus back on the bar — the behaviour that makes a real menu bar feel like one. Esc closes the menu and returns focus to its title, staying in the bar; inside a nested submenu it closes one level. The whole bar is ONE tab stop, so Tab leaves it rather than walking the titles. Hover is deliberately asymmetric: an idle bar ignores it entirely, an active one switches instantly with no dwell delay. It takes the same MenuNode tree as Menu and CommandPalette, so a command is defined once with one shortcut and one enabled rule.'
    >
      <:example>
        <div class='mb-stage'>
          <Menubar
            @items={{this.items}}
            @platform={{this.platformValue}}
            @label='Sourcing desk'
          />
          <span class='mb-log'>last action:
            <strong>{{this.log}}</strong></span>
        </div>
        <p class='mb-hint'>Focus the bar with Tab, then try: →/← to walk the
          titles, ↓ to pull one down, → from an item to jump straight to the
          next menu, type
          <em>“v”</em>
          to reach View, → on
          <em>Export as</em>
          to descend and ← to come back one level. Open File with the mouse and
          then sweep across the titles — once the bar is active, hover switches
          immediately.
          <em>Window</em>
          is dimmed: still focusable and announced, never opens.</p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @description='The same MenuNode tree Menu takes. A submenu node becomes a File/Edit/View menu; a plain command node becomes a bare title that acts on click, like Help. Sections and separators carry no meaning at the top level of a bar and contribute no titles, so they are simply skipped there. Everything below the top level is an ordinary menu at arbitrary depth.'
          @value={{this.items}}
        />
        <Args.String
          @name='label'
          @description='Accessible name for the bar itself, announced as the menubar. A page with more than one bar needs these to differ.'
          @value='Sourcing desk'
          @defaultValue='Main menu'
          @hideControls={{true}}
        />
        <Args.String
          @name='platform'
          @description='Forces the shortcut spelling instead of detecting it, exactly as on Menu — one kbd token renders both faces.'
          @value={{this.platform}}
          @options={{PLATFORM_OPTIONS}}
          @defaultValue='(detected)'
          @onInput={{this.setPlatform}}
        />
        <Args.Base
          @name='onSelect'
          @description='Fires after any item activates, alongside the node own onSelect handler. A toggle flips and the bar closes, per HIG.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='hoverDelay / safeDelay'
          @description='Hover-intent for NESTED submenus (110ms) and how long the Amazon safe triangle defers a sibling row crossed on the diagonal (300ms). Switching between top-level titles is never delayed — once the bar is active the reader has already declared intent. Both timers are owned by an ember-modifier and cleared in its destructor, and neither re-arms.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .mb-stage {
        display: flex;
        align-items: center;
        gap: var(--space-4, 11px);
        flex-wrap: wrap;
      }
      .mb-log {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .mb-log strong {
        color: var(--foreground);
        font-weight: 600;
      }
      .mb-hint {
        margin: var(--space-4, 11px) 0 0;
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
      .mb-hint em {
        font-style: normal;
        font-weight: 600;
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_MENUBAR: Record<string, unknown> = {
  Menubar: MenubarUsage,
};
