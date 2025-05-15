import {
  Avatar,
  Pill,
  EntityDisplayWithThumbnail,
} from '@cardstack/boxel-ui/components';
import GlimmerComponent from '@glimmer/component';

interface ContactRowArgs {
  Args: {
    userID: string;
    name: string;
    thumbnailURL: string;
    tagLabel?: string | 'primary';
  };
  Blocks: {};
  Element: HTMLElement;
}

export class ContactRow extends GlimmerComponent<ContactRowArgs> {
  <template>
    <EntityDisplayWithThumbnail @title={{@name}}>
      <:thumbnail>
        <Avatar
          @userID={{@userID}}
          @displayName={{@name}}
          @thumbnailURL={{@thumbnailURL}}
          @isReady={{true}}
          class='avatar'
        />
      </:thumbnail>
      <:tag>
        {{#if @tagLabel}}
          <Pill class='primary-tag' @pillBackgroundColor='#e8e8e8'>
            {{@tagLabel}}
          </Pill>
        {{/if}}
      </:tag>
    </EntityDisplayWithThumbnail>
    <style scoped>
      .avatar {
        --profile-avatar-icon-size: 20px;
        --profile-avatar-icon-border: 0px;
        flex-shrink: 0;
      }
      .primary-tag {
        --pill-font-weight: 400;
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
        --pill-font: 400 var(--boxel-font-xs);
        --pill-border: none;
      }
    </style>
  </template>
}
