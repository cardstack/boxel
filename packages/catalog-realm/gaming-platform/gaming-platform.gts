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
import { concat } from '@ember/helper';

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

  @field title = contains(StringField, {
    computeVia: function (this: GamingPlatform) {
      return this.name ?? 'Untitled Gaming Platform';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='stage'>
        <article class='platform-mat'>
          <header class='platform-hero'>
            <div class='hero-background'>
              <div class='hero-pattern'></div>
              <div class='hero-overlay'>
                <div class='hero-gradient'></div>
              </div>
            </div>

            <div class='hero-content'>
              <div class='platform-brand'>
                {{#if @model.logoImageUrl}}
                  <img
                    src={{@model.logoImageUrl}}
                    alt='{{@model.name}} platform'
                    class='platform-logo'
                  />
                {{else}}
                  <div class='platform-logo-placeholder'>
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

                <div class='platform-identity'>
                  <h1 class='platform-name'>{{if
                      @model.name
                      @model.name
                      'Unknown Platform'
                    }}</h1>
                  <div class='platform-meta'>
                    <div
                      class='connection-status
                        {{if @model.isConnected "connected" "disconnected"}}'
                    >
                      <div class='status-pulse'></div>
                      {{if @model.isConnected 'Connected' 'Disconnected'}}
                    </div>
                    {{#if @model.accountId}}
                      <div class='account-badge'>
                        <svg
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          stroke-width='2'
                        >
                          <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                          <circle cx='12' cy='7' r='4' />
                        </svg>
                        {{@model.accountId}}
                      </div>
                    {{/if}}
                  </div>
                </div>
              </div>

              <div class='platform-stats'>
                <div class='stat-card games-stat'>
                  <div class='stat-icon'>
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
                  </div>
                  <div class='stat-content'>
                    <div class='stat-value'>{{if
                        @model.gamesCount
                        @model.gamesCount
                        0
                      }}</div>
                    <div class='stat-label'>Games in Library</div>
                  </div>
                </div>

                {{#if @model.lastSynced}}
                  <div class='stat-card sync-stat'>
                    <div class='stat-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path
                          d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'
                        />
                        <path d='M21 3v5h-5' />
                        <path
                          d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'
                        />
                        <path d='M8 16H3v5' />
                      </svg>
                    </div>
                    <div class='stat-content'>
                      <div class='stat-value'>{{formatDateTime
                          @model.lastSynced
                          size='short'
                        }}</div>
                      <div class='stat-label'>Last Synced</div>
                    </div>
                  </div>
                {{else}}
                  <div class='stat-card error-stat'>
                    <div class='stat-icon'>
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
                    </div>
                    <div class='stat-content'>
                      <div class='stat-value'>Never</div>
                      <div class='stat-label'>Last Synced</div>
                    </div>
                  </div>
                {{/if}}

                {{#if @model.isConnected}}
                  <div class='stat-card status-stat'>
                    <div class='stat-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path
                          d='M9 12l2 2 4-4M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12z'
                        />
                      </svg>
                    </div>
                    <div class='stat-content'>
                      <div class='stat-value'>Active</div>
                      <div class='stat-label'>Connection Status</div>
                    </div>
                  </div>
                {{else}}
                  <div class='stat-card error-stat'>
                    <div class='stat-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path
                          d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'
                        />
                        <line x1='12' y1='9' x2='12' y2='13' />
                        <line x1='12' y1='17' x2='12.01' y2='17' />
                      </svg>
                    </div>
                    <div class='stat-content'>
                      <div class='stat-value'>Offline</div>
                      <div class='stat-label'>Connection Status</div>
                    </div>
                  </div>
                {{/if}}
              </div>
            </div>
          </header>

          <main class='platform-content'>
            <section class='connection-section'>
              <div class='section-header'>
                <h2>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M6 10v4' />
                    <path d='M10 10v4' />
                    <path d='M14 6v12' />
                    <path d='M18 8v8' />
                  </svg>
                  Connection Details
                </h2>
              </div>

              <div class='connection-info'>
                <div class='info-grid'>
                  <div class='info-item'>
                    <div class='info-label'>Platform</div>
                    <div class='info-value'>{{if
                        @model.name
                        @model.name
                        'Unknown Platform'
                      }}</div>
                  </div>

                  <div class='info-item'>
                    <div class='info-label'>Account ID</div>
                    <div class='info-value'>{{if
                        @model.accountId
                        @model.accountId
                        'Not connected'
                      }}</div>
                  </div>

                  <div class='info-item'>
                    <div class='info-label'>Games Library</div>
                    <div class='info-value'>{{if
                        @model.gamesCount
                        (concat @model.gamesCount ' games')
                        'No games found'
                      }}</div>
                  </div>

                  <div class='info-item'>
                    <div class='info-label'>Connection Status</div>
                    <div
                      class='info-value status-value
                        {{if @model.isConnected "connected" "disconnected"}}'
                    >
                      <div class='connection-indicator'></div>
                      {{if
                        @model.isConnected
                        'Connected & Active'
                        'Disconnected'
                      }}
                    </div>
                  </div>

                  {{#if @model.lastSynced}}
                    <div class='info-item'>
                      <div class='info-label'>Last Sync</div>
                      <div class='info-value'>{{formatDateTime
                          @model.lastSynced
                          size='medium'
                        }}</div>
                    </div>
                  {{/if}}

                  {{#if @model.connectionToken}}
                    <div class='info-item token-item'>
                      <div class='info-label'>Connection Token</div>
                      <div class='info-value token-masked'>
                        <span class='token-preview'>••••••••••••</span>
                        <div class='token-status'>Configured</div>
                      </div>
                    </div>
                  {{/if}}
                </div>
              </div>
            </section>

            <section class='actions-section'>
              <div class='section-header'>
                <h2>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M12 2L2 7v10l10 5 10-5V7l-10-5z' />
                    <polyline points='2,17 12,22 22,17' />
                    <polyline points='2,12 12,17 22,12' />
                  </svg>
                  Platform Actions
                </h2>
              </div>

              <div class='actions-grid'>
                <div class='action-card sync-action'>
                  <div class='action-icon'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path
                        d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'
                      />
                      <path d='M21 3v5h-5' />
                      <path
                        d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'
                      />
                      <path d='M8 16H3v5' />
                    </svg>
                  </div>
                  <div class='action-content'>
                    <h4>Sync Game Library</h4>
                    <p>Update your game collection from the platform</p>
                  </div>
                </div>

                <div class='action-card settings-action'>
                  <div class='action-icon'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <circle cx='12' cy='12' r='3' />
                      <path
                        d='M12 1v6m0 6v6m11-7h-6m-6 0H1m10-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm0 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'
                      />
                    </svg>
                  </div>
                  <div class='action-content'>
                    <h4>Platform Settings</h4>
                    <p>Configure connection and sync preferences</p>
                  </div>
                </div>

                <div class='action-card connection-action'>
                  <div class='action-icon'>
                    {{#if @model.isConnected}}
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path d='M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' />
                        <path d='M13.73 21a2 2 0 0 1-3.46 0' />
                      </svg>
                    {{else}}
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path d='M13 2L3 14h9l-1 8 10-12h-9l1-8z' />
                      </svg>
                    {{/if}}
                  </div>
                  <div class='action-content'>
                    <h4>{{if
                        @model.isConnected
                        'Manage Connection'
                        'Connect Platform'
                      }}</h4>
                    <p>{{if
                        @model.isConnected
                        'Update credentials or disconnect'
                        'Set up your platform connection'
                      }}</p>
                  </div>
                </div>
              </div>
            </section>
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

        .platform-mat {
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
          .platform-mat {
            max-width: none;
            height: 100%;
            border-radius: 0;
          }
        }

        .platform-hero {
          position: relative;
          min-height: 350px;
          padding: 2rem;
          border-radius: 16px 16px 0 0;
          overflow: hidden;
        }

        @media (max-width: 800px) {
          .platform-hero {
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

        .hero-pattern {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background:
            radial-gradient(
              circle at 20% 20%,
              rgba(99, 102, 241, 0.3) 0%,
              transparent 50%
            ),
            radial-gradient(
              circle at 80% 80%,
              rgba(168, 85, 247, 0.2) 0%,
              transparent 50%
            ),
            radial-gradient(
              circle at 40% 60%,
              rgba(6, 182, 212, 0.1) 0%,
              transparent 50%
            );
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
            rgba(99, 102, 241, 0.2) 100%
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

        .platform-brand {
          display: flex;
          align-items: center;
          gap: 2rem;
          margin-bottom: 3rem;
        }

        @media (max-width: 600px) {
          .platform-brand {
            flex-direction: column;
            gap: 1.5rem;
            text-align: center;
          }
        }

        .platform-logo {
          width: 80px;
          height: 80px;
          border-radius: 16px;
          border: 2px solid rgba(99, 102, 241, 0.3);
          box-shadow: 0 8px 32px rgba(99, 102, 241, 0.2);
          flex-shrink: 0;
        }

        .platform-logo-placeholder {
          width: 80px;
          height: 80px;
          background: linear-gradient(
            135deg,
            rgba(30, 41, 59, 0.8),
            rgba(99, 102, 241, 0.3)
          );
          border: 2px solid rgba(99, 102, 241, 0.3);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #a5b4fc;
          flex-shrink: 0;
          box-shadow: 0 8px 32px rgba(99, 102, 241, 0.2);
        }

        .platform-logo-placeholder svg {
          width: 40px;
          height: 40px;
        }

        .platform-identity {
          flex: 1;
        }

        .platform-name {
          font-size: clamp(2rem, 5vw, 2.5rem);
          font-weight: 800;
          margin: 0 0 1rem 0;
          color: #ffffff;
          line-height: 1.2;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          font-family: 'Orbitron', monospace;
        }

        .platform-meta {
          display: flex;
          align-items: center;
          gap: 1.5rem;
          flex-wrap: wrap;
        }

        @media (max-width: 600px) {
          .platform-meta {
            justify-content: center;
          }
        }

        .connection-status {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1.25rem;
          border-radius: 25px;
          font-size: 0.875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          backdrop-filter: blur(15px);
          border: 1px solid;
          position: relative;
          overflow: hidden;
        }

        .status-pulse {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }

        .connection-status.connected {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.4);
          box-shadow: 0 0 25px rgba(34, 197, 94, 0.3);
        }

        .connection-status.connected .status-pulse {
          background: #22c55e;
        }

        .connection-status.disconnected {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
          border-color: rgba(239, 68, 68, 0.4);
        }

        .connection-status.disconnected .status-pulse {
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

        .account-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.25rem;
          background: rgba(30, 41, 59, 0.8);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 20px;
          color: #a5b4fc;
          font-size: 0.875rem;
          font-weight: 600;
          backdrop-filter: blur(15px);
        }

        .account-badge svg {
          width: 16px;
          height: 16px;
        }

        .platform-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1.5rem;
          margin-top: 2rem;
        }

        @media (max-width: 600px) {
          .platform-stats {
            grid-template-columns: 1fr;
            gap: 1rem;
          }
        }

        .stat-card {
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

        .stat-card::before {
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

        .stat-card:hover::before {
          left: 100%;
        }

        .stat-card:hover {
          transform: translateY(-2px);
          border-color: #6366f1;
          box-shadow: 0 8px 25px rgba(99, 102, 241, 0.2);
        }

        .games-stat {
          border-color: rgba(99, 102, 241, 0.4);
          background: rgba(99, 102, 241, 0.05);
        }

        .sync-stat {
          border-color: rgba(34, 197, 94, 0.4);
          background: rgba(34, 197, 94, 0.05);
        }

        .status-stat {
          border-color: rgba(6, 182, 212, 0.4);
          background: rgba(6, 182, 212, 0.05);
        }

        .error-stat {
          border-color: rgba(239, 68, 68, 0.4);
          background: rgba(239, 68, 68, 0.05);
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

        .games-stat .stat-icon {
          background: rgba(99, 102, 241, 0.1);
          border-color: rgba(99, 102, 241, 0.3);
          color: #6366f1;
        }

        .sync-stat .stat-icon {
          background: rgba(34, 197, 94, 0.1);
          border-color: rgba(34, 197, 94, 0.3);
          color: #22c55e;
        }

        .status-stat .stat-icon {
          background: rgba(6, 182, 212, 0.1);
          border-color: rgba(6, 182, 212, 0.3);
          color: #06b6d4;
        }

        .error-stat .stat-icon {
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.3);
          color: #ef4444;
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

        .stat-label {
          font-size: 0.875rem;
          color: #94a3b8;
          font-weight: 500;
          opacity: 0.9;
        }

        .platform-content {
          padding: 2rem;
        }

        @media (max-width: 800px) {
          .platform-content {
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

        .connection-section {
          margin-bottom: 3rem;
        }

        .connection-info {
          background: rgba(30, 41, 59, 0.4);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 16px;
          padding: 2rem;
          backdrop-filter: blur(10px);
        }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
        }

        .info-item {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 1rem;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(99, 102, 241, 0.1);
          border-radius: 12px;
          transition: all 0.2s ease;
        }

        .info-item:hover {
          border-color: rgba(99, 102, 241, 0.3);
          background: rgba(15, 23, 42, 0.8);
        }

        .info-label {
          font-size: 0.75rem;
          color: #94a3b8;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .info-value {
          font-size: 0.875rem;
          color: #e2e8f0;
          font-weight: 500;
          font-family: 'Orbitron', monospace;
        }

        .status-value {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .connection-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .status-value.connected .connection-indicator {
          background: #22c55e;
          box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
        }

        .status-value.disconnected .connection-indicator {
          background: #ef4444;
        }

        .token-item {
          grid-column: 1 / -1;
        }

        .token-masked {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }

        .token-preview {
          color: #6b7280;
          letter-spacing: 0.1em;
        }

        .token-status {
          padding: 0.25rem 0.5rem;
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border-radius: 6px;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .actions-section {
          margin-bottom: 2rem;
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
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
          backdrop-filter: blur(10px);
          cursor: pointer;
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

        .sync-action {
          border-color: rgba(34, 197, 94, 0.4);
          background: rgba(34, 197, 94, 0.05);
        }

        .settings-action {
          border-color: rgba(245, 158, 11, 0.4);
          background: rgba(245, 158, 11, 0.05);
        }

        .connection-action {
          border-color: rgba(168, 85, 247, 0.4);
          background: rgba(168, 85, 247, 0.05);
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

        .sync-action .action-icon {
          background: rgba(34, 197, 94, 0.1);
          border-color: rgba(34, 197, 94, 0.3);
          color: #22c55e;
        }

        .settings-action .action-icon {
          background: rgba(245, 158, 11, 0.1);
          border-color: rgba(245, 158, 11, 0.3);
          color: #f59e0b;
        }

        .connection-action .action-icon {
          background: rgba(168, 85, 247, 0.1);
          border-color: rgba(168, 85, 247, 0.3);
          color: #a855f7;
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

        @media (max-width: 600px) {
          .actions-grid {
            grid-template-columns: 1fr;
          }

          .info-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

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
