import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { Avatar } from '@cardstack/boxel-ui/components';

interface AvatarGroupSignature {
  Args: {
    thumbnailURL?: string;
    name: string;
    userID: string;
  };
  Blocks: { content: [] };
  Element: HTMLElement;
}

export default class AvatarGroup extends GlimmerComponent<AvatarGroupSignature> {
  get backgroundImageStyle() {
    return htmlSafe(`background-image: url(${this.args.thumbnailURL});`);
  }

  <template>
    <div class='avatar-group'>
      <Avatar
        @userID={{@userID}}
        @displayName={{@name}}
        @thumbnailURL={{@thumbnailURL}}
        @isReady={{true}}
      />

      <div class='avatar-info'>
        <h3 class='name'>
          {{if @name @name 'No Name Assigned'}}
        </h3>

        {{yield to='content'}}
      </div>
    </div>

    <style scoped>
      .avatar-group {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        min-width: 0;
      }
      .avatar-thumbnail {
        background-color: var(--boxel-200);
        width: 60px;
        height: 60px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background-size: cover;
        background-position: center;
        border-radius: 50%;
      }
      .avatar-thumbnail .user-icon {
        color: var(--boxel-500);
        width: auto;
        height: auto;
      }
      .avatar-info {
        min-width: 0;
        width: 100%;
        overflow: hidden;
      }
      .name {
        -webkit-line-clamp: 1;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
        margin: 0;
        font-size: var(--boxel-font-size-med);
        font-weight: 600;
        letter-spacing: var(--boxel-lsp-sm);
      }
    </style>
  </template>
}
