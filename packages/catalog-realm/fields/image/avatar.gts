import {
  Component,
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import { on } from '@ember/modifier';
import ImagePreview from './components/image-preview';
import CloudflareUploadButton from './components/cloudflare-upload-button';
import ErrorMessage from './components/error-message';
import UserIcon from '@cardstack/boxel-icons/user';
import UploadIcon from '@cardstack/boxel-icons/upload';
import CameraIcon from '@cardstack/boxel-icons/camera';
import type { AvatarUploadConfig } from './util/types';
import {
  uploadFileToCloudflare,
  requestCloudflareUploadUrl,
} from './util/cloudflare-upload';

interface Configuration {
  presentation: AvatarUploadConfig;
}

function mergeAvatarUploadConfig(
  userConfig?: Partial<AvatarUploadConfig>,
): AvatarUploadConfig {
  const defaults: AvatarUploadConfig = {
    type: 'avatar',
    maxSize: 5 * 1024 * 1024, // 5MB for avatars
    allowedFormats: ['jpeg', 'jpg', 'png', 'gif', 'webp'],
    circular: true,
    size: 128, // Default avatar size
    showPreview: true,
  };

  return {
    ...defaults,
    ...userConfig,
  };
}

class Edit extends Component<typeof AvatarField> {
  @tracked previewUrl: string | undefined;
  @tracked errorMessage = '';
  @tracked selectedFile: File | null = null;

  constructor(owner: any, args: any) {
    super(owner, args);
    if (args.model?.uploadedImageUrl) {
      this.previewUrl = args.model.uploadedImageUrl;
    }
  }

  get config(): AvatarUploadConfig {
    return mergeAvatarUploadConfig(
      this.args.configuration?.presentation as AvatarUploadConfig,
    );
  }

  get avatarSize(): string {
    return `${this.config.size || 128}px`;
  }

  get avatarHeight(): string {
    return `${this.config.size}px`;
  }

  get avatarStyle() {
    return {
      width: this.avatarSize,
      height: this.avatarSize,
      borderRadius: this.config.circular ? '50%' : 'var(--radius, 0.5rem)',
    };
  }

  get uploadHint(): string {
    const formats =
      this.config.allowedFormats
        ?.map((format) => format.replace('image/', '').toUpperCase())
        .join(', ') || 'PNG, JPG, GIF';
    const maxSizeMB = (
      (this.config.maxSize || 5 * 1024 * 1024) /
      (1024 * 1024)
    ).toFixed(0);
    return `${formats} up to ${maxSizeMB}MB`;
  }

  get hasAvatar() {
    return !!(this.previewUrl || this.args.model?.uploadedImageUrl);
  }

  get displayImage() {
    return this.previewUrl || this.args.model?.uploadedImageUrl;
  }

  get hasPendingUpload() {
    return !!(this.previewUrl && this.selectedFile);
  }

  get showUploadButton(): boolean {
    return this.hasAvatar;
  }

  get uploadButtonDisabled(): boolean {
    return this.uploadImageTask.isRunning || this.hasPendingUpload;
  }

  get uploadButtonLabel() {
    if (this.uploadImageTask.isRunning) {
      return 'Uploading...';
    }
    if (this.hasPendingUpload) {
      return 'Upload Avatar';
    }
    if (this.args.model?.uploadedImageUrl) {
      return 'Uploaded successfully';
    }
    return 'Upload Avatar';
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

    // Validate file size
    const maxSize = this.config.maxSize || 5 * 1024 * 1024;
    if (file.size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
      this.errorMessage = `File size must be less than ${maxSizeMB}MB`;
      this.selectedFile = null;
      return;
    }

    this.selectedFile = file;
    this.errorMessage = '';

    // Read and preview file
    const reader = new FileReader();
    reader.onloadend = () => {
      this.previewUrl = reader.result as string;
    };
    reader.readAsDataURL(file);

    // Reset input
    input.value = '';
  }

  @action
  removeAvatar() {
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
          source: 'boxel-avatar-field',
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
    <div class='avatar-upload-container' data-test-avatar-upload>
      <div class='avatar-wrapper'>
        <label class='avatar-upload-area' data-test-avatar-upload-area>
          {{#if this.hasAvatar}}
            <img src={{this.displayImage}} alt='Avatar' class='avatar-image' />
          {{else}}
            <div class='avatar-placeholder'>
              <UserIcon class='placeholder-icon' />
            </div>
          {{/if}}

          <div class='avatar-overlay'>
            <UploadIcon class='overlay-icon' />
            <span class='overlay-text'>{{#if
                this.hasAvatar
              }}Change{{else}}Upload{{/if}}</span>
          </div>

          <input
            type='file'
            class='file-input'
            accept='image/*'
            {{on 'change' this.handleFileSelect}}
            data-test-avatar-file-input
          />
        </label>

        <label class='camera-button' data-test-camera-button>
          <CameraIcon class='camera-icon' />
          <input
            type='file'
            class='file-input'
            accept='image/*'
            {{on 'change' this.handleFileSelect}}
            data-test-avatar-camera-input
          />
        </label>
      </div>

      {{#if this.hasPendingUpload}}
        <CloudflareUploadButton
          @showButton={{true}}
          @onUpload={{this.uploadImageTask.perform}}
          @disabled={{false}}
          @isUploading={{this.uploadImageTask.isRunning}}
          @label='Upload Avatar'
        />
      {{/if}}

      {{#if this.errorMessage}}
        <ErrorMessage @message={{this.errorMessage}} />
      {{/if}}
    </div>
    <style scoped>
      .avatar-upload-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 3);
        width: 100%;
      }

      /* Avatar wrapper with camera button */
      .avatar-wrapper {
        position: relative;
        width: 200px;
        height: 200px;
      }

      /* Avatar upload area */
      .avatar-upload-area {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        overflow: hidden;
        cursor: pointer;
        background-color: var(--muted, #f1f5f9);
        border: 2px dashed var(--border, #cbd5e1);
        transition: all 0.2s ease;
        display: block;
      }

      .avatar-upload-area:hover {
        border-color: var(--ring, #3b82f6);
        border-style: dashed;
        border-width: 3px;
        background-color: color-mix(
          in srgb,
          var(--accent, #f0f9ff) 70%,
          var(--muted, #f1f5f9)
        );
        transform: scale(1.02);
      }

      .avatar-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
      }

      .avatar-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--accent, #f0f9ff);
      }

      .placeholder-icon {
        width: 4rem;
        height: 4rem;
        color: var(--accent-foreground, #0c4a6e);
        opacity: 0.6;
      }

      .avatar-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: color-mix(
          in srgb,
          var(--foreground, #000) 60%,
          transparent
        );
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: all 0.3s ease;
        border-radius: 50%;
        backdrop-filter: blur(2px);
      }

      .avatar-upload-area:hover .avatar-overlay {
        opacity: 1;
        background: color-mix(
          in srgb,
          var(--foreground, #000) 50%,
          transparent
        );
      }

      .overlay-icon {
        width: 2rem;
        height: 2rem;
        color: var(--background, #fff);
        margin-bottom: calc(var(--spacing, 0.25rem) * 2);
      }

      .overlay-text {
        color: var(--background, #fff);
        font-size: 0.875rem;
        font-weight: 500;
        font-family: var(--font-sans, system-ui, sans-serif);
      }

      /* Camera button (Facebook style) */
      .camera-button {
        position: absolute;
        bottom: 8px;
        right: 8px;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background-color: var(--background, #ffffff);
        border: 2px solid var(--border, #e2e8f0);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
      }

      .camera-button:hover {
        background-color: var(--primary, #3b82f6);
        border-color: var(--primary, #3b82f6);
        transform: scale(1.1);
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      }

      .camera-button:hover .camera-icon {
        color: var(--primary-foreground, #ffffff);
      }

      .camera-button:active {
        transform: scale(0.95);
      }

      .camera-icon {
        width: 18px;
        height: 18px;
        color: var(--foreground, #1a1a1a);
        transition: color 0.2s ease;
      }

      .file-input {
        display: none;
      }

      /* Avatar info section */
      .avatar-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 3);
        width: 100%;
        max-width: 300px;
      }

      .upload-hint {
        margin: 0;
        font-size: 0.875rem;
        color: var(--muted-foreground, #64748b);
        text-align: center;
        font-family: var(--font-sans, system-ui, sans-serif);
      }

      .upload-button {
        display: inline-flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        padding: calc(var(--spacing, 0.25rem) * 2.5)
          calc(var(--spacing, 0.25rem) * 5);
        background-color: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border: none;
        border-radius: var(--radius, 0.375rem);
        font-size: 0.875rem;
        font-weight: 600;
        font-family: var(--font-sans, system-ui, sans-serif);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .upload-button:hover:not(:disabled) {
        background-color: var(--accent, #60a5fa);
        color: var(--accent-foreground, #1e293b);
        box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
      }

      .upload-button:disabled {
        background-color: var(--muted, #f1f5f9);
        color: var(--muted-foreground, #94a3b8);
        opacity: 0.6;
        cursor: not-allowed;
      }

      .button-icon {
        width: 1rem;
        height: 1rem;
      }
    </style>
  </template>
}

export default class AvatarField extends FieldDef {
  static displayName = 'Avatar Upload Field';
  static icon = UserIcon;

  @field uploadUrl = contains(StringField);
  @field uploadedImageUrl = contains(StringField);

  static configuration: Configuration = {
    presentation: {
      type: 'avatar',
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedFormats: ['jpeg', 'jpg', 'png', 'gif', 'webp'],
      size: 200, // Larger avatar size
      placeholder: 'Upload Avatar',
    },
  };

  static edit = Edit;
}
