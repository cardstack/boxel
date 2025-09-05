import { fn, concat } from '@ember/helper';
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Button } from '@cardstack/boxel-ui/components';
import { gt } from '@cardstack/boxel-ui/helpers';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import MusicIcon from '@cardstack/boxel-icons/music';
import { PlaylistCard } from '../playlist/playlist';
import { htmlSafe } from '@ember/template';

export class MoodField extends FieldDef {
  static displayName = 'Mood';
  static icon = MusicIcon;

  @field name = contains(StringField);
  @field emoji = contains(StringField);
  @field description = contains(StringField);
  @field color = contains(StringField);
  @field gradient = contains(StringField);
  @field playlist = linksTo(() => PlaylistCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div
        class='mood-field-display'
        style={{htmlSafe (concat 'background: ' @model.gradient)}}
      >
        <span class='mood-emoji'>{{@model.emoji}}</span>
        <div class='mood-info'>
          <h4>{{@model.name}}</h4>
          <p>{{@model.description}}</p>
        </div>
      </div>

      <style scoped>
        .mood-field-display {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          border-radius: 8px;
          color: white;
        }

        .mood-emoji {
          font-size: 1.5rem;
        }

        .mood-info h4 {
          margin: 0 0 0.25rem 0;
          font-size: 0.875rem;
          font-weight: 600;
        }

        .mood-info p {
          margin: 0;
          font-size: 0.75rem;
          opacity: 0.9;
        }
      </style>
    </template>
  };
}

class MoodSelectorPlaylistEmbedded extends Component<
  typeof MoodSelectorPlaylistCard
