// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn, array, hash, concat } from '@ember/helper';
import { modifier } from 'ember-modifier';
import {
  eq,
  not,
  or,
  and,
  multiply,
  divide,
  lt,
  gte,
  lte,
} from '@cardstack/boxel-ui/helpers';
import {
  BoxelInput,
  Button,
  BoxelSelect,
  IconButton,
  FieldContainer,
} from '@cardstack/boxel-ui/components';
import MusicIcon from '@cardstack/boxel-icons/music';
import UploadIcon from '@cardstack/boxel-icons/upload';
import PlayIcon from '@cardstack/boxel-icons/play';
import PauseIcon from '@cardstack/boxel-icons/pause';
import Volume2Icon from '@cardstack/boxel-icons/volume-2';
import VolumeXIcon from '@cardstack/boxel-icons/volume-x';
import CheckIcon from '@cardstack/boxel-icons/check';

export class AudioField extends FieldDef {
  // ² Audio field definition
  static displayName = 'Audio';
  static icon = MusicIcon;

  // ³ Core audio data (always present)
  @field url = contains(StringField);
  @field filename = contains(StringField);
  @field mimeType = contains(StringField);
  @field duration = contains(NumberField); // in seconds
  @field fileSize = contains(NumberField); // in bytes

  // ⁴ Optional metadata
  @field title = contains(StringField);
  @field artist = contains(StringField);
  @field waveformData = contains(StringField); // JSON array of heights

  // ⁵ User interaction data (optional)
  @field liked = contains(BooleanField);
  @field playCount = contains(NumberField);
  @field lastPlayed = contains(DatetimeField);

  // ⁶ Trimming data (optional)
  @field trimStart = contains(NumberField);
  @field trimEnd = contains(NumberField);

  // ²² Playback settings (optional)
  @field playbackRate = contains(NumberField); // 0.5 to 2.0
  @field loopEnabled = contains(BooleanField);
  @field loopStart = contains(NumberField); // Loop start time in seconds
  @field loopEnd = contains(NumberField); // Loop end time in seconds

  // ⁷ Computed display title
  @field displayTitle = contains(StringField, {
    computeVia: function (this: AudioField) {
      return this.title || this.filename || 'Untitled Audio';
    },
  });

