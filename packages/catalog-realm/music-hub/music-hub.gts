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
        <!-- Hero Header -->
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

        <!-- Navigation Tabs -->
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

        <!-- Music Discovery Section -->
        {{#if (eq this.activeSection 'discovery')}}
          <section class='hub-section discovery-section'>
            <div class='section-header'>
              <h2>Music Discovery</h2>
              <p>Explore albums, playlists, and songs tailored to your taste</p>
            </div>

            <!-- Featured Albums -->
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

            <!-- Featured Playlists -->
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

            <!-- Featured Songs -->
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

            <!-- Interactive Mood Selector -->
            {{#if @fields.moodSelector}}
              <div class='content-group mood-selector-section'>
                <h3 class='group-title'>Find Music for Your Mood</h3>
                <@fields.moodSelector @format='embedded' />
              </div>
            {{/if}}
          </section>
        {{/if}}

        <!-- Creation Tools Section -->
        {{#if (eq this.activeSection 'creation')}}
          <section class='hub-section creation-section'>
            <div class='section-header'>
              <h2>🎵 Creative Playground</h2>
              <p>Discover and experiment with music creation tools</p>
            </div>

            <!-- Compact Tool Explorer -->
            <div class='tool-explorer'>
              <!-- Beat Making Station -->
              {{#if @fields.beatMaker}}
                <div class='tool-station beat-station active'>
                  <div class='station-badge'>
                    <div class='status-dot active'></div>
                    LIVE
                  </div>
                  <div class='station-icon'>
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
                  </div>
                  <h3>Beat Maker</h3>
                  <p>16-step sequencer with dynamic kits</p>
                  <div class='tool-preview'>
                    <@fields.beatMaker
                      @format='fitted'
                      style='width: 100%; height: 100%'
                    />
                  </div>
                </div>
              {{/if}}

              <!-- Harmony Station -->
              {{#if @fields.chordProgressionPlayer}}
                <div class='tool-station harmony-station active'>
                  <div class='station-badge'>
                    <div class='status-dot active'></div>
                    LIVE
                  </div>
                  <div class='station-icon'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <polyline points='22,12 18,12 15,21 9,3 6,12 2,12' />
                    </svg>
                  </div>
                  <h3>Chord Explorer</h3>
                  <p>Learn harmony & progressions</p>
                  <div class='tool-preview'>
                    <@fields.chordProgressionPlayer
                      @format='fitted'
                      style='width: 100%; height: 100%'
                    />
                  </div>
                </div>
              {{/if}}

              <!-- Piano Station -->
              {{#if @fields.creativeTool}}
                <div class='tool-station piano-station active'>
                  <div class='station-badge'>
                    <div class='status-dot active'></div>
                    LIVE
                  </div>
                  <div class='station-icon'>
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
                  <h3>Piano Keys</h3>
                  <p>Virtual piano interface</p>
                  <div class='tool-preview'>
                    <@fields.creativeTool
                      @format='fitted'
                      style='width: 100%; height: 100%'
                    />
                  </div>
                </div>
              {{/if}}

              <!-- Recording Station -->
              <div class='tool-station recording-station active'>
                <div class='station-badge'>
                  <div class='status-dot active'></div>
                  READY
                </div>
                <div class='station-icon'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z'
                    />
                    <path d='M19 10v2a7 7 0 0 1-14 0v-2' />
                    <line x1='12' y1='19' x2='12' y2='23' />
                    <line x1='8' y1='23' x2='16' y2='23' />
                  </svg>
                </div>
                <h3>Audio Recorder</h3>
                <p>Capture ideas & record audio</p>
                <div class='tool-preview'>
                  <@fields.recordingStudio
                    @format='fitted'
                    style='width: 100%; height: 100%'
                  />
                </div>
              </div>

              <!-- Song Builder Station -->
              {{#if @fields.songBuilder}}
                <div class='tool-station composer-station active'>
                  <div class='station-badge'>
                    <div class='status-dot active'></div>
                    LIVE
                  </div>
                  <div class='station-icon'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M9 18V5l12-2v13' />
                      <circle cx='6' cy='18' r='3' />
                      <circle cx='18' cy='16' r='3' />
                    </svg>
                  </div>
                  <h3>Song Builder</h3>
                  <p>AI-powered composition</p>
                  <div class='tool-preview'>
                    <@fields.songBuilder
                      @format='fitted'
                      style='width: 100%; height: 100%'
                    />
                  </div>
                </div>
              {{else}}
                <div class='tool-station composer-station coming-soon'>
                  <div class='station-badge'>
                    <div class='status-dot'></div>
                    BUILD
                  </div>
                  <div class='station-icon'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M9 18V5l12-2v13' />
                      <circle cx='6' cy='18' r='3' />
                      <circle cx='18' cy='16' r='3' />
                    </svg>
                  </div>
                  <h3>Song Builder</h3>
                  <p>Compose full tracks</p>
                  <div class='coming-soon-overlay'>Coming Soon</div>
                </div>
              {{/if}}

              <!-- Mystery Station -->
              <div class='tool-station mystery-station locked'>
                <div class='station-badge'>
                  <div class='status-dot mystery'></div>
                  ???
                </div>
                <div class='station-icon'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='12' r='10' />
                    <path
                      d='M9,9h0a3,3,0,0,1,5.12,0,2.44,2.44,0,0,1,0,3A3,3,0,0,0,12,16.5'
                    />
                    <circle cx='12' cy='19.5' r='.5' />
                  </svg>
                </div>
                <h3>Mystery Tool</h3>
                <p>What could this be...?</p>
                <div class='mystery-overlay'>
                  <div class='mystery-sparkles'>
                    <div class='sparkle'></div>
                    <div class='sparkle'></div>
                    <div class='sparkle'></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Exploration Encouragement -->
            <div class='exploration-footer'>
              <div class='exploration-text'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M21 16v-2a4 4 0 0 0-4-4H9l3-3m0 6l-3-3' />
                  <path d='M8 21c3 0 7-1 7-1s-4 1-7 1z' />
                </svg>
                <span>Click any station to start exploring • More tools coming
                  soon</span>
              </div>
            </div>
          </section>
        {{/if}}

        <!-- Artists & Events Section -->
        {{#if (eq this.activeSection 'artists')}}
          <section class='hub-section artists-section'>
            <div class='section-header'>
              <h2>Artists & Events</h2>
              <p>Connect with musicians and discover live music events</p>
            </div>

            <!-- Featured Musicians -->
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

            <!-- Upcoming Events -->
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
      /* ³¹ Music Hub main styles */
      .stage {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        padding: 0.5rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }

      @media (max-width: 800px) {
        .stage {
          padding: 0;
        }
      }

      .music-hub-mat {
        max-width: 75rem;
        width: 100%;
        background: #f8fafc;
        border-radius: 16px;
        overflow-y: auto;
        max-height: 100%;
        font-family:
          'Inter',
          -apple-system,
          sans-serif;
      }

      @media (max-width: 800px) {
        .music-hub-mat {
          max-width: none;
          height: 100%;
          border-radius: 0;
        }
      }

      /* Hero Header */
      .hub-header {
        background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
        color: white;
        padding: 3rem 2rem;
        border-radius: 16px 16px 0 0;
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
        font-size: 3rem;
        font-weight: 800;
        margin: 0 0 1rem 0;
        background: linear-gradient(135deg, #60a5fa, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        line-height: 1.1;
      }

      @media (max-width: 768px) {
        .hub-title {
          font-size: 2.25rem;
        }
      }

      .hub-description {
        font-size: 1.125rem;
        color: #cbd5e1;
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

      .music-waves {
        display: flex;
        align-items: flex-end;
        gap: 4px;
        height: 60px;
      }

      .wave {
        width: 6px;
        background: linear-gradient(to top, #3b82f6, #8b5cf6);
        border-radius: 3px;
        animation: wave-animation 1.5s ease-in-out infinite;
      }

      .wave-1 {
        height: 20%;
        animation-delay: 0s;
      }
      .wave-2 {
        height: 50%;
        animation-delay: 0.1s;
      }
      .wave-3 {
        height: 100%;
        animation-delay: 0.2s;
      }
      .wave-4 {
        height: 75%;
        animation-delay: 0.3s;
      }
      .wave-5 {
        height: 30%;
        animation-delay: 0.4s;
      }

      @keyframes wave-animation {
        0%,
        100% {
          transform: scaleY(1);
        }
        50% {
          transform: scaleY(1.8);
        }
      }

      /* Navigation */
      .hub-navigation {
        display: flex;
        gap: 0.5rem;
        padding: 1.5rem 2rem 0 2rem;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
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
        padding: 0.75rem 1.5rem;
        border: none;
        background: transparent;
        color: #64748b;
        font-size: 0.875rem;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
      }

      .nav-tab:hover {
        background: #e2e8f0;
        color: #334155;
      }

      .nav-tab.active {
        background: #3b82f6;
        color: white;
      }

      .nav-tab svg {
        width: 16px;
        height: 16px;
      }

      /* Sections */
      .hub-section {
        padding: 2rem;
      }

      @media (max-width: 800px) {
        .hub-section {
          padding: 1.5rem;
        }
      }

      .section-header {
        text-align: center;
        margin-bottom: 3rem;
      }

      .section-header h2 {
        font-size: 2.25rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 0.5rem 0;
      }

      .section-header p {
        font-size: 1.125rem;
        color: #64748b;
        margin: 0;
      }

      /* Content Groups */
      .content-group {
        margin-bottom: 3rem;
      }

      .group-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 1.5rem 0;
      }

      /* Grids and Lists */
      .albums-grid > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1.5rem;
      }

      .songs-list > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .musicians-grid > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 1.5rem;
      }

      .events-grid > .containsMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
        gap: 1.5rem;
      }

      /* Interactive Mood Selector */
      .mood-selector-section {
        margin-top: 2rem;
        padding-top: 2rem;
        border-top: 1px solid #e2e8f0;
      }

      .group-subtitle {
        font-size: 0.875rem;
        color: #64748b;
        margin: -1rem 0 2rem 0;
        text-align: center;
      }

      .mood-selector-container {
        background: white;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        border: 1px solid #e2e8f0;
        min-height: 500px;
      }

      /* Compact Tool Explorer Layout */
      .tool-explorer {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
      }

      .tool-station {
        background: white;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        border: 2px solid #e5e7eb;
        transition: all 0.3s ease;
        position: relative;
        height: 320px;
        display: flex;
        flex-direction: column;
      }

      .tool-station:hover {
        transform: translateY(-3px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      }

      .tool-station.active {
        border-color: #10b981;
        background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%);
      }

      .tool-station.active:hover {
        box-shadow: 0 8px 24px rgba(16, 185, 129, 0.2);
        border-color: #059669;
      }

      .tool-station.coming-soon {
        opacity: 0.7;
        border-color: #d1d5db;
      }

      .tool-station.locked {
        background: linear-gradient(135deg, #f3f4f6 0%, #f1f5f9 100%);
        border-color: #9ca3af;
        border-style: dashed;
        opacity: 0.8;
      }

      /* Station Header */
      .station-badge {
        position: absolute;
        top: 1rem;
        right: 1rem;
        background: rgba(255, 255, 255, 0.95);
        padding: 0.25rem 0.75rem;
        border-radius: 12px;
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        display: flex;
        align-items: center;
        gap: 0.375rem;
        border: 1px solid #e5e7eb;
        z-index: 2;
      }

      .tool-station.active .station-badge {
        background: #10b981;
        color: white;
        border-color: #059669;
      }

      .tool-station.locked .station-badge {
        background: #6b7280;
        color: white;
        border-color: #4b5563;
      }

      .status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        animation: station-pulse 2s ease-in-out infinite;
      }

      .status-dot.active {
        background: #22d3ee;
      }

      .status-dot.mystery {
        background: linear-gradient(45deg, #f59e0b, #f97316, #ef4444, #ec4899);
        background-size: 300% 300%;
        animation: mystery-rainbow 2s ease-in-out infinite;
      }

      @keyframes station-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.6;
          transform: scale(1.4);
        }
      }

      @keyframes mystery-rainbow {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      /* Station Content */
      .station-icon {
        width: 48px;
        height: 48px;
        margin: 1.5rem auto 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
        color: #475569;
        flex-shrink: 0;
      }

      .tool-station.active .station-icon {
        background: linear-gradient(135deg, #10b981, #34d399);
        color: white;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
      }

      .tool-station.locked .station-icon {
        background: linear-gradient(135deg, #9ca3af, #6b7280);
        color: white;
      }

      .station-icon svg {
        width: 24px;
        height: 24px;
      }

      .tool-station h3 {
        font-size: 1.125rem;
        font-weight: 700;
        color: #1f2937;
        margin: 0 0 0.5rem 0;
        text-align: center;
        padding: 0 1rem;
      }

      .tool-station p {
        font-size: 0.875rem;
        color: #64748b;
        margin: 0 0 1rem 0;
        text-align: center;
        padding: 0 1rem;
        line-height: 1.4;
      }

      /* Tool Previews */
      .tool-preview {
        flex: 1;
        padding: 1rem;
        background: #fafafa;
        border-top: 1px solid #e5e7eb;
        position: relative;
        overflow: hidden;
      }

      /* Overlay States */
      .coming-soon-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(107, 114, 128, 0.9);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        z-index: 1;
      }

      .mystery-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
          135deg,
          rgba(107, 114, 128, 0.8),
          rgba(75, 85, 99, 0.9)
        );
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
      }

      .mystery-sparkles {
        position: relative;
        width: 60px;
        height: 60px;
      }

      .sparkle {
        position: absolute;
        width: 8px;
        height: 8px;
        background: #fbbf24;
        border-radius: 50%;
        animation: sparkle-twinkle 1.5s ease-in-out infinite;
      }

      .sparkle:nth-child(1) {
        top: 10px;
        left: 20px;
        animation-delay: 0s;
      }

      .sparkle:nth-child(2) {
        top: 30px;
        right: 15px;
        animation-delay: 0.5s;
      }

      .sparkle:nth-child(3) {
        bottom: 15px;
        left: 30px;
        animation-delay: 1s;
      }

      @keyframes sparkle-twinkle {
        0%,
        100% {
          opacity: 0.3;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.5);
        }
      }

      /* Exploration Footer */
      .exploration-footer {
        text-align: center;
        padding: 1.5rem;
        background: linear-gradient(135deg, #f8fafc, #f1f5f9);
        border-radius: 12px;
        border: 1px solid #e2e8f0;
      }

      .exploration-text {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        font-size: 0.875rem;
        color: #64748b;
        font-style: italic;
      }

      .exploration-text svg {
        width: 20px;
        height: 20px;
        color: #3b82f6;
      }

      /* Responsive Design Enhancements */
      @media (max-width: 768px) {
        .main-tools {
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }

        .secondary-tools {
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .actions-grid {
          grid-template-columns: repeat(2, 1fr);
        }

        .tool-header {
          padding: 1.5rem;
        }

        .tool-title {
          font-size: 1.5rem;
        }
      }

      @media (max-width: 480px) {
        .actions-grid {
          grid-template-columns: 1fr;
        }
      }

      /* Empty States */
      .empty-state {
        text-align: center;
        padding: 3rem;
        color: #64748b;
      }

      .empty-state svg {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem auto;
        color: #cbd5e1;
      }

      .empty-state p {
        font-size: 1rem;
        margin: 0;
        line-height: 1.5;
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
}
