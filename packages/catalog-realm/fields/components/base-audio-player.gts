import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { modifier } from 'ember-modifier';
import GlimmerComponent from '@glimmer/component';

// Type definitions for AudioField model
export interface AudioFieldModel {
  url?: string;
  filename?: string;
  mimeType?: string;
  duration?: number;
  fileSize?: number;
  title?: string;
  artist?: string;
  waveformData?: string;
  trimStart?: number;
  trimEnd?: number;
  playbackRate?: number;
  loopEnabled?: boolean;
  loopStart?: number;
  loopEnd?: number;
  displayTitle?: string;
}

export type AudioPresentationStyle =
  | 'default'
  | 'inline-player'
  | 'waveform-player'
  | 'mini-player'
  | 'album-cover'
  | 'trim-editor'
  | 'playlist-row';

export interface AudioFieldOptions {
  showVolume?: boolean;
  showWaveform?: boolean;
  showSpeedControl?: boolean;
  showLoopControl?: boolean;
  showPlayCount?: boolean;
  showLikeButton?: boolean;
  enableTrimming?: boolean;
  compactMode?: boolean;
}

export interface AudioFieldConfiguration {
  presentation?: AudioPresentationStyle;
  options?: AudioFieldOptions;
}

interface BaseAudioPlayerSignature {
  Args: {
    model: AudioFieldModel;
    options?: AudioFieldOptions;
    configuration?: AudioFieldConfiguration;
  };
  Blocks: {
    default: [BaseAudioPlayer];
  };
}

export class BaseAudioPlayer extends GlimmerComponent<BaseAudioPlayerSignature> {
  @tracked isPlaying = false;
  @tracked currentTime = 0;
  @tracked audioDuration = 0;
  @tracked volume = 1;
  @tracked isMuted = false;
  @tracked playbackRate = 1;
  @tracked isLooping = false;
  @tracked trimStart = 0;
  @tracked trimEnd = 100; // Percentage

  @tracked waveformBars: number[] = [];

  audioElement: HTMLAudioElement | null = null;

  private _isGeneratingWaveform = false;

  // Type-safe model accessor
  get model(): AudioFieldModel {
    return this.args.model;
  }

  // Type-safe options accessor
  get options(): AudioFieldOptions {
    return this.args.options ?? {};
  }

  get displayWaveform(): number[] {
    if (this.waveformBars.length > 0) {
      return this.waveformBars;
    }
    if (this.model.waveformData) {
      try {
        return JSON.parse(this.model.waveformData);
      } catch {
        return this.generateFallbackWaveform();
      }
    }
    return this.generateFallbackWaveform();
  }

  generateFallbackWaveform(): number[] {
    return Array.from({ length: 80 }, () => 20 + Math.random() * 80);
  }

  setupAudio = modifier((element: HTMLAudioElement) => {
    this.audioElement = element;

    if (this.model.url && this.waveformBars.length === 0) {
      setTimeout(() => {
        this.generateRealWaveform(this.model.url!);
      }, 0);
    }

    return () => {
      if (this.audioElement) {
        // Pause the audio
        this.audioElement.pause();
        // Reset playback position
        this.audioElement.currentTime = 0;
      }

      // Reset all playback state
      this.isPlaying = false;
      this.currentTime = 0;
    };
  });

  async generateRealWaveform(url: string) {
    if (this._isGeneratingWaveform) return;
    this._isGeneratingWaveform = true;

    try {
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();

      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const rawData = audioBuffer.getChannelData(0);
      const samples = 80;
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

      // Update waveform bars
      this.waveformBars = filteredData;

      // Save to model for persistence
      if (this.model) {
        (this.model as AudioFieldModel).waveformData =
          JSON.stringify(filteredData);
      }

      await audioContext.close();
    } catch (error) {
      console.warn('Failed to generate waveform, using fallback:', error);
      this.waveformBars = this.generateFallbackWaveform();
    } finally {
      this._isGeneratingWaveform = false;
    }
  }

