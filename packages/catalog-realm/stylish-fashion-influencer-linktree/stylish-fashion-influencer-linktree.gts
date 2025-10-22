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
import { concat } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { gt } from '@cardstack/boxel-ui/helpers';
import { htmlSafe } from '@ember/template';
import InstagramIcon from '@cardstack/boxel-icons/instagram';
import HeartIcon from '@cardstack/boxel-icons/heart';
import SparklesIcon from '@cardstack/boxel-icons/sparkles';
import StarIcon from '@cardstack/boxel-icons/star';
import CrownIcon from '@cardstack/boxel-icons/crown';
import type Owner from '@ember/owner';

class IsolatedTemplate extends Component<
  typeof StylishFashionInfluencerLinktree
> {
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
    <div
      class='linktree-stage premium-stage'
      style={{htmlSafe (concat 'background: ' @model.backgroundColor ';')}}
    >
      <div class='floating-elements'>
        {{#each this.sparklePositions as |sparkle|}}
          <div
            class='floating-element'
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
            {{#if (gt sparkle.x 50)}}
              <StarIcon width='20' height='20' />
            {{else}}
              ✨
            {{/if}}
          </div>
        {{/each}}
      </div>

      <div class='content-container premium-content'>
        <div class='profile-section premium-profile'>
          {{#if @model.profileImageUrl}}
            <div class='profile-image-container premium-avatar'>
              <img
                src={{@model.profileImageUrl}}
                alt='Profile'
                class='profile-image'
              />
              <div class='profile-ring premium-ring'></div>
              <div class='crown-badge'>
                <CrownIcon width='24' height='24' />
              </div>
            </div>
          {{else}}
            <div class='profile-placeholder premium-placeholder'>
              <CrownIcon width='40' height='40' />
            </div>
          {{/if}}

          <h1 class='influencer-name premium-name'>
            {{#if @model.influencerName}}
              {{@model.influencerName}}
            {{else}}
              <span class='placeholder'>Your Premium Name ✨</span>
            {{/if}}
          </h1>

          <p class='bio premium-bio'>
            {{#if @model.bio}}
              {{@model.bio}}
            {{else}}
              <span class='placeholder'>Top-tier fashion curator 👑 Brand
                collaborator ✨ Living authentically 💫</span>
            {{/if}}
          </p>

          <div class='agency-badge'>
            <StarIcon width='16' height='16' />
            <span>Represented Talent</span>
          </div>
        </div>

        <div class='links-section'>
          {{#if (gt @model.socialLinks.length 0)}}
            <div class='links-container'>
              <@fields.socialLinks @format='embedded' />
            </div>
          {{else}}
            <div class='empty-links'>
              <div class='sample-link'>
                <HeartIcon width='20' height='20' />
                <span>Add your fabulous links here! 💖</span>
              </div>
              <div class='sample-link'>
                <InstagramIcon width='20' height='20' />
                <span>Instagram • TikTok • YouTube</span>
              </div>
            </div>
          {{/if}}
        </div>

        <div class='footer'>
          <div class='made-with-love'>
            Made with
            <HeartIcon width='16' height='16' class='heart-icon' />
            and lots of ✨
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .linktree-stage {
        min-height: 100vh;
        width: 100%;
        background: linear-gradient(
          135deg,
          #667eea 0%,
          #764ba2 25%,
          #f093fb 50%,
          #f5576c 75%,
          #4facfe 100%
        );
        position: relative;
        overflow-x: hidden;
        padding: 20px;
        display: flex;
        justify-content: center;
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          Roboto,
          sans-serif;
      }

      .premium-stage {
        background: linear-gradient(
          135deg,
          #667eea 0%,
          #764ba2 25%,
          #f093fb 50%,
          #f5576c 75%,
          #4facfe 100%
        );
        backdrop-filter: blur(10px);
      }

      .floating-elements {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1;
      }

      @keyframes elegantFloat {
        0%,
        100% {
          transform: translateY(0px) rotate(0deg);
          opacity: 0.8;
        }
        50% {
          transform: translateY(-15px) rotate(90deg);
          opacity: 1;
        }
      }

      @keyframes premiumGlow {
        0%,
        100% {
          filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.5));
        }
        50% {
          filter: drop-shadow(0 0 15px rgba(255, 255, 255, 0.8));
        }
      }

      .floating-element {
        position: absolute;
        animation: elegantFloat 6s ease-in-out infinite;
        font-size: 18px;
        user-select: none;
        color: rgba(255, 255, 255, 0.9);
      }

      .floating-element svg {
        filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.6));
      }

      .content-container {
        max-width: 480px;
        width: 100%;
        position: relative;
        z-index: 2;
        padding: 40px 0;
      }

      .premium-content {
        backdrop-filter: blur(20px);
        background: rgba(255, 255, 255, 0.1);
        border-radius: 30px;
        padding: 48px 32px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
      }

      .profile-section {
        text-align: center;
        margin-bottom: 40px;
      }

      .premium-profile {
        margin-bottom: 48px;
      }

      .profile-image-container {
        position: relative;
        display: inline-block;
        margin-bottom: 24px;
      }

      .premium-avatar {
        margin-bottom: 32px;
      }

      .profile-image {
        width: 140px;
        height: 140px;
        border-radius: 50%;
        object-fit: cover;
        border: 6px solid rgba(255, 255, 255, 0.9);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
      }

      .profile-ring {
        position: absolute;
        top: -12px;
        left: -12px;
        right: -12px;
        bottom: -12px;
        border-radius: 50%;
        background: linear-gradient(
          45deg,
          #ffd700,
          #ff6b6b,
          #4ecdc4,
          #45b7d1,
          #96ceb4,
          #ffeaa7
        );
        animation: rotate 4s linear infinite;
        z-index: -1;
      }

      .premium-ring {
        background: linear-gradient(
          45deg,
          #ffd700,
          #ff6b6b,
          #4ecdc4,
          #45b7d1,
          #96ceb4,
          #ffeaa7
        );
        filter: drop-shadow(0 0 20px rgba(255, 215, 0, 0.4));
      }

      .crown-badge {
        position: absolute;
        top: -8px;
        right: -8px;
        background: linear-gradient(45deg, #ffd700, #ffed4e);
        border-radius: 50%;
        padding: 8px;
        border: 3px solid #fff;
        box-shadow: 0 4px 15px rgba(255, 215, 0, 0.3);
        animation: premiumGlow 3s ease-in-out infinite;
      }

      .crown-badge svg {
        color: #fff;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
      }

      @keyframes rotate {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .profile-placeholder {
        width: 140px;
        height: 140px;
        border-radius: 50%;
        background: linear-gradient(
          45deg,
          rgba(255, 255, 255, 0.9),
          rgba(255, 234, 167, 0.8)
        );
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 24px;
        border: 6px solid rgba(255, 255, 255, 0.9);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
        color: #fd79a8;
      }

      .premium-placeholder {
        background: linear-gradient(
          45deg,
          rgba(255, 255, 255, 0.9),
          rgba(255, 215, 0, 0.3)
        );
        color: #ffd700;
      }

      .influencer-name {
        font-size: 32px;
        font-weight: 800;
        margin: 0 0 16px 0;
        background: linear-gradient(45deg, #fff, #ffd700, #ff6b6b, #4ecdc4);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        text-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        letter-spacing: -0.5px;
      }

      .premium-name {
        font-size: 36px;
        font-weight: 900;
        background: linear-gradient(45deg, #fff, #ffd700, #ff6b6b, #4ecdc4);
        text-shadow: 0 6px 30px rgba(0, 0, 0, 0.15);
        filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.3));
      }

      .bio {
        font-size: 18px;
        color: rgba(255, 255, 255, 0.9);
        margin: 0 0 24px 0;
        line-height: 1.6;
        max-width: 400px;
        margin: 0 auto 24px auto;
        font-weight: 500;
      }

      .premium-bio {
        font-size: 20px;
        color: rgba(255, 255, 255, 0.95);
        margin: 0 auto 32px auto;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        font-weight: 600;
      }

      .agency-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: linear-gradient(
          45deg,
          rgba(255, 215, 0, 0.9),
          rgba(255, 182, 193, 0.8)
        );
        color: #2d3436;
        padding: 12px 20px;
        border-radius: 25px;
        font-weight: 700;
        font-size: 14px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 8px 25px rgba(255, 215, 0, 0.2);
        backdrop-filter: blur(10px);
      }

      .agency-badge svg {
        color: #ffd700;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
      }

      .placeholder {
        color: rgba(255, 255, 255, 0.7);
        font-style: italic;
      }

      .links-section {
        margin-bottom: 48px;
      }

      .links-container > * + * {
        margin-top: 20px;
      }

      .empty-links {
        display: flex;
        flex-direction: column;
        gap: 20px;
        opacity: 0.8;
      }

      .sample-link {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px 28px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 30px;
        color: rgba(255, 255, 255, 0.9);
        font-weight: 700;
        border: 2px dashed rgba(255, 255, 255, 0.3);
        gap: 12px;
        backdrop-filter: blur(10px);
      }

      .footer {
        text-align: center;
        padding-top: 32px;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
      }

      .made-with-love {
        font-size: 16px;
        color: rgba(255, 255, 255, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-weight: 600;
      }

      .heart-icon {
        color: #ff6b6b;
        animation: heartbeat 2s ease-in-out infinite;
        filter: drop-shadow(0 0 8px rgba(255, 107, 107, 0.5));
      }

      @keyframes heartbeat {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.15);
        }
      }

      @media (max-width: 480px) {
        .linktree-stage {
          padding: 15px;
        }

        .premium-content {
          padding: 32px 20px;
          border-radius: 20px;
        }

        .profile-image,
        .profile-placeholder {
          width: 120px;
          height: 120px;
        }

        .premium-avatar .profile-image,
        .premium-placeholder {
          width: 120px;
          height: 120px;
        }

        .influencer-name {
          font-size: 28px;
        }

        .premium-name {
          font-size: 30px;
        }

        .crown-badge {
          top: -5px;
          right: -5px;
          padding: 6px;
        }

        .agency-badge {
          padding: 10px 16px;
          font-size: 13px;
        }
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<
  typeof StylishFashionInfluencerLinktree
> {
  <template>
    <div
      class='embedded-linktree'
      style={{htmlSafe (concat 'background: ' @model.backgroundColor ';')}}
    >
      <div class='mini-profile'>
        {{#if @model.profileImageUrl}}
          <img
            src={{@model.profileImageUrl}}
            alt='Profile'
            class='mini-avatar'
          />
        {{else}}
          <div class='mini-avatar-placeholder'>
            <SparklesIcon width='20' height='20' />
          </div>
        {{/if}}

        <div class='mini-info'>
          <h3 class='mini-name'>
            {{#if @model.influencerName}}
              {{@model.influencerName}}
            {{else}}
              Fashion Influencer ✨
            {{/if}}
          </h3>
          <p class='mini-links-count'>
            {{#if (gt @model.socialLinks.length 0)}}
              {{@model.socialLinks.length}}
              fabulous links 💕
            {{else}}
              Ready for links! ✨
            {{/if}}
          </p>
        </div>
      </div>
    </div>

    <style scoped>
      .embedded-linktree {
        padding: 16px;
        border-radius: 16px;
        background: linear-gradient(
          135deg,
          #ff9a9e 0%,
          #fecfef 50%,
          #ffecd2 100%
        );
        border: 2px solid rgba(255, 255, 255, 0.3);
      }

      .mini-profile {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .mini-avatar {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid #fff;
      }

      .mini-avatar-placeholder {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(45deg, #fff, #ffeaa7);
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #fff;
        color: #fd79a8;
      }

      .mini-info {
        flex: 1;
      }

      .mini-name {
        margin: 0 0 4px 0;
        font-size: 16px;
        font-weight: 700;
        color: #2d3436;
      }

      .mini-links-count {
        margin: 0;
        font-size: 14px;
        color: #636e72;
      }
    </style>
  </template>
}

export class SocialLinkField extends FieldDef {
  static displayName = 'Social Link';
  static icon = HeartIcon;

  @field title = contains(StringField);
  @field url = contains(UrlField);
  @field backgroundColor = contains(ColorField);
  @field textColor = contains(ColorField);
  @field emoji = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <a
        href={{@model.url}}
        target='_blank'
        rel='noopener noreferrer'
        class='social-link'
        style={{htmlSafe
          (concat
            'background: '
            @model.backgroundColor
            '; color: '
            @model.textColor
            ';'
          )
        }}
      >
        {{#if @model.emoji}}
          <span class='emoji'>{{@model.emoji}}</span>
        {{/if}}
        <span class='title'>{{@model.title}}</span>
        <div class='shine-overlay'></div>
      </a>

      <style scoped>
        .social-link {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px 32px;
          border-radius: 30px;
          text-decoration: none;
          font-weight: 700;
          font-size: 17px;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
          border: 2px solid rgba(255, 255, 255, 0.25);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
          backdrop-filter: blur(15px);
          letter-spacing: 0.3px;
        }

        .social-link:hover {
          transform: translateY(-3px) scale(1.03);
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
          border-color: rgba(255, 255, 255, 0.4);
        }

        .social-link:active {
          transform: translateY(-1px) scale(1.01);
        }

        .emoji {
          margin-right: 14px;
          font-size: 22px;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
        }

        .title {
          flex: 1;
          text-align: center;
          font-weight: 800;
        }

        .shine-overlay {
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.3),
            transparent
          );
          transition: left 0.6s ease;
        }

        .social-link:hover .shine-overlay {
          left: 100%;
        }
      </style>
    </template>
  };
}

export class StylishFashionInfluencerLinktree extends CardDef {
  static displayName = 'Premium Fashion Influencer Linktree';
  static icon = CrownIcon;
  static prefersWideFormat = false;

  @field influencerName = contains(StringField);
  @field bio = contains(StringField);
  @field profileImageUrl = contains(UrlField);
  @field backgroundColor = contains(ColorField);
  @field accentColor = contains(ColorField);
  @field socialLinks = containsMany(SocialLinkField);

  @field title = contains(StringField, {
    computeVia: function (this: StylishFashionInfluencerLinktree) {
      return this.influencerName ?? 'Premium Fashion Influencer Linktree';
    },
  });

  static isolated = IsolatedTemplate;
  static embedded = EmbeddedTemplate;
}
