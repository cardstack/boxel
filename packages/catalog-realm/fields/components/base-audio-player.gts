import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { modifier } from 'ember-modifier';
import GlimmerComponent from '@glimmer/component';

// ² Component signature for proper typing
interface BaseAudioPlayerSignature<T> {
  Args: {
    model: any;
    configuration?: any;
  };
  Blocks: {
    default: [BaseAudioPlayer<T>];
  };
}

// ² Base audio player class with shared state and logic
export class BaseAudioPlayer<T> extends GlimmerComponent<
  BaseAudioPlayerSignature<T>
> {
  // ³ Shared reactive state
  @tracked isPlaying = false;
  @tracked currentTime = 0;
  @tracked audioDuration = 0;
  @tracked volume = 1;
  @tracked isMuted = false;
  @tracked playbackRate = 1;
  @tracked isLooping = false;
  @tracked trimStart = 0;
  @tracked trimEnd = 100; // Percentage

  // ⁴ Real waveform data
  @tracked waveformBars: number[] = [];

  // ⁵ Audio element reference
  audioElement: HTMLAudioElement | null = null;

  // ⁶ Internal flag to prevent concurrent waveform generation
  private _isGeneratingWaveform = false;

  // ⁷ Waveform display logic
  get displayWaveform() {
    if (this.waveformBars.length > 0) {
      return this.waveformBars;
    }
    if ((this.args as any).model?.waveformData) {
      try {
        return JSON.parse((this.args as any).model.waveformData);
      } catch {
        return this.generateFallbackWaveform();
      }
    }
    return this.generateFallbackWaveform();
  }

  // ⁸ Fallback waveform generator
  generateFallbackWaveform() {
    return Array.from({ length: 80 }, () => 20 + Math.random() * 80);
  }

  // ⁹ Audio element setup modifier
  setupAudio = modifier((element: HTMLAudioElement) => {
    this.audioElement = element;

    // Generate real waveform when audio is loaded
    if ((this.args as any).model?.url && this.waveformBars.length === 0) {
      setTimeout(() => {
        this.generateRealWaveform((this.args as any).model.url);
      }, 0);
    }

    return () => {
      this.audioElement = null;
    };
  });

  // ¹⁰ Real waveform generation using Web Audio API
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

      // Update waveform bars
      this.waveformBars = filteredData;

      // Save to model for persistence
      if ((this.args as any).model) {
        (this.args as any).model.waveformData = JSON.stringify(filteredData);
      }

      // Close audio context to free resources
      await audioContext.close();
    } catch (error) {
      console.warn('Failed to generate waveform, using fallback:', error);
      this.waveformBars = this.generateFallbackWaveform();
    } finally {
      this._isGeneratingWaveform = false;
    }
  }

  // ¹¹ Playback control actions
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

  // ¹² Volume control actions
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

  // ¹³ Advanced playback actions
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
    const position = (index / this.displayWaveform.length) * this.audioDuration;
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

  // ¹⁴ Trim control actions
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
    (this.args as any).model.trimStart =
      (this.trimStart / 100) * this.audioDuration;
    (this.args as any).model.trimEnd =
      (this.trimEnd / 100) * this.audioDuration;

    // Seek to trim start
    this.audioElement.currentTime = (this.args as any).model.trimStart;
  }

  @action
  handleTimeUpdateWithTrim(event: Event) {
    const audio = event.target as HTMLAudioElement;
    this.currentTime = audio.currentTime;

    // Handle trimmed playback
    if (
      (this.args as any).model?.trimEnd &&
      audio.currentTime >= (this.args as any).model.trimEnd
    ) {
      if (this.isLooping && (this.args as any).model.trimStart) {
        audio.currentTime = (this.args as any).model.trimStart;
      } else {
        audio.pause();
      }
    }
  }

  // ¹⁵ Computed properties and helpers
  get progressPercentage(): number {
    if (!this.audioDuration || this.audioDuration === 0) return 0;
    return (this.currentTime / this.audioDuration) * 100;
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

  // ¹⁶ Helper to check if waveform bar is played
  isBarPlayed = (index: number): boolean => {
    if (!this.audioDuration || !this.displayWaveform.length) return false;
    const barProgress = (index / this.displayWaveform.length) * 100;
    return barProgress <= this.progressPercentage;
  };

  // ¹⁷ Utility formatters
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

  // ¹⁸ Configuration getters
  get presentationStyle() {
    return (
      (this.args as any).configuration?.presentation?.style ?? 'inline-player'
    );
  }

  get showVolume() {
    return (this.args as any).configuration?.presentation?.showVolume ?? false;
  }

  get showWaveform() {
    return (
      (this.args as any).configuration?.presentation?.showWaveform ?? false
    );
  }

  get showSpeedControl() {
    return (
      (this.args as any).configuration?.presentation?.showSpeedControl ?? false
    );
  }

  get showLoopControl() {
    return (
      (this.args as any).configuration?.presentation?.showLoopControl ?? false
    );
  }

  // ¹⁹ Template that yields player context
  <template>
    {{yield this}}
  </template>
}
