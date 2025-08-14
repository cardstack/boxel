import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';

import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import UrlField from 'https://cardstack.com/base/url';
import MarkdownField from 'https://cardstack.com/base/markdown';

import { formatDateTime, formatCurrency } from '@cardstack/boxel-ui/helpers';

import TrophyIcon from '@cardstack/boxel-icons/trophy';

import { VideoGame } from '../video-game/video-game';

export class Tournament extends CardDef {
  static displayName = 'Tournament';
  static icon = TrophyIcon;

  @field name = contains(StringField);
  @field game = linksTo(() => VideoGame);
  @field startDate = contains(DatetimeField);
  @field endDate = contains(DatetimeField);
  @field participants = contains(NumberField);
  @field prizePool = contains(NumberField);
  @field status = contains(StringField);
  @field registrationDeadline = contains(DatetimeField);
  @field format = contains(StringField);
  @field organizer = contains(StringField);
  @field rules = contains(MarkdownField);
  @field streamUrl = contains(UrlField);
  @field bracketImageUrl = contains(UrlField);

  @field title = contains(StringField, {
    computeVia: function (this: Tournament) {
      return this.name ?? 'Untitled Tournament';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='stage'>
        <article class='tournament-mat'>
          <header class='tournament-hero'>
            {{#if @model.bracketImageUrl}}
              <div class='hero-background'>
                <img
                  src={{@model.bracketImageUrl}}
                  alt='Tournament Background'
                  class='hero-bg-image'
                />
                <div class='hero-overlay'>
                  <div class='hero-gradient'></div>
                </div>
              </div>
            {{else}}
              <div class='hero-background'>
                <div class='hero-overlay'>
                  <div class='hero-gradient'></div>
                </div>
              </div>
            {{/if}}

            <div class='hero-content'>
              <div class='tournament-meta'>
                {{#if @model.organizer}}
                  <span class='organizer-badge'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' />
                      <circle cx='9' cy='7' r='4' />
                      <path d='M22 21v-2a4 4 0 0 0-3-3.87' />
                      <path d='M16 3.13a4 4 0 0 1 0 7.75' />
                    </svg>
                    {{@model.organizer}}
                  </span>
                {{/if}}

                <div class='tournament-status status-{{@model.status}}'>
                  <div class='status-indicator'></div>
                  {{if @model.status @model.status 'Unknown Status'}}
                </div>
              </div>

              <h1 class='tournament-title'>{{if
                  @model.name
                  @model.name
                  'Untitled Tournament'
                }}</h1>

              {{#if @model.game}}
                <div class='featured-game'>
                  <@fields.game @format='embedded' />
                </div>
              {{/if}}

              <div class='hero-stats'>
                {{#if @model.prizePool}}
                  <div class='hero-stat prize-stat'>
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
                      <div class='stat-value'>{{formatCurrency
                          @model.prizePool
                          currency='USD'
                          size='tiny'
                        }}</div>
                      <div class='stat-label'>Prize Pool</div>
                    </div>
                  </div>
                {{/if}}

                {{#if @model.participants}}
                  <div class='hero-stat participants-stat'>
                    <div class='stat-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' />
                        <circle cx='9' cy='7' r='4' />
                        <path d='M22 21v-2a4 4 0 0 0-3-3.87' />
                        <path d='M16 3.13a4 4 0 0 1 0 7.75' />
                      </svg>
                    </div>
                    <div class='stat-content'>
                      <div class='stat-value'>{{@model.participants}}</div>
                      <div class='stat-label'>Teams</div>
                    </div>
                  </div>
                {{/if}}

                {{#if @model.format}}
                  <div class='hero-stat format-stat'>
                    <div class='stat-icon'>
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
                    </div>
                    <div class='stat-content'>
                      <div
                        class='stat-value stat-value-ellipsis'
                      >{{@model.format}}</div>
                      <div class='stat-label'>Format</div>
                    </div>
                  </div>
                {{/if}}
              </div>
            </div>
          </header>

          <main class='tournament-content'>
            <section class='schedule-section'>
              <div class='section-header'>
                <h2>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
                    <line x1='16' y1='2' x2='16' y2='6' />
                    <line x1='8' y1='2' x2='8' y2='6' />
                    <line x1='3' y1='10' x2='21' y2='10' />
                  </svg>
                  Tournament Schedule
                </h2>
              </div>

              <div class='timeline-container'>
                {{#if @model.registrationDeadline}}
                  <div class='timeline-item registration'>
                    <div class='timeline-marker'>
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
                    </div>
                    <div class='timeline-content'>
                      <h4>Registration Deadline</h4>
                      <div class='timeline-date'>{{formatDateTime
                          @model.registrationDeadline
                          size='medium'
                        }}</div>
                      <p class='timeline-description'>Last chance to register
                        for the tournament. Make sure your team is ready!</p>
                    </div>
                  </div>
                {{/if}}

                {{#if @model.startDate}}
                  <div class='timeline-item start'>
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
                      <h4>Tournament Begins</h4>
                      <div class='timeline-date'>{{formatDateTime
                          @model.startDate
                          size='medium'
                        }}</div>
                      <p class='timeline-description'>Opening ceremony and first
                        round matches. The competition officially begins!</p>
                    </div>
                  </div>
                {{/if}}

                {{#if @model.endDate}}
                  <div class='timeline-item end'>
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
                      <h4>Grand Finals</h4>
                      <div class='timeline-date'>{{formatDateTime
                          @model.endDate
                          size='medium'
                        }}</div>
                      <p class='timeline-description'>Championship match and
                        award ceremony. The crowning of our champions!</p>
                    </div>
                  </div>
                {{/if}}
              </div>
            </section>

            <section class='actions-section'>
              <div class='actions-grid'>
                {{#if @model.streamUrl}}
                  <a
                    href={{@model.streamUrl}}
                    target='_blank'
                    rel='noopener noreferrer'
                    class='action-card stream'
                  >
                    <div class='action-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <polygon points='23,7 16,12 23,17' />
                        <rect
                          x='1'
                          y='5'
                          width='15'
                          height='14'
                          rx='2'
                          ry='2'
                        />
                      </svg>
                    </div>
                    <div class='action-content'>
                      <h4>Watch Live Stream</h4>
                      <p>Follow the action in real-time</p>
                    </div>
                  </a>
                {{/if}}

                {{#if @model.bracketImageUrl}}
                  <a
                    href={{@model.bracketImageUrl}}
                    target='_blank'
                    rel='noopener noreferrer'
                    class='action-card bracket'
                  >
                    <div class='action-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <rect
                          x='3'
                          y='3'
                          width='18'
                          height='18'
                          rx='2'
                          ry='2'
                        />
                        <path d='M9 9h6v6h-6z' />
                        <path d='M21 15v3a3 3 0 0 1-3 3h-3' />
                        <path d='M3 9V6a3 3 0 0 1 3-3h3' />
                      </svg>
                    </div>
                    <div class='action-content'>
                      <h4>View Tournament Bracket</h4>
                      <p>Check matchups and progression</p>
                    </div>
                  </a>
                {{/if}}

                <div class='action-card info disabled'>
                  <div class='action-icon'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <circle cx='12' cy='12' r='10' />
                      <path d='M12 16v-4' />
                      <path d='M12 8h.01' />
                    </svg>
                  </div>
                  <div class='action-content'>
                    <h4>Tournament Information</h4>
                    <p>Rules, schedule, and updates</p>
                  </div>
                </div>
              </div>
            </section>

            {{#if @model.rules}}
              <section class='rules-section'>
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
                    Tournament Rules & Regulations
                  </h2>
                </div>
                <div class='rules-content'>
                  <@fields.rules />
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

        .tournament-mat {
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
          box-shadow:
            0 0 50px rgba(99, 102, 241, 0.1),
            0 20px 40px rgba(0, 0, 0, 0.3);
        }

        @media (max-width: 800px) {
          .tournament-mat {
            max-width: none;
            height: 100%;
            border-radius: 0;
          }
        }

        .tournament-hero {
          position: relative;
          min-height: 350px;
          padding: 2rem;
          border-radius: 16px 16px 0 0;
          overflow: hidden;
        }

        @media (max-width: 800px) {
          .tournament-hero {
            min-height: 280px;
            padding: 1.5rem;
            border-radius: 0;
          }
        }

        .hero-background {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 0;
        }

        .hero-bg-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          opacity: 0.3;
        }

        .hero-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            135deg,
            rgba(15, 23, 42, 0.8) 0%,
            rgba(99, 102, 241, 0.4) 100%
          );
        }

        .hero-gradient {
          width: 100%;
          height: 100%;
          background:
            radial-gradient(
              ellipse at top left,
              rgba(99, 102, 241, 0.1) 0%,
              transparent 50%
            ),
            radial-gradient(
              ellipse at bottom right,
              rgba(168, 85, 247, 0.1) 0%,
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

        .tournament-meta {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
        }

        @media (max-width: 600px) {
          .tournament-meta {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.75rem;
          }
        }

        .organizer-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: rgba(30, 41, 59, 0.8);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 20px;
          color: #a5b4fc;
          font-size: 0.875rem;
          font-weight: 600;
          backdrop-filter: blur(10px);
        }

        .organizer-badge svg {
          width: 16px;
          height: 16px;
        }

        .tournament-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          border-radius: 20px;
          font-size: 0.875rem;
          font-weight: 600;
          text-transform: capitalize;
          backdrop-filter: blur(10px);
          border: 1px solid;
        }

        .status-indicator {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }

        .status-upcoming {
          background: rgba(168, 85, 247, 0.2);
          color: #a855f7;
          border-color: rgba(168, 85, 247, 0.4);
        }

        .status-upcoming .status-indicator {
          background: #a855f7;
        }

        .status-live {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.4);
          box-shadow: 0 0 20px rgba(34, 197, 94, 0.3);
        }

        .status-live .status-indicator {
          background: #22c55e;
        }

        .status-completed {
          background: rgba(100, 116, 139, 0.2);
          color: #94a3b8;
          border-color: rgba(100, 116, 139, 0.4);
        }

        .status-completed .status-indicator {
          background: #94a3b8;
        }

        .status-registration {
          background: rgba(99, 102, 241, 0.2);
          color: #6366f1;
          border-color: rgba(99, 102, 241, 0.4);
        }

        .status-registration .status-indicator {
          background: #6366f1;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        .tournament-title {
          font-size: clamp(2rem, 5vw, 3rem);
          font-weight: 800;
          margin: 0 0 1.5rem 0;
          color: #ffffff;
          line-height: 1.2;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          font-family: 'Orbitron', monospace;
        }

        .featured-game {
          margin-bottom: 2rem;
        }

        .hero-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1.5rem;
          margin-top: 2rem;
        }

        @media (max-width: 600px) {
          .hero-stats {
            grid-template-columns: 1fr;
            gap: 1rem;
          }
        }

        .hero-stat {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.5rem;
          background: rgba(30, 41, 59, 0.6);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 16px;
          backdrop-filter: blur(15px);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .hero-stat::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(99, 102, 241, 0.1),
            transparent
          );
          transition: left 0.5s ease;
        }

        .hero-stat:hover::before {
          left: 100%;
        }

        .hero-stat:hover {
          transform: translateY(-2px);
          border-color: #6366f1;
          box-shadow: 0 8px 25px rgba(99, 102, 241, 0.2);
        }

        .prize-stat {
          border-color: rgba(245, 158, 11, 0.4);
          background: rgba(245, 158, 11, 0.05);
        }

        .participants-stat {
          border-color: rgba(34, 197, 94, 0.4);
          background: rgba(34, 197, 94, 0.05);
        }

        .format-stat {
          border-color: rgba(99, 102, 241, 0.4);
          background: rgba(99, 102, 241, 0.05);
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

        .prize-stat .stat-icon {
          background: rgba(245, 158, 11, 0.1);
          border-color: rgba(245, 158, 11, 0.3);
          color: #f59e0b;
        }

        .participants-stat .stat-icon {
          background: rgba(34, 197, 94, 0.1);
          border-color: rgba(34, 197, 94, 0.3);
          color: #22c55e;
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
          font-size: 1.5rem;
          font-weight: 800;
          color: #e2e8f0;
          line-height: 1;
          margin-bottom: 0.25rem;
          font-family: 'Orbitron', monospace;
        }

        .stat-value-ellipsis {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }

        .stat-label {
          font-size: 0.875rem;
          color: #94a3b8;
          font-weight: 500;
          opacity: 0.9;
        }

        .tournament-content {
          padding: 2rem;
        }

        @media (max-width: 800px) {
          .tournament-content {
            padding: 1.5rem;
          }
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
          font-family: 'Orbitron', monospace;
        }

        .section-header svg {
          width: 24px;
          height: 24px;
          color: #6366f1;
        }

        .schedule-section {
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
          margin-top: 0.25rem;
        }

        .timeline-marker svg {
          width: 20px;
          height: 20px;
        }

        .timeline-item.registration .timeline-marker {
          border-color: #a855f7;
          background: rgba(168, 85, 247, 0.1);
          color: #a855f7;
        }

        .timeline-item.start .timeline-marker {
          border-color: #22c55e;
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
        }

        .timeline-item.end .timeline-marker {
          border-color: #f59e0b;
          background: rgba(245, 158, 11, 0.1);
          color: #f59e0b;
        }

        .timeline-content {
          flex: 1;
          background: rgba(30, 41, 59, 0.4);
          padding: 1.5rem;
          border-radius: 12px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          backdrop-filter: blur(10px);
        }

        .timeline-content h4 {
          font-size: 1.125rem;
          font-weight: 700;
          color: #e2e8f0;
          margin: 0 0 0.5rem 0;
          font-family: 'Orbitron', monospace;
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
          line-height: 1.5;
        }

        .actions-section {
          margin-bottom: 3rem;
        }

        .actions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
        }

        .action-card {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.5rem;
          background: rgba(30, 41, 59, 0.4);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 16px;
          text-decoration: none;
          color: inherit;
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
          backdrop-filter: blur(10px);
        }

        .action-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(99, 102, 241, 0.1),
            transparent
          );
          transition: left 0.5s ease;
        }

        .action-card:hover::before {
          left: 100%;
        }

        .action-card:hover {
          transform: translateY(-2px);
          border-color: #6366f1;
          box-shadow: 0 8px 25px rgba(99, 102, 241, 0.2);
        }

        .action-card.stream {
          border-color: rgba(239, 68, 68, 0.4);
          background: rgba(239, 68, 68, 0.05);
        }

        .action-card.bracket {
          border-color: rgba(34, 197, 94, 0.4);
          background: rgba(34, 197, 94, 0.05);
        }

        .action-card.disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .action-card.disabled:hover {
          transform: none;
          border-color: rgba(99, 102, 241, 0.2);
          box-shadow: none;
        }

        .action-icon {
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

        .action-card.stream .action-icon {
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.3);
          color: #ef4444;
        }

        .action-card.bracket .action-icon {
          background: rgba(34, 197, 94, 0.1);
          border-color: rgba(34, 197, 94, 0.3);
          color: #22c55e;
        }

        .action-icon svg {
          width: 24px;
          height: 24px;
        }

        .action-content h4 {
          font-size: 1rem;
          font-weight: 700;
          color: #e2e8f0;
          margin: 0 0 0.25rem 0;
          font-family: 'Orbitron', monospace;
        }

        .action-content p {
          font-size: 0.875rem;
          color: #94a3b8;
          margin: 0;
          line-height: 1.4;
        }

        .rules-section {
          background: rgba(30, 41, 59, 0.4);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 16px;
          padding: 2rem;
          backdrop-filter: blur(10px);
        }

        .rules-content {
          color: #cbd5e1;
          line-height: 1.6;
        }

        /* Responsive Timeline */
        @media (max-width: 600px) {
          .timeline-container {
            gap: 1.5rem;
          }

          .timeline-item {
            gap: 0.75rem;
          }

          .timeline-marker {
            width: 32px;
            height: 32px;
            border-width: 1px;
          }

          .timeline-marker svg {
            width: 14px;
            height: 14px;
          }

          .timeline-content {
            padding: 1rem;
          }

          .timeline-content h4 {
            font-size: 1rem;
          }

          .actions-grid {
            grid-template-columns: 1fr;
            gap: 1rem;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='tournament-card-compact'>
        <div class='tournament-header-compact'>
          <div class='tournament-title-info'>
            <h4 class='tournament-name-compact'>{{if
                @model.name
                @model.name
                'Untitled Tournament'
              }}</h4>
            {{#if @model.game}}
              <div class='tournament-game-compact'>{{@model.game.title}}</div>
            {{/if}}
          </div>
          <div class='tournament-status-compact status-{{@model.status}}'>
            {{if @model.status @model.status 'Unknown'}}
          </div>
        </div>

        <div class='tournament-details-compact'>
          {{#if @model.prizePool}}
            <div class='detail-item-compact prize'>
              <div class='detail-icon-compact'>🏆</div>
              <div class='detail-info-compact'>
                <div class='detail-value-compact'>{{formatCurrency
                    @model.prizePool
                    currency='USD'
                    size='tiny'
                  }}</div>
                <div class='detail-label-compact'>Prize Pool</div>
              </div>
            </div>
          {{/if}}

          {{#if @model.participants}}
            <div class='detail-item-compact participants'>
              <div class='detail-icon-compact'>👥</div>
              <div class='detail-info-compact'>
                <div class='detail-value-compact'>{{@model.participants}}</div>
                <div class='detail-label-compact'>Players</div>
              </div>
            </div>
          {{/if}}

          {{#if @model.startDate}}
            <div class='detail-item-compact date'>
              <div class='detail-icon-compact'>📅</div>
              <div class='detail-info-compact'>
                <div class='detail-value-compact'>{{formatDateTime
                    @model.startDate
                    size='short'
                  }}</div>
                <div class='detail-label-compact'>Start Date</div>
              </div>
            </div>
          {{/if}}
        </div>

        {{#if @model.format}}
          <div class='tournament-format-compact'>
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
            {{@model.format}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .tournament-card-compact {
          background: linear-gradient(
            135deg,
            rgba(15, 23, 42, 0.95),
            rgba(30, 41, 59, 0.9)
          );
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 12px;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          backdrop-filter: blur(10px);
          box-shadow:
            0 4px 16px rgba(0, 0, 0, 0.2),
            0 0 0 1px rgba(99, 102, 241, 0.05);
          padding: 0.75rem;
        }

        .tournament-card-compact:hover {
          transform: translateY(-1px);
          border-color: rgba(99, 102, 241, 0.4);
          box-shadow:
            0 8px 25px rgba(0, 0, 0, 0.15),
            0 0 20px rgba(99, 102, 241, 0.15);
        }

        .tournament-card-compact::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent,
            #6366f1,
            #a855f7,
            transparent
          );
          opacity: 0.6;
        }

        .tournament-header-compact {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.75rem;
          gap: 0.75rem;
        }

        .tournament-title-info {
          flex: 1;
          min-width: 0;
        }

        .tournament-name-compact {
          font-size: 1rem;
          font-weight: 700;
          margin: 0 0 0.25rem 0;
          color: #e2e8f0;
          line-height: 1.2;
          font-family: 'Orbitron', monospace;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
          overflow: hidden;
        }

        .tournament-game-compact {
          font-size: 0.75rem;
          color: #06b6d4;
          font-weight: 600;
        }

        .tournament-status-compact {
          padding: 0.375rem 0.75rem;
          border-radius: 16px;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: capitalize;
          backdrop-filter: blur(5px);
          border: 1px solid;
          flex-shrink: 0;
          white-space: nowrap;
        }

        .status-upcoming {
          background: rgba(168, 85, 247, 0.2);
          color: #a855f7;
          border-color: rgba(168, 85, 247, 0.4);
        }

        .status-live {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.4);
          box-shadow: 0 0 8px rgba(34, 197, 94, 0.3);
        }

        .status-completed {
          background: rgba(100, 116, 139, 0.2);
          color: #94a3b8;
          border-color: rgba(100, 116, 139, 0.4);
        }

        .status-registration {
          background: rgba(99, 102, 241, 0.2);
          color: #6366f1;
          border-color: rgba(99, 102, 241, 0.4);
        }

        .tournament-details-compact {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          margin-bottom: 0.75rem;
        }

        .detail-item-compact {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.5rem 0.75rem;
          background: rgba(30, 41, 59, 0.7);
          border-radius: 8px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          transition: all 0.2s ease;
          min-width: fit-content;
        }

        .detail-item-compact:hover {
          border-color: rgba(99, 102, 241, 0.4);
          background: rgba(30, 41, 59, 0.9);
        }

        .detail-item-compact.prize {
          border-color: rgba(245, 158, 11, 0.3);
          background: rgba(245, 158, 11, 0.1);
        }

        .detail-item-compact.participants {
          border-color: rgba(99, 102, 241, 0.3);
          background: rgba(99, 102, 241, 0.1);
        }

        .detail-item-compact.date {
          border-color: rgba(34, 197, 94, 0.3);
          background: rgba(34, 197, 94, 0.1);
        }

        .detail-icon-compact {
          font-size: 0.875rem;
          line-height: 1;
          opacity: 0.9;
        }

        .detail-info-compact {
          min-width: 0;
        }

        .detail-value-compact {
          font-size: 0.8125rem;
          font-weight: 700;
          color: #e2e8f0;
          line-height: 1;
          font-family: 'Orbitron', monospace;
        }

        .detail-label-compact {
          font-size: 0.625rem;
          color: #94a3b8;
          font-weight: 500;
          opacity: 0.9;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          margin-top: 0.125rem;
        }

        .tournament-format-compact {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 8px;
          font-size: 0.75rem;
          color: #a5b4fc;
          font-weight: 600;
          backdrop-filter: blur(5px);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        .tournament-format-compact svg {
          width: 14px;
          height: 14px;
          opacity: 0.8;
        }

        /* Mobile responsiveness */
        @media (max-width: 480px) {
          .tournament-details-compact {
            flex-direction: column;
            gap: 0.375rem;
          }

          .tournament-header-compact {
            flex-direction: column;
            gap: 0.5rem;
            align-items: flex-start;
          }
        }
      </style>
    </template>
  };
}
