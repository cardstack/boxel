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
import { fn } from '@ember/helper';
import type { MultipleUploadConfig } from './util/types';
import ImagePreviewContainer from './components/image-preview-container';
import ImageUploader from './components/image-uploader';

interface ImageData {
  id: string;
  preview: string;
  name: string;
  size?: number;
}

interface Configuration {
  presentation: MultipleUploadConfig;
}

class Edit extends Component<typeof MultipleUploadField> {
  @tracked images: ImageData[] = [];

  constructor(owner: any, args: any) {
    super(owner, args);
    // Initialize from model if available
    if (args.model?.uploadedImageUrl) {
      try {
        const parsed = JSON.parse(args.model.uploadedImageUrl);
        if (Array.isArray(parsed)) {
          this.images = parsed;
        }
      } catch {
        // If not valid JSON, treat as empty
        this.images = [];
      }
    }
  }

  get config(): MultipleUploadConfig {
    const defaultConfig: MultipleUploadConfig = {
      type: 'multiple',
      maxSize: 10 * 1024 * 1024,
      maxFiles: 10,
      allowedFormats: ['jpeg', 'jpg', 'png', 'gif'],
      scrollable: true,
      showPreview: true,
      showFileName: true,
      showFileSize: true,
    };
    return {
      ...defaultConfig,
      ...(this.args.configuration?.presentation || {}),
    } as MultipleUploadConfig;
  }

  get uploadText(): string {
    return this.config.placeholder || 'Click to upload multiple';
  }

  get uploadHint(): string | undefined {
    if (this.config.allowedFormats && this.config.maxSize) {
      return `${this.config.allowedFormats
        .join(', ')
        .toUpperCase()} up to ${this.formatFileSize(this.config.maxSize)}`;
    }
    return undefined;
  }

  get hasImages() {
    return this.images.length > 0;
  }

  @action
  handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);

    if (!files.length) return;

    // Filter only image files
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));

    // Check max files limit
    const maxFiles = this.config.maxFiles || 10;
    const remainingSlots = maxFiles - this.images.length;
    const filesToProcess = imageFiles.slice(0, remainingSlots);

    // Process each file
    filesToProcess.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newImage: ImageData = {
          id: `${Date.now()}-${Math.random()}`,
          preview: reader.result as string,
          name: file.name,
          size: file.size,
        };
        this.images = [...this.images, newImage];
        this.updateModel();
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    input.value = '';
  }

  @action
  removeImage(id: string) {
    this.images = this.images.filter((img) => img.id !== id);
    this.updateModel();
  }

  updateModel() {
    // Store as JSON string in model
    this.args.model.uploadedImageUrl = JSON.stringify(this.images);
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  <template>
    <div class='multiple-upload-container' data-test-multiple-upload>
      {{! Upload area }}
      <ImageUploader
        @uploadText={{this.uploadText}}
        @uploadHint={{this.uploadHint}}
        @onFileSelect={{this.handleFileSelect}}
        @multiple={{true}}
        @height='128px'
        @iconSize='2rem'
        @marginBottom='1rem'
        @testId='upload-area'
      />

      {{! Images preview container }}
      <ImagePreviewContainer
        @images={{this.images}}
        @config={{this.config}}
        @onRemove={{this.removeImage}}
      />

      {{#unless this.hasImages}}
        <div class='empty-state' data-test-empty-state>
          No images uploaded yet
        </div>
      {{/unless}}
    </div>

    <style scoped>
      .multiple-upload-container {
        width: 100%;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 1rem;
      }

      /* Empty state */
      .empty-state {
        text-align: center;
        color: var(--boxel-400, #9ca3af);
        padding: 2rem;
        font-size: 0.875rem;
      }
    </style>
  </template>
}

export default class MultipleUploadField extends FieldDef {
  static displayName = 'Multiple Upload Image Field';
  static icon = PhotoIcon;

  @field uploadUrl = contains(StringField);
  @field uploadedImageUrl = contains(StringField);

  static configuration: Configuration = {
    presentation: {
      type: 'multiple',
      maxSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      allowedFormats: ['jpeg', 'jpg', 'png', 'gif'],
      scrollable: true,
      showPreview: true,
      showFileName: true,
      showFileSize: true,
    },
  };

  static edit = Edit;
}
