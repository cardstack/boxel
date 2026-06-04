import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { getContrastColor } from '../../helpers/contrast-color.ts';
import cssVar from '../../helpers/css-var.ts';
import { deterministicColorFromString } from '../../helpers/deterministic-color-from-string.ts';

interface Signature {
  Args: {
    displayName?: string;
    isReady: boolean;
    thumbnailURL?: string;
    userId?: string | null;
  };
  Element: HTMLDivElement;
}

const setBackgroundImage = (backgroundURL: string | null | undefined) => {
  if (!backgroundURL) {
    return;
  }
  return htmlSafe(`background-image: url(${backgroundURL});`);
};

export default class Avatar extends Component<Signature> {
  <template>
    {{#let (deterministicColorFromString @userId) as |bgColor|}}
      <div
        class='profile-icon'
        style={{if
          @thumbnailURL
          (setBackgroundImage @thumbnailURL)
          (cssVar
            profile-avatar-icon-background=bgColor
            profile-avatar-text-color=(getContrastColor bgColor)
          )
        }}
        data-test-profile-icon={{@isReady}}
        data-test-profile-icon-userId={{@userId}}
        role={{if @thumbnailURL 'img' 'presentation'}}
        aria-label={{if @displayName @displayName @userId}}
        ...attributes
      >
        {{#unless @thumbnailURL}}
          {{this.profileInitials}}
        {{/unless}}
      </div>
    {{/let}}
    <style scoped>
      .profile-icon {
        --icon-size: var(--profile-avatar-icon-size, 40px);
        background: var(--profile-avatar-icon-background, var(--boxel-dark));
        background-position: center;
        background-size: cover;
        border-radius: 50%;
        border: var(--profile-avatar-icon-border, 2px solid white);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: var(--icon-size);
        width: var(--icon-size);
        color: var(--profile-avatar-text-color, var(--boxel-light));
        font-size: calc(var(--icon-size) * 0.55);
        letter-spacing: 0;
        line-height: 1;
      }
    </style>
  </template>

  get profileInitials() {
    if (!this.args.isReady) {
      return undefined;
    }
    let name = this.args.displayName?.length
      ? this.args.displayName
      : (this.args.userId?.replace(/^@/, '') ?? '');
    return name.slice(0, 1).toUpperCase();
  }
}
