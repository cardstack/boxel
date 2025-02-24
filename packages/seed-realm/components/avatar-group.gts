import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { Avatar } from '@cardstack/boxel-ui/components';

interface AvatarGroupSignature {
  Args: {
    thumbnailURL?: string;
    name?: string;
    userId?: string | null;
  };
  Blocks: { content: [] };
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
        gap: var(--boxel-sp-sm);
        min-width: 0;
      }
      .avatar-thumbnail {
        flex-shrink: 0;
        --profile-avatar-icon-size: 60px;
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
        font-size: var(--boxel-font-size);
        font-weight: 600;
        letter-spacing: var(--boxel-lsp-sm);
      }
    </style>
  </template>
}