> {
  @tracked selectedMood: any = null;
  @tracked isAnimating = false;

  get moods() {
    return this.args.model?.moods || [];
  }

  @action
  selectMood(mood: any, event: Event) {
    event.stopPropagation();
    event.preventDefault();

    this.selectedMood = mood;
    this.isAnimating = true;

    setTimeout(() => {
      console.log(`Opening playlist: ${mood.name}`);
      this.isAnimating = false;

      if (mood.playlist && this.args.viewCard) {
        this.args.viewCard(mood.playlist, 'isolated');
      }
    }, 1500);
  }

  @action
  resetSelection() {
    this.selectedMood = null;
    this.isAnimating = false;
  }

  @action
  openSelectedPlaylist(event: Event) {
    event.stopPropagation();
    event.preventDefault();

    if (this.selectedMood?.playlist && this.args.viewCard) {
      this.args.viewCard(this.selectedMood.playlist, 'isolated');
    }
  }

  <template>
    <div class='embedded-mood-selector'>
      {{#if this.selectedMood}}
        <div class='embedded-result'>
          <div
            class='mood-result-embedded'
            style={{htmlSafe
              (concat 'background: ' this.selectedMood.gradient)
            }}
          >
            <div class='result-content-embedded'>
              {{#if this.isAnimating}}
                <div class='loading-animation-embedded'>
                  <div class='music-note-embedded note-1'>♪</div>
                  <div class='music-note-embedded note-2'>♫</div>
                  <div class='music-note-embedded note-3'>♪</div>
                </div>
                <h3>Finding perfect {{this.selectedMood.name}} playlist...</h3>
              {{else}}
                <div
                  class='result-emoji-embedded'
                >{{this.selectedMood.emoji}}</div>
                <h3>Perfect Match!</h3>
                <p>Found the ideal {{this.selectedMood.name}} playlist</p>
                <button
                  class='open-playlist-btn-embedded'
                  {{on 'click' this.openSelectedPlaylist}}
                >
                  Open Playlist
                </button>
              {{/if}}
            </div>

            <button
              class='back-btn-embedded'
              {{on 'click' this.resetSelection}}
            >
              ← Back
            </button>
          </div>
        </div>
      {{else}}
        <div class='embedded-selection'>
          <header class='selector-header-embedded'>
            <h3>{{if
                @model.selectorTitle
                @model.selectorTitle
                'How are you feeling?'
              }}</h3>
            <p>{{if
                @model.description
                @model.description
                "Choose your current mood and we'll suggest the perfect playlist"
              }}</p>
          </header>

          {{#if (gt this.moods.length 0)}}
            <div class='moods-grid-embedded'>
              {{#each this.moods as |mood|}}
                <button
                  class='mood-card-embedded'
                  style={{htmlSafe (concat 'background: ' mood.gradient)}}
                  {{on 'click' (fn this.selectMood mood)}}
                >
                  <div class='mood-emoji-embedded'>{{mood.emoji}}</div>
                  <p class='mood-name-embedded'>{{mood.name}}</p>
                  <p class='mood-description-embedded'>{{mood.description}}</p>
                </button>
              {{/each}}
            </div>
          {{else}}
            <div class='empty-moods'>
              <p>No moods configured yet. Add some mood options to get started!</p>
            </div>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .embedded-mood-selector {
        width: 100%;
        font-family:
          'Inter',
          -apple-system,
          sans-serif;
      }

      .embedded-selection {
        padding: 2rem;
      }

      .selector-header-embedded {
        text-align: center;
        margin-bottom: 2rem;
      }

      .selector-header-embedded h3 {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 0.5rem 0;
        background: linear-gradient(135deg, #3b82f6, #8b5cf6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .selector-header-embedded p {
        font-size: 0.875rem;
        color: #64748b;
        margin: 0;
      }

      .moods-grid-embedded {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 1rem;
      }

      .mood-card-embedded {
        position: relative;
        background: white;
        border-radius: 12px;
        padding: 1rem;
        border: none;
        cursor: pointer;
        transition: all 0.3s ease;
        color: white;
        text-align: center;
        min-height: 120px;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .mood-card-embedded:hover {
        transform: translateY(-2px) scale(1.02);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
      }

      .mood-emoji-embedded {
        font-size: 1.5rem;
        margin-bottom: 0.5rem;
      }

      .mood-name-embedded {
        font-size: 0.875rem;
        font-weight: 600;
        margin: 0 0 0.25rem 0;
        text-shadow: 0 1px 2px rgba(73, 39, 39, 0.2);
      }

      .mood-description-embedded {
        font-size: 0.625rem;
        margin: 0;
        opacity: 0.9;
        line-height: 1.3;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      }

      .empty-moods {
        text-align: center;
        padding: 2rem;
        color: #64748b;
        font-style: italic;
      }

      /* Result state styles */
      .embedded-result {
        height: 400px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mood-result-embedded {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: white;
        text-align: center;
        position: relative;
        border-radius: 12px;
      }

      .result-content-embedded {
        max-width: 400px;
        margin: 0 auto;
      }

      .result-emoji-embedded {
        font-size: 2.5rem;
        margin-bottom: 1rem;
      }

      .mood-result-embedded h3 {
        font-size: 1.5rem;
        font-weight: 700;
        margin: 0 0 0.5rem 0;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .mood-result-embedded p {
        font-size: 0.875rem;
        margin: 0 0 1.5rem 0;
        opacity: 0.9;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .open-playlist-btn-embedded {
        background: rgba(255, 255, 255, 0.2);
        border: 2px solid rgba(255, 255, 255, 0.3);
        color: white;
        padding: 0.75rem 1.5rem;
        border-radius: 25px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
      }

      .open-playlist-btn-embedded:hover {
        background: rgba(255, 255, 255, 0.3);
        border-color: rgba(255, 255, 255, 0.5);
        transform: scale(1.05);
      }

      .back-btn-embedded {
        position: absolute;
        top: 1rem;
        left: 1rem;
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 20px;
        font-size: 0.75rem;
        cursor: pointer;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      }

      .back-btn-embedded:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      /* Loading animation */
      .loading-animation-embedded {
        position: relative;
        height: 50px;
        margin-bottom: 1rem;
      }

      .music-note-embedded {
        position: absolute;
        font-size: 1.5rem;
        animation: float-note-embedded 2s ease-in-out infinite;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .note-1 {
        left: 30%;
        animation-delay: 0s;
      }

      .note-2 {
        left: 50%;
        animation-delay: 0.5s;
      }

      .note-3 {
        left: 70%;
        animation-delay: 1s;
      }

      @keyframes float-note-embedded {
        0%,
        100% {
          transform: translateY(0px);
          opacity: 0.7;
        }
        50% {
          transform: translateY(-15px);
          opacity: 1;
        }
      }
    </style>
  </template>
}

class MoodSelectorPlaylistIsolated extends Component<
  typeof MoodSelectorPlaylistCard
> {
  @tracked selectedMood: any = null;
  @tracked isAnimating = false;

  get moods() {
    return this.args.model?.moods || [];
  }

  @action
  selectMood(mood: any, event: Event) {
    event.stopPropagation();
    event.preventDefault();

    this.selectedMood = mood;
    this.isAnimating = true;

    setTimeout(() => {
      console.log(`Opening playlist: ${mood.name}`);
      this.isAnimating = false;

      if (mood.playlist && this.args.viewCard) {
        this.args.viewCard(mood.playlist, 'isolated');
      }
    }, 1500);
  }

  @action
  resetSelection() {
    this.selectedMood = null;
    this.isAnimating = false;
  }

  @action
  openSelectedPlaylist(event: Event) {
    event.stopPropagation();
    event.preventDefault();

    if (this.selectedMood?.playlist && this.args.viewCard) {
      this.args.viewCard(this.selectedMood.playlist, 'isolated');
    }
  }

  <template>
    <div class='stage'>
      <div class='mood-selector-mat'>
        {{#if this.selectedMood}}
          <div class='selected-mood-view'>
            <div
              class='mood-result'
              style={{htmlSafe
                (concat 'background: ' this.selectedMood.gradient)
              }}
            >
              <div class='result-content'>
                {{#if this.isAnimating}}
                  <div class='loading-animation'>
                    <div class='music-note note-1'>♪</div>
                    <div class='music-note note-2'>♫</div>
                    <div class='music-note note-3'>♪</div>
                  </div>
                  <h2>Finding perfect
                    {{this.selectedMood.name}}
                    playlist...</h2>
                {{else}}
                  <div class='result-emoji'>{{this.selectedMood.emoji}}</div>
                  <h2>Perfect Match!</h2>
                  <p>We found the ideal
                    {{this.selectedMood.name}}
                    playlist for you</p>
                  <Button
                    class='open-playlist-btn'
                    {{on 'click' this.openSelectedPlaylist}}
                  >
                    Open Playlist
                  </Button>
                {{/if}}
              </div>

              <Button class='back-btn' {{on 'click' this.resetSelection}}>
                ← Choose Different Mood
              </Button>
            </div>
          </div>
        {{else}}
          <div class='mood-selection'>
            <header class='selector-header'>
              <h1>{{if
                  @model.selectorTitle
                  @model.selectorTitle
                  'How are you feeling?'
                }}</h1>
              <p>{{if
                  @model.description
                  @model.description
                  "Choose your current mood and we'll suggest the perfect playlist"
                }}</p>
            </header>

            {{#if (gt this.moods.length 0)}}
              <div class='moods-grid'>
                {{#each this.moods as |mood|}}
                  <button
                    class='mood-card'
                    style={{htmlSafe (concat 'background: ' mood.gradient)}}
                    {{on 'click' (fn this.selectMood mood)}}
                  >
                    <div class='mood-emoji'>{{mood.emoji}}</div>
                    <p class='mood-name'>{{mood.name}}</p>
                    <p class='mood-description'>{{mood.description}}</p>

                    <div
                      class='mood-card-glow'
                      style={{htmlSafe (concat 'background: ' mood.color)}}
                    ></div>
                  </button>
                {{/each}}
              </div>
            {{else}}
              <div class='empty-moods-state'>
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
                <h3>No Moods Configured</h3>
                <p>Add some mood options to get started with playlist
                  recommendations!</p>
              </div>
            {{/if}}

            <div class='selector-footer'>
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
              <span>Each mood curated by music experts</span>
            </div>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
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

      .mood-selector-mat {
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
        .mood-selector-mat {
          max-width: none;
          height: 100%;
          border-radius: 0;
        }
      }

      .mood-selection {
        padding: 3rem 2rem;
      }

      .selector-header {
        text-align: center;
        margin-bottom: 3rem;
      }

      .selector-header h1 {
        font-size: 2.5rem;
        font-weight: 800;
        color: #1e293b;
        margin: 0 0 1rem 0;
        background: linear-gradient(135deg, #3b82f6, #8b5cf6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .selector-header p {
        font-size: 1.125rem;
        color: #64748b;
        margin: 0;
        max-width: 600px;
        margin: 0 auto;
      }

      .moods-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1.5rem;
        margin-bottom: 3rem;
      }

      @media (max-width: 768px) {
        .moods-grid {
          grid-template-columns: 1fr;
          gap: 1rem;
        }
      }

      .mood-card {
        position: relative;
        background: white;
        border-radius: 20px;
        padding: 2rem;
        border: none;
        cursor: pointer;
        transition: all 0.3s ease;
        color: white;
        text-align: center;
        overflow: hidden;
        min-height: 200px;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .mood-card:hover {
        transform: translateY(-8px) scale(1.02);
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
      }

      .mood-card:active {
        transform: translateY(-4px) scale(1.01);
      }

      .mood-emoji {
        font-size: 3rem;
        margin-bottom: 1rem;
        filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
      }

      .mood-name {
        font-size: 1.5rem;
        font-weight: 700;
        margin: 0 0 0.5rem 0;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .mood-description {
        font-size: 0.875rem;
        margin: 0;
        opacity: 0.9;
        line-height: 1.4;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      }

      .mood-card-glow {
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        opacity: 0;
        border-radius: 50%;
        filter: blur(20px);
        transition: opacity 0.3s ease;
        pointer-events: none;
      }

      .mood-card:hover .mood-card-glow {
        opacity: 0.3;
      }

      .empty-moods-state {
        text-align: center;
        padding: 4rem 2rem;
        color: #64748b;
      }

      .empty-moods-state svg {
        width: 64px;
        height: 64px;
        margin: 0 auto 1.5rem auto;
        color: #cbd5e1;
      }

      .empty-moods-state h3 {
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
        color: #374151;
      }

      .empty-moods-state p {
        font-size: 1rem;
        margin: 0;
        max-width: 400px;
        margin: 0 auto;
      }

      .selector-footer {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        color: #64748b;
        font-size: 0.875rem;
        font-style: italic;
      }

      .selector-footer svg {
        width: 20px;
        height: 20px;
        color: #3b82f6;
      }

      /* Selected mood result styles */
      .selected-mood-view {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mood-result {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: white;
        text-align: center;
        position: relative;
      }

      .result-content {
        max-width: 500px;
        margin: 0 auto;
      }

      .result-emoji {
        font-size: 5rem;
        margin-bottom: 2rem;
        filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.3));
      }

      .mood-result h2 {
        font-size: 2.5rem;
        font-weight: 800;
        margin: 0 0 1rem 0;
        text-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      }

      .mood-result p {
        font-size: 1.25rem;
        margin: 0 0 2rem 0;
        opacity: 0.9;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .open-playlist-btn {
        background: rgba(255, 255, 255, 0.2);
        border: 2px solid rgba(255, 255, 255, 0.3);
        color: white;
        padding: 1rem 2rem;
        border-radius: 50px;
        font-size: 1.125rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
      }

      .open-playlist-btn:hover {
        background: rgba(255, 255, 255, 0.3);
        border-color: rgba(255, 255, 255, 0.5);
        transform: scale(1.05);
      }

      .back-btn {
        position: absolute;
        top: 2rem;
        left: 2rem;
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        padding: 0.75rem 1.5rem;
        border-radius: 25px;
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      }

      .back-btn:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: translateX(-2px);
      }

      /* Loading animation */
      .loading-animation {
        position: relative;
        height: 80px;
        margin-bottom: 2rem;
      }

      .music-note {
        position: absolute;
        font-size: 2rem;
        animation: float-note 2s ease-in-out infinite;
        text-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      }

      .note-1 {
        left: 30%;
        animation-delay: 0s;
      }

      .note-2 {
        left: 50%;
        animation-delay: 0.5s;
      }

      .note-3 {
        left: 70%;
        animation-delay: 1s;
      }

      @keyframes float-note {
        0%,
        100% {
          transform: translateY(0px);
          opacity: 0.7;
        }
        50% {
          transform: translateY(-20px);
          opacity: 1;
        }
      }
    </style>
  </template>
}

export class MoodSelectorPlaylistCard extends CardDef {
  static displayName = 'Mood Selector';
  static icon = MusicIcon;

  @field selectorTitle = contains(StringField);
  @field description = contains(StringField);
  @field moods = containsMany(MoodField);

  @field title = contains(StringField, {
    computeVia: function (this: MoodSelectorPlaylistCard) {
      try {
        return this.selectorTitle ?? 'Choose Your Mood';
      } catch (e) {
        console.error('MoodSelectorCard: Error computing title', e);
        return 'Choose Your Mood';
      }
    },
  });

  static embedded = MoodSelectorPlaylistEmbedded;
  static isolated = MoodSelectorPlaylistIsolated;
}
