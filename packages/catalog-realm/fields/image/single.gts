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
import ErrorMessage from './components/error-message';
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './util/cloudflare-upload';
import { buildUploadHint, mergeSingleUploadConfig } from './util/index';

interface Configuration {
  presentation: SingleUploadConfig;
}

class Edit extends Component<typeof SingleUploadField> {
  @tracked imageName: string = '';
  @tracked imageSize: number | undefined;
  @tracked previewUrl: string | undefined;
  @tracked errorMessage = '';
  @tracked selectedFile: File | null = null;

  constructor(owner: any, args: any) {
    super(owner, args);
    if (args.model?.uploadedImageUrl) {
      this.imageName = 'Uploaded Image';
      this.previewUrl = args.model.uploadedImageUrl;
    }
  }

  get config(): SingleUploadConfig {
    return mergeSingleUploadConfig(
      this.args.configuration?.presentation as SingleUploadConfig,
    );
  }

  get uploadText(): string {
    return this.config.placeholder || 'Click to upload';
  }

  get uploadHint(): string {
    return (
      buildUploadHint(
        this.config.allowedFormats,
        this.config.maxSize,
        'PNG, JPG, GIF up to 10MB',
      ) || 'PNG, JPG, GIF up to 10MB'
    );
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

  @action
  handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.errorMessage = 'Please select a valid image file';
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

    await this.generateUploadUrlTask.perform();

    if (!this.args.model.uploadUrl) {
      return;
    }

    try {
      const imageUrl = await uploadFileToCloudflare(
        this.args.model.uploadUrl,
        this.selectedFile,
      );
      this.args.model.uploadedImageUrl = imageUrl;
      this.previewUrl = imageUrl;
      this.selectedFile = null;
      this.errorMessage = '';
    } catch (error: any) {
      this.errorMessage = `Upload failed: ${error.message}`;
      throw error;
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
        <ImageUploader
          @uploadText={{this.uploadText}}
          @uploadHint={{this.uploadHint}}
          @onFileSelect={{this.handleFileSelect}}
          @height='256px'
          @testId='upload-area'
        />
        <ErrorMessage @message={{this.errorMessage}} />
      {{/if}}
    </div>

    <style scoped>
      .single-upload-container {
        width: 100%;
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
