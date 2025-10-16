import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import ColorField from 'https://cardstack.com/base/color';
import BooleanField from 'https://cardstack.com/base/boolean';
import { concat } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { gt } from '@cardstack/boxel-ui/helpers';
import LinkIcon from '@cardstack/boxel-icons/link';
import SparklesIcon from '@cardstack/boxel-icons/sparkles';
import { htmlSafe } from '@ember/template';
import type Owner from '@ember/owner';

class IsolatedLinkTreeTemplate extends Component<typeof LinkTree> {
  @tracked sparklePositions: Array<{ x: number; y: number; delay: number }> =
    [];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.generateSparkles();
  }

  @action
  generateSparkles() {
    this.sparklePositions = Array.from({ length: 8 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 3,
    }));
  }

  <template>
    <div class='link-tree-stage'>
      <div class='sparkles-container'>
        {{#each this.sparklePositions as |sparkle|}}
          <div
            class='sparkle'
            style={{htmlSafe
              (concat
                'left: '
                sparkle.x
                '%; top: '
                sparkle.y
                '%; animation-delay: '
                sparkle.delay
                's;'
              )
            }}
          >
            ✨
          </div>
        {{/each}}
      </div>

      <div class='link-tree-container'>
        <div class='profile-section'>
          {{#if @model.profileImageUrl}}
            <div class='profile-image'>
              <img src={{@model.profileImageUrl}} alt='Profile' />
            </div>
          {{else}}
            <div class='profile-placeholder'>
              <span class='profile-emoji'>💕</span>
            </div>
          {{/if}}

          <h1 class='profile-name'>
            {{if @model.profileName @model.profileName 'Fashion Babe'}}
          </h1>

          {{#if @model.bio}}
            <p class='profile-bio'>{{@model.bio}}</p>
          {{else}}
            <p class='profile-bio'>✨ Fashion • Style • Inspiration ✨</p>
          {{/if}}
        </div>

        <div class='links-section'>
          {{#if (gt @model.links.length 0)}}
            <div class='links-container'>
              {{#each @fields.links as |LinkField|}}
                <div style={{htmlSafe 'margin-top: 1rem;'}}>
                  <LinkField @format='embedded' />
                </div>
              {{/each}}
            </div>
          {{else}}
            <div class='empty-links'>
              <div class='empty-icon'>🔗</div>
              <h3>No links yet!</h3>
              <p>Add your first link to get started</p>
            </div>
          {{/if}}
        </div>

        <footer class='footer'>
          <p>Made with 💖 by Fashion Link Tree</p>
        </footer>
      </div>
    </div>

    <style scoped>
      .link-tree-stage {
        min-height: 100vh;
        background: linear-gradient(
          135deg,
          #0a0a0a 0%,
          #1a1a1a 25%,
          #2d2d2d 50%,
          #1a1a1a 75%,
          #0a0a0a 100%
        );
        background-size: 400% 400%;
        animation: subtleShift 12s ease infinite;
        position: relative;
        overflow-y: auto;
        padding: 2rem;
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
      }

      @keyframes subtleShift {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      .sparkles-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1;
      }

      .sparkle {
        position: absolute;
        font-size: 0.8rem;
        color: #d4af37;
        animation: subtleGlow 4s ease-in-out infinite;
      }

      @keyframes subtleGlow {
        0%,
        100% {
          opacity: 0.1;
          transform: scale(0.8);
        }
        50% {
          opacity: 0.3;
          transform: scale(1);
        }
      }

      .link-tree-container {
        max-width: 400px;
        margin: 0 auto;
        position: relative;
        z-index: 2;
      }

      .profile-section {
        text-align: center;
        margin-bottom: 3rem;
        padding: 2.5rem;
        background: rgba(255, 255, 255, 0.02);
        border-radius: 20px;
        backdrop-filter: blur(20px);
        border: 1px solid rgba(212, 175, 55, 0.2);
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      }

      .profile-image,
      .profile-placeholder {
        width: 140px;
        height: 140px;
        margin: 0 auto 1.5rem;
        border-radius: 50%;
        overflow: hidden;
        border: 3px solid #d4af37;
        box-shadow: 0 10px 40px rgba(212, 175, 55, 0.3);
      }

      .profile-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .profile-placeholder {
        background: linear-gradient(45deg, #ff6b9d, #f8b500);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .profile-emoji {
        font-size: 3rem;
      }

      .profile-name {
        color: white;
        font-family: 'Playfair Display', serif;
        font-size: 2rem;
        font-weight: 400;
        margin: 0 0 1rem 0;
        letter-spacing: 1px;
        text-shadow: none;
      }

      .profile-bio {
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.95rem;
        margin: 0;
        font-weight: 300;
        line-height: 1.5;
        letter-spacing: 0.5px;
      }

      .links-section {
        margin-bottom: 2rem;
      }

      .links-container > * + * {
        margin-top: 1rem;
      }

      .empty-links {
        text-align: center;
        padding: 3rem 2rem;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 15px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(212, 175, 55, 0.15);
      }

      .empty-icon {
        font-size: 2.5rem;
        margin-bottom: 1.5rem;
        color: rgba(212, 175, 55, 0.6);
      }

      .empty-links h3 {
        color: white;
        font-size: 1.1rem;
        font-weight: 400;
        margin: 0 0 0.75rem 0;
        letter-spacing: 1px;
        text-transform: uppercase;
      }

      .empty-links p {
        color: rgba(255, 255, 255, 0.6);
        margin: 0;
        font-size: 0.85rem;
        font-weight: 300;
        letter-spacing: 0.3px;
      }

      .footer {
        text-align: center;
        padding: 2rem 1rem;
        margin-top: 3rem;
      }

      .footer p {
        color: rgba(212, 175, 55, 0.5);
        font-size: 0.7rem;
        margin: 0;
        font-weight: 300;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
    </style>
  </template>
}

export class LinkField extends FieldDef {
  static displayName = 'Link';
  static icon = LinkIcon;

  @field title = contains(StringField);
  @field url = contains(UrlField);
  @field description = contains(StringField);
  @field backgroundColor = contains(ColorField);
  @field textColor = contains(ColorField);
  @field isActive = contains(BooleanField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <a
        href={{@model.url}}
        target='_blank'
        rel='noopener noreferrer'
        class='link-button {{if @model.isActive "active" "inactive"}}'
        style={{htmlSafe
          (concat
            'background-color: '
            (if @model.backgroundColor @model.backgroundColor '#FF6B9D')
            '; color: '
            (if @model.textColor @model.textColor '#FFFFFF')
            ';'
          )
        }}
      >
        <div class='link-content'>
          <h3 class='link-title'>{{if
              @model.title
              @model.title
              '✨ Click Here'
            }}</h3>
          {{#if @model.description}}
            <p class='link-description'>{{@model.description}}</p>
          {{/if}}
        </div>
        <div class='link-arrow'>→</div>
      </a>

      <style scoped>
        .link-button {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.5rem 2.5rem;
          border-radius: 8px;
          text-decoration: none;
          transition: all 0.3s ease;
          border: 1px solid rgba(212, 175, 55, 0.15);
          position: relative;
          overflow: hidden;
          backdrop-filter: blur(10px);
          font-family: 'Inter', sans-serif;
          letter-spacing: 0.75px;
          background: rgba(0, 0, 0, 0.3);
        }

        .link-button.inactive {
          display: none;
        }

        .link-button::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            135deg,
            rgba(212, 175, 55, 0.05) 0%,
            rgba(212, 175, 55, 0.02) 100%
          );
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .link-button:hover::before {
          opacity: 1;
        }

        .link-button:hover {
          transform: translateY(-2px);
          border-color: rgba(212, 175, 55, 0.3);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }

        .link-content {
          flex: 1;
        }

        .link-title {
          margin: 0;
          font-weight: 500;
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 2px;
        }

        .link-description {
          margin: 0.5rem 0 0 0;
          font-size: 0.8rem;
          opacity: 0.7;
          font-weight: 300;
          letter-spacing: 0.5px;
          text-transform: none;
        }

        .link-arrow {
          font-size: 0.9rem;
          font-weight: 300;
          transition: transform 0.3s ease;
          color: rgba(212, 175, 55, 0.8);
        }

        .link-button:hover .link-arrow {
          transform: translateX(4px);
          color: #d4af37;
        }
      </style>
    </template>
  };
}

export class LinkTree extends CardDef {
  static displayName = 'Link Tree';
  static icon = SparklesIcon;
  static prefersWideFormat = false;

  @field profileName = contains(StringField);
  @field bio = contains(StringField);
  @field profileImageUrl = contains(UrlField);
  @field backgroundGradient = contains(StringField);
  @field links = containsMany(LinkField);

  @field title = contains(StringField, {
    computeVia: function (this: LinkTree) {
      return this.profileName ? `${this.profileName}'s Links` : 'Fashion Links';
    },
  });

  static isolated = IsolatedLinkTreeTemplate;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='link-tree-preview'>
        <div class='preview-header'>
          {{#if @model.profileImageUrl}}
            <img
              src={{@model.profileImageUrl}}
              alt='Profile'
              class='mini-avatar'
            />
          {{else}}
            <div class='mini-avatar'>💕</div>
          {{/if}}
          <div class='preview-info'>
            <h3>{{if
                @model.profileName
                @model.profileName
                'Fashion Links'
              }}</h3>
            <p>{{@model.links.length}} links</p>
          </div>
        </div>
      </div>

      <style scoped>
        .link-tree-preview {
          background: linear-gradient(45deg, #ff6b9d, #f8b500);
          border-radius: 15px;
          padding: 1rem;
          color: white;
        }

        .preview-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .mini-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.2);
          font-size: 1.5rem;
          object-fit: cover;
        }

        .preview-info h3 {
          margin: 0;
          font-size: 1rem;
          font-weight: 700;
        }

        .preview-info p {
          margin: 0.25rem 0 0 0;
          font-size: 0.8rem;
          opacity: 0.85;
        }
      </style>
    </template>
  };
}
