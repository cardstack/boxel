import { or, and, not } from '@cardstack/boxel-ui/helpers';
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
import ImageListItem from './components/image-list-item';
import ImageUploader from './components/image-uploader';
import DropZone from './components/drop-zone';
import CloudflareUploadButton from './components/cloudflare-upload-button';
import ErrorMessage from './components/error-message';
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './util/cloudflare-upload';
import {
  buildUploadHint,
  generateUploadId,
  mergeMultipleUploadConfig,
  hasFeature,
  simulateProgress,
  validateImageFile,
} from './util/index';
import type { MultipleUploadConfig } from './util/types';
import SingleUploadField from './single';
import {
  SortableGroupModifier as sortableGroup,
  SortableHandleModifier as sortableHandle,
  SortableItemModifier as sortableItem,
} from '@cardstack/boxel-ui/modifiers';
import { uuidv4 } from '@cardstack/runtime-common';

interface UploadEntry {
  id: string;
  file: File;
  base64Preview: string;
  uploadedImageUrl?: string;
  uploadUrl?: string;
  uploadProgress?: number; // Track upload progress
  uploadedBytes?: number;
  totalBytes?: number;
}

interface Configuration {
  presentation: MultipleUploadConfig;
}

class Edit extends Component<typeof MultipleUploadField> {
  @tracked uploadEntries: UploadEntry[] = [];
  @tracked errorMessage = '';
  sortableGroupId = uuidv4();

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

  get config(): MultipleUploadConfig {
    return mergeMultipleUploadConfig(
      this.args.configuration?.presentation as MultipleUploadConfig,
    );
  }

  get hasImages() {
    return this.uploadEntries.length > 0;
  }

