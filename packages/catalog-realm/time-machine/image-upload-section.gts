import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import { Button } from '@cardstack/boxel-ui/components';
import NotificationBubble from '../components/notification-bubble';
import {
  ImageUploadPreview,
  type ImagePreviewFrame,
} from '../components/image-upload-preview';

export interface ImageUploadSectionSignature {
  Args: {
    onFileSelected?: (file: File) => void;
    onUrlChange?: (url: string) => void;
    onCreativeNoteChange?: (note: string) => void;
    onGenerate?: () => void;
    onClear?: () => void;
    onExportAlbum?: () => void;
    uploadedImageData?: string;
    imageUrl?: string;
    creativeNote?: string;
    isGenerating?: boolean;
    isExporting?: boolean;
    generateLabel?: string;
    canExportAlbum?: boolean;
  };
}

export class ImageUploadSection extends Component<ImageUploadSectionSignature> {
  get uploadedImageData() {
    return this.args.uploadedImageData ?? '';
  }

  get previews(): ImagePreviewFrame[] {
    if (!this.uploadedImageData) {
      return [];
    }

    return [
      {
        url: this.uploadedImageData,
        label: 'Uploaded image preview',
      },
    ];
  }

  get imageUrl() {
    return this.args.imageUrl ?? '';
  }

  get creativeNote() {
    return this.args.creativeNote ?? '';
  }

  get generateLabel() {
    if (this.args.generateLabel) {
      return this.args.generateLabel;
    }
    return this.args.isGenerating ? 'Generating Images...' : 'Generate';
  }

  @action
  handleFilesSelected(files: File[]) {
    const [file] = files;
    if (!file) {
      return;
    }

    this.showNotification = false;
    this.args.onFileSelected?.(file);
  }

  @action
  handleUrlInput(event: Event) {
    const target = event.target as HTMLInputElement;
    if (this.args.onUrlChange) {
      this.args.onUrlChange(target.value);
    }
  }

