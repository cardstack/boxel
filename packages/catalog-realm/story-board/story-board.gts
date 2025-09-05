import {
  CardDef,
  field,
  contains,
  Component,
  type CardContext,
  ViewCardFn,
} from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import UrlField from 'https://cardstack.com/base/url';
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { concat, fn } from '@ember/helper';
import { eq, gt } from '@cardstack/boxel-ui/helpers';
import {
  Query,
  LooseSingleCardDocument,
  realmURL,
} from '@cardstack/runtime-common';
import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';
import ExternalLinkIcon from '@cardstack/boxel-icons/external-link';
import MessageSquareIcon from '@cardstack/boxel-icons/message-square';
import EyeIcon from '@cardstack/boxel-icons/eye';
import { restartableTask } from 'ember-concurrency';

interface StoryCardComponentArgs {
  Args: {
    story: Partial<Story>;
    context?: CardContext;
    viewCard?: ViewCardFn;
  };
}

// StoryCard Component that display a single story card - reusable for isolated and embedded stories
class StoryCard extends GlimmerComponent<StoryCardComponentArgs> {
  @tracked userVote: 'up' | 'down' | null = null;
  @tracked isDiggAnimating = false;
  @tracked isBuryAnimating = false;

  @action
  viewStory() {
    if (!this.args.viewCard) {
      throw new Error('viewCard action is not available');
    }
    this.args.viewCard?.(this.args.story as CardDef);
  }

  get timeAgo() {
    if (!this.args.story?.submittedAt) return 'just now';
    const now = Date.now();
    const submitted = new Date(this.args.story.submittedAt).getTime();
    const diffHours = Math.floor((now - submitted) / (1000 * 60 * 60));

    if (diffHours < 1) return 'just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  get hostname() {
    try {
      const url = this.args.story?.url;
      if (!url) return '';
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  @action upvote() {
    if (!this.args.story) return;

    const triggerTransition = () => {
      this.isDiggAnimating = true;
      setTimeout(() => (this.isDiggAnimating = false), 600);

      const currentUpvotes = this.args.story.upvotes ?? 0;
      const currentDownvotes = this.args.story.downvotes ?? 0;

      if (this.userVote === 'up') {
        this.args.story.upvotes = Math.max(0, currentUpvotes - 1);
        this.userVote = null;
      } else {
        if (this.userVote === 'down') {
          this.args.story.downvotes = Math.max(0, currentDownvotes - 1);
        }
        this.args.story.upvotes = currentUpvotes + 1;
        this.userVote = 'up';
      }
    };

    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as any).startViewTransition(triggerTransition);
    } else {
      triggerTransition();
    }
  }

