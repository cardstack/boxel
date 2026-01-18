import { eq } from '@cardstack/boxel-ui/helpers';
import {
  FieldDef,
  Component,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import UrlField from 'https://cardstack.com/base/url';
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
import UploadImageCommand from '../commands/upload-image';
import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';
import ImageCard from 'https://cardstack.com/base/image';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import ImagePresentation from './image/components/image-presentation';
import InlinePresentation from './image/components/inline-presentation';
import CardPresentation from './image/components/card-presentation';

// Type definitions
type ImageInputVariant = 'browse' | 'dropzone' | 'avatar';
type ImagePresentationType = 'standard' | 'image' | 'inline' | 'card';
type UploadStatus = 'idle' | 'pending' | 'success' | 'error';
type PreviewImageFit = 'contain' | 'cover';

// TypeScript configuration interface
export type ImageFieldConfiguration =
  | {
      variant: 'browse' | 'dropzone';
      presentation?: ImagePresentationType;
      options?: {
        showImageModal?: boolean; // Show zoom/modal button on image preview (default: false)
        autoUpload?: boolean; // Automatically upload image after file selection (default: true)
        showProgress?: boolean; // Show progress indicator during file reading (default: true)
        previewImageFit?: PreviewImageFit; // How the preview image fits in container: 'contain' (show full image) or 'cover' (fill container, may crop) (default: 'contain')
      };
    }
  | {
      variant: 'avatar';
      presentation?: ImagePresentationType;
      options?: {
        autoUpload?: boolean; // Automatically upload image after file selection (default: true)
        showProgress?: boolean; // Show progress indicator during file reading (default: true)
        // No showImageModal or previewImageFit allowed here (avatar always uses 'cover')
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
  @tracked isUploading = false;

  constructor(owner: any, args: any) {
    super(owner, args);
    // Initialize preview from uploaded URL
    if (args.model?.url) {
      this.preview = args.model.url;
    }
  }

  get hasImage() {
    // Show preview components when reading (to display progress) or when image exists
    return this.isReading || this.preview || this.args.model?.url;
  }

  get displayPreview() {
    return this.preview || this.args.model?.url || '';
  }

  get variant(): ImageInputVariant {
    return (
      (this.args.configuration as ImageFieldConfiguration)?.variant || 'browse'
    );
  }

  get presentation(): ImagePresentationType {
    const config = this.args.configuration as ImageFieldConfiguration;
    const presentation =
      (config?.presentation as ImagePresentationType) || 'standard';
    return presentation === 'standard' ? 'image' : presentation;
  }

  get options() {
    return (this.args.configuration as ImageFieldConfiguration)?.options || {};
  }

  get autoUpload() {
    return this.options.autoUpload !== false;
  }

  get showImageModal() {
    if (this.variant === 'avatar') {
      return false;
    }
    return (
      (this.options as { showImageModal?: boolean }).showImageModal === true
    );
  }

  get showProgress() {
    return this.options.showProgress !== false; // Default to true
  }

  get previewImageFit(): PreviewImageFit {
    // Default to 'contain' (avatar doesn't use this, it always uses 'cover')
    return (
      (this.options as { previewImageFit?: PreviewImageFit }).previewImageFit ||
      'contain'
    );
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
    this.args.model.imageCard = undefined;
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

  uploadImageTask = restartableTask(async () => {
    if (!this.selectedFile && !this.preview) {
      this.uploadStatus = 'error';
      this.uploadStatusMessage = 'Please select a file first';
      return;
    }

    let commandContext = this.args.context?.commandContext;
    let realmHref = this.args.model?.[realmURLSymbol]?.href;

    if (!commandContext) {
      this.uploadStatus = 'error';
      this.uploadStatusMessage =
        'Upload failed: missing command context. Open in host with command context available.';
      return;
    }

    if (!realmHref) {
      this.uploadStatus = 'error';
      this.uploadStatusMessage =
        'Upload failed: missing realm URL to save the image card.';
      return;
    }

    try {
      this.uploadStatus = 'pending';
      this.uploadStatusMessage = 'Uploading image...';
      this.isUploading = true;

      let dataUrl =
        typeof this.preview === 'string' && this.preview.startsWith('data:')
          ? this.preview
          : await this.readFileAsDataURL(this.selectedFile as File);

      let uploadCommand = new UploadImageCommand(commandContext);
      let result = await uploadCommand.execute({
        sourceImageUrl: dataUrl,
        targetRealmUrl: realmHref,
      });

      if (!result?.cardId) {
        throw new Error('Upload succeeded but no card id was returned');
      }

      // Try to hydrate the Cloudflare image card to get a stable URL
      let uploadedUrl = dataUrl;
      let store =
        (commandContext as any)?.store || (this.args.context as any)?.store;
      if (store?.get) {
        try {
          let savedCard = await store.get(result.cardId);
          uploadedUrl = (savedCard as any)?.url ?? uploadedUrl;
        } catch (error) {
          console.warn('Unable to hydrate uploaded image card', error);
        }
      }

      // Create and save a base ImageCard with the uploaded URL
      let imageCard = new ImageCard({
        url: uploadedUrl,
      });
      let saveCard = new SaveCardCommand(commandContext);
      await saveCard.execute({
        card: imageCard,
        realm: realmHref,
      });

      this.args.model.imageCard = imageCard;
      this.preview = uploadedUrl;
      this.selectedFile = null;
      this.uploadStatus = 'success';
      this.uploadStatusMessage = 'Image uploaded successfully!';
    } catch (error: any) {
      this.uploadStatus = 'error';
      this.uploadStatusMessage = `Upload failed: ${error.message}`;
      throw error;
    } finally {
      this.isUploading = false;
    }
  });

  private readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(new Error('Could not read file as data URL'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

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
            @isReading={{this.isReading}}
            @readProgress={{this.readProgress}}
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
            @previewImageFit={{this.previewImageFit}}
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
            @previewImageFit={{this.previewImageFit}}
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
        max-width: 100%;
        box-sizing: border-box;
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
    return !!this.args.model?.url;
  }

  get imageUrl() {
    return this.args.model?.url ?? '';
  }

  get presentation(): ImagePresentationType {
    const presentation =
      (this.args.configuration as ImageFieldConfiguration)?.presentation ||
      'standard';
    return presentation === 'standard' ? 'image' : presentation;
  }

  <template>
    {{#if (eq this.presentation 'inline')}}
      <InlinePresentation
        @imageUrl={{this.imageUrl}}
        @hasImage={{this.hasImage}}
      />
    {{else if (eq this.presentation 'card')}}
      <CardPresentation
        @imageUrl={{this.imageUrl}}
        @hasImage={{this.hasImage}}
      />
    {{else}}
      <ImagePresentation
        @imageUrl={{this.imageUrl}}
        @hasImage={{this.hasImage}}
      />
    {{/if}}
  </template>
}

class ImageFieldAtom extends Component<typeof ImageField> {
  get hasImage() {
    return !!this.args.model?.url;
  }

  get imageUrl() {
    return this.args.model?.url ?? '';
  }

  <template>
    <span class='image-atom'>
      {{#if this.hasImage}}
        <img src={{this.imageUrl}} alt='' class='atom-thumbnail' />
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

export default class ImageField extends FieldDef {
  static displayName = 'Image';
  static icon = CameraIcon;

  @field imageCard = linksTo(ImageCard);
  @field imageUrl = contains(UrlField); // Direct URL to image resource
  @field url = contains(UrlField, {
    computeVia: function (this: any) {
      if (this.imageUrl) {
        return this.imageUrl;
      }
      return this.imageCard?.url || undefined;
    },
  });

  static embedded = ImageFieldEmbedded;
  static atom = ImageFieldAtom;
  static edit = ImageFieldEdit;
}
