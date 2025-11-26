import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from './card-api';
import StringField from './string';
import { eq, lt, gte } from '@cardstack/boxel-ui/helpers';
import PlayIcon from '@cardstack/boxel-icons/play';
import StarIcon from '@cardstack/boxel-icons/star';
import BookIcon from '@cardstack/boxel-icons/book';
import CaptionsIcon from '@cardstack/boxel-icons/captions';
import CodeIcon from '@cardstack/boxel-icons/code';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';
import { on } from '@ember/modifier';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

export class ContentItem extends FieldDef {
  static displayName = 'ContentItem';
  static icon = CaptionsIcon;

  @field title = contains(StringField, {
    description: 'The title of the content',
  });
  @field description = contains(StringField, {
    description: 'The description of the content',
  });
  @field textColor = contains(StringField, {
    description:
      'The text color for the content card, defaults to var(--boxel-dark)',
  });
  @field backgroundColor = contains(StringField, {
    description: 'The background color for the content card',
  });
  @field icon = contains(StringField, {
    description: 'The icon to display on the content card',
  });
  @field url = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    openUrl = () => {
      if (this.args.model.url) {
        window.open(this.args.model.url, '_blank');
      }
    };

    <template>
      <button
        type='button'
        class='content-card'
        style={{htmlSafe (concat 'background-color: ' @model.backgroundColor)}}
        {{on 'click' this.openUrl}}
      >
        <div
          class='content-title'
          style={{htmlSafe (concat 'color: ' @model.textColor)}}
        >
          {{@model.title}}:
        </div>
        <div
          class='content-description'
          style={{htmlSafe (concat 'color: ' @model.textColor)}}
        >
          {{@model.description}}</div>
        <div class='content-icon'>
          {{#if (eq @model.icon 'card')}}
            <CaptionsIcon class='icon' />
          {{else if (eq @model.icon 'star')}}
            <StarIcon class='icon' />
          {{else if (eq @model.icon 'book')}}
            <BookIcon class='icon' />
          {{else if (eq @model.icon 'code')}}
            <CodeIcon class='icon' />
          {{/if}}
        </div>
      </button>
      <style scoped>
        .content-card {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
          border-radius: var(--boxel-border-radius-xl);
          min-height: 220px;
          height: 100%;
          color: var(--boxel-dark);
          position: relative;
          overflow: hidden;
          cursor: pointer;
          border: none;
          box-shadow: none;
          text-align: left;
        }
        .content-content {
          flex-grow: 1;
        }
        .content-title {
          font: 600 var(--boxel-font);
        }
        .content-description {
          font: normal var(--boxel-font-lg);
          font: normal var(--boxel-font-lg);
          margin-right: var(--boxel-sp-xxxl);
        }
        .content-icon {
          width: 100%;
          display: flex;
          justify-content: flex-end;
          margin-top: auto;
        }
        .icon {
          width: 48px;
          height: 48px;
          color: var(--boxel-dark);
        }
        .full-width {
          flex: 4;
        }
      </style>
    </template>
  };
}

export class WelcomeToBoxel extends CardDef {
  static displayName = 'WelcomeToBoxel';
  static icon = BoxelIcon;

  @field welcomeTitle = contains(StringField, {
    description: 'The main welcome title',
  });
  @field introVideoText = contains(StringField, {
    description: 'Text for the intro video button',
  });
  @field introVideoUrl = contains(StringField, {
    description: 'The URL of the intro video',
  });
  @field content = containsMany(ContentItem, {
    description: 'The content cards to display',
  });
  @field backgroundUrl = contains(StringField, {
    description: 'The URL of the background image',
  });

  static embedded = class Embedded extends Component<typeof this> {
    openVideo = () => {
      window.open(this.args.model.introVideoUrl, '_blank');
    };

    <template>
      <div
        class='welcome-container'
        style={{if
          @model.backgroundUrl
          (concat 'background-image: url(' @model.backgroundUrl ')')
          ''
        }}
      >
        <div class='logo-section'>
          <div class='boxel-logo'>
            <BoxelIcon class='logo-icon' />
          </div>
        </div>

        <div class='content'>
          <div class='first-row-container'>
            <div class='welcome-section'>
              <h1 class='welcome-title'>{{@model.welcomeTitle}}</h1>
              <button class='intro-video-btn' {{on 'click' this.openVideo}}>
                <span>{{@model.introVideoText}}</span>
                <PlayIcon class='play-icon' fill='var(--boxel-dark)' />
              </button>
            </div>
            {{#each @fields.content as |ContentItem index|}}
              {{#if (lt index 2)}}
                <ContentItem @format='embedded' class='item-{{index}}' />
              {{/if}}
            {{/each}}
          </div>

          <div class='remaining-items-container'>
            {{#each @fields.content as |ContentItem index|}}
              {{#if (gte index 2)}}
                <ContentItem @format='embedded' class='item-{{index}}' />
              {{/if}}
            {{/each}}
          </div>
        </div>
      </div>
      <style scoped>
        .welcome-container {
          background: linear-gradient(
            135deg,
            #8b5cf6 0%,
            #7c3aed 50%,
            #6d28d9 100%
          );
          padding: 21px;
          position: relative;
          overflow: hidden;
        }

        .logo-section {
          display: flex;
          margin-bottom: var(--boxel-sp-lg);
        }

        .boxel-logo {
          --icon-color: var(--boxel-light);
        }

        .logo-icon {
          width: 50px;
          height: 50px;
        }

        .content {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          width: 100%;
        }

        .first-row-container {
          display: grid;
          grid-template-columns: 307px 1fr 1fr;
          gap: var(--boxel-sp-lg);
        }

        .remaining-items-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-lg);
        }

        .content .item-0 {
          grid-column: 2;
          grid-row: 1;
        }

        .content .item-1 {
          grid-column: 3;
          grid-row: 1;
        }

        .welcome-section {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: var(--boxel-sp-sm);
        }

        .welcome-title {
          font-size: var(--boxel-hero-font-size);
          font-weight: normal;
          color: var(--boxel-light);
          font-stretch: normal;
          font-style: normal;
          letter-spacing: normal;
          text-align: left;
          margin: 0;
          max-width: 307px;
        }

        .intro-video-btn {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          background: var(--boxel-teal);
          border: none;
          border-radius: 20px;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .intro-video-btn span {
          color: var(--boxel-dark);
          font: 600 var(--boxel-font-sm);
        }

        .play-icon {
          width: 16px;
          height: 16px;
        }
      </style>
    </template>
  };
}
