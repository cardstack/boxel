import { Avatar, Pill } from '@cardstack/boxel-ui/components';
import { EntityDisplay } from './entity-display';
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
    <EntityDisplay>
      <:title>
        {{@name}}
      </:title>
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
    </EntityDisplay>
    <style scoped>
      .avatar {
        --profile-avatar-icon-size: 30px;
        flex-shrink: 0;
      }
      .primary-tag {
        --pill-font-weight: 400;
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-6xs);
        --pill-font: 400 var(--boxel-font-sm);
        --pill-border: none;
      }
    </style>
  </template>
}
