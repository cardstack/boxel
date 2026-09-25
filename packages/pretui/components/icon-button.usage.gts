// Pretui — IconButton usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { IconButton } from './icon-button';
import type { ButtonVariant } from './button';

const ICON_VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'];

// ── IconButton ← icon-button/usage.gts ───────────────────────────────────
// Dropped knobs: @icon (the glyph arrives as block content, not a component
// ref — documented on the Yield row), @size (fixed 28px square), @loading
// (no busy state on IconButton), @round (fixed radius), @disabled (not in
// IconButtonSignature — splat the attribute if needed), @width / @height
// (size the yielded svg directly).
export class IconButtonUsage extends Component {
  variantOptions = ICON_VARIANTS;
  @tracked labelText = 'Add item';
  @tracked variant = 'secondary';
  setLabel = (v: string) => (this.labelText = v);
  setVariant = (v: string) => (this.variant = v);
  get variantVal() {
    return this.variant as ButtonVariant;
  }
  get usage() {
    return `<IconButton @label='${this.labelText}' @variant='${this.variant}'>…icon svg…</IconButton>`;
  }
  <template>
    <FreestyleUsage
      @name='IconButton'
      @description='Button rendered as a single icon with no text — used in toolbars, table-row actions, and tight UI spots where a labelled button would not fit.'
      @source={{this.usage}}
    >
      <:example>
        <IconButton @label={{this.labelText}} @variant={{this.variantVal}}>
          <svg width='14' height='14' viewBox='0 0 14 14' aria-hidden='true'><path d='M7 2v10M2 7h10' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' /></svg>
        </IconButton>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @required={{true}}
          @value={{this.labelText}}
          @description='Accessible name — rendered as aria-label and title.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='variant'
          @optional={{true}}
          @defaultValue='secondary'
          @value={{this.variant}}
          @options={{this.variantOptions}}
          @description='Legacy variant sugar over the tone + appearance axes.'
          @onInput={{this.setVariant}}
        />
        <Args.Yield
          @description="Yield for button content — the icon glyph as block content replaces boxel-ui's @icon component ref."
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_ICON_BUTTON: Record<string, unknown> = {
  IconButton: IconButtonUsage,
};
