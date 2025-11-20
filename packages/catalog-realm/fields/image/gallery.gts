import {
  Component,
  FieldDef,
  field,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import PhotoIcon from '@cardstack/boxel-icons/photo';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { restartableTask } from 'ember-concurrency';
import ImageUploader from './components/image-uploader';
import DropZone from './components/drop-zone';
import CloudflareUploadButton from './components/cloudflare-upload-button';
import ErrorMessage from './components/error-message';
import XIcon from '@cardstack/boxel-icons/x';
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './util/cloudflare-upload';
import {
  buildUploadHint,
  generateUploadId,
  mergeGalleryUploadConfig,
  hasFeature,
} from './util/index';
import type { GalleryUploadConfig } from './util/types';
import SingleUploadField from './single';

interface UploadEntry {
  id: string;
  file: File;
  base64Preview: string;
  uploadedImageUrl?: string;
  uploadUrl?: string;
  selected?: boolean;
}

interface Configuration {
  presentation: GalleryUploadConfig;
}

class Edit extends Component<typeof GalleryUploadField> {
  @tracked uploadEntries: UploadEntry[] = [];
  @tracked errorMessage = '';
  @tracked selectAll = false;

  constructor(owner: unknown, args: unknown) {
    super(owner, args);
    const existingUploads = Array.isArray(this.args.model?.uploads)
      ? this.args.model.uploads
      : [];

    if (existingUploads.length) {
      this.uploadEntries = existingUploads.map((upload: any) =>
        this.createEntryFromExisting(upload),
      );
    }
  }

  get config(): GalleryUploadConfig {
    return mergeGalleryUploadConfig(
      this.args.configuration?.presentation as GalleryUploadConfig,
    );
  }

  get hasImages() {
    return this.uploadEntries.length > 0;
  }

  get maxFilesReached() {
    return (
      this.uploadEntries.length >= (this.config.validation?.maxFiles || 50)
    );
  }

  get hasPendingUploads() {
    return this.uploadEntries.some((entry) => !entry.uploadedImageUrl);
  }

  get showUploadButton() {
    return this.uploadEntries.length > 0;
  }

  get uploadButtonText() {
    if (this.bulkUploadTask.isRunning) {
      return 'Uploading...';
    }
    return this.hasPendingUploads ? 'Upload Images' : 'Uploaded successfully';
  }

  get uploadButtonDisabled() {
    return this.bulkUploadTask.isRunning || !this.hasPendingUploads;
  }

  get uploadHint() {
    const baseHint =
      buildUploadHint(
        this.config.validation?.allowedFormats,
        this.config.validation?.maxFileSize,
      ) || 'Upload images up to 10MB';
    const maxFiles = this.config.validation?.maxFiles || 50;
    return `${baseHint} (max ${maxFiles} files)`;
  }

  get hasSelection() {
    return this.uploadEntries.some((entry) => entry.selected);
  }

  get selectedCount() {
    return this.uploadEntries.filter((entry) => entry.selected).length;
  }

  get itemSize() {
    return this.config.itemSize || '200px';
  }

  get gridGap() {
    return this.config.gap || '1rem';
  }

  get gridStyles() {
    return {
      '--item-size': this.itemSize,
      '--grid-gap': this.gridGap,
    } as Record<string, string>;
  }

  get allowBatchSelect() {
    return this.config.allowBatchSelect !== false; // Default to true
  }

  get hasDragDropFeature() {
    return hasFeature(this.config, 'drag-drop');
  }

  get canReorder() {
    return (
      hasFeature(this.config, 'reorder') && this.config.reorderOptions?.enabled
    );
  }

  get dropZoneLabel() {
    return (
      this.config.uploadOptions?.dragDrop?.dropzoneLabel ||
      'Drop photos here or click to upload'
    );
  }

  @action
  async handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    await this.processFiles(files);
  }

  @action
  async handleFilesDropped(files: File[]) {
    await this.processFiles(files);
  }

  async processFiles(files: File[]) {
    if (!files.length) return;

    // Import validation utilities
    const { validateImageFile, validateImageDimensions } = await import(
      './util/index'
    );

    this.errorMessage = ''; // Clear previous errors

    const validFiles: File[] = [];
    const errors: string[] = [];

    // Validate each file
    for (const file of files) {
      // Basic validation (sync)
      const basicError = validateImageFile(file, this.config.validation);
      if (basicError) {
        errors.push(`${file.name}: ${basicError}`);
        continue;
      }

      // Dimension validation (async) - only if validated feature is enabled
      if (hasFeature(this.config, 'validated')) {
        const dimensionError = await validateImageDimensions(
          file,
          this.config.validation,
        );
        if (dimensionError) {
          errors.push(`${file.name}: ${dimensionError}`);
          continue;
        }
      }

      validFiles.push(file);
    }

    // Show validation errors if any
    if (errors.length > 0) {
      this.errorMessage = `Validation failed:\n${errors.join('\n')}`;
    }

    const remainingSlots =
      (this.config.validation?.maxFiles || 50) - this.uploadEntries.length;
    const filesToAdd = validFiles.slice(0, remainingSlots);

    filesToAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const entry = this.createEntry(file, reader.result as string);
        this.uploadEntries = [...this.uploadEntries, entry];
      };
      reader.readAsDataURL(file);
    });
  }

  @action
  toggleSelectAll() {
    this.selectAll = !this.selectAll;
    this.uploadEntries = this.uploadEntries.map((entry) => ({
      ...entry,
      selected: this.selectAll,
    }));
  }

  @action
  toggleSelection(id: string) {
    this.uploadEntries = this.uploadEntries.map((entry) =>
      entry.id === id ? { ...entry, selected: !entry.selected } : entry,
    );
    this.selectAll = this.uploadEntries.every((entry) => entry.selected);
  }

  @action
  removeImage(id: string) {
    this.uploadEntries = this.uploadEntries.filter((entry) => entry.id !== id);
    this.errorMessage = '';
    if (this.uploadEntries.some((entry) => entry.uploadedImageUrl)) {
      this.persistEntries();
    } else {
      this.args.model.uploads = [];
    }
  }

  @action
  deleteSelected() {
    this.uploadEntries = this.uploadEntries.filter((entry) => !entry.selected);
    this.selectAll = false;
    this.errorMessage = '';
    if (this.uploadEntries.some((entry) => entry.uploadedImageUrl)) {
      this.persistEntries();
    } else {
      this.args.model.uploads = [];
    }
  }

  @action
  persistEntries() {
    this.args.model.uploads = [];

    this.uploadEntries
      .filter((entry) => entry.uploadedImageUrl)
      .forEach((entry) => {
        const uploadInstance = new SingleUploadField({
          uploadUrl: entry.uploadUrl,
          uploadedImageUrl: entry.uploadedImageUrl,
        });
        this.args.model.uploads.push(uploadInstance);
      });
  }

  createEntry(file: File, base64Preview: string): UploadEntry {
    return {
      id: generateUploadId(),
      file,
      base64Preview,
      selected: false,
    };
  }

  createEntryFromExisting(upload: any): UploadEntry {
    const fileLike = {
      name: upload.fileName || 'uploaded-image',
      size: 0,
      type: 'image/jpeg',
    } as File;

    return {
      id: generateUploadId(),
      file: fileLike,
      base64Preview: upload.uploadedImageUrl || '',
      uploadedImageUrl: upload.uploadedImageUrl,
      uploadUrl: upload.uploadUrl,
      selected: false,
    };
  }

  bulkUploadTask = restartableTask(async () => {
    const pendingEntries = this.uploadEntries.filter(
      (entry) => !entry.uploadedImageUrl,
    );

    if (pendingEntries.length === 0) {
      return;
    }

    const errorMessages: string[] = [];

    for (const entry of pendingEntries) {
      try {
        const uploadUrl = await requestCloudflareUploadUrl(
          this.args.context?.commandContext,
          {
            source: 'boxel-gallery-image-field',
          },
        );
        entry.uploadUrl = uploadUrl;
        const imageUrl = await uploadFileToCloudflare(uploadUrl, entry.file);
        entry.uploadedImageUrl = imageUrl;
      } catch (error: any) {
        const fullErrorMessage = error.message || String(error);
        const cleanErrorMessage = fullErrorMessage.replace(/\n/g, ' ').trim();
        errorMessages.push(`${entry.file.name}: ${cleanErrorMessage}`);
      }
    }

    this.uploadEntries = [...this.uploadEntries];
    this.persistEntries();

    if (errorMessages.length > 0) {
      this.errorMessage = `Upload failed for ${
        errorMessages.length
      } image(s):\n${errorMessages.join('\n')}`;
    }
  });

  <template>
    <div class='gallery-upload-container' data-test-gallery-upload>
      <div class='upload-controls'>
        {{#if this.hasDragDropFeature}}
          <DropZone
            @uploadText={{this.dropZoneLabel}}
            @uploadHint={{this.uploadHint}}
            @onFilesDropped={{this.handleFilesDropped}}
            @multiple={{true}}
            @height='100px'
            @testId='drop-zone'
            @disabled={{this.maxFilesReached}}
            @allowedFormats={{this.config.validation.allowedFormats}}
          />
        {{else}}
          <ImageUploader
            @uploadText='Add Photos'
            @uploadHint={{this.uploadHint}}
            @onFileSelect={{this.handleFileSelect}}
            @multiple={{true}}
            @height='100px'
            @testId='gallery-upload-area'
            @allowedFormats={{this.config.validation.allowedFormats}}
          />
        {{/if}}
      </div>

      {{#if this.hasImages}}
        <div class='gallery-section'>
          <div class='gallery-header'>
            <div class='header-left'>
              <h3 class='gallery-title'>Portfolio Gallery ({{this.uploadEntries.length}})</h3>
            </div>
            {{#if this.allowBatchSelect}}
              <div class='header-actions'>
                <label class='select-all-checkbox'>
                  <input
                    type='checkbox'
                    checked={{this.selectAll}}
                    {{on 'change' this.toggleSelectAll}}
                    data-test-select-all
                  />
                  <span>Select All</span>
                </label>
                {{#if this.hasSelection}}
                  <button
                    type='button'
                    class='btn-delete-selected'
                    {{on 'click' this.deleteSelected}}
                    data-test-delete-selected
                  >
                    <XIcon class='icon' />
                    Delete ({{this.selectedCount}})
                  </button>
                {{/if}}
              </div>
            {{/if}}
          </div>

          <div
            class='gallery-grid'
            style={{this.gridStyles}}
            data-test-gallery-grid
          >
            {{#each this.uploadEntries as |entry|}}
              <div
                class='gallery-item
                  {{if entry.selected "gallery-item--selected"}}'
                data-test-gallery-item
              >
                {{#if this.allowBatchSelect}}
                  <div class='item-checkbox'>
                    <input
                      type='checkbox'
                      checked={{entry.selected}}
                      {{on 'change' (fn this.toggleSelection entry.id)}}
                      data-test-item-checkbox
                    />
                  </div>
                {{/if}}

                <div class='item-image-wrapper'>
                  <img
                    src={{if
                      entry.uploadedImageUrl
                      entry.uploadedImageUrl
                      entry.base64Preview
                    }}
                    alt={{entry.file.name}}
                    class='item-image'
                  />

                  <div class='item-overlay'>
                    <button
                      type='button'
                      class='btn-remove-single'
                      {{on 'click' (fn this.removeImage entry.id)}}
                      title='Remove'
                      data-test-remove-item
                    >
                      <XIcon class='icon-remove' />
                    </button>
                  </div>
                </div>
              </div>
            {{/each}}
          </div>
        </div>
      {{else}}
        <div class='empty-state' data-test-empty-state>
          No photos in gallery yet. Click above to add photos.
        </div>
      {{/if}}

      <CloudflareUploadButton
        @showButton={{this.showUploadButton}}
        @onUpload={{this.bulkUploadTask.perform}}
        @disabled={{this.uploadButtonDisabled}}
        @isUploading={{this.bulkUploadTask.isRunning}}
        @label={{this.uploadButtonText}}
      />

      <ErrorMessage @message={{this.errorMessage}} />
    </div>

    <style scoped>
      .gallery-upload-container {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 6);
      }

      .upload-controls {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 4);
        align-items: flex-start;
      }

      .gallery-section {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 4);
      }

      .gallery-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 calc(var(--spacing, 0.25rem) * 2);
        flex-wrap: wrap;
        gap: calc(var(--spacing, 0.25rem) * 3);
      }

      .header-left {
        flex: 1;
      }

      .gallery-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--foreground, #111827);
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 3);
      }

      .select-all-checkbox {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        font-size: 0.875rem;
        color: var(--foreground, #374151);
        cursor: pointer;
        user-select: none;
      }

      .select-all-checkbox input[type='checkbox'] {
        cursor: pointer;
      }

      .btn-delete-selected {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        padding: calc(var(--spacing, 0.25rem) * 2)
          calc(var(--spacing, 0.25rem) * 3);
        background: var(--destructive, #ef4444);
        color: white;
        border: none;
        border-radius: var(--radius, 0.375rem);
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .btn-delete-selected:hover {
        background: var(--destructive, #dc2626);
        box-shadow: var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
      }

      .btn-delete-selected .icon {
        width: 1rem;
        height: 1rem;
      }

      .gallery-grid {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(var(--item-size, 200px), 1fr)
        );
        gap: var(--grid-gap, 1rem);
      }

      .gallery-item {
        position: relative;
        aspect-ratio: 1 / 1;
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
        background: var(--muted, #f3f4f6);
        transition: all 0.15s ease;
      }

      .gallery-item--selected {
        outline: 3px solid var(--primary, #3b82f6);
        outline-offset: -3px;
      }

      .item-checkbox {
        position: absolute;
        top: calc(var(--spacing, 0.25rem) * 2);
        left: calc(var(--spacing, 0.25rem) * 2);
        z-index: 2;
      }

      .item-checkbox input[type='checkbox'] {
        width: 1.25rem;
        height: 1.25rem;
        cursor: pointer;
      }

      .item-image-wrapper {
        position: relative;
        width: 100%;
        height: 100%;
      }

      .item-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .item-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          180deg,
          rgba(0, 0, 0, 0.35),
          rgba(0, 0, 0, 0.05)
        );
        opacity: 0;
        transition: opacity 0.2s ease;
        display: flex;
        justify-content: flex-end;
        align-items: flex-start;
        padding: calc(var(--spacing, 0.25rem) * 2);
        pointer-events: none;
      }

      .gallery-item:hover .item-overlay {
        opacity: 1;
      }

      .btn-remove-single {
        background-color: var(--destructive, #ef4444);
        color: white;
        padding: calc(var(--spacing, 0.25rem) * 2);
        border: none;
        border-radius: 9999px;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        pointer-events: auto;
        opacity: 0.95;
      }

      .btn-remove-single:hover {
        background-color: var(--destructive, #dc2626);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
        transform: translateY(-1px);
        opacity: 1;
      }

      .icon-remove {
        width: 1.25rem;
        height: 1.25rem;
      }

      .empty-state {
        text-align: center;
        color: var(--muted-foreground, #9ca3af);
        padding: calc(var(--spacing, 0.25rem) * 8);
        font-size: 0.875rem;
        border: 1px dashed var(--border, #e5e7eb);
        border-radius: var(--radius, 0.75rem);
      }
    </style>
  </template>
}

export default class GalleryUploadField extends FieldDef {
  static displayName = 'Gallery Upload Image Field';
  static icon = PhotoIcon;

  @field uploads = containsMany(SingleUploadField);

  static configuration: Configuration = {
    presentation: {
      type: 'gallery',
      itemSize: '200px',
      gap: '1rem',
      allowBatchSelect: true,
      features: ['drag-drop', 'reorder', 'progress', 'batch-select'],
      validation: {
        maxFileSize: 10 * 1024 * 1024, // 10MB
        maxFiles: 50,
        allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
      },
      uploadOptions: {
        dragDrop: {
          dropzoneLabel: 'Drop photos here or click to upload',
        },
      },
      reorderOptions: {
        enabled: true,
        handleClass: 'drag-handle',
        ghostClass: 'dragging-ghost',
        chosenClass: 'dragging-chosen',
        animation: 150,
      },
    },
  };

  static edit = Edit;
}
