import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import CameraIcon from '@cardstack/boxel-icons/camera';
import XIcon from '@cardstack/boxel-icons/x';

interface Signature {
  Args: {
    onCapture: (file: File) => void;
    facingMode?: 'user' | 'environment';
    quality?: number;
  };
}

export default class CameraCapture extends Component<Signature> {
  @tracked isOpen = false;
  @tracked stream: MediaStream | null = null;
  @tracked error = '';

  videoElement: HTMLVideoElement | null = null;

  get facingMode() {
    return this.args.facingMode || 'user';
  }

  get quality() {
    return this.args.quality || 0.9;
  }

  @action
  async openCamera() {
    this.isOpen = true;
    this.error = '';

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode },
        audio: false,
      });

      if (this.videoElement) {
        this.videoElement.srcObject = this.stream;
      }
    } catch (err: any) {
      this.error = `Camera access denied: ${err.message}`;
      this.isOpen = false;
    }
  }

  @action
  closeCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.isOpen = false;
    this.error = '';
  }

  @action
  setVideoElement(element: HTMLVideoElement) {
    this.videoElement = element;
    if (this.stream) {
      element.srcObject = this.stream;
    }
  }

  @action
  async capturePhoto() {
    if (!this.videoElement) return;

    const canvas = document.createElement('canvas');
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(this.videoElement, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], `camera-capture-${Date.now()}.jpg`, {
            type: 'image/jpeg',
          });
          this.args.onCapture(file);
          this.closeCamera();
        }
      },
      'image/jpeg',
      this.quality,
    );
  }

  <template>
    <div class='camera-capture' data-test-camera-capture>
      {{#if this.isOpen}}
        <div class='camera-modal'>
          <div class='camera-container'>
            <div class='camera-header'>
              <h3>Camera</h3>
              <button
                type='button'
                class='btn-close'
                {{on 'click' this.closeCamera}}
                data-test-close-camera
              >
                <XIcon class='icon' />
              </button>
            </div>

            <video
              autoplay
              playsinline
              class='camera-video'
              {{this.setVideoElement}}
              data-test-camera-video
            ></video>

            <div class='camera-controls'>
              <button
                type='button'
                class='btn-capture'
                {{on 'click' this.capturePhoto}}
                data-test-capture-button
              >
                <div class='capture-ring'>
                  <div class='capture-button'></div>
                </div>
                <span>Capture</span>
              </button>
            </div>
          </div>
        </div>
      {{else}}
        <button
          type='button'
          class='btn-open-camera'
          {{on 'click' this.openCamera}}
          data-test-open-camera
        >
          <CameraIcon class='icon' />
          <span>Take Photo</span>
        </button>
      {{/if}}

      {{#if this.error}}
        <div class='camera-error' data-test-camera-error>{{this.error}}</div>
      {{/if}}
    </div>

    <style scoped>
      .camera-capture {
        width: 100%;
      }

      .btn-open-camera {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        width: 100%;
        padding: calc(var(--spacing, 0.25rem) * 3);
        background: var(--secondary, #f3f4f6);
        color: var(--secondary-foreground, #1f2937);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 0.5rem);
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .btn-open-camera:hover {
        background: var(--muted, #e5e7eb);
      }

      .btn-open-camera .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .camera-modal {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        padding: calc(var(--spacing, 0.25rem) * 4);
      }

      .camera-container {
        width: 100%;
        max-width: 640px;
        background: var(--background, #ffffff);
        border-radius: var(--radius, 0.75rem);
        overflow: hidden;
      }

      .camera-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: calc(var(--spacing, 0.25rem) * 4);
        border-bottom: 1px solid var(--border, #e5e7eb);
      }

      .camera-header h3 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--foreground, #111827);
      }

      .btn-close {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: calc(var(--spacing, 0.25rem) * 2);
        background: transparent;
        border: none;
        border-radius: var(--radius, 0.375rem);
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .btn-close:hover {
        background: var(--muted, #f3f4f6);
      }

      .btn-close .icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--muted-foreground, #6b7280);
      }

      .camera-video {
        width: 100%;
        aspect-ratio: 4 / 3;
        background: black;
        display: block;
      }

      .camera-controls {
        display: flex;
        justify-content: center;
        padding: calc(var(--spacing, 0.25rem) * 6);
      }

      .btn-capture {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--foreground, #111827);
        font-size: 0.875rem;
        font-weight: 500;
      }

      .capture-ring {
        width: 4.5rem;
        height: 4.5rem;
        border: 4px solid var(--foreground, #111827);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }

      .btn-capture:hover .capture-ring {
        border-color: var(--primary, #3b82f6);
        transform: scale(1.05);
      }

      .capture-button {
        width: 3.5rem;
        height: 3.5rem;
        background: var(--primary, #3b82f6);
        border-radius: 50%;
        transition: all 0.15s ease;
      }

      .btn-capture:active .capture-button {
        transform: scale(0.95);
      }

      .camera-error {
        margin-top: calc(var(--spacing, 0.25rem) * 2);
        padding: calc(var(--spacing, 0.25rem) * 3);
        background: var(--destructive, #fef2f2);
        color: var(--destructive-foreground, #991b1b);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.875rem;
        text-align: center;
      }
    </style>
  </template>
}
