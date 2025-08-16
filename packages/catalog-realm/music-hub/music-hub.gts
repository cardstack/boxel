import { fn } from '@ember/helper';
import {
  CardDef,
  field,
  contains,
  linksTo,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Button } from '@cardstack/boxel-ui/components';
import { eq, gt } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import MusicIcon from '@cardstack/boxel-icons/music';
import { htmlSafe } from '@ember/template';

import { Piano } from '../piano/piano';
import { MusicianLandingPage } from '../musician-landing-page/musician-landing-page';
import { SongBuilderCard } from '../song-builder/song-builder';
import { MusicAlbumCard } from '../music-album/music-album';
import { ChordProgressionPlayerCard } from '../chord-progression/chord-progression';
import { BeatMakerCard } from '../beat-maker/beat-maker';
import { RecordingStudioCard } from '../recording-studio/recording-studio';
import { EventTicketCard } from '../event-ticket/event-ticket';
import { SongCard } from '../song/song';
import { PlaylistCard } from '../playlist/playlist';
import { MoodSelectorPlaylistCard } from '../mood-selector-playlist/mood-selector-playlist';

class MusicHubIsolated extends Component<typeof MusicHubCard> {
  // ³⁰ Main isolated format
  @tracked activeSection = 'discovery';

  @action
  switchSection(section: string) {
    this.activeSection = section;
  }