  // ⁸ Inline player presentation (embedded format)
  static embedded = class Embedded extends Component<typeof this> {
    @tracked isPlaying = false;
    @tracked currentTime = 0;
    @tracked audioDuration = 0;
    @tracked volume = 1;
    @tracked isMuted = false;
    @tracked playbackRate = 1;
    @tracked isLooping = false;
    @tracked trimStart = 0;
    @tracked trimEnd = 100; // Percentage
    audioElement: HTMLAudioElement | null = null;

    get presentationStyle() {
      return (
        (this.args.configuration as any)?.presentation?.style ?? 'inline-player'
      );
    }

    get showVolume() {
      return (
        (this.args.configuration as any)?.presentation?.showVolume ?? false
      );
    }

    get showWaveform() {
      return (
        (this.args.configuration as any)?.presentation?.showWaveform ?? false
      );
    }

    get showSpeedControl() {
      return (
        (this.args.configuration as any)?.presentation?.showSpeedControl ??
        false
      );
    }

    get showLoopControl() {
      return (
        (this.args.configuration as any)?.presentation?.showLoopControl ?? false
      );
    }

    // ¹² Real waveform data with Web Audio API
    @tracked waveformBars: number[] = [];
    private _isGeneratingWaveform = false; // Non-tracked to avoid reactivity issues

    get displayWaveform() {
      if (this.waveformBars.length > 0) {
        return this.waveformBars;
      }
      if (this.args.model.waveformData) {
        try {
          return JSON.parse(this.args.model.waveformData);
        } catch {
          return this.generateFallbackWaveform();
        }
      }
      return this.generateFallbackWaveform();
    }

    generateFallbackWaveform() {
      return Array.from({ length: 80 }, () => 20 + Math.random() * 80);
    }

    setupAudio = modifier((element: HTMLAudioElement) => {
      this.audioElement = element;

      // Generate real waveform when audio is loaded
      // Use setTimeout to defer generation outside of render cycle
      if (this.args.model.url && this.waveformBars.length === 0) {
        setTimeout(() => {
          this.generateRealWaveform(this.args.model.url);
        }, 0);
      }

      return () => {
        this.audioElement = null;
      };
    });

    async generateRealWaveform(url: string) {
      // Prevent multiple simultaneous generations
      if (this._isGeneratingWaveform) return;
      this._isGeneratingWaveform = true;

      try {
        // Create audio context
        const audioContext = new (window.AudioContext ||
          (window as any).webkitAudioContext)();

        // Fetch audio file
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Get the first channel data
        const rawData = audioBuffer.getChannelData(0);
        const samples = 80; // Number of bars
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData: number[] = [];

        // Calculate average amplitude for each block
        for (let i = 0; i < samples; i++) {
          let blockStart = blockSize * i;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[blockStart + j]);
          }
          // Normalize to 0-100 range with minimum height
          const average = sum / blockSize;
          const normalized = Math.max(20, Math.min(100, average * 200));
          filteredData.push(normalized);
        }

        // Update waveform bars (safe because we're in async context)
        this.waveformBars = filteredData;

        // Save to model for persistence
        if (this.args.model) {
          this.args.model.waveformData = JSON.stringify(filteredData);
        }

        // Close audio context to free resources
        await audioContext.close();
      } catch (error) {
        console.warn('Failed to generate waveform, using fallback:', error);
        // Use fallback waveform on error
        this.waveformBars = this.generateFallbackWaveform();
      } finally {
        this._isGeneratingWaveform = false;
      }
    }

    @action
    togglePlay() {
      if (!this.audioElement) return;

      if (this.isPlaying) {
        this.audioElement.pause();
      } else {
        this.audioElement.play();
      }
    }

    @action
    handlePlay() {
      this.isPlaying = true;
    }

    @action
    handlePause() {
      this.isPlaying = false;
    }

    @action
    handleTimeUpdate(event: Event) {
      const audio = event.target as HTMLAudioElement;
      this.currentTime = audio.currentTime;
    }

    @action
    handleLoadedMetadata(event: Event) {
      const audio = event.target as HTMLAudioElement;
      this.audioDuration = audio.duration;
    }

    @action
    handleSeek(event: Event) {
      if (!this.audioElement) return;
      const input = event.target as HTMLInputElement;
      this.audioElement.currentTime = parseFloat(input.value);
    }

    @action
    handleVolumeChange(event: Event) {
      if (!this.audioElement) return;
      const input = event.target as HTMLInputElement;
      this.volume = parseFloat(input.value);
      this.audioElement.volume = this.volume;
      if (this.volume === 0) {
        this.isMuted = true;
      } else if (this.isMuted) {
        this.isMuted = false;
      }
    }

    @action
    toggleMute() {
      if (!this.audioElement) return;
      this.isMuted = !this.isMuted;
      this.audioElement.muted = this.isMuted;
    }

    @action
    skipTime(seconds: number) {
      if (!this.audioElement) return;
      this.audioElement.currentTime = Math.max(
        0,
        Math.min(this.audioElement.currentTime + seconds, this.audioDuration),
      );
    }

    @action
    seekToPosition(index: number) {
      if (!this.audioElement || !this.audioDuration) return;
      const position =
        (index / this.displayWaveform.length) * this.audioDuration;
      this.audioElement.currentTime = position;
    }

    @action
    handleSpeedChange(selected: any) {
      if (!this.audioElement) return;
      this.playbackRate = selected.value;
      this.audioElement.playbackRate = this.playbackRate;
    }

    @action
    toggleLoop() {
      this.isLooping = !this.isLooping;
      if (this.audioElement) {
        this.audioElement.loop = this.isLooping;
      }
    }

    @action
    handleTrimStartChange(event: Event) {
      const input = event.target as HTMLInputElement;
      this.trimStart = parseFloat(input.value);
    }

    @action
    handleTrimEndChange(event: Event) {
      const input = event.target as HTMLInputElement;
      this.trimEnd = parseFloat(input.value);
    }

    @action
    applyTrim() {
      if (!this.audioElement || !this.audioDuration) return;

      // Save trim values to model
      this.args.model.trimStart = (this.trimStart / 100) * this.audioDuration;
      this.args.model.trimEnd = (this.trimEnd / 100) * this.audioDuration;

      // Seek to trim start
      this.audioElement.currentTime = this.args.model.trimStart;
    }

    @action
    handleTimeUpdateWithTrim(event: Event) {
      const audio = event.target as HTMLAudioElement;
      this.currentTime = audio.currentTime;

      // Handle trimmed playback
      if (
        this.args.model.trimEnd &&
        audio.currentTime >= this.args.model.trimEnd
      ) {
        if (this.isLooping && this.args.model.trimStart) {
          audio.currentTime = this.args.model.trimStart;
        } else {
          audio.pause();
        }
      }
    }

    // ¹⁹ Progress calculation getter (safer than inline calculation)
    get progressPercentage(): number {
      if (!this.audioDuration || this.audioDuration === 0) return 0;
      return (this.currentTime / this.audioDuration) * 100;
    }

    formatTime(seconds: number): string {
      if (!seconds || isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    formatFileSize(bytes: number): string {
      if (!bytes) return '0 MB';
      const mb = (bytes / (1024 * 1024)).toFixed(1);
      return `${mb} MB`;
    }

    // ²⁰ Helper to check if waveform bar is played
    isBarPlayed = (index: number): boolean => {
      if (!this.audioDuration || !this.displayWaveform.length) return false;
      const barProgress = (index / this.displayWaveform.length) * 100;
      return barProgress <= this.progressPercentage;
    };

    // ²⁷ Trim calculations in seconds
    get trimStartSeconds(): number {
      if (!this.audioDuration) return 0;
      return (this.trimStart / 100) * this.audioDuration;
    }

    get trimEndSeconds(): number {
      if (!this.audioDuration) return 0;
      return (this.trimEnd / 100) * this.audioDuration;
    }

    get trimDurationSeconds(): number {
      return this.trimEndSeconds - this.trimStartSeconds;
    }

    <template>
      {{#if @model.url}}
        {{! ¹³ Waveform Player Presentation }}
        {{#if (eq this.presentationStyle 'waveform-player')}}
          <div class='waveform-player'>
            <audio
              {{this.setupAudio}}
              src={{@model.url}}
              {{on 'play' this.handlePlay}}
              {{on 'pause' this.handlePause}}
              {{on 'timeupdate' this.handleTimeUpdate}}
              {{on 'loadedmetadata' this.handleLoadedMetadata}}
            ></audio>

            <div class='waveform-header'>
              <div class='waveform-info'>
                <div class='waveform-title'>{{@model.displayTitle}}</div>
                {{#if @model.artist}}
                  <div class='waveform-artist'>{{@model.artist}}</div>
                {{/if}}
              </div>
            </div>

            <div class='waveform-container'>
              <div class='waveform-bars'>
                {{#each this.displayWaveform as |height index|}}
                  <div
                    class='waveform-bar
                      {{if (this.isBarPlayed index) "played" "unplayed"}}'
                    style='height: {{height}}%'
                    {{on 'click' (fn this.seekToPosition index)}}
                  ></div>
                {{/each}}
              </div>
            </div>

            <div class='waveform-controls'>
              <IconButton
                @icon={{if this.isPlaying PauseIcon PlayIcon}}
                @width='20px'
                @height='20px'
                class='waveform-play-btn'
                {{on 'click' this.togglePlay}}
                aria-label={{if this.isPlaying 'Pause' 'Play'}}
              />
              <div class='waveform-time'>
                {{this.formatTime this.currentTime}}
                /
                {{this.formatTime this.audioDuration}}
              </div>
            </div>
          </div>

        {{else if (eq this.presentationStyle 'mini-player')}}
          {{! ²⁸ Mini Player Presentation (Podcast/Article Style) }}
          <div class='mini-player'>
            <audio
              {{this.setupAudio}}
              src={{@model.url}}
              {{on 'play' this.handlePlay}}
              {{on 'pause' this.handlePause}}
              {{on 'timeupdate' this.handleTimeUpdate}}
              {{on 'loadedmetadata' this.handleLoadedMetadata}}
            ></audio>

            <IconButton
              @icon={{if this.isPlaying PauseIcon PlayIcon}}
              @width='18px'
              @height='18px'
              class='mini-play-btn'
              {{on 'click' this.togglePlay}}
              aria-label={{if this.isPlaying 'Pause' 'Play'}}
            />

            <div class='mini-info'>
              <div class='mini-title'>{{@model.displayTitle}}</div>
              {{#if @model.artist}}
                <div class='mini-artist'>{{@model.artist}}</div>
              {{/if}}
            </div>

            <div class='mini-skip-controls'>
              <Button
                @kind='ghost'
                class='skip-btn'
                {{on 'click' (fn this.skipTime -15)}}
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M11 19l-7-7 7-7M18 19l-7-7 7-7' />
                </svg>
                <span>15</span>
              </Button>
              <Button
                @kind='ghost'
                class='skip-btn'
                {{on 'click' (fn this.skipTime 15)}}
              >
                <span>15</span>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M13 5l7 7-7 7M6 5l7 7-7 7' />
                </svg>
              </Button>
            </div>

            <div class='mini-time'>
              {{this.formatTime this.currentTime}}
              <span class='time-separator'>/</span>
              {{this.formatTime this.audioDuration}}
            </div>

            {{#if this.audioDuration}}
              <div class='mini-progress-container'>
                <div
                  class='mini-progress-bar'
                  style='width: {{this.progressPercentage}}%'
                ></div>
              </div>
            {{/if}}
          </div>

        {{else if (eq this.presentationStyle 'album-cover')}}
          {{! ²⁹ Album/Cover Art Player }}
          <div class='album-player'>
            <audio
              {{this.setupAudio}}
              src={{@model.url}}
              {{on 'play' this.handlePlay}}
              {{on 'pause' this.handlePause}}
              {{on 'timeupdate' this.handleTimeUpdate}}
              {{on 'loadedmetadata' this.handleLoadedMetadata}}
            ></audio>

            <div class='album-cover'>
              <div class='cover-gradient'></div>
              <div class='cover-overlay'>
                <Button
                  @kind='primary'
                  class='album-play-btn'
                  {{on 'click' this.togglePlay}}
                >
                  {{#if this.isPlaying}}
                    <PauseIcon width='40' height='40' />
                  {{else}}
                    <PlayIcon width='40' height='40' />
                  {{/if}}
                </Button>
              </div>
            </div>

            <div class='album-info'>
              <div class='album-title'>{{@model.displayTitle}}</div>
              {{#if @model.artist}}
                <div class='album-artist'>{{@model.artist}}</div>
              {{/if}}

              {{#if this.audioDuration}}
                <div class='album-progress'>
                  <div class='album-progress-bar'>
                    <div
                      class='album-progress-fill'
                      style='width: {{this.progressPercentage}}%'
                    ></div>
                  </div>
                  <div class='album-time'>
                    {{this.formatTime this.currentTime}}
                    <span>/</span>
                    {{this.formatTime this.audioDuration}}
                  </div>
                </div>
              {{/if}}
            </div>
          </div>

        {{else if (eq this.presentationStyle 'trim-editor')}}
          {{! ²³ Trim Editor Presentation }}
          <div class='trim-editor'>
            <audio
              {{this.setupAudio}}
              src={{@model.url}}
              {{on 'play' this.handlePlay}}
              {{on 'pause' this.handlePause}}
              {{on 'timeupdate' this.handleTimeUpdateWithTrim}}
              {{on 'loadedmetadata' this.handleLoadedMetadata}}
            ></audio>

            <div class='trim-header'>
              <div class='trim-title'>
                <h4>{{@model.displayTitle}}</h4>
                <div class='trim-subtitle'>Clip Editor</div>
              </div>
            </div>

            <div class='trim-info-bar'>
              <div class='trim-stat'>
                <span class='stat-label'>Start</span>
                <span class='stat-value'>{{this.formatTime
                    this.trimStartSeconds
                  }}</span>
              </div>
              <div class='trim-stat'>
                <span class='stat-label'>Duration</span>
                <span class='stat-value'>{{this.formatTime
                    this.trimDurationSeconds
                  }}</span>
              </div>
              <div class='trim-stat'>
                <span class='stat-label'>End</span>
                <span class='stat-value'>{{this.formatTime
                    this.trimEndSeconds
                  }}</span>
              </div>
            </div>

            <div class='trim-waveform'>
              <div class='waveform-bars'>
                {{#each this.displayWaveform as |height index|}}
                  <div
                    class='waveform-bar
                      {{if
                        (and
                          (gte
                            (multiply
                              index (divide 100 this.displayWaveform.length)
                            )
                            this.trimStart
                          )
                          (lte
                            (multiply
                              index (divide 100 this.displayWaveform.length)
                            )
                            this.trimEnd
                          )
                        )
                        "in-range"
                        "out-range"
                      }}'
                    style='height: {{height}}%'
                  ></div>
                {{/each}}
              </div>
              <div class='trim-markers'>
                <div
                  class='start-marker'
                  style='left: {{this.trimStart}}%'
                ></div>
                <div class='end-marker' style='left: {{this.trimEnd}}%'></div>
              </div>
            </div>

            <div class='trim-sliders'>
              <div class='slider-group'>
                <label class='slider-label'>
                  <span>Trim Start</span>
                  <span class='slider-value'>{{this.trimStart}}%</span>
                </label>
                <input
                  type='range'
                  min='0'
                  max={{this.trimEnd}}
                  step='0.1'
                  value={{this.trimStart}}
                  {{on 'input' this.handleTrimStartChange}}
                  class='trim-slider start-slider'
                />
              </div>

              <div class='slider-group'>
                <label class='slider-label'>
                  <span>Trim End</span>
                  <span class='slider-value'>{{this.trimEnd}}%</span>
                </label>
                <input
                  type='range'
                  min={{this.trimStart}}
                  max='100'
                  step='0.1'
                  value={{this.trimEnd}}
                  {{on 'input' this.handleTrimEndChange}}
                  class='trim-slider end-slider'
                />
              </div>
            </div>

            <div class='trim-actions'>
              <div class='playback-controls-row'>
                <Button
                  @kind='primary'
                  class='control-btn'
                  {{on 'click' this.togglePlay}}
                >
                  {{#if this.isPlaying}}
                    <PauseIcon width='20' height='20' />
                  {{else}}
                    <PlayIcon width='20' height='20' />
                  {{/if}}
                </Button>

                <span class='time-display-inline'>
                  {{this.formatTime this.currentTime}}
                  /
                  {{this.formatTime this.audioDuration}}
                </span>

                <label class='loop-toggle'>
                  <input
                    type='checkbox'
                    checked={{this.isLooping}}
                    {{on 'change' this.toggleLoop}}
                    class='loop-checkbox'
                  />
                  Loop Clip
                </label>
              </div>

              <Button
                @kind='primary'
                class='trim-apply-btn'
                {{on 'click' this.applyTrim}}
              >
                <CheckIcon width='16' height='16' />
                Apply Trim
              </Button>
            </div>
          </div>

        {{else if (eq this.presentationStyle 'playlist-row')}}
          {{! ¹⁴ Playlist Row Presentation (Spotify-style) }}
          <div class='playlist-row'>
            <audio
              {{this.setupAudio}}
              src={{@model.url}}
              {{on 'play' this.handlePlay}}
              {{on 'pause' this.handlePause}}
              {{on 'timeupdate' this.handleTimeUpdate}}
              {{on 'loadedmetadata' this.handleLoadedMetadata}}
            ></audio>

            <IconButton
              @icon={{if this.isPlaying PauseIcon PlayIcon}}
              @width='16px'
              @height='16px'
              class='playlist-play-btn'
              {{on 'click' this.togglePlay}}
              aria-label={{if this.isPlaying 'Pause' 'Play'}}
            />

            <div class='playlist-cover'>
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

            <div class='playlist-info'>
              <div class='playlist-title {{if this.isPlaying "playing"}}'>
                {{@model.displayTitle}}
              </div>
              {{#if @model.artist}}
                <div class='playlist-artist'>{{@model.artist}}</div>
              {{/if}}
            </div>

            <div class='playlist-duration'>
              {{this.formatTime this.audioDuration}}
            </div>
          </div>

        {{else}}
          {{! ¹⁵ Default Inline Player }}
          <div class='audio-player'>
            <audio
              {{this.setupAudio}}
              src={{@model.url}}
              {{on 'play' this.handlePlay}}
              {{on 'pause' this.handlePause}}
              {{on 'timeupdate' this.handleTimeUpdate}}
              {{on 'loadedmetadata' this.handleLoadedMetadata}}
            ></audio>

            <div class='player-header'>
              <div class='audio-icon'>
                <MusicIcon width='24' height='24' />
              </div>
              <div class='audio-info'>
                <div class='audio-title'>{{@model.displayTitle}}</div>
                {{#if @model.artist}}
                  <div class='audio-artist'>{{@model.artist}}</div>
                {{/if}}
                <div class='audio-metadata'>
                  {{#if @model.fileSize}}
                    <span>{{this.formatFileSize @model.fileSize}}</span>
                  {{/if}}
                  {{#if (and @model.fileSize this.audioDuration)}}
                    <span> • </span>
                  {{/if}}
                  {{#if this.audioDuration}}
                    <span>{{this.formatTime this.audioDuration}}</span>
                  {{/if}}
                </div>
              </div>

              <Button
                @kind='primary'
                class='play-button'
                {{on 'click' this.togglePlay}}
              >
                {{#if this.isPlaying}}
                  <PauseIcon width='20' height='20' />
                {{else}}
                  <PlayIcon width='20' height='20' />
                {{/if}}
              </Button>
            </div>

            {{#if this.audioDuration}}
              <div class='player-controls'>
                <input
                  type='range'
                  min='0'
                  max={{this.audioDuration}}
                  value={{this.currentTime}}
                  {{on 'input' this.handleSeek}}
                  class='seek-bar'
                />
                <div class='time-display'>
                  <span>{{this.formatTime this.currentTime}}</span>
                  <span>{{this.formatTime this.audioDuration}}</span>
                </div>
              </div>
            {{/if}}

            {{#if this.showVolume}}
              <div class='volume-control'>
                <IconButton
                  @icon={{if
                    (or this.isMuted (eq this.volume 0))
                    VolumeXIcon
                    Volume2Icon
                  }}
                  @width='20px'
                  @height='20px'
                  class='volume-button'
                  {{on 'click' this.toggleMute}}
                  aria-label={{if this.isMuted 'Unmute' 'Mute'}}
                />
                <input
                  type='range'
                  min='0'
                  max='1'
                  step='0.01'
                  value={{this.volume}}
                  {{on 'input' this.handleVolumeChange}}
                  class='volume-slider'
                />
              </div>
            {{/if}}

            {{! ²⁴ Advanced Playback Controls }}
            {{#if (or this.showSpeedControl this.showLoopControl)}}
              <div class='advanced-controls'>
                {{#if this.showSpeedControl}}
                  <label class='control-label'>
                    <span>Speed:</span>
                    <div class='speed-select'>
                      <BoxelSelect
                        @selected={{hash
                          value=this.playbackRate
                          label=(concat this.playbackRate 'x')
                        }}
                        @options={{array
                          (hash value=0.5 label='0.5x')
                          (hash value=0.75 label='0.75x')
                          (hash value=1 label='1x')
                          (hash value=1.25 label='1.25x')
                          (hash value=1.5 label='1.5x')
                          (hash value=2 label='2x')
                        }}
                        @onChange={{this.handleSpeedChange}}
                        @placeholder='1x'
                        @matchTriggerWidth={{true}}
                        as |item|
                      >
                        {{item.label}}
                      </BoxelSelect>
                    </div>
                  </label>
                {{/if}}

                {{#if this.showLoopControl}}
                  <label class='control-label checkbox-label'>
                    <input
                      type='checkbox'
                      checked={{this.isLooping}}
                      {{on 'change' this.toggleLoop}}
                      class='loop-checkbox'
                    />
                    Loop
                  </label>
                {{/if}}
              </div>
            {{/if}}
          </div>
        {{/if}}
      {{else}}
        <div class='audio-placeholder'>
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
          <span>No audio file</span>
        </div>
      {{/if}}

      <style scoped>
        .audio-player {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
          background: var(--boxel-light, #ffffff);
          border: 1px solid var(--boxel-border-color, #e5e7eb);
          border-radius: var(--boxel-border-radius, 0.5rem);
        }

        .player-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .audio-icon {
          width: 3rem;
          height: 3rem;
          background: linear-gradient(
            135deg,
            var(--primary, #3b82f6),
            var(--accent, #60a5fa)
          );
          border-radius: var(--boxel-border-radius, 0.5rem);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
        }

        .audio-icon svg {
          width: 1.5rem;
          height: 1.5rem;
        }

        .audio-info {
          flex: 1;
          min-width: 0;
        }

        .audio-title {
          font-weight: 600;
          font-size: 0.875rem;
          color: var(--foreground, #1f2937);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .audio-artist {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          margin-top: 0.125rem;
        }

        .audio-metadata {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          margin-top: 0.25rem;
        }

        .play-button {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--primary, #3b82f6) !important;
          color: white !important;
        }

        .play-button:hover {
          background: var(--accent, #60a5fa) !important;
        }

        .player-controls {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .seek-bar {
          width: 100%;
          height: 0.25rem;
          background: var(--muted, #e5e7eb);
          border-radius: 0.125rem;
          appearance: none;
          cursor: pointer;
        }

        .seek-bar::-webkit-slider-thumb {
          appearance: none;
          width: 0.75rem;
          height: 0.75rem;
          background: var(--primary, #3b82f6);
          border-radius: 50%;
          cursor: pointer;
        }

        .seek-bar::-moz-range-thumb {
          width: 0.75rem;
          height: 0.75rem;
          background: var(--primary, #3b82f6);
          border-radius: 50%;
          cursor: pointer;
          border: none;
        }

        .time-display {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }

        .audio-placeholder {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 1rem;
          color: var(--muted-foreground, #6b7280);
          font-size: 0.875rem;
          font-style: italic;
          border: 1px dashed var(--border, #e5e7eb);
          border-radius: var(--radius, 0.5rem);
        }

        .audio-placeholder svg {
          width: 1.25rem;
          height: 1.25rem;
        }

        /* ¹⁶ Waveform Player Styles */
        .waveform-player {
          background: linear-gradient(
            135deg,
            var(--primary, #3b82f6),
            var(--accent, #60a5fa)
          );
          border-radius: var(--boxel-border-radius, 0.5rem);
          padding: var(--boxel-sp-lg);
          color: var(--boxel-light, #ffffff);
        }

        .waveform-header {
          margin-bottom: 1rem;
        }

        .waveform-title {
          font-weight: 600;
          font-size: 1rem;
          margin-bottom: 0.25rem;
        }

        .waveform-artist {
          font-size: 0.875rem;
          opacity: 0.9;
        }

        .waveform-container {
          margin: 1.5rem 0;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 0.25rem;
          padding: 0.5rem;
        }

        .waveform-bars {
          display: flex;
          align-items: center;
          gap: 0.125rem;
          height: 5rem;
        }

        .waveform-bar {
          flex: 1;
          border-radius: 0.125rem;
          cursor: pointer;
          transition: all 0.1s;
        }

        .waveform-bar.played {
          background: white;
        }

        .waveform-bar.unplayed {
          background: rgba(255, 255, 255, 0.3);
        }

        .waveform-bar:hover {
          opacity: 0.8;
        }

        .waveform-controls {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .waveform-play-btn {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--boxel-light, #ffffff) !important;
          color: var(--boxel-purple-500, #8b5cf6) !important;
        }

        .waveform-play-btn:hover {
          background: var(--boxel-200, #e5e7eb) !important;
        }

        .waveform-time {
          font-size: 0.875rem;
          font-weight: 500;
        }

        /* ¹⁷ Playlist Row Styles (Spotify-style) */
        .playlist-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem;
          border-radius: var(--radius, 0.5rem);
          transition: background 0.2s;
        }

        .playlist-row:hover {
          background: var(--muted, #f3f4f6);
        }

        .playlist-play-btn {
          width: 2rem;
          height: 2rem;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .playlist-cover {
          width: 3rem;
          height: 3rem;
          background: linear-gradient(
            135deg,
            var(--primary, #3b82f6),
            var(--accent, #60a5fa)
          );
          border-radius: var(--boxel-border-radius-sm, 0.25rem);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
        }

        .playlist-cover svg {
          width: 1.5rem;
          height: 1.5rem;
        }

        .playlist-info {
          flex: 1;
          min-width: 0;
        }

        .playlist-title {
          font-weight: 500;
          font-size: 0.875rem;
          color: var(--foreground, #1f2937);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .playlist-title.playing {
          color: var(--primary, #3b82f6);
        }

        .playlist-artist {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          margin-top: 0.125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .playlist-duration {
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }

        /* ¹⁸ Volume Control Styles */
        .volume-control {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding-top: 0.5rem;
          border-top: 1px solid var(--border, #e5e7eb);
        }

        .volume-button {
          width: 2rem;
          height: 2rem;
          border-radius: 0.25rem;
          flex-shrink: 0;
        }

        .volume-slider {
          flex: 1;
          height: 0.25rem;
          background: var(--muted, #e5e7eb);
          border-radius: 0.125rem;
          appearance: none;
          cursor: pointer;
        }

        .volume-slider::-webkit-slider-thumb {
          appearance: none;
          width: 0.75rem;
          height: 0.75rem;
          background: var(--primary, #3b82f6);
          border-radius: 50%;
          cursor: pointer;
        }

        .volume-slider::-moz-range-thumb {
          width: 0.75rem;
          height: 0.75rem;
          background: var(--primary, #3b82f6);
          border-radius: 50%;
          cursor: pointer;
          border: none;
        }

        /* ²⁵ Trim Editor Styles */
        .trim-editor {
          background: var(--boxel-light, #ffffff);
          border: 1px solid var(--boxel-border-color, #e5e7eb);
          border-radius: var(--boxel-border-radius, 0.5rem);
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }

        .trim-header {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .trim-title h4 {
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--foreground, #1f2937);
          margin: 0;
        }

        .trim-subtitle {
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
        }

        .trim-info-bar {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          padding: 1rem;
          background: var(--muted, #f3f4f6);
          border-radius: var(--radius, 0.5rem);
        }

        .trim-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
        }

        .stat-label {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--muted-foreground, #6b7280);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .stat-value {
          font-size: 1rem;
          font-weight: 600;
          color: var(--foreground, #1f2937);
          font-variant-numeric: tabular-nums;
        }

        .trim-waveform {
          position: relative;
          background: var(--muted, #f3f4f6);
          border-radius: 0.5rem;
          padding: 1rem;
        }

        .trim-waveform .waveform-bars {
          display: flex;
          align-items: center;
          gap: 0.125rem;
          height: 6rem;
          position: relative;
        }

        .trim-waveform .waveform-bar {
          flex: 1;
          border-radius: 0.125rem;
          transition: all 0.15s ease;
        }

        .trim-waveform .waveform-bar.in-range {
          background: var(--primary, #3b82f6);
          opacity: 1;
        }

        .trim-waveform .waveform-bar.out-range {
          background: var(--muted-foreground, #9ca3af);
          opacity: 0.2;
        }

        .trim-markers {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
        }

        .start-marker,
        .end-marker {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: var(--primary, #3b82f6);
        }

        .start-marker::before,
        .end-marker::before {
          content: '';
          position: absolute;
          top: -4px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 8px solid var(--primary, #3b82f6);
        }

        .trim-sliders {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 0 0.5rem;
        }

        .slider-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .slider-label {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--foreground, #1f2937);
        }

        .slider-value {
          font-variant-numeric: tabular-nums;
          color: var(--primary, #3b82f6);
          font-weight: 600;
        }

        .trim-slider {
          width: 100%;
          height: 0.5rem;
          background: var(--muted, #e5e7eb);
          border-radius: 0.25rem;
          appearance: none;
          cursor: pointer;
        }

        .trim-slider::-webkit-slider-thumb {
          appearance: none;
          width: 1.25rem;
          height: 1.25rem;
          background: var(--primary, #3b82f6);
          border-radius: 50%;
          cursor: grab;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          transition: all 0.2s;
        }

        .trim-slider::-webkit-slider-thumb:hover {
          background: var(--accent, #60a5fa);
          transform: scale(1.1);
        }

        .trim-slider::-webkit-slider-thumb:active {
          cursor: grabbing;
          transform: scale(1.15);
        }

        .trim-slider::-moz-range-thumb {
          width: 1.25rem;
          height: 1.25rem;
          background: var(--primary, #3b82f6);
          border-radius: 50%;
          cursor: grab;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          transition: all 0.2s;
        }

        .trim-slider::-moz-range-thumb:hover {
          background: var(--accent, #60a5fa);
          transform: scale(1.1);
        }

        .trim-slider::-moz-range-thumb:active {
          cursor: grabbing;
          transform: scale(1.15);
        }

        .start-slider::-webkit-slider-track {
          background: linear-gradient(
            to right,
            var(--muted, #e5e7eb) 0%,
            var(--primary, #3b82f6) 100%
          );
        }

        .end-slider::-webkit-slider-track {
          background: linear-gradient(
            to right,
            var(--primary, #3b82f6) 0%,
            var(--muted, #e5e7eb) 100%
          );
        }

        .trim-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 1rem;
          border-top: 1px solid var(--border, #e5e7eb);
        }

        .loop-toggle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1f2937);
          cursor: pointer;
          user-select: none;
        }

        .trim-apply-btn {
          padding: 0.625rem 1.25rem;
          background: var(--primary, #3b82f6) !important;
          color: white !important;
        }

        .trim-apply-btn:hover {
          background: var(--accent, #60a5fa) !important;
        }

        .playback-controls-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .control-btn {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--primary, #3b82f6) !important;
          color: white !important;
        }

        .control-btn:hover {
          background: var(--accent, #60a5fa) !important;
        }

        .time-display-inline {
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
        }

        /* ²⁸ Mini Player Styles (Podcast/Article) */
        .mini-player {
          position: relative;
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp) var(--boxel-sp-lg);
          background: var(--boxel-light, #ffffff);
          border: 1px solid var(--boxel-border-color, #e5e7eb);
          border-radius: var(--boxel-border-radius, 0.5rem);
          min-height: 60px;
        }

        .mini-play-btn {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--primary, #3b82f6) !important;
          color: white !important;
          padding: 0;
        }

        .mini-play-btn:hover {
          background: var(--accent, #60a5fa) !important;
        }

        .mini-info {
          flex: 1;
          min-width: 0;
          margin-right: auto;
        }

        .mini-title {
          font-weight: 600;
          font-size: 0.875rem;
          color: var(--foreground, #1f2937);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mini-artist {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          margin-top: 0.125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mini-skip-controls {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          flex-shrink: 0;
        }

        .skip-btn {
          width: 2rem;
          height: 2rem;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.125rem;
          font-size: 0.625rem;
          font-weight: 600;
          color: var(--muted-foreground, #6b7280);
        }

        .skip-btn svg {
          width: 0.875rem;
          height: 0.875rem;
        }

        .skip-btn:hover {
          color: var(--foreground, #1f2937);
          background: var(--muted, #f3f4f6);
        }

        .mini-time {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .time-separator {
          margin: 0 0.25rem;
        }

        .mini-progress-container {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: var(--muted, #e5e7eb);
          border-radius: 0 0 var(--radius, 0.5rem) var(--radius, 0.5rem);
          overflow: hidden;
        }

        .mini-progress-bar {
          height: 100%;
          background: var(--primary, #3b82f6);
          transition: width 0.1s linear;
        }

        /* ²⁹ Album/Cover Art Player Styles */
        .album-player {
          display: flex;
          flex-direction: column;
          background: var(--boxel-light, #ffffff);
          border: 1px solid var(--boxel-border-color, #e5e7eb);
          border-radius: var(--boxel-border-radius, 0.5rem);
          overflow: hidden;
        }

        .album-cover {
          position: relative;
          width: 100%;
          aspect-ratio: 1;
          overflow: hidden;
        }

        .cover-gradient {
          width: 100%;
          height: 100%;
          background: linear-gradient(
            135deg,
            var(--primary, #3b82f6) 0%,
            var(--accent, #60a5fa) 50%,
            var(--primary, #3b82f6) 100%
          );
        }

        .cover-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .album-player:hover .cover-overlay {
          opacity: 1;
        }

        .album-play-btn {
          width: 5rem;
          height: 5rem;
          border-radius: 50%;
          background: white !important;
          color: var(--primary, #3b82f6) !important;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3) !important;
          transition: all 0.2s;
        }

        .album-play-btn:hover {
          background: rgba(255, 255, 255, 0.95) !important;
          transform: scale(1.05);
        }

        .album-info {
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .album-title {
          font-weight: 700;
          font-size: 1.125rem;
          color: var(--foreground, #1f2937);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .album-artist {
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-top: -0.5rem;
        }

        .album-progress {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .album-progress-bar {
          width: 100%;
          height: 0.375rem;
          background: var(--muted, #e5e7eb);
          border-radius: 0.1875rem;
          overflow: hidden;
        }

        .album-progress-fill {
          height: 100%;
          background: var(--primary, #3b82f6);
          transition: width 0.1s linear;
        }

        .album-time {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          font-variant-numeric: tabular-nums;
        }

        .album-time span {
          margin: 0 0.25rem;
        }

        /* ²⁶ Advanced Controls Styles */
        .advanced-controls {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding-top: 0.5rem;
          border-top: 1px solid var(--border, #e5e7eb);
        }

        .control-label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--foreground, #1f2937);
        }

        .checkbox-label {
          cursor: pointer;
          user-select: none;
        }

        .loop-checkbox {
          width: 1rem;
          height: 1rem;
          cursor: pointer;
          accent-color: var(--primary, #3b82f6);
        }

        .speed-select {
          min-width: 128px;
        }

        .control-label {
          gap: 0.5rem;
        }

        .control-label span {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // ⁹ Atom format - minimal display
  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='audio-atom'>
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
        {{@model.displayTitle}}
      </span>

      <style scoped>
        .audio-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.875rem;
          color: var(--foreground, #1f2937);
        }

        .audio-atom svg {
          width: 1rem;
          height: 1rem;
          color: var(--primary, #3b82f6);
        }
      </style>
    </template>
  };

  // ¹⁰ Fitted format - card view with play overlay
  static fitted = class Fitted extends Component<typeof this> {
    @tracked isPlaying = false;
    @tracked currentTime = 0;
    @tracked audioDuration = 0;
    @tracked isHovering = false;
    audioElement: HTMLAudioElement | null = null;

    // ²¹ Progress getter for fitted format
    get progressPercentage(): number {
      if (!this.audioDuration || this.audioDuration === 0) return 0;
      return (this.currentTime / this.audioDuration) * 100;
    }

    setupAudio = modifier((element: HTMLAudioElement) => {
      this.audioElement = element;
      return () => {
        this.audioElement = null;
      };
    });

    @action
    togglePlay() {
      if (!this.audioElement) return;

      if (this.isPlaying) {
        this.audioElement.pause();
      } else {
        this.audioElement.play();
      }
    }

    @action
    handlePlay() {
      this.isPlaying = true;
    }

    @action
    handlePause() {
      this.isPlaying = false;
    }

    @action
    handleTimeUpdate(event: Event) {
      const audio = event.target as HTMLAudioElement;
      this.currentTime = audio.currentTime;
    }

    @action
    handleLoadedMetadata(event: Event) {
      const audio = event.target as HTMLAudioElement;
      this.audioDuration = audio.duration;
    }

    @action
    handleMouseEnter() {
      this.isHovering = true;
    }

    @action
    handleMouseLeave() {
      this.isHovering = false;
    }

    formatTime(seconds: number): string {
      if (!seconds || isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    <template>
      {{#if @model.url}}
        <div
          class='audio-card'
          {{on 'mouseenter' this.handleMouseEnter}}
          {{on 'mouseleave' this.handleMouseLeave}}
          style='width: 100%; height: 100%'
        >
          <audio
            {{this.setupAudio}}
            src={{@model.url}}
            {{on 'play' this.handlePlay}}
            {{on 'pause' this.handlePause}}
            {{on 'timeupdate' this.handleTimeUpdate}}
            {{on 'loadedmetadata' this.handleLoadedMetadata}}
          ></audio>

          <div class='card-background'>
            <svg
              class='background-icon'
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

          {{#if (or this.isHovering this.isPlaying)}}
            <div class='play-overlay'>
              <Button
                @kind='primary'
                class='play-overlay-button'
                {{on 'click' this.togglePlay}}
              >
                {{#if this.isPlaying}}
                  <PauseIcon width='32' height='32' />
                {{else}}
                  <PlayIcon width='32' height='32' />
                {{/if}}
              </Button>
            </div>
          {{/if}}

          {{#if this.audioDuration}}
            <div class='duration-badge'>
              {{this.formatTime this.audioDuration}}
            </div>
          {{/if}}

          <div class='card-footer'>
            <div class='card-title'>{{@model.displayTitle}}</div>
            {{#if @model.artist}}
              <div class='card-artist'>{{@model.artist}}</div>
            {{/if}}

            {{#if (and this.isPlaying this.audioDuration)}}
              <div class='progress-bar'>
                <div
                  class='progress-fill'
                  style='width: {{this.progressPercentage}}%'
                ></div>
              </div>
            {{/if}}
          </div>
        </div>
      {{else}}
        <div class='audio-card-placeholder' style='width: 100%; height: 100%'>
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
          <span>No audio</span>
        </div>
      {{/if}}

      <style scoped>
        .audio-card {
          position: relative;
          background: var(--card, #ffffff);
          border-radius: var(--radius, 0.5rem);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
          transition: all 0.2s;
        }

        .audio-card:hover {
          box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
        }

        .card-background {
          flex: 1;
          background: linear-gradient(
            135deg,
            var(--primary, #3b82f6),
            var(--accent, #60a5fa)
          );
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          min-height: 8rem;
        }

        .background-icon {
          width: 4rem;
          height: 4rem;
          color: rgba(255, 255, 255, 0.3);
        }

        .play-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(2px);
        }

        .play-overlay-button {
          width: 4rem;
          height: 4rem;
          border-radius: 50%;
          background: white !important;
          color: var(--primary, #3b82f6) !important;
          box-shadow:
            0 4px 6px -1px rgb(0 0 0 / 0.1),
            0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
        }

        .play-overlay-button:hover {
          background: rgba(255, 255, 255, 0.95) !important;
          transform: scale(1.05);
        }

        .duration-badge {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          padding: 0.25rem 0.5rem;
          background: rgba(0, 0, 0, 0.7);
          color: white;
          font-size: 0.75rem;
          border-radius: 0.25rem;
          backdrop-filter: blur(4px);
        }

        .card-footer {
          padding: 0.75rem;
          background: var(--card, #ffffff);
        }

        .card-title {
          font-weight: 600;
          font-size: 0.875rem;
          color: var(--foreground, #1f2937);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .card-artist {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          margin-top: 0.125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .progress-bar {
          height: 0.25rem;
          background: var(--muted, #e5e7eb);
          border-radius: 0.125rem;
          overflow: hidden;
          margin-top: 0.5rem;
        }

        .progress-fill {
          height: 100%;
          background: var(--primary, #3b82f6);
          transition: width 0.1s linear;
        }

        .audio-card-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          background: var(--muted, #f3f4f6);
          border-radius: var(--radius, 0.5rem);
          color: var(--muted-foreground, #6b7280);
          font-size: 0.875rem;
          font-style: italic;
        }

        .audio-card-placeholder svg {
          width: 2rem;
          height: 2rem;
        }
      </style>
    </template>
  };

  // ¹¹ Edit format - upload interface
  static edit = class Edit extends Component<typeof this> {
    @action
    handleFileSelect(event: Event) {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      // Create object URL for the file
      const url = URL.createObjectURL(file);

      // Update model fields
      this.args.model.url = url;
      this.args.model.filename = file.name;
      this.args.model.mimeType = file.type;
      this.args.model.fileSize = file.size;

      // Extract duration via audio element
      const audio = new Audio(url);
      audio.addEventListener('loadedmetadata', () => {
        this.args.model.duration = audio.duration;
      });
    }

    <template>
      <div class='audio-edit'>
        {{#if @model.url}}
          <div class='uploaded-file'>
            <div class='file-icon'>
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
            <div class='file-info'>
              <div class='file-name'>{{@model.filename}}</div>
              {{#if @model.duration}}
                <div class='file-meta'>
                  Duration:
                  {{@model.duration}}
                  seconds
                </div>
              {{/if}}
            </div>
            <label class='change-button'>
              Change
              <input
                type='file'
                accept='audio/*'
                {{on 'change' this.handleFileSelect}}
                class='hidden-input'
              />
            </label>
          </div>

          <div class='metadata-fields'>
            <FieldContainer @label='Title'>
              <BoxelInput
                @value={{@model.title}}
                @onInput={{fn (mut @model.title)}}
                placeholder='Track title'
              />
            </FieldContainer>

            <FieldContainer @label='Artist'>
              <BoxelInput
                @value={{@model.artist}}
                @onInput={{fn (mut @model.artist)}}
                placeholder='Artist name'
              />
            </FieldContainer>
          </div>
        {{else}}
          <label class='upload-area'>
            <div class='upload-icon'>
              <UploadIcon width='48' height='48' />
            </div>
            <div class='upload-text'>
              <div class='upload-title'>Click to upload audio</div>
              <div class='upload-subtitle'>MP3, WAV, OGG, M4A, FLAC</div>
            </div>
            <input
              type='file'
              accept='audio/*'
              {{on 'change' this.handleFileSelect}}
              class='hidden-input'
            />
          </label>
        {{/if}}
      </div>

      <style scoped>
        .audio-edit {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .upload-area {
          border: 2px dashed var(--border, #e5e7eb);
          border-radius: var(--radius, 0.5rem);
          padding: 3rem 1.5rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: var(--card, #ffffff);
        }

        .upload-area:hover {
          border-color: var(--primary, #3b82f6);
          background: var(--accent, #f0f9ff);
        }

        .upload-icon {
          width: 3rem;
          height: 3rem;
          margin: 0 auto 1rem;
          color: var(--muted-foreground, #6b7280);
        }

        .upload-icon svg {
          width: 100%;
          height: 100%;
        }

        .upload-title {
          font-weight: 600;
          font-size: 1rem;
          color: var(--foreground, #1f2937);
          margin-bottom: 0.25rem;
        }

        .upload-subtitle {
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
        }

        .uploaded-file {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          background: var(--muted, #f3f4f6);
          border-radius: var(--radius, 0.5rem);
        }

        .file-icon {
          width: 2.5rem;
          height: 2.5rem;
          background: linear-gradient(
            135deg,
            var(--primary, #3b82f6),
            var(--accent, #60a5fa)
          );
          border-radius: var(--boxel-border-radius, 0.5rem);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
        }

        .file-icon svg {
          width: 1.5rem;
          height: 1.5rem;
        }

        .file-info {
          flex: 1;
          min-width: 0;
        }

        .file-name {
          font-weight: 600;
          font-size: 0.875rem;
          color: var(--foreground, #1f2937);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .file-meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          margin-top: 0.125rem;
        }

        .change-button {
          padding: 0.5rem 1rem;
          background: var(--primary, #3b82f6);
          color: var(--primary-foreground, #ffffff);
          border-radius: var(--radius, 0.5rem);
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .change-button:hover {
          background: var(--accent, #60a5fa);
        }

        .metadata-fields {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }

        .hidden-input {
          display: none;
        }
      </style>
    </template>
  };
}
