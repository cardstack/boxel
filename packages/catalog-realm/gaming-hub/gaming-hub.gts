import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
  getComponent,
} from 'https://cardstack.com/base/card-api';

import StringField from 'https://cardstack.com/base/string';

import { Button, CardContainer } from '@cardstack/boxel-ui/components';

import { eq, gt, formatDateTime } from '@cardstack/boxel-ui/helpers';

import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { realmURL, type Query } from '@cardstack/runtime-common';

import GamepadIcon from '@cardstack/boxel-icons/gamepad-2';

import { GamingPlayer } from '../gaming-player/gaming-player';

class Isolated extends Component<typeof GamingHub> {
  @tracked activeTab = 'overview';
  @tracked showStreamingTools = false;
  @tracked gameSearchQuery = '';

  get playerId() {
    return this.args.model?.player?.id;
  }

  get gameRecordQuery(): Query {
    const moduleRef = {
      module: new URL('../game-record/game-record', import.meta.url).href,
      name: 'GameRecord',
    };

    const filters: any[] = [
      { type: moduleRef },
      {
        on: moduleRef,
        eq: { 'player.id': this.playerId ?? '' },
      },
    ];

    // Only add search filter when there's actual search text
    if (this.gameSearchQuery) {
      filters.push({
        on: moduleRef,
        contains: { 'game.cardTitle': this.gameSearchQuery },
      });
    }

    return {
      filter: {
        every: filters,
      },
      sort: [
        {
          by: 'lastPlayedDate',
          on: moduleRef,
          direction: 'desc',
        },
      ],
    };
  }

  // Query for currently playing games
  get playingGamesQuery(): Query {
    const moduleRef = {
      module: new URL('../game-record/game-record', import.meta.url).href,
      name: 'GameRecord',
    };

    return {
      filter: {
        every: [
          { type: moduleRef },
          {
            on: moduleRef,
            eq: { 'player.id': this.playerId ?? '' },
          },
          {
            on: moduleRef,
            eq: { status: 'playing' },
          },
        ],
      },
    };
  }

