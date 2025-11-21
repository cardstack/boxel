import {
  Component,
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import PhotoIcon from '@cardstack/boxel-icons/photo';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import type { SingleUploadConfig } from './util/types';
import ImageUploader from './components/image-uploader';
import DropZone from './components/drop-zone';
import ImageListItem from './components/image-list-item';
import CloudflareUploadButton from './components/cloudflare-upload-button';
import ErrorMessage from './components/error-message';
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './util/cloudflare-upload';
import {
  buildUploadHint,
  mergeSingleUploadConfig,
  hasFeature,
  simulateProgress,
  validateImageFile,
} from './util/index';

interface Configuration {
  presentation: SingleUploadConfig;
}

class Edit extends Component<typeof SingleUploadField> {
  @tracked imageName: string = '';
  @tracked imageSize: number | undefined;
  @tracked previewUrl: string | undefined;
  @tracked errorMessage = '';
  @tracked selectedFile: File | null = null;
  @tracked uploadProgress = 0;
  @tracked uploadedBytes = 0;
  @tracked totalBytes = 0;

  constructor(owner: any, args: any) {
    super(owner, args);
    if (args.model?.uploadedImageUrl) {
      this.imageName = 'Uploaded Image';
      this.previewUrl = args.model.uploadedImageUrl;
    }
  }

  get config(): SingleUploadConfig {
    // Fall back to static configuration if no instance configuration
    const instanceConfig = this.args.configuration
      ?.presentation as SingleUploadConfig;
    const staticConfig = (this.constructor as typeof SingleUploadField)
      .configuration?.presentation;

    return mergeSingleUploadConfig(instanceConfig || staticConfig);
  }

  get uploadText(): string {
    return this.config.placeholder || 'Click to upload';
  }

  get uploadHint(): string {
    return buildUploadHint(
      this.config.validation?.allowedFormats,
      this.config.validation?.maxFileSize,
    );
  }

  get hasImage() {
    return !!(this.previewUrl || this.args.model?.uploadedImageUrl);
  }

  get displayImage() {
    return this.previewUrl || this.args.model?.uploadedImageUrl;
  }

  get formattedFileSize(): string {
    if (!this.imageSize) return '';
    const bytes = this.imageSize;
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  get hasPendingUpload() {
    return !!(this.previewUrl && this.selectedFile);
  }

  get showUploadButton() {
    return this.hasImage;
  }

  get uploadButtonLabel() {
    if (this.uploadImageTask.isRunning) {
      return 'Uploading...';
    }
    if (this.hasPendingUpload) {
      return 'Upload Image to Cloudflare';
    }
    if (this.args.model?.uploadedImageUrl) {
      return 'Uploaded successfully';
    }
    return 'Upload Image';
  }

  get uploadButtonDisabled() {
    if (
      this.uploadImageTask.isRunning ||
      this.generateUploadUrlTask.isRunning
    ) {
      return true;
    }
    return !this.hasPendingUpload;
  }

  get hasDragDropFeature() {
    return hasFeature(this.config, 'drag-drop');
  }

  get hasProgressFeature() {
    return hasFeature(this.config, 'progress');
  }

  get hasValidatedFeature() {
    return hasFeature(this.config, 'validated');
  }

  get dropZoneLabel() {
    return (
      this.config.uploadOptions?.dragDrop?.dropzoneLabel || this.uploadText
    );
  }

  get showProgressBar() {
    return this.hasProgressFeature && this.uploadImageTask.isRunning;
  }

  @action
  async handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    await this.processFile(file);

    // Reset input
    input.value = '';
  }

  @action
  async handleFilesDropped(files: File[]) {
    const file = files[0]; // Single upload - take first file only
    if (file) {
      await this.processFile(file);
    }
  }

  async processFile(file: File) {
    // Import validation utilities
    const { validateImageFile, validateImageDimensions } = await import(
      './util/index'
    );

    // Validate basic file properties (sync)
    const basicError = validateImageFile(file, this.config.validation);
    if (basicError) {
      this.errorMessage = basicError;
      this.selectedFile = null;
      return;
    }

    // Validate dimensions (async) - only if 'validated' feature is enabled
    if (this.hasValidatedFeature) {
      const dimensionError = await validateImageDimensions(
        file,
        this.config.validation,
      );
      if (dimensionError) {
        this.errorMessage = dimensionError;
        this.selectedFile = null;
        return;
      }
    }

    this.selectedFile = file;
    this.errorMessage = '';

    // Read and preview file
    const reader = new FileReader();
    reader.onloadend = () => {
      this.imageName = file.name;
      this.imageSize = file.size;
      this.previewUrl = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  @action
  removeImage() {
    this.imageName = '';
    this.imageSize = undefined;
    this.previewUrl = undefined;
    this.selectedFile = null;
    this.errorMessage = '';
    this.args.model.uploadUrl = undefined;
    this.args.model.uploadedImageUrl = undefined;
  }

  generateUploadUrlTask = restartableTask(async () => {
    try {
      this.args.model.uploadUrl = await requestCloudflareUploadUrl(
        this.args.context?.commandContext,
        {
          source: 'boxel-single-image-field',
        },
      );
    } catch (error: any) {
      this.errorMessage = `Failed to generate upload URL: ${error.message}`;
      throw error;
    }
  });

  uploadImageTask = restartableTask(async () => {
    if (!this.selectedFile) {
      this.errorMessage = 'Please select a file first';
      return;
    }

    // Reset progress
    this.uploadProgress = 0;
    this.uploadedBytes = 0;
    this.totalBytes = this.selectedFile.size;

    await this.generateUploadUrlTask.perform();

    if (!this.args.model.uploadUrl) {
      return;
    }

    try {
      // Simulate progress if feature enabled
      if (this.hasProgressFeature) {
        this.uploadProgress = 10;
        await simulateProgress(this, () => {
          // Trigger reactivity by updating tracked properties
          this.uploadProgress = this.uploadProgress;
        });
      }

      const imageUrl = await uploadFileToCloudflare(
        this.args.model.uploadUrl,
        this.selectedFile,
      );

      if (this.hasProgressFeature) {
        this.uploadProgress = 100;
        this.uploadedBytes = this.totalBytes;
      }

      this.args.model.uploadedImageUrl = imageUrl;
      this.previewUrl = imageUrl;
      this.selectedFile = null;
      this.errorMessage = '';
    } catch (error: any) {
      this.errorMessage = `Upload failed: ${error.message}`;
      this.uploadProgress = 0;
      throw error;
    }
  });

  <template>
    <div class='single-upload-container' data-test-single-upload>
      {{#if this.hasImage}}
        {{! List/strip style preview with progress inside }}
        <div class='preview-section'>
          <ImageListItem
            @src={{this.displayImage}}
            @fileName={{this.imageName}}
            @fileSize={{this.imageSize}}
            @showNumber={{false}}
            @showDragHandle={{false}}
            @onRemove={{this.removeImage}}
            @showProgress={{this.showProgressBar}}
            @uploadProgress={{this.uploadProgress}}
            @showPercentage={{true}}
            @showSizeInfo={{true}}
            @uploadedBytes={{this.uploadedBytes}}
            @totalBytes={{this.totalBytes}}
          />
        </div>

        <CloudflareUploadButton
          @showButton={{this.showUploadButton}}
          @onUpload={{this.uploadImageTask.perform}}
          @disabled={{this.uploadButtonDisabled}}
          @isUploading={{this.uploadImageTask.isRunning}}
          @label={{this.uploadButtonLabel}}
        />
        <ErrorMessage @message={{this.errorMessage}} />
      {{else}}
        {{! Upload area }}
        {{#if this.hasDragDropFeature}}
          <DropZone
            @uploadText={{this.dropZoneLabel}}
            @uploadHint={{this.uploadHint}}
            @onFilesDropped={{this.handleFilesDropped}}
            @multiple={{false}}
            @height='120px'
            @testId='drop-zone'
            @allowedFormats={{this.config.validation.allowedFormats}}
          />
        {{else}}
          <ImageUploader
            @uploadText={{this.uploadText}}
            @uploadHint={{this.uploadHint}}
            @onFileSelect={{this.handleFileSelect}}
            @height='120px'
            @testId='upload-area'
            @allowedFormats={{this.config.validation.allowedFormats}}
          />
        {{/if}}

        <ErrorMessage @message={{this.errorMessage}} />
      {{/if}}
    </div>

    <style scoped>
      .single-upload-container {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 4);
      }

      .preview-section {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }
    </style>
  </template>
}

export default class SingleUploadField extends FieldDef {
  static displayName = 'Single Upload Image Field';
  static icon = PhotoIcon;

  @field uploadUrl = contains(StringField);
  @field uploadedImageUrl = contains(StringField);

  static configuration: Configuration = {
    presentation: {
      type: 'single',
      placeholder: 'Click to upload or drag & drop',
      features: ['drag-drop', 'progress'],
      validation: {
        maxFileSize: 10 * 1024 * 1024, // 10MB
        allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
      },
      uploadOptions: {
        dragDrop: {
          dropzoneLabel: 'Drop image here or click to upload',
        },
      },
    },
  };

  static edit = Edit;
}
