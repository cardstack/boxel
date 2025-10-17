import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import MusicIcon from '@cardstack/boxel-icons/music';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn, concat } from '@ember/helper';
import { gt, eq } from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import type Owner from '@ember/owner';

class RecordingStudioIsolated extends Component<typeof RecordingStudioCard> {
  // ⁵² Basic recording studio - simplified to match actual functionality
  @tracked currentTime = 0;

  // ⁵⁷ Use model values directly instead of separate tracked properties
  get isRecording() {
    return this.args.model?.isRecording || false;
  }

  get projectName() {
    return this.args.model?.projectName || 'Untitled Project';
  }

  get inputGain() {
    return this.args.model?.inputGain || 50;
  }

  get outputVolume() {
    return this.args.model?.outputVolume || 75;
  }

  // ⁵³ Basic audio recording setup
  audioContext: AudioContext | null = null;
  mediaRecorder: MediaRecorder | null = null;
  recordingTimer: number | null = null;
  stream: MediaStream | null = null;
  gainNode: GainNode | null = null; // ⁶⁶ Web Audio gain node for input control

  @tracked recordingTime: string = '00:00';
  @tracked recordings: Array<{
    id: string;
    name: string;
    blob: Blob;
    url: string;
    duration: number;
  }> = [];

  @tracked recordedChunks: Blob[] = [];
  @tracked currentPlayingId: string | null = null;
  finalRecordingDuration: number = 0;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.initializeAudio();
  }

  async initializeAudio() {
    try {
      this.audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  async startRecording() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // ⁶⁵ Create Web Audio API chain for real-time monitoring while using original stream for recording
      if (this.audioContext && this.stream) {
        // Create monitoring chain for input gain control
        const source = this.audioContext.createMediaStreamSource(this.stream);
        const gainNode = this.audioContext.createGain();

        // Apply the input gain from model (0-100 -> 0.0-2.0 for reasonable range)
        gainNode.gain.value = (this.inputGain / 100) * 2.0;

        // Connect for monitoring only (output to speakers for user feedback)
        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Store gain node reference for real-time updates
        this.gainNode = gainNode;
      }

      // Use the original stream directly for recording to ensure data capture
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      this.recordedChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        try {
          await this.saveRecording();
        } catch (error) {
          console.error('Error in onstop handler:', error);
        }
      };

      // Start the actual recording
      this.mediaRecorder.start();

      // ⁵⁸ Update model values when recording starts
      if (this.args.model) {
        this.args.model.isRecording = true;
      }

      // Clear any existing timer and reset
      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
      }
      this.currentTime = 0;
      this.recordingTime = '00:00';
      this.finalRecordingDuration = 0;

      // Start recording timer and update model
      this.recordingTimer = window.setInterval(() => {
        this.currentTime += 1;
        const minutes = Math.floor(this.currentTime / 60);
        const seconds = this.currentTime % 60;
        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds
          .toString()
          .padStart(2, '0')}`;

        this.recordingTime = timeString;
      }, 1000);
    } catch (error) {
      alert('Unable to access microphone. Please check permissions.');
    }
  }

  stopRecording() {
    // Store the final recording duration before resetting
    this.finalRecordingDuration = this.currentTime;

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      // Request data before stopping to ensure chunks are captured
      this.mediaRecorder.requestData();
      this.mediaRecorder.stop();
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }

    // Reset timer display
    this.currentTime = 0;
    this.recordingTime = '00:00';

    // ⁶⁸ Clean up Web Audio API nodes
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    // ⁶⁰ Update model when recording stops
    if (this.args.model) {
      this.args.model.isRecording = false;
    }
  }

  // Basic playback functionality
  @action
  playRecording(recordingId: string) {
    // Stop any currently playing recording
    if (this.currentPlayingId) {
      this.stopPlayback();
    }

    const recording = this.recordings.find((r) => r.id === recordingId);
    if (!recording) return;

    const audio = new Audio(recording.url);
    // ⁶⁴ Use the actual model output volume for playback
    audio.volume = this.outputVolume / 100;

    audio.onended = () => {
      this.currentPlayingId = null;
    };

    audio.onerror = () => {
      this.currentPlayingId = null;
    };

    this.currentPlayingId = recordingId;
    audio.play().catch(() => {
      this.currentPlayingId = null;
    });
  }

  @action
  stopPlayback() {
    this.currentPlayingId = null;
  }

  @action
  downloadRecording(recordingId: string) {
    const recording = this.recordings.find((r) => r.id === recordingId);
    if (!recording) return;

    const link = document.createElement('a');
    link.href = recording.url;
    link.download = `${recording.name}.webm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  @action
  deleteRecording(recordingId: string) {
    const recording = this.recordings.find((r) => r.id === recordingId);
    if (recording) {
      URL.revokeObjectURL(recording.url);
    }

    this.recordings = this.recordings.filter((r) => r.id !== recordingId);

    if (this.currentPlayingId === recordingId) {
      this.stopPlayback();
    }
  }

  @action
  toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  @action
  updateInputGain(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);
    // ⁶¹ Update the model's input gain
    if (this.args.model) {
      this.args.model.inputGain = value;
    }

    // ⁶⁷ Apply gain change in real-time during recording
    if (this.gainNode && this.isRecording) {
      // Convert 0-100 range to 0.0-2.0 for reasonable audio gain
      this.gainNode.gain.value = (value / 100) * 2.0;
    }
  }

  @action
  updateOutputVolume(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);
    // ⁶² Update the model's output volume
    if (this.args.model) {
      this.args.model.outputVolume = value;
    }
  }

  @action
  updateProjectName(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = target.value;
    // ⁶³ Update the model's project name
    if (this.args.model) {
      this.args.model.projectName = value;
    }
  }

  // ⁷³ Simplified saveRecording method for temporary storage only
  saveRecording() {
    if (this.recordedChunks.length === 0) {
      return;
    }

    const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toLocaleString();
    const recordingName = `Recording ${timestamp}`;

    const recording = {
      id: Date.now().toString(),
      name: recordingName,
      blob: blob,
      url: url,
      duration: this.finalRecordingDuration,
    };

    this.recordings = [...this.recordings, recording];
    this.recordedChunks = [];
  }

  <template>
    <div class='recording-studio'>
      <div class='studio-header'>
        <div class='project-info'>
          <h3>Simple Audio Recorder</h3>
          <label for='project-name-input' class='sr-only'>Project Name</label>
          <input
            type='text'
            value={{this.projectName}}
            class='project-name-input'
            id='project-name-input'
            placeholder='Project Name'
            {{on 'input' this.updateProjectName}}
          />
        </div>

        <div class='recording-status'>
          <span class='recording-time'>{{this.recordingTime}}</span>
        </div>
      </div>

      <div class='recording-controls'>
        <Button
          class='record-btn {{if this.isRecording "recording" ""}}'
          {{on 'click' this.toggleRecording}}
        >
          {{#if this.isRecording}}
            <svg viewBox='0 0 24 24' fill='currentColor'>
              <rect x='6' y='6' width='12' height='12' />
            </svg>
            Stop Recording
          {{else}}
            <svg viewBox='0 0 24 24' fill='currentColor'>
              <circle cx='12' cy='12' r='8' />
            </svg>
            Start Recording
          {{/if}}
        </Button>

        <div class='audio-controls'>
          <div class='control-group'>
            <label class='control-label' for='microphone-gain'>Microphone Gain</label>
            <input
              id='microphone-gain'
              type='range'
              min='0'
              max='100'
              value={{this.inputGain}}
              class='gain-slider'
              {{on 'input' this.updateInputGain}}
            />
            <span class='control-value'>{{this.inputGain}}%</span>
          </div>

          <div class='control-group'>
            <label class='control-label' for='playback-volume'>Playback Volume</label>
            <input
              id='playback-volume'
              type='range'
              min='0'
              max='100'
              value={{this.outputVolume}}
              class='volume-slider'
              {{on 'input' this.updateOutputVolume}}
            />
            <span class='control-value'>{{this.outputVolume}}%</span>
          </div>
        </div>
      </div>

      <div class='recording-info'>
        <div class='info-item'>
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path d='M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z' />
            <path d='M19 10v2a7 7 0 0 1-14 0v-2' />
            <line x1='12' y1='19' x2='12' y2='23' />
            <line x1='8' y1='23' x2='16' y2='23' />
          </svg>
          <span>Basic microphone recording to WebM format</span>
        </div>
        <div class='info-item'>
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path d='M8 5v14l11-7z' />
          </svg>
          <span>Simple playback and download capabilities</span>
        </div>
      </div>

      {{#if (gt this.recordings.length 0)}}
        <div class='recordings-library'>
          <h4>Your Recordings</h4>
          <div class='recordings-list'>
            {{#each this.recordings as |recording|}}
              <div class='recording-item'>
                <div class='recording-header'>
                  <div class='recording-info'>
                    <div class='recording-name'>{{recording.name}}</div>
                    <div class='recording-meta'>
                      <span class='recording-duration'>
                        <svg
                          viewBox='0 0 24 24'
                          fill='currentColor'
                          class='duration-icon'
                        >
                          <circle cx='12' cy='12' r='10' />
                          <polyline points='12,6 12,12 16,14' />
                        </svg>
                        {{recording.duration}}s
                      </span>
                      <span class='recording-size'>WebM Audio</span>
                    </div>
                  </div>
                  <div class='recording-waveform'>
                    <div class='waveform-bars'>
                      <div class='bar'></div>
                      <div class='bar'></div>
                      <div class='bar'></div>
                      <div class='bar'></div>
                      <div class='bar'></div>
                      <div class='bar'></div>
                      <div class='bar'></div>
                      <div class='bar'></div>
                    </div>
                  </div>
                </div>

                <div class='recording-actions'>
                  {{#if (eq this.currentPlayingId recording.id)}}
                    <button
                      class='action-btn primary stop-btn'
                      title='Stop playback'
                      {{on 'click' this.stopPlayback}}
                    >
                      <svg viewBox='0 0 24 24' fill='currentColor'>
                        <rect x='6' y='6' width='12' height='12' rx='2' />
                      </svg>
                      <span>Stop</span>
                    </button>
                  {{else}}
                    <button
                      class='action-btn primary play-btn'
                      title='Play recording'
                      {{on 'click' (fn this.playRecording recording.id)}}
                    >
                      <svg viewBox='0 0 24 24' fill='currentColor'>
                        <path d='M8 5v14l11-7z' />
                      </svg>
                      <span>Play</span>
                    </button>
                  {{/if}}

                  <button
                    class='action-btn secondary download-btn'
                    title='Download recording'
                    {{on 'click' (fn this.downloadRecording recording.id)}}
                  >
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                      <polyline points='7,10 12,15 17,10' />
                      <line x1='12' y1='15' x2='12' y2='3' />
                    </svg>
                    <span>Download</span>
                  </button>

                  <button
                    class='action-btn danger delete-btn'
                    title='Delete recording'
                    {{on 'click' (fn this.deleteRecording recording.id)}}
                  >
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <polyline points='3,6 5,6 21,6' />
                      <path
                        d='M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6'
                      />
                      <polyline points='10,11 10,17' />
                      <polyline points='14,11 14,17' />
                    </svg>
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            {{/each}}
          </div>
        </div>
      {{else}}
        <div class='empty-state'>
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path d='M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z' />
            <path d='M19 10v2a7 7 0 0 1-14 0v-2' />
            <line x1='12' y1='19' x2='12' y2='23' />
            <line x1='8' y1='23' x2='16' y2='23' />
          </svg>
          <p>No recordings yet. Click "Start Recording" to capture audio from
            your microphone.</p>
        </div>
      {{/if}}
    </div>

    <style scoped>
      /* ⁵⁴ Simple recording studio styles */
      .recording-studio {
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        border-radius: 16px;
        padding: 1.5rem;
        color: white;
        font-family:
          'Inter',
          -apple-system,
          sans-serif;
        min-height: 400px;
      }

      /* Studio Header */
      .studio-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #374151;
      }

      .project-info h3 {
        margin: 0 0 0.5rem 0;
        font-size: 1.125rem;
        font-weight: 700;
        background: linear-gradient(135deg, #60a5fa, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .project-name-input {
        background: #374151;
        border: 1px solid #4b5563;
        color: white;
        padding: 0.375rem 0.75rem;
        border-radius: 6px;
        font-size: 0.875rem;
        font-family: inherit;
        width: 200px;
      }

      .recording-status {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .status-indicator {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.75rem;
        font-weight: 700;
        padding: 0.375rem 0.75rem;
        border-radius: 6px;
      }

      .status-indicator.recording {
        background: #dc2626;
        color: white;
      }

      .status-indicator.ready {
        background: #374151;
        color: #9ca3af;
      }

      .record-dot {
        width: 8px;
        height: 8px;
        background: white;
        border-radius: 50%;
        animation: record-pulse 1s ease-in-out infinite;
      }

      @keyframes record-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.5;
          transform: scale(1.2);
        }
      }

      .recording-time {
        font-size: 1.125rem;
        font-weight: 700;
        color: #10b981;
        font-family: 'JetBrains Mono', monospace;
      }

      /* Simple Recording Controls */
      .recording-controls {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        margin-bottom: 2rem;
      }

      .record-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 1rem 2rem;
        background: #10b981;
        border: none;
        color: white;
        border-radius: 12px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        align-self: center;
        min-width: 200px;
      }

      .record-btn:hover {
        background: #059669;
        transform: translateY(-1px);
      }

      .record-btn.recording {
        background: #dc2626;
        animation: record-glow 2s ease-in-out infinite;
      }

      .record-btn.recording:hover {
        background: #b91c1c;
      }

      @keyframes record-glow {
        0%,
        100% {
          box-shadow: 0 0 20px rgba(220, 38, 38, 0.3);
        }
        50% {
          box-shadow: 0 0 30px rgba(220, 38, 38, 0.6);
        }
      }

      .record-btn svg {
        width: 20px;
        height: 20px;
      }

      .audio-controls {
        display: flex;
        gap: 2rem;
        justify-content: center;
      }

      .control-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
      }

      .control-label {
        font-size: 0.75rem;
        color: #9ca3af;
        text-transform: uppercase;
        font-weight: 600;
        letter-spacing: 0.05em;
      }

      .gain-slider,
      .volume-slider {
        width: 100px;
        height: 6px;
        background: #374151;
        border-radius: 3px;
        outline: none;
        -webkit-appearance: none;
      }

      .gain-slider::-webkit-slider-thumb,
      .volume-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 20px;
        height: 20px;
        background: #10b981;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
      }

      .control-value {
        font-size: 0.875rem;
        color: #e5e7eb;
        font-weight: 600;
        min-width: 40px;
        text-align: center;
      }

      /* Recording Info */
      .recording-info {
        background: rgba(55, 65, 81, 0.3);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 2rem;
      }

      .info-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.875rem;
        color: #e5e7eb;
        margin-bottom: 1rem;
      }

      .info-item:last-child {
        margin-bottom: 0;
      }

      .info-item svg {
        width: 20px;
        height: 20px;
        color: #60a5fa;
        flex-shrink: 0;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
      }

      /* Empty State */
      .empty-state {
        text-align: center;
        padding: 3rem 2rem;
        color: #9ca3af;
      }

      .empty-state svg {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem auto;
        color: #4b5563;
      }

      .empty-state p {
        font-size: 1rem;
        line-height: 1.5;
        max-width: 400px;
        margin: 0 auto;
      }

      /* Recordings Library */
      .recordings-library {
        background: rgba(15, 23, 42, 0.8);
        border-radius: 12px;
        padding: 1rem;
        margin-top: 1.5rem;
      }

      .recordings-library h4 {
        margin: 0 0 1rem 0;
        font-size: 1rem;
        font-weight: 700;
        color: #e5e7eb;
      }

      .recordings-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .recording-item {
        background: linear-gradient(145deg, #1e293b 0%, #334155 100%);
        border-radius: 16px;
        padding: 1.5rem;
        border: 1px solid rgba(148, 163, 184, 0.1);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .recording-item::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6);
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .recording-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
        border-color: rgba(148, 163, 184, 0.2);
      }

      .recording-item:hover::before {
        opacity: 1;
      }

      .recording-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1rem;
      }

      .recording-info {
        flex: 1;
      }

      .recording-name {
        font-size: 1rem;
        font-weight: 700;
        color: #f1f5f9;
        margin-bottom: 0.5rem;
        line-height: 1.4;
      }

      .recording-meta {
        display: flex;
        gap: 1rem;
        align-items: center;
      }

      .recording-duration {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.875rem;
        color: #94a3b8;
        font-weight: 500;
      }

      .duration-icon {
        width: 14px;
        height: 14px;
        opacity: 0.7;
      }

      .recording-size {
        font-size: 0.75rem;
        color: #64748b;
        background: rgba(100, 116, 139, 0.2);
        padding: 0.25rem 0.5rem;
        border-radius: 12px;
        font-weight: 500;
      }

      .recording-waveform {
        margin-left: 1rem;
      }

      .waveform-bars {
        display: flex;
        align-items: end;
        gap: 2px;
        height: 32px;
      }

      .bar {
        width: 3px;
        background: linear-gradient(to top, #10b981, #34d399);
        border-radius: 2px;
        opacity: 0.6;
        transition: all 0.3s ease;
      }

      .bar:nth-child(1) {
        height: 20%;
        animation-delay: 0s;
      }
      .bar:nth-child(2) {
        height: 60%;
        animation-delay: 0.1s;
      }
      .bar:nth-child(3) {
        height: 40%;
        animation-delay: 0.2s;
      }
      .bar:nth-child(4) {
        height: 80%;
        animation-delay: 0.3s;
      }
      .bar:nth-child(5) {
        height: 30%;
        animation-delay: 0.4s;
      }
      .bar:nth-child(6) {
        height: 70%;
        animation-delay: 0.5s;
      }
      .bar:nth-child(7) {
        height: 50%;
        animation-delay: 0.6s;
      }
      .bar:nth-child(8) {
        height: 35%;
        animation-delay: 0.7s;
      }

      .recording-item:hover .bar {
        opacity: 1;
        animation: waveform-pulse 1.5s ease-in-out infinite;
      }

      @keyframes waveform-pulse {
        0%,
        100% {
          transform: scaleY(1);
        }
        50% {
          transform: scaleY(1.3);
        }
      }

      .recording-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: flex-end;
      }

      .action-btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1rem;
        border-radius: 8px;
        border: 1px solid transparent;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .action-btn svg {
        width: 16px;
        height: 16px;
        transition: transform 0.2s ease;
      }

      .action-btn:hover svg {
        transform: scale(1.1);
      }

      .action-btn.primary {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
        box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
      }

      .action-btn.primary:hover {
        background: linear-gradient(135deg, #059669 0%, #047857 100%);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
      }

      .action-btn.secondary {
        background: rgba(71, 85, 105, 0.5);
        color: #cbd5e1;
        border-color: rgba(148, 163, 184, 0.2);
      }

      .action-btn.secondary:hover {
        background: rgba(71, 85, 105, 0.8);
        color: #f1f5f9;
        border-color: rgba(148, 163, 184, 0.3);
        transform: translateY(-1px);
      }

      .action-btn.danger {
        background: rgba(220, 38, 38, 0.1);
        color: #fca5a5;
        border-color: rgba(220, 38, 38, 0.3);
      }

      .action-btn.danger:hover {
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: white;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(220, 38, 38, 0.4);
      }

      .stop-btn {
        background: linear-gradient(
          135deg,
          #f59e0b 0%,
          #d97706 100%
        ) !important;
        box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3) !important;
      }

      .stop-btn:hover {
        background: linear-gradient(
          135deg,
          #d97706 0%,
          #b45309 100%
        ) !important;
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4) !important;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .recording-studio {
          padding: 1rem;
        }

        .studio-header {
          flex-direction: column;
          gap: 1rem;
          align-items: stretch;
        }

        .transport-controls {
          flex-wrap: wrap;
          justify-content: center;
        }

        .tracks-container {
          flex-direction: column;
        }

        .track-channel {
          flex-direction: row;
          align-items: center;
        }

        .fader-section {
          flex-direction: row;
          height: auto;
          width: 100%;
        }

        .vertical-slider {
          width: 100px;
          height: 4px;
          writing-mode: lr-tb;
          -webkit-appearance: none;
        }

        .recording-item {
          padding: 1rem;
        }

        .recording-header {
          flex-direction: column;
          gap: 0.75rem;
          align-items: stretch;
        }

        .recording-waveform {
          margin-left: 0;
          margin-top: 0.5rem;
        }

        .recording-actions {
          justify-content: center;
          flex-wrap: wrap;
        }

        .action-btn {
          flex: 1;
          min-width: 80px;
        }
      }
    </style>
  </template>
}

