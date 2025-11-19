import {
  Component,
  FieldDef,
  field,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import PhotoIcon from '@cardstack/boxel-icons/photo';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { restartableTask } from 'ember-concurrency';
import { Button } from '@cardstack/boxel-ui/components';
import ImagePreview from './components/image-preview';
import ImagePreviewContainer from './components/image-preview-container';
import ImageUploader from './components/image-uploader';
import CloudflareUploadButton from './components/cloudflare-upload-button';
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './util/cloudflare-upload';
import type { MultipleUploadConfig } from './util/types';
import SingleUploadField from './single';

interface UploadEntry {
  id: string;
  file: File;
  base64Preview: string;
  uploadedImageUrl?: string;
  uploadUrl?: string; // Add uploadUrl to match SingleUploadField
  uploadStatus?: string;
}

interface Configuration {
  presentation: MultipleUploadConfig;
}

class Edit extends Component<typeof MultipleUploadField> {
  @tracked uploadEntries: UploadEntry[] = [];
  @tracked uploadStatus = '';

  constructor(owner: unknown, args: unknown) {
    super(owner, args);
    const existingUploads = Array.isArray(this.args.model?.uploads)
      ? this.args.model.uploads
      : [];

    if (existingUploads.length) {
      this.uploadEntries = existingUploads.map((upload: any) =>
        this.createEntryFromExisting(upload),
      );
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

  get hasImages() {
    return this.uploadEntries.length > 0;
  }

  get maxFilesReached() {
    return this.uploadEntries.length >= (this.config.maxFiles || 10);
  }

  get hasPendingUploads() {
    return this.uploadEntries.some((entry) => !entry.uploadedImageUrl);
  }

  get uploadButtonText() {
    if (this.bulkUploadTask.isRunning) {
      return 'Uploading...';
    }
    const pendingCount = this.uploadEntries.filter(
      (entry) => !entry.uploadedImageUrl,
    ).length;
    return pendingCount > 0
      ? `Upload ${pendingCount} Image${pendingCount > 1 ? 's' : ''}`
      : 'All Images Uploaded';
  }

  get isUploadDisabled() {
    return this.bulkUploadTask.isRunning || !this.hasPendingUploads;
  }

  get uploadHint() {
    const formats = this.config.allowedFormats.join(', ').toUpperCase();
    const maxSize = this.formatFileSize(this.config.maxSize);
    const maxFiles = this.config.maxFiles;
    return `${formats} up to ${maxSize} each (max ${maxFiles} files)`;
  }

  get previewImages() {
    return this.uploadEntries.map((entry) => ({
      id: entry.id,
      preview: entry.uploadedImageUrl || entry.base64Preview,
      name: entry.file.name,
      size: entry.file.size,
    }));
  }

  @action
  handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);

    if (!files.length) return;

    // Validate each file
    const validFiles = files.filter((file) => {
      if (!file.type.startsWith('image/')) {
        console.warn(`Skipping non-image file: ${file.name}`);
        return false;
      }
      if (file.size > (this.config.maxSize || 10 * 1024 * 1024)) {
        console.warn(`Skipping oversized file: ${file.name}`);
        return false;
      }
      return true;
    });

    const remainingSlots =
      (this.config.maxFiles || 10) - this.uploadEntries.length;
    const filesToAdd = validFiles.slice(0, remainingSlots);

    filesToAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const entry = this.createEntry(file, reader.result as string);
        this.uploadEntries = [...this.uploadEntries, entry];
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    input.value = '';
  }

  @action
  removeImage(id: string) {
    this.uploadEntries = this.uploadEntries.filter((entry) => entry.id !== id);
    // Only persist if we have uploaded URLs to save
    if (this.uploadEntries.some((entry) => entry.uploadedImageUrl)) {
      this.persistEntries();
    }
  }

  @action
  persistEntries() {
    // Clear existing uploads first
    this.args.model.uploads = [];

    // Only add entries that have uploaded URLs
    this.uploadEntries
      .filter((entry) => entry.uploadedImageUrl)
      .forEach((entry) => {
        const uploadInstance = new SingleUploadField({
          uploadUrl: entry.uploadUrl, // Keep the uploadUrl like single.gts
          uploadedImageUrl: entry.uploadedImageUrl,
        });
        this.args.model.uploads.push(uploadInstance);
      });
  }

  createEntry(file: File, base64Preview: string): UploadEntry {
    return {
      id: this.generateImageId(),
      file,
      base64Preview,
    };
  }

  createEntryFromExisting(upload: any): UploadEntry {
    // Create a minimal file-like object to avoid File constructor issues
    const fileLike = {
      name: upload.fileName || 'uploaded-image',
      size: 0,
      type: 'image/jpeg',
    } as File;

    return {
      id: this.generateImageId(),
      file: fileLike,
      base64Preview: upload.uploadedImageUrl || '',
      uploadedImageUrl: upload.uploadedImageUrl,
    };
  }

  generateImageId() {
    const cryptoObj = (globalThis as any)?.crypto;
    if (cryptoObj?.randomUUID) {
      return cryptoObj.randomUUID();
    }
    return `${Date.now()}-${Math.random()}`;
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  bulkUploadTask = restartableTask(async () => {
    const pendingEntries = this.uploadEntries.filter(
      (entry) => !entry.uploadedImageUrl,
    );

    if (pendingEntries.length === 0) {
      this.uploadStatus = 'No images to upload';
      return;
    }

    this.uploadStatus = `Uploading ${pendingEntries.length} image${
      pendingEntries.length > 1 ? 's' : ''
    }...`;

    try {
      // Generate upload URLs for all pending images
      const uploadPromises = pendingEntries.map(async (entry) => {
        // Update entry status
        entry.uploadStatus = 'Generating upload URL...';

        try {
          const uploadUrl = await requestCloudflareUploadUrl(
            this.args.context?.commandContext,
            {
              source: 'boxel-multiple-image-field',
            },
          );

          entry.uploadStatus = 'Uploading...';
          const imageUrl = await uploadFileToCloudflare(uploadUrl, entry.file);

          entry.uploadedImageUrl = imageUrl;
          entry.uploadUrl = uploadUrl; // Store the uploadUrl like single.gts
          entry.uploadStatus = 'Upload successful!';
          return imageUrl;
        } catch (error: any) {
          entry.uploadStatus = `Upload failed: ${error.message}`;
          throw error;
        }
      });

      await Promise.all(uploadPromises);

      // Trigger reactivity by reassigning the array
      this.uploadEntries = [...this.uploadEntries];
      this.uploadStatus = 'All images uploaded successfully!';
      this.persistEntries();
    } catch (error: any) {
      console.error('Bulk upload error:', error);
      this.uploadStatus = `Bulk upload failed: ${error.message}`;
    }
  });

  <template>
    <div class='multiple-upload-container' data-test-multiple-upload>
      <div class='upload-controls'>
        <ImageUploader
          @uploadText='Add Images'
          @uploadHint={{this.uploadHint}}
          @onFileSelect={{this.handleFileSelect}}
          @multiple={{true}}
          @height='120px'
          @testId='multiple-upload-area'
        />
      </div>

      {{#if this.hasImages}}
        <div class='preview-section'>
          <div class='preview-header'>
            <h3 class='preview-title'>Images ({{this.uploadEntries.length}})</h3>
          </div>

          <ImagePreviewContainer
            @images={{this.previewImages}}
            @config={{this.config}}
            @onRemove={{this.removeImage}}
          />
        </div>
      {{else}}
        <div class='empty-state' data-test-empty-state>
          No images uploaded yet. Click above to add images.
        </div>
      {{/if}}

      {{#if this.hasPendingUploads}}
        <CloudflareUploadButton
          @onUpload={{this.bulkUploadTask.perform}}
          @disabled={{this.isUploadDisabled}}
          @isUploading={{this.bulkUploadTask.isRunning}}
          @uploadStatus={{this.uploadButtonText}}
        />
      {{/if}}

      {{#if this.uploadStatus}}
        <div class='bulk-status-message'>{{this.uploadStatus}}</div>
      {{/if}}
    </div>

    <style scoped>
      .multiple-upload-container {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .upload-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        align-items: flex-start;
      }

      .preview-section {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
      }

      .preview-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 0.5rem;
      }

      .preview-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--boxel-700, #374151);
      }

      .empty-state {
        text-align: center;
        color: var(--boxel-400, #9ca3af);
        padding: 2rem;
        font-size: 0.875rem;
        border: 1px dashed var(--boxel-200, #e5e7eb);
        border-radius: 0.75rem;
      }

      .bulk-status-message {
        padding: 0.5rem 0.75rem;
        border-radius: 0.375rem;
        background: #f3f4f6;
        border-left: 3px solid var(--boxel-primary-500, #3b82f6);
        font-size: 0.8125rem;
        white-space: pre-wrap;
        align-self: stretch;
      }
    </style>
  </template>
}

export default class MultipleUploadField extends FieldDef {
  static displayName = 'Multiple Upload Image Field';
  static icon = PhotoIcon;

  @field uploads = containsMany(SingleUploadField);

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
