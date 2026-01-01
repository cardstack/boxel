import { Component, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import URLField from 'https://cardstack.com/base/url';
import enumField from 'https://cardstack.com/base/enum';

import { CardContainer } from '@cardstack/boxel-ui/components';
import setBackgroundImage from 'https://cardstack.com/base/helpers/set-background-image';

import { Section } from '../components/section';
import { SectionCard } from './section-card';

export class VideoDemoSection extends SectionCard {
  static displayName = 'Video Demo Section';

  @field title = contains(StringField);
  @field description = contains(StringField);
  @field badge = contains(
    enumField(StringField, { options: ['video', 'demo', 'tutorial'] }),
  );
  @field videoUrl = contains(URLField);
  @field posterUrl = contains(URLField);
  @field duration = contains(StringField);

  /** Template Features:
   * Tab navigation between flows
   * Hero video card with poster and duration badge
   * Play overlay button
   * Copy block with badge + description
   */

  static isolated = class Isolated extends Component<typeof this> {
    private get badgeLabel() {
      return this.args.model?.badge?.toUpperCase?.() ?? 'VIDEO';
    }

    <template>
      <Section class='video-demo-section' as |s|>
        <s.Row>
          <CardContainer class='video-card'>
            {{#if @model.videoUrl}}
              <a
                class='video-frame'
                href={{@model.videoUrl}}
                style={{if @model.posterUrl (setBackgroundImage @model.posterUrl)}}
              >
                <span class='play-btn'>▶</span>
                {{#if @model.duration}}
                  <span class='video-duration'>{{@model.duration}}</span>
                {{/if}}
              </a>
            {{else}}
              <div
                class='video-frame'
                style={{if @model.posterUrl (setBackgroundImage @model.posterUrl)}}
              >
                <span class='play-btn'>▶</span>
              </div>
            {{/if}}

            <div class='video-copy'>
              <span class='video-badge'>{{this.badgeLabel}}</span>
              <h3 class='video-title'>{{@model.title}}</h3>
              <p class='video-description'>{{@model.description}}</p>
            </div>
          </CardContainer>
        </s.Row>
      </Section>

      <style scoped>
        .video-demo-section {
          --card-width: 100%;
        }
        .video-card {
          padding: 0;
          overflow: hidden;
        }
        .video-frame {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          aspect-ratio: 16 / 9;
          background: linear-gradient(
            135deg,
            var(--boxel-slate, #272330) 0%,
            #1a1625 100%
          );
          color: white;
          text-decoration: none;
          background-size: cover;
          background-position: center;
        }
        .video-frame::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(
            circle at 30% 40%,
            rgba(0, 255, 186, 0.2) 0%,
            transparent 50%
          );
        }
        .play-btn {
          position: relative;
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: var(--boxel-teal);
          color: var(--boxel-slate);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.75rem;
          z-index: 1;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
        }
        .video-duration {
          position: absolute;
          bottom: 1rem;
          right: 1rem;
          padding: 0.35rem 0.75rem;
          border-radius: var(--boxel-border-radius-sm);
          background: rgba(0, 0, 0, 0.5);
          color: white;
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-size: 0.8rem;
          z-index: 1;
        }
        .video-copy {
          padding: 2rem;
        }
        .video-badge {
          display: inline-block;
          margin-bottom: 1rem;
          padding: 0.35rem 0.75rem;
          border-radius: var(--boxel-border-radius-xs);
          background: var(--boxel-slate);
          color: var(--boxel-teal);
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-size: 0.75rem;
          letter-spacing: 0.05em;
        }
        .video-title {
          margin: 0 0 0.75rem 0;
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--foreground, var(--boxel-slate));
        }
        .video-description {
          margin: 0;
          color: var(--muted-foreground, var(--text-muted));
          line-height: 1.6;
        }
      </style>
    </template>
  };
}
