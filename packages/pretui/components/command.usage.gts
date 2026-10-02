// Pretui — Command usage page.
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Command } from './command';
import { Kbd } from './kbd';
import { MenuState } from '../demo-menu';

class CommandUsage extends MenuState {
  <template>
    <FreestyleUsage
      @name='Command'
      @description='CommandPalette under the shadcn / cmdk name: a search field over the same MenuNode tree Menu renders, opened by a global shortcut. Reach for this import when a port or an agent already speaks that vocabulary; the component, its contract and its writeup are CommandPalette’s.'
      @source="<Command @items={{this.items}} @open={{this.paletteOpen}} @onOpen={{this.openPalette}} @onClose={{this.closePalette}} />"
    >
      <:example>
        <Button
          @tone='neutral'
          @appearance='outlined'
          {{on 'click' this.openPalette}}
        >Open palette
          <Kbd @value='Mod+K' @platform={{this.platformValue}} /></Button>
        <Command
          @items={{this.items}}
          @open={{this.paletteOpen}}
          @onOpen={{this.openPalette}}
          @onClose={{this.closePalette}}
          @platform={{this.platformValue}}
          @label='Sourcing desk commands'
          @placeholder='Search lot commands…'
        />
        <p class='pretui-demo-readout'>last action: <strong>{{this.log}}</strong></p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @description='The MenuNode tree — cmdk’s CommandGroup / CommandItem nesting as data.'
          @value={{this.items}}
        />
        <Args.Base
          @name='open / onOpen / onClose'
          @description='Controlled visibility over a native <dialog>; cmdk’s CommandDialog.'
          @hideControls={{true}}
        />
        <Args.String @name='hotkey' @defaultValue='Mod+K' @description='Global shortcut; needs @onOpen.' />
        <Args.Base
          @name='placeholder / label / emptyMessage / platform'
          @description='Copy knobs — CommandInput placeholder, dialog name, CommandEmpty text.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_COMMAND: Record<string, unknown> = {
  Command: CommandUsage,
};