  @action
  togglePlay(): void {
    if (!this.audioElement) return;

    if (this.isPlaying) {
      this.audioElement.pause();
    } else {
      if (
        this.model.trimStart != null &&
        this.audioElement.currentTime < this.model.trimStart
      ) {
        this.audioElement.currentTime = this.model.trimStart;
      }
      this.audioElement.play();
    }
  }

  @action
  handlePlay(): void {
    this.isPlaying = true;
  }

  @action
  handlePause(): void {
    this.isPlaying = false;
  }

  @action
  handleTimeUpdate(event: Event): void {
    const audio = event.target as HTMLAudioElement;
    this.currentTime = audio.currentTime;
  }

  @action
  handleLoadedMetadata(event: Event): void {
    const audio = event.target as HTMLAudioElement;
    this.audioDuration = audio.duration;

    if (this.model.trimStart != null && this.model.trimEnd != null) {
      this.trimStart = (this.model.trimStart / audio.duration) * 100;
      this.trimEnd = (this.model.trimEnd / audio.duration) * 100;
      // Set audio position to trim start
      audio.currentTime = this.model.trimStart;
      this.currentTime = this.model.trimStart;
    }
  }

  @action
  handleSeek(event: Event): void {
    if (!this.audioElement) return;
    const input = event.target as HTMLInputElement;
    const seekValue = parseFloat(input.value);

    // If trimmed, the seek value is relative to the trim start
    if (this.model.trimStart != null && this.model.trimEnd != null) {
      this.audioElement.currentTime = this.model.trimStart + seekValue;
    } else {
      this.audioElement.currentTime = seekValue;
    }
  }

  @action
  handleVolumeChange(event: Event): void {
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
  toggleMute(): void {
    if (!this.audioElement) return;
    this.isMuted = !this.isMuted;
    this.audioElement.muted = this.isMuted;
  }

  @action
  skipTime(seconds: number): void {
    if (!this.audioElement) return;

    // Determine boundaries (either trim bounds or full audio bounds)
    const minTime = this.model.trimStart ?? 0;
    const maxTime = this.model.trimEnd ?? this.audioDuration;

    const newTime = Math.max(
      minTime,
      Math.min(this.audioElement.currentTime + seconds, maxTime),
    );
    this.audioElement.currentTime = newTime;
  }

  @action
  seekToPosition(index: number): void {
    if (!this.audioElement || !this.audioDuration) return;

    // Check if we have valid trim values (both must be set and trimEnd > trimStart)
    const hasTrim =
      this.model.trimStart != null &&
      this.model.trimEnd != null &&
      this.model.trimEnd > this.model.trimStart;

    if (hasTrim) {
      // If trimmed, seek within the trimmed range
      const trimDuration = this.model.trimEnd! - this.model.trimStart!;
      const relativePosition =
        (index / this.displayWaveform.length) * trimDuration;
      this.audioElement.currentTime = this.model.trimStart! + relativePosition;
    } else {
      // No trim - seek within full audio duration
      const position =
        (index / this.displayWaveform.length) * this.audioDuration;
      this.audioElement.currentTime = position;
    }
  }

  @action
  handleSpeedChange(selected: { value: number }): void {
    if (!this.audioElement) return;
    this.playbackRate = selected.value;
    this.audioElement.playbackRate = this.playbackRate;
  }

  @action
  toggleLoop(): void {
    this.isLooping = !this.isLooping;
    if (this.audioElement) {
      this.audioElement.loop = this.isLooping;
    }
  }

  @action
  handleTrimStartChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const newValue = parseFloat(input.value);
    // Ensure start doesn't exceed end
    this.trimStart = Math.min(newValue, this.trimEnd - 0.1);
  }

