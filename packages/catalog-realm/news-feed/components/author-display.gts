import GlimmerComponent from '@glimmer/component';
import {
  Avatar,
  EntityDisplayWithThumbnail,
} from '@cardstack/boxel-ui/components';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import { Author } from '../author';

interface AuthorDisplayArgs {
  Args: {
    author?: Author;
    createdAt?: Date;
  };
  Element: HTMLDivElement;
}

export default class AuthorDisplay extends GlimmerComponent<AuthorDisplayArgs> {
  get displayName() {
    return this.args.author?.name ?? 'Anonymous';
  }

  get title() {
    return this.displayName;
  }

  get timeDisplay() {
    if (this.args.createdAt) {
      return formatDateTime(this.args.createdAt, { size: 'short' });
    }
    return 'Just now';
  }

  get authorId() {
    return this.args.author?.id;
  }

  get thumbnailURL() {
    return this.args.author?.thumbnailURL;
  }

  <template>
    <EntityDisplayWithThumbnail @title={{this.title}} class='author-info'>
      <:thumbnail>
        <Avatar
          @userId={{this.authorId}}
          @displayName={{this.displayName}}
          @thumbnailURL={{this.thumbnailURL}}
          @isReady={{true}}
          class='author-avatar'
        />
      </:thumbnail>
      <:content>
        {{this.timeDisplay}}
      </:content>
    </EntityDisplayWithThumbnail>

    <style scoped>
      .author-info {
        --profile-avatar-icon-size: 30px;
        --profile-avatar-icon-border: 0px;
        --entity-display-thumbnail-size: 30px;
      }
    </style>
  </template>
}
