import { eq } from '@cardstack/boxel-ui/helpers';
import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import CameraIcon from '@cardstack/boxel-icons/camera';
import ImageBrowsePreview from './image/components/image-browse-preview';
import ImageAvatarPreview from './image/components/image-avatar-preview';
import ImageDropzonePreview from './image/components/image-dropzone-preview';
import ImageBrowseUpload from './image/components/image-browse-upload';
import ImageAvatarUpload from './image/components/image-avatar-upload';
import ImageDropzoneUpload from './image/components/image-dropzone-upload';
import PreviewModal from './image/components/preview-modal';
import { Button } from '@cardstack/boxel-ui/components';
import NotificationBubble from '../components/notification-bubble';
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './image/util/cloudflare-upload';

import ImagePresentation from './image/components/image-presentation';
import InlinePresentation from './image/components/inline-presentation';
import CardPresentation from './image/components/card-presentation';

// Type definitions
type ImageInputVariant = 'browse' | 'dropzone' | 'avatar';
type ImagePresentationType = 'image' | 'inline' | 'card';
type UploadStatus = 'idle' | 'pending' | 'success' | 'error';

// TypeScript configuration interface
export type ImageFieldConfiguration =
  | {
      variant: 'browse' | 'dropzone';
      presentation?: ImagePresentationType;
      options?: {
        showImageModal?: boolean;
        autoUpload?: boolean;
        showProgress?: boolean; // Show progress during file reading
      };
    }
  | {
      variant: 'avatar';
      presentation?: ImagePresentationType;
      options?: {
        autoUpload?: boolean;
        showProgress?: boolean; // Show progress during file reading
        // No showImageModal allowed here
      };
    };

class ImageFieldEdit extends Component<typeof ImageField> {
  @tracked preview: string | null = null; // Temporary local preview
  @tracked selectedFile: File | null = null; // File ready for upload
  @tracked showPreview = false;
  @tracked uploadStatus: UploadStatus = 'idle'; // Upload status for notification
  @tracked uploadStatusMessage = ''; // Upload status message
  @tracked readProgress = 0; // File reading progress (0-100)
  @tracked isReading = false; // Currently reading file

  constructor(owner: any, args: any) {
    super(owner, args);
    // Initialize preview from uploaded URL
    if (args.model?.uploadedImageUrl) {
      this.preview = args.model.uploadedImageUrl;
    }
  }

  get hasImage() {
    return this.preview || this.args.model?.uploadedImageUrl;
  }

  get displayPreview() {
    return this.preview || this.args.model?.uploadedImageUrl || '';
  }

  get variant(): ImageInputVariant {
    return (
      (this.args.configuration as ImageFieldConfiguration)?.variant || 'browse'
    );
  }

  get presentation(): ImagePresentationType {
    const config = this.args.configuration as ImageFieldConfiguration;
    return (config?.presentation as ImagePresentationType) || 'image';
  }

  get options() {
    return (this.args.configuration as ImageFieldConfiguration)?.options || {};
  }

  get autoUpload() {
    return this.options.autoUpload === true;
  }

  get showImageModal() {
    if (this.variant === 'avatar') {
      return false;
    }
    return (
      (this.options as { showImageModal?: boolean }).showImageModal !== false
    );
  }

  get showProgress() {
    return this.options.showProgress === true;
  }

  get hasPendingUpload() {
    return !!this.selectedFile;
  }

  get showUploadButton() {
    return this.hasPendingUpload && !this.autoUpload;
  }

  get uploadButtonLabel() {
    if (this.uploadImageTask.isRunning) {
      return 'Uploading...';
    }
    return 'Upload to Cloudflare';
  }

  get showNotification() {
    return !!(this.uploadStatusMessage && this.uploadStatus !== 'idle');
  }