  @action
  handleCreativeNoteInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    if (this.args.onCreativeNoteChange) {
      this.args.onCreativeNoteChange(target.value);
    }
  }

  @action
  handleClear() {
    this.args.onClear?.();
  }

  @action
  handleGenerate() {
    if (!this.uploadedImageData && !this.imageUrl) {
      this.showNotification = true;
      return;
    } else {
      this.showNotification = false;
    }
    this.args.onGenerate?.();
  }

  @action
  handleExportAlbum() {
    this.args.onExportAlbum?.();
  }

  @action
  handlePreviewRemove(_index: number) {
    this.handleClear();
  }

  @tracked showNotification = false;

  <template>
    <section class='input-section'>
      <ImageUploadPreview
        @label='Upload Image'
        @previews={{this.previews}}
        @multiple={{false}}
        @onFilesSelected={{this.handleFilesSelected}}
        @onRemove={{this.handlePreviewRemove}}
      />

      <div class='url-input-section'>
        <label for='image-url'>Or use Image URL:</label>
        <input
          id='image-url'
          type='url'
          class='image-url-input'
          placeholder='Enter the URL of a publicly available image...'
          value={{this.imageUrl}}
          {{on 'input' this.handleUrlInput}}
          disabled={{this.uploadedImageData}}
        />
      </div>

      {{#if this.imageUrl}}
        <div class='image-preview'>
          <label>URL Image Preview:</label>
          <img
            src={{this.imageUrl}}
            alt='Preview of source URL for time machine generation'
            class='preview-image'
          />
        </div>
      {{/if}}

      <div class='creative-note-section'>
        <div class='post-it-note'>
          <div class='post-it-header'>
            <span class='post-it-title'>Creative Notes</span>
            <span class='post-it-pin'>📌</span>
          </div>
          <label for='creative-notes' class='sr-only'>Creative notes for photo
            generation</label>
          <textarea
            id='creative-notes'
            class='post-it-textarea'
            placeholder='Add creative suggestions for the photos... \ne.g., "Make them look like a professional photographer", "Add vintage lighting", "Include period-appropriate props"...'
            value={{this.creativeNote}}
            {{on 'input' this.handleCreativeNoteInput}}
          ></textarea>
          <div class='post-it-footer'>
            <span class='post-it-signature'>✨ Photo tips</span>
          </div>
        </div>
      </div>

      {{#if this.showNotification}}
        <div class='notification-bubble-wrapper'>
          <NotificationBubble
            @type='error'
            @message='Please upload an image or provide an image URL before generating.'
          />
        </div>
      {{/if}}

      <div class='action-buttons'>
        <Button
          @kind='primary'
          class='generate-button'
          {{on 'click' this.handleGenerate}}
          disabled={{@isGenerating}}
        >
          {{this.generateLabel}}
        </Button>

        {{#if @canExportAlbum}}
          <Button
            @kind='secondary'
            @loading={{@isExporting}}
            disabled={{@isExporting}}
            {{on 'click' this.handleExportAlbum}}
          >
            {{#if @isExporting}}
              Exporting...
            {{else}}
              Export Album
            {{/if}}
          </Button>
        {{/if}}
      </div>

      {{! TODO(feature-plan): surface validation + error messaging from host context. }}
    </section>

    <style scoped>
      .notification-bubble-wrapper {
        display: flex;
        justify-content: center;
        margin-bottom: 0.5rem;
      }
      .input-section {
        background: var(--card, rgba(255, 255, 255, 0.8));
        padding: 1rem;
        border-radius: var(--radius, 12px);
        margin-bottom: 1.25rem;
        border: 1px solid var(--border, rgba(208, 122, 78, 0.1));
        backdrop-filter: blur(10px);
        box-shadow: var(--shadow-lg, 0 6px 24px rgba(0, 0, 0, 0.08));
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      @media (max-width: 767px) {
        .input-section {
          padding: 1rem;
          border-radius: 10px;
        }
      }

      @media (max-width: 480px) {
        .input-section {
          padding: 0.875rem;
        }
      }

      .url-input-section {
        margin-bottom: 1.5rem;
      }

      .url-input-section label {
        display: block;
        margin-bottom: 0.75rem;
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        color: #2c2c2c;
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .image-url-input {
        width: 100%;
        padding: 1rem;
        border: 2px solid var(--input, rgba(208, 122, 78, 0.2));
        border-radius: var(--radius, 12px);
        font-family: var(--font-sans, 'Inter', sans-serif);
        font-size: 0.95rem;
        background: var(--card, rgba(255, 255, 255, 0.7));
        transition: all 0.3s ease;
        color: var(--foreground, #2c2c2c);
      }

      .image-url-input:focus {
        outline: none;
        border-color: rgba(208, 122, 78, 0.6);
        box-shadow: 0 0 0 4px rgba(208, 122, 78, 0.1);
        background: rgba(255, 255, 255, 0.9);
      }

      .image-url-input:disabled {
        background: #f8f9fa;
        color: #6c757d;
        cursor: not-allowed;
        opacity: 0.6;
      }

      .image-preview {
        margin-bottom: 1.5rem;
      }

      .image-preview label {
        display: block;
        margin-bottom: 0.75rem;
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        color: #2c2c2c;
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .preview-image {
        max-width: 180px;
        max-height: 180px;
        border-radius: 8px;
        border: 3px solid #ffffff;
        object-fit: cover;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15);
        transition: transform 0.3s ease;
      }

      .preview-image:hover {
        transform: scale(1.02);
      }

      .creative-note-section {
        margin-bottom: 1.5rem;
        display: flex;
        justify-content: center;
        position: relative;
      }

      .post-it-note {
        background: linear-gradient(135deg, #fffbe6, #ffeccd);
        border-radius: 12px;
        padding: 1rem;
        width: 100%;
        position: relative;
        box-shadow:
          0 10px 20px rgba(0, 0, 0, 0.12),
          0 0 0 1px rgba(0, 0, 0, 0.04);
        transform: rotate(-0.8deg);
      }

      .post-it-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
      }

      .post-it-title {
        font-family: 'Kalam', cursive;
        font-size: 1.1rem;
        color: #2c2c2c;
      }

      .post-it-pin {
        font-size: 1.25rem;
      }

      .post-it-textarea {
        width: 100%;
        min-height: 140px;
        border: none;
        background: transparent;
        font-family: 'Kalam', cursive;
        font-size: 1rem;
        line-height: 1.6;
        color: #2c2c2c;
        resize: vertical;
      }

      .post-it-textarea:focus {
        outline: none;
      }

      .post-it-footer {
        display: flex;
        justify-content: flex-end;
        margin-top: 0.75rem;
      }

      .post-it-signature {
        font-family: 'Kalam', cursive;
        font-size: 0.95rem;
        color: rgba(44, 44, 44, 0.8);
      }

      .action-buttons {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        align-items: center;
      }

      .generate-button {
        min-width: 200px;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    </style>
  </template>
}
