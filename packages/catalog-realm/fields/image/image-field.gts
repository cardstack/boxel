// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { eq } from '@cardstack/boxel-ui/helpers'; // ¹ Helper imports
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
import { restartableTask } from 'ember-concurrency'; // ¹⁴ Async task management
import CameraIcon from '@cardstack/boxel-icons/camera';
import BrowsePreview from './components/browse-preview'; // ² Preview component imports
import AvatarPreview from './components/avatar-preview';
import DropzonePreview from './components/dropzone-preview';
import BrowseUpload from './components/browse-upload'; // ⁹ Upload trigger components
import AvatarUpload from './components/avatar-upload';
import DropzoneUpload from './components/dropzone-upload';
import PreviewModal from './components/preview-modal'; // ¹¹ Preview modal component
import { Button } from '@cardstack/boxel-ui/components'; // ¹⁵ Upload button
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './util/cloudflare-upload'; // ¹⁶ Cloudflare upload utilities

// ¹³ TypeScript configuration interface
export type ImageFieldConfiguration =
  | {
      variant: 'browse' | 'dropzone';
      presentation?: 'default' | 'compact' | 'featured';
      options?: {
        showImageModal?: boolean;
        autoUpload?: boolean;
      };
    }
  | {
      variant: 'avatar';
      presentation?: 'default' | 'compact' | 'featured';
      options?: {
        autoUpload?: boolean;
        // No showImageModal allowed here
      };
    };

class ImageFieldEdit extends Component<typeof ImageField> {
  @tracked preview: string | null = null; // ¹⁸ Temporary local preview
  @tracked selectedFile: File | null = null; // ¹⁹ File ready for upload
  @tracked errorMessage = ''; // ²⁰ Upload error messages
  @tracked showPreview = false;

  constructor(owner: any, args: any) {
    super(owner, args);
    // ²¹ Initialize preview from uploaded URL
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

  get variant() {
    return (this.args.configuration as any)?.variant || 'browse';
  }

  get presentation() {
    return (this.args.configuration as any)?.presentation || 'default';
  }

  get options() {
    return (
      (this.args.configuration as ImageFieldConfiguration['options'])
        ?.options || {}
    );
  }

  get autoUpload() {
    return this.options.autoUpload === true;
  }

  get showImageModal() {
    return this.options.showImageModal !== false;
  }

  get hasPendingUpload() {
    return !!(
      this.preview &&
      this.selectedFile &&
      !this.args.model?.uploadedImageUrl
    );
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

  @action
  async handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || !file.type.startsWith('image/')) return;

    // ²² Store file and create local preview
    this.selectedFile = file;
    this.errorMessage = '';

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      // ²³ Set preview for local display
      this.preview = result;

      // ²⁴ Auto-upload if enabled
      if (this.autoUpload) {
        this.uploadImageTask.perform();
      }
    };

    reader.readAsDataURL(file);

