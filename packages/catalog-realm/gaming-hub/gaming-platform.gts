import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';

import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DatetimeField from 'https://cardstack.com/base/datetime';
import UrlField from 'https://cardstack.com/base/url';

import { formatDateTime } from '@cardstack/boxel-ui/helpers';

import GamepadIcon from '@cardstack/boxel-icons/gamepad-2';

export class GamingPlatform extends CardDef {
  static displayName = 'Gaming Platform';
  static icon = GamepadIcon;

  @field name = contains(StringField);
  @field accountId = contains(StringField);
  @field isConnected = contains(BooleanField);
  @field lastSynced = contains(DatetimeField);
  @field gamesCount = contains(NumberField);
  @field logoImageUrl = contains(UrlField);
  @field connectionToken = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='platform-card-compact'>
        <div class='platform-main-compact'>
          {{#if @model.logoImageUrl}}
            <img
              src={{@model.logoImageUrl}}
              alt='{{@model.name}} platform'
              class='platform-logo-compact'
            />
          {{else}}
            <div class='platform-icon-placeholder'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='2' y='3' width='20' height='14' rx='2' ry='2' />
                <line x1='8' y1='21' x2='16' y2='21' />
                <line x1='12' y1='17' x2='12' y2='21' />
              </svg>
            </div>
          {{/if}}

          <div class='platform-info-compact'>
            <h4 class='platform-name-compact'>{{if
                @model.name
                @model.name
                'Unknown Platform'
              }}</h4>
            <div class='account-info-compact'>{{if
                @model.accountId
                @model.accountId
                'Not connected'
              }}</div>
          </div>

          <div
            class='connection-status-compact
              {{if @model.isConnected "connected" "disconnected"}}'
          >
            <div class='status-indicator'></div>
            {{if @model.isConnected 'Connected' 'Offline'}}
          </div>
        </div>

        <div class='platform-stats-compact'>
          <span class='stat-item-compact games'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polygon points='12 2 2 7 12 12 22 7 12 2' />
              <polyline points='2,17 12,22 22,17' />
              <polyline points='2,12 12,17 22,12' />
            </svg>
            {{if @model.gamesCount @model.gamesCount 0}}
            games
          </span>

          {{#if @model.lastSynced}}
            <span class='stat-item-compact sync'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' />
                <path d='M21 3v5h-5' />
                <path d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' />
                <path d='M8 16H3v5' />
              </svg>
              {{formatDateTime @model.lastSynced size='short'}}
            </span>
          {{else}}
            <span class='stat-item-compact sync-error'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <line x1='15' y1='9' x2='9' y2='15' />
                <line x1='9' y1='9' x2='15' y2='15' />
              </svg>
              Never synced
            </span>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .platform-card-compact {
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

        .platform-card-compact:hover {
          transform: translateY(-1px);
          border-color: rgba(99, 102, 241, 0.4);
          box-shadow:
            0 8px 25px rgba(0, 0, 0, 0.15),
            0 0 20px rgba(99, 102, 241, 0.15);
        }

        .platform-card-compact::before {
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

        .platform-main-compact {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
        }

        .platform-logo-compact {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          border: 1px solid rgba(99, 102, 241, 0.3);
          flex-shrink: 0;
        }

        .platform-icon-placeholder {
          width: 32px;
          height: 32px;
          background: linear-gradient(
            135deg,
            rgba(30, 41, 59, 0.8),
            rgba(99, 102, 241, 0.2)
          );
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #a5b4fc;
          flex-shrink: 0;
        }

        .platform-icon-placeholder svg {
          width: 18px;
          height: 18px;
        }

        .platform-info-compact {
          flex: 1;
          min-width: 0;
        }

        .platform-name-compact {
          font-size: 1rem;
          font-weight: 700;
          margin: 0 0 0.25rem 0;
          color: #e2e8f0;
          line-height: 1.2;
          font-family: 'Orbitron', monospace;
        }

        .account-info-compact {
          font-size: 0.75rem;
          color: #94a3b8;
          font-weight: 500;
        }

        .connection-status-compact {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          border-radius: 16px;
          font-size: 0.75rem;
          font-weight: 600;
          backdrop-filter: blur(5px);
          border: 1px solid;
          flex-shrink: 0;
        }

        .connection-status-compact.connected {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.4);
        }

        .connection-status-compact.disconnected {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
          border-color: rgba(239, 68, 68, 0.4);
        }

        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .connected .status-indicator {
          background: #22c55e;
          box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
        }

        .disconnected .status-indicator {
          background: #ef4444;
        }

        .platform-stats-compact {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          padding-top: 0.5rem;
          border-top: 1px solid rgba(99, 102, 241, 0.1);
          flex-wrap: wrap;
        }

        .stat-item-compact {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.75rem;
          font-weight: 500;
          color: #94a3b8;
          padding: 0.25rem 0.5rem;
          background: rgba(30, 41, 59, 0.5);
          border-radius: 8px;
          backdrop-filter: blur(5px);
        }

        .stat-item-compact.games {
          color: #6366f1;
          background: rgba(99, 102, 241, 0.1);
        }

        .stat-item-compact.sync {
          color: #22c55e;
          background: rgba(34, 197, 94, 0.1);
        }

        .stat-item-compact.sync-error {
          color: #f59e0b;
          background: rgba(245, 158, 11, 0.1);
        }

        .stat-item-compact svg {
          width: 12px;
          height: 12px;
        }

        @media (max-width: 480px) {
          .platform-main-compact {
            flex-direction: column;
            text-align: center;
            gap: 0.5rem;
          }

          .platform-stats-compact {
            justify-content: center;
          }
        }
      </style>
    </template>
  };
}
