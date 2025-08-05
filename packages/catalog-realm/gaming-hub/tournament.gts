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

import { Game } from './game';

// Tournament Card - Independent tournament management
export class Tournament extends CardDef {
  static displayName = 'Tournament';
  static icon = TrophyIcon;

  @field name = contains(StringField);
  @field game = linksTo(() => Game);
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

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='tournament-detail'>
        <header class='tournament-header'>
          <h1>{{if @model.name @model.name 'Untitled Tournament'}}</h1>
          <div class='tournament-status status-{{@model.status}}'>
            {{if @model.status @model.status 'Unknown'}}
          </div>
        </header>

        <div class='tournament-info-grid'>
          <div class='info-panel'>
            {{#if @model.game}}
              <div class='game-info'>
                <h3>Featured Game</h3>
                <@fields.game @format='embedded' />
              </div>
            {{/if}}

            <div class='tournament-details'>
              {{#if @model.prizePool}}
                <div class='prize-pool'>Prize Pool:
                  {{formatCurrency @model.prizePool currency='USD'}}</div>
              {{/if}}
              {{#if @model.participants}}
                <div class='participants'>Participants:
                  {{@model.participants}}</div>
              {{/if}}
              {{#if @model.format}}
                <div class='format'>Format: {{@model.format}}</div>
              {{/if}}
            </div>
          </div>

          <div class='schedule-panel'>
            <h3>Schedule</h3>
            {{#if @model.startDate}}
              <div class='date-info'>
                <strong>Start:</strong>
                {{formatDateTime @model.startDate size='medium'}}
              </div>
            {{/if}}
            {{#if @model.endDate}}
              <div class='date-info'>
                <strong>End:</strong>
                {{formatDateTime @model.endDate size='medium'}}
              </div>
            {{/if}}
            {{#if @model.registrationDeadline}}
              <div class='date-info'>
                <strong>Registration Deadline:</strong>
                {{formatDateTime @model.registrationDeadline size='medium'}}
              </div>
            {{/if}}
          </div>
        </div>

        {{#if @model.rules}}
          <div class='rules-section'>
            <h3>Rules & Regulations</h3>
            <@fields.rules />
          </div>
        {{/if}}
      </article>

      <style scoped>
        .tournament-detail {
          max-width: 50rem;
          padding: 2rem;
          background: rgba(30, 41, 59, 0.6);
          border-radius: 16px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          backdrop-filter: blur(10px);
        }

        .tournament-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid rgba(99, 102, 241, 0.2);
        }

        .tournament-header h1 {
          font-size: 2rem;
          font-weight: 800;
          margin: 0;
          color: #e2e8f0;
          font-family: 'Orbitron', monospace;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .tournament-status {
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 600;
          text-transform: capitalize;
        }

        .status-upcoming {
          background: rgba(168, 85, 247, 0.2);
          color: #a855f7;
          border: 1px solid rgba(168, 85, 247, 0.3);
        }

        .status-live {
          background: rgba(0, 255, 136, 0.2);
          color: #00ff88;
          border: 1px solid rgba(0, 255, 136, 0.3);
          box-shadow: 0 0 10px rgba(0, 255, 136, 0.2);
        }

        .status-completed {
          background: rgba(100, 116, 139, 0.2);
          color: #94a3b8;
          border: 1px solid rgba(100, 116, 139, 0.3);
        }

        .status-registration {
          background: rgba(99, 102, 241, 0.2);
          color: #6366f1;
          border: 1px solid rgba(99, 102, 241, 0.3);
        }

        .tournament-info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
          margin-bottom: 2rem;
        }

        @media (max-width: 768px) {
          .tournament-info-grid {
            grid-template-columns: 1fr;
          }
        }

        .info-panel,
        .schedule-panel {
          background: rgba(30, 41, 59, 0.4);
          padding: 1.5rem;
          border-radius: 12px;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .info-panel h3,
        .schedule-panel h3 {
          font-size: 1.25rem;
          font-weight: 700;
          margin: 0 0 1rem 0;
          color: #e2e8f0;
          font-family: 'Orbitron', monospace;
        }

        .tournament-details div {
          margin-bottom: 0.5rem;
          color: #cbd5e1;
        }

        .prize-pool {
          font-size: 1.125rem;
          font-weight: 600;
          color: #f59e0b;
        }

        .date-info {
          margin-bottom: 0.75rem;
          color: #cbd5e1;
        }

        .date-info strong {
          color: #e2e8f0;
        }

        .rules-section {
          background: rgba(30, 41, 59, 0.4);
          padding: 1.5rem;
          border-radius: 12px;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .rules-section h3 {
          font-size: 1.25rem;
          font-weight: 700;
          margin: 0 0 1rem 0;
          color: #e2e8f0;
          font-family: 'Orbitron', monospace;
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
