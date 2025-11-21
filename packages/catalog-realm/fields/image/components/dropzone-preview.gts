import { not, eq } from '@cardstack/boxel-ui/helpers';
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import XIcon from '@cardstack/boxel-icons/x';
import ZoomInIcon from '@cardstack/boxel-icons/zoom-in';

interface DropzonePreviewArgs {
  Args: {
    imageData: string;
    fileName?: string;
    fileSize?: number;
    width?: number;
    height?: number;
    onRemove: () => void;
    onZoom: () => void;
    showZoomButton?: boolean;
  };
}

export default class DropzonePreview extends GlimmerComponent<DropzonePreviewArgs> {
  <template>
    <div class='dropzone-preview'>
      {{! ⁷ Main container }}
      <div class='dropzone-image-wrapper'>
        <img src={{@imageData}} alt={{@fileName}} class='dropzone-image' />
        <div class='dropzone-overlay'>
          {{! ⁸ Hover overlay controls }}
          {{#if (not (eq @showZoomButton false))}}
            <button
              type='button'
              {{on 'click' @onZoom}}
              class='overlay-button zoom'
            >
              <ZoomInIcon class='icon' />
            </button>
          {{/if}}
          <button
            type='button'
            {{on 'click' @onRemove}}
            class='overlay-button remove'
          >
            <XIcon class='icon' />
          </button>
        </div>
      </div>
    </div>

    <style
      scoped
    > {{! ¹⁰ Component styles }}
      .dropzone-preview {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .dropzone-image-wrapper {
        position: relative;
        width: 100%;
        min-height: 12rem;
        border: 2px dashed var(--primary, #3b82f6);
        border-radius: var(--radius, 0.5rem);
        background: rgba(59, 130, 246, 0.05);
        overflow: hidden;
      }

      .dropzone-image {
        width: 100%;
        height: 12rem;
        object-fit: cover;
      }

      .dropzone-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .dropzone-image-wrapper:hover .dropzone-overlay {
        opacity: 1;
      }

      .overlay-button {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 9999px;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      }

      .overlay-button.zoom {
        background: var(--background, #ffffff);
        color: var(--foreground, #1a1a1a);
      }

      .overlay-button.zoom:hover {
        background: var(--muted, #f1f5f9);
        transform: scale(1.1);
      }

      .overlay-button.remove {
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
      }

      .overlay-button.remove:hover {
        background: #dc2626;
        transform: scale(1.1);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }
    </style>
  </template>
}
