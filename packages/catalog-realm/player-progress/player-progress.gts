import {
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports

import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import DatetimeField from 'https://cardstack.com/base/datetime';
import UrlField from 'https://cardstack.com/base/url';
import MarkdownField from 'https://cardstack.com/base/markdown';

import { formatDateTime, or } from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';

import { Game } from '../game/game';
import { GamingHub } from '../gaming-hub/gaming-hub';

// Player Progress Card - Link between player and game
export class PlayerProgress extends CardDef {
  static displayName = 'Player Progress';
  static icon = TrendingUpIcon;

  @field player = linksTo(() => GamingHub);
  @field game = linksTo(() => Game);
  @field hoursPlayed = contains(NumberField);
  @field status = contains(StringField);
  @field rating = contains(NumberField);
  @field achievementsUnlocked = contains(NumberField);
  @field completionPercentage = contains(NumberField);
  @field startDate = contains(DateField);
  @field completedDate = contains(DateField);
  @field notes = contains(MarkdownField);
  @field screenshotUrls = containsMany(UrlField);
  @field isWishlisted = contains(BooleanField);
  @field lastPlayedDate = contains(DatetimeField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='progress-card-compact'>
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
                      {{! template-lint-disable no-inline-styles }}
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
            (or
              (Boolean @model.startDate)
              (Boolean @model.lastPlayedDate)
              (Boolean @model.isWishlisted)
            )
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
              {{#if @model.isWishlisted}}
                <span class='wishlist-mini'>❤️ Wishlisted</span>
              {{/if}}
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .progress-card-compact {
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
          font-family: 'Inter', system-ui, sans-serif;
        }

        .progress-card-compact:hover {
          transform: translateY(-1px);
          border-color: rgba(99, 102, 241, 0.4);
          box-shadow:
            0 8px 25px rgba(0, 0, 0, 0.15),
            0 0 20px rgba(99, 102, 241, 0.15);
        }

        .progress-card-compact::before {
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
          font-family: 'Orbitron', monospace;
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
          backdrop-filter: blur(5px);
          border: 1px solid;
        }

        .status-playing {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.4);
          box-shadow: 0 0 8px rgba(34, 197, 94, 0.2);
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
          transition: all 0.2s ease;
          min-width: fit-content;
        }

        .stat-item:hover {
          border-color: rgba(99, 102, 241, 0.4);
          background: rgba(30, 41, 59, 0.9);
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
          line-height: 1;
          opacity: 0.9;
        }

        .stat-info {
          min-width: 0;
        }

        .stat-value-mini {
          font-size: 0.8125rem;
          font-weight: 700;
          color: #e2e8f0;
          line-height: 1;
          font-family: 'Orbitron', monospace;
        }

        .stat-label-mini {
          font-size: 0.625rem;
          color: #94a3b8;
          font-weight: 500;
          opacity: 0.9;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          margin-top: 0.125rem;
        }

        .progress-bar-mini {
          width: 100%;
          height: 3px;
          background: rgba(30, 41, 59, 0.8);
          border-radius: 2px;
          overflow: hidden;
          margin-top: 0.25rem;
        }

        .progress-fill-mini {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #16a34a);
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .progress-meta-compact {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          flex-wrap: wrap;
          font-size: 0.6875rem;
          padding-top: 0.5rem;
          border-top: 1px solid rgba(99, 102, 241, 0.1);
        }

        .meta-item {
          color: #94a3b8;
          font-weight: 500;
        }

        .wishlist-mini {
          color: #f472b6;
          font-weight: 600;
          margin-left: auto;
        }

        @media (max-width: 480px) {
          .stats-row-compact {
            flex-direction: column;
            gap: 0.375rem;
          }

          .progress-meta-compact {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.375rem;
          }

          .wishlist-mini {
            margin-left: 0;
          }
        }
      </style>
    </template>
  };
}