  @action
  handleTrimEndChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const newValue = parseFloat(input.value);
    // Ensure end doesn't go below start
    this.trimEnd = Math.max(newValue, this.trimStart + 0.1);
  }

  @action
  applyTrim(): void {
    if (!this.audioElement || !this.audioDuration) return;

    // If sliders are at 0% and 100% (or very close), clear the trim values
    const isFullRange = this.trimStart <= 0.1 && this.trimEnd >= 99.9;

    if (isFullRange) {
      // Clear trim values to indicate no trimming
      this.args.model.trimStart = undefined;
      this.args.model.trimEnd = undefined;
      // Restore original duration
      this.args.model.duration = this.audioDuration;
    } else {
      // Calculate trim values in seconds from the current slider positions
      const trimStartSeconds = (this.trimStart / 100) * this.audioDuration;
      const trimEndSeconds = (this.trimEnd / 100) * this.audioDuration;

      // Save trim values as seconds (the model stores seconds, not percentages)
      this.args.model.trimStart = trimStartSeconds;
      this.args.model.trimEnd = trimEndSeconds;

      // Update duration to reflect the trimmed length
      this.args.model.duration = trimEndSeconds - trimStartSeconds;
    }

    // Keep sliders at their current positions (don't reset)
  }

  @action
  handleTimeUpdateWithTrim(event: Event): void {
    const audio = event.target as HTMLAudioElement;
    this.currentTime = audio.currentTime;

    // Handle trimmed playback
    if (this.model.trimEnd != null && audio.currentTime >= this.model.trimEnd) {
      if (this.isLooping && this.model.trimStart != null) {
        audio.currentTime = this.model.trimStart;
      } else {
        audio.pause();
      }
    }
  }

  // ¹⁵ Computed properties and helpers
  get progressPercentage(): number {
    // If trimmed, calculate progress relative to the trimmed range
    if (this.model.trimStart != null && this.model.trimEnd != null) {
      const trimDuration = this.model.trimEnd - this.model.trimStart;
      if (trimDuration <= 0) return 0;
      const relativeTime = Math.max(0, this.currentTime - this.model.trimStart);
      return Math.min(100, (relativeTime / trimDuration) * 100);
    }
    // Otherwise use full duration
    if (!this.audioDuration || this.audioDuration === 0) return 0;
    return (this.currentTime / this.audioDuration) * 100;
  }

  get hasTrim(): boolean {
    // Check if we have active trim (either from sliders or saved model)
    const hasSliderTrim = this.trimStart > 0.1 || this.trimEnd < 99.9;
    const hasModelTrim =
      this.model.trimStart != null &&
      this.model.trimEnd != null &&
      this.model.trimEnd > this.model.trimStart;
    return hasSliderTrim || hasModelTrim;
  }

  get effectiveTrimStart(): number {
    // Use slider-based value (in seconds) - this reflects current UI state
    return this.trimStartSeconds;
  }

  get effectiveTrimEnd(): number {
    // Use slider-based value (in seconds) - this reflects current UI state
    return this.trimEndSeconds;
  }

  get displayDuration(): number {
    // Show duration based on current trim sliders
    if (this.hasTrim) {
      return this.trimDurationSeconds;
    }
    return this.audioDuration;
  }

  get displayCurrentTime(): number {
    // Show time relative to current trim start
    if (this.hasTrim) {
      const relativeTime = Math.max(
        0,
        this.currentTime - this.effectiveTrimStart,
      );
      return Math.min(relativeTime, this.trimDurationSeconds);
    }
    return this.currentTime;
  }

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

  get trimStartFormatted(): string {
    return this.trimStart.toFixed(2);
  }

  get trimEndFormatted(): string {
    return this.trimEnd.toFixed(2);
  }

  isBarPlayed = (index: number): boolean => {
    if (!this.audioDuration || !this.displayWaveform.length) return false;
    const barProgress = (index / this.displayWaveform.length) * 100;
    return barProgress <= this.progressPercentage;
  };

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

  get presentationStyle(): AudioPresentationStyle {
    return this.args.configuration?.presentation ?? 'inline-player';
  }

  get showVolume(): boolean {
    return this.options.showVolume ?? false;
  }

  get showWaveform(): boolean {
    return this.options.showWaveform ?? false;
  }

  get showSpeedControl(): boolean {
    return this.options.showSpeedControl ?? false;
  }

  get showLoopControl(): boolean {
    return this.options.showLoopControl ?? false;
  }

  <template>
    {{yield this}}
  </template>
}
