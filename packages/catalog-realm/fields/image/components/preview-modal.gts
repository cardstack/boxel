import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import XIcon from '@cardstack/boxel-icons/x';

interface PreviewModalArgs {
  Args: {
    imageData: string;
    fileName?: string;
    fileSize?: number;
    onClose: () => void;
  };
}

export default class PreviewModal extends GlimmerComponent<PreviewModalArgs> {
  get formattedSize() {
    // Format file size
    const bytes = this.args.fileSize;
    if (!bytes) return '';

    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  @action
  handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.args.onClose();
    }
  }

  @action
  handleOverlayClick(event: MouseEvent) {
    // Only close if clicking directly on the overlay, not on modal content
    if (event.target === event.currentTarget) {
      this.args.onClose();
    }
  }

  <template>
    <div
      class='preview-modal'
      tabindex='0'
      {{on 'click' this.handleOverlayClick}}
      {{on 'keydown' this.handleKeydown}}
    >
      {{! Modal overlay }}
      <div class='modal-content'>
        <button type='button' {{on 'click' @onClose}} class='modal-close'>
          <XIcon class='icon' />
        </button>
        <img src={{@imageData}} alt={{@fileName}} class='modal-image' />
        <div class='modal-info'>
          {{! File information }}
          <div class='modal-filename'>{{@fileName}}</div>
          <div class='modal-details'>{{this.formattedSize}}</div>
        </div>
      </div>
    </div>

    <style scoped>
      .preview-modal {
        position: fixed;
        inset: 0;
        background: color-mix(
          in srgb,
          var(--foreground, #1a1a1a) 75%,
          transparent
        );
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: var(--boxel-layer-modal-default);
        padding: calc(var(--spacing, 0.25rem) * 4);
      }

      .modal-content {
        position: relative;
        max-width: 64rem;
        max-height: calc(100vh - 2rem);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .modal-close {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        width: 2.5rem;
        height: 2.5rem;
        background: var(--background, #ffffff);
        color: var(--foreground, #1a1a1a);
        border: none;
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.2s ease;
        z-index: 10;
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      }

      .modal-close:hover {
        background: var(--muted, #f1f5f9);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .modal-image {
        max-width: 100%;
        max-height: calc(100vh - 2rem);
        width: auto;
        height: auto;
        object-fit: contain;
        border-radius: var(--radius, 0.5rem);
        box-shadow: var(--shadow-2xl, 0 25px 50px -12px rgb(0 0 0 / 0.25));
      }

      .modal-info {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: color-mix(
          in srgb,
          var(--foreground, #1a1a1a) 50%,
          transparent
        );
        color: var(--background, #ffffff);
        padding: calc(var(--spacing, 0.25rem) * 4);
        border-bottom-left-radius: var(--radius, 0.5rem);
        border-bottom-right-radius: var(--radius, 0.5rem);
      }

      .modal-filename {
        font-weight: 500;
      }

      .modal-details {
        font-size: 0.875rem;
        color: color-mix(in srgb, var(--background, #ffffff) 80%, transparent);
        margin-top: calc(var(--spacing, 0.25rem) * 1);
      }
    </style>
  </template>
}
