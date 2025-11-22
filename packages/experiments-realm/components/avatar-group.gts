import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { Avatar } from '@cardstack/boxel-ui/components';

interface AvatarGroupSignature {
  Args: {
    thumbnailURL?: string;
    name?: string;
    userId?: string | null;
  };
  Blocks: {
    name: [];
    content: [];
  };
  Element: HTMLElement;
}

export default class AvatarGroup extends GlimmerComponent<AvatarGroupSignature> {
  get backgroundImageStyle() {
    return htmlSafe(`background-image: url(${this.args.thumbnailURL});`);
  }

  <template>
    <div class='avatar-group' ...attributes>
      <Avatar
        @userID={{@userId}}
        @displayName={{@name}}
        @thumbnailURL={{@thumbnailURL}}
        @isReady={{true}}
        class='avatar-thumbnail'
      />

      <div class='avatar-info'>
        {{#if (has-block 'name')}}
          {{yield to='name'}}
        {{else}}
          <h3 class='avatar-name'>{{@name}}</h3>
        {{/if}}

        {{#if (has-block 'content')}}
          <div class='avatar-info-content'>
            {{yield to='content'}}
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .avatar-group {
        display: var(--avatar-group-display, flex);
        flex-direction: var(--avatar-group-flex-direction, row);
        align-items: var(--avatar-group-align-items, center);
        gap: var(--avatar-group-gap, var(--boxel-sp-sm));
        min-width: 0;
      }
      .avatar-thumbnail {
        flex-shrink: 0;
        --profile-avatar-icon-size: var(--avatar-thumbnail-size, 60px);
        --profile-avatar-icon-border: var(--avatar-thumbnail-border, 0px);
      }
      .avatar-info {
        min-width: 0;
        width: 100%;
        overflow: hidden;
      }
      .avatar-name {
        margin: 0;
        font: var(--avatar-name-font, 600 var(--boxel-font-md));
        letter-spacing: var(--avatar-name-letter-spacing, var(--boxel-lsp-sm));
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: var(--avatar-name-line-clamp, 1);
      }
      .avatar-info-content {
        display: var(--avatar-info-content-display, flex);
        flex-direction: var(--avatar-info-content-flex-direction, row);
        gap: var(--avatar-info-content-gap, var(--boxel-sp-xxs));
      }
    </style>
  </template>
}
