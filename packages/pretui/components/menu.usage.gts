// Pretui — Menu usage page.
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Kbd } from './kbd';
import { Menu } from './menu';
import { MenuState, PLATFORM_OPTIONS } from '../demo-menu';

// ── Menu ─────────────────────────────────────────────────────────────────
const ALIGN_OPTIONS = ['start', 'end'];

class MenuUsage extends MenuState {
  <template>
    <FreestyleUsage
      @name='Menu'
      @description='A platform menu, not a popover list: submenus, checkmark toggles with mixed state, mutually exclusive radio groups, section headers, separators, a bold default item, dynamic items that swap while Option/Alt is held, and the HIG ellipsis convention applied by the component so no caller can type three periods. Keyboard is the whole APG contract — one tab stop with a roving tabindex, ↑/↓ wrapping, → into a submenu and ← back out, Home/End, multi-character type-ahead, Enter/Space to activate, Esc to close exactly one level, Tab to dismiss and move on with focus returned to the trigger. Disabled items use aria-disabled, never the disabled attribute, so a dimmed command stays focusable and announced instead of silently vanishing for keyboard and screen-reader users. Hovering across a diagonal toward an open submenu is protected by the Amazon safe triangle, so the submenu never flickers away as you reach for it.'
    >
      <:example>
        <div class='menu-row'>
          <Menu
            @items={{this.items}}
            @align={{this.alignValue}}
            @platform={{this.platformValue}}
            @label='Lot actions'
          >
            <:trigger as |open toggle|>
              <Button
                @tone='neutral'
                @appearance='outlined'
                {{on 'click' toggle}}
              >
                {{if open 'Close' 'Lot actions'}}
              </Button>
            </:trigger>
          </Menu>
          <span class='menu-log'>last action:
            <strong>{{this.log}}</strong></span>
        </div>
        <p class='menu-hint'>Open it, then try: ↓ to walk, → on
          <em>Share</em>
          to descend, type
          <em>“sh”</em>
          to jump, hold
          <Kbd @value='Alt' @platform={{this.platformValue}} />
          to watch
          <em>Duplicate</em>
          change, and Esc to step back one level at a time.</p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @description='The MenuNode tree. A node is {label, kbd?, icon?, disabled?, destructive?, isDefault?, needsInput?, alt?, onSelect?} plus a kind: omitted or "command", "toggle" (checked may be true/false/"mixed"), "radio" (with a group), "submenu" (with items), or "section" (a labelled group). The string "---" is a separator. The pre-rebuild MenuItemSpec shape is exactly a command node, so every existing call site still compiles.'
          @value={{this.items}}
        />
        <Args.String
          @name='align'
          @description='Which edge of the trigger the root panel aligns to. @placement takes a full PopupPlacement and overrides this.'
          @value={{this.align}}
          @options={{ALIGN_OPTIONS}}
          @defaultValue='start'
          @onInput={{this.setAlign}}
        />
        <Args.String
          @name='platform'
          @description='Forces the shortcut spelling instead of detecting it. One kbd token — "Mod+Shift+N" — renders ⇧⌘N on Apple platforms and Ctrl+Shift+N everywhere else, so the mapping never lands in a caller string.'
          @value={{this.platform}}
          @options={{PLATFORM_OPTIONS}}
          @defaultValue='(detected)'
          @onInput={{this.setPlatform}}
        />
        <Args.Yield
          @name='trigger'
          @description='Yields the open state and a toggle. The component finds the focusable control inside this block and gives it aria-haspopup="menu", a live aria-expanded and the APG arrow keys itself — a caller that wires only a click handler to toggle still gets the whole contract, and every attribute is restored on teardown.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='open / onOpenChange / anchorElement'
          @description='Controlled mode and an alternative anchor. Anchoring the root panel at something other than the trigger is what makes a selection menu or a toolbar menu this same component rather than another implementation. Not built: point anchoring for a right-click context menu, which needs a virtual anchor the placement primitive does not take.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='hoverDelay / safeDelay'
          @description='Submenu hover-intent (110ms) and how long the safe triangle keeps deferring a sibling row the pointer crosses on its diagonal (300ms). Both timers are owned by an ember-modifier and cleared in its destructor; the keyboard path never depends on either.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .menu-row {
        display: flex;
        align-items: center;
        gap: var(--space-4, 11px);
        flex-wrap: wrap;
      }
      .menu-log {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .menu-log strong {
        color: var(--foreground);
        font-weight: 600;
      }
      .menu-hint {
        margin: var(--space-4, 11px) 0 0;
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_MENU_USAGE: Record<string, unknown> = {
  Menu: MenuUsage,
};
