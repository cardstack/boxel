import {
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';

import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';
import DatetimeField from 'https://cardstack.com/base/datetime';
import UrlField from 'https://cardstack.com/base/url';
import MarkdownField from 'https://cardstack.com/base/markdown';
import enumField from 'https://cardstack.com/base/enum';
import {
  formatDateTime,
  or,
  add,
  lte,
  and,
  eq,
  gt,
} from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';

import { VideoGame } from '../video-game/video-game';
import { GamingPlayer } from '../gaming-player/gaming-player';

const GameStatusField = enumField(StringField, {
  displayName: 'Game Status',
  options: [
    { value: 'playing', label: '🟢 Playing' },
    { value: 'completed', label: '✅ Completed' },
    { value: 'backlog', label: '📋 Backlog' },
    { value: 'dropped', label: '❌ Dropped' },
  ],
});

export class GameRecord extends CardDef {
  static displayName = 'Game Record';
  static icon = TrendingUpIcon;

  @field player = linksTo(() => GamingPlayer);
  @field game = linksTo(() => VideoGame);
  @field hoursPlayed = contains(NumberField);
  @field status = contains(GameStatusField);
  @field rating = contains(NumberField);
  @field achievementsUnlocked = contains(NumberField);
  @field completionPercentage = contains(NumberField);
  @field startDate = contains(DateField);
  @field completedDate = contains(DateField);
  @field notes = contains(MarkdownField);
  @field screenshotUrls = containsMany(UrlField);
  @field lastPlayedDate = contains(DatetimeField);

  @field title = contains(StringField, {
    computeVia: function (this: GameRecord) {
      if (!this.player || !this.game) {
        return undefined;
      }

      return this.player.title + ' - ' + this.game.title;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='stage'>
        <article class='progress-mat'>
          <header class='progress-hero'>
            <div class='hero-background'>
              {{#if @model.screenshotUrls.length}}
                <div class='screenshots-gallery'>
                  {{#each @model.screenshotUrls as |screenshot index|}}
                    <img
                      src={{screenshot}}
                      alt='Game Screenshot {{add index 1}}'
                      class='hero-screenshot screenshot-{{index}}'
                    />
                  {{/each}}
                </div>
              {{/if}}
              <div class='hero-overlay'>
                <div class='hero-gradient'></div>
              </div>
            </div>

            <div class='hero-content'>
              <div class='progress-meta'>
                {{#if @model.player}}
                  <div class='player-info'>
                    <@fields.player @format='embedded' />
                  </div>
                {{/if}}

                <div class='status-indicator status-{{@model.status}}'>
                  <div class='status-pulse'></div>
                  {{if @model.status @model.status 'Unknown Status'}}
                </div>
              </div>

              {{#if @model.game}}
                <div class='featured-game'>
                  <@fields.game @format='embedded' />
                </div>
              {{/if}}

              <div class='hero-stats'>
                {{#if @model.hoursPlayed}}
                  <div class='hero-stat time-stat'>
                    <div class='stat-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <circle cx='12' cy='12' r='10' />
                        <polyline points='12,6 12,12 16,14' />
                      </svg>
                    </div>
                    <div class='stat-content'>
                      <div class='stat-value'>{{@model.hoursPlayed}}</div>
                      <div class='stat-label'>Hours Played</div>
                    </div>
                  </div>
                {{/if}}

                {{#if @model.completionPercentage}}
                  <div class='hero-stat completion-stat'>
                    <div class='stat-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <circle cx='12' cy='12' r='10' />
                        <path d='m9 12 2 2 4-4' />
                      </svg>
                    </div>
                    <div class='stat-content'>
                      <div
                        class='stat-value'
                      >{{@model.completionPercentage}}%</div>
                      <div class='stat-label'>Completed</div>
                      <div class='completion-bar'>
                        <div
                          class='completion-fill'
                          style={{htmlSafe
                            (concat 'width: ' @model.completionPercentage '%')
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                {{/if}}

                {{#if @model.rating}}
                  <div class='hero-stat rating-stat'>
                    <div class='stat-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <polygon
                          points='12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26'
                        />
                      </svg>
                    </div>
                    <div class='stat-content'>
                      <div class='stat-value'>{{@model.rating}}/10</div>
                      <div class='stat-label'>Rating</div>
                      <div class='rating-stars'>
                        <div
                          class='star
                            {{if (lte 1 @model.rating) "filled" "empty"}}'
                        >★</div>
                        <div
                          class='star
                            {{if (lte 2 @model.rating) "filled" "empty"}}'
                        >★</div>
                        <div
                          class='star
                            {{if (lte 3 @model.rating) "filled" "empty"}}'
                        >★</div>
                        <div
                          class='star
                            {{if (lte 4 @model.rating) "filled" "empty"}}'
                        >★</div>
                        <div
                          class='star
                            {{if (lte 5 @model.rating) "filled" "empty"}}'
                        >★</div>
                        <div
                          class='star
                            {{if (lte 6 @model.rating) "filled" "empty"}}'
                        >★</div>
                        <div
                          class='star
                            {{if (lte 7 @model.rating) "filled" "empty"}}'
                        >★</div>
                        <div
                          class='star
                            {{if (lte 8 @model.rating) "filled" "empty"}}'
                        >★</div>
                        <div
                          class='star
                            {{if (lte 9 @model.rating) "filled" "empty"}}'
                        >★</div>
                        <div
                          class='star
                            {{if (lte 10 @model.rating) "filled" "empty"}}'
                        >★</div>
                      </div>
                    </div>
                  </div>
                {{/if}}

                {{#if @model.achievementsUnlocked}}
                  <div class='hero-stat achievements-stat'>
                    <div class='stat-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path d='M6 9H4.5a2.5 2.5 0 0 1 0-5H6' />
                        <path d='M18 9h1.5a2.5 2.5 0 0 0 0-5H18' />
                        <path d='M4 22h16' />
                        <path
                          d='M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22'
                        />
                        <path
                          d='M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22'
                        />
                        <path d='M18 2H6v7a6 6 0 0 0 12 0V2Z' />
                      </svg>
                    </div>
                    <div class='stat-content'>
                      <div
                        class='stat-value'
                      >{{@model.achievementsUnlocked}}</div>
                      <div class='stat-label'>Achievements</div>
                    </div>
                  </div>
                {{/if}}
              </div>
            </div>
          </header>

          <main class='progress-content'>
            <section class='timeline-section'>
              <div class='section-header'>
                <h2>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M3 3v5h5' />
                    <path
                      d='M6 5h10a4 4 0 0 1 4 4v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'
                    />
                    <path d='M5 7v6h8v-2' />
                  </svg>
                  Gaming Timeline
                </h2>
              </div>

              <div class='timeline-container'>
                {{#if @model.startDate}}
                  <div class='timeline-item started'>
                    <div class='timeline-marker'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <polygon points='5,3 19,12 5,21' />
                      </svg>
                    </div>
                    <div class='timeline-content'>
                      <h4>Game Started</h4>
                      <div class='timeline-date'>{{formatDateTime
                          @model.startDate
                          size='medium'
                        }}</div>
                      <p class='timeline-description'>Started this gaming
                        journey with high expectations!</p>
                    </div>
                  </div>
                {{/if}}

                {{#if @model.lastPlayedDate}}
                  <div class='timeline-item recent'>
                    <div class='timeline-marker'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <circle cx='12' cy='12' r='10' />
                        <polyline points='12,6 12,12 16,14' />
                      </svg>
                    </div>
                    <div class='timeline-content'>
                      <h4>Last Session</h4>
                      <div class='timeline-date'>{{formatDateTime
                          @model.lastPlayedDate
                          size='medium'
                        }}</div>
                      <p class='timeline-description'>Most recent gaming session
                        logged</p>
                    </div>
                  </div>
                {{/if}}

                {{#if
                  (and
                    (Boolean @model.completedDate)
                    (eq @model.status 'completed')
                  )
                }}
                  <div class='timeline-item completed'>
                    <div class='timeline-marker'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path d='M6 9H4.5a2.5 2.5 0 0 1 0-5H6' />
                        <path d='M18 9h1.5a2.5 2.5 0 0 0 0-5H18' />
                        <path d='M4 22h16' />
                        <path
                          d='M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22'
                        />
                        <path
                          d='M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22'
                        />
                        <path d='M18 2H6v7a6 6 0 0 0 12 0V2Z' />
                      </svg>
                    </div>
                    <div class='timeline-content'>
                      <h4>Game Completed!</h4>
                      <div class='timeline-date'>{{formatDateTime
                          @model.completedDate
                          size='medium'
                        }}</div>
                      <p class='timeline-description'>Successfully finished the
                        main story and objectives</p>
                    </div>
                  </div>
                {{/if}}
              </div>
            </section>

            {{#if (gt @model.screenshotUrls.length 0)}}
              <section class='screenshots-section'>
                <div class='section-header'>
                  <h2>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path
                        d='M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z'
                      />
                      <circle cx='12' cy='13' r='3' />
                    </svg>
                    Screenshots Gallery
                  </h2>
                </div>

                <div class='screenshots-grid'>
                  {{#each @model.screenshotUrls as |screenshot index|}}
                    <div class='screenshot-card'>
                      <img
                        src={{screenshot}}
                        alt='Game Screenshot {{add index 1}}'
                        class='screenshot-image'
                      />
                      <div class='screenshot-overlay'>
                        <div class='screenshot-number'>{{add index 1}}</div>
                      </div>
                    </div>
                  {{/each}}
                </div>
              </section>
            {{/if}}

            {{#if @model.notes}}
              <section class='notes-section'>
                <div class='section-header'>
                  <h2>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path
                        d='M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z'
                      />
                      <polyline points='14,2 14,8 20,8' />
                      <line x1='16' y1='13' x2='8' y2='13' />
                      <line x1='16' y1='17' x2='8' y2='17' />
                      <polyline points='10,9 9,9 8,9' />
                    </svg>
                    My Review &amp; Notes
                  </h2>
                </div>
                <div class='notes-content'>
                  <@fields.notes />
                </div>
              </section>
            {{/if}}
          </main>
        </article>
      </div>

      <style scoped>
        .stage {
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          padding: 0.5rem;
          background: linear-gradient(
            135deg,
            #0f0f23 0%,
            #1a1a2e 50%,
            #16213e 100%
          );
          overflow: hidden;
        }

        @media (max-width: 800px) {
          .stage {
            padding: 0;
          }
        }

        .progress-mat {
          max-width: 65rem;
          width: 100%;
          padding: 0;
          overflow-y: auto;
          max-height: 100%;
          background: rgba(15, 23, 42, 0.95);
          backdrop-filter: blur(20px);
          border-radius: 16px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          font-size: 0.875rem;
          line-height: 1.4;
        }

        @media (max-width: 800px) {
          .progress-mat {
            max-width: none;
            height: 100%;
            border-radius: 0;
          }
        }

        .progress-hero {
          position: relative;
          min-height: 400px;
          padding: 2rem;
          border-radius: 16px 16px 0 0;
          overflow: hidden;
        }

        .hero-background {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 0;
        }

        .screenshots-gallery {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          opacity: 0.4;
        }

        .hero-screenshot {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .hero-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            135deg,
            rgba(15, 23, 42, 0.85) 0%,
            rgba(99, 102, 241, 0.3) 100%
          );
        }

        .hero-gradient {
          width: 100%;
          height: 100%;
          background:
            radial-gradient(
              ellipse at top left,
              rgba(99, 102, 241, 0.15) 0%,
              transparent 50%
            ),
            radial-gradient(
              ellipse at bottom right,
              rgba(168, 85, 247, 0.15) 0%,
              transparent 50%
            );
        }

        .hero-content {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 60rem;
          margin: 0 auto;
        }

        .progress-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .player-info {
          flex: 1;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.25rem;
          border-radius: 25px;
          font-size: 0.875rem;
          font-weight: 700;
          text-transform: capitalize;
          backdrop-filter: blur(15px);
          border: 1px solid;
        }

        .status-pulse {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }

        .status-playing {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.4);
        }

        .status-playing .status-pulse {
          background: #22c55e;
        }

        .status-completed {
          background: rgba(99, 102, 241, 0.2);
          color: #6366f1;
          border-color: rgba(99, 102, 241, 0.4);
        }

        .status-completed .status-pulse {
          background: #6366f1;
        }

        .status-backlog {
          background: rgba(168, 85, 247, 0.2);
          color: #a855f7;
          border-color: rgba(168, 85, 247, 0.4);
        }

        .status-backlog .status-pulse {
          background: #a855f7;
        }

        .status-dropped {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
          border-color: rgba(239, 68, 68, 0.4);
        }

        .status-dropped .status-pulse {
          background: #ef4444;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(1.1);
          }
        }

        .featured-game {
          margin-bottom: 2rem;
        }

        .hero-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1.5rem;
          margin-top: 2rem;
        }

        .hero-stat {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          padding: 1.5rem;
          background: rgba(30, 41, 59, 0.6);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 16px;
          backdrop-filter: blur(15px);
        }

        .time-stat {
          border-color: rgba(6, 182, 212, 0.4);
          background: rgba(6, 182, 212, 0.05);
        }

        .completion-stat {
          border-color: rgba(34, 197, 94, 0.4);
          background: rgba(34, 197, 94, 0.05);
        }

        .rating-stat {
          border-color: rgba(245, 158, 11, 0.4);
          background: rgba(245, 158, 11, 0.05);
        }

        .achievements-stat {
          border-color: rgba(168, 85, 247, 0.4);
          background: rgba(168, 85, 247, 0.05);
        }

        .stat-icon {
          flex-shrink: 0;
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 12px;
          color: #a5b4fc;
        }

        .time-stat .stat-icon {
          background: rgba(6, 182, 212, 0.1);
          border-color: rgba(6, 182, 212, 0.3);
          color: #06b6d4;
        }

        .completion-stat .stat-icon {
          background: rgba(34, 197, 94, 0.1);
          border-color: rgba(34, 197, 94, 0.3);
          color: #22c55e;
        }

        .rating-stat .stat-icon {
          background: rgba(245, 158, 11, 0.1);
          border-color: rgba(245, 158, 11, 0.3);
          color: #f59e0b;
        }

        .achievements-stat .stat-icon {
          background: rgba(168, 85, 247, 0.1);
          border-color: rgba(168, 85, 247, 0.3);
          color: #a855f7;
        }

        .stat-icon svg {
          width: 24px;
          height: 24px;
        }

        .stat-content {
          flex: 1;
          min-width: 0;
        }

        .stat-value {
          font-size: 1.75rem;
          font-weight: 800;
          color: #e2e8f0;
          line-height: 1;
          margin-bottom: 0.25rem;
        }

        .stat-label {
          font-size: 0.875rem;
          color: #94a3b8;
          font-weight: 500;
          margin-bottom: 0.5rem;
        }

        .completion-bar {
          width: 100%;
          height: 6px;
          background: rgba(30, 41, 59, 0.8);
          border-radius: 3px;
          overflow: hidden;
          margin-top: 0.5rem;
        }

        .completion-fill {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #16a34a);
          border-radius: 3px;
        }

        .rating-stars {
          display: flex;
          gap: 0.125rem;
          margin-top: 0.25rem;
        }

        .star {
          font-size: 1rem;
        }

        .star.filled {
          color: #f59e0b;
        }

        .star.empty {
          color: rgba(245, 158, 11, 0.3);
        }

        .progress-content {
          padding: 2rem;
        }

        .section-header {
          margin-bottom: 2rem;
        }

        .section-header h2 {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 1.5rem;
          font-weight: 700;
          color: #e2e8f0;
          margin: 0;
        }

        .section-header svg {
          width: 24px;
          height: 24px;
          color: #6366f1;
        }

        .timeline-section {
          margin-bottom: 3rem;
        }

        .timeline-container {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        .timeline-item {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
        }

        .timeline-marker {
          flex-shrink: 0;
          width: 48px;
          height: 48px;
          background: rgba(30, 41, 59, 0.9);
          border: 2px solid #6366f1;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #a5b4fc;
        }

        .timeline-marker svg {
          width: 20px;
          height: 20px;
        }

        .timeline-item.started .timeline-marker {
          border-color: #22c55e;
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
        }

        .timeline-item.recent .timeline-marker {
          border-color: #06b6d4;
          background: rgba(6, 182, 212, 0.1);
          color: #06b6d4;
        }

        .timeline-item.completed .timeline-marker {
          border-color: #f59e0b;
          background: rgba(245, 158, 11, 0.1);
          color: #f59e0b;
        }

        .timeline-content {
          background: rgba(30, 41, 59, 0.4);
          padding: 1.5rem;
          border-radius: 12px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          flex: 1;
        }

        .timeline-content h4 {
          font-size: 1.125rem;
          font-weight: 700;
          color: #e2e8f0;
          margin: 0 0 0.5rem 0;
        }

        .timeline-date {
          font-size: 0.875rem;
          color: #a5b4fc;
          font-weight: 600;
          margin-bottom: 0.5rem;
        }

        .timeline-description {
          font-size: 0.875rem;
          color: #94a3b8;
          margin: 0;
        }

        .screenshots-section {
          margin-bottom: 3rem;
        }

        .screenshots-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
        }

        .screenshot-card {
          position: relative;
          border-radius: 12px;
          overflow: hidden;
          background: rgba(30, 41, 59, 0.4);
          border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .screenshot-image {
          width: 100%;
          aspect-ratio: 16/9;
          object-fit: cover;
        }

        .screenshot-overlay {
          position: absolute;
          top: 0.75rem;
          right: 0.75rem;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 8px;
          padding: 0.25rem 0.5rem;
        }

        .screenshot-number {
          font-size: 0.75rem;
          font-weight: 600;
          color: #a5b4fc;
        }

        .notes-section {
          background: rgba(30, 41, 59, 0.4);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 16px;
          padding: 2rem;
        }

        .notes-content {
          color: #cbd5e1;
          line-height: 1.6;
        }

        @media (max-width: 600px) {
          .hero-stats {
            grid-template-columns: 1fr;
            gap: 1rem;
          }

          .progress-meta {
            flex-direction: column;
            align-items: flex-start;
          }

          .screenshots-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='game-record-compact'>
        {{#if @model.game}}
          <div class='game-section-compact'>
            <@fields.game @format='embedded' />
          </div>
        {{/if}}

        <div class='progress-analytics-compact'>
          <div class='progress-header-compact'>
            <div class='progress-title-compact'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M18 20V10' />
                <path d='M12 20V4' />
                <path d='M6 20v-6' />
              </svg>
              Progress Analytics
            </div>
            <div class='status-badge status-{{@model.status}}'>
              {{if @model.status @model.status 'Unknown'}}
            </div>
          </div>

          <div class='stats-row-compact'>
            {{#if @model.hoursPlayed}}
              <div class='stat-item hours'>
                <div class='stat-icon-mini'>🕐</div>
                <div class='stat-info'>
                  <div class='stat-value-mini'>{{@model.hoursPlayed}}h</div>
                  <div class='stat-label-mini'>Played</div>
                </div>
              </div>
            {{/if}}

            {{#if @model.completionPercentage}}
              <div class='stat-item completion'>
                <div class='stat-icon-mini'>✅</div>
                <div class='stat-info'>
                  <div
                    class='stat-value-mini'
                  >{{@model.completionPercentage}}%</div>
                  <div class='stat-label-mini'>Complete</div>
                  <div class='progress-bar-mini'>
                    <div
                      class='progress-fill-mini'
                      style={{htmlSafe
                        (concat 'width: ' @model.completionPercentage '%')
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            {{/if}}

            {{#if @model.rating}}
              <div class='stat-item rating'>
                <div class='stat-icon-mini'>⭐</div>
                <div class='stat-info'>
                  <div class='stat-value-mini'>{{@model.rating}}/10</div>
                  <div class='stat-label-mini'>Rating</div>
                </div>
              </div>
            {{/if}}

            {{#if @model.achievementsUnlocked}}
              <div class='stat-item achievements'>
                <div class='stat-icon-mini'>🏆</div>
                <div class='stat-info'>
                  <div
                    class='stat-value-mini'
                  >{{@model.achievementsUnlocked}}</div>
                  <div class='stat-label-mini'>Unlocked</div>
                </div>
              </div>
            {{/if}}
          </div>

          {{#if
            (or (Boolean @model.startDate) (Boolean @model.lastPlayedDate))
          }}
            <div class='progress-meta-compact'>
              {{#if @model.startDate}}
                <span class='meta-item'>Started
                  {{formatDateTime @model.startDate size='short'}}</span>
              {{/if}}
              {{#if @model.lastPlayedDate}}
                <span class='meta-item'>Last played
                  {{formatDateTime @model.lastPlayedDate size='short'}}</span>
              {{/if}}
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .game-record-compact {
          background: linear-gradient(
            135deg,
            rgba(15, 23, 42, 0.95),
            rgba(30, 41, 59, 0.9)
          );
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 12px;
          overflow: hidden;
          backdrop-filter: blur(10px);
        }

        .game-section-compact {
          border-bottom: 1px solid rgba(99, 102, 241, 0.15);
        }

        .progress-analytics-compact {
          padding: 0.75rem;
        }

        .progress-header-compact {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .progress-title-compact {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.875rem;
          font-weight: 700;
          color: #e2e8f0;
        }

        .progress-title-compact svg {
          width: 16px;
          height: 16px;
          color: #6366f1;
        }

        .status-badge {
          padding: 0.25rem 0.5rem;
          border-radius: 12px;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: capitalize;
          border: 1px solid;
        }

        .status-playing {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.4);
        }

        .status-completed {
          background: rgba(99, 102, 241, 0.2);
          color: #6366f1;
          border-color: rgba(99, 102, 241, 0.4);
        }

        .status-backlog {
          background: rgba(168, 85, 247, 0.2);
          color: #a855f7;
          border-color: rgba(168, 85, 247, 0.4);
        }

        .status-dropped {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
          border-color: rgba(239, 68, 68, 0.4);
        }

        .stats-row-compact {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          margin-bottom: 0.75rem;
        }

        .stat-item {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.5rem 0.75rem;
          background: rgba(30, 41, 59, 0.7);
          border-radius: 8px;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .stat-item.hours {
          border-color: rgba(6, 182, 212, 0.3);
          background: rgba(6, 182, 212, 0.1);
        }

        .stat-item.completion {
          border-color: rgba(34, 197, 94, 0.3);
          background: rgba(34, 197, 94, 0.1);
        }

        .stat-item.rating {
          border-color: rgba(245, 158, 11, 0.3);
          background: rgba(245, 158, 11, 0.1);
        }

        .stat-item.achievements {
          border-color: rgba(168, 85, 247, 0.3);
          background: rgba(168, 85, 247, 0.1);
        }

        .stat-icon-mini {
          font-size: 0.875rem;
        }

        .stat-info {
          min-width: 0;
        }

        .stat-value-mini {
          font-size: 0.8125rem;
          font-weight: 700;
          color: #e2e8f0;
        }

        .stat-label-mini {
          font-size: 0.625rem;
          color: #94a3b8;
          text-transform: uppercase;
          margin-top: 0.125rem;
        }

        .progress-bar-mini {
          width: 100%;
          height: 3px;
          background: rgba(30, 41, 59, 0.8);
          border-radius: 2px;
          margin-top: 0.25rem;
        }

        .progress-fill-mini {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #16a34a);
          border-radius: 2px;
        }

        .progress-meta-compact {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          font-size: 0.6875rem;
          padding-top: 0.5rem;
          border-top: 1px solid rgba(99, 102, 241, 0.1);
        }

        .meta-item {
          color: #94a3b8;
        }
      </style>
    </template>
  };
}
