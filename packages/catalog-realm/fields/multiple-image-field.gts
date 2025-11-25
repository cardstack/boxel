import { eq, gt } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';

import GripVerticalIcon from '@cardstack/boxel-icons/grip-vertical';
import UploadIcon from '@cardstack/boxel-icons/upload';
import XIcon from '@cardstack/boxel-icons/x';
import Grid3x3Icon from '@cardstack/boxel-icons/grid-3x3';
import CameraIcon from '@cardstack/boxel-icons/camera';

import {
  Component,
  FieldDef,
  field,
  containsMany,
} from 'https://cardstack.com/base/card-api';

import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

import { restartableTask } from 'ember-concurrency';

import { Button } from '@cardstack/boxel-ui/components';
import NotificationBubble from '../components/notification-bubble';

import {
  SortableGroupModifier as sortableGroup,
  SortableHandleModifier as sortableHandle,
  SortableItemModifier as sortableItem,
} from '@cardstack/boxel-ui/modifiers';

import { uuidv4 } from '@cardstack/runtime-common';

import ImageField from './image-field';

import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './image/util/cloudflare-upload';

import GridPresentation from './image/components/grid-presentation';
import CarouselPresentation from './image/components/carousel-presentation';

// Type definitions
type ImageVariant = 'list' | 'gallery' | 'dropzone';
type ImagePresentation = 'grid' | 'carousel';
type UploadStatus = 'idle' | 'pending' | 'success' | 'error';
type SortableDirection = 'x' | 'y' | 'grid';

// Configuration interface
interface MultipleImageFieldConfiguration {
  variant?: ImageVariant;
  presentation?: ImagePresentation;
  options?: {
    autoUpload?: boolean; // Auto-upload after file selection
    allowReorder?: boolean; // Allow drag-drop reordering
    allowBatchSelect?: boolean; // Allow batch selection and delete (default true)
    maxFiles?: number; // Max number of files (default 10)
    showProgress?: boolean; // Show progress during file reading
  };
}

// Upload entry for local preview before upload
interface UploadEntry {
  id: string;
  file: File;
  preview: string; // Local base64 preview
  uploadedImageUrl?: string; // Cloudflare CDN URL
  selected?: boolean; // Batch selection state
  readProgress?: number; // File reading progress (0-100)
  isReading?: boolean; // Currently reading file
  isUploading?: boolean; // Currently uploading to Cloudflare
  uploadStatus?: UploadStatus; // Upload result status
  uploadError?: string; // Error message if upload failed
}

class MultipleImageFieldEdit extends Component<typeof MultipleImageField> {
  @tracked uploadEntries: UploadEntry[] = []; // Local preview entries
  @tracked uploadStatus: UploadStatus | 'idle' = 'idle'; // Upload status for notification
  @tracked uploadStatusMessage = ''; // Upload status message
  @tracked selectAll = false; // Select all checkbox state
  private sortableGroupId = uuidv4(); // Unique ID for sortable

  constructor(owner: any, args: any) {
    super(owner, args);
    // Load existing uploaded images only (no error persistence)
    const existingImages = Array.isArray(this.args.model?.images)
      ? this.args.model.images
      : [];
    this.uploadEntries = existingImages.map((img: ImageField) =>
      this.createEntryFromExisting(img),
    );
  }

  // Configuration getters
  get variant(): ImageVariant {
    return (
      (this.args.configuration as MultipleImageFieldConfiguration)?.variant ||
      'list'
    );
  }

  get presentation(): ImagePresentation {
    return (
      (this.args.configuration as MultipleImageFieldConfiguration)
        ?.presentation || 'grid'
    );
  }

  get options() {
    return (
      (this.args.configuration as MultipleImageFieldConfiguration)?.options ||
      {}
    );
  }

  get autoUpload() {
    return this.options.autoUpload === true;
  }

  get allowReorder() {
    return this.options.allowReorder === true;
  }

  get allowBatchSelect() {
    return this.options.allowBatchSelect !== false; // Default to true
  }

  get maxFiles() {
    return this.options.maxFiles || 10;
  }

  get showProgress() {
    return this.options.showProgress === true;
  }

  get hasSelection() {
    return this.uploadEntries.some((entry) => entry.selected);
  }

  get selectedCount() {
    return this.uploadEntries.filter((entry) => entry.selected).length;
  }

  get sortableDisabled() {
    return !this.allowReorder;
  }

  get sortableDirection(): SortableDirection {
    return this.variant === 'gallery' ? 'grid' : 'y';
  }

