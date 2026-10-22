// Pretui — ContextMenu usage page.
//
// The stage is a board of lots, because a context menu only makes sense
// against something you can point at. The same `MenuEntry[]` shape `Menu`,
// `Menubar` and `CommandPalette` take is used verbatim — that is the claim the
// page is making, so it should be demonstrated rather than restated.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { ContextMenu } from './context-menu';
import type { MenuEntry, ShortcutPlatform } from '../internal/menu';

const PLATFORM_OPTIONS = ['apple', 'other'];

class ContextMenuUsage extends GlimmerComponent {
  @tracked platform = 'apple';
  @tracked focusable = true;
  @tracked pinned = false;
  @tracked grade = 'cupping';
  @tracked log = '—';

  setPlatform = (value: string) => (this.platform = value);
  setFocusable = (value: boolean) => (this.focusable = value);

  get platformValue() {
    return this.platform as ShortcutPlatform;
  }

  private ran = (what: string) => () => (this.log = what);

  setPinned = (next: boolean) => {
    this.pinned = next;
    this.log = next ? 'Pinned to desk' : 'Unpinned';
  };
  sortByCupping = () => {
    this.grade = 'cupping';
    this.log = 'Sort: cupping score';
  };
  sortByArrival = () => {
    this.grade = 'arrival';
    this.log = 'Sort: arrival date';
  };

  get items(): MenuEntry[] {
    return [
      {
        label: 'Open lot',
        kbd: 'Mod+O',
        isDefault: true,
        onSelect: this.ran('Open lot'),
      },
      {
        label: 'Rename',
        needsInput: true,
        onSelect: this.ran('Rename'),
      },
      '---',
      {
        kind: 'toggle',
        label: 'Pin to desk',
        checked: this.pinned,
        onChange: this.setPinned,
      },
      {
        kind: 'section',
        label: 'Sort board by',
        items: [
          {
            kind: 'radio',
            group: 'grade',
            label: 'Cupping score',
            checked: this.grade === 'cupping',
            onSelect: this.sortByCupping,
          },
          {
            kind: 'radio',
            group: 'grade',
            label: 'Arrival date',
            checked: this.grade === 'arrival',
            onSelect: this.sortByArrival,
          },
        ],
      },
      {
        kind: 'submenu',
        label: 'Share',
        items: [
          { label: 'Copy link', kbd: 'Mod+Shift+C', onSelect: this.ran('Copy link') },
          { label: 'Email the desk', needsInput: true, onSelect: this.ran('Email the desk') },
        ],
      },
      '---',
      {
        label: 'Withdraw lot',
        destructive: true,
        onSelect: this.ran('Withdraw lot'),
      },
    ];
  }

