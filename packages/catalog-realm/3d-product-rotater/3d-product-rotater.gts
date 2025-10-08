import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import PackageIcon from '@cardstack/boxel-icons/package';
import StringField from 'https://cardstack.com/base/string';
import {
  Button,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import { fn, get, concat } from '@ember/helper';
import { gt, eq, or, not, add } from '@cardstack/boxel-ui/helpers';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import FileUploadModifier from './modifiers/file-upload';
import DragRotateModifier from './modifiers/drag-rotate';
import { GenerateProductRotations } from '../commands/generate-product-rotations';

class ProductRotatorIsolated extends Component<typeof ProductRotator> {
  @tracked selectedFiles: File[] = [];
  @tracked previewUrls: string[] = [];
  @tracked productDescription = '';
  @tracked imageCount = 8;
  @tracked rotationImages: string[] = [];
  @tracked currentRotationIndex = 0;
  @tracked error = '';
  @tracked fileInputEl: HTMLInputElement | null = null;

  @action registerFileInput(el: HTMLInputElement) {
    this.fileInputEl = el;
  }

  @action openFilePicker() {
    try {
      this.fileInputEl?.click();
    } catch (e) {
      console.error('openFilePicker failed', e);
    }
  }

  @action onFileSelected(file: File) {
    // Validate the file
    if (!file.type.startsWith('image/')) {
      this.error = `Please choose an image file. Invalid file: ${file.name}`;
      return;
    }

    this.error = '';

    // Append new file to existing selection
    this.selectedFiles = [...this.selectedFiles, file];
    this.previewUrls = [...this.previewUrls, URL.createObjectURL(file)];

    // Clear the file input so the same file can be selected again
    if (this.fileInputEl) {
      this.fileInputEl.value = '';
    }
  }

  @action clearPreviews() {
    this.previewUrls.forEach((url) => URL.revokeObjectURL(url));
    this.previewUrls = [];
  }

  @action removeImage(index: number) {
    // Revoke the URL for the image being removed
    URL.revokeObjectURL(this.previewUrls[index]);

    // Remove from both arrays
    this.selectedFiles = this.selectedFiles.filter((_, i) => i !== index);
    this.previewUrls = this.previewUrls.filter((_, i) => i !== index);
  }

  @action handleRemoveClick(index: number, event: Event) {
    // Prevent event bubbling to avoid triggering file picker
    event.stopPropagation();
    event.preventDefault();

    this.removeImage(index);
  }

  @action updateDescription(value: string) {
    this.productDescription = value;
  }

  @action updateImageCount(value: string) {
    const count = parseInt(value);
    if (!isNaN(count) && count >= 2 && count <= 16) {
      this.imageCount = count;
    }
  }

  get isValidInput() {
    return (
      this.selectedFiles.length > 0 && this.productDescription.trim().length > 0
    );
  }

  get rotationAngles() {
    const angles: number[] = [];
    const step = 360 / this.imageCount;
    for (let i = 0; i < this.imageCount; i++) {
      angles.push(Math.round(i * step));
    }
    return angles;
  }

  @action
  generateRotationViews() {
    if (this.selectedFiles.length === 0) {
      this.error = 'Please select at least one product image first';
      return;
    }
    this._generateRotationViews.perform();
  }

  _generateRotationViews = task(async () => {
    this.error = '';
    this.rotationImages = [];

    try {
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        throw new Error('No command context found');
      }

      // Convert all selected images to base64
      const base64Images = await Promise.all(
        this.selectedFiles.map((file) => this.fileToBase64(file)),
      );

      // Use the standalone command instead of inline logic
      const generateRotationsCommand = new GenerateProductRotations(
        commandContext,
      );
      const result = await generateRotationsCommand.execute({
        productImages: base64Images,
        productDescription: this.productDescription,
        rotationAngles: this.rotationAngles.join(','),
      });

      this.rotationImages = result.generatedImages;
      this.currentRotationIndex = 0;
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : 'Failed to generate rotation views';
      console.error('Rotation generation failed:', error);
    }
  });

  @action
  onRotationDrag(deltaX: number) {
    if (this.rotationImages.length === 0) {
      return;
    }

    // Much more sensitive - every 8 pixels of drag moves to next/previous image
    const sensitivity = 30;
    const steps = Math.floor(Math.abs(deltaX) / sensitivity);

    if (steps > 0) {
      const direction = deltaX > 0 ? 1 : -1;
      let newIndex = this.currentRotationIndex + direction * steps;

      while (newIndex < 0) {
        newIndex += this.rotationImages.length;
      }
      while (newIndex >= this.rotationImages.length) {
        newIndex -= this.rotationImages.length;
      }

      this.currentRotationIndex = newIndex;
    }
  }

  @action
  setRotationIndex(index: number) {
    this.currentRotationIndex = index;
  }

  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  willDestroy(): void {
    this.clearPreviews();
    super.willDestroy();
  }

  <template>
    <main class='rotator-app'>
      <header class='app-header'>
        <h1>🔄 3D Product Rotator</h1>
        <p>Upload product images from different angles and describe it to
          prepare for 360° rendering</p>
      </header>

      <div class='app-content'>
        <div class='upload-section'>
          <FieldContainer
            @tag='label'
            @label='1. Select Product Images'
            @vertical={{true}}
          >
            <input
              type='file'
              accept='image/*'
              class='hidden-file-input'
              id='product-image-upload'
              {{FileUploadModifier this.onFileSelected this.registerFileInput}}
            />
            <Button
              @kind='secondary'
              class='upload-button'
              {{on 'click' this.openFilePicker}}
            >
              Add Image
            </Button>

            {{#if (gt this.previewUrls.length 0)}}
              <div class='previews'>
                <p class='preview-count'>Selected
                  {{this.previewUrls.length}}
                  image(s)</p>
                <div class='preview-grid'>
                  {{#each this.previewUrls as |previewUrl index|}}
                    <div class='preview-item'>
                      <div class='preview-image-container'>
                        <img
                          src={{previewUrl}}
                          alt={{concat 'Product preview ' (add index 1)}}
                        />
                        <button
                          class='remove-button'
                          type='button'
                          {{on 'click' (fn this.handleRemoveClick index)}}
                          title='Remove this image'
                        >
                          ×
                        </button>
                      </div>
                      <span class='preview-label'>View {{add index 1}}</span>
                    </div>
                  {{/each}}
                </div>
              </div>
            {{/if}}
          </FieldContainer>

          <FieldContainer
            @tag='label'
            @label='2. Describe Your Product'
            @vertical={{true}}
          >
            <BoxelInput
              @type='textarea'
              @placeholder='e.g., A shiny red metal water bottle with chrome cap'
              @value={{this.productDescription}}
              @onInput={{this.updateDescription}}
            />
          </FieldContainer>

          <FieldContainer
            @tag='label'
            @label='3. Number of Rotation Images'
            @vertical={{true}}
          >
            <BoxelInput
              @type='number'
              @min='2'
              @max='16'
              @value={{this.imageCount}}
              @onInput={{this.updateImageCount}}
              @placeholder='8'
            />
            <p class='field-help'>
              More images = smoother rotation but longer generation time (2-16
              images)
            </p>
          </FieldContainer>

          <Button
            @kind='primary'
            class='generate-button'
            {{on 'click' this.generateRotationViews}}
            disabled={{or
              this._generateRotationViews.isRunning
              (not this.isValidInput)
            }}
            @loading={{this._generateRotationViews.isRunning}}
          >
            {{if
              this._generateRotationViews.isRunning
              (concat 'Generating ' this.imageCount ' Views...')
              (concat 'Generate ' this.imageCount ' Views')
            }}
          </Button>
        </div>

        {{#if this.error}}
          <div class='error-message'>
            <strong>Error:</strong>
            {{this.error}}
          </div>
        {{/if}}

        {{#if (gt this.rotationImages.length 0)}}
          <section class='viewer'>
            <h3>Interactive 360° View</h3>
            <p>Drag the image left or right to rotate the product</p>

            <div
              class='spin-surface'
              {{DragRotateModifier this.onRotationDrag}}
            >
              <img
                src={{get this.rotationImages this.currentRotationIndex}}
                alt='Product 360 view'
                class='rotation-image'
              />
              <div class='rotation-indicator'>
                Angle:
                {{get this.rotationAngles this.currentRotationIndex}}°
              </div>
            </div>

            <div class='thumbnails'>
              {{#each this.rotationImages as |imageUrl index|}}
                <img
                  src={{imageUrl}}
                  alt={{concat (get this.rotationAngles index) '° view'}}
                  class={{concat
                    'thumbnail '
                    (if (eq index this.currentRotationIndex) 'active' '')
                  }}
                  role='button'
                  tabindex='0'
                  {{on 'click' (fn this.setRotationIndex index)}}
                />
              {{/each}}
            </div>
          </section>
        {{/if}}
      </div>
    </main>

    <style scoped>
      .rotator-app {
        padding: 2rem;
        max-width: 800px;
        margin: 0 auto;
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
      }

      .app-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .app-header h1 {
        color: #1f2937;
        font-size: 2rem;
        margin-bottom: 0.5rem;
        font-weight: 700;
      }

      .app-content {
        display: flex;
        flex-direction: column;
        gap: 2rem;
      }

      .upload-section {
        background: #f9fafb;
        padding: 1.5rem;
        border-radius: 12px;
        border: 2px dashed #d1d5db;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .upload-button {
        align-self: flex-start;
      }

      .hidden-file-input {
        display: none;
      }

      .previews {
        margin-top: 0.5rem;
      }

      .preview-count {
        font-size: 0.875rem;
        color: #6b7280;
        margin-bottom: 0.5rem;
        font-weight: 500;
      }

      .preview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 0.75rem;
        max-width: 500px;
      }

      .preview-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
      }

      .preview-image-container {
        position: relative;
        width: 100%;
      }

      .preview-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        aspect-ratio: 1/1;
        border-radius: 6px;
        border: 1px solid #e5e7eb;
        display: block;
      }

      .remove-button {
        position: absolute;
        top: -8px;
        right: -8px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #dc2626;
        color: white;
        border: none;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        transition: all 0.2s;
      }

      .remove-button:hover {
        background: #b91c1c;
        transform: scale(1.1);
      }

      .preview-label {
        font-size: 0.75rem;
        color: #6b7280;
        font-weight: 500;
      }

      .generate-button {
        align-self: flex-start;
        padding: 0.75rem 1.5rem;
        font-size: 1rem;
        font-weight: 600;
      }

      .viewer {
        padding: 1.5rem;
        background: #f0f8ff;
        border: 1px solid #bfdbfe;
        border-radius: 12px;
        color: #1e40af;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .viewer h3 {
        margin: 0;
        color: #1e40af;
      }

      .viewer p {
        margin: 0;
        font-size: 0.875rem;
        color: #3730a3;
      }

      .spin-surface {
        width: 100%;
        min-height: 300px;
        background: #fafafa;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        cursor: grab;
        user-select: none;
        overflow: hidden;
      }

      .spin-surface:active {
        cursor: grabbing;
      }

      .rotation-image {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        border-radius: 4px;
      }

      .rotation-indicator {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 600;
      }

      .thumbnails {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.5rem;
        overflow-x: auto;
        padding: 0.5rem 0;
      }

      .thumbnail {
        width: 60px;
        height: 60px;
        object-fit: cover;
        border-radius: 6px;
        border: 2px solid transparent;
        cursor: pointer;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .thumbnail:hover {
        border-color: #93c5fd;
        transform: scale(1.05);
      }

      .thumbnail.active {
        border-color: #2563eb;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
      }

      .error-message {
        padding: 1rem;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #dc2626;
        font-size: 0.875rem;
      }

      p {
        color: #6b7280;
        line-height: 1.6;
        margin: 0.5rem 0;
      }

      .field-help {
        font-size: 0.75rem;
        color: #9ca3af;
        margin-top: 0.25rem;
        margin-bottom: 0;
      }

      @media (max-width: 640px) {
        .rotator-app {
          padding: 1rem;
        }

        .app-header h1 {
          font-size: 1.5rem;
        }

        .upload-section {
          padding: 1rem;
        }

        .viewer {
          padding: 1rem;
        }
      }
    </style>
  </template>
}

export class ProductRotator extends CardDef {
  static displayName = '3D Product Rotator';
  static icon = PackageIcon;

  @field title = contains(StringField, {
    computeVia: function (this: ProductRotator) {
      return '3D Product Rotator';
    },
  });

  static isolated = ProductRotatorIsolated;
}