    // Reset input
    input.value = '';
  }

  @action
  removeImage() {
    // ²⁵ Clear all image data
    this.preview = null;
    this.selectedFile = null;
    this.errorMessage = '';
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
      } as any;
      this.handleFileSelect(fakeEvent);
    }
  }

  @action
  togglePreview() {
    this.showPreview = !this.showPreview;
  }

  // ²⁶ Cloudflare upload task
  uploadImageTask = restartableTask(async () => {
    if (!this.selectedFile) {
      this.errorMessage = 'Please select a file first';
      return;
    }

    try {
      // ²⁷ Step 1: Get upload URL from Cloudflare
      this.args.model.uploadUrl = await requestCloudflareUploadUrl(
        this.args.context?.commandContext,
        {
          source: 'boxel-image-field',
        },
      );

      if (!this.args.model.uploadUrl) {
        this.errorMessage = 'Failed to get upload URL';
        return;
      }

      // ²⁸ Step 2: Upload file to Cloudflare
      const imageUrl = await uploadFileToCloudflare(
        this.args.model.uploadUrl,
        this.selectedFile,
      );

      // ²⁹ Update model with permanent CDN URL
      this.args.model.uploadedImageUrl = imageUrl;
      this.preview = imageUrl;
      this.selectedFile = null;
      this.errorMessage = '';
    } catch (error: any) {
      // ³⁰ Display Cloudflare error messages
      this.errorMessage = `Upload failed: ${error.message}`;
      throw error;
    }
  });

  <template>
    <div class='image-field-edit' data-test-image-field-edit>
      {{#if this.hasImage}}
        {{! ³ Image preview display }}
        {{#if (eq this.variant 'avatar')}}
          <AvatarPreview
            @imageData={{this.displayPreview}}
            @onRemove={{this.removeImage}}
          />
        {{else if (eq this.variant 'dropzone')}}
          <DropzonePreview
            @imageData={{this.displayPreview}}
            @onRemove={{this.removeImage}}
            @onZoom={{this.togglePreview}}
            @showZoomButton={{this.showImageModal}}
          />
        {{else}}
          <BrowsePreview
            @imageData={{this.displayPreview}}
            @onRemove={{this.removeImage}}
            @onZoom={{this.togglePreview}}
            @showZoomButton={{this.showImageModal}}
          />
        {{/if}}

        {{! ³¹ Upload button (only shown when file selected but not uploaded) }}
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

        {{! ³² Error message display }}
        {{#if this.errorMessage}}
          <div class='error-message' data-test-error-message>
            {{this.errorMessage}}
          </div>
        {{/if}}
      {{else}}
        {{! ¹⁰ Upload trigger components }}
        {{#if (eq this.variant 'avatar')}}
          <AvatarUpload @onFileSelect={{this.handleFileSelect}} />
        {{else if (eq this.variant 'dropzone')}}
          <DropzoneUpload
            @onFileSelect={{this.handleFileSelect}}
            @onDragOver={{this.handleDragOver}}
            @onDrop={{this.handleDrop}}
          />
        {{else}}
          <BrowseUpload @onFileSelect={{this.handleFileSelect}} />
        {{/if}}
      {{/if}}

      {{#if this.showPreview}}
        {{! ¹² Full-screen preview modal }}
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

export class ImageField extends FieldDef {
  static displayName = 'Image';
  static icon = CameraIcon;

  // ³³ Cloudflare upload fields (replaces imageData)
  @field uploadUrl = contains(StringField); // Temporary upload URL from Cloudflare
  @field uploadedImageUrl = contains(StringField); // Permanent CDN URL

  static embedded = class Embedded extends Component<typeof this> {
    get hasImage() {
      return !!this.args.model?.uploadedImageUrl;
    }

    get presentation() {
      return (this.args.configuration as any)?.presentation || 'default';
    }

    <template>
      <div class='image-embedded presentation-{{this.presentation}}'>
        {{#if this.hasImage}}
          <img
            src={{@model.uploadedImageUrl}}
            alt='Image'
            class='embedded-image'
          />
        {{else}}
          <div class='no-image'>
            <CameraIcon class='camera-icon' />
            <span>No image</span>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .image-embedded {
          width: 100%;
          height: 100%;
          min-height: 8rem;
        }

        .embedded-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: var(--radius, 0.375rem);
        }

        .no-image {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          background: var(--muted, #f1f5f9);
          border-radius: var(--radius, 0.375rem);
          color: var(--muted-foreground, #9ca3af);
          font-size: 0.875rem;
          gap: 0.5rem;
        }

        .camera-icon {
          width: 2rem;
          height: 2rem;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get hasImage() {
      return !!this.args.model?.uploadedImageUrl;
    }

    <template>
      <span class='image-atom'>
        {{#if this.hasImage}}
          <img
            src={{@model.uploadedImageUrl}}
            alt='Image'
            class='atom-thumbnail'
          />
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
  };

  static edit = ImageFieldEdit;
}

export default ImageField;