  <template>
    <FreestyleUsage
      @name='ContextMenu'
      @description='Right-click, on the shared menu engine rather than a second one. The MenuNode taxonomy, the row transform, the panel markup and its whole stylesheet, the shortcut faces, the safe triangle, the roving tabindex and the type-ahead all come from menu.gts — a command object written for Menu renders here unchanged. What is genuinely different is the anchoring and the keyboard: the menu hangs off a zero-size fixed box at the invocation point, measured by the same anchorTo primitive every other Pretui overlay uses, so it flips and shifts near a viewport edge for free. The region takes a tab stop by default, which is what makes Shift+F10 and the Menu key reach it at all, and dismissal returns focus to the region rather than dropping it on the body.'
    >
      <:example>
        <ContextMenu
          @items={{this.items}}
          @platform={{this.platformValue}}
          @focusable={{this.focusable}}
          @label='Lot actions'
        >
          <:default as |isOpen|>
            <div class='cm-board' data-open={{if isOpen 'true'}}>
              <span class='cm-board-title'>Arrivals board</span>
              <ul class='cm-board-list'>
                <li>Ethiopia Guji · 87.5</li>
                <li>Colombia Huila · 86.0</li>
                <li>Kenya Nyeri · 88.25</li>
              </ul>
              <span class='cm-board-hint'>right-click, long-press, or focus and
                press Shift+F10</span>
            </div>
          </:default>
        </ContextMenu>
        <p class='cm-log'>last action: <strong>{{this.log}}</strong></p>
        <p class='cm-hint'>Tab to the board and press
          <em>Shift+F10</em>
          (or the Menu key): the menu opens against the board rather than at the
          top-left corner, and the first item already has focus, which is what
          the APG asks for on a keyboard invocation. A right-click opens it
          merely displayed, focus untouched, exactly as a platform menu does.
          Escape closes one level at a time and the last one puts focus back on
          the board.</p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @description='The same MenuNode tree Menu takes: commands, toggles with true/false/mixed, radio groups, sections, submenus, separators, dynamic Alt overlays, the ellipsis convention and the destructive flag. Nothing about this arg is context-menu specific, which is the point.'
          @value={{this.items}}
        />
        <Args.Bool
          @name='focusable'
          @description='The region takes a tab stop. This is what makes the platform keys reachable — a browser fires contextmenu for Shift+F10 and the Menu key only on an element that can hold focus, so a menu on a bare div is pointer-only no matter what it listens for. Turn it off when the region already contains its own focusable rows and the menu should hang off those instead.'
          @value={{this.focusable}}
          @defaultValue={{true}}
          @onInput={{this.setFocusable}}
        />
        <Args.String
          @name='platform'
          @description='Forces the shortcut spelling instead of detecting it. One kbd token renders both faces, so the platform mapping never lands in a caller string.'
          @value={{this.platform}}
          @options={{PLATFORM_OPTIONS}}
          @defaultValue='(detected)'
          @onInput={{this.setPlatform}}
        />
        <Args.Base
          @name='open / onOpenChange / defaultOpen / onSelect'
          @description='The overlay contract plus the menu one. A controlled ContextMenu is how a host that owns its own selection model opens the menu itself — the point it opens at is still the components own, taken from the gesture.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='longPressDelay'
          @description='Seconds of press before a touch opens the menu (0.5, the platform long-press threshold on both mobile OSes; Radix uses 0.7). One-shot: any movement, lift or cancel clears the handle and nothing re-arms it.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='hoverDelay / safeDelay'
          @description='Submenu hover intent and how long the Amazon safe triangle keeps deferring a sibling row the pointer crosses on its diagonal. Both are the same owned, one-shot timers Menu uses, and the keyboard path never depends on either.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='default'
          @description='The right-clickable region, yielded the open state so it can show its own selected treatment while the menu is up. The wrapper is display:contents, so it does not disturb the layout it wraps.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .cm-board {
        display: grid;
        gap: var(--space-3, 8px);
        max-width: 320px;
        padding: var(--space-5, 15px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: 0 0 0 1px var(--border);
        transition: box-shadow var(--pretui-dur-snap, 140ms) var(--pretui-ease-snap, ease);
      }
      .cm-board[data-open] {
        box-shadow: 0 0 0 1px var(--ring);
      }
      .cm-board-title {
        font-weight: 600;
        font-size: var(--text-ui-md, 12.5px);
      }
      .cm-board-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 3px;
        font-size: var(--text-ui-md, 12.5px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
      .cm-board-hint {
        font-size: var(--text-ui-xs, 11px);
        color: var(--ink-3, var(--boxel-400));
      }
      .cm-log {
        margin: var(--space-4, 11px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .cm-log strong {
        color: var(--foreground);
        font-weight: 600;
      }
      .cm-hint {
        margin: var(--space-3, 8px) 0 0;
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
      .cm-hint em {
        font-style: normal;
        font-weight: 600;
        color: var(--foreground);
      }
      @media (prefers-reduced-motion: reduce) {
        .cm-board {
          transition: none;
        }
      }
    </style>
  </template>
}

export const DEMOS_CONTEXT_MENU: Record<string, unknown> = {
  ContextMenu: ContextMenuUsage,
};