  // State getters
  get hasImages() {
    return this.uploadEntries.length > 0;
  }

  get maxFilesReached() {
    return this.uploadEntries.length >= this.maxFiles;
  }

  get hasPendingUploads() {
    return this.uploadEntries.some(
      (entry) => !entry.uploadedImageUrl || entry.uploadStatus === 'error',
    );
  }

  get hasErrorImages() {
    return this.uploadEntries.some((entry) => entry.uploadStatus === 'error');
  }

  get showUploadButton() {
    return this.hasImages && !this.autoUpload;
  }

  get uploadButtonLabel() {
    if (this.bulkUploadTask.isRunning) {
      return 'Uploading...';
    }
    if (this.hasErrorImages && this.hasPendingUploads) {
      return 'Retry Failed & Upload All';
    }
    if (this.hasErrorImages) {
      return 'Retry Failed Uploads';
    }
    return this.hasPendingUploads ? 'Upload All to Cloudflare' : 'Uploaded';
  }

  get uploadButtonDisabled() {
    return this.bulkUploadTask.isRunning || !this.hasPendingUploads;
  }

  get showNotification() {
    return !!(this.uploadStatusMessage && this.uploadStatus !== 'idle');
  }

  @action
  async handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    await this.processFiles(files);
    input.value = ''; // Reset input
  }

  @action
  async handleFilesDropped(files: File[]) {
    await this.processFiles(files);
  }

  // Process selected files
  async processFiles(files: File[]) {
    if (!files.length) return;

    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const remainingSlots = this.maxFiles - this.uploadEntries.length;
    const filesToAdd = imageFiles.slice(0, remainingSlots);

    // Create preview for each file
    for (const file of filesToAdd) {
      // Create entry with initial reading state
      const entry: UploadEntry = {
        id: `${Date.now()}-${Math.random()}`,
        file,
        preview: '',
        selected: false,
        isReading: true,
        readProgress: 0,
      };
      this.uploadEntries = [...this.uploadEntries, entry];

      const reader = new FileReader();

      // Simulate progress if enabled
      let progressInterval: number | undefined;
      if (this.showProgress) {
        progressInterval = window.setInterval(() => {
          this.uploadEntries = this.uploadEntries.map((e) =>
            e.id === entry.id && (e.readProgress ?? 0) < 90
              ? { ...e, readProgress: (e.readProgress ?? 0) + 2 }
              : e,
          );
        }, 300);
      }

      reader.onloadend = async () => {
        if (progressInterval) {
          clearInterval(progressInterval);
        }

        if (this.showProgress) {
          // Smoothly animate to 100%
          let currentProgress =
            this.uploadEntries.find((e) => e.id === entry.id)?.readProgress ??
            0;
          while (currentProgress < 100) {
            currentProgress = Math.min(100, currentProgress + 10);
            this.uploadEntries = this.uploadEntries.map((e) =>
              e.id === entry.id ? { ...e, readProgress: currentProgress } : e,
            );
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }

        // Update entry with preview and complete reading state
        this.uploadEntries = this.uploadEntries.map((e) =>
          e.id === entry.id
            ? { ...e, preview: reader.result as string, isReading: false }
            : e,
        );

        // Auto-upload if enabled
        if (this.autoUpload) {
          this.bulkUploadTask.perform();
        }
      };

      reader.onerror = () => {
        if (progressInterval) {
          clearInterval(progressInterval);
        }
        const foundEntry = this.uploadEntries.find((e) => e.id === entry.id);
        if (foundEntry) {
          foundEntry.isReading = false;
          this.uploadEntries = [...this.uploadEntries];
        }
      };

      reader.readAsDataURL(file);
    }
  }

  // Create entry from existing ImageField
  createEntryFromExisting(img: ImageField): UploadEntry {
    // Extract filename from uploadedImageUrl
    const extractFilename = (url: string | undefined): string => {
      if (!url) return 'uploaded-image';
      try {
        const urlParts = url.split('/');
        const filename = urlParts[urlParts.length - 2]; // Get the ID part (e.g., "upload-1763960401230")
        return filename || 'uploaded-image';
      } catch {
        return 'uploaded-image';
      }
    };

    const filename = extractFilename(img.uploadedImageUrl);
    const fileLike = {
      name: filename,
      size: 0,
      type: 'image/jpeg',
    } as File;

    return {
      id: `${Date.now()}-${Math.random()}`,
      file: fileLike,
      preview: img.uploadedImageUrl || '',
      uploadedImageUrl: img.uploadedImageUrl,
      selected: false, // Initialize selection state
      uploadStatus: img.uploadedImageUrl ? 'success' : undefined, // Mark existing uploads as success
    };
  }

  @action
  removeImage(id: string) {
    // Remove entry from local preview
    this.uploadEntries = this.uploadEntries.filter((entry) => entry.id !== id);
    this.uploadStatus = 'idle';
    this.uploadStatusMessage = '';

    // Update model - persist both successful and error images
    this.persistEntries();
  }

  @action
  handleReorder(reorderedEntries: UploadEntry[]) {
    // Reorder entries
    this.uploadEntries = reorderedEntries;
    if (this.uploadEntries.some((entry) => entry.uploadedImageUrl)) {
      this.persistEntries();
    }
  }

  @action
  handleDragOver(event: DragEvent) {
    event.preventDefault();
  }

  @action
  handleDrop(event: DragEvent) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []);
    this.processFiles(files);
  }

  @action
  toggleSelectAll() {
    // Toggle select all
    this.selectAll = !this.selectAll;
    this.uploadEntries = this.uploadEntries.map((entry) => ({
      ...entry,
      selected: this.selectAll,
    }));
  }

  @action
  toggleSelection(id: string) {
    // Toggle individual selection
    this.uploadEntries = this.uploadEntries.map((entry) =>
      entry.id === id ? { ...entry, selected: !entry.selected } : entry,
    );
    this.selectAll = this.uploadEntries.every((entry) => entry.selected);
  }

  @action
  deleteSelected() {
    // Delete all selected images
    this.uploadEntries = this.uploadEntries.filter((entry) => !entry.selected);
    this.selectAll = false;
    this.uploadStatus = 'idle';
    this.uploadStatusMessage = '';

    // Update model - persist both successful and error images
    this.persistEntries();
  }

  // Save only successful uploads to model
  // Error images stay in memory for current session only - not persisted
  persistEntries() {
    this.args.model.images = [];

    // Only persist successful uploads
    this.uploadEntries
      .filter(
        (entry) => entry.uploadedImageUrl && entry.uploadStatus !== 'error',
      )
      .forEach((entry) => {
        const imageField = new ImageField();
        if (entry.uploadedImageUrl) {
          imageField.uploadedImageUrl = entry.uploadedImageUrl;
          if (this.args.model.images) {
            this.args.model.images.push(imageField);
          }
        }
      });
  }

  // Bulk upload task - uploads all pending images and retries errors
  bulkUploadTask = restartableTask(async () => {
    // Include entries without uploadedImageUrl OR entries with error status (for retry)
    const pendingEntries = this.uploadEntries.filter(
      (entry) => !entry.uploadedImageUrl || entry.uploadStatus === 'error',
    );

    if (pendingEntries.length === 0) {
      return;
    }

    // Set pending status
    this.uploadStatus = 'pending';
    this.uploadStatusMessage = 'Uploading images...';

    const errorMessages: string[] = [];

    // Upload each image individually
    for (const entry of pendingEntries) {
      const entryId = entry.id; // Store ID for reliable lookup
      const entryFile = entry.file; // Store file reference

      try {
        // Reset error status when retrying and set uploading state
        this.uploadEntries = this.uploadEntries.map((e) =>
          e.id === entryId
            ? {
                ...e,
                uploadStatus: undefined,
                uploadError: undefined,
                isUploading: true,
              }
            : e,
        );

        // Step 1: Get Cloudflare upload URL
        const uploadUrl = await requestCloudflareUploadUrl(
          this.args.context?.commandContext,
          { source: 'boxel-multiple-image-field' },
        );

        // Step 2: Upload to Cloudflare
        const imageUrl = await uploadFileToCloudflare(uploadUrl, entryFile);

        // Update entry with success status - update immutably for live reactivity
        // This triggers immediate UI update with green border
        this.uploadEntries = this.uploadEntries.map((e) =>
          e.id === entryId
            ? {
                ...e,
                uploadedImageUrl: imageUrl,
                uploadStatus: 'success' as const,
                uploadError: undefined,
                isUploading: false,
              }
            : e,
        );
      } catch (error: any) {
        // Mark as error and save error message - update immutably for live reactivity
        const cleanError = (error.message || String(error))
          .replace(/\n/g, ' ')
          .trim();
        errorMessages.push(`${entryFile.name}: ${cleanError}`);
        console.error(
          'Upload failed for image:',
          entryFile.name,
          'Error:',
          cleanError,
        );

        // Update entry with error status immutably - triggers immediate UI update with red border
        this.uploadEntries = this.uploadEntries.map((e) =>
          e.id === entryId
            ? {
                ...e,
                uploadStatus: 'error' as const,
                uploadError: cleanError,
                isUploading: false,
              }
            : e,
        );
      }
    }

    // Persist all uploaded images
    this.persistEntries();

    // Show errors if any failed, otherwise show success
    if (errorMessages.length > 0) {
      this.uploadStatus = 'error';
      this.uploadStatusMessage = `Upload failed for ${
        errorMessages.length
      } image(s): ${errorMessages.join(', ')}`;
    } else {
      this.uploadStatus = 'success';
      this.uploadStatusMessage = `Successfully uploaded ${
        pendingEntries.length
      } image${pendingEntries.length === 1 ? '' : 's'}!`;

      // Clear success message after 3 seconds
      setTimeout(() => {
        if (this.uploadStatus === 'success') {
          this.uploadStatus = 'idle';
          this.uploadStatusMessage = '';
        }
      }, 3000);
    }
  });

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  <template>
    <div
      class='multiple-image-field-edit variant-{{this.variant}}'
      data-test-multiple-image-field
    >
      {{! Upload trigger }}
      <label
        class='upload-trigger variant-{{this.variant}}
          {{if this.maxFilesReached "disabled"}}'
        {{on 'dragover' this.handleDragOver}}
        {{on 'drop' this.handleDrop}}
      >
        {{#if (eq this.variant 'gallery')}}
          <Grid3x3Icon class='upload-icon' />
          <span class='upload-text'>
            {{#if this.maxFilesReached}}
              Max images reached ({{this.uploadEntries.length}}/{{this.maxFiles}})
            {{else}}
              Add to gallery ({{this.uploadEntries.length}}/{{this.maxFiles}})
            {{/if}}
          </span>
        {{else if (eq this.variant 'dropzone')}}
          <UploadIcon class='upload-icon' />
          <div class='dropzone-text'>
            <span class='dropzone-title'>Drag & drop images here</span>
            <span class='dropzone-subtitle'>or click to browse</span>
          </div>
        {{else}}
          <UploadIcon class='upload-icon' />
          <span class='upload-text'>
            {{#if this.maxFilesReached}}
              Max images reached ({{this.uploadEntries.length}}/{{this.maxFiles}})
            {{else}}
              Add images ({{this.uploadEntries.length}}/{{this.maxFiles}})
            {{/if}}
          </span>
        {{/if}}
        <input
          type='file'
          class='file-input'
          accept='image/*'
          multiple={{true}}
          disabled={{this.maxFilesReached}}
          {{on 'change' this.handleFileSelect}}
        />
      </label>

      {{! Image list }}
      {{#if (gt this.uploadEntries.length 0)}}
        {{! Batch actions header }}
        {{#if this.allowBatchSelect}}
          <div class='batch-actions'>
            <label class='select-all-label'>
              <input
                type='checkbox'
                class='select-all-checkbox'
                checked={{this.selectAll}}
                {{on 'change' this.toggleSelectAll}}
                data-test-select-all
              />
              <span>Select All</span>
            </label>
            {{#if this.hasSelection}}
              <button
                type='button'
                class='delete-selected-button'
                {{on 'click' this.deleteSelected}}
                data-test-delete-selected
              >
                <XIcon class='delete-icon' />
                Delete ({{this.selectedCount}})
              </button>
            {{/if}}
          </div>
        {{/if}}

        <div
          class='images-container variant-{{this.variant}}'
          {{sortableGroup
            groupName=this.sortableGroupId
            onChange=this.handleReorder
            disabled=this.sortableDisabled
            direction=this.sortableDirection
          }}
        >
          {{#each this.uploadEntries as |entry|}}
            {{! Gallery variant }}
            {{#if (eq this.variant 'gallery')}}
              <div
                class='gallery-item
                  {{if entry.selected "is-selected"}}
                  {{if (eq entry.uploadStatus "success") "upload-success"}}
                  {{if (eq entry.uploadStatus "error") "upload-error"}}'
                {{sortableItem
                  groupName=this.sortableGroupId
                  model=entry
                  disabled=this.sortableDisabled
                }}
              >
                {{! Gallery checkbox }}
                {{#if this.allowBatchSelect}}
                  <div class='item-checkbox-gallery'>
                    <label>
                      <input
                        type='checkbox'
                        checked={{entry.selected}}
                        {{on 'change' (fn this.toggleSelection entry.id)}}
                        data-test-item-checkbox
                      />
                      <span class='sr-only'>Select image</span>
                    </label>
                  </div>
                {{/if}}

                {{#if this.allowReorder}}
                  <div class='drag-handle' {{sortableHandle}}></div>
                {{/if}}

                {{#if entry.isReading}}
                  <div class='gallery-reading-progress'>
                    <div class='progress-indicator'>
                      <div class='progress-bar-gallery'>
                        <div
                          class='progress-fill-gallery'
                          style={{htmlSafe
                            (concat 'width: ' entry.readProgress '%')
                          }}
                        ></div>
                      </div>
                      <span
                        class='progress-text-gallery'
                      >{{entry.readProgress}}%</span>
                    </div>
                  </div>
                {{else}}
                  <img
                    src={{if
                      entry.uploadedImageUrl
                      entry.uploadedImageUrl
                      entry.preview
                    }}
                    alt=''
                    class='gallery-image'
                  />

                  {{! Uploading spinner overlay }}
                  {{#if entry.isUploading}}
                    <div class='uploading-overlay'>
                      <div class='spinner'></div>
                      <span class='uploading-text'>Uploading...</span>
                    </div>
                  {{/if}}

                  {{! Upload status indicators }}
                  {{#if (eq entry.uploadStatus 'success')}}
                    <div class='upload-status-icon success'>
                      <svg
                        class='status-icon'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path d='M20 6L9 17l-5-5' />
                      </svg>
                    </div>
                  {{else if (eq entry.uploadStatus 'error')}}
                    <div class='gallery-error-badge'>
                      <svg
                        class='error-badge-icon'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <circle cx='12' cy='12' r='10' />
                        <line x1='15' y1='9' x2='9' y2='15' />
                        <line x1='9' y1='9' x2='15' y2='15' />
                      </svg>
                      <span class='error-badge-text'>Upload failed</span>
                    </div>
                  {{/if}}
                {{/if}}

                <button
                  type='button'
                  {{on 'click' (fn this.removeImage entry.id)}}
                  class='gallery-remove'
                >
                  <XIcon class='remove-icon' />
                </button>
              </div>
              {{! List variant }}
            {{else}}
              <div
                class='list-item
                  {{if entry.selected "is-selected"}}
                  {{if (eq entry.uploadStatus "success") "upload-success"}}
                  {{if (eq entry.uploadStatus "error") "upload-error"}}'
                {{sortableItem
                  groupName=this.sortableGroupId
                  model=entry
                  disabled=this.sortableDisabled
                }}
              >
                {{! List checkbox }}
                {{#if this.allowBatchSelect}}
                  <label>
                    <input
                      type='checkbox'
                      class='list-checkbox'
                      checked={{entry.selected}}
                      {{on 'change' (fn this.toggleSelection entry.id)}}
                      data-test-item-checkbox
                    />
                    <span class='sr-only'>Select image</span>
                  </label>
                {{/if}}

                {{#if this.allowReorder}}
                  <GripVerticalIcon class='grip-icon' />
                  <div class='drag-handle' {{sortableHandle}}></div>
                {{/if}}

                {{#if entry.isReading}}
                  <div class='list-reading-progress'>
                    <div class='progress-indicator'>
                      <div class='progress-bar-small'>
                        <div
                          class='progress-fill-small'
                          style={{htmlSafe
                            (concat 'width: ' entry.readProgress '%')
                          }}
                        ></div>
                      </div>
                      <span
                        class='progress-text-small'
                      >{{entry.readProgress}}%</span>
                    </div>
                  </div>
                {{else}}
                  <div class='image-wrapper'>
                    <img
                      src={{if
                        entry.uploadedImageUrl
                        entry.uploadedImageUrl
                        entry.preview
                      }}
                      alt=''
                      class='list-image'
                    />

                    {{! Uploading spinner overlay }}
                    {{#if entry.isUploading}}
                      <div class='uploading-overlay-small'>
                        <div class='spinner-small'></div>
                      </div>
                    {{/if}}

                    {{! Upload status indicators }}
                    {{#if (eq entry.uploadStatus 'success')}}
                      <div class='upload-status-icon success'>
                        <svg
                          class='status-icon'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          stroke-width='2'
                        >
                          <path d='M20 6L9 17l-5-5' />
                        </svg>
                      </div>
                    {{else if (eq entry.uploadStatus 'error')}}
                      <div class='upload-status-icon error'>
                        <svg
                          class='status-icon'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          stroke-width='2'
                        >
                          <circle cx='12' cy='12' r='10' />
                          <line x1='15' y1='9' x2='9' y2='15' />
                          <line x1='9' y1='9' x2='15' y2='15' />
                        </svg>
                      </div>
                    {{/if}}
                  </div>
                {{/if}}

                <div class='list-info'>
                  <div class='list-name'>{{if
                      entry.uploadedImageUrl
                      entry.uploadedImageUrl
                      entry.file.name
                    }}</div>
                  {{#unless entry.uploadedImageUrl}}
                    <div class='list-size'>{{this.formatSize
                        entry.file.size
                      }}</div>
                  {{/unless}}
                  {{#if entry.uploadError}}
                    <div class='upload-error-text'>Upload failed</div>
                  {{/if}}
                </div>
                <button
                  type='button'
                  {{on 'click' (fn this.removeImage entry.id)}}
                  class='list-remove'
                >
                  <XIcon class='remove-icon' />
                </button>
              </div>
            {{/if}}
          {{/each}}
        </div>
      {{/if}}

      {{! Upload button (only shown when not auto-upload) }}
      {{#if this.showUploadButton}}
        <Button
          class='upload-button'
          @kind='primary-dark'
          @size='tall'
          @disabled={{this.uploadButtonDisabled}}
          {{on 'click' this.bulkUploadTask.perform}}
          data-test-bulk-upload-button
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
    </div>

    <style scoped>
      .multiple-image-field-edit {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .file-input {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }

      .upload-trigger {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        width: 100%;
        min-height: 4rem;
        border: 2px dashed var(--primary, #3b82f6);
        border-radius: var(--radius, 0.5rem);
        background: rgba(59, 130, 246, 0.05);
        cursor: pointer;
        transition: all 0.2s ease;
        padding: 1rem;
      }

      .upload-trigger:hover {
        border-color: #2563eb;
        background: rgba(59, 130, 246, 0.1);
      }

      .upload-trigger.variant-gallery,
      .upload-trigger.variant-dropzone {
        border-color: var(--primary, #3b82f6);
        background: rgba(59, 130, 246, 0.05);
      }

      .upload-trigger.variant-dropzone {
        flex-direction: column;
        min-height: 8rem;
      }

      .upload-trigger.variant-dropzone:hover {
        border-color: #2563eb;
        background: rgba(59, 130, 246, 0.1);
      }

      .upload-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary, #3b82f6);
      }

      .upload-trigger.variant-dropzone .upload-icon {
        width: 2.5rem;
        height: 2.5rem;
        color: var(--primary, #3b82f6);
      }

      .upload-text {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
      }

      .dropzone-text {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
      }

      .dropzone-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
        text-align: center;
      }

      .dropzone-subtitle {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        text-align: center;
      }

      .upload-trigger.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .upload-button {
        width: 100%;
        justify-content: center;
      }

      /* List variant */
      .images-container.variant-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        max-height: 32rem;
        overflow-y: auto;
      }

      /* Ensure dragged item appears on top */
      .images-container.variant-list :deep(.is-dragging) {
        z-index: 99;
      }

      /* Dropzone variant - same as list */
      .images-container.variant-dropzone {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        max-height: 32rem;
        overflow-y: auto;
      }

      /* Ensure dragged item appears on top */
      .images-container.variant-dropzone :deep(.is-dragging) {
        z-index: 99;
      }

      .list-item {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.7rem;
        padding: 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        background: var(--background, #ffffff);
        transition: all 0.2s ease;
      }

      .list-item:hover {
        box-shadow: var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
        border: 2px dashed var(--primary, #3b82f6);
      }

      .list-item.upload-success {
        border: 2px solid #10b981 !important;
        background: rgba(16, 185, 129, 0.05);
        box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.2);
      }

      .list-item.upload-success:hover {
        border: 2px solid #10b981 !important;
        box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.3);
      }

      .list-item.upload-error {
        border: 2px solid #ef4444 !important;
        background: rgba(239, 68, 68, 0.05);
        box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.2);
      }

      .list-item.upload-error:hover {
        border: 2px solid #ef4444 !important;
        box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.3);
      }

      .grip-icon {
        width: 0.8rem;
        height: 0.8rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .drag-handle {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--muted-foreground, #9ca3af);
        cursor: grab;
        user-select: none;
        padding: 0.25rem;
        background: none;
        border: none;
        flex-shrink: 0;
      }

      .drag-handle:active {
        cursor: grabbing;
      }

      .image-wrapper {
        position: relative;
        width: 4rem;
        height: 4rem;
        flex-shrink: 0;
      }

      .list-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--radius, 0.375rem);
      }

      .list-reading-progress {
        width: 4rem;
        height: 4rem;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(59, 130, 246, 0.05);
        border-radius: var(--radius, 0.375rem);
      }

      .progress-indicator {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
      }

      .progress-bar-small {
        width: 2.5rem;
        height: 0.25rem;
        background: var(--muted, #f1f5f9);
        border-radius: 9999px;
        overflow: hidden;
      }

      .progress-fill-small {
        height: 100%;
        background: var(--primary, #3b82f6);
        transition: width 0.3s ease;
        border-radius: 9999px;
      }

      .progress-text-small {
        font-size: 0.625rem;
        color: var(--primary, #3b82f6);
        font-weight: 600;
      }

      .list-info {
        flex: 1;
        min-width: 0;
      }

      .list-name {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        word-break: break-all;
        line-height: 1.3;
      }

      .list-size {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin-top: 0.125rem;
      }

      .upload-error-text {
        font-size: 0.6875rem;
        color: #ef4444;
        margin-top: 0.25rem;
        font-weight: 500;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
      }

      .upload-status-icon {
        position: absolute;
        bottom: 0.25rem;
        right: 0.25rem;
        width: 1.5rem;
        height: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 9999px;
        z-index: 2;
      }

      .upload-status-icon.success {
        background: #10b981;
        color: white;
      }

      .upload-status-icon.error {
        background: #ef4444;
        color: white;
      }

      .upload-status-icon .status-icon {
        width: 1rem;
        height: 1rem;
      }

      /* Gallery error badge */
      .gallery-error-badge {
        position: absolute;
        bottom: 0.5rem;
        left: 0.5rem;
        right: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        padding: 0.375rem 0.625rem;
        background: #ef4444;
        color: white;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 600;
        z-index: 2;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .error-badge-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
      }

      .error-badge-text {
        white-space: nowrap;
      }

      /* Uploading overlay and spinner */
      .uploading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        z-index: 3;
      }

      .uploading-overlay-small {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3;
        border-radius: var(--radius, 0.375rem);
      }

      .spinner {
        width: 2.5rem;
        height: 2.5rem;
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      .spinner-small {
        width: 1.5rem;
        height: 1.5rem;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .uploading-text {
        color: white;
        font-size: 0.875rem;
        font-weight: 600;
      }

      .list-remove {
        width: 2rem;
        height: 2rem;
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
        border: none;
        border-radius: 9999px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.2s ease;
        z-index: 2;
      }

      .list-remove:hover {
        background: #dc2626;
      }

      /* Gallery variant */
      .images-container.variant-gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
        gap: 0.75rem;
        max-height: 32rem;
        overflow-y: auto;
      }

      /* Ensure dragged item appears on top */
      .images-container.variant-gallery :deep(.is-dragging) {
        z-index: 99;
      }

      .gallery-item {
        position: relative;
        aspect-ratio: 1;
        background: var(--muted, #f1f5f9);
        border: 1px dashed transparent;
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
        transition: all 0.2s ease;
      }

      .gallery-item:hover {
        border: 2px dashed var(--primary, #3b82f6);
      }

      .gallery-item.upload-success {
        border: 2px solid #10b981 !important;
        background: rgba(16, 185, 129, 0.05);
        box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.2);
      }

      .gallery-item.upload-success:hover {
        border: 2px solid #10b981 !important;
        box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.3);
      }

      .gallery-item.upload-error {
        border: 2px solid #ef4444 !important;
        background: rgba(239, 68, 68, 0.05);
        box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.2);
      }

      .gallery-item.upload-error:hover {
        border: 2px solid #ef4444 !important;
        box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.3);
      }

      .drag-handle {
        position: absolute;
        top: 0rem;
        left: 0rem;
        width: 100%;
        height: 100%;
        outline: 1px solid transparent;
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .drag-handle:active {
        cursor: grabbing;
      }

      .gallery-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .gallery-reading-progress {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(59, 130, 246, 0.05);
      }

      .progress-bar-gallery {
        width: 4rem;
        height: 0.375rem;
        background: var(--muted, #f1f5f9);
        border-radius: 9999px;
        overflow: hidden;
      }

      .progress-fill-gallery {
        height: 100%;
        background: var(--primary, #3b82f6);
        transition: width 0.3s ease;
        border-radius: 9999px;
      }

      .progress-text-gallery {
        font-size: 0.75rem;
        color: var(--primary, #3b82f6);
        font-weight: 600;
        margin-top: 0.5rem;
      }

      .gallery-remove {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        width: 1.75rem;
        height: 1.75rem;
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
        border: none;
        border-radius: 9999px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: all 0.2s ease;
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      }

      .gallery-item:hover .gallery-remove {
        opacity: 1;
      }

      .gallery-remove:hover {
        background: #dc2626;
        transform: scale(1.1);
      }

      .remove-icon {
        width: 0.875rem;
        height: 0.875rem;
      }

      .list-remove .remove-icon {
        width: 1rem;
        height: 1rem;
      }

      .batch-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        background: var(--background, #ffffff);
      }
      .select-all-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
      }
      .select-all-checkbox {
        width: 1rem;
        height: 1rem;
        cursor: pointer;
      }
      .delete-selected-button {
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
        border: none;
        border-radius: var(--radius-sm, 0.25rem);
        padding: 0.25rem 0.75rem;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
      }
      .delete-selected-button:hover {
        background: #dc2626;
      }

      .item-checkbox-gallery {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        z-index: 3;
      }

      .item-checkbox-gallery input[type='checkbox'] {
        width: 1.25rem;
        height: 1.25rem;
        cursor: pointer;
        accent-color: var(--primary, #3b82f6);
      }

      .gallery-item.is-selected {
        outline: 3px solid var(--primary, #3b82f6);
        outline-offset: -3px;
      }
      .list-item.is-selected {
        background-color: var(--accent, #f0f9ff);
        border-color: var(--primary, #3b82f6);
      }

      .list-checkbox {
        width: 1.25rem;
        height: 1.25rem;
        cursor: pointer;
        flex-shrink: 0;
      }

      .delete-icon {
        width: 1rem;
        height: 1rem;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }
    </style>
  </template>
}

class MultipleImageFieldAtom extends Component<typeof MultipleImageField> {
  get imageCount(): number {
    return this.args.model?.images?.length || 0;
  }

  get firstImage(): ImageField | undefined {
    return this.args.model?.images?.[0];
  }

  <template>
    <span class='multiple-image-atom'>
      {{#if this.firstImage}}
        <img
          src={{this.firstImage.uploadedImageUrl}}
          alt=''
          class='atom-thumbnail'
        />
        <span class='atom-count'>{{this.imageCount}}
          {{if (eq this.imageCount 1) 'image' 'images'}}</span>
      {{else}}
        <Grid3x3Icon class='atom-icon' />
        <span>No images</span>
      {{/if}}
    </span>

    <style scoped>
      .multiple-image-atom {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.5rem;
        background: var(--muted, #f1f5f9);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.8125rem;
      }

      .atom-thumbnail {
        width: 1.5rem;
        height: 1.5rem;
        object-fit: cover;
        border-radius: calc(var(--radius, 0.375rem) * 0.5);
        flex-shrink: 0;
      }

      .atom-count {
        color: var(--foreground, #1a1a1a);
        font-weight: 500;
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

class MultipleImageFieldEmbedded extends Component<typeof MultipleImageField> {
  get hasImages(): boolean {
    return !!(this.args.model?.images && this.args.model.images.length > 0);
  }

  get variant(): ImageVariant {
    return this.args.configuration?.variant || 'list';
  }

  get presentation(): ImagePresentation {
    return this.args.configuration?.presentation || 'grid';
  }

  <template>
    <div
      class='multiple-image-embedded variant-{{this.variant}}
        presentation-{{this.presentation}}'
    >
      {{#if this.hasImages}}
        {{#if (eq this.presentation 'carousel')}}
          <CarouselPresentation @images={{@model.images}} />
        {{else}}
          <GridPresentation @images={{@model.images}} />
        {{/if}}
      {{else}}
        <div class='no-images'>
          <CameraIcon class='camera-icon' />
          <span>No images</span>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .multiple-image-embedded {
        width: 100%;
        min-height: 8rem;
      }

      .no-images {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 8rem;
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
}

// Actual MultipleImageField class definition
export class MultipleImageField extends FieldDef {
  static displayName = 'Multiple Images';
  static icon = Grid3x3Icon;

  @field images = containsMany(ImageField);

  static embedded = MultipleImageFieldEmbedded;
  static atom = MultipleImageFieldAtom;
  static edit = MultipleImageFieldEdit;
}

export default MultipleImageField;
