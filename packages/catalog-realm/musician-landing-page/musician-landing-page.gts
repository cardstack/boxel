import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api';

import StringField from 'https://cardstack.com/base/string';
import TextAreaField from 'https://cardstack.com/base/text-area';
import UrlField from 'https://cardstack.com/base/url';
import DateField from 'https://cardstack.com/base/date';
import ColorField from 'https://cardstack.com/base/color';

import { dayjsFormat, gt } from '@cardstack/boxel-ui/helpers';

import MusicIcon from '@cardstack/boxel-icons/music';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import MailIcon from '@cardstack/boxel-icons/mail';

import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';

class IsolatedMusicianLandingPageTemplate extends Component<
  typeof MusicianLandingPage
> {
  <template>
    <div class='landing-page'>
      <header class='hero-section'>
        {{#if @model.heroImageUrl}}
          <div
            class='hero-image'
            style={{htmlSafe
              (concat 'background-image: url(' @model.heroImageUrl ')')
            }}
          ></div>
        {{/if}}
        <div class='hero-content'>
          <h1 class='artist-name'>{{if
              @model.artistName
              @model.artistName
              'Your Artist Name'
            }}</h1>
          {{#if @model.headline}}
            <p class='headline'>{{@model.headline}}</p>
          {{/if}}
        </div>
      </header>

      <section class='about-section'>
        <h2>About</h2>
        {{#if @model.bio}}
          <div class='bio'>
            <@fields.bio />
          </div>
        {{else}}
          <p class='bio-placeholder'>Add your artist bio here to tell your
            story...</p>
        {{/if}}
      </section>

      {{#if (gt @model.musicSamples.length 0)}}
        <section class='music-section'>
          <h2>Music</h2>
          <div class='music-grid'>
            {{#each @model.musicSamples as |sample|}}
              <div class='music-sample'>
                <audio controls>
                  <source src={{sample}} type='audio/mpeg' />
                  <track kind='captions' src='' label='English' srclang='en' />
                  Your browser does not support the audio element.
                </audio>
              </div>
            {{/each}}
          </div>
        </section>
      {{else}}
        <section class='music-section'>
          <h2>Music</h2>
          <p class='music-placeholder'>Add music samples to showcase your
            sound...</p>
        </section>
      {{/if}}

      {{#if (gt @model.upcomingShows.length 0)}}
        <section class='shows-section'>
          <h2>Upcoming Shows</h2>
          <div class='shows-container'>
            <@fields.upcomingShows @format='embedded' />
          </div>
        </section>
      {{else}}
        <section class='shows-section'>
          <h2>Upcoming Shows</h2>
          <p class='shows-placeholder'>No upcoming shows scheduled. Check back
            soon!</p>
        </section>
      {{/if}}

      {{#if (gt @model.socialLinks.length 0)}}
        <section class='social-section'>
          <h2>Connect</h2>
          <div class='social-links'>
            <@fields.socialLinks @format='embedded' />
          </div>
        </section>
      {{/if}}

      {{#if @model.contactEmail}}
        <section class='contact-section'>
          <h2>Contact</h2>
          <p>For booking inquiries:</p>
          <a
            href={{concat 'mailto:' @model.contactEmail}}
            class='contact-email'
          >
            {{@model.contactEmail}}
          </a>
        </section>
      {{/if}}
    </div>

    <style scoped>
      .landing-page {
        --accent-color: #1db954;
        --spotify-dark: #121212;
        --spotify-darker: #000000;
        --spotify-light: #1e1e1e;
        --spotify-text: #ffffff;
        --spotify-gray: #b3b3b3;
        width: 100%;
        font-family:
          'Circular',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        background: var(--spotify-dark);
        color: var(--spotify-text);
        border-radius: 8px;
        overflow: hidden;
      }

      .hero-section {
        position: relative;
        min-height: 400px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        color: white;
        margin-bottom: 3rem;
        border-radius: 0;
        overflow: hidden;
        background: linear-gradient(
          135deg,
          var(--spotify-darker) 0%,
          var(--spotify-dark) 50%,
          var(--spotify-light) 100%
        );
      }

      .hero-image {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
      }

      .hero-image::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
      }

      .hero-content {
        position: relative;
        z-index: 1;
        padding: 2rem;
      }

      .artist-name {
        font-size: 3rem;
        font-weight: bold;
        margin-bottom: 1rem;
        line-height: 1.1;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7);
      }

      .headline {
        font-size: 1.25rem;
        opacity: 0.9;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.7);
      }

      section {
        margin-bottom: 3rem;
        padding: 0 2rem;
        background: var(--spotify-light);
        border-radius: 8px;
        margin: 2rem;
        padding: 2rem;
      }

      h2 {
        font-size: 2rem;
        margin-bottom: 1.5rem;
        color: var(--accent-color);
        border-bottom: 2px solid var(--accent-color);
        padding-bottom: 0.5rem;
        font-weight: 900;
      }

      .bio-placeholder,
      .music-placeholder,
      .shows-placeholder {
        color: var(--spotify-gray);
        font-style: italic;
        text-align: center;
        padding: 2rem;
        background: var(--spotify-darker);
        border-radius: 8px;
        border: 2px dashed var(--accent-color);
      }

      .music-grid {
        display: grid;
        gap: 1.5rem;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }

      .music-sample {
        background: var(--spotify-darker);
        border-radius: 8px;
        padding: 1rem;
        border: 1px solid #333;
      }

      .music-sample audio {
        width: 100%;
        border-radius: 8px;
        filter: sepia(1) hue-rotate(80deg) saturate(2);
      }

      .shows-section :where(.containsMany-field) {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .shows-container {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .social-links :where(.containsMany-field) {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .contact-email {
        display: inline-block;
        padding: 0.75rem 1.5rem;
        background: var(--accent-color);
        color: var(--spotify-darker);
        text-decoration: none;
        border-radius: 50px;
        font-weight: 700;
        font-size: 0.875rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        transition: all 0.2s;
        border: none;
      }

      .contact-email:hover {
        background: #1ed760;
        transform: scale(1.05);
      }

      @media (max-width: 768px) {
        .artist-name {
          font-size: 2rem;
        }

        section {
          padding: 0 1rem;
        }

        .music-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

class SocialLinkField extends FieldDef {
  static displayName = 'Social Link';
  static icon = MailIcon;

  @field platform = contains(StringField);
  @field url = contains(UrlField);
  @field displayName = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <a
        href={{@model.url}}
        target='_blank'
        rel='noopener noreferrer'
        class='social-link'
      >
        <span class='platform'>{{if
            @model.displayName
            @model.displayName
            @model.platform
          }}</span>
      </a>

      <style scoped>
        .social-link {
          display: inline-block;
          padding: 0.5rem 1rem;
          background: #f3f4f6;
          border-radius: 0.5rem;
          text-decoration: none;
          color: #374151;
          transition: all 0.2s;
        }

        .social-link:hover {
          background: #e5e7eb;
          transform: translateY(-1px);
        }

        .platform {
          font-weight: 500;
        }
      </style>
    </template>
  };
}

class ShowField extends FieldDef {
  static displayName = 'Show';
  static icon = CalendarIcon;

  @field venue = contains(StringField);
  @field date = contains(DateField);
  @field city = contains(StringField);
  @field ticketUrl = contains(UrlField);

  static embedded = class Embedded extends Component<typeof this> {
    get isValidDate() {
      return (
        this.args.model?.date &&
        !isNaN(new Date(this.args.model.date).getTime())
      );
    }

    get formattedDate() {
      if (this.isValidDate) {
        return dayjsFormat(this.args.model.date, 'MMM D');
      }
      return 'TBD';
    }

    get formattedYear() {
      if (this.isValidDate) {
        return dayjsFormat(this.args.model.date, 'YYYY');
      }
      return '';
    }

    <template>
      <div class='show-card'>
        <div class='show-date-section'>
          <div class='date-circle'>
            <div class='date-day'>{{this.formattedDate}}</div>
            {{#if this.formattedYear}}
              <div class='date-year'>{{this.formattedYear}}</div>
            {{/if}}
          </div>
        </div>

        <div class='show-details'>
          <div class='show-venue'>
            {{if @model.venue @model.venue 'Venue TBD'}}
          </div>
          <div class='show-city'>
            {{if @model.city @model.city 'City TBD'}}
          </div>
        </div>

        {{#if @model.ticketUrl}}
          <div class='ticket-section'>
            <a
              href={{@model.ticketUrl}}
              target='_blank'
              rel='noopener noreferrer'
              class='ticket-button'
            >
              <span class='ticket-text'>Get Tickets</span>
              <span class='ticket-icon'>→</span>
            </a>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .show-card {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.25rem;
          background: linear-gradient(135deg, #1db954 0%, #1ed760 100%);
          border-radius: 12px;
          color: white;
          box-shadow: 0 4px 20px rgba(29, 185, 84, 0.3);
          transition: all 0.3s ease;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .show-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px rgba(29, 185, 84, 0.4);
        }

        .show-date-section {
          flex-shrink: 0;
        }

        .date-circle {
          width: 60px;
          height: 60px;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .date-day {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
        }

        .date-year {
          font-size: 0.7rem;
          font-weight: 500;
          opacity: 0.8;
          margin-top: 2px;
        }

        .show-details {
          flex: 1;
          min-width: 0;
        }

        .show-venue {
          font-size: 1.1rem;
          font-weight: 600;
          margin-bottom: 0.25rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .show-city {
          font-size: 0.9rem;
          opacity: 0.9;
          font-weight: 400;
        }

        .ticket-section {
          flex-shrink: 0;
        }

        .ticket-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.25rem;
          background: rgba(255, 255, 255, 0.15);
          color: white;
          text-decoration: none;
          border-radius: 25px;
          font-size: 0.875rem;
          font-weight: 600;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .ticket-button:hover {
          background: rgba(255, 255, 255, 0.25);
          transform: scale(1.05);
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        }

        .ticket-text {
          white-space: nowrap;
        }

        .ticket-icon {
          font-size: 1rem;
          transition: transform 0.3s ease;
        }

        .ticket-button:hover .ticket-icon {
          transform: translateX(3px);
        }

        @media (max-width: 480px) {
          .show-card {
            flex-direction: column;
            text-align: center;
            gap: 1rem;
          }

          .show-details {
            order: 2;
          }

          .ticket-section {
            order: 3;
          }

          .date-circle {
            width: 50px;
            height: 50px;
          }

          .date-day {
            font-size: 1rem;
          }

          .date-year {
            font-size: 0.65rem;
          }
        }
      </style>
    </template>
  };
}

export class MusicianLandingPage extends CardDef {
  static displayName = 'Musician Landing Page';
  static icon = MusicIcon;
  static prefersWideFormat = true;

  @field artistName = contains(StringField);
  @field headline = contains(StringField);
  @field bio = contains(TextAreaField);
  @field heroImageUrl = contains(UrlField);
  @field primaryColor = contains(ColorField);
  @field socialLinks = containsMany(SocialLinkField);
  @field upcomingShows = containsMany(ShowField);
  @field musicSamples = containsMany(UrlField);
  @field contactEmail = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: MusicianLandingPage) {
      return this.artistName ?? 'Musician Landing Page';
    },
  });

  static isolated = IsolatedMusicianLandingPageTemplate;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='musician-preview'>
        <div class='preview-header'>
          {{#if @model.heroImageUrl}}
            <img src={{@model.heroImageUrl}} alt='Artist' class='mini-avatar' />
          {{else}}
            <div class='mini-avatar'>🎵</div>
          {{/if}}
          <div class='preview-info'>
            <h3>{{if
                @model.artistName
                @model.artistName
                'Musician Landing Page'
              }}</h3>
            <p>{{@model.upcomingShows.length}} shows</p>
          </div>
        </div>
      </div>

      <style scoped>
        .musician-preview {
          background: linear-gradient(45deg, #1db954, #1ed760);
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