  get maxFilesReached() {
    return (
      this.uploadEntries.length >= (this.config.validation?.maxFiles || 10)
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
    const maxFiles = this.config.validation?.maxFiles || 10;
    return `${baseHint} (max ${maxFiles} files)`;
  }

  get previewImages() {
    return this.uploadEntries.map((entry, index) => ({
      id: entry.id,
      preview: entry.uploadedImageUrl || entry.base64Preview,
      name: entry.file.name,
      size: entry.file.size,
      index: index + 1,
    }));
  }

  get hasDragDropFeature() {
    return hasFeature(this.config, 'drag-drop');
  }

  get canReorder() {
    return (
      hasFeature(this.config, 'reorder') && this.config.reorderOptions?.enabled
    );
  }

  get handleClass() {
    return this.config.reorderOptions?.handleClass || 'drag-handle';
  }

  get dropZoneLabel() {
    return (
      this.config.uploadOptions?.dragDrop?.dropzoneLabel ||
      'Drop images here or click to upload'
    );
  }

  get hasProgressFeature() {
    return hasFeature(this.config, 'progress');
  }

  get hasValidatedFeature() {
    return hasFeature(this.config, 'validated');
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
      if (this.hasValidatedFeature) {
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
      (this.config.validation?.maxFiles || 10) - this.uploadEntries.length;
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
  handleReorder(reorderedItems: UploadEntry[]) {
    this.uploadEntries = reorderedItems;
    if (this.uploadEntries.some((entry) => entry.uploadedImageUrl)) {
      this.persistEntries();
    }
  }

  @action
  persistEntries() {
    // Clear existing uploads first
    this.args.model.uploads = [];

    // Only add entries that have uploaded URLs
    this.uploadEntries
      .filter((entry) => entry.uploadedImageUrl)
      .forEach((entry) => {
        const uploadInstance = new SingleUploadField({
          uploadUrl: entry.uploadUrl, // Keep the uploadUrl like single.gts
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
      uploadProgress: 0,
      uploadedBytes: 0,
      totalBytes: file.size,
    };
  }

  createEntryFromExisting(upload: any): UploadEntry {
    // Create a minimal file-like object to avoid File constructor issues
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

    // Upload each image individually to catch specific errors
    for (const entry of pendingEntries) {
      try {
        // Reset progress
        if (this.hasProgressFeature) {
          entry.uploadProgress = 0;
          entry.uploadedBytes = 0;
          entry.totalBytes = entry.file.size;
          this.uploadEntries = [...this.uploadEntries]; // Trigger reactivity
        }

        const uploadUrl = await requestCloudflareUploadUrl(
          this.args.context?.commandContext,
          {
            source: 'boxel-multiple-image-field',
          },
        );
        entry.uploadUrl = uploadUrl;

        // Simulate progress
        if (this.hasProgressFeature) {
          entry.uploadProgress = 10;
          this.uploadEntries = [...this.uploadEntries];
          await simulateProgress(entry, () => {
            this.uploadEntries = [...this.uploadEntries]; // Trigger reactivity
          });
        }

        const imageUrl = await uploadFileToCloudflare(uploadUrl, entry.file);

        if (this.hasProgressFeature) {
          entry.uploadProgress = 100;
          entry.uploadedBytes = entry.totalBytes;
          this.uploadEntries = [...this.uploadEntries];
        }

        entry.uploadedImageUrl = imageUrl;
      } catch (error: any) {
        // Collect error message for this specific entry
        const fullErrorMessage = error.message || String(error);
        // Remove newlines from error message to prevent formatting issues
        const cleanErrorMessage = fullErrorMessage.replace(/\n/g, ' ').trim();
        errorMessages.push(`${entry.file.name}: ${cleanErrorMessage}`);

        // Reset progress on error
        if (this.hasProgressFeature) {
          entry.uploadProgress = 0;
          this.uploadEntries = [...this.uploadEntries];
        }
      }
    }

    // Trigger reactivity by reassigning the array
    this.uploadEntries = [...this.uploadEntries];
    this.persistEntries();

    // Show all error messages if any failed
    if (errorMessages.length > 0) {
      this.errorMessage = `Upload failed for ${
        errorMessages.length
      } image(s):\n${errorMessages.join('\n')}`;
    }
  });

  <template>
    <div class='multiple-upload-container' data-test-multiple-upload>
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
            @uploadText='Add Images'
            @uploadHint={{this.uploadHint}}
            @onFileSelect={{this.handleFileSelect}}
            @multiple={{true}}
            @height='100px'
            @testId='multiple-upload-area'
            @allowedFormats={{this.config.validation.allowedFormats}}
          />
        {{/if}}
      </div>

      {{#if this.hasImages}}
        <div class='list-section'>
          <div class='list-header'>
            <h3 class='list-title'>Product Images ({{this.uploadEntries.length}})</h3>
            {{#if this.canReorder}}
              <p class='list-subtitle'>Ordered list - drag to reorder</p>
            {{else}}
              <p class='list-subtitle'>Ordered list</p>
            {{/if}}
          </div>

          <div
            class='image-list'
            data-test-image-list
            {{sortableGroup
              groupName=this.sortableGroupId
              onChange=this.handleReorder
              disabled=(not this.canReorder)
            }}
          >
            {{#each this.uploadEntries as |entry|}}
              <ImageListItem
                @src={{if
                  entry.uploadedImageUrl
                  entry.uploadedImageUrl
                  entry.base64Preview
                }}
                @fileName={{entry.file.name}}
                @fileSize={{entry.file.size}}
                @showNumber={{false}}
                @showDragHandle={{this.canReorder}}
                @onRemove={{fn this.removeImage entry.id}}
                @showProgress={{and
                  this.hasProgressFeature
                  this.bulkUploadTask.isRunning
                }}
                @uploadProgress={{entry.uploadProgress}}
                @showPercentage={{true}}
                @showSizeInfo={{true}}
                @uploadedBytes={{entry.uploadedBytes}}
                @totalBytes={{entry.totalBytes}}
                @handleClass={{this.handleClass}}
                @enableHandleModifier={{this.canReorder}}
                {{sortableItem
                  groupName=this.sortableGroupId
                  model=entry
                  disabled=(not this.canReorder)
                }}
              />
            {{/each}}
          </div>
        </div>
      {{else}}
        <div class='empty-state' data-test-empty-state>
          No images uploaded yet. Click above to add images.
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
      .multiple-upload-container {
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

      .list-section {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 4);
      }

      .list-header {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 1);
        padding: 0 calc(var(--spacing, 0.25rem) * 2);
      }

      .list-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--foreground, #111827);
      }

      .list-subtitle {
        margin: 0;
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
      }

      .image-list {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }

      /* Dragging states */
      .image-list :global(.sortable-ghost) {
        opacity: 0.4;
        background: var(--accent, #f0f9ff);
      }

      .image-list :global(.sortable-drag) {
        opacity: 1;
        cursor: grabbing;
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

export default class MultipleUploadField extends FieldDef {
  static displayName = 'Multiple Upload Image Field';
  static icon = PhotoIcon;

  @field uploads = containsMany(SingleUploadField);

  static configuration: Configuration = {
    presentation: {
      type: 'multiple',
      showFileSize: true,
      features: ['drag-drop', 'reorder', 'progress'],
      validation: {
        maxFileSize: 2 * 1024 * 1024, // 10MB
        maxFiles: 2,
        allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
      },
      uploadOptions: {
        dragDrop: {
          dropzoneLabel: 'Drop images here or click to upload',
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
