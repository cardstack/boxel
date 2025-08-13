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
import { fn } from '@ember/helper';
import { gt, eq } from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';

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

  constructor(owner: unknown, args: any) {
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

      // ⁵⁸ Update model values when recording starts
      if (this.args.model) {
        this.args.model.isRecording = true;
      }
      this.currentTime = 0;

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
      duration: this.currentTime,
    };

    this.recordings = [...this.recordings, recording];
    this.recordedChunks = [];
  }

  <template>
    <div class='recording-studio'>
      <!-- Studio Header -->
      <div class='studio-header'>
        <div class='project-info'>
          <h3>Simple Audio Recorder</h3>
          <input
            type='text'
            value={{this.projectName}}
            class='project-name-input'
            placeholder='Project Name'
            {{on 'input' this.updateProjectName}}
          />
        </div>

        <div class='recording-status'>
          {{#if this.isRecording}}
            <span class='status-indicator recording'>
              <div class='record-dot'></div>
              REC
            </span>
          {{else}}
            <span class='status-indicator ready'>READY</span>
          {{/if}}
          <span class='recording-time'>{{this.recordingTime}}</span>
        </div>
      </div>

      <!-- Simple Recording Controls -->
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

        <!-- Basic Audio Controls -->
        <div class='audio-controls'>
          <div class='control-group'>
            <label class='control-label'>Microphone Gain</label>
            <input
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
            <label class='control-label'>Playback Volume</label>
            <input
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

      <!-- Recording Info -->
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

      <!-- Recordings Library -->
      {{#if (gt this.recordings.length 0)}}
        <div class='recordings-library'>
          <h4>Your Recordings</h4>
          <div class='recordings-list'>
            {{#each this.recordings as |recording|}}
              <div class='recording-item'>
                <div class='recording-info'>
                  <div class='recording-name'>{{recording.name}}</div>
                  <div class='recording-duration'>Duration:
                    {{recording.duration}}
                    seconds</div>
                </div>

                <div class='recording-controls'>
                  {{#if (eq this.currentPlayingId recording.id)}}
                    <button
                      class='recording-btn stop-btn'
                      title='Stop playback'
                      {{on 'click' this.stopPlayback}}
                    >
                      <svg viewBox='0 0 24 24' fill='currentColor'>
                        <rect x='6' y='6' width='12' height='12' />
                      </svg>
                      Stop
                    </button>
                  {{else}}
                    <button
                      class='recording-btn play-btn'
                      title='Play recording'
                      {{on 'click' (fn this.playRecording recording.id)}}
                    >
                      <svg viewBox='0 0 24 24' fill='currentColor'>
                        <path d='M8 5v14l11-7z' />
                      </svg>
                      Play
                    </button>
                  {{/if}}

                  <button
                    class='recording-btn download-btn'
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
                    Download
                  </button>

                  <button
                    class='recording-btn delete-btn'
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
                    </svg>
                    Delete
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
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem;
        background: #1e293b;
        border-radius: 8px;
        border: 1px solid #374151;
      }

      .recording-info {
        flex: 1;
      }

      .recording-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: #e5e7eb;
        margin-bottom: 0.25rem;
      }

      .recording-duration {
        font-size: 0.75rem;
        color: #9ca3af;
      }

      .recording-controls {
        display: flex;
        gap: 0.5rem;
      }

      .recording-btn {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1px solid #4b5563;
        background: transparent;
        color: #9ca3af;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .recording-btn:hover {
        border-color: #60a5fa;
        color: #60a5fa;
      }

      .recording-btn svg {
        width: 16px;
        height: 16px;
      }

      .play-btn:hover {
        background: #10b981;
        border-color: #10b981;
        color: white;
      }

      .stop-btn {
        background: #ef4444;
        border-color: #ef4444;
        color: white;
      }

      .stop-btn:hover {
        background: #dc2626;
      }

      .download-btn:hover {
        background: #3b82f6;
        border-color: #3b82f6;
        color: white;
      }

      .delete-btn:hover {
        background: #ef4444;
        border-color: #ef4444;
        color: white;
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
          flex-direction: column;
          gap: 0.75rem;
          align-items: stretch;
        }

        .recording-controls {
          justify-content: center;
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

          <div
            class='recording-badge
              {{if @model.isRecording "recording" "ready"}}'
          >
            {{#if @model.isRecording}}
              <div class='record-dot'></div>
              REC
            {{else}}
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
              READY
            {{/if}}
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
                  style='width: {{if @model.inputGain @model.inputGain 50}}%'
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
                  style='width: {{if
                    @model.outputVolume
                    @model.outputVolume
                    75
                  }}%'
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
  isolated = RecordingStudioIsolated;
}