  get realms() {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  get realmURL(): URL {
    return this.args.model[realmURL]!;
  }

  get player() {
    return this.args?.model?.player;
  }

  get totalGamesCount() {
    try {
      return this.player?.statistics?.totalGames ?? 0;
    } catch (e) {
      console.error('GamingHub: Error counting games', e);
      return 0;
    }
  }

  get wishlistCount() {
    try {
      return this.player?.wishlistGames?.length ?? 0;
    } catch (e) {
      return 0;
    }
  }

  // Get currently playing games count using getCards
  playingGamesResult = this.args.context?.getCards(
    this,
    () => this.playingGamesQuery,
    () => this.realms,
    { isLive: true },
  );

  get playingCount() {
    return this.playingGamesResult?.instances?.length ?? 0;
  }

  setActiveTab = (tab: string) => {
    this.activeTab = tab;
  };

  toggleStreamingTools = () => {
    this.showStreamingTools = !this.showStreamingTools;
  };

  updateGameSearch = (event: Event) => {
    const target = event.target as HTMLInputElement;
    this.gameSearchQuery = target.value;
  };

  clearGameSearch = () => {
    this.gameSearchQuery = '';
  };

  <template>
    <div class='stage'>
      <div class='gaming-hub-mat'>
        <header class='hub-header'>
          <div class='header-content'>
            {{#if @model.player}}
              {{! Profile Avatar }}
              <div class='profile-avatar'>
                {{#if @model.player.profileImageUrl}}
                  <img
                    src={{@model.player.profileImageUrl}}
                    alt='{{@model.player.gamerTag}} profile'
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
                  class='status-indicator
                    {{if @model.player.isOnline "online" "offline"}}'
                >
                  {{if @model.player.isOnline '●' '○'}}
                </div>
              </div>

              {{! Profile Info }}
              <div class='profile-info'>
                <h1 class='gamer-tag'>{{if
                    @model.player.gamerTag
                    @model.player.gamerTag
                    'Anonymous Gamer'
                  }}</h1>

                <div class='status-line'>
                  <span
                    class='online-status
                      {{unless @model.player.isOnline "offline"}}'
                  >
                    {{if @model.player.isOnline '🟢 Online' '⚫ Offline'}}
                  </span>
                  {{#if @model.player.location}}
                    <span class='location'>📍 {{@model.player.location}}</span>
                  {{/if}}
                  {{#if @model.player.joinDate}}
                    <span class='join-date'>
                      Member since
                      {{formatDateTime @model.player.joinDate size='short'}}
                    </span>
                  {{/if}}
                </div>

                {{#if @model.player.bio}}
                  <div class='bio-section'>
                    {{@model.player.bio}}
                  </div>
                {{/if}}
              </div>

              {{! Quick Stats }}
              <div class='quick-stats'>
                <div class='stat-card'>
                  <div class='stat-number'>{{this.totalGamesCount}}</div>
                  <div class='stat-label'>Games</div>
                </div>
                <div class='stat-card playing-stat'>
                  <div class='stat-number'>{{this.playingCount}}</div>
                  <div class='stat-label'>Playing</div>
                </div>
                <div class='stat-card'>
                  <div class='stat-number'>{{this.wishlistCount}}</div>
                  <div class='stat-label'>Wishlist</div>
                </div>
                {{#if @model.player.statistics.achievementsUnlocked}}
                  <div class='stat-card'>
                    <div
                      class='stat-number'
                    >{{@model.player.statistics.achievementsUnlocked}}</div>
                    <div class='stat-label'>Achievements</div>
                  </div>
                {{/if}}
              </div>
            {{else}}
              <div class='empty-state'>
                <h3>No Player Linked</h3>
                <p>Link a Gaming Player to this hub to see their profile and
                  stats.</p>
              </div>
            {{/if}}
          </div>
        </header>

        {{! ⁶⁸ Navigation tabs }}
        <nav class='hub-navigation'>
          <Button
            class='nav-tab {{if (eq this.activeTab "overview") "active" ""}}'
            {{on 'click' (fn this.setActiveTab 'overview')}}
          >
            Overview
          </Button>
          <Button
            class='nav-tab {{if (eq this.activeTab "games") "active" ""}}'
            {{on 'click' (fn this.setActiveTab 'games')}}
          >
            Game Library
          </Button>
          <Button
            class='nav-tab {{if (eq this.activeTab "tournaments") "active" ""}}'
            {{on 'click' (fn this.setActiveTab 'tournaments')}}
          >
            Tournaments
          </Button>
          <Button
            class='nav-tab {{if (eq this.activeTab "friends") "active" ""}}'
            {{on 'click' (fn this.setActiveTab 'friends')}}
          >
            Friends
          </Button>
          <Button
            class='nav-tab {{if (eq this.activeTab "streaming") "active" ""}}'
            {{on 'click' (fn this.setActiveTab 'streaming')}}
          >
            Streaming
          </Button>
        </nav>

        {{! ⁶⁹ Tab content }}
        <main class='hub-content'>
          {{#if (eq this.activeTab 'overview')}}
            <div class='overview-grid'>
              {{! Statistics panel }}
              {{#if @model.player.statistics}}
                <div class='stats-panel'>
                  <@fields.player.statistics @format='embedded' />
                </div>
              {{else}}
                <div class='stats-panel'>
                  <div class='empty-state'>
                    <h3>Gaming Statistics</h3>
                    <p>No statistics available yet. Start playing games to see
                      your progress!</p>
                  </div>
                </div>
              {{/if}}

              {{! Connected platforms }}
              <div class='platforms-panel'>
                <h3 class='section-header'>Connected Platforms</h3>
                {{#if (gt @model.player.connectedPlatforms.length 0)}}
                  <div class='platforms-list'>
                    {{#each @model.player.connectedPlatforms as |platform|}}
                      {{#let (getComponent platform) as |PlatformComponent|}}
                        <CardContainer
                          {{@context.cardComponentModifier
                            cardId=platform.id
                            format='data'
                            fieldType=undefined
                            fieldName=undefined
                          }}
                          @displayBoundaries={{true}}
                        >
                          <PlatformComponent @format='embedded' />
                        </CardContainer>
                      {{/let}}
                    {{/each}}
                  </div>
                {{else}}
                  <div class='empty-state'>
                    <p>No gaming platforms connected. Link your Steam, Xbox,
                      PlayStation, and other accounts to sync your games!</p>
                  </div>
                {{/if}}
              </div>

              <div class='current-games-panel'>
                <h3 class='section-header'>Recent Activity</h3>
                {{#let
                  (component @context.prerenderedCardSearchComponent)
                  as |PrerenderedCardSearch|
                }}
                  <PrerenderedCardSearch
                    @query={{this.gameRecordQuery}}
                    @format='embedded'
                    @realms={{this.realms}}
                    @isLive={{true}}
                  >
                    <:loading>
                      <div class='loading-state'>Loading recent activity...</div>
                    </:loading>
                    <:response as |records|>
                      {{#if (gt records.length 0)}}
                        <div class='current-games-container'>
                          {{#each records key='url' as |record|}}
                            {{#unless record.isError}}
                              <CardContainer
                                {{@context.cardComponentModifier
                                  cardId=record.url
                                  format='data'
                                  fieldType=undefined
                                  fieldName=undefined
                                }}
                                @displayBoundaries={{true}}
                              >
                                <record.component />
                              </CardContainer>
                            {{/unless}}
                          {{/each}}
                        </div>
                      {{else}}
                        <div class='empty-state'>
                          <p>No recent game activity. Start playing to track
                            your progress!</p>
                        </div>
                      {{/if}}
                    </:response>
                  </PrerenderedCardSearch>
                {{/let}}
              </div>
            </div>
          {{/if}}

          {{#if (eq this.activeTab 'games')}}
            <div class='games-section'>
              <div class='games-header'>
                <h2>Game Library</h2>
                <div class='library-stats'>
                  <span>{{if
                      @model.player.statistics.totalGames
                      @model.player.statistics.totalGames
                      0
                    }}
                    total games</span>
                  {{#if @model.player.statistics}}
                    <span>{{@model.player.statistics.completionRate}}%
                      completion rate</span>
                  {{/if}}
                </div>
              </div>

              <div class='search-section'>
                <div class='search-input-container'>
                  <svg
                    class='search-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='11' cy='11' r='8' />
                    <path d='m21 21-4.35-4.35' />
                  </svg>
                  <label>
                    <input
                      type='text'
                      class='search-input'
                      placeholder='Search by game title'
                      value={{this.gameSearchQuery}}
                      {{on 'input' this.updateGameSearch}}
                    />
                  </label>
                  {{#if this.gameSearchQuery}}
                    <Button
                      class='clear-search-btn'
                      {{on 'click' this.clearGameSearch}}
                      title='Clear search'
                    >
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <line x1='18' y1='6' x2='6' y2='18' />
                        <line x1='6' y1='6' x2='18' y2='18' />
                      </svg>
                    </Button>
                  {{/if}}
                </div>
              </div>

              {{! Game Library Search Results }}
              {{#let
                (component @context.prerenderedCardSearchComponent)
                as |PrerenderedCardSearch|
              }}
                <PrerenderedCardSearch
                  @query={{this.gameRecordQuery}}
                  @format='embedded'
                  @realms={{this.realms}}
                  @isLive={{true}}
                >
                  <:loading>
                    <div class='search-loading'>
                      <div class='loading-spinner'></div>
                      <span>Searching your game library...</span>
                    </div>
                  </:loading>

                  <:response as |games|>
                    {{#if (gt games.length 0)}}
                      <div class='game-library-container'>
                        {{#if this.gameSearchQuery}}
                          <div class='search-results-header'>
                            <span class='results-count'>{{games.length}}
                              games found</span>
                            <span class='search-query'>for "{{this.gameSearchQuery}}"</span>
                          </div>
                        {{/if}}
                        {{#each games key='url' as |game|}}
                          {{#unless game.isError}}
                            <div class='game-progress-wrapper'>
                              <CardContainer
                                {{@context.cardComponentModifier
                                  cardId=game.url
                                  format='data'
                                  fieldType=undefined
                                  fieldName=undefined
                                }}
                                @displayBoundaries={{true}}
                              >
                                <game.component />
                              </CardContainer>
                            </div>
                          {{/unless}}
                        {{/each}}
                      </div>
                    {{else}}
                      {{#if this.gameSearchQuery}}
                        <div class='no-search-results'>
                          <div class='no-results-icon'>
                            <svg
                              viewBox='0 0 24 24'
                              fill='none'
                              stroke='currentColor'
                              stroke-width='2'
                            >
                              <circle cx='11' cy='11' r='8' />
                              <path d='m21 21-4.35-4.35' />
                              <line x1='11' y1='8' x2='11' y2='14' />
                              <line x1='8' y1='11' x2='14' y2='11' />
                            </svg>
                          </div>
                          <h3>No Games Found</h3>
                          <p>No games match your search for "{{this.gameSearchQuery}}".
                          </p>
                          <Button
                            class='clear-search-suggestion'
                            {{on 'click' this.clearGameSearch}}
                          >
                            Clear Search
                          </Button>
                        </div>
                      {{else}}
                        <div class='empty-state'>
                          <h3>No Games in Library</h3>
                          <p>Add games to track your progress.</p>
                        </div>
                      {{/if}}
                    {{/if}}
                  </:response>
                </PrerenderedCardSearch>
              {{/let}}

              <div class='wishlist-section'>
                <div class='wishlist-header'>
                  <h3>🎯 Wishlist</h3>
                  <div class='wishlist-count-badge'>{{this.wishlistCount}}
                    items</div>
                </div>

                {{! Display from player's wishlist }}
                {{#if (gt @model.player.wishlistGames.length 0)}}
                  <div class='wishlist-grid'>
                    {{#each @model.player.wishlistGames as |game|}}
                      {{#let (getComponent game) as |GameComponent|}}
                        <CardContainer
                          {{@context.cardComponentModifier
                            cardId=game.id
                            format='data'
                            fieldType=undefined
                            fieldName=undefined
                          }}
                          @displayBoundaries={{true}}
                        >
                          <GameComponent @format='embedded' />
                        </CardContainer>
                      {{/let}}
                    {{/each}}
                  </div>
                {{else}}
                  <div class='wishlist-empty-state'>
                    <div class='empty-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path
                          d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'
                        />
                      </svg>
                    </div>
                    <h4>Your Gaming Wishlist Awaits</h4>
                    <p>Discover amazing games and save them here for your next
                      adventure. Build your perfect gaming collection!</p>
                  </div>
                {{/if}}
              </div>
            </div>
          {{/if}}

          {{#if (eq this.activeTab 'tournaments')}}
            <div class='tournaments-section'>
              <h2 class='section-header'>Tournaments & Competitions</h2>
              {{#if (gt @model.player.tournaments.length 0)}}
                <div class='tournaments-grid'>
                  {{#each @model.player.tournaments as |tournament|}}
                    {{#let (getComponent tournament) as |TournamentComponent|}}
                      <CardContainer
                        {{@context.cardComponentModifier
                          cardId=tournament.id
                          format='data'
                          fieldType=undefined
                          fieldName=undefined
                        }}
                        @displayBoundaries={{true}}
                      >
                        <TournamentComponent @format='embedded' />
                      </CardContainer>
                    {{/let}}
                  {{/each}}
                </div>
              {{else}}
                <div class='empty-state'>
                  <h3>No Tournament Participation</h3>
                  <p>Join competitive tournaments to showcase your skills and
                    compete with other gamers!</p>
                </div>
              {{/if}}
            </div>
          {{/if}}

          {{#if (eq this.activeTab 'friends')}}
            <div class='friends-section'>
              <div class='network-header'>
                <h2 class='section-header'>🌐 Gaming Network</h2>
                <div class='network-stats'>
                  <div class='network-stat'>
                    <span class='stat-number'>{{if
                        @model.player.friends.length
                        @model.player.friends.length
                        0
                      }}</span>
                    <span class='stat-text'>Friends</span>
                  </div>
                  <div class='network-stat'>
                    <span class='stat-number'>{{if
                        @model.player.gamingGroups.length
                        @model.player.gamingGroups.length
                        0
                      }}</span>
                    <span class='stat-text'>Groups</span>
                  </div>
                </div>
              </div>

              {{#if (gt @model.player.friends.length 0)}}
                <div class='friends-grid-container'>
                  <h3 class='subsection-title'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
                      <circle cx='9' cy='7' r='4' />
                      <path d='M23 21v-2a4 4 0 0 0-3-3.87' />
                      <path d='M16 3.13a4 4 0 0 1 0 7.75' />
                    </svg>
                    Gaming Friends ({{@model.player.friends.length}})
                  </h3>
                  <div class='friends-grid'>
                    {{#each @model.player.friends as |friend|}}
                      {{#let (getComponent friend) as |FriendComponent|}}
                        <CardContainer
                          {{@context.cardComponentModifier
                            cardId=friend.id
                            format='data'
                            fieldType=undefined
                            fieldName=undefined
                          }}
                          @displayBoundaries={{true}}
                        >
                          <FriendComponent @format='embedded' />
                        </CardContainer>
                      {{/let}}
                    {{/each}}
                  </div>
                </div>
              {{else}}
                <div class='friends-empty-state'>
                  <div class='empty-icon'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
                      <circle cx='9' cy='7' r='4' />
                      <path d='M23 21v-2a4 4 0 0 0-3-3.87' />
                      <path d='M16 3.13a4 4 0 0 1 0 7.75' />
                    </svg>
                  </div>
                  <h4>Build Your Gaming Network</h4>
                  <p>Connect with fellow gamers to share achievements,
                    coordinate multiplayer sessions, and discover new games
                    together!</p>
                </div>
              {{/if}}

              {{#if (gt @model.player.gamingGroups.length 0)}}
                <div class='groups-section'>
                  <h3 class='subsection-title'>
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
                    Community Groups
                  </h3>
                  <div class='groups-grid'>
                    {{#each @model.player.gamingGroups as |group|}}
                      <div class='group-card'>
                        <div class='group-icon'>
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <path
                              d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'
                            />
                            <circle cx='9' cy='7' r='4' />
                            <path d='M23 21v-2a4 4 0 0 0-3-3.87' />
                            <path d='M16 3.13a4 4 0 0 1 0 7.75' />
                          </svg>
                        </div>
                        <div class='group-name'>{{group}}</div>
                        <div class='group-type'>Gaming Community</div>
                      </div>
                    {{/each}}
                  </div>
                </div>
              {{/if}}
            </div>
          {{/if}}

          {{#if (eq this.activeTab 'streaming')}}
            <div class='streaming-section'>
              <h2 class='section-header'>Streaming & Content Creation</h2>

              {{#if @model.player.contentCreatorStatus}}
                <div class='creator-status'>
                  <span class='creator-badge'>✨ Content Creator</span>
                  {{#if @model.player.streamSchedule}}
                    <span class='schedule'>Schedule:
                      {{@model.player.streamSchedule}}</span>
                  {{/if}}
                </div>
              {{/if}}

              {{#if (gt @model.player.streamingPlatforms.length 0)}}
                <div class='streaming-platforms'>
                  <h3>Streaming Platforms</h3>
                  <div class='platforms-list'>
                    {{#each @model.player.streamingPlatforms as |platform|}}
                      <div class='platform-pill'>{{platform}}</div>
                    {{/each}}
                  </div>
                </div>
              {{else}}
                <div class='empty-state'>
                  <h3>No Streaming Platforms</h3>
                  <p>Connect your Twitch, YouTube, and other streaming accounts
                    to manage your content creation!</p>
                </div>
              {{/if}}
            </div>
          {{/if}}
        </main>
      </div>
    </div>

    <style scoped>
      /* ⁷⁰ Gaming hub styles - modernized */
      .stage {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        padding: 0.5rem;
        font-family: 'Orbitron', 'Inter', system-ui, sans-serif;
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

      .gaming-hub-mat {
        max-width: 70rem;
        width: 100%;
        padding: 2rem;
        overflow-y: auto;
        max-height: 100%;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(20px);
        border-radius: 20px;
        border: 1px solid rgba(99, 102, 241, 0.2);
        font-size: 0.875rem;
        line-height: 1.4;
        box-shadow:
          0 0 50px rgba(99, 102, 241, 0.1),
          0 20px 40px rgba(0, 0, 0, 0.3);
        position: relative;
      }

      .gaming-hub-mat::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, #6366f1, transparent);
        opacity: 0.6;
      }

      @media (max-width: 800px) {
        .gaming-hub-mat {
          max-width: none;
          height: 100%;
          padding: 1.5rem;
          border-radius: 0;
        }
      }

      /* Simple Clean Header - Gaming Themed */
      .hub-header {
        margin-bottom: 2rem;
        padding: 1.5rem;
        background: linear-gradient(
          135deg,
          rgba(30, 41, 59, 0.8) 0%,
          rgba(99, 102, 241, 0.1) 100%
        );
        backdrop-filter: blur(15px);
        border-radius: 16px;
        border: 1px solid rgba(99, 102, 241, 0.2);
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      .header-content {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        flex-wrap: wrap;
      }

      @media (max-width: 768px) {
        .header-content {
          flex-direction: column;
          text-align: center;
        }
      }

      .profile-avatar {
        position: relative;
        flex-shrink: 0;
      }

      .avatar-image,
      .avatar-placeholder {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        border: 3px solid transparent;
        background:
          linear-gradient(45deg, #6366f1, #8b5cf6) padding-box,
          linear-gradient(45deg, #6366f1, #a855f7, #06b6d4) border-box;
      }

      .avatar-image {
        object-fit: cover;
        filter: drop-shadow(0 0 15px rgba(99, 102, 241, 0.4));
      }

      .avatar-placeholder {
        background: linear-gradient(
          135deg,
          rgba(30, 41, 59, 0.9),
          rgba(99, 102, 241, 0.2)
        );
        display: flex;
        align-items: center;
        justify-content: center;
        color: #a5b4fc;
        position: relative;
        overflow: hidden;
      }

      .avatar-placeholder::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
          45deg,
          transparent 25%,
          rgba(99, 102, 241, 0.2) 50%,
          transparent 75%
        );
        animation: shimmer 3s infinite;
      }

      .avatar-placeholder svg {
        width: 48px;
        height: 48px;
        filter: drop-shadow(0 0 8px rgba(99, 102, 241, 0.5));
        z-index: 1;
        position: relative;
      }

      .status-indicator {
        position: absolute;
        bottom: 5px;
        right: 5px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 3px solid rgba(30, 41, 59, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 8px;
      }

      .status-indicator.online {
        background: #00ff88;
        color: #0f172a;
        box-shadow:
          0 0 15px rgba(0, 255, 136, 0.6),
          inset 0 0 8px rgba(0, 255, 136, 0.2);
        animation: pulse-glow 2s infinite;
      }

      .status-indicator.offline {
        background: #64748b;
        color: #f1f5f9;
      }

      @keyframes pulse-glow {
        0%,
        100% {
          box-shadow: 0 0 15px rgba(0, 255, 136, 0.6);
        }
        50% {
          box-shadow: 0 0 25px rgba(0, 255, 136, 0.8);
        }
      }

      @keyframes shimmer {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(100%);
        }
      }

      .profile-info {
        flex: 1;
        min-width: 280px;
      }

      .gamer-tag {
        font-size: 1.75rem;
        font-weight: 900;
        margin: 0 0 0.5rem 0;
        background: linear-gradient(135deg, #ffffff, #6366f1, #a855f7);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-family: 'Orbitron', monospace;
        letter-spacing: 0.02em;
        line-height: 1.2;
      }

      .status-line {
        display: flex;
        gap: 1rem;
        margin-bottom: 0.75rem;
        flex-wrap: wrap;
        font-size: 0.875rem;
        align-items: center;
      }

      @media (max-width: 768px) {
        .status-line {
          justify-content: center;
        }
      }

      .online-status {
        font-weight: 700;
        color: #00ff88;
        text-shadow: 0 0 10px rgba(0, 255, 136, 0.6);
        padding: 0.25rem 0.75rem;
        background: rgba(0, 255, 136, 0.1);
        border: 1px solid rgba(0, 255, 136, 0.3);
        border-radius: 16px;
        backdrop-filter: blur(10px);
      }

      .online-status.offline {
        color: #94a3b8;
        text-shadow: none;
        background: rgba(100, 116, 139, 0.1);
        border-color: rgba(100, 116, 139, 0.3);
      }

      .location {
        color: #06b6d4;
        font-weight: 600;
        padding: 0.25rem 0.75rem;
        background: rgba(6, 182, 212, 0.1);
        border: 1px solid rgba(6, 182, 212, 0.3);
        border-radius: 16px;
        backdrop-filter: blur(10px);
      }

      .join-date {
        color: #a855f7;
        font-weight: 600;
        padding: 0.25rem 0.75rem;
        background: rgba(168, 85, 247, 0.1);
        border: 1px solid rgba(168, 85, 247, 0.3);
        border-radius: 16px;
        backdrop-filter: blur(10px);
      }

      .bio-section {
        color: #e2e8f0;
        line-height: 1.5;
        font-size: 0.875rem;
        background: rgba(30, 41, 59, 0.4);
        padding: 1rem;
        border-radius: 8px;
        border: 1px solid rgba(99, 102, 241, 0.2);
        backdrop-filter: blur(10px);
        margin-top: 0.75rem;
      }

      .quick-stats {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
        justify-content: center;
      }

      @media (max-width: 768px) {
        .quick-stats {
          width: 100%;
          justify-content: space-around;
        }
      }

      .stat-card {
        text-align: center;
        min-width: 70px;
        padding: 1rem 0.75rem;
        background: linear-gradient(
          135deg,
          rgba(30, 41, 59, 0.8) 0%,
          rgba(99, 102, 241, 0.1) 100%
        );
        backdrop-filter: blur(15px);
        border-radius: 12px;
        border: 1px solid rgba(99, 102, 241, 0.3);
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
          rgba(99, 102, 241, 0.2),
          transparent
        );
        transition: left 0.5s ease;
      }

      .stat-card:hover::before {
        left: 100%;
      }

      .stat-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(99, 102, 241, 0.3);
        border-color: #6366f1;
      }

      .stat-card.playing-stat {
        border-color: rgba(34, 197, 94, 0.4);
        background: linear-gradient(
          135deg,
          rgba(34, 197, 94, 0.1) 0%,
          rgba(34, 197, 94, 0.05) 100%
        );
      }

      .stat-card.playing-stat:hover {
        box-shadow: 0 8px 25px rgba(34, 197, 94, 0.3);
        border-color: #22c55e;
      }

      .stat-card.playing-stat .stat-number {
        background: linear-gradient(135deg, #22c55e, #16a34a);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .stat-number {
        font-size: 1.5rem;
        font-weight: 900;
        line-height: 1;
        background: linear-gradient(135deg, #ffffff, #6366f1, #a855f7);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-family: 'Orbitron', monospace;
        margin-bottom: 0.25rem;
      }

      .stat-label {
        font-size: 0.75rem;
        color: #cbd5e1;
        font-weight: 600;
        opacity: 0.9;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      /* Navigation styling - gaming themed with enhanced responsiveness */
      .hub-navigation {
        display: flex;
        gap: clamp(0.25rem, 1vw, 0.375rem);
        margin-bottom: clamp(1.5rem, 3vw, 2rem);
        padding: clamp(0.5rem, 2vw, 0.75rem);
        background: rgba(30, 41, 59, 0.6);
        backdrop-filter: blur(15px);
        border-radius: clamp(12px, 2vw, 16px);
        border: 1px solid rgba(99, 102, 241, 0.2);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        position: relative;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      .hub-navigation::-webkit-scrollbar {
        display: none;
      }

      @media (max-width: 768px) {
        .hub-navigation {
          padding: 0.5rem;
          gap: 0.25rem;
          justify-content: flex-start;
        }
      }

      .hub-navigation::before {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, #6366f1, transparent);
        opacity: 0.4;
      }

      .nav-tab {
        padding: clamp(0.625rem, 2vw, 0.875rem) clamp(0.75rem, 3vw, 1.25rem);
        border: none;
        background: transparent;
        color: #94a3b8;
        font-weight: 600;
        border-radius: clamp(8px, 2vw, 10px);
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        white-space: nowrap;
        font-size: clamp(0.75rem, 2vw, 0.875rem);
        position: relative;
        overflow: hidden;
        touch-action: manipulation;
        min-height: 44px; /* Touch-friendly minimum height */
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      @media (max-width: 768px) {
        .nav-tab {
          padding: 0.75rem 1rem;
          font-size: 0.8125rem;
          min-width: fit-content;
        }
      }

      @media (max-width: 480px) {
        .nav-tab {
          padding: 0.625rem 0.75rem;
          font-size: 0.75rem;
        }
      }

      .nav-tab::before {
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

      .nav-tab:hover::before {
        left: 100%;
      }

      .nav-tab:hover {
        background: rgba(99, 102, 241, 0.1);
        color: #e2e8f0;
        transform: translateY(-1px);
      }

      .nav-tab.active {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: white;
        box-shadow:
          0 0 20px rgba(99, 102, 241, 0.4),
          0 4px 12px rgba(99, 102, 241, 0.3);
        transform: translateY(-2px);
      }

      .nav-tab.active::after {
        content: '';
        position: absolute;
        bottom: -2px;
        left: 50%;
        transform: translateX(-50%);
        width: 60%;
        height: 2px;
        background: #00ff88;
        border-radius: 1px;
        box-shadow: 0 0 8px rgba(0, 255, 136, 0.6);
      }

      /* Content area styling */
      .hub-content {
        min-height: 400px;
      }

      .overview-grid {
        display: grid;
        gap: clamp(1rem, 3vw, 1.5rem);
        grid-template-areas:
          'stats stats'
          'platforms current';
      }

      @media (min-width: 768px) {
        .overview-grid {
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        }
      }

      @media (max-width: 767px) {
        .overview-grid {
          grid-template-columns: 1fr;
          grid-template-areas:
            'stats'
            'platforms'
            'current';
          gap: 1rem;
        }
      }

      @media (max-width: 480px) {
        .overview-grid {
          gap: 0.75rem;
        }
      }

      .stats-panel {
        grid-area: stats;
      }

      .platforms-panel {
        grid-area: platforms;
      }

      .current-games-panel {
        grid-area: current;
      }

      .platforms-panel,
      .current-games-panel {
        background: rgba(30, 41, 59, 0.4);
        backdrop-filter: blur(10px);
        border-radius: clamp(8px, 2vw, 16px);
        border: 1px solid rgba(99, 102, 241, 0.2);
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        padding: clamp(0.75rem, 4vw, 1.5rem);
        min-height: clamp(150px, 20vh, 200px);
      }

      @media (max-width: 640px) {
        .platforms-panel,
        .current-games-panel {
          border-radius: 12px;
          padding: 1rem;
          min-height: 140px;
        }
      }

      @media (max-width: 480px) {
        .platforms-panel,
        .current-games-panel {
          padding: 0.875rem;
          min-height: 120px;
          border-radius: 10px;
        }
      }

      @media (max-width: 360px) {
        .platforms-panel,
        .current-games-panel {
          padding: 0.75rem;
          min-height: 100px;
          border-radius: 8px;
        }
      }

      .platforms-panel h3,
      .current-games-panel h3 {
        font-size: 1.125rem;
        font-weight: 700;
        margin: 0 0 1rem 0;
        color: #e2e8f0;
        font-family: 'Orbitron', monospace;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .section-header {
        font-size: 1.125rem;
        font-weight: 700;
        margin: 0 0 1rem 0;
        color: #e2e8f0;
        font-family: 'Orbitron', monospace;
        background: linear-gradient(135deg, #6366f1, #a855f7);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .platforms-panel h3::before {
        content: '🎮';
        font-size: 1rem;
      }

      .current-games-panel h3::before {
        content: '🎯';
        font-size: 1rem;
      }

      /* Container spacing for delegated collections - enhanced responsiveness */
      .platforms-container > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: clamp(0.5rem, 2vw, 0.75rem);
      }

      .current-games-container > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: clamp(0.5rem, 2vw, 0.75rem);
      }

      .game-library-container > .containsMany-field {
        display: grid;
        grid-template-columns: 1fr;
        gap: clamp(0.5rem, 2vw, 0.75rem);
      }

      .wishlist-grid > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1rem;
      }

      .tournaments-container > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: clamp(0.75rem, 2vw, 1rem);
      }

      .friends-grid > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 1rem;
      }

      @media (max-width: 768px) {
        .wishlist-grid > .containsMany-field,
        .tournaments-container > .containsMany-field,
        .friends-grid > .containsMany-field {
          grid-template-columns: 1fr;
        }

        .groups-grid {
          grid-template-columns: 1fr;
        }

        .network-header {
          flex-direction: column;
          text-align: center;
        }

        .wishlist-header {
          flex-direction: column;
          text-align: center;
        }
      }

      @media (max-width: 480px) {
        .tournaments-container > .containsMany-field {
          gap: 0.75rem;
        }
      }

      /* Section styling - gaming panels */
      .games-section,
      .tournaments-section,
      .friends-section,
      .streaming-section {
        background: rgba(30, 41, 59, 0.4);
        backdrop-filter: blur(15px);
        border-radius: 20px;
        border: 1px solid rgba(99, 102, 241, 0.2);
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        padding: 2rem;
        position: relative;
        overflow: hidden;
      }

      .tournaments-section h2,
      .friends-section h2,
      .streaming-section h2 {
        font-size: 1.75rem;
        font-weight: 800;
        margin: 0 0 1.5rem 0;
        color: #e2e8f0;
        background: linear-gradient(135deg, #6366f1, #a855f7);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-family: 'Orbitron', monospace;
      }

      .streaming-platforms h3,
      .groups-section h3 {
        font-size: 1.125rem;
        font-weight: 700;
        margin: 0 0 1rem 0;
        color: #e2e8f0;
        font-family: 'Orbitron', monospace;
      }

      .games-section::before,
      .tournaments-section::before,
      .friends-section::before,
      .streaming-section::before {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        width: 150px;
        height: 150px;
        background: radial-gradient(
          circle,
          rgba(99, 102, 241, 0.05) 0%,
          transparent 70%
        );
        pointer-events: none;
      }

      .games-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
      }

      .games-header h2 {
        font-size: 1.75rem;
        font-weight: 800;
        margin: 0;
        color: #e2e8f0;
        background: linear-gradient(135deg, #6366f1, #a855f7);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-family: 'Orbitron', monospace;
      }

      .library-stats {
        display: flex;
        gap: 1rem;
        font-size: 0.875rem;
        color: #94a3b8;
        font-weight: 500;
      }

      .library-stats span {
        padding: 0.25rem 0.75rem;
        background: rgba(99, 102, 241, 0.1);
        border-radius: 16px;
        border: 1px solid rgba(99, 102, 241, 0.2);
      }

      /* Enhanced Wishlist Section */
      .wishlist-section {
        margin-top: 2.5rem;
        padding: 2rem;
        background: linear-gradient(
          135deg,
          rgba(168, 85, 247, 0.05) 0%,
          rgba(99, 102, 241, 0.05) 100%
        );
        border: 1px solid rgba(168, 85, 247, 0.2);
        border-radius: 20px;
        position: relative;
        overflow: hidden;
      }

      .wishlist-section::before {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        width: 200px;
        height: 200px;
        background: radial-gradient(
          circle,
          rgba(168, 85, 247, 0.08) 0%,
          transparent 70%
        );
        pointer-events: none;
      }

      .wishlist-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
        flex-wrap: wrap;
        gap: 1rem;
      }

      .wishlist-header h3 {
        font-size: 1.5rem;
        font-weight: 800;
        margin: 0;
        color: #e2e8f0;
        font-family: 'Orbitron', monospace;
        background: linear-gradient(135deg, #a855f7, #ec4899, #f59e0b);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .wishlist-count-badge {
        padding: 0.5rem 1rem;
        background: rgba(168, 85, 247, 0.2);
        color: #c084fc;
        border: 1px solid rgba(168, 85, 247, 0.4);
        border-radius: 20px;
        font-size: 0.875rem;
        font-weight: 600;
        backdrop-filter: blur(10px);
        box-shadow: 0 4px 12px rgba(168, 85, 247, 0.2);
      }

      .wishlist-empty-state {
        text-align: center;
        padding: 3rem 2rem;
        background: rgba(30, 41, 59, 0.4);
        border-radius: 16px;
        border: 2px dashed rgba(168, 85, 247, 0.3);
        position: relative;
        overflow: hidden;
      }

      .wishlist-empty-state::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 300px;
        height: 300px;
        background: radial-gradient(
          circle,
          rgba(168, 85, 247, 0.05) 0%,
          transparent 70%
        );
        pointer-events: none;
      }

      .wishlist-empty-state .empty-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem;
        padding: 1rem;
        background: rgba(168, 85, 247, 0.1);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(168, 85, 247, 0.3);
      }

      .wishlist-empty-state .empty-icon svg {
        width: 32px;
        height: 32px;
        color: #a855f7;
        filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.4));
      }

      .wishlist-empty-state h4 {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 0.75rem 0;
        color: #e2e8f0;
        font-family: 'Orbitron', monospace;
        background: linear-gradient(135deg, #a855f7, #ec4899);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .wishlist-empty-state p {
        margin: 0;
        line-height: 1.6;
        font-size: 0.875rem;
        color: #94a3b8;
      }

      .creator-status {
        display: flex;
        gap: 1rem;
        margin-bottom: 1.5rem;
        align-items: center;
      }

      .creator-badge {
        padding: 0.5rem 1rem;
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
        border-radius: 20px;
        font-weight: 600;
        font-size: 0.875rem;
      }

      .schedule {
        color: #6b7280;
        font-size: 0.875rem;
      }

      .platforms-list {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .platform-pill {
        padding: 0.5rem 1rem;
        background: rgba(99, 102, 241, 0.2);
        color: #a5b4fc;
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 20px;
        font-size: 0.8125rem;
        font-weight: 600;
        transition: all 0.3s ease;
      }

      .platform-pill:hover {
        background: rgba(99, 102, 241, 0.3);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
      }

      /* ⁷⁵ Enhanced Search section styling */
      .search-section {
        margin-bottom: 2rem;
        padding: 1.5rem;
        background: linear-gradient(
          135deg,
          rgba(30, 41, 59, 0.6) 0%,
          rgba(99, 102, 241, 0.1) 100%
        );
        border-radius: 16px;
        border: 1px solid rgba(99, 102, 241, 0.3);
        backdrop-filter: blur(15px);
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.05);
        position: relative;
        overflow: hidden;
      }

      .search-section::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, transparent, #6366f1, transparent);
        opacity: 0.6;
      }

      .search-header {
        margin-bottom: 1rem;
        text-align: center;
      }

      .search-title {
        font-size: 1.125rem;
        font-weight: 700;
        margin: 0 0 0.5rem 0;
        color: #e2e8f0;
        font-family: 'Orbitron', monospace;
        background: linear-gradient(135deg, #6366f1, #a855f7);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }

      .search-title-icon {
        width: 20px;
        height: 20px;
        color: #6366f1;
        filter: drop-shadow(0 0 8px rgba(99, 102, 241, 0.4));
      }

      .search-scope-info {
        font-size: 0.8125rem;
        color: #94a3b8;
        font-weight: 500;
        padding: 0.375rem 0.75rem;
        background: rgba(99, 102, 241, 0.1);
        border: 1px solid rgba(99, 102, 241, 0.2);
        border-radius: 12px;
        display: inline-block;
        backdrop-filter: blur(10px);
      }

      .search-input-container {
        position: relative;
        display: flex;
        align-items: center;
      }

      .search-input-container label {
        width: 100%;
      }

      .search-icon {
        position: absolute;
        left: 1rem;
        width: 18px;
        height: 18px;
        color: #94a3b8;
        z-index: 1;
      }

      .search-input {
        width: 100%;
        padding: 0.875rem 1rem 0.875rem 2.75rem;
        background: rgba(30, 41, 59, 0.8);
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 12px;
        color: #e2e8f0;
        font-size: 0.875rem;
        font-weight: 500;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
        font-family: 'Inter', sans-serif;
      }

      .search-input::placeholder {
        color: #94a3b8;
      }

      .search-input:focus {
        outline: none;
        border-color: #6366f1;
        box-shadow:
          0 0 0 3px rgba(99, 102, 241, 0.1),
          0 0 20px rgba(99, 102, 241, 0.2);
        background: rgba(30, 41, 59, 0.95);
      }

      .clear-search-btn {
        position: absolute;
        right: 0.5rem;
        width: 32px;
        height: 32px;
        padding: 0;
        background: rgba(99, 102, 241, 0.2);
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 8px;
        color: #a5b4fc;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2;
      }

      .clear-search-btn:hover {
        background: rgba(99, 102, 241, 0.3);
        border-color: #6366f1;
        color: #e2e8f0;
        transform: scale(1.05);
      }

      .clear-search-btn svg {
        width: 14px;
        height: 14px;
      }

      .active-search-indicator {
        padding: 0.875rem;
        background: rgba(99, 102, 241, 0.1);
        border: 1px solid rgba(99, 102, 241, 0.2);
        border-radius: 12px;
        backdrop-filter: blur(10px);
        margin-top: 0.75rem;
      }

      .search-status {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        margin-bottom: 0.375rem;
      }

      .search-active-icon {
        width: 16px;
        height: 16px;
        color: #6366f1;
        animation: pulse 2s infinite;
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

      .search-label {
        color: #94a3b8;
        font-weight: 500;
      }

      .search-term {
        color: #a855f7;
        font-weight: 600;
        background: rgba(168, 85, 247, 0.1);
        padding: 0.125rem 0.375rem;
        border-radius: 6px;
        border: 1px solid rgba(168, 85, 247, 0.2);
      }

      .search-help {
        font-size: 0.75rem;
        color: #64748b;
        font-style: italic;
      }

      .search-tips {
        padding: 0.875rem;
        background: rgba(6, 182, 212, 0.05);
        border: 1px solid rgba(6, 182, 212, 0.1);
        border-radius: 12px;
        margin-top: 0.75rem;
      }

      .tip-header {
        font-size: 0.8125rem;
        font-weight: 600;
        color: #06b6d4;
        margin-bottom: 0.5rem;
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }

      .tips-list {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .tip {
        font-size: 0.75rem;
        color: #0891b2;
        background: rgba(6, 182, 212, 0.1);
        padding: 0.25rem 0.5rem;
        border-radius: 8px;
        border: 1px solid rgba(6, 182, 212, 0.2);
        font-weight: 500;
      }

      /* ⁷⁶ No search results styling */
      .no-search-results {
        text-align: center;
        padding: 3rem 2rem;
        background: rgba(30, 41, 59, 0.4);
        border-radius: 16px;
        border: 2px dashed rgba(99, 102, 241, 0.3);
        position: relative;
        overflow: hidden;
      }

      .no-search-results.wishlist-no-results {
        border-color: rgba(168, 85, 247, 0.3);
        background: rgba(168, 85, 247, 0.05);
      }

      .no-search-results::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 200px;
        height: 200px;
        background: radial-gradient(
          circle,
          rgba(99, 102, 241, 0.05) 0%,
          transparent 70%
        );
        pointer-events: none;
      }

      .wishlist-no-results::before {
        background: radial-gradient(
          circle,
          rgba(168, 85, 247, 0.05) 0%,
          transparent 70%
        );
      }

      .no-results-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem;
        padding: 1rem;
        background: rgba(99, 102, 241, 0.1);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(99, 102, 241, 0.3);
      }

      .wishlist-no-results .no-results-icon {
        background: rgba(168, 85, 247, 0.1);
        border-color: rgba(168, 85, 247, 0.3);
      }

      .no-results-icon svg {
        width: 32px;
        height: 32px;
        color: #6366f1;
        filter: drop-shadow(0 0 8px rgba(99, 102, 241, 0.4));
      }

      .wishlist-no-results .no-results-icon svg {
        color: #a855f7;
        filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.4));
      }

      .no-search-results h3,
      .no-search-results h4 {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 0.75rem 0;
        color: #e2e8f0;
        font-family: 'Orbitron', monospace;
        background: linear-gradient(135deg, #6366f1, #a855f7);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .wishlist-no-results h4 {
        background: linear-gradient(135deg, #a855f7, #ec4899);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .no-search-results p {
        margin: 0 0 1.5rem 0;
        line-height: 1.6;
        font-size: 0.875rem;
        color: #94a3b8;
      }

      .clear-search-suggestion {
        padding: 0.625rem 1.25rem;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: white;
        border: none;
        border-radius: 12px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
      }

      .clear-search-suggestion:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
      }

      /* ⁷⁷ Search loading and results styling */
      .search-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 2rem;
        background: rgba(30, 41, 59, 0.4);
        border-radius: 12px;
        border: 1px solid rgba(99, 102, 241, 0.2);
        color: #94a3b8;
        font-size: 0.875rem;
        font-weight: 500;
      }

      .loading-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid rgba(99, 102, 241, 0.2);
        border-top: 2px solid #6366f1;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .search-results-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
        padding: 0.75rem 1rem;
        background: rgba(99, 102, 241, 0.1);
        border-radius: 8px;
        border: 1px solid rgba(99, 102, 241, 0.2);
        font-size: 0.8125rem;
      }

      .search-results-header .results-count {
        color: #6366f1;
        font-weight: 600;
      }

      .search-results-header .search-query {
        color: #a855f7;
        font-weight: 600;
      }

      .error-card {
        padding: 1rem;
        background: rgba(248, 113, 113, 0.1);
        border: 1px solid rgba(248, 113, 113, 0.3);
        border-radius: 8px;
        color: #f87171;
        font-size: 0.8125rem;
        font-weight: 500;
        margin-bottom: 0.75rem;
      }

      /* ⁷⁸ Search wrapper spacing adjustments */
      .game-progress-wrapper {
        margin-bottom: 0.75rem;
      }

      .game-progress-wrapper:last-child {
        margin-bottom: 0;
      }

      /* Mobile search optimizations */
      @media (max-width: 768px) {
        .search-section {
          padding: 1rem;
          margin-bottom: 1.5rem;
        }

        .search-input {
          padding: 0.75rem 1rem 0.75rem 2.5rem;
          font-size: 0.8125rem;
        }

        .search-icon {
          left: 0.75rem;
          width: 16px;
          height: 16px;
        }

        .clear-search-btn {
          width: 28px;
          height: 28px;
        }

        .clear-search-btn svg {
          width: 12px;
          height: 12px;
        }

        .no-search-results {
          padding: 2rem 1rem;
        }

        .no-results-icon {
          width: 48px;
          height: 48px;
          padding: 0.75rem;
        }

        .no-results-icon svg {
          width: 24px;
          height: 24px;
        }
      }

      /* Enhanced Gaming Network Section */
      .network-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
        flex-wrap: wrap;
        gap: 1rem;
      }

      .network-stats {
        display: flex;
        gap: 1.5rem;
      }

      .network-stat {
        text-align: center;
        padding: 0.75rem 1rem;
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid rgba(6, 182, 212, 0.3);
        border-radius: 12px;
        backdrop-filter: blur(10px);
        min-width: 80px;
      }

      .network-stat .stat-number {
        display: block;
        font-size: 1.25rem;
        font-weight: 800;
        color: #06b6d4;
        font-family: 'Orbitron', monospace;
        line-height: 1;
      }

      .network-stat .stat-text {
        font-size: 0.75rem;
        color: #94a3b8;
        font-weight: 500;
        margin-top: 0.25rem;
      }

      .subsection-title {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 1.5rem 0;
        color: #e2e8f0;
        font-family: 'Orbitron', monospace;
        background: linear-gradient(135deg, #06b6d4, #3b82f6);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .subsection-title svg {
        width: 20px;
        height: 20px;
        color: #06b6d4;
      }

      .friends-grid-container {
        margin-bottom: 2.5rem;
      }

      .friends-empty-state {
        text-align: center;
        padding: 3rem 2rem;
        background: rgba(30, 41, 59, 0.4);
        border-radius: 16px;
        border: 2px dashed rgba(6, 182, 212, 0.3);
        position: relative;
        overflow: hidden;
        margin-bottom: 2rem;
      }

      .friends-empty-state::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 300px;
        height: 300px;
        background: radial-gradient(
          circle,
          rgba(6, 182, 212, 0.05) 0%,
          transparent 70%
        );
        pointer-events: none;
      }

      .friends-empty-state .empty-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem;
        padding: 1rem;
        background: rgba(6, 182, 212, 0.1);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(6, 182, 212, 0.3);
      }

      .friends-empty-state .empty-icon svg {
        width: 32px;
        height: 32px;
        color: #06b6d4;
        filter: drop-shadow(0 0 8px rgba(6, 182, 212, 0.4));
      }

      .friends-empty-state h4 {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 0.75rem 0;
        color: #e2e8f0;
        font-family: 'Orbitron', monospace;
        background: linear-gradient(135deg, #06b6d4, #3b82f6);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .groups-section {
        padding: 2rem;
        background: rgba(30, 41, 59, 0.3);
        border-radius: 16px;
        border: 1px solid rgba(6, 182, 212, 0.2);
        backdrop-filter: blur(10px);
      }

      .groups-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
      }

      .group-card {
        padding: 1.5rem;
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid rgba(6, 182, 212, 0.3);
        border-radius: 12px;
        text-align: center;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
        position: relative;
        overflow: hidden;
      }

      .group-card:hover {
        transform: translateY(-2px);
        border-color: #06b6d4;
        box-shadow: 0 8px 25px rgba(6, 182, 212, 0.2);
      }

      .group-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(6, 182, 212, 0.1),
          transparent
        );
        transition: left 0.5s ease;
      }

      .group-card:hover::before {
        left: 100%;
      }

      .group-icon {
        width: 48px;
        height: 48px;
        margin: 0 auto 1rem;
        padding: 0.75rem;
        background: rgba(6, 182, 212, 0.1);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(6, 182, 212, 0.3);
      }

      .group-icon svg {
        width: 24px;
        height: 24px;
        color: #06b6d4;
      }

      .group-name {
        font-size: 1rem;
        font-weight: 600;
        color: #e2e8f0;
        margin-bottom: 0.5rem;
        font-family: 'Orbitron', monospace;
      }

      .group-type {
        font-size: 0.75rem;
        color: #94a3b8;
        font-weight: 500;
        opacity: 0.8;
      }

      /* Empty state styling - gaming themed */
      .empty-state {
        text-align: center;
        padding: 3rem 2rem;
        color: #94a3b8;
        background: rgba(30, 41, 59, 0.3);
        border-radius: 16px;
        border: 2px dashed rgba(99, 102, 241, 0.3);
        position: relative;
        overflow: hidden;
      }

      .empty-state::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 200px;
        height: 200px;
        background: radial-gradient(
          circle,
          rgba(99, 102, 241, 0.05) 0%,
          transparent 70%
        );
        pointer-events: none;
      }

      .empty-state h3 {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 0.75rem 0;
        color: #cbd5e1;
        font-family: 'Orbitron', monospace;
      }

      .empty-state p {
        margin: 0;
        line-height: 1.6;
        font-size: 0.875rem;
        opacity: 0.8;
      }

      /* Enhanced responsive adjustments */
      @media (max-width: 640px) {
        .profile-section {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .quick-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          width: 100%;
          max-width: 300px;
          margin: 0 auto;
        }

        .stat-card {
          min-width: 70px;
        }

        .stat-number {
          font-size: 1.25rem;
        }
      }

      /* Tablet optimizations */
      @media (min-width: 768px) and (max-width: 1023px) {
        .gaming-hub-mat {
          max-width: 50rem;
          padding: 1.5rem;
        }

        .hub-header {
          grid-template-columns: 1fr;
          text-align: center;
          gap: 1.5rem;
        }

        .quick-stats {
          justify-content: center;
          max-width: 400px;
          margin: 0 auto;
        }

        .hub-navigation {
          justify-content: center;
        }

        .overview-grid {
          grid-template-columns: 1fr 1fr;
          grid-template-areas:
            'stats platforms'
            'current current';
          gap: 1.25rem;
        }
      }

      /* Laptop optimizations */
      @media (min-width: 1024px) and (max-width: 1439px) {
        .gaming-hub-mat {
          max-width: 60rem;
          padding: 2rem 1.5rem;
        }

        .hub-header {
          grid-template-columns: 1fr auto;
          gap: 2rem;
          padding: 1.5rem;
        }

        .quick-stats {
          justify-content: flex-end;
          max-width: none;
          margin: 0;
        }

        .overview-grid {
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          grid-template-areas: 'stats platforms current';
          gap: 1.5rem;
        }

        .hub-navigation {
          justify-content: flex-start;
          padding: 0.75rem;
        }

        .nav-tab {
          padding: 0.75rem 1.25rem;
          font-size: 0.875rem;
        }
      }

      /* Large screen optimizations */
      @media (min-width: 1440px) {
        .gaming-hub-mat {
          max-width: 80rem;
        }

        .hub-header {
          padding: 2.5rem;
        }

        .overview-grid {
          gap: 2rem;
        }
      }

      /* Touch device optimizations */
      @media (hover: none) and (pointer: coarse) {
        .nav-tab {
          min-height: 48px;
          padding: 0.875rem 1rem;
        }

        .stat-card {
          min-height: 80px;
          touch-action: manipulation;
        }

        .platform-card,
        .game-entry,
        .tournament-card {
          touch-action: manipulation;
        }

        /* Remove hover effects on touch devices */
        .nav-tab:hover,
        .stat-card:hover,
        .platform-card:hover,
        .game-entry:hover,
        .tournament-card:hover {
          transform: none;
        }

        /* Add active states for touch feedback */
        .nav-tab:active,
        .stat-card:active {
          transform: scale(0.98);
          transition: transform 0.1s ease;
        }
      }

      /* High DPI displays */
      @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
        .gamer-tag,
        .section-header {
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
      }

      /* Platform cards for manual iteration */
      .platforms-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .platform-card {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem;
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 12px;
        transition: all 0.3s ease;
      }

      .platform-card:hover {
        border-color: #6366f1;
        transform: translateX(4px);
      }

      .platform-icon {
        font-size: 1.5rem;
      }

      .platform-info {
        flex: 1;
      }

      .platform-name {
        font-weight: 600;
        color: #e2e8f0;
        font-size: 0.9375rem;
      }

      .platform-type {
        font-size: 0.75rem;
        color: #94a3b8;
        margin-top: 0.25rem;
      }

      /* Wishlist game cards */
      .wishlist-game-card {
        padding: 1rem;
        background: rgba(168, 85, 247, 0.1);
        border: 1px solid rgba(168, 85, 247, 0.3);
        border-radius: 12px;
        transition: all 0.3s ease;
      }

      .wishlist-game-card:hover {
        border-color: #a855f7;
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(168, 85, 247, 0.2);
      }

      .wishlist-game-card .game-title {
        font-weight: 700;
        color: #e2e8f0;
        font-size: 1rem;
        margin-bottom: 0.5rem;
      }

      .wishlist-game-card .game-genre {
        font-size: 0.75rem;
        color: #c084fc;
        background: rgba(168, 85, 247, 0.2);
        padding: 0.25rem 0.5rem;
        border-radius: 8px;
        display: inline-block;
        margin-right: 0.5rem;
      }

      .wishlist-game-card .game-year {
        font-size: 0.75rem;
        color: #94a3b8;
        display: inline-block;
      }

      /* Tournament cards */
      .tournaments-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1rem;
      }

      .tournament-card {
        padding: 1.25rem;
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.3);
        border-radius: 12px;
        transition: all 0.3s ease;
      }

      .tournament-card:hover {
        border-color: #f59e0b;
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(245, 158, 11, 0.2);
      }

      .tournament-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
      }

      .tournament-icon {
        font-size: 1.5rem;
      }

      .tournament-title {
        font-weight: 700;
        color: #e2e8f0;
        font-size: 1rem;
      }

      .tournament-game {
        font-size: 0.8125rem;
        color: #fbbf24;
        margin-bottom: 0.5rem;
      }

      .tournament-status {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: capitalize;
      }

      .tournament-status.status-upcoming {
        background: rgba(6, 182, 212, 0.2);
        color: #06b6d4;
      }

      .tournament-status.status-active {
        background: rgba(34, 197, 94, 0.2);
        color: #22c55e;
      }

      .tournament-status.status-completed {
        background: rgba(99, 102, 241, 0.2);
        color: #6366f1;
      }

      /* Friend cards */
      .friend-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        background: rgba(6, 182, 212, 0.1);
        border: 1px solid rgba(6, 182, 212, 0.3);
        border-radius: 12px;
        transition: all 0.3s ease;
      }

      .friend-card:hover {
        border-color: #06b6d4;
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(6, 182, 212, 0.2);
      }

      .friend-avatar {
        position: relative;
        width: 48px;
        height: 48px;
        flex-shrink: 0;
      }

      .friend-avatar .avatar-img {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid rgba(6, 182, 212, 0.4);
      }

      .friend-avatar .avatar-placeholder {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: rgba(30, 41, 59, 0.8);
        border: 2px solid rgba(6, 182, 212, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #06b6d4;
      }

      .friend-avatar .avatar-placeholder svg {
        width: 24px;
        height: 24px;
      }

      .friend-avatar .online-indicator {
        position: absolute;
        bottom: 2px;
        right: 2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid rgba(15, 23, 42, 0.9);
      }

      .friend-avatar .online-indicator.online {
        background: #00ff88;
        box-shadow: 0 0 8px rgba(0, 255, 136, 0.5);
      }

      .friend-avatar .online-indicator.offline {
        background: #64748b;
      }

      .friend-info {
        flex: 1;
        min-width: 0;
      }

      .friend-name {
        font-weight: 700;
        color: #e2e8f0;
        font-size: 0.9375rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .friend-status {
        font-size: 0.75rem;
        color: #94a3b8;
        margin-top: 0.25rem;
      }

      .friend-location {
        font-size: 0.6875rem;
        color: #06b6d4;
        margin-top: 0.25rem;
      }
    </style>
  </template>
}

export class GamingHub extends CardDef {
  static displayName = 'Gaming Hub';
  static icon = GamepadIcon;
  static prefersWideFormat = true;

  // Link to the player - all profile data comes from here
  @field player = linksTo(() => GamingPlayer);

  // Computed title from player
  @field cardTitle = contains(StringField, {
    computeVia: function (this: GamingHub) {
      try {
        const gamerTag = this.player?.gamerTag ?? 'Gaming Hub';
        const onlineStatus = this.player?.isOnline ? ' 🟢' : '';
        return `${gamerTag}${onlineStatus}`;
      } catch (e) {
        console.error('GamingHub: Error computing title', e);
        return 'Gaming Hub';
      }
    },
  });

  static isolated = Isolated;

  // Embedded format - delegates to GamingPlayer
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if @model.player}}
        <@fields.player @format='embedded' />
      {{else}}
        <div class='empty-hub'>
          <span class='empty-icon'>🎮</span>
          <span class='empty-text'>No player linked</span>
        </div>
      {{/if}}

      <style scoped>
        .empty-hub {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 1rem;
          background: rgba(30, 41, 59, 0.6);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 12px;
          color: #94a3b8;
        }

        .empty-icon {
          font-size: 1.25rem;
        }

        .empty-text {
          font-size: 0.875rem;
          font-weight: 500;
        }
      </style>
    </template>
  };

  // Fitted format - delegates to GamingPlayer
  static fitted = class Fitted extends Component<typeof this> {
    <template>
      {{#if @model.player}}
        <@fields.player @format='fitted' />
      {{else}}
        <div class='empty-fitted'>🎮</div>
      {{/if}}

      <style scoped>
        .empty-fitted {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(30, 41, 59, 0.6);
          border-radius: 8px;
          font-size: 1.5rem;
          color: #94a3b8;
        }
      </style>
    </template>
  };
}