export class RecordingStudioCard extends CardDef {
  static displayName = 'Recording Studio';
  static icon = MusicIcon;

  @field studioName = contains(StringField);
  @field projectName = contains(StringField);
  @field isRecording = contains(BooleanField);
  @field inputGain = contains(NumberField); // Basic gain control
  @field outputVolume = contains(NumberField); // Playback volume

  @field title = contains(StringField, {
    computeVia: function (this: RecordingStudioCard) {
      try {
        return this.studioName ?? 'Recording Studio';
      } catch (e) {
        return 'Recording Studio';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='studio-card'>
        <div class='studio-header'>
          <div class='studio-info'>
            <h3 class='studio-name'>{{if
                @model.studioName
                @model.studioName
                'Recording Studio'
              }}</h3>
            <p class='project-name'>{{if
                @model.projectName
                @model.projectName
                'No Project'
              }}</p>
          </div>
        </div>

        <div class='studio-details'>
          <div class='detail-row'>
            <span class='detail-label'>Format:</span>
            <span class='detail-value'>WebM Audio</span>
          </div>

          <div class='audio-levels'>
            <div class='level-item'>
              <span class='level-label'>Input</span>
              <div class='level-bar'>
                <div
                  class='level-fill'
                  style={{htmlSafe
                    (concat
                      'width: ' (if @model.inputGain @model.inputGain 50) '%'
                    )
                  }}
                ></div>
              </div>
              <span class='level-value'>{{if
                  @model.inputGain
                  @model.inputGain
                  50
                }}%</span>
            </div>

            <div class='level-item'>
              <span class='level-label'>Output</span>
              <div class='level-bar'>
                <div
                  class='level-fill'
                  style={{htmlSafe
                    (concat
                      'width: '
                      (if @model.outputVolume @model.outputVolume 75)
                      '%'
                    )
                  }}
                ></div>
              </div>
              <span class='level-value'>{{if
                  @model.outputVolume
                  @model.outputVolume
                  75
                }}%</span>
            </div>
          </div>
        </div>

        <div class='studio-footer'>
          <div class='format-info'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <polygon points='10,8 16,12 10,16 10,8' />
            </svg>
            WebM Audio Recording
          </div>
        </div>
      </div>

      <style scoped>
        .studio-card {
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          border-radius: 12px;
          padding: 1rem;
          color: white;
          font-family:
            'Inter',
            -apple-system,
            sans-serif;
          transition: all 0.2s ease;
          border: 1px solid #374151;
        }

        .studio-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
          border-color: #60a5fa;
        }

        .studio-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
          gap: 0.75rem;
        }

        .studio-info {
          flex: 1;
          min-width: 0;
        }

        .studio-name {
          font-size: 0.875rem;
          font-weight: 700;
          margin: 0 0 0.25rem 0;
          background: linear-gradient(135deg, #60a5fa, #a78bfa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .project-name {
          font-size: 0.75rem;
          color: #cbd5e1;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .recording-badge {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          white-space: nowrap;
        }

        .recording-badge.recording {
          background: #dc2626;
          color: white;
        }

        .recording-badge.ready {
          background: #374151;
          color: #9ca3af;
        }

        .record-dot {
          width: 6px;
          height: 6px;
          background: white;
          border-radius: 50%;
          animation: record-pulse 1s ease-in-out infinite;
        }

        @keyframes record-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(1.2);
          }
        }

        .recording-badge svg {
          width: 12px;
          height: 12px;
        }

        .studio-details {
          margin-bottom: 1rem;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
          font-size: 0.75rem;
        }

        .detail-label {
          color: #9ca3af;
          font-weight: 500;
        }

        .detail-value {
          color: #e5e7eb;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
        }

        .audio-levels {
          margin-top: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .level-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.625rem;
        }

        .level-label {
          color: #9ca3af;
          min-width: 32px;
          font-weight: 600;
        }

        .level-bar {
          flex: 1;
          height: 4px;
          background: #374151;
          border-radius: 2px;
          overflow: hidden;
        }

        .level-fill {
          height: 100%;
          background: linear-gradient(
            90deg,
            #10b981 0%,
            #34d399 50%,
            #fbbf24 80%,
            #ef4444 100%
          );
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .level-value {
          color: #e5e7eb;
          font-weight: 600;
          min-width: 28px;
          text-align: right;
          font-family: 'JetBrains Mono', monospace;
        }

        .studio-footer {
          padding-top: 0.75rem;
          border-top: 1px solid #374151;
        }

        .format-info {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.625rem;
          color: #9ca3af;
          justify-content: center;
        }

        .format-info svg {
          width: 12px;
          height: 12px;
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
              <div class='mixing-console-mini'>
                <div class='console-led recording'></div>
                <div class='mini-fader'></div>
                <div class='mini-fader'></div>
              </div>
            </div>
            <div class='badge-info'>
              <div class='badge-title'>Studio</div>
              <div class='badge-stats'>WebM</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='strip-content'>
            <div class='strip-visual'>
              <div class='channel-strips'>
                <div class='channel-strip'>
                  <div class='strip-led'></div>
                  <div class='strip-fader'></div>
                  <div class='level-meter'>
                    <div
                      class='level-fill'
                      style={{htmlSafe
                        (concat
                          'height: '
                          (if @model.inputGain @model.inputGain 50)
                          '%'
                        )
                      }}
                    ></div>
                  </div>
                </div>
                <div class='channel-strip'>
                  <div class='strip-led active'></div>
                  <div class='strip-fader'></div>
                  <div class='level-meter'>
                    <div
                      class='level-fill'
                      style={{htmlSafe
                        (concat
                          'height: '
                          (if @model.outputVolume @model.outputVolume 75)
                          '%'
                        )
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
            <div class='strip-info'>
              <div class='strip-title'>Recording Studio</div>
              <div class='strip-description'>{{if
                  @model.projectName
                  @model.projectName
                  'New Project'
                }}
                • Professional audio</div>
            </div>
            <div class='strip-badge'>
              <div class='rec-indicator'></div>
              REC
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-header'>
            <div class='tile-visual'>
              <div class='mixing-board'>
                <div class='board-display'>
                  <div class='display-dot recording'></div>
                  <div class='display-dot ready'></div>
                  <div class='display-dot standby'></div>
                </div>
                <div class='board-channels'>
                  <div class='board-channel'>
                    <div class='channel-led'></div>
                    <div class='channel-fader'></div>
                  </div>
                  <div class='board-channel'>
                    <div class='channel-led active'></div>
                    <div class='channel-fader'></div>
                  </div>
                  <div class='board-channel'>
                    <div class='channel-led'></div>
                    <div class='channel-fader'></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='tile-content'>
            <h3 class='tile-title'>Recording Studio</h3>
            <div class='tile-specs'>
              <div class='spec-row'>
                <span class='spec-label'>Project:</span>
                <span class='spec-value'>{{if
                    @model.projectName
                    @model.projectName
                    'Untitled'
                  }}</span>
              </div>
              <div class='spec-row'>
                <span class='spec-label'>Status:</span>
                <span class='spec-value'>{{if
                    @model.isRecording
                    'Recording'
                    'Standby'
                  }}</span>
              </div>
              <div class='spec-row'>
                <span class='spec-label'>Format:</span>
                <span class='spec-value'>WebM Audio</span>
              </div>
            </div>
            <div class='tile-features'>
              <div class='feature-tag'>Real-time</div>
              <div class='feature-tag'>Gain Control</div>
              <div class='feature-tag'>Export</div>
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='card-header'>
            <div class='card-info'>
              <h3 class='card-title'>Professional Recording Studio</h3>
              <p class='card-description'>Multi-track audio recording with
                real-time monitoring and professional-grade controls</p>
            </div>
            <div class='card-visual'>
              <div class='studio-console'>
                <div class='console-display'>
                  <div class='display-line'>
                    <span class='param-label'>PROJECT</span>
                    <span class='param-value'>{{if
                        @model.projectName
                        @model.projectName
                        'NEW'
                      }}</span>
                  </div>
                </div>
                <div class='console-leds'>
                  <div
                    class='led-indicator
                      {{if @model.isRecording "recording" ""}}'
                  ></div>
                  <div class='led-indicator ready'></div>
                  <div class='led-indicator standby'></div>
                </div>
              </div>
            </div>
          </div>
          <div class='card-meters'>
            <div class='meter-section'>
              <div class='meter-label'>Input Gain</div>
              <div class='level-meter-vertical'>
                <div
                  class='meter-fill'
                  style={{htmlSafe
                    (concat
                      'height: ' (if @model.inputGain @model.inputGain 50) '%'
                    )
                  }}
                ></div>
              </div>
              <div class='meter-value'>{{if
                  @model.inputGain
                  @model.inputGain
                  50
                }}%</div>
            </div>
            <div class='meter-section'>
              <div class='meter-label'>Output Volume</div>
              <div class='level-meter-vertical'>
                <div
                  class='meter-fill'
                  style={{htmlSafe
                    (concat
                      'height: '
                      (if @model.outputVolume @model.outputVolume 75)
                      '%'
                    )
                  }}
                ></div>
              </div>
              <div class='meter-value'>{{if
                  @model.outputVolume
                  @model.outputVolume
                  75
                }}%</div>
            </div>
            <div class='meter-section'>
              <div class='meter-label'>Signal Level</div>
              <div class='level-meter-vertical'>
                <div
                  class='meter-fill'
                  style={{htmlSafe
                    (concat 'height: ' (if @model.isRecording 85 25) '%')
                  }}
                ></div>
              </div>
              <div class='meter-value'>{{if @model.isRecording 85 25}}%</div>
            </div>
          </div>
          <div class='card-features'>
            <div class='features-label'>Studio Capabilities:</div>
            <div class='feature-list'>
              <div class='feature-pill'>Real-time Monitoring</div>
              <div class='feature-pill'>Gain Control</div>
              <div class='feature-pill'>WebM Export</div>
              <div class='feature-pill'>Multi-track Ready</div>
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
          flex-shrink: 0;
        }

        .mixing-console-mini {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          background: #1a1a2e;
          border-radius: 3px;
          padding: 3px;
        }

        .console-led {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #374151;
        }

        .console-led.recording {
          background: #dc2626;
          animation: led-pulse 1.5s ease-in-out infinite;
        }

        @keyframes led-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
        }

        .mini-fader {
          width: 8px;
          height: 12px;
          background: #4b5563;
          border-radius: 1px;
          border: 1px solid #6b7280;
        }

        .badge-info {
          flex: 1;
          min-width: 0;
        }

        .badge-title {
          font-size: 0.75rem;
          font-weight: 700;
          color: #dc2626;
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

        .channel-strips {
          display: flex;
          gap: 3px;
          background: #1a1a2e;
          border-radius: 4px;
          padding: 4px;
        }

        .channel-strip {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .strip-led {
          width: 4px;
          height: 4px;
          background: #374151;
          border-radius: 50%;
        }

        .strip-led.active {
          background: #dc2626;
          animation: led-pulse 1.5s ease-in-out infinite;
        }

        .strip-fader {
          width: 6px;
          height: 12px;
          background: #4b5563;
          border-radius: 1px;
          border: 1px solid #6b7280;
        }

        .level-meter {
          width: 4px;
          height: 12px;
          background: #374151;
          border-radius: 1px;
          position: relative;
          overflow: hidden;
        }

        .level-meter .level-fill {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(
            0deg,
            #10b981 0%,
            #22d3ee 40%,
            #fbbf24 70%,
            #f97316 90%,
            #dc2626 100%
          );
          transition: height 0.3s ease;
          border: 1px solid rgba(220, 38, 38, 0.3);
          border-radius: 1px;
          animation: meter-glow 2s ease-in-out infinite;
        }

        @keyframes meter-glow {
          0%,
          100% {
            box-shadow: 0 0 2px rgba(16, 185, 129, 0.3);
          }
          50% {
            box-shadow: 0 0 4px rgba(220, 38, 38, 0.6);
          }
        }

        .strip-info {
          flex: 1;
          min-width: 0;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 700;
          color: #dc2626;
          line-height: 1.2;
          margin-bottom: 0.25rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-description {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-badge {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          background: rgba(220, 38, 38, 0.2);
          border: 1px solid #dc2626;
          border-radius: 6px;
          font-size: 0.625rem;
          font-weight: 700;
          color: #dc2626;
          font-family: 'JetBrains Mono', monospace;
          flex-shrink: 0;
        }

        .rec-indicator {
          width: 6px;
          height: 6px;
          background: #dc2626;
          border-radius: 50%;
          animation: rec-pulse 1s ease-in-out infinite;
        }

        @keyframes rec-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.4;
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
          height: 70px;
          background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          border-radius: 8px;
          overflow: hidden;
        }

        .tile-header::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.2) 50%,
            transparent 100%
          );
          animation: studio-sweep 3s ease-in-out infinite;
        }

        @keyframes studio-sweep {
          0% {
            left: -100%;
          }
          100% {
            left: 100%;
          }
        }

        .mixing-board {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
        }

        .board-display {
          display: flex;
          gap: 3px;
          margin-bottom: 0.25rem;
        }

        .display-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.3);
        }

        .display-dot.recording {
          background: rgba(255, 255, 255, 0.9);
          animation: led-pulse 1.5s ease-in-out infinite;
        }

        .display-dot.ready {
          background: rgba(34, 211, 238, 0.8);
        }

        .display-dot.standby {
          background: rgba(255, 255, 255, 0.4);
        }

        .board-channels {
          display: flex;
          gap: 4px;
        }

        .board-channel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          animation: channel-activity 2s ease-in-out infinite;
        }

