import {
  FieldDef,
  field,
  contains,
  containsMany,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api';

import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import UrlField from 'https://cardstack.com/base/url';
import MarkdownField from 'https://cardstack.com/base/markdown';
import EmailField from 'https://cardstack.com/base/email';

import { formatNumber, gt, lt, subtract } from '@cardstack/boxel-ui/helpers';

import GamepadIcon from '@cardstack/boxel-icons/gamepad-2';
import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';

import { Player } from '../player/player';
import { VideoGame } from '../video-game/video-game';
import { GamingPlatform } from '../gaming-platform/gaming-platform';
import { Tournament } from '../tournament/tournament';

export class GamingStatsField extends FieldDef {
  static displayName = 'Gaming Statistics';
  static icon = TrendingUpIcon;

  @field totalGames = contains(NumberField);
  @field totalHours = contains(NumberField);
  @field completionRate = contains(NumberField);
  @field averageRating = contains(NumberField);
  @field achievementsUnlocked = contains(NumberField);
  @field favoriteGenre = contains(StringField);
  @field currentStreak = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='gaming-stats'>
        <h4 class='stats-title'>Gaming Statistics</h4>

        <div class='stats-grid'>
          {{#if @model.totalGames}}
            <div class='stat-item'>
              <div class='stat-value'>{{@model.totalGames}}</div>
              <div class='stat-label'>Total Games</div>
            </div>
          {{/if}}

          {{#if @model.totalHours}}
            <div class='stat-item'>
              <div class='stat-value'>{{formatNumber @model.totalHours}}</div>
              <div class='stat-label'>Hours Played</div>
            </div>
          {{/if}}

          {{#if @model.completionRate}}
            <div class='stat-item'>
              <div class='stat-value'>{{@model.completionRate}}%</div>
              <div class='stat-label'>Completion Rate</div>
            </div>
          {{/if}}

          {{#if @model.averageRating}}
            <div class='stat-item'>
              <div class='stat-value'>{{@model.averageRating}}/10</div>
              <div class='stat-label'>Avg Rating</div>
            </div>
          {{/if}}

          {{#if @model.achievementsUnlocked}}
            <div class='stat-item'>
              <div class='stat-value'>{{@model.achievementsUnlocked}}</div>
              <div class='stat-label'>Achievements</div>
            </div>
          {{/if}}

          {{#if @model.currentStreak}}
            <div class='stat-item'>
              <div class='stat-value'>{{@model.currentStreak}}</div>
              <div class='stat-label'>Day Streak</div>
            </div>
          {{/if}}
        </div>

        {{#if @model.favoriteGenre}}
          <div class='favorite-genre'>
            <strong>Favorite Genre:</strong>
            {{@model.favoriteGenre}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .gaming-stats {
          padding: 1.5rem;
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 16px;
          background: rgba(30, 41, 59, 0.4);
          backdrop-filter: blur(10px);
        }

        .stats-title {
          font-size: 1.125rem;
          font-weight: 700;
          margin: 0 0 1rem 0;
          color: #e2e8f0;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .stat-item {
          text-align: center;
          padding: 1rem;
          background: rgba(30, 41, 59, 0.8);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 12px;
        }

        .stat-value {
          font-size: 1.5rem;
          font-weight: 800;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .stat-label {
          font-size: 0.75rem;
          color: #cbd5e1;
          margin-top: 0.375rem;
        }

        .favorite-genre {
          text-align: center;
          padding: 1rem;
          background: linear-gradient(
            135deg,
            rgba(99, 102, 241, 0.2),
            rgba(168, 85, 247, 0.2)
          );
          border-radius: 12px;
          font-size: 0.875rem;
          color: #e2e8f0;
        }
      </style>
    </template>
  };
}

// @ts-ignore
export class GamingPlayer extends Player {
  static displayName = 'Gaming Player';
  static icon = GamepadIcon;

  @field gamerTag = contains(StringField);
  @field email = contains(EmailField);
  @field bio = contains(MarkdownField);
  @field joinDate = contains(DateField);
  @field isOnline = contains(BooleanField);
  @field profileImageUrl = contains(UrlField);
  @field location = contains(StringField);
  @field preferredGenres = containsMany(StringField);

  @field connectedPlatforms = linksToMany(() => GamingPlatform);
  @field friends = linksToMany(() => GamingPlayer);
  @field favoriteGames = linksToMany(() => VideoGame);
  @field wishlistGames = linksToMany(() => VideoGame);
  @field tournaments = linksToMany(() => Tournament);

  @field gamingGroups = containsMany(StringField);
  @field streamingPlatforms = containsMany(StringField);
  @field contentCreatorStatus = contains(BooleanField);
  @field streamSchedule = contains(StringField);

  @field statistics = contains(GamingStatsField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: GamingPlayer) {
      try {
        const gamerTag = this.gamerTag ?? 'Anonymous Gamer';
        const onlineStatus = this.isOnline ? ' 🟢' : '';
        return `${gamerTag}${onlineStatus}`;
      } catch (e) {
        console.error('GamingPlayer: Error computing title', e);
        return 'Gaming Player';
      }
    },
  });

  @field wishlistCount = contains(NumberField, {
    computeVia: function (this: GamingPlayer) {
      try {
        return this.wishlistGames?.length ?? 0;
      } catch (e) {
        return 0;
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get avatarAlt() {
      return this.args.model.cardTitle || 'Player avatar';
    }

    get avatarFallback() {
      return this.args.model.cardTitle || 'Player';
    }

    get playerName() {
      return this.args.model.cardTitle || 'Unknown Player';
    }

    <template>
      <div class='gaming-player-compact'>
        <div class='profile-main'>
          <div class='profile-avatar-compact'>
            {{#if @model.profileImageUrl}}
              <img
                src={{@model.profileImageUrl}}
                alt='{{@model.gamerTag}} profile'
                class='avatar-image'
              />
            {{else}}
              <div class='avatar-placeholder'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                  <circle cx='12' cy='7' r='4' />
                </svg>
              </div>
            {{/if}}
            <div
              class='status-dot {{if @model.isOnline "online" "offline"}}'
            ></div>
          </div>

          <div class='profile-content'>
            <h3 class='gamer-name'>{{if
                @model.gamerTag
                @model.gamerTag
                'Anonymous Gamer'
              }}</h3>

            <div class='gamer-meta'>
              <span class='online-text'>{{if
                  @model.isOnline
                  'Online'
                  'Offline'
                }}</span>
              {{#if @model.location}}
                <span class='location-text'>• {{@model.location}}</span>
              {{/if}}
            </div>

            {{#if @model.bio}}
              <p class='bio-excerpt'>{{@model.bio}}</p>
            {{/if}}
          </div>

          <div class='profile-stats-compact'>
            {{#if @model.statistics.totalHours}}
              <div class='stat-item'>
                <div class='stat-value'>{{formatNumber
                    @model.statistics.totalHours
                    size='tiny'
                  }}</div>
                <div class='stat-label'>Hours</div>
              </div>
            {{/if}}

            {{#if @model.statistics.currentStreak}}
              <div class='stat-item streak'>
                <div
                  class='stat-value'
                >{{@model.statistics.currentStreak}}</div>
                <div class='stat-label'>🔥 Streak</div>
              </div>
            {{/if}}
          </div>
        </div>

        {{#if (gt @model.preferredGenres.length 0)}}
          <div class='genres-row'>
            {{#each @model.preferredGenres as |genre index|}}
              {{#if (lt index 3)}}
                <span class='genre-pill'>{{genre}}</span>
              {{/if}}
            {{/each}}
            {{#if (gt @model.preferredGenres.length 3)}}
              <span class='genre-pill more'>+{{subtract
                  (Number @model.preferredGenres.length)
                  3
                }}
                more</span>
            {{/if}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .gaming-player-compact {
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

        .profile-main {
          display: flex;
          align-items: flex-start;
          gap: 0.875rem;
          padding: 1rem;
        }

        .profile-avatar-compact {
          position: relative;
          flex-shrink: 0;
          width: 48px;
          height: 48px;
        }

        .avatar-image {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid rgba(99, 102, 241, 0.3);
        }

        .avatar-placeholder {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: linear-gradient(
            135deg,
            rgba(30, 41, 59, 0.8),
            rgba(99, 102, 241, 0.2)
          );
          border: 2px solid rgba(99, 102, 241, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #a5b4fc;
        }

        .avatar-placeholder svg {
          width: 24px;
          height: 24px;
        }

        .status-dot {
          position: absolute;
          bottom: 2px;
          right: 2px;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 2px solid rgba(15, 23, 42, 0.9);
        }

        .status-dot.online {
          background: #00ff88;
        }

        .status-dot.offline {
          background: #64748b;
        }

        .profile-content {
          flex: 1;
          min-width: 0;
        }

        .gamer-name {
          font-size: 1rem;
          font-weight: 700;
          margin: 0 0 0.25rem 0;
          color: #e2e8f0;
        }

        .gamer-meta {
          font-size: 0.75rem;
          color: #94a3b8;
          margin-bottom: 0.5rem;
        }

        .online-text {
          color: #00ff88;
          font-weight: 600;
        }

        .location-text {
          color: #06b6d4;
        }

        .bio-excerpt {
          font-size: 0.75rem;
          color: #cbd5e1;
          line-height: 1.4;
          margin: 0;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }

        .profile-stats-compact {
          display: flex;
          gap: 0.75rem;
          margin-left: auto;
          flex-shrink: 0;
        }

        .stat-item {
          text-align: center;
          min-width: 45px;
          padding: 0.5rem 0.375rem;
          background: rgba(30, 41, 59, 0.7);
          border-radius: 6px;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .stat-item.streak {
          border-color: rgba(245, 158, 11, 0.3);
          background: rgba(245, 158, 11, 0.1);
        }

        .stat-value {
          font-size: 0.9375rem;
          font-weight: 700;
          color: #e2e8f0;
          line-height: 1;
        }

        .streak .stat-value {
          color: #f59e0b;
        }

        .stat-label {
          font-size: 0.625rem;
          color: #94a3b8;
          margin-top: 0.125rem;
          text-transform: uppercase;
        }

        .genres-row {
          display: flex;
          gap: 0.25rem;
          flex-wrap: wrap;
          padding: 0.75rem 1rem 1rem;
          border-top: 1px solid rgba(99, 102, 241, 0.1);
          background: rgba(30, 41, 59, 0.3);
        }

        .genre-pill {
          padding: 0.25rem 0.5rem;
          background: rgba(99, 102, 241, 0.2);
          color: #a5b4fc;
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 12px;
          font-size: 0.6875rem;
          font-weight: 600;
        }

        .genre-pill.more {
          background: rgba(168, 85, 247, 0.2);
          color: #c084fc;
          border-color: rgba(168, 85, 247, 0.3);
        }

        @media (max-width: 480px) {
          .profile-main {
            flex-direction: column;
            text-align: center;
          }

          .profile-stats-compact {
            margin-left: 0;
            justify-content: center;
          }

          .genres-row {
            justify-content: center;
          }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='badge-info'>
            <div class='badge-title'>{{if
                @model.gamerTag
                @model.gamerTag
                'Gamer'
              }}</div>
            <div class='badge-status'>{{if @model.isOnline '🟢' '⚫'}}
              {{if @model.location @model.location 'Unknown'}}</div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='strip-avatar'>
            {{#if @model.profileImageUrl}}
              <img
                src={{@model.profileImageUrl}}
                alt='Profile'
                class='avatar-img'
              />
            {{else}}
              <div class='avatar-placeholder'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='7' r='4' />
                  <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                </svg>
              </div>
            {{/if}}
          </div>
          <div class='strip-info'>
            <div class='strip-title'>{{if
                @model.gamerTag
                @model.gamerTag
                'Anonymous Gamer'
              }}</div>
            <div class='strip-meta'>{{if @model.isOnline 'Online' 'Offline'}}
              {{#if @model.location}}• {{@model.location}}{{/if}}</div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-header'>
            <div class='tile-avatar'>
              {{#if @model.profileImageUrl}}
                <img
                  src={{@model.profileImageUrl}}
                  alt='Profile'
                  class='avatar-img'
                />
              {{else}}
                <div class='avatar-placeholder'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='7' r='4' />
                    <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                  </svg>
                </div>
              {{/if}}
              <div
                class='online-dot {{if @model.isOnline "online" "offline"}}'
              ></div>
            </div>
          </div>

          <div class='tile-content'>
            <div class='tile-title'>{{if
                @model.gamerTag
                @model.gamerTag
                'Anonymous Gamer'
              }}</div>
            <div class='tile-status'>{{if
                @model.isOnline
                'Online'
                'Offline'
              }}</div>

            <div class='tile-stats'>
              <div class='tile-stat'>
                <span class='stat-num'>{{if
                    @model.statistics.totalGames
                    @model.statistics.totalGames
                    0
                  }}</span>
                <span class='stat-label'>Games</span>
              </div>
              <div class='tile-stat'>
                <span class='stat-num'>{{if
                    @model.wishlistGames.length
                    @model.wishlistGames.length
                    0
                  }}</span>
                <span class='stat-label'>Wishlist</span>
              </div>
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='card-main'>
            <div class='card-avatar'>
              {{#if @model.profileImageUrl}}
                <img
                  src={{@model.profileImageUrl}}
                  alt='Profile'
                  class='avatar-img'
                />
              {{else}}
                <div class='avatar-placeholder'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='7' r='4' />
                    <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                  </svg>
                </div>
              {{/if}}
              <div
                class='online-dot {{if @model.isOnline "online" "offline"}}'
              ></div>
            </div>

            <div class='card-info'>
              <div class='card-title'>{{if
                  @model.gamerTag
                  @model.gamerTag
                  'Anonymous Gamer'
                }}</div>
              <div class='card-status'>{{if
                  @model.isOnline
                  '🟢 Online'
                  '⚫ Offline'
                }}
                {{#if @model.location}}• {{@model.location}}{{/if}}</div>
              {{#if @model.bio}}
                <div class='card-bio'>{{@model.bio}}</div>
              {{/if}}
            </div>
          </div>

          <div class='card-stats'>
            <div class='card-stat'>
              <div class='stat-value'>{{if
                  @model.statistics.totalGames
                  @model.statistics.totalGames
                  0
                }}</div>
              <div class='stat-name'>Total Games</div>
            </div>
            <div class='card-stat'>
              <div class='stat-value'>{{if
                  @model.wishlistGames.length
                  @model.wishlistGames.length
                  0
                }}</div>
              <div class='stat-name'>Wishlist</div>
            </div>
            <div class='card-stat'>
              <div class='stat-value'>{{if
                  @model.tournaments.length
                  @model.tournaments.length
                  0
                }}</div>
              <div class='stat-name'>Tournaments</div>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family: 'Inter', sans-serif;
          color: #111827;
        }

        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
        }

        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            align-items: center;
            justify-content: flex-start;
          }
        }

        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
        }

        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
        }

        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            gap: 1rem;
          }
        }

        .badge-info {
          flex: 1;
        }

        .badge-title {
          font-size: clamp(0.75rem, 3vw, 0.875rem);
          font-weight: 600;
          line-height: 1.2;
          color: #111827;
          margin-bottom: 0.25rem;
        }

        .badge-status {
          font-size: clamp(0.625rem, 2.5vw, 0.75rem);
          color: #6b7280;
          line-height: 1.2;
        }

        .strip-avatar,
        .tile-avatar,
        .card-avatar {
          position: relative;
          flex-shrink: 0;
        }

        .strip-avatar {
          width: clamp(32px, 8vw, 40px);
          height: clamp(32px, 8vw, 40px);
        }

        .tile-avatar {
          width: clamp(48px, 12vw, 64px);
          height: clamp(48px, 12vw, 64px);
          margin: 0 auto;
        }

        .card-avatar {
          width: clamp(48px, 8vw, 64px);
          height: clamp(48px, 8vw, 64px);
        }

        .avatar-img {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid #4f46e5;
        }

        .avatar-placeholder {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: linear-gradient(
            135deg,
            rgba(30, 41, 59, 0.9),
            rgba(99, 102, 241, 0.2)
          );
          border: 2px solid rgba(99, 102, 241, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #a5b4fc;
        }

        .avatar-placeholder svg {
          width: 60%;
          height: 60%;
        }

        .online-dot {
          position: absolute;
          bottom: 2px;
          right: 2px;
          width: clamp(8px, 2vw, 12px);
          height: clamp(8px, 2vw, 12px);
          border-radius: 50%;
          border: 2px solid white;
        }

        .online-dot.online {
          background: #10b981;
        }

        .online-dot.offline {
          background: #6b7280;
        }

        .strip-info,
        .card-info {
          flex: 1;
          min-width: 0;
        }

        .strip-title,
        .tile-title,
        .card-title {
          font-weight: 600;
          color: #111827;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-title {
          font-size: clamp(0.8125rem, 3.5vw, 1rem);
          margin-bottom: 0.125rem;
        }

        .tile-title {
          font-size: clamp(0.875rem, 3.5vw, 1rem);
          margin-bottom: 0.25rem;
          text-align: center;
        }

        .card-title {
          font-size: clamp(1rem, 3vw, 1.125rem);
          margin-bottom: 0.25rem;
        }

        .strip-meta,
        .tile-status,
        .card-status {
          font-size: clamp(0.6875rem, 3vw, 0.8125rem);
          color: #6b7280;
          line-height: 1.2;
        }

        .tile-header {
          text-align: center;
          margin-bottom: 0.75rem;
        }

        .tile-content {
          text-align: center;
        }

        .card-main {
          flex: 1.618;
          display: flex;
          gap: 0.75rem;
          align-items: center;
        }

        .card-bio {
          font-size: clamp(0.75rem, 2.5vw, 0.8125rem);
          color: #374151;
          line-height: 1.3;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          margin-top: 0.5rem;
        }

        /* Tile stats */
        .tile-stats {
          display: flex;
          justify-content: center;
          gap: 1rem;
          margin-top: 0.75rem;
        }

        .tile-stat {
          text-align: center;
        }

        .stat-num {
          display: block;
          font-size: clamp(1rem, 4vw, 1.25rem);
          font-weight: 700;
          color: #4f46e5;
          line-height: 1;
        }

        .stat-label {
          font-size: clamp(0.625rem, 2.5vw, 0.75rem);
          color: #6b7280;
          font-weight: 500;
        }

        /* Card stats */
        .card-stats {
          flex: 1;
          display: flex;
          justify-content: space-around;
          align-items: center;
          text-align: center;
        }

        .card-stat {
          flex: 1;
        }

        .stat-value {
          font-size: clamp(1.125rem, 4vw, 1.5rem);
          font-weight: 700;
          color: #4f46e5;
          line-height: 1;
          margin-bottom: 0.25rem;
        }

        .stat-name {
          font-size: clamp(0.6875rem, 2.5vw, 0.75rem);
          color: #6b7280;
          font-weight: 500;
        }

        @container (min-height: 350px) {
          .tile-stats {
            margin-top: auto;
          }
        }
      </style>
    </template>
  };
}
