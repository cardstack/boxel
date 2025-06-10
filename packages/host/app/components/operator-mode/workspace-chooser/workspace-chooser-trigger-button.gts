import Component from '@glimmer/component';

import { cn, not } from '@cardstack/boxel-ui/helpers';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';

import OperatorModeIconButton from '@cardstack/host/components/operator-mode/icon-button';

interface Signature {
  Args: {
    isDisabled: boolean;
    isWorkspaceChooserOpen: boolean;
  };
  Element: HTMLButtonElement;
}

export default class WorkspaceChooserTriggerButton extends Component<Signature> {
  <template>
    <OperatorModeIconButton
      @icon={{BoxelIcon}}
      @iconWidth='40px'
      @iconHeight='40px'
      disabled={{@isDisabled}}
      class={{cn 'workspace-button' dark-icon=(not @isWorkspaceChooserOpen)}}
      ...attributes
      data-test-workspace-chooser-toggle
    />
    <style scoped>
      .workspace-button {
        background: none;
        border: none;
        outline: var(--boxel-border-flexible);
      }
      .workspace-button:focus:not(:focus-visible) {
        outline: var(--boxel-border-flexible);
        outline-offset: unset;
      }
      .workspace-button:focus:not(:disabled) {
        outline-offset: unset;
      }
      .dark-icon {
        --icon-bg-opacity: 1;
        --icon-color: var(--boxel-dark);
      }
    </style>
  </template>
}
