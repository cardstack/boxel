import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from './card-api';
import StringField from './string';
import { eq } from '@cardstack/boxel-ui/helpers';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';

export class SocialMediaLink extends FieldDef {
  static displayName = 'Social Media Link';

  @field platform = contains(StringField, {
    description:
      'The name of the social media platform (e.g., Discord, Twitter)',
  });

  @field description = contains(StringField, {
    description: 'A brief description of what users can find on this platform',
  });

  @field url = contains(StringField, {
    description: 'The URL to the social media platform',
  });

  @field iconColor = contains(StringField, {
    description: 'The background color for the platform icon (hex color)',
  });

  static embedded = class Embedded extends Component<typeof this> {
    openLink = () => {
      if (this.args.model.url) {
        window.open(this.args.model.url, '_blank');
      }
    };

    <template>
      <BoxelButton
        @as='button'
        @kind='secondary'
        @size='auto'
        class='community-card'
        data-test-community-card={{@model.platform}}
        {{on 'click' this.openLink}}
      >
        <div
          class='community-icon {{@model.platform}}-icon'
          data-test-community-icon={{@model.platform}}
        >
          {{#if (eq @model.platform 'Discord')}}
            <svg viewBox='0 0 24 24' width='24' height='24'>
              <path
                fill='currentColor'
                d='M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z'
              />
            </svg>
          {{else if (eq @model.platform 'Twitter')}}
            <svg viewBox='0 0 24 24' width='24' height='24'>
              <path
                fill='currentColor'
                d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'
              />
            </svg>
          {{else if (eq @model.platform 'YouTube')}}
            <svg viewBox='0 0 24 24' width='24' height='24'>
              <path
                fill='currentColor'
                d='M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z'
              />
            </svg>
          {{else if (eq @model.platform 'Reddit')}}
            <svg viewBox='0 0 24 24' width='24' height='24'>
              <path
                fill='currentColor'
                d='M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z'
              />
            </svg>
          {{else}}
            <svg viewBox='0 0 24 24' width='24' height='24'>
              <path
                fill='currentColor'
                d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'
              />
            </svg>
          {{/if}}
        </div>
        <div class='community-content'>
          <h4
            class='community-title'
            data-test-community-title={{@model.platform}}
          >{{@model.platform}}</h4>
          <p
            class='community-description'
            data-test-community-description={{@model.platform}}
          >{{@model.description}}</p>
          <span
            class='community-link'
            data-test-community-link={{@model.platform}}
          >{{@model.url}}</span>
        </div>
      </BoxelButton>

      <style scoped>
        .community-card {
          /* Override BoxelButton styles to make it look like a card */
          --boxel-button-padding: var(--boxel-sp);
          --boxel-button-min-width: auto;
          --boxel-button-min-height: auto;
          --boxel-button-border-radius: var(--boxel-border-radius);
          --boxel-button-box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          --boxel-button-transition: box-shadow 0.2s ease;

          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
          width: 100%;
          text-align: left;
          justify-content: flex-start;
          border: none;
          box-shadow: none;
        }

        .community-card:hover {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          border: none;
        }

        .community-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: var(--boxel-border-radius);
          flex-shrink: 0;
          color: white;
        }

        .Discord-icon {
          background-color: #5865f2;
        }

        .Twitter-icon {
          background-color: #1da1f2;
        }

        .YouTube-icon {
          background-color: #ff0000;
        }

        .Reddit-icon {
          background-color: #ff4500;
        }

        .community-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }

        .community-title {
          margin: 0;
          font: 600 var(--boxel-font);
          color: var(--boxel-dark);
        }

        .community-description {
          margin: 0;
          font: normal var(--boxel-font-sm);
          color: var(--boxel-dark-300);
        }

        .community-link {
          display: inline-block;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          background: var(--boxel-200);
          color: var(--boxel-blue);
          border-radius: var(--boxel-border-radius-sm);
          font: 500 var(--boxel-font-sm);
          text-align: center;
          width: 100%;
          transition: background-color 0.2s ease;
        }

        .community-link:hover {
          background: var(--boxel-200);
        }
      </style>
    </template>
  };
}

export class JoinTheCommunity extends CardDef {
  static displayName = 'Join The Community';

  @field socialMediaLinks = containsMany(SocialMediaLink, {
    description: 'The social media platform links to display',
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='community-cards' data-test-community-cards>
        {{#each @fields.socialMediaLinks as |SocialMediaLink|}}
          <SocialMediaLink @format='embedded' />
        {{/each}}
      </div>

      <style scoped>
        .community-cards {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          width: 100%;
          padding: var(--boxel-sp);
          background-color: var(--boxel-150);
          border-radius: var(--boxel-border-radius);
        }
      </style>
    </template>
  };
}