  @action downvote() {
    if (!this.args.story) return;

    const triggerTransition = () => {
      this.isBuryAnimating = true;
      setTimeout(() => (this.isBuryAnimating = false), 600);

      const currentDownvotes = this.args.story.downvotes ?? 0;
      const currentUpvotes = this.args.story.upvotes ?? 0;

      if (this.userVote === 'down') {
        this.args.story.downvotes = Math.max(0, currentDownvotes - 1);
        this.userVote = null;
      } else {
        if (this.userVote === 'up') {
          this.args.story.upvotes = Math.max(0, currentUpvotes - 1);
        }
        this.args.story.downvotes = currentDownvotes + 1;
        this.userVote = 'down';
      }
    };

    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as any).startViewTransition(triggerTransition);
    } else {
      triggerTransition();
    }
  }

  <template>
    <article class='story-item'>
      <div class='story-voting'>
        <div
          class='digg-box
            {{if (eq this.userVote "up") "digg-active" ""}}
            {{if this.isDiggAnimating "digg-animation" ""}}'
        >
          <button type='button' class='digg-btn' {{on 'click' this.upvote}}>
            digg
          </button>
          <span class='digg-count'>{{@story.points}}</span>
        </div>
        <div
          class='bury-box
            {{if (eq this.userVote "down") "bury-active" ""}}
            {{if this.isBuryAnimating "bury-animation" ""}}'
        >
          <button type='button' class='bury-btn' {{on 'click' this.downvote}}>
            bury
          </button>
        </div>
      </div>

      <div class='story-content'>
        <h3 class='story-title'>
          {{#if @story.url}}
            <a href={{@story.url}} target='_blank' rel='noopener noreferrer'>
              {{if @story.title @story.title 'Untitled Story'}}
              <ExternalLinkIcon width='12' height='12' class='external-icon' />
            </a>
          {{else}}
            <span class='story-title-text'>{{if
                @story.title
                @story.title
                'Untitled Story'
              }}</span>
          {{/if}}
        </h3>

        {{#if @story.description}}
          <div class='story-description'>
            {{@story.description}}
          </div>
        {{/if}}

        <div class='story-meta'>
          <span class='hostname'>{{if
              this.hostname
              (concat '(' this.hostname ')')
              '-'
            }}</span>
          <span class='author'>by
            {{if @story.author @story.author 'anonymous'}}</span>
          <span class='time'>{{this.timeAgo}}</span>

          {{#if @story.commentUrl}}
            <a
              href={{@story.commentUrl}}
              target='_blank'
              rel='noopener noreferrer'
              class='comments'
            >
              {{@story.commentCount}}
              comments
            </a>
          {{else}}
            <span class='comments'>{{@story.commentCount}} comments</span>
          {{/if}}

          <button type='button' class='view-btn' {{on 'click' this.viewStory}}>
            <span class='view-text'>View Story</span>
            <EyeIcon width='16' height='16' class='view-icon' />
          </button>
        </div>
      </div>
    </article>

    <style scoped>
      .story-item {
        display: flex;
        width: 100%;
        padding: 12px 16px;
        background: white;
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 13px;
        line-height: 1.3;
        cursor: pointer;
        transition: background-color 0.2s ease;
      }

      .view-btn {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid #eee;
        background: white;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .view-text {
        font-size: 11px;
        font-weight: 500;
        color: #666;
      }

      .view-icon {
        width: 14px;
        height: 14px;
        color: #666;
        transition: all 0.2s ease;
      }

      .view-btn:hover {
        background: #ff6600;
        border-color: #ff6600;
      }

      .view-btn:hover .view-icon,
      .view-btn:hover .view-text {
        color: #fff;
      }

      .story-voting {
        display: flex;
        flex-direction: column;
        margin-right: 12px;
        width: 60px;
      }

      .digg-box {
        background: #f8f8f8;
        border: none;
        border-radius: 4px;
        margin-bottom: 4px;
      }

      .digg-box.digg-active {
        background: #ff6600;
        border: none;
      }

      .digg-btn {
        display: block;
        width: 100%;
        background: transparent;
        border: none;
        padding: 4px 6px;
        font-size: 11px;
        font-weight: bold;
        text-transform: lowercase;
        cursor: pointer;
        color: #666;
      }

      .digg-box.digg-active .digg-btn {
        color: white;
      }

      .digg-count {
        display: block;
        text-align: center;
        font-weight: bold;
        font-size: 11px;
        padding: 2px 0 4px 0;
        color: #333;
        background: #eee;
      }

      .digg-box.digg-active .digg-count {
        color: white;
        background: #e55a00;
      }

      .bury-box {
        background: #f8f8f8;
        border: none;
        border-radius: 4px;
      }

      .bury-box.bury-active {
        background: #cc0000;
        border: none;
      }

      .bury-btn {
        display: block;
        width: 100%;
        background: transparent;
        border: none;
        padding: 4px 6px;
        font-size: 11px;
        font-weight: bold;
        text-transform: lowercase;
        cursor: pointer;
        color: #666;
      }

      .bury-box.bury-active .bury-btn {
        color: white;
      }

      /* Digg-style animations */
      .digg-box.digg-animation {
        animation: digg-bounce 0.6s ease-out;
      }

      .bury-box.bury-animation {
        animation: bury-shake 0.6s ease-out;
      }

      @keyframes digg-bounce {
        0% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.15) rotate(2deg);
          background: #ff8c00;
        }
        100% {
          transform: scale(1);
        }
      }

      @keyframes bury-shake {
        0%,
        100% {
          transform: translateX(0);
        }
        25% {
          transform: translateX(-3px) rotate(-1deg);
          background: #ff4444;
        }
        75% {
          transform: translateX(3px) rotate(1deg);
          background: #ff4444;
        }
      }

      .story-content {
        flex: 1;
        min-width: 0;
      }

      .story-title {
        margin: 0 0 4px 0;
        font-size: 14px;
        font-weight: normal;
        line-height: 1.2;
      }

      .story-title a {
        color: #135cae;
        text-decoration: none;
        font-weight: bold;
      }

      .story-title a:hover {
        color: #ff6600;
      }

      .story-title a:visited {
        color: #551a8b;
      }

      .external-icon {
        margin-left: 4px;
        opacity: 0.5;
      }

      .story-description {
        color: #666;
        font-size: 12px;
        margin: 6px 0;
        line-height: 1.4;
      }

      .story-meta {
        color: #999;
        font-size: 11px;
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }

      .story-meta span {
        margin-right: 8px;
      }

      .hostname {
        color: #777;
      }

      .author {
        color: #135cae;
      }

      .time {
        color: #999;
      }

      .comments {
        color: #666;
        font-size: 11px;
      }

      a.comments {
        color: #135cae;
      }

      a.comments:hover {
        color: #ff6600;
        text-decoration: underline;
      }

      .story-title-text {
        cursor: pointer;
      }

      .story-card-container {
        flex: 1;
        cursor: pointer;
        border-radius: 4px;
        padding: 8px;
        transition: background-color 0.2s ease;
      }

      .story-card-container:hover {
        background: rgba(0, 0, 0, 0.02);
      }
    </style>
  </template>
}

// Embedded story card definition
class EmbeddedStory extends Component<typeof Story> {
  <template>
    <StoryCard @story={{@model}} />
  </template>
}

// Isolated story card definition
class IsolatedStory extends Component<typeof Story> {
  @tracked userVote: 'up' | 'down' | null = null;
  @tracked isDiggAnimating = false;
  @tracked isBuryAnimating = false;

  get timeAgo() {
    if (!this.args.model?.submittedAt) return 'just now';
    const now = Date.now();
    const submitted = new Date(this.args.model.submittedAt).getTime();
    const diffHours = Math.floor((now - submitted) / (1000 * 60 * 60));

    if (diffHours < 1) return 'just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  get hostname() {
    try {
      const url = this.args.model?.url;
      if (!url) return '';
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  @action upvote() {
    if (!this.args.model) return;

    const triggerTransition = () => {
      this.isDiggAnimating = true;
      setTimeout(() => (this.isDiggAnimating = false), 600);

      const currentUpvotes = this.args.model.upvotes ?? 0;
      const currentDownvotes = this.args.model.downvotes ?? 0;

      if (this.userVote === 'up') {
        this.args.model.upvotes = Math.max(0, currentUpvotes - 1);
        this.userVote = null;
      } else {
        if (this.userVote === 'down') {
          this.args.model.downvotes = Math.max(0, currentDownvotes - 1);
        }
        this.args.model.upvotes = currentUpvotes + 1;
        this.userVote = 'up';
      }
    };

    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as any).startViewTransition(triggerTransition);
    } else {
      triggerTransition();
    }
  }

  @action downvote() {
    if (!this.args.model) return;

    const triggerTransition = () => {
      this.isBuryAnimating = true;
      setTimeout(() => (this.isBuryAnimating = false), 600);

      const currentDownvotes = this.args.model.downvotes ?? 0;
      const currentUpvotes = this.args.model.upvotes ?? 0;

      if (this.userVote === 'down') {
        this.args.model.downvotes = Math.max(0, currentDownvotes - 1);
        this.userVote = null;
      } else {
        if (this.userVote === 'up') {
          this.args.model.upvotes = Math.max(0, currentUpvotes - 1);
        }
        this.args.model.downvotes = currentDownvotes + 1;
        this.userVote = 'down';
      }
    };

    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as any).startViewTransition(triggerTransition);
    } else {
      triggerTransition();
    }
  }

  <template>
    <div class='isolated-story'>
      <div class='story-header'>
        <h1 class='story-title'>
          {{#if @model.url}}
            <a href={{@model.url}} target='_blank' rel='noopener noreferrer'>
              {{if @model.title @model.title 'Untitled Story'}}
              <ExternalLinkIcon width='16' height='16' class='external-icon' />
            </a>
          {{else}}
            <span class='story-title-text'>
              {{if @model.title @model.title 'Untitled Story'}}
            </span>
          {{/if}}
        </h1>

        <div class='story-meta'>
          <span class='hostname'>{{if
              this.hostname
              (concat '(' this.hostname ')')
              '-'
            }}</span>
          <span class='author'>by
            {{if @model.author @model.author 'anonymous'}}</span>
          <span class='time'>{{this.timeAgo}}</span>
        </div>
      </div>

      <div class='story-content'>
        {{#if @model.description}}
          <div class='story-description'>
            {{@model.description}}
          </div>
        {{/if}}

        <div class='story-voting'>
          <div
            class='vote-box
              {{if (eq this.userVote "up") "vote-active" ""}}
              {{if this.isDiggAnimating "vote-animation" ""}}'
          >
            <button type='button' class='vote-btn' {{on 'click' this.upvote}}>
              <TrendingUpIcon width='20' height='20' />
              <span>Upvote</span>
            </button>
            <span class='vote-count'>{{@model.points}}</span>
          </div>

          <div
            class='vote-box
              {{if (eq this.userVote "down") "vote-active" ""}}
              {{if this.isBuryAnimating "vote-animation" ""}}'
          >
            <button type='button' class='vote-btn' {{on 'click' this.downvote}}>
              <TrendingUpIcon width='20' height='20' class='rotate-180' />
              <span>Downvote</span>
            </button>
          </div>
        </div>

        {{#if @model.commentUrl}}
          <a
            href={{@model.commentUrl}}
            target='_blank'
            rel='noopener noreferrer'
            class='comments-link'
          >
            <MessageSquareIcon width='16' height='16' />
            <span>{{@model.commentCount}} comments</span>
          </a>
        {{else}}
          <div class='comments-link'>
            <MessageSquareIcon width='16' height='16' />
            <span>{{@model.commentCount}} comments</span>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .isolated-story {
        max-width: 800px;
        margin: 0 auto;
        padding: 32px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .story-header {
        margin-bottom: 24px;
      }

      .story-title {
        font-size: 28px;
        font-weight: 600;
        margin: 0 0 12px 0;
        line-height: 1.3;
      }

      .story-title a {
        color: #135cae;
        text-decoration: none;
      }

      .story-title a:hover {
        color: #ff6600;
      }

      .story-meta {
        display: flex;
        gap: 12px;
        color: #666;
        font-size: 14px;
      }

      .hostname {
        color: #777;
      }

      .author {
        color: #135cae;
      }

      .time {
        color: #999;
      }

      .story-content {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .story-description {
        font-size: 16px;
        line-height: 1.6;
        color: #333;
      }

      .story-voting {
        display: flex;
        gap: 16px;
        margin: 16px 0;
      }

      .vote-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        background: #f8f8f8;
        border-radius: 8px;
        padding: 8px;
        min-width: 100px;
      }

      .vote-box.vote-active {
        background: #ff6600;
      }

      .vote-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        padding: 8px;
        cursor: pointer;
        color: #666;
        font-size: 13px;
        font-weight: 500;
      }

      .vote-box.vote-active .vote-btn {
        color: white;
      }

      .vote-count {
        font-size: 16px;
        font-weight: 600;
        color: #333;
        margin-top: 4px;
      }

      .vote-box.vote-active .vote-count {
        color: white;
      }

      .rotate-180 {
        transform: rotate(180deg);
      }

      .comments-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #666;
        text-decoration: none;
        font-size: 14px;
        padding: 8px 16px;
        border-radius: 6px;
        background: #f8f8f8;
        transition: all 0.2s ease;
      }

      .comments-link:hover {
        background: #f0f0f0;
        color: #ff6600;
      }

      .external-icon {
        margin-left: 8px;
        opacity: 0.5;
      }

      @keyframes vote-bounce {
        0% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.15);
        }
        100% {
          transform: scale(1);
        }
      }

      .vote-box.vote-animation {
        animation: vote-bounce 0.6s ease-out;
      }
    </style>
  </template>
}

// Story card definition included directly
export class Story extends CardDef {
  static displayName = 'Story';
  static icon = MessageSquareIcon;

  @field title = contains(StringField);
  @field url = contains(UrlField);
  @field description = contains(MarkdownField);
  @field author = contains(StringField);
  @field upvotes = contains(NumberField);
  @field downvotes = contains(NumberField);
  @field commentUrl = contains(UrlField);
  @field commentCount = contains(NumberField);
  @field submittedAt = contains(DatetimeField);

  @field points = contains(NumberField, {
    computeVia: function (this: Story) {
      const up = this.upvotes || 0;
      const down = this.downvotes || 0;
      return up - down;
    },
  });

  static isolated = IsolatedStory;
  static embedded = EmbeddedStory;
}

// Isolated story board definition
class IsolatedStoryBoard extends Component<typeof StoryBoard> {
  @tracked sortBy: 'hot' | 'new' | 'top' = 'hot';
  @tracked userVote: 'up' | 'down' | null = null;
  @tracked isDiggAnimating = false;
  @tracked isBuryAnimating = false;

  private get storyQuery(): Query {
    // Define how stories should be sorted for each view type
    const sortConfig = {
      hot: {
        by: 'points', // Sort by total points (upvotes - downvotes)
        direction: 'desc', // Show highest points first
      },
      new: {
        by: 'submittedAt', // Sort by submission date
        direction: 'desc', // Show newest first
      },
      top: {
        by: 'points', // Sort by total points
        direction: 'desc', // Show highest points first
      },
    };

    // Get the current module URL for filtering and sorting
    const moduleUrl = new URL('./story-board', import.meta.url).href;

    // Build and return the query object
    return {
      // Filter to only show Story type cards
      filter: {
        type: {
          module: moduleUrl,
          name: 'Story',
        },
      },
      // Sort based on the selected view type, defaulting to 'hot'
      sort: [
        {
          by: sortConfig[this.sortBy].by,
          on: {
            module: moduleUrl,
            name: 'Story',
          },
          direction: sortConfig[this.sortBy].direction as 'asc' | 'desc',
        },
      ],
    };
  }

  private get realmHrefs() {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  // Load stories using getCards API
  storiesSearch = this.args.context?.getCards(
    this,
    () => this.storyQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  @action toggleSort(sortType: 'hot' | 'new' | 'top') {
    this.startViewTransition(() => {
      this.sortBy = sortType;
    });
  }

  @action toggleSubmissionForm() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    let ref = {
      module: new URL('./story-board', import.meta.url).href,
      name: 'Story',
    };

    if (!ref) {
      throw new Error('Missing card ref');
    }

    let currentRealm = this.args.model[realmURL];

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          title: null,
          description: null,
          author: null,
          url: null,
          upvotes: 0,
          downvotes: 0,
          commentUrl: null,
          commentCount: 0,
          submittedAt: null,
        },
        meta: {
          adoptsFrom: ref,
        },
      },
    };

    await this.args.createCard?.(ref, currentRealm, {
      realmURL: currentRealm, // the realm to create the card in
      doc,
    });
  });

  // View transition support for smooth reordering
  startViewTransition(callback: () => void) {
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as any).startViewTransition(callback);
    } else {
      callback(); // Fallback for browsers without support
    }
  }

  <template>
    <div class='stage'>
      <div class='board-mat'>
        <header class='board-header'>
          <div class='header-content'>
            <h1 class='board-title'>
              {{if @model.boardName @model.boardName 'Story Central'}}
            </h1>

            <div class='board-nav'>
              <button
                type='button'
                class='nav-btn {{if (eq this.sortBy "hot") "active" ""}}'
                {{on 'click' (fn this.toggleSort 'hot')}}
              >
                Hot
              </button>
              <button
                type='button'
                class='nav-btn {{if (eq this.sortBy "new") "active" ""}}'
                {{on 'click' (fn this.toggleSort 'new')}}
              >
                New
              </button>
              <button
                type='button'
                class='nav-btn {{if (eq this.sortBy "top") "active" ""}}'
                {{on 'click' (fn this.toggleSort 'top')}}
              >
                Top
              </button>
            </div>
            <button
              type='button'
              class='submit-btn'
              {{on 'click' this.toggleSubmissionForm}}
            >
              Submit Story
            </button>
          </div>
        </header>

        <main class='stories-container'>
          {{#if this.storiesSearch.isLoading}}
            <div class='loading-state'>
              <p>Loading stories...</p>
            </div>
          {{else if (gt this.storiesSearch.instances.length 0)}}
            <ul class='stories-list'>
              {{#each this.storiesSearch.instances as |story|}}
                <li class='story-item-wrapper'>
                  <StoryCard
                    @story={{story}}
                    @context={{@context}}
                    @viewCard={{@viewCard}}
                  />
                </li>
              {{/each}}
            </ul>
          {{else}}
            <div class='empty-board'>
              <h3>No stories yet!</h3>
              <p>Be the first to submit a story to get the discussion started.</p>
              <button
                type='button'
                class='submit-btn'
                {{on 'click' this.toggleSubmissionForm}}
              >
                Submit the First Story
              </button>

              <span class='note'>
                Note: Submission form clicking feature only works in interact
                mode
              </span>

            </div>
          {{/if}}
        </main>
      </div>
    </div>

    <style scoped>
      .stage {
        width: 100%;
        height: auto;
        background: hsl(0 0% 98%);
        font-family:
          ui-sans-serif,
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          Roboto,
          'Helvetica Neue',
          Arial,
          'Noto Sans',
          sans-serif;
      }

      .board-mat {
        height: 100%;
        max-width: 980px;
        margin: 0 auto;
        background: hsl(0 0% 100%);
        border-left: 1px solid hsl(0 0% 89.8%);
        border-right: 1px solid hsl(0 0% 89.8%);
      }

      .board-header {
        background: hsl(0 0% 100%);
        color: hsl(0 0% 3.9%);
        padding: 16px 24px;
        position: sticky;
        top: 0;
        z-index: 1;
      }

      .header-content {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
        justify-content: space-between;
      }

      .board-title {
        font-size: 24px;
        font-weight: 600;
        margin: 0;
        color: hsl(0 0% 9%);
      }

      .board-nav {
        display: flex;
        margin-left: auto;
        gap: 8px;
      }
      .nav-btn {
        background: hsl(0 0% 100%);
        border: 1px solid hsl(0 0% 89.8%);
        color: hsl(0 0% 45.1%);
        padding: 8px 12px;
        cursor: pointer;
        font-weight: 500;
        border-radius: 6px;
        font-size: 13px;
        transition: all 0.15s ease;
      }
      .nav-btn:hover {
        background: hsl(0 0% 96.1%);
        color: hsl(0 0% 9%);
      }
      .nav-btn.active {
        background: hsl(0 0% 9%);
        color: hsl(0 0% 98%);
        border-color: hsl(0 0% 9%);
      }

      .submit-btn {
        background: hsl(0 0% 9%);
        color: hsl(0 0% 98%);
        border: 1px solid hsl(0 0% 9%);
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 500;
        font-size: 13px;
        margin-left: auto;
        transition: all 0.15s ease; /* ³⁴ consistent button styling */
      }
      .submit-btn:hover {
        background: hsl(0 0% 15%);
        border-color: hsl(0 0% 15%);
      }
      .submit-btn:disabled {
        background: hsl(0 0% 89.8%);
        color: hsl(0 0% 45.1%);
        border-color: hsl(0 0% 89.8%);
        cursor: not-allowed;
      }
      .submission-form {
        background: hsl(0 0% 100%);
        border: 1px solid hsl(0 0% 89.8%);
        margin: 16px;
        padding: 24px;
        border-radius: 8px;
        box-shadow:
          0 1px 3px 0 hsl(0 0% 0% / 0.1),
          0 1px 2px -1px hsl(0 0% 0% / 0.1); /* ³⁵ subtle shadow */
      }
      .submission-form h2 {
        margin: 0 0 16px 0;
        color: #333;
        font-size: 16px;
      }
      .form-field {
        margin-bottom: 12px;
      }
      .form-field label {
        display: block;
        font-weight: bold;
        margin-bottom: 4px;
        font-size: 12px;
        color: #333;
      }
      .form-field input,
      .form-field textarea {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 13px;
        font-family: inherit;
      }
      .form-field input:focus,
      .form-field textarea:focus {
        border-color: #ff6600;
        outline: none;
      }
      .form-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
      }
      .cancel-btn {
        background: #666;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 3px;
        cursor: pointer;
        font-weight: bold;
        font-size: 12px;
      }
      .cancel-btn:hover {
        background: #555;
      }

      .note {
        font-size: 11px;
        font-style: italic;
        color: red;
        margin-top: 10px;
        display: block;
      }

      .stories-container {
        background: white;
        padding-top: 16px;
      }

      .stories-list {
        display: grid;
        gap: 16px;
        padding: 16px;
        list-style: none;
        margin: 0;
      }

      .story-item-wrapper {
        display: flex;
        align-items: flex-start;
        padding: 12px 16px;
        border-bottom: 1px solid #f0f0f0;
        background: white;
      }

      .story-item-wrapper:last-child {
        border-bottom: none;
      }

      .rank-number {
        font-weight: 600;
        color: hsl(0 0% 60%);
        margin-right: 12px;
        margin-top: 4px;
        min-width: 28px;
        font-size: 12px;
        text-align: right;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      }

      .story-error {
        color: hsl(0 0% 45%);
        font-style: italic;
        padding: 8px 0;
      }

      .loading-state {
        text-align: center;
        padding: 64px 32px;
        color: hsl(0 0% 45.1%);
        font-style: italic;
      }

      .empty-board {
        text-align: center;
        padding: 64px 32px;
        color: hsl(0 0% 45.1%);
      }

      .empty-board h3 {
        color: hsl(0 0% 9%);
        margin: 0 0 12px 0;
        font-weight: 600;
      }

      .empty-board p {
        margin: 0 0 24px 0;
        font-size: 15px;
        color: hsl(0 0% 45.1%);
      }

      /* ²⁶ View transition animations */
      ::view-transition-old(story),
      ::view-transition-new(story) {
        animation-duration: 0.4s;
        animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
      }

      ::view-transition-old(story) {
        animation-name: slide-out;
      }

      ::view-transition-new(story) {
        animation-name: slide-in;
      }

      @keyframes slide-out {
        from {
          opacity: 1;
          transform: translateY(0);
        }
        to {
          opacity: 0.8;
          transform: translateY(-10px);
        }
      }

      @keyframes slide-in {
        from {
          opacity: 0.8;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    </style>
  </template>
}

export class StoryBoard extends CardDef {
  static displayName = 'Story Board';
  static icon = TrendingUpIcon;
  static prefersWideFormat = true;

  @field boardName = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: StoryBoard) {
      if (this.boardName) {
        return `${this.boardName} • Story Board`;
      }
      return 'Story Board';
    },
  });

  static isolated = IsolatedStoryBoard;
}
