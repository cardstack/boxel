// Pretui — CommandPalette usage page.
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { CommandPalette } from './command-palette';
import { Kbd } from './kbd';
import { MenuState } from '../demo-menu';

// ── CommandPalette ───────────────────────────────────────────────────────
class CommandPaletteUsage extends MenuState {
  <template>
    <FreestyleUsage
      @name='CommandPalette'
      @description='The same MenuNode tree Menu renders in place, seen flattened and filtered. Typing searches every command beneath the current scope — including the ones nested inside submenus, with their path shown — and the matched characters are highlighted by a dependency-free fuzzy matcher that prefers word-boundary initials, so "cs" finds Copy lot link before it finds an "s" in the middle of a word. Descending into a submenu pushes a breadcrumb scope (kbar’s model) so nesting survives the flattening; Backspace or ← on an empty query pops back out, and Esc leaves one scope at a time before closing. Checkmark state travels with the node, so a toggle is a toggle in both surfaces. It is a combobox, not a menu: the input keeps focus and aria-activedescendant points at the active row, which is the pattern assistive tech actually handles for a filtered list.'
    >
      <:example>
        <div class='pal-row'>
          <Button
            @tone='neutral'
            @appearance='outlined'
            {{on 'click' this.openPalette}}
          >Open palette
            <Kbd @value='Mod+K' @platform={{this.platformValue}} /></Button>
          <span class='menu-log'>last action:
            <strong>{{this.log}}</strong></span>
        </div>
        <CommandPalette
          @items={{this.items}}
          @open={{this.paletteOpen}}
          @onOpen={{this.openPalette}}
          @onClose={{this.closePalette}}
          @platform={{this.platformValue}}
          @label='Sourcing desk commands'
          @placeholder='Search lot commands…'
        />
        <p class='menu-hint'>Try
          <em>“export”</em>
          — it is two submenus deep and still one keystroke away. Then open
          <em>Share</em>
          to see the breadcrumb, and press Backspace on an empty query to come
          back.</p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @description='The same MenuNode tree Menu takes — nothing is redefined for the palette. Sections flatten into group headers; submenus become enterable scopes AND searchable branches; description and keywords widen what a node matches on without widening what it highlights.'
          @value={{this.items}}
        />
        <Args.Base
          @name='open / onClose / onOpen'
          @description='Controlled visibility over a native <dialog>, so the top layer, the focus trap, the backdrop and Escape come from the platform rather than a z-index and a scroll lock.'
          @hideControls={{true}}
        />
        <Args.String
          @name='hotkey'
          @description='Global shortcut that opens the palette (default Mod+K); needs @onOpen. The listener is owned by an ember-modifier and removed on teardown.'
          @value='Mod+K'
          @defaultValue='Mod+K'
        />
        <Args.Base
          @name='placeholder / label / emptyMessage / platform'
          @description='Copy knobs. Everything visual is a token; --pretui-palette-hit re-tints the match highlight on its own.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pal-row {
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

export const DEMOS_COMMAND_PALETTE: Record<string, unknown> = {
  CommandPalette: CommandPaletteUsage,
};
