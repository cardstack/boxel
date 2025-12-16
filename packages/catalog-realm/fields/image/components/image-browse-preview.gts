import { not, eq } from '@cardstack/boxel-ui/helpers';
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import XIcon from '@cardstack/boxel-icons/x';
import ZoomInIcon from '@cardstack/boxel-icons/zoom-in';
import ImageIcon from '@cardstack/boxel-icons/image';
import ReadingProgress from './reading-progress';

interface ImageBrowsePreviewArgs {
  Args: {
    imageData: string;
    fileName?: string;
    onRemove: () => void;
    onZoom: () => void;
    onFileSelect: (event: Event) => void;
    showZoomButton?: boolean;
    isReading?: boolean;
    readProgress?: number;
    previewImageFit?: 'contain' | 'cover';
  };
}

export default class ImageBrowsePreview extends GlimmerComponent<ImageBrowsePreviewArgs> {
  get readProgress(): number {
    return this.args.readProgress ?? 0;
  }

  get objectFit(): 'contain' | 'cover' {
    return this.args.previewImageFit ?? 'contain';
  }

  get imageStyle() {
    return htmlSafe(`object-fit: ${this.objectFit};`);
  }

  <template>
    <div class='browse-preview'>
      {{! Main container }}
      <div class='image-wrapper'>
        {{#if @isReading}}
          {{! Progress indicator during file reading }}
          <ReadingProgress @readProgress={{this.readProgress}} />
        {{else}}
          <img
            src={{@imageData}}
            alt={{@fileName}}
            class='preview-image'
            style={{this.imageStyle}}
          />

          {{! Top-left: Zoom button }}
          {{#if (not (eq @showZoomButton false))}}
            <button type='button' {{on 'click' @onZoom}} class='zoom-button'>
              <ZoomInIcon class='icon' />
            </button>
          {{/if}}

          {{! Top-right: Change and Remove buttons }}
          <div class='top-right-buttons'>
            <label class='change-button'>
              <ImageIcon class='icon' />
              <input
                type='file'
                class='file-input'
                accept='image/*'
                {{on 'change' @onFileSelect}}
              />
            </label>
            <button
              type='button'
              {{on 'click' @onRemove}}
              class='remove-button'
            >
              <XIcon class='icon' />
            </button>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .browse-preview {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .image-wrapper {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        border: 2px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
        background: var(--muted, #f1f5f9);
      }

      .preview-image {
        width: 100%;
        height: 100%;
        display: block;
      }

      .zoom-button {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        width: 2rem;
        height: 2rem;
        border-radius: 9999px;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
        background: var(--background, #ffffff);
        color: var(--foreground, #1a1a1a);
      }

      .zoom-button:hover {
        background: var(--muted, #f1f5f9);
      }

      .top-right-buttons {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }

      .change-button,
      .remove-button {
        width: 2rem;
        height: 2rem;
        border-radius: 9999px;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      }

      .change-button {
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
      }

      .change-button:hover {
        background: var(--accent, #60a5fa);
      }

      .remove-button {
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
      }

      .remove-button:hover {
        background: var(--destructive, #dc2626);
        opacity: 0.9;
      }

      .file-input {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }

      .icon {
        width: 1rem;
        height: 1rem;
      }
    </style>
  </template>
}
