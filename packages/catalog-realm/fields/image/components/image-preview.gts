import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import XIcon from '@cardstack/boxel-icons/x';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    src: string | undefined;
    alt?: string;
    height?: string;
    showPreview?: boolean;
    showFileName?: boolean;
    fileName?: string;
    showFileSize?: boolean;
    fileSize?: number;
    onRemove?: () => void;
  };
}

export default class ImagePreview extends Component<Signature> {
  get containerStyle() {
    return this.args.height ? `height: ${this.args.height}` : '';
  }

  get imageAlt() {
    return this.args.alt || 'Preview image';
  }

  get shouldShowPreview() {
    return this.args.showPreview !== false;
  }

  get shouldShowFileName() {
    return this.args.showFileName && this.args.fileName;
  }

  get shouldShowFileSize() {
    return this.args.showFileSize && typeof this.args.fileSize === 'number';
  }

  get hasMeta() {
    return this.shouldShowFileName || this.shouldShowFileSize;
  }

  get formattedFileSize(): string | undefined {
    if (!this.shouldShowFileSize || typeof this.args.fileSize !== 'number') {
      return;
    }
    const bytes = this.args.fileSize;
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  <template>
    <div class='image-preview-wrapper' ...attributes>
      {{#if this.shouldShowPreview}}
        <div class='image-container' style={{this.containerStyle}}>
          <img src={{@src}} alt={{this.imageAlt}} class='preview-image' />
          {{#if @onRemove}}
            <div class='image-overlay'>
              <button
                type='button'
                class='btn-remove'
                {{on 'click' @onRemove}}
                data-test-remove-button
              >
                <XIcon class='icon' />
              </button>
            </div>
          {{/if}}
        </div>
      {{/if}}

      {{#if this.hasMeta}}
        <div class='image-meta'>
          {{#if this.shouldShowFileName}}
            <div class='image-name'>{{@fileName}}</div>
          {{/if}}
          {{#if this.shouldShowFileSize}}
            <div class='image-size'>{{this.formattedFileSize}}</div>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .image-preview-wrapper {
        position: relative;
        width: 100%;
      }

      .image-container {
        position: relative;
        width: 100%;
        height: 256px;
      }

      .preview-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--boxel-border-radius, 0.5rem);
        display: block;
      }

      .image-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          180deg,
          rgba(0, 0, 0, 0.35),
          rgba(0, 0, 0, 0.05)
        );
        opacity: 0;
        transition: opacity 0.2s ease;
        border-radius: var(--boxel-border-radius, 0.5rem);
        display: flex;
        justify-content: flex-end;
        align-items: flex-start;
        padding: 0.5rem;
        pointer-events: none; /* only the button is interactive */
      }

      .image-container:hover .image-overlay {
        opacity: 1;
      }

      .btn-remove {
        background-color: var(--boxel-error-200, #ef4444);
        color: white;
        padding: 0.5rem;
        border: none;
        border-radius: 9999px;
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          box-shadow 0.15s ease,
          transform 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        pointer-events: auto;
        opacity: 0.95;
      }

      .btn-remove:hover {
        background-color: var(--boxel-error-300, #dc2626);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
        transform: translateY(-1px);
        opacity: 1;
      }

      .icon {
        width: 1.5rem;
        height: 1.5rem;
      }

      .image-name {
        font-size: 0.875rem;
        color: var(--boxel-600, #4b5563);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .image-meta {
        margin-top: 0.5rem;
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
      }

      .image-size {
        font-size: 0.75rem;
        color: var(--boxel-700, #374151);
        background: rgba(0, 0, 0, 0.04);
        border: 1px solid rgba(0, 0, 0, 0.05);
        padding: 0.2rem 0.45rem;
        border-radius: 999px;
        line-height: 1;
        backdrop-filter: blur(2px);
      }
    </style>
  </template>
}
