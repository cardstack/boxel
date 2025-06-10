import Component from '@glimmer/component';

import { IconButton } from '@cardstack/boxel-ui/components';
import type { Icon } from '@cardstack/boxel-ui/icons';

interface Signature {
  Args: {
    icon?: Icon;
    variant?: string; // default: primary-dark
    iconWidth?: string; // default svg size: 16px
    iconHeight?: string; // default svg size: 16px
    round?: boolean;
  };
  Element: HTMLButtonElement;
  Blocks: { default: [] };
}

export default class OperatorModeIconButton extends Component<Signature> {
  <template>
    <IconButton
      @variant='{{if @variant @variant "primary-dark"}} {{if @round "round"}}'
      @icon={{@icon}}
      @width={{@iconWidth}}
      @height={{@iconHeight}}
      class='operator-mode-icon-button'
      ...attributes
    >
      {{yield}}
    </IconButton>
    <style scoped>
      .operator-mode-icon-button {
        --boxel-icon-button-width: var(--container-button-size);
        --boxel-icon-button-height: var(--container-button-size);
      }
    </style>
  </template>
}
