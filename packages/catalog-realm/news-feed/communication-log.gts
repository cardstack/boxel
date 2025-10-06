import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';

import MessageSquareIcon from '@cardstack/boxel-icons/message-square';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { realmURL, Query } from '@cardstack/runtime-common';

import {
  BaseDef,
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { not } from '@cardstack/boxel-ui/helpers';

import { Post, EventPost, ReminderPost } from './post';
import { PostComposer } from '../components/post-composer';
import { CardList } from '../components/card-list';
import { Author } from './author';
import ProfileEditButton from './components/profile-edit-button';

export interface PostType {
  value: string;
  label: string;
}

export const POST_TYPES: PostType[] = [
  { value: 'post', label: 'Default' },
  { value: 'event', label: 'Event' },
  { value: 'reminder', label: 'Reminder' },
];

type PostCardDef = Post | EventPost | ReminderPost;

class IsolatedTemplate extends Component<typeof CommunicationLog> {
  get currentRealm() {
    return this.args.model[realmURL];
  }

  get realms() {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  @tracked selectedPostType = POST_TYPES[0];
  @tracked currentPostCard = new Post();

  // Get the current post card based on selected post type
  get postCard() {
    return this.currentPostCard;
  }

  handlePostTypeChange = (postType: PostType) => {
    this.selectedPostType = postType;
    this.resetPostCard();
  };

  handlePostSent = async (card: BaseDef) => {
    this._createAndSavePost.perform(card);
  };

  _createAndSavePost = task(async (card: BaseDef) => {
    const commandContext = this.args.context?.commandContext;

    if (!commandContext) {
      throw new Error('Command context not available. Please try again.');
    }

    // We need to change the type here because the incoming `card` is of type BaseDef,
    // but we need to access properties specific to Post, EventPost, or ReminderPost,
    // which are all covered by the PostCardDef union type.
    const postInstance = card as PostCardDef;

    try {
      // Pre-populate the author data
      const authorData = this.args.model.author ?? postInstance.author ?? null;

      // Create a new card with the populated data based on post type
      let newCard: CardDef;

      switch (this.selectedPostType.value) {
        case 'event':
          newCard = new EventPost({
            author: authorData,
            content: (postInstance as EventPost).content,
            eventTitle: (postInstance as EventPost).eventTitle,
            eventDate: (postInstance as EventPost).eventDate,
            location: (postInstance as EventPost).location,
            createdAt: new Date(),
          });
          break;
        case 'reminder':
          newCard = new ReminderPost({
            author: authorData,
            content: (postInstance as ReminderPost).content,
            reminderTitle: (postInstance as ReminderPost).reminderTitle,
            reminderDate: (postInstance as ReminderPost).reminderDate,
            createdAt: new Date(),
          });
          break;
        default:
          newCard = new Post({
            author: authorData,
            createdAt: new Date(),
            content: (postInstance as Post).content,
          });
      }

      await new SaveCardCommand(commandContext).execute({
        card: newCard as CardDef,
        realm: this.currentRealm!.href,
      });

      this.resetPostCard();
    } catch (error: any) {
      console.error('❌ Failed to save post:', error.message);
      throw new Error(`Failed to save post: ${error.message}`);
    }
  });

  resetPostCard = () => {
    switch (this.selectedPostType.value) {
      case 'event':
        this.currentPostCard = new EventPost();
        break;
      case 'reminder':
        this.currentPostCard = new ReminderPost();
        break;
      default:
        this.currentPostCard = new Post();
    }
  };

  // Query for posts - similar to game records query pattern
  get postsQuery(): Query {
    return {
      filter: {
        type: {
          module: new URL('./post', import.meta.url).href,
          name: 'Post',
        },
      },
      sort: [
        {
          by: 'createdAt' as const,
          direction: 'desc' as const,
        },
      ],
    };
  }

  // Check if the author is set
  get canSubmit() {
    return this.args.model.author?.id;
  }

  <template>
    <main class='communication-log'>
      <header class='log-header'>
        <ProfileEditButton @author={{@model.author}} @fields={{@fields}} />
      </header>

      <div class='masthead'>
        <h1>Communication Log</h1>
        <p class='header-description'>Share updates and connect with your team</p>
        {{#unless this.canSubmit}}
          <div class='submit-hint'>
            <AlertTriangleIcon class='alert-icon' />
            Please link your profile to submit a post.
          </div>
        {{/unless}}
      </div>

      <div class='post-creation-area'>
        <PostComposer
          @card={{this.postCard}}
          @postTypes={{POST_TYPES}}
          @selectedPostType={{this.selectedPostType}}
          @onPostSent={{this.handlePostSent}}
          @onPostTypeChange={{this.handlePostTypeChange}}
          @isSubmitting={{this._createAndSavePost.isRunning}}
          @isSubmitDisabled={{not this.canSubmit}}
        />
      </div>

      <div class='posts-feed'>
        <div class='feed-header'>
          <h2>Recent Posts</h2>
          <span class='post-count'>Live Feed</span>
        </div>

        <CardList
          @query={{this.postsQuery}}
          @realms={{this.realms}}
          @context={{@context}}
        />
      </div>
    </main>

    <style scoped>
      .communication-log {
        margin: 0 auto;
        background: var(--boxel-100);
        container-type: inline-size;
        width: 100%;
        height: 100%;
      }

      .log-header {
        background: var(--boxel-100);
        border-bottom: var(--boxel-border);
        padding: var(--boxel-sp-sm);
      }

      .masthead {
        background: var(--boxel-100);
        text-align: center;
        padding: var(--boxel-sp-xl) 0;
      }

      .masthead h1 {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-sm);
        margin: 0 0 var(--boxel-sp-xs) 0;
        color: var(--boxel-700);
        font: var(--boxel-font-xl);
        font-weight: 700;
      }

      .header-description {
        margin: 0;
        color: var(--boxel-500);
        font: var(--boxel-font);
      }

      .post-creation-area {
        background: var(--boxel-100);
        margin-bottom: var(--boxel-sp-xl);
        padding: var(--boxel-sp-sm);
      }

      .posts-feed {
        margin-top: var(--boxel-sp);
        padding: var(--boxel-sp-sm);
        --embedded-card-min-height: auto;
      }

      .submit-hint {
        text-align: center;
        font: var(--boxel-font-sm);
        color: var(--boxel-danger);
        margin-top: var(--boxel-sp-xs);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-xs);
      }

      .alert-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        color: var(--boxel-danger);
        flex-shrink: 0;
      }

      .feed-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--boxel-sp);
        padding: 0 var(--boxel-sp-xs);
      }

      .feed-header h2 {
        margin: 0;
        font: var(--boxel-font-lg);
        font-weight: 600;
        color: var(--boxel-700);
      }

      .post-count {
        font: var(--boxel-font-sm);
        color: var(--boxel-500);
        background: var(--boxel-200);
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-lg);
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(var(--boxel-sp-sm));
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* Mobile responsiveness */
      @container (max-width: 447px) {
        .communication-log {
          padding: var(--boxel-sp-xs);
        }

        .masthead {
          padding: var(--boxel-sp) 0;
        }
      }
    </style>
  </template>
}

export class CommunicationLog extends CardDef {
  static displayName = 'Communication Log';
  static icon = MessageSquareIcon;

  @field author = linksTo(Author);
  @field title = contains(StringField, {
    computeVia: function () {
      return 'Communication Log';
    },
  });

  static isolated = IsolatedTemplate;
}
