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
import ImagePreview from './components/image-preview';
import ImageUploader from './components/image-uploader';
import CloudflareUploadButton from './components/cloudflare-upload-button';
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './util/cloudflare-upload';

interface Configuration {
  presentation: SingleUploadConfig;
}

class Edit extends Component<typeof SingleUploadField> {
  @tracked imageName: string = '';
  @tracked imageSize: number | undefined;
  @tracked previewUrl: string | undefined;
  @tracked uploadStatus = '';
  @tracked selectedFile: File | null = null;

  constructor(owner: any, args: any) {
    super(owner, args);
    if (args.model?.uploadedImageUrl) {
      this.imageName = 'Uploaded Image';
      this.previewUrl = args.model.uploadedImageUrl;
    }
  }

  get config(): SingleUploadConfig {
    const defaultConfig: SingleUploadConfig = {
      type: 'single',
      maxSize: 10 * 1024 * 1024,
      allowedFormats: ['jpeg', 'jpg', 'png', 'gif'],
      showPreview: true,
      showFileName: true,
      placeholder: 'Click to upload',
    };
    return {
      ...defaultConfig,
      ...(this.args.configuration?.presentation || {}),
    } as SingleUploadConfig;
  }

  get uploadText(): string {
    return this.config.placeholder || 'Click to upload';
  }

  get uploadHint(): string {
    if (this.config.allowedFormats && this.config.maxSize) {
      return `${this.config.allowedFormats
        .join(', ')
        .toUpperCase()} up to ${this.formatFileSize(this.config.maxSize)}`;
    }
    return 'PNG, JPG, GIF up to 10MB';
  }

  get hasImage() {
    return !!(this.previewUrl || this.args.model?.uploadedImageUrl);
  }

  get displayImage() {
    return this.previewUrl || this.args.model?.uploadedImageUrl;
  }

  get hasPendingUpload() {
    return !!(this.previewUrl && this.selectedFile);
  }

  get isUploadDisabled() {
    return (
      this.uploadImageTask.isRunning || this.generateUploadUrlTask.isRunning
    );
  }

  @action
  handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.uploadStatus = 'Please select a valid image file';
      this.selectedFile = null;
      return;
    }

    this.selectedFile = file;
    // Read and preview file
    const reader = new FileReader();
    reader.onloadend = () => {
      this.imageName = file.name;
      this.imageSize = file.size;
      this.previewUrl = reader.result as string;
      this.uploadStatus = 'Ready to upload to Cloudflare';
    };
    reader.readAsDataURL(file);
  }

  @action
  removeImage() {
    const hadPendingUpload = this.hasPendingUpload;

    this.imageName = '';
    this.imageSize = undefined;
    this.previewUrl = undefined;
    this.selectedFile = null;
    this.uploadStatus = '';

    if (this.args.model.uploadUrl) {
      this.args.model.uploadUrl = undefined;
    }

    if (hadPendingUpload) {
      this.imageName = this.args.model?.uploadedImageUrl
        ? 'Uploaded Image'
        : '';
    } else {
      this.args.model.uploadedImageUrl = undefined;
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  generateUploadUrlTask = restartableTask(async () => {
    this.uploadStatus = 'Generating upload URL...';

    try {
      this.args.model.uploadUrl = await requestCloudflareUploadUrl(
        this.args.context?.commandContext,
        {
          source: 'boxel-single-image-field',
        },
      );
      this.uploadStatus = 'Ready to upload!';
    } catch (error: any) {
      console.error('Upload URL generation error:', error);
      this.uploadStatus = `Failed to generate upload URL: ${error.message}`;
    }
  });

  uploadImageTask = restartableTask(async () => {
    if (!this.selectedFile) {
      this.uploadStatus = 'Please select a file first';
      return;
    }

    await this.generateUploadUrlTask.perform();

    if (!this.args.model.uploadUrl) {
      return;
    }

    this.uploadStatus = 'Uploading to Cloudflare...';

    try {
      const imageUrl = await uploadFileToCloudflare(
        this.args.model.uploadUrl,
        this.selectedFile,
      );
      this.args.model.uploadedImageUrl = imageUrl;
      this.previewUrl = imageUrl;
      this.uploadStatus = 'Upload successful!';
      this.selectedFile = null;
    } catch (error: any) {
      console.error('Upload error:', error);
      this.uploadStatus = `Upload failed: ${error.message}`;
    }
  });

  <template>
    <div class='single-upload-container' data-test-single-upload>
      {{#if this.hasImage}}
        {{! Preview with image }}
        <ImagePreview
          @src={{this.displayImage}}
          @alt={{this.imageName}}
          @height='256px'
          @showPreview={{this.config.showPreview}}
          @showFileName={{this.config.showFileName}}
          @fileName={{this.imageName}}
          @showFileSize={{this.config.showFileSize}}
          @fileSize={{this.imageSize}}
          @onRemove={{this.removeImage}}
        />
        {{#if this.hasPendingUpload}}
          <CloudflareUploadButton
            @onUpload={{this.uploadImageTask.perform}}
            @disabled={{this.isUploadDisabled}}
            @isUploading={{this.uploadImageTask.isRunning}}
            @uploadStatus={{this.uploadStatus}}
          />
        {{else}}
          {{#if this.uploadStatus}}
            <div class='status-message'>{{this.uploadStatus}}</div>
          {{/if}}
        {{/if}}
      {{else}}
        {{! Upload area }}
        <ImageUploader
          @uploadText={{this.uploadText}}
          @uploadHint={{this.uploadHint}}
          @onFileSelect={{this.handleFileSelect}}
          @height='256px'
          @testId='upload-area'
        />
        {{#if this.uploadStatus}}
          <div class='status-message'>{{this.uploadStatus}}</div>
        {{/if}}
      {{/if}}
    </div>

    <style scoped>
      .single-upload-container {
        width: 100%;
      }

      .status-message {
        padding: 0.5rem 0.75rem;
        border-radius: 0.375rem;
        background: #f3f4f6;
        border-left: 3px solid var(--boxel-primary-500, #3b82f6);
        font-size: 0.8125rem;
        white-space: pre-wrap;
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
      maxSize: 10 * 1024 * 1024, // 10MB
      allowedFormats: ['jpeg', 'jpg', 'png', 'gif'],
      showPreview: true,
      showFileName: true,
      showFileSize: true,
      placeholder: 'Click to upload',
    },
  };

  static edit = Edit;
}