  @action
  async handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || !file.type.startsWith('image/')) return;

    // Store file and reset states
    this.selectedFile = file;
    this.uploadStatus = 'idle';
    this.uploadStatusMessage = '';
    this.readProgress = 0;
    this.isReading = true;

    const reader = new FileReader();

    // Simulate reading progress if showProgress is enabled
    let progressInterval: number | undefined;
    if (this.showProgress) {
      progressInterval = window.setInterval(() => {
        if (this.readProgress < 90) {
          this.readProgress += 5;
        }
      }, 200);
    }

    reader.onload = async (e) => {
      // ✅ Add 'async' here
      if (progressInterval) {
        clearInterval(progressInterval);

        // Smoothly animate remaining progress to 100%
        while (this.readProgress < 100) {
          this.readProgress = Math.min(100, this.readProgress + 5);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      const result = e.target?.result as string;
      // Set preview for local display (temporary, not stored in model)
      this.preview = result;
      this.isReading = false;

      // Auto-upload if enabled
      if (this.autoUpload) {
        this.uploadImageTask.perform();
      }
    };

    reader.onerror = () => {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      this.isReading = false;
      this.uploadStatus = 'error';
      this.uploadStatusMessage = 'Failed to read file';
    };

    reader.readAsDataURL(file);

    // Reset input
    input.value = '';
  }

  @action
  removeImage() {
    // Clear all image data
    this.preview = null;
    this.selectedFile = null;
    this.uploadStatus = 'idle';
    this.uploadStatusMessage = '';
    this.args.model.uploadUrl = undefined;
    this.args.model.uploadedImageUrl = undefined;
  }

  @action
  handleDragOver(event: DragEvent) {
    event.preventDefault();
  }

  @action
  handleDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];

    if (file && file.type.startsWith('image/')) {
      const fakeEvent = {
        target: {
          files: [file],
        },
      } as any as Event;
      this.handleFileSelect(fakeEvent);
    }
  }

  @action
  togglePreview() {
    this.showPreview = !this.showPreview;
  }

  // Cloudflare upload task
  uploadImageTask = restartableTask(async () => {
    if (!this.selectedFile) {
      this.uploadStatus = 'error';
      this.uploadStatusMessage = 'Please select a file first';
      return;
    }

    try {
      // Set pending status
      this.uploadStatus = 'pending';
      this.uploadStatusMessage = 'Uploading image...';

      // Step 1: Get upload URL from Cloudflare
      this.args.model.uploadUrl = await requestCloudflareUploadUrl(
        this.args.context?.commandContext,
        {
          source: 'boxel-image-field',
        },
      );

      if (!this.args.model.uploadUrl) {
        this.uploadStatus = 'error';
        this.uploadStatusMessage = 'Failed to get upload URL';
        return;
      }

      // Step 2: Upload file to Cloudflare
      const imageUrl = await uploadFileToCloudflare(
        this.args.model.uploadUrl,
        this.selectedFile,
      );

      // Update model with permanent CDN URL
      this.args.model.uploadedImageUrl = imageUrl;
      this.preview = imageUrl;
      this.selectedFile = null;
      this.uploadStatus = 'success';
      this.uploadStatusMessage = 'Image uploaded successfully!';

      // Clear success message after 3 seconds
      setTimeout(() => {
        if (this.uploadStatus === 'success') {
          this.uploadStatus = 'idle';
          this.uploadStatusMessage = '';
        }
      }, 3000);
    } catch (error: any) {
      // Display Cloudflare error messages
      this.uploadStatus = 'error';
      this.uploadStatusMessage = `Upload failed: ${error.message}`;
      throw error;
    }
  });

  <template>
    <div class='image-field-edit' data-test-image-field-edit>
      {{#if this.hasImage}}
        {{! Image preview display }}
        {{#if (eq this.variant 'avatar')}}
          <ImageAvatarPreview
            @imageData={{this.displayPreview}}
            @onRemove={{this.removeImage}}
            @onFileSelect={{this.handleFileSelect}}
            @hasPendingUpload={{this.hasPendingUpload}}
          />
        {{else if (eq this.variant 'dropzone')}}
          <ImageDropzonePreview
            @imageData={{this.displayPreview}}
            @onRemove={{this.removeImage}}
            @onZoom={{this.togglePreview}}
            @onFileSelect={{this.handleFileSelect}}
            @showZoomButton={{this.showImageModal}}
            @isReading={{this.isReading}}
            @readProgress={{this.readProgress}}
          />
        {{else}}
          <ImageBrowsePreview
            @imageData={{this.displayPreview}}
            @onRemove={{this.removeImage}}
            @onZoom={{this.togglePreview}}
            @onFileSelect={{this.handleFileSelect}}
            @showZoomButton={{this.showImageModal}}
            @isReading={{this.isReading}}
            @readProgress={{this.readProgress}}
          />
        {{/if}}

        {{! Upload button (only shown when file selected but not uploaded) }}
        {{#if this.showUploadButton}}
          <Button
            class='upload-button'
            @kind='primary-dark'
            @size='tall'
            @disabled={{this.uploadImageTask.isRunning}}
            {{on 'click' this.uploadImageTask.perform}}
            data-test-upload-to-cloudflare
          >
            {{this.uploadButtonLabel}}
          </Button>
        {{/if}}

        {{! Upload status notification }}
        {{#if this.showNotification}}
          <NotificationBubble
            @type={{this.uploadStatus}}
            @message={{this.uploadStatusMessage}}
          />
        {{/if}}

      {{else}}
        {{! Upload trigger components }}
        {{#if (eq this.variant 'avatar')}}
          <ImageAvatarUpload @onFileSelect={{this.handleFileSelect}} />
        {{else if (eq this.variant 'dropzone')}}
          <ImageDropzoneUpload
            @onFileSelect={{this.handleFileSelect}}
            @onDragOver={{this.handleDragOver}}
            @onDrop={{this.handleDrop}}
          />
        {{else}}
          <ImageBrowseUpload @onFileSelect={{this.handleFileSelect}} />
        {{/if}}
      {{/if}}

      {{#if this.showPreview}}
        {{! Full-screen preview modal }}
        <PreviewModal
          @imageData={{this.displayPreview}}
          @onClose={{this.togglePreview}}
        />
      {{/if}}
    </div>

    <style scoped>
      .image-field-edit {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .upload-button {
        width: 100%;
        justify-content: center;
      }

      .error-message {
        padding: 0.75rem;
        background: var(--destructive, #fee2e2);
        color: var(--destructive-foreground, #991b1b);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.875rem;
      }
    </style>
  </template>
}

class ImageFieldEmbedded extends Component<typeof ImageField> {
  // Embedded format with presentation modes
  get hasImage() {
    return !!this.args.model?.uploadedImageUrl;
  }

  get presentation(): ImagePresentationType {
    return (
      (this.args.configuration as ImageFieldConfiguration)?.presentation ||
      'image'
    );
  }

  <template>
    {{#if (eq this.presentation 'inline')}}
      <InlinePresentation
        @imageUrl={{@model.uploadedImageUrl}}
        @hasImage={{this.hasImage}}
      />
    {{else if (eq this.presentation 'card')}}
      <CardPresentation
        @imageUrl={{@model.uploadedImageUrl}}
        @hasImage={{this.hasImage}}
      />
    {{else}}
      <ImagePresentation
        @imageUrl={{@model.uploadedImageUrl}}
        @hasImage={{this.hasImage}}
      />
    {{/if}}
  </template>
}

class ImageFieldAtom extends Component<typeof ImageField> {
  get hasImage() {
    return !!this.args.model?.uploadedImageUrl;
  }

  <template>
    <span class='image-atom'>
      {{#if this.hasImage}}
        <img src={{@model.uploadedImageUrl}} alt='' class='atom-thumbnail' />
        <span class='atom-name'>Image</span>
      {{else}}
        <CameraIcon class='atom-icon' />
        <span>No image</span>
      {{/if}}
    </span>

    <style scoped>
      .image-atom {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.5rem;
        background: var(--muted, #f1f5f9);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.8125rem;
        max-width: 12rem;
      }

      .atom-thumbnail {
        width: 1.5rem;
        height: 1.5rem;
        object-fit: cover;
        border-radius: calc(var(--radius, 0.375rem) * 0.5);
        flex-shrink: 0;
      }

      .atom-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--foreground, #1a1a1a);
      }

      .atom-icon {
        width: 1rem;
        height: 1rem;
        color: var(--muted-foreground, #9ca3af);
        flex-shrink: 0;
      }
    </style>
  </template>
}

export class ImageField extends FieldDef {
  static displayName = 'Image';
  static icon = CameraIcon;

  // Cloudflare upload fields (replaces imageData)
  @field uploadUrl = contains(StringField); // Temporary upload URL from Cloudflare
  @field uploadedImageUrl = contains(StringField); // Permanent CDN URL

  static embedded = ImageFieldEmbedded;
  static atom = ImageFieldAtom;
  static edit = ImageFieldEdit;
}

export default ImageField;
