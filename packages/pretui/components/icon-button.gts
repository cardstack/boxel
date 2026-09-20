// IconButton: a square Button whose label is the yielded icon; the accessible name rides aria-label / title.
import Component from '@glimmer/component';
import { firstDefined } from '../pretui-primitives';
import type { PretuiSizeArg } from '../pretui-primitives';
import { Button } from './button';
import type { ButtonVariant } from './button';

export interface IconButtonSignature {
  Args: {
    label: string;
    variant?: ButtonVariant;
    size?: PretuiSizeArg;
    disabled?: boolean;
    /** alias — React Aria / Base UI spelling of @disabled */
    isDisabled?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement;
}

export class IconButton extends Component<IconButtonSignature> {
  get variant() {
    return this.args.variant ?? 'secondary';
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  <template>
    <Button
      @variant={{this.variant}}
      @size={{@size}}
      @disabled={{this.disabled}}
      class='pretui-iconbtn'
      aria-label={{@label}}
      title={{@label}}
      data-test-pretui-icon-button
      ...attributes
    >{{yield}}</Button>
    <style scoped>
      :deep(.pretui-iconbtn) {
        padding: 0;
        width: var(--control-h, 28px);
      }
    </style>
  </template>
}
