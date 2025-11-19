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
import type { SingleUploadConfig } from './util/types';
import ImagePreview from './components/image-preview';
import ImageUploader from './components/image-uploader';

interface Configuration {
  presentation: SingleUploadConfig;
}

class Edit extends Component<typeof SingleUploadField> {
  @tracked imageName: string = '';
  @tracked imageSize: number | undefined;

  constructor(owner: any, args: any) {
    super(owner, args);
    if (args.model?.uploadedImageUrl) {
      this.imageName = 'Uploaded Image';
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
    return !!this.args.model?.uploadedImageUrl;
  }

  @action
  handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return;
    }

    // Read and preview file
    const reader = new FileReader();
    reader.onloadend = () => {
      this.imageName = file.name;
      this.imageSize = file.size;
      // Store the data URL directly in the model
      this.args.model.uploadedImageUrl = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  @action
  removeImage() {
    this.imageName = '';
    this.imageSize = undefined;
    this.args.model.uploadedImageUrl = undefined;
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  <template>
    <div class='single-upload-container' data-test-single-upload>
      {{#if this.hasImage}}
        {{! Preview with image }}
        <ImagePreview
          @src={{@model.uploadedImageUrl}}
          @alt={{this.imageName}}
          @height='256px'
          @showPreview={{this.config.showPreview}}
          @showFileName={{this.config.showFileName}}
          @fileName={{this.imageName}}
          @showFileSize={{this.config.showFileSize}}
          @fileSize={{this.imageSize}}
          @onRemove={{this.removeImage}}
        />
      {{else}}
        {{! Upload area }}
        <ImageUploader
          @uploadText={{this.uploadText}}
          @uploadHint={{this.uploadHint}}
          @onFileSelect={{this.handleFileSelect}}
          @height='256px'
          @testId='upload-area'
        />
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
