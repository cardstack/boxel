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
import ImagePreviewContainer from './components/image-preview-container';
import ImageUploader from './components/image-uploader';
import CloudflareUploadButton from './components/cloudflare-upload-button';
import ErrorMessage from './components/error-message';
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './util/cloudflare-upload';
import {
  buildUploadHint,
  generateUploadId,
  mergeMultipleUploadConfig,
} from './util/index';
import type { MultipleUploadConfig } from './util/types';
import SingleUploadField from './single';

interface UploadEntry {
  id: string;
  file: File;
  base64Preview: string;
  uploadedImageUrl?: string;
  uploadUrl?: string; // Add uploadUrl to match SingleUploadField
}

interface Configuration {
  presentation: MultipleUploadConfig;
}

class Edit extends Component<typeof MultipleUploadField> {
  @tracked uploadEntries: UploadEntry[] = [];
  @tracked errorMessage = '';

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
    return mergeMultipleUploadConfig(
      this.args.configuration?.presentation as MultipleUploadConfig,
    );
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

  get showUploadButton() {
    return this.uploadEntries.length > 0;
  }

  get uploadButtonText() {
    if (this.bulkUploadTask.isRunning) {
      return 'Uploading...';
    }
    return this.hasPendingUploads ? 'Upload Images' : 'Uploaded successfully';
  }

  get uploadButtonDisabled() {
    return this.bulkUploadTask.isRunning || !this.hasPendingUploads;
  }

  get uploadHint() {
    const baseHint =
      buildUploadHint(
        this.config.allowedFormats,
        this.config.maxSize,
        'PNG, JPG, GIF up to 10MB',
      ) || 'Upload images up to 10MB';
    const maxFiles = this.config.maxFiles || 10;
    return `${baseHint} (max ${maxFiles} files)`;
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
    this.errorMessage = '';
    if (this.uploadEntries.some((entry) => entry.uploadedImageUrl)) {
      this.persistEntries();
    } else {
      this.args.model.uploads = [];
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
      id: generateUploadId(),
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
      id: generateUploadId(),
      file: fileLike,
      base64Preview: upload.uploadedImageUrl || '',
      uploadedImageUrl: upload.uploadedImageUrl,
      uploadUrl: upload.uploadUrl,
    };
  }

  bulkUploadTask = restartableTask(async () => {
    const pendingEntries = this.uploadEntries.filter(
      (entry) => !entry.uploadedImageUrl,
    );

    if (pendingEntries.length === 0) {
      return;
    }

    const errorMessages: string[] = [];

    // Upload each image individually to catch specific errors
    for (const entry of pendingEntries) {
      try {
        const uploadUrl = await requestCloudflareUploadUrl(
          this.args.context?.commandContext,
          {
            source: 'boxel-multiple-image-field',
          },
        );
        entry.uploadUrl = uploadUrl;
        const imageUrl = await uploadFileToCloudflare(uploadUrl, entry.file);
        entry.uploadedImageUrl = imageUrl;
      } catch (error: any) {
        // Collect error message for this specific entry
        const fullErrorMessage = error.message || String(error);
        // Remove newlines from error message to prevent formatting issues
        const cleanErrorMessage = fullErrorMessage.replace(/\n/g, ' ').trim();
        errorMessages.push(`${entry.file.name}: ${cleanErrorMessage}`);
      }
    }

    // Trigger reactivity by reassigning the array
    this.uploadEntries = [...this.uploadEntries];
    this.persistEntries();

    // Show all error messages if any failed
    if (errorMessages.length > 0) {
      this.errorMessage = `Upload failed for ${
        errorMessages.length
      } image(s):\n${errorMessages.join('\n')}`;
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

      <CloudflareUploadButton
        @showButton={{this.showUploadButton}}
        @onUpload={{this.bulkUploadTask.perform}}
        @disabled={{this.uploadButtonDisabled}}
        @isUploading={{this.bulkUploadTask.isRunning}}
        @label={{this.uploadButtonText}}
      />

      <ErrorMessage @message={{this.errorMessage}} />
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
