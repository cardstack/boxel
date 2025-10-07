import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { Button } from '@cardstack/boxel-ui/components';

export interface ImageUploadSectionSignature {
  Args: {
    onFileSelected?: (file: File) => void;
    onUrlChange?: (url: string) => void;
    onCreativeNoteChange?: (note: string) => void;
    onGenerate?: () => void;
    onClear?: () => void;
    uploadedImageData?: string;
    imageUrl?: string;
    creativeNote?: string;
    isGenerating?: boolean;
    generateLabel?: string;
  };
}

export class ImageUploadSection extends Component<ImageUploadSectionSignature> {
  get uploadedImageData() {
    return this.args.uploadedImageData ?? '';
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
    return this.args.isGenerating ? 'Generating Images...' : 'Generate Through the Ages';
  }

  @action
  handleFileChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (file && this.args.onFileSelected) {
      this.args.onFileSelected(file);
    }
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
    this.args.onGenerate?.();
  }

  <template>
    <section class='input-section'>
      <div class='upload-section'>
        <label for='image-upload'>Upload Image (PNG/JPG):</label>
        <input
          id='image-upload'
          type='file'
          accept='image/*'
          class='file-input'
          {{on 'change' this.handleFileChange}}
        />
        {{#if this.uploadedImageData}}
          <Button
            @kind='secondary'
            class='clear-upload-button'
            {{on 'click' this.handleClear}}
          >
            Clear Uploaded Image
          </Button>
        {{/if}}
      </div>

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

      {{#if this.uploadedImageData}}
        <div class='image-preview'>
          <label>Uploaded Image Preview:</label>
          <img
            src={{this.uploadedImageData}}
            alt='Uploaded image preview'
            class='preview-image'
          />
        </div>
      {{else if this.imageUrl}}
        <div class='image-preview'>
          <label>URL Image Preview:</label>
          <img
            src={{this.imageUrl}}
            alt='Source image preview'
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
          <textarea
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

      <Button
        @kind='primary'
        class='generate-button'
        {{on 'click' this.handleGenerate}}
        disabled={{this.args.isGenerating}}
      >
        {{this.generateLabel}}
      </Button>

      {{! TODO(feature-plan): surface validation + error messaging from host context. }}
    </section>

    <style scoped>
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

      .upload-section {
        margin-bottom: 1.5rem;
        padding-bottom: 1.5rem;
        border-bottom: 2px solid rgba(208, 122, 78, 0.15);
      }

      .upload-section label {
        display: block;
        margin-bottom: 0.75rem;
        font-family: var(--font-sans, 'Inter', sans-serif);
        font-weight: 600;
        color: var(--foreground, #2c2c2c);
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .file-input {
        width: 100%;
        padding: 1rem;
        border: 2px dashed var(--border, rgba(208, 122, 78, 0.3));
        border-radius: var(--radius, 12px);
        font-family: var(--font-sans, 'Inter', sans-serif);
        font-size: 0.95rem;
        background: var(--muted, rgba(250, 247, 242, 0.5));
        cursor: pointer;
        transition: all 0.3s ease;
        margin-bottom: 0.75rem;
        color: var(--foreground, #2c2c2c);
      }

      .file-input:hover {
        border-color: rgba(208, 122, 78, 0.6);
        background: rgba(208, 122, 78, 0.05);
        transform: translateY(-1px);
      }

      .clear-upload-button {
        padding: 0.75rem 1.25rem;
        font-family: 'Inter', sans-serif;
        font-size: 0.85rem;
        font-weight: 500;
        border-radius: 8px;
        border: 2px solid rgba(220, 53, 69, 0.3);
        background: rgba(255, 255, 255, 0.9);
        color: #dc3545;
        cursor: pointer;
        transition: all 0.3s ease;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .clear-upload-button:hover {
        background: #dc3545;
        color: white;
        border-color: #dc3545;
        transform: translateY(-1px);
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

      .generate-button {
        align-self: center;
        padding: 1rem 1.5rem;
        font-size: 0.95rem;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
    </style>
  </template>
}
