// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { Component } from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import { on } from '@ember/modifier'; // ² Event handling
import XIcon from '@cardstack/boxel-icons/x'; // ³ Icon import

// ⁴ Component signature interface
interface PreviewModalSignature {
  Args: {
    imageData: string;
    fileName?: string;
    fileSize?: number;
    onClose: () => void;
  };
}

// ⁵ Full-screen preview modal component
export class PreviewModal extends Component<PreviewModalSignature> {
  get formattedSize() {
    // ⁶ Format file size
    const bytes = this.args.fileSize;
    if (!bytes) return '';

    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  <template>
    <div class='preview-modal' {{on 'click' @onClose}}>
      {{! ⁷ Modal overlay }}
      <div class='modal-content'>
        <button type='button' {{on 'click' @onClose}} class='modal-close'>
          <XIcon class='icon' />
        </button>
        <img src={{@imageData}} alt={{@fileName}} class='modal-image' />
        <div class='modal-info'>
          {{! ⁸ File information }}
          <div class='modal-filename'>{{@fileName}}</div>
          <div class='modal-details'>{{this.formattedSize}}</div>
        </div>
      </div>
    </div>

    <style
      scoped
    > {{! ⁹ Component styles }}
      .preview-modal {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 50;
        padding: 1rem;
      }

      .modal-content {
        position: relative;
        max-width: 64rem;
        max-height: 100%;
      }

      .modal-close {
        position: absolute;
        top: -3rem;
        right: 0;
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
        max-height: 80vh;
        border-radius: var(--radius, 0.5rem);
        box-shadow: var(--shadow-2xl, 0 25px 50px -12px rgb(0 0 0 / 0.25));
      }

      .modal-info {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.5);
        color: white;
        padding: 1rem;
        border-bottom-left-radius: var(--radius, 0.5rem);
        border-bottom-right-radius: var(--radius, 0.5rem);
      }

      .modal-filename {
        font-weight: 500;
      }

      .modal-details {
        font-size: 0.875rem;
        color: #d1d5db;
        margin-top: 0.25rem;
      }
    </style>
  </template>
}