  <template>
    <div class='stage'>
      <div class='music-hub-mat'>
        <header class='hub-header'>
          <div class='header-content'>
            <div class='header-text'>
              <h1 class='hub-title'>{{if
                  @model.hubName
                  @model.hubName
                  'Music Hub'
                }}</h1>
              {{#if @model.description}}
                <p class='hub-description'>{{@model.description}}</p>
              {{else}}
                <p class='hub-description'>Discover, create, and connect with
                  music in an interactive space designed for artists and music
                  lovers.</p>
              {{/if}}
            </div>

            <div class='header-visual'>
              <div class='music-waves'>
                <div class='wave wave-1'></div>
                <div class='wave wave-2'></div>
                <div class='wave wave-3'></div>
                <div class='wave wave-4'></div>
                <div class='wave wave-5'></div>
              </div>
            </div>
          </div>
        </header>

        <nav class='hub-navigation'>
          <Button
            class='nav-tab
              {{if (eq this.activeSection "discovery") "active" ""}}'
            {{on 'click' (fn this.switchSection 'discovery')}}
          >
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='11' cy='11' r='8' />
              <path d='M21 21l-4.35-4.35' />
            </svg>
            Music Discovery
          </Button>

          <Button
            class='nav-tab
              {{if (eq this.activeSection "creation") "active" ""}}'
            {{on 'click' (fn this.switchSection 'creation')}}
          >
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
              <rect x='7' y='7' width='3' height='9' />
              <rect x='14' y='7' width='3' height='5' />
            </svg>
            Creation Tools
          </Button>

          <Button
            class='nav-tab {{if (eq this.activeSection "artists") "active" ""}}'
            {{on 'click' (fn this.switchSection 'artists')}}
          >
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
              <circle cx='12' cy='7' r='4' />
            </svg>
            Artists & Events
          </Button>
        </nav>

        {{#if (eq this.activeSection 'discovery')}}
          <section class='hub-section discovery-section'>
            <div class='section-header'>
              <h2>Music Discovery</h2>
              <p>Explore albums, playlists, and songs tailored to your taste</p>
            </div>

            {{#if @fields.moodSelector}}
              <@fields.moodSelector @format='embedded' />
            {{/if}}

            {{#if (gt @model.featuredAlbums.length 0)}}
              <div class='content-group'>
                <h3 class='group-title'>Featured Albums</h3>
                <div class='albums-grid'>
                  <@fields.featuredAlbums @format='embedded' />
                </div>
              </div>
            {{else}}
              <div class='content-group'>
                <h3 class='group-title'>Featured Albums</h3>
                <div class='empty-state'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='12' r='10' />
                    <circle cx='12' cy='12' r='3' />
                  </svg>
                  <p>No albums featured yet. Add some albums to get started!</p>
                </div>
              </div>
            {{/if}}

            {{#if (gt @model.featuredPlaylists.length 0)}}
              <div class='content-group'>
                <h3 class='group-title'>Curated Playlists</h3>
                <div class='playlists-grid'>
                  <@fields.featuredPlaylists @format='embedded' />
                </div>
              </div>
            {{else}}
              <div class='content-group'>
                <h3 class='group-title'>Curated Playlists</h3>
                <div class='empty-state'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                    <circle cx='9' cy='9' r='2' />
                    <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
                  </svg>
                  <p>No playlists available. Create or discover new playlists!</p>
                </div>
              </div>
            {{/if}}

            {{#if (gt @model.featuredSongs.length 0)}}
              <div class='content-group'>
                <h3 class='group-title'>Trending Songs</h3>
                <div class='songs-list'>
                  <@fields.featuredSongs @format='embedded' />
                </div>
              </div>
            {{else}}
              <div class='content-group'>
                <h3 class='group-title'>Trending Songs</h3>
                <div class='empty-state'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='12' r='10' />
                    <path
                      d='M9 9h0a3 3 0 0 1 5.12 0 2.44 2.44 0 0 1 0 3A3 3 0 0 0 12 16.5'
                    />
                    <circle cx='12' cy='19.5' r='.5' />
                  </svg>
                  <p>No trending songs yet. Discover new music to see
                    recommendations!</p>
                </div>
              </div>
            {{/if}}

          </section>
        {{/if}}

        {{#if (eq this.activeSection 'creation')}}
          <section class='hub-section creation-section'>
            <div class='section-header'>
              <h2>🎵 Creative Playground</h2>
              <p>Discover and experiment with music creation tools</p>
            </div>

            <div class='tools-grid'>
              {{#if @fields.beatMaker}}
                <div class='tool-card'>
                  <@fields.beatMaker
                    @format='fitted'
                    style={{htmlSafe 'width: 100%; height: 100%'}}
                  />
                </div>
              {{/if}}

              {{#if @fields.chordProgressionPlayer}}
                <div class='tool-card'>
                  <@fields.chordProgressionPlayer
                    @format='fitted'
                    style={{htmlSafe 'width: 100%; height: 100%'}}
                  />
                </div>
              {{/if}}

              {{#if @fields.creativeTool}}
                <div class='tool-card'>
                  <@fields.creativeTool
                    @format='fitted'
                    style={{htmlSafe 'width: 100%; height: 100%'}}
                  />
                </div>
              {{/if}}

              {{#if @fields.recordingStudio}}
                <div class='tool-card'>
                  <@fields.recordingStudio
                    @format='fitted'
                    style={{htmlSafe 'width: 100%; height: 100%'}}
                  />
                </div>
              {{/if}}

              {{#if @fields.songBuilder}}
                <div class='tool-card'>
                  <@fields.songBuilder
                    @format='fitted'
                    style={{htmlSafe 'width: 100%; height: 100%'}}
                  />
                </div>
              {{/if}}
            </div>
          </section>
        {{/if}}

        {{#if (eq this.activeSection 'artists')}}
          <section class='hub-section artists-section'>
            <div class='section-header'>
              <h2>Artists & Events</h2>
              <p>Connect with musicians and discover live music events</p>
            </div>

            {{#if (gt @model.featuredMusicians.length 0)}}
              <div class='content-group'>
                <h3 class='group-title'>Featured Musicians</h3>
                <div class='musicians-grid'>
                  <@fields.featuredMusicians @format='embedded' />
                </div>
              </div>
            {{else}}
              <div class='content-group'>
                <h3 class='group-title'>Featured Musicians</h3>
                <div class='empty-state'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                    <circle cx='12' cy='7' r='4' />
                  </svg>
                  <p>No featured musicians yet. Add some artists to showcase!</p>
                </div>
              </div>
            {{/if}}

            {{#if (gt @model.upcomingEvents.length 0)}}
              <div class='content-group'>
                <h3 class='group-title'>Upcoming Events</h3>
                <div class='events-grid'>
                  <@fields.upcomingEvents @format='embedded' />
                </div>
              </div>
            {{else}}
              <div class='content-group'>
                <h3 class='group-title'>Upcoming Events</h3>
                <div class='empty-state'>
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
                  <p>No upcoming events. Check back soon for concert
                    announcements!</p>
                </div>
              </div>
            {{/if}}
          </section>
        {{/if}}
      </div>
    </div>

    <style scoped>
      /* Clean Digital Studio Theme */
      .stage {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        padding: 0.5rem;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        position: relative;
      }

      @media (max-width: 800px) {
        .stage {
          padding: 0;
        }
      }

      .music-hub-mat {
        max-width: 75rem;
        width: 100%;
        background: rgba(248, 250, 252, 0.95);
        backdrop-filter: blur(12px);
        border-radius: 20px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        overflow-y: auto;
        max-height: 100%;
        font-family:
          'Inter',
          -apple-system,
          sans-serif;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      }

      @media (max-width: 800px) {
        .music-hub-mat {
          max-width: none;
          height: 100%;
          border-radius: 0;
          border: none;
        }
      }

      /* Header */
      .hub-header {
        background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
        color: white;
        padding: 3rem 2rem;
        border-radius: 20px 20px 0 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      @media (max-width: 800px) {
        .hub-header {
          padding: 2rem 1.5rem;
          border-radius: 0;
        }
      }

      .header-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        max-width: 1200px;
        margin: 0 auto;
      }

      @media (max-width: 768px) {
        .header-content {
          flex-direction: column;
          text-align: center;
          gap: 2rem;
        }
      }

      .header-text {
        flex: 1;
      }

      .hub-title {
        font-size: 3.5rem;
        font-weight: 900;
        margin: 0 0 1rem 0;
        line-height: 1.1;
        letter-spacing: -0.02em;
      }

      @media (max-width: 768px) {
        .hub-title {
          font-size: 2.5rem;
        }
      }

      .hub-description {
        font-size: 1.125rem;
        color: rgba(255, 255, 255, 0.9);
        margin: 0;
        line-height: 1.6;
        max-width: 600px;
      }

      .header-visual {
        margin-left: 2rem;
      }

      @media (max-width: 768px) {
        .header-visual {
          margin-left: 0;
        }
      }

      /* Audio Waves */
      .music-waves {
        display: flex;
        align-items: flex-end;
        gap: 6px;
        height: 80px;
        padding: 1rem;
        background: rgba(15, 23, 42, 0.7);
        backdrop-filter: blur(8px);
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .wave {
        width: 8px;
        background: linear-gradient(135deg, #22d3ee 0%, #84cc16 100%);
        border-radius: 4px;
        animation: wave-pulse 2s ease-in-out infinite;
      }

      .wave-1 {
        height: 25%;
        animation-delay: 0s;
      }
      .wave-2 {
        height: 60%;
        animation-delay: 0.1s;
      }
      .wave-3 {
        height: 100%;
        animation-delay: 0.2s;
      }
      .wave-4 {
        height: 80%;
        animation-delay: 0.3s;
      }
      .wave-5 {
        height: 40%;
        animation-delay: 0.4s;
      }

      @keyframes wave-pulse {
        0%,
        100% {
          transform: scaleY(1);
          opacity: 0.7;
        }
        50% {
          transform: scaleY(1.6);
          opacity: 1;
        }
      }

      /* Navigation */
      .hub-navigation {
        display: flex;
        gap: 0.5rem;
        padding: 1.5rem 2rem 0 2rem;
        background: rgba(248, 250, 252, 0.95);
        border-bottom: 1px solid rgba(226, 232, 240, 0.5);
      }

      @media (max-width: 800px) {
        .hub-navigation {
          padding: 1.5rem 1.5rem 0 1.5rem;
          overflow-x: auto;
        }
      }

      .nav-tab {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.875rem 1.75rem;
        border: none;
        background: rgba(255, 255, 255, 0.8);
        color: #64748b;
        font-size: 0.875rem;
        font-weight: 600;
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.3s ease;
        white-space: nowrap;
        border: 1px solid rgba(226, 232, 240, 0.5);
      }

      .nav-tab:hover {
        background: rgba(255, 255, 255, 1);
        color: #334155;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
      }

      .nav-tab.active {
        background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
        color: white;
        border-color: transparent;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
      }

      .nav-tab svg {
        width: 16px;
        height: 16px;
      }

      /* Sections */
      .hub-section {
        padding: 2.5rem 2rem;
      }

      @media (max-width: 800px) {
        .hub-section {
          padding: 2rem 1.5rem;
        }
      }

      .section-header {
        text-align: center;
        margin-bottom: 3rem;
      }

      .section-header h2 {
        font-size: 2.5rem;
        font-weight: 800;
        color: #0f172a;
        margin: 0 0 0.75rem 0;
        letter-spacing: -0.01em;
      }

      .section-header p {
        font-size: 1.125rem;
        color: #64748b;
        margin: 0;
        font-weight: 500;
      }

      /* Content Groups */
      .content-group {
        margin-bottom: 3.5rem;
      }

      .group-title {
        font-size: 1.75rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 2rem 0;
      }

      /* Grid Systems */
      .albums-grid > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 2rem;
      }

      .playlists-grid > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1.5rem;
      }

      .songs-list > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .musicians-grid > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
        gap: 2rem;
      }

      .events-grid > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
        gap: 2rem;
      }

      /* Clean Tools Grid */
      .tools-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 2rem;
        margin-bottom: 3rem;
      }

      .tool-card {
        height: 380px;
        border-radius: 16px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      }

      .tool-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        border-color: rgba(59, 130, 246, 0.3);
      }

      /* Mystery Tool Placeholder */
      .mystery-placeholder {
        background: rgba(15, 23, 42, 0.8);
        border-style: dashed;
        border-color: rgba(139, 92, 246, 0.5);
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mystery-content {
        text-align: center;
        color: white;
        padding: 2rem;
      }

      .mystery-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 1.5rem;
        color: #8b5cf6;
        opacity: 0.8;
      }

      .mystery-icon svg {
        width: 100%;
        height: 100%;
      }

      .mystery-placeholder h3 {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 0.75rem 0;
        color: white;
      }

      .mystery-placeholder p {
        font-size: 0.875rem;
        color: rgba(255, 255, 255, 0.7);
        margin: 0 0 2rem 0;
      }

      .sparkles {
        position: relative;
        height: 40px;
      }

      .sparkle {
        position: absolute;
        width: 8px;
        height: 8px;
        background: #8b5cf6;
        border-radius: 50%;
        animation: sparkle 2s ease-in-out infinite;
      }

      .sparkle:nth-child(1) {
        top: 10px;
        left: 20%;
        animation-delay: 0s;
      }
      .sparkle:nth-child(2) {
        top: 5px;
        left: 50%;
        animation-delay: 0.7s;
      }
      .sparkle:nth-child(3) {
        top: 15px;
        left: 80%;
        animation-delay: 1.4s;
      }

      @keyframes sparkle {
        0%,
        100% {
          opacity: 0.4;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.4);
        }
      }

      .tools-footer {
        text-align: center;
        padding: 2rem;
        background: rgba(255, 255, 255, 0.6);
        border-radius: 16px;
        border: 1px solid rgba(226, 232, 240, 0.3);
      }

      .tools-footer p {
        font-size: 0.875rem;
        color: #64748b;
        margin: 0;
        font-weight: 500;
      }

      .empty-state {
        text-align: center;
        padding: 4rem 2rem;
        background: rgba(255, 255, 255, 0.6);
        border-radius: 16px;
        border: 1px solid rgba(226, 232, 240, 0.3);
        color: #64748b;
      }

      .empty-state svg {
        width: 72px;
        height: 72px;
        margin: 0 auto 1.5rem auto;
        color: #cbd5e1;
        opacity: 0.7;
      }

      .empty-state p {
        font-size: 1rem;
        margin: 0;
        line-height: 1.6;
        font-weight: 500;
        max-width: 400px;
        margin: 0 auto;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .tool-explorer {
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }

        .tool-station {
          height: 320px;
        }

        .hub-title {
          font-size: 2.25rem;
        }

        .section-header h2 {
          font-size: 2rem;
        }

        .group-title {
          font-size: 1.5rem;
        }
      }

      @media (max-width: 480px) {
        .tool-station {
          height: 280px;
        }

        .station-icon {
          width: 48px;
          height: 48px;
          margin: 1.5rem auto 1rem;
        }

        .station-icon svg {
          width: 24px;
          height: 24px;
        }
      }
    </style>
  </template>
}

// ²⁹ Main Music Hub Card Definition
export class MusicHubCard extends CardDef {
  static displayName = 'Music Hub';
  static icon = MusicIcon;
  static prefersWideFormat = true;

  @field hubName = contains(StringField);
  @field description = contains(StringField);
  @field featuredAlbums = linksToMany(() => MusicAlbumCard);
  @field featuredPlaylists = linksToMany(() => PlaylistCard);
  @field featuredSongs = linksToMany(() => SongCard);
  @field creativeTool = linksTo(() => Piano); // ¹¹¹ Currently placeholder - piano not implemented
  @field beatMaker = linksTo(() => BeatMakerCard); // ¹¹² Fully functional beat maker
  @field recordingStudio = linksTo(() => RecordingStudioCard); // ¹¹³ Fully functional recording studio
  @field chordProgressionPlayer = linksTo(() => ChordProgressionPlayerCard); // ¹²⁴ Interactive chord progression explorer
  @field songBuilder = linksTo(() => SongBuilderCard); // ¹³⁸ AI-powered song composition tool
  @field featuredMusicians = linksToMany(() => MusicianLandingPage);
  @field upcomingEvents = linksToMany(() => EventTicketCard);
  @field moodSelector = linksTo(() => MoodSelectorPlaylistCard);

  @field title = contains(StringField, {
    computeVia: function (this: MusicHubCard) {
      try {
        return this.hubName ?? 'Music Hub';
      } catch (e) {
        console.error('MusicHubCard: Error computing title', e);
        return 'Music Hub';
      }
    },
  });

  static isolated = MusicHubIsolated;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='music-hub-embedded'>
        <header class='embedded-header'>
          <div class='header-content'>
            <div class='hub-info'>
              <h3 class='hub-name'>{{if
                  @model.hubName
                  @model.hubName
                  'Music Hub'
                }}</h3>
              <p class='hub-tagline'>{{if
                  @model.description
                  @model.description
                  'Your creative music platform'
                }}</p>
            </div>
            <div class='header-visual'>
              <div class='mini-waves'>
                <div class='mini-wave'></div>
                <div class='mini-wave'></div>
                <div class='mini-wave'></div>
              </div>
            </div>
          </div>
        </header>

        <div class='stats-grid'>
          <div class='stat-item'>
            <div class='stat-number'>{{@model.featuredAlbums.length}}</div>
            <div class='stat-label'>Albums</div>
          </div>
          <div class='stat-item'>
            <div class='stat-number'>{{@model.featuredPlaylists.length}}</div>
            <div class='stat-label'>Playlists</div>
          </div>
          <div class='stat-item'>
            <div class='stat-number'>{{@model.featuredSongs.length}}</div>
            <div class='stat-label'>Songs</div>
          </div>
          <div class='stat-item'>
            <div class='stat-number'>{{@model.featuredMusicians.length}}</div>
            <div class='stat-label'>Artists</div>
          </div>
        </div>

        <div class='tools-preview'>
          <div class='tools-header'>
            <h4>Active Tools</h4>
            <div class='tools-count'>{{if @fields.beatMaker '4' '3'}}
              available</div>
          </div>
          <div class='tool-badges'>
            {{#if @fields.beatMaker}}
              <div class='tool-badge active'>Beat Studio</div>
            {{/if}}
            {{#if @fields.chordProgressionPlayer}}
              <div class='tool-badge active'>Chord Explorer</div>
            {{/if}}
            {{#if @fields.creativeTool}}
              <div class='tool-badge active'>Piano Keys</div>
            {{/if}}
            {{#if @fields.recordingStudio}}
              <div class='tool-badge active'>Audio Recorder</div>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .music-hub-embedded {
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          border-radius: 16px;
          overflow: hidden;
          font-family:
            'Inter',
            -apple-system,
            sans-serif;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .embedded-header {
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          color: white;
          padding: 1.5rem;
        }

        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .hub-info {
          flex: 1;
        }

        .hub-name {
          font-size: 1.5rem;
          font-weight: 700;
          margin: 0 0 0.5rem 0;
          line-height: 1.2;
        }

        .hub-tagline {
          font-size: 0.875rem;
          color: rgba(255, 255, 255, 0.9);
          margin: 0;
          line-height: 1.4;
        }

        .mini-waves {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 32px;
          padding: 0.5rem;
          background: rgba(15, 23, 42, 0.7);
          backdrop-filter: blur(8px);
          border-radius: 8px;
        }

        .mini-wave {
          width: 4px;
          background: linear-gradient(135deg, #22d3ee 0%, #84cc16 100%);
          border-radius: 2px;
          animation: mini-wave-pulse 1.5s ease-in-out infinite;
        }

        .mini-wave:nth-child(1) {
          height: 40%;
          animation-delay: 0s;
        }
        .mini-wave:nth-child(2) {
          height: 80%;
          animation-delay: 0.2s;
        }
        .mini-wave:nth-child(3) {
          height: 60%;
          animation-delay: 0.4s;
        }

        @keyframes mini-wave-pulse {
          0%,
          100% {
            transform: scaleY(1);
            opacity: 0.7;
          }
          50% {
            transform: scaleY(1.4);
            opacity: 1;
          }
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1rem;
          padding: 1.5rem;
          background: rgba(248, 250, 252, 0.95);
        }

        .stat-item {
          text-align: center;
        }

        .stat-number {
          font-size: 1.5rem;
          font-weight: 700;
          color: #3b82f6;
          margin-bottom: 0.25rem;
          font-family: 'JetBrains Mono', monospace;
        }

        .stat-label {
          font-size: 0.75rem;
          color: #64748b;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .tools-preview {
          padding: 1.5rem;
          background: rgba(248, 250, 252, 0.95);
          border-top: 1px solid rgba(226, 232, 240, 0.3);
        }

        .tools-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
        }

        .tools-header h4 {
          font-size: 1rem;
          font-weight: 600;
          color: #1e293b;
          margin: 0;
        }

        .tools-count {
          font-size: 0.75rem;
          color: #10b981;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
        }

        .tool-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .tool-badge {
          padding: 0.375rem 0.75rem;
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          color: white;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .tool-badge.active {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='badge-content'>
            <div class='badge-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <circle cx='12' cy='12' r='3' />
              </svg>
            </div>
            <div class='badge-info'>
              <div class='badge-title'>{{if
                  @model.hubName
                  @model.hubName
                  'Music Hub'
                }}</div>
              <div class='badge-stats'>{{@model.featuredSongs.length}}
                songs •
                {{@model.featuredAlbums.length}}
                albums</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='strip-content'>
            <div class='strip-visual'>
              <div class='strip-waves'>
                <div class='strip-wave'></div>
                <div class='strip-wave'></div>
                <div class='strip-wave'></div>
              </div>
            </div>
            <div class='strip-info'>
              <div class='strip-title'>{{if
                  @model.hubName
                  @model.hubName
                  'Music Hub'
                }}</div>
              <div class='strip-description'>{{@model.featuredSongs.length}}
                songs •
                {{@model.featuredPlaylists.length}}
                playlists •
                {{@model.featuredMusicians.length}}
                artists</div>
            </div>
            <div class='strip-badge'>
              <div class='live-indicator'></div>
              LIVE
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-header'>
            <div class='tile-visual'>
              <div class='tile-waves'>
                <div class='tile-wave'></div>
                <div class='tile-wave'></div>
                <div class='tile-wave'></div>
                <div class='tile-wave'></div>
              </div>
            </div>
            <div class='tile-badge'>
              <div class='live-dot'></div>
              LIVE
            </div>
          </div>
          <div class='tile-content'>
            <h3 class='tile-title'>{{if
                @model.hubName
                @model.hubName
                'Music Hub'
              }}</h3>
            <div class='tile-stats'>
              <div class='stat-row'>
                <span class='stat-label'>Songs:</span>
                <span class='stat-value'>{{@model.featuredSongs.length}}</span>
              </div>
              <div class='stat-row'>
                <span class='stat-label'>Albums:</span>
                <span class='stat-value'>{{@model.featuredAlbums.length}}</span>
              </div>
              <div class='stat-row'>
                <span class='stat-label'>Artists:</span>
                <span
                  class='stat-value'
                >{{@model.featuredMusicians.length}}</span>
              </div>
            </div>
            <div class='tile-tools'>
              {{#if @fields.beatMaker}}<div
                  class='tool-indicator active'
                >Beat</div>{{/if}}
              {{#if @fields.chordProgressionPlayer}}<div
                  class='tool-indicator active'
                >Chord</div>{{/if}}
              {{#if @fields.creativeTool}}<div
                  class='tool-indicator active'
                >Piano</div>{{/if}}
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='card-header'>
            <div class='card-info'>
              <h3 class='card-title'>{{if
                  @model.hubName
                  @model.hubName
                  'Music Hub'
                }}</h3>
              <p class='card-description'>{{if
                  @model.description
                  @model.description
                  'Your creative music platform'
                }}</p>
            </div>
            <div class='card-visual'>
              <div class='card-waves'>
                <div class='card-wave'></div>
                <div class='card-wave'></div>
                <div class='card-wave'></div>
                <div class='card-wave'></div>
                <div class='card-wave'></div>
              </div>
            </div>
          </div>
          <div class='card-stats'>
            <div class='stats-row'>
              <div class='stat-group'>
                <div class='stat-number'>{{@model.featuredSongs.length}}</div>
                <div class='stat-label'>Songs</div>
              </div>
              <div class='stat-group'>
                <div class='stat-number'>{{@model.featuredAlbums.length}}</div>
                <div class='stat-label'>Albums</div>
              </div>
              <div class='stat-group'>
                <div
                  class='stat-number'
                >{{@model.featuredPlaylists.length}}</div>
                <div class='stat-label'>Playlists</div>
              </div>
              <div class='stat-group'>
                <div
                  class='stat-number'
                >{{@model.featuredMusicians.length}}</div>
                <div class='stat-label'>Artists</div>
              </div>
            </div>
          </div>
          <div class='card-tools'>
            <div class='tools-label'>Active Creation Tools:</div>
            <div class='tool-list'>
              {{#if @fields.beatMaker}}<div class='tool-tag'>Beat Maker</div>{{/if}}
              {{#if @fields.chordProgressionPlayer}}<div class='tool-tag'>Chord
                  Explorer</div>{{/if}}
              {{#if @fields.creativeTool}}<div class='tool-tag'>Piano Keys</div>{{/if}}
              {{#if @fields.recordingStudio}}<div class='tool-tag'>Audio
                  Recorder</div>{{/if}}
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family:
            'Inter',
            -apple-system,
            sans-serif;
        }

        /* Hide all by default */
        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          border-radius: 12px;
          overflow: hidden;
        }

        /* Badge Format (≤150px width, ≤169px height) */
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            align-items: center;
          }
        }

        .badge-content {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
        }

        .badge-icon {
          width: 24px;
          height: 24px;
          color: #22d3ee;
          flex-shrink: 0;
        }

        .badge-icon svg {
          width: 100%;
          height: 100%;
        }

        .badge-info {
          flex: 1;
          min-width: 0;
        }

        .badge-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: white;
          line-height: 1.2;
          margin-bottom: 0.125rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .badge-stats {
          font-size: 0.625rem;
          color: rgba(255, 255, 255, 0.7);
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Strip Format (151px-399px width, ≤169px height) */
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
          }
        }

        .strip-content {
          display: flex;
          align-items: center;
          gap: 1rem;
          width: 100%;
        }

        .strip-visual {
          flex-shrink: 0;
        }

        .strip-waves {
          display: flex;
          align-items: flex-end;
          gap: 2px;
          height: 24px;
          width: 32px;
        }

        .strip-wave {
          width: 3px;
          background: linear-gradient(135deg, #22d3ee 0%, #84cc16 100%);
          border-radius: 1.5px;
          animation: strip-wave-pulse 1.5s ease-in-out infinite;
        }

        .strip-wave:nth-child(1) {
          height: 40%;
          animation-delay: 0s;
        }
        .strip-wave:nth-child(2) {
          height: 80%;
          animation-delay: 0.2s;
        }
        .strip-wave:nth-child(3) {
          height: 60%;
          animation-delay: 0.4s;
        }

        @keyframes strip-wave-pulse {
          0%,
          100% {
            transform: scaleY(1);
            opacity: 0.7;
          }
          50% {
            transform: scaleY(1.4);
            opacity: 1;
          }
        }

        .strip-info {
          flex: 1;
          min-width: 0;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: white;
          line-height: 1.2;
          margin-bottom: 0.25rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-description {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-badge {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          background: rgba(16, 185, 129, 0.2);
          border: 1px solid #10b981;
          border-radius: 6px;
          font-size: 0.625rem;
          font-weight: 700;
          color: #10b981;
          font-family: 'JetBrains Mono', monospace;
          flex-shrink: 0;
        }

        .live-indicator {
          width: 6px;
          height: 6px;
          background: #10b981;
          border-radius: 50%;
          animation: live-pulse 2s ease-in-out infinite;
        }

        @keyframes live-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(1.2);
          }
        }

        /* Tile Format (≤399px width, ≥170px height) */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        .tile-header {
          position: relative;
          height: 60px;
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
        }

        .tile-waves {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 32px;
        }

        .tile-wave {
          width: 4px;
          background: rgba(255, 255, 255, 0.8);
          border-radius: 2px;
          animation: tile-wave-pulse 1.5s ease-in-out infinite;
        }

        .tile-wave:nth-child(1) {
          height: 40%;
          animation-delay: 0s;
        }
        .tile-wave:nth-child(2) {
          height: 80%;
          animation-delay: 0.2s;
        }
        .tile-wave:nth-child(3) {
          height: 60%;
          animation-delay: 0.4s;
        }
        .tile-wave:nth-child(4) {
          height: 70%;
          animation-delay: 0.6s;
        }

        @keyframes tile-wave-pulse {
          0%,
          100% {
            transform: scaleY(1);
            opacity: 0.7;
          }
          50% {
            transform: scaleY(1.4);
            opacity: 1;
          }
        }

        .tile-badge {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          background: rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(8px);
          border-radius: 6px;
          font-size: 0.625rem;
          font-weight: 700;
          color: white;
          font-family: 'JetBrains Mono', monospace;
        }

        .live-dot {
          width: 6px;
          height: 6px;
          background: #22d3ee;
          border-radius: 50%;
          animation: live-pulse 2s ease-in-out infinite;
        }

        .tile-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .tile-title {
          font-size: 1rem;
          font-weight: 700;
          color: white;
          margin: 0;
          line-height: 1.2;
        }

        .tile-stats {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .stat-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .stat-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
        }

        .stat-value {
          font-size: 0.875rem;
          color: #22d3ee;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
        }

        .tile-tools {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          margin-top: auto;
        }

        .tool-indicator {
          padding: 0.25rem 0.5rem;
          background: rgba(16, 185, 129, 0.2);
          border: 1px solid #10b981;
          color: #10b981;
          font-size: 0.625rem;
          font-weight: 600;
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
        }

        /* Card Format (≥400px width, ≥170px height) */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1rem;
        }

        .card-info {
          flex: 1;
        }

        .card-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: white;
          margin: 0 0 0.5rem 0;
          line-height: 1.2;
        }

        .card-description {
          font-size: 0.875rem;
          color: rgba(255, 255, 255, 0.9);
          margin: 0;
          line-height: 1.4;
        }

        .card-waves {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 40px;
          padding: 0.5rem;
          background: rgba(15, 23, 42, 0.7);
          backdrop-filter: blur(8px);
          border-radius: 8px;
        }

        .card-wave {
          width: 4px;
          background: linear-gradient(135deg, #22d3ee 0%, #84cc16 100%);
          border-radius: 2px;
          animation: card-wave-pulse 1.5s ease-in-out infinite;
        }

        .card-wave:nth-child(1) {
          height: 30%;
          animation-delay: 0s;
        }
        .card-wave:nth-child(2) {
          height: 70%;
          animation-delay: 0.2s;
        }
        .card-wave:nth-child(3) {
          height: 100%;
          animation-delay: 0.4s;
        }
        .card-wave:nth-child(4) {
          height: 80%;
          animation-delay: 0.6s;
        }
        .card-wave:nth-child(5) {
          height: 50%;
          animation-delay: 0.8s;
        }

        @keyframes card-wave-pulse {
          0%,
          100% {
            transform: scaleY(1);
            opacity: 0.7;
          }
          50% {
            transform: scaleY(1.4);
            opacity: 1;
          }
        }

        .card-stats {
          background: rgba(248, 250, 252, 0.1);
          border-radius: 8px;
          padding: 1rem;
          margin-bottom: 1rem;
        }

        .stats-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1rem;
        }

        .stat-group {
          text-align: center;
        }

        .stat-number {
          font-size: 1.5rem;
          font-weight: 700;
          color: #22d3ee;
          margin-bottom: 0.25rem;
          font-family: 'JetBrains Mono', monospace;
        }

        .stat-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .card-tools {
          margin-top: auto;
        }

        .tools-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 600;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .tool-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .tool-tag {
          padding: 0.375rem 0.75rem;
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      </style>
    </template>
  };
}
