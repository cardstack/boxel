import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { cn } from '@cardstack/boxel-ui/helpers';

import { stringToColor } from '@cardstack/host/lib/utils';

interface Signature {
  Args: {
    userId: string | null;
  };
  Element: HTMLElement;
}

export default class ProfileAvatarIcon extends Component<Signature> {
  get userInitials() {
    // Transform @user:localhost into U, for example
    return this.args.userId?.split(':')[0].slice(1, 2).toUpperCase();
  }

  <template>
    <style>
      .profile-icon {
        width: 40px;
        height: 40px;
        border-radius: 50px;
        border: 2px solid white;
        display: flex;
      }

      .profile-icon--big {
        width: 80px;
        height: 80px;
        border: 0;
      }

      .profile-icon > span {
        color: white;
        margin: auto;

        font-size: var(--boxel-font-size-lg);
      }

      .profile-icon--big > span {
        font-size: var(--boxel-font-size-xxl);
      }
    </style>

    <div
      class='profile-icon'
      style={{htmlSafe (cn 'background:' (stringToColor @userId))}}
      data-test-profile-icon
      ...attributes
    >
      <span>
        {{this.userInitials}}
      </span>
    </div>
  </template>
}
