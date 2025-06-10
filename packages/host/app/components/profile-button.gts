import Component from '@glimmer/component';

import { Avatar } from '@cardstack/boxel-ui/components';

import OperatorModeIconButton from '@cardstack/host/components/operator-mode/icon-button';

import type MatrixService from '@cardstack/host/services/matrix-service';

interface Signature {
  Args: {
    matrixService: MatrixService;
  };
  Element: HTMLButtonElement;
}

export default class ProfileButton extends Component<Signature> {
  <template>
    <OperatorModeIconButton
      class='profile-icon-button'
      @round={{true}}
      ...attributes
      data-test-profile-icon-button
    >
      <Avatar
        @isReady={{@matrixService.profile.loaded}}
        @userId={{@matrixService.userId}}
        @displayName={{@matrixService.profile.displayName}}
      />
    </OperatorModeIconButton>

    <style scoped>
      .profile-icon-button {
        background: none;
        border: none;
      }
    </style>
  </template>
}
