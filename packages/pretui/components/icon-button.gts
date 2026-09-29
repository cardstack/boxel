// IconButton: a square Button whose label is the yielded icon; the accessible name rides aria-label / title.
import Component from '@glimmer/component';
import { firstDefined } from '../pretui-primitives';
import type { PretuiSizeArg } from '../pretui-primitives';
import { Button } from './button';
import type { ButtonShape, ButtonVariant } from './button';

export interface IconButtonSignature {
  Args: {
    label: string;
    variant?: ButtonVariant;
    size?: PretuiSizeArg;
    disabled?: boolean;
    /** 'pill' makes a circle, since the button is square */
    shape?: ButtonShape;
    /** alias of @disabled */
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
      @shape={{@shape}}
      class='pretui-iconbtn'
      aria-label={{@label}}
      title={{@label}}
      data-test-pretui-icon-button
      ...attributes
    >{{yield}}</Button>
    <style scoped>
      /* above Button's layer, so these win by layer order, not file order */
      @layer Component, Composite;
      @layer Composite {
        .pretui-iconbtn {
          padding: 0;
          width: var(--pretui-button-h, 2.24em);
        }
        /* square against Button's 24px minimum height at xs */
        .pretui-iconbtn[data-size='xs'] {
          width: max(var(--pretui-button-h, 2.24em), 1.5rem);
        }
      }
    </style>
  </template>
}
