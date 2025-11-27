import { Component } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { Button } from '@cardstack/boxel-ui/components';
import NotificationBubble from '../../../../components/notification-bubble';
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from '../../util/cloudflare-upload';
import SingleUpload from './single-upload';
import SinglePreview from './single-preview';
import PreviewModal from './preview-modal';
import ImageField from '../../image-field';

type ImageInputVariant = 'browse' | 'dropzone' | 'avatar';
type ImagePresentationType = 'standard' | 'image' | 'inline' | 'card';
type UploadStatus = 'idle' | 'pending' | 'success' | 'error';

export default class SingleImageFieldEdit extends Component<typeof ImageField> {
  @tracked preview: string | null = null;
  @tracked selectedFile: File | null = null;
  @tracked showPreview = false;
  @tracked uploadStatus: UploadStatus = 'idle';
  @tracked uploadStatusMessage = '';
  @tracked readProgress = 0;
  @tracked isReading = false;

  constructor(owner: any, args: any) {
    super(owner, args);
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
    const { configuration } = this.args;
    const variant = (configuration as any)?.variant as string | undefined;
    if (['list', 'gallery', 'dropzone'].includes(variant ?? '')) {
      return 'browse';
    }
    return (variant ?? 'browse') as ImageInputVariant;
  }

  get presentation(): ImagePresentationType {
    const config = this.args.configuration as any;
    const presentation =
      (config?.presentation as ImagePresentationType) || 'standard';
    return presentation === 'standard' ? 'image' : presentation;
  }

  get options() {
    return (this.args.configuration as any)?.options || {};
  }

  get autoUpload() {
    return this.options.autoUpload !== false;
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

    this.selectedFile = file;
    this.uploadStatus = 'idle';
    this.uploadStatusMessage = '';
    this.readProgress = 0;
    this.isReading = true;

    const reader = new FileReader();

    let progressInterval: number | undefined;
    if (this.showProgress) {
      progressInterval = window.setInterval(() => {
        if (this.readProgress < 90) {
          this.readProgress += 5;
        }
      }, 200);
    }

    reader.onload = async (e) => {
      if (progressInterval) {
        clearInterval(progressInterval);
        while (this.readProgress < 100) {
          this.readProgress = Math.min(100, this.readProgress + 5);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      const result = e.target?.result as string;
      this.preview = result;
      this.isReading = false;

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
    input.value = '';
  }

  @action
  removeImage() {
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
      } as Event & { target: { files: File[] } };
      this.handleFileSelect(fakeEvent);
    }
  }

  @action
  togglePreview() {
    this.showPreview = !this.showPreview;
  }

  uploadImageTask = restartableTask(async () => {
    if (!this.selectedFile) {
      this.uploadStatus = 'error';
      this.uploadStatusMessage = 'Please select a file first';
      return;
    }

    try {
      this.uploadStatus = 'pending';
      this.uploadStatusMessage = 'Uploading image...';

      this.args.model.uploadUrl = await requestCloudflareUploadUrl(
        this.args.context?.commandContext,
        { source: 'boxel-image-field' },
      );

      if (!this.args.model.uploadUrl) {
        this.uploadStatus = 'error';
        this.uploadStatusMessage = 'Failed to get upload URL';
        return;
      }

      const imageUrl = await uploadFileToCloudflare(
        this.args.model.uploadUrl,
        this.selectedFile,
      );

      this.args.model.uploadedImageUrl = imageUrl;
      this.preview = imageUrl;
      this.selectedFile = null;
      this.uploadStatus = 'success';
      this.uploadStatusMessage = 'Image uploaded successfully!';

      setTimeout(() => {
        if (this.uploadStatus === 'success') {
          this.uploadStatus = 'idle';
          this.uploadStatusMessage = '';
        }
      }, 3000);
    } catch (error: any) {
      this.uploadStatus = 'error';
      this.uploadStatusMessage = `Upload failed: ${error.message}`;
      throw error;
    }
  });

  <template>
    <div class='image-field-edit' data-test-image-field-edit>
      {{#if this.hasImage}}
        <SinglePreview
          @variant={{this.variant}}
          @imageData={{this.displayPreview}}
          @onRemove={{this.removeImage}}
          @onFileSelect={{this.handleFileSelect}}
          @onZoom={{this.togglePreview}}
          @showZoomButton={{this.showImageModal}}
          @hasPendingUpload={{this.hasPendingUpload}}
          @isReading={{this.isReading}}
          @readProgress={{this.readProgress}}
        />

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

        {{#if this.showNotification}}
          <NotificationBubble
            @type={{this.uploadStatus}}
            @message={{this.uploadStatusMessage}}
          />
        {{/if}}
      {{else}}
        <SingleUpload
          @variant={{this.variant}}
          @onFileSelect={{this.handleFileSelect}}
          @onDragOver={{this.handleDragOver}}
          @onDrop={{this.handleDrop}}
        />
      {{/if}}

      {{#if this.showPreview}}
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
      }
    </style>
  </template>
}