        .board-channel:nth-child(2) {
          animation-delay: 0.3s;
        }

        .board-channel:nth-child(3) {
          animation-delay: 0.6s;
        }

        @keyframes channel-activity {
          0%,
          70%,
          100% {
            opacity: 1;
          }
          35% {
            opacity: 0.7;
          }
        }

        .channel-led {
          width: 4px;
          height: 4px;
          background: rgba(255, 255, 255, 0.3);
          border-radius: 50%;
        }

        .channel-led.active {
          background: rgba(255, 255, 255, 0.9);
          animation: led-activity 1.5s ease-in-out infinite;
        }

        @keyframes led-activity {
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

        .channel-fader {
          width: 6px;
          height: 16px;
          background: rgba(255, 255, 255, 0.6);
          border-radius: 1px;
          border: 1px solid rgba(255, 255, 255, 0.8);
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
          color: #dc2626;
          margin: 0;
          line-height: 1.2;
        }

        .tile-specs {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .spec-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .spec-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
        }

        .spec-value {
          font-size: 0.875rem;
          color: #dc2626;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
        }

        .tile-features {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          margin-top: auto;
        }

        .feature-tag {
          padding: 0.25rem 0.5rem;
          background: rgba(220, 38, 38, 0.2);
          border: 1px solid #dc2626;
          color: #dc2626;
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
          background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%);
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

        .studio-console {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.75rem;
          background: rgba(15, 23, 42, 0.7);
          backdrop-filter: blur(8px);
          border-radius: 8px;
          min-width: 120px;
        }

        .console-display {
          background: #0f172a;
          padding: 0.5rem;
          border-radius: 4px;
          border: 1px solid rgba(220, 38, 38, 0.3);
        }

        .display-line {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.25rem;
        }

        .display-line:last-child {
          margin-bottom: 0;
        }

        .param-label {
          font-size: 0.625rem;
          color: rgba(255, 255, 255, 0.6);
          font-weight: 600;
        }

        .param-value {
          font-size: 0.75rem;
          color: #dc2626;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
        }

        .console-leds {
          display: flex;
          justify-content: space-between;
          gap: 0.25rem;
        }

        .led-indicator {
          width: 8px;
          height: 8px;
          background: #374151;
          border: 1px solid #dc2626;
          border-radius: 50%;
          transition: all 0.3s ease;
        }

        .led-indicator.recording {
          background: #dc2626;
          box-shadow: 0 0 8px rgba(220, 38, 38, 0.6);
          animation: led-pulse 1.5s ease-in-out infinite;
        }

        .led-indicator.ready {
          background: #22d3ee;
          box-shadow: 0 0 4px rgba(34, 211, 238, 0.4);
        }

        .led-indicator.standby {
          background: #374151;
        }

        .card-meters {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          margin-bottom: 1rem;
          background: rgba(248, 250, 252, 0.1);
          border-radius: 8px;
          padding: 1rem;
        }

        .meter-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
        }

        .meter-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          text-align: center;
        }

        .level-meter-vertical {
          width: 8px;
          height: 40px;
          background: #374151;
          border-radius: 4px;
          overflow: hidden;
          position: relative;
        }

        .meter-fill {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(
            0deg,
            #10b981 0%,
            #fbbf24 60%,
            #dc2626 100%
          );
          border-radius: 4px;
          transition: height 0.3s ease;
        }

        .meter-value {
          font-size: 0.75rem;
          color: #dc2626;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
        }

        .card-features {
          margin-top: auto;
        }

        .features-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 600;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .feature-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .feature-pill {
          padding: 0.375rem 0.75rem;
          background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%);
          color: white;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      </style>
    </template>
  };

  static isolated = RecordingStudioIsolated;
}
