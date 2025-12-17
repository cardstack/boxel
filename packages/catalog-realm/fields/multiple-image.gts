import { eq } from '@cardstack/boxel-ui/helpers';
import { htmlSafe } from '@ember/template';

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

import { SortableGroupModifier } from '@cardstack/boxel-ui/modifiers';

import { realmURL as realmURLSymbol, uuidv4 } from '@cardstack/runtime-common';

import ImageField from './image';

import UploadImageCommand from '../commands/upload-image';

import MultipleImageGalleryUpload from './multiple-image/components/multiple-image-gallery-upload';
import MultipleImageDropzoneUpload from './multiple-image/components/multiple-image-dropzone-upload';
import MultipleImageGalleryPreview from './multiple-image/components/multiple-image-gallery-preview';
import MultipleImageDropzonePreview from './multiple-image/components/multiple-image-dropzone-preview';
import GridPresentation from './multiple-image/components/grid-presentation';
import CarouselPresentation from './multiple-image/components/carousel-presentation';
import type { UploadEntry, UploadStatus } from './multiple-image/image-upload-types';

// Type definitions
type ImageInputVariant = 'list' | 'gallery' | 'dropzone';
type ImagePresentationType = 'standard' | 'grid' | 'carousel';
type SortableDirection = 'x' | 'y' | 'grid';

// Configuration interface
interface MultipleImageFieldConfiguration {
  variant?: ImageInputVariant;
  presentation?: ImagePresentationType;
  options?: {
    autoUpload?: boolean; // Auto-upload after file selection
    allowReorder?: boolean; // Allow drag-drop reordering
    allowBatchSelect?: boolean; // Allow batch selection and delete (default true)
    maxFiles?: number; // Max number of files (default 10)
    showProgress?: boolean; // Show progress during file reading (default: true)
  };
}

class MultipleImageFieldEdit extends Component<typeof MultipleImageField> {
  @tracked uploadEntries: UploadEntry[] = []; // Local preview entries
  @tracked uploadStatus: UploadStatus | 'idle' = 'idle'; // Upload status for notification
  @tracked uploadStatusMessage = ''; // Upload status message
  @tracked selectAll = false; // Select all checkbox state
  private sortableGroupId = uuidv4(); // Unique ID for sortable

  getProgressStyle(progress: number) {
    return htmlSafe(`width: ${progress}%`);
  }

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
  get variant(): ImageInputVariant {
    return (
      (this.args.configuration as MultipleImageFieldConfiguration)?.variant ||
      'list'
    );
  }

  get presentation(): ImagePresentationType {
    const presentation =
      (this.args.configuration as MultipleImageFieldConfiguration)
        ?.presentation || 'standard';
    return presentation === 'standard' ? 'grid' : presentation;
  }

  get options() {
    return (
      (this.args.configuration as MultipleImageFieldConfiguration)?.options ||
      {}
    );
  }

  get autoUpload() {
    return this.options.autoUpload !== false; // Default to true
  }

  get allowReorder() {
    return this.options.allowReorder !== false; // Default to true
  }

  get allowBatchSelect() {
    return this.options.allowBatchSelect !== false; // Default to true
  }

  get maxFiles() {
    return this.options.maxFiles || 10;
  }

  get showProgress() {
    return this.options.showProgress !== false; // Default to true
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
      (entry) => !entry.url || entry.uploadStatus === 'error',
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
    // Extract filename from url
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

    const filename = extractFilename(img.url);
    const fileLike = {
      name: filename,
      size: 0,
      type: 'image/jpeg',
    } as File;

    return {
      id: `${Date.now()}-${Math.random()}`,
      file: fileLike,
      preview: img.url || '',
      url: img.url,
      selected: false, // Initialize selection state
      uploadStatus: img.url ? 'success' : undefined, // Mark existing uploads as success
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
    if (this.uploadEntries.some((entry) => entry.url)) {
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
        (entry) => entry.url && entry.uploadStatus !== 'error',
      )
      .forEach((entry) => {
        const imageField = new ImageField();
        imageField.imageUrl = entry.url!; // Safe to use ! since we filtered for entries with url
        if (this.args.model.images) {
          this.args.model.images.push(imageField);
        }
      });
  }

  // Bulk upload task - uploads all pending images and retries errors
  bulkUploadTask = restartableTask(async () => {
    // Include entries without url OR entries with error status (for retry)
    const pendingEntries = this.uploadEntries.filter(
      (entry) => !entry.url || entry.uploadStatus === 'error',
    );

    if (pendingEntries.length === 0) {
      return;
    }

    // Set pending status
    this.uploadStatus = 'pending';
    this.uploadStatusMessage = 'Uploading images...';

    const errorMessages: string[] = [];
    const commandContext = this.args.context?.commandContext;
    const realmHref = this.args.model?.[realmURLSymbol]?.href;

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

        const uploadCommand = new UploadImageCommand(commandContext);
        const result = await uploadCommand.execute({
          sourceImageUrl: entry.preview,
          targetRealmUrl: realmHref,
        });

        if (!result?.cardId) {
          throw new Error('Upload succeeded but no card id was returned');
        }

        let uploadedUrl = entry.preview;
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

        // Update entry with success status - update immutably for live reactivity
        // This triggers immediate UI update with green border
        this.uploadEntries = this.uploadEntries.map((e) =>
          e.id === entryId
            ? {
                ...e,
                url: uploadedUrl,
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
      {{#if this.hasImages}}
        {{#if (eq this.variant 'gallery')}}
          <MultipleImageGalleryUpload
            @onFileSelect={{this.handleFileSelect}}
            @onDragOver={{this.handleDragOver}}
            @onDrop={{this.handleDrop}}
            @maxFilesReached={{this.maxFilesReached}}
            @currentCount={{this.uploadEntries.length}}
            @maxFiles={{this.maxFiles}}
          />
        {{else}}
          <MultipleImageDropzoneUpload
            @onFileSelect={{this.handleFileSelect}}
            @onDragOver={{this.handleDragOver}}
            @onDrop={{this.handleDrop}}
            @maxFilesReached={{this.maxFilesReached}}
            @currentCount={{this.uploadEntries.length}}
            @maxFiles={{this.maxFiles}}
            @variant={{this.variant}}
          />
        {{/if}}

        {{! Image preview display }}
        <div
          class='images-container variant-{{this.variant}}'
          {{SortableGroupModifier
            groupName=this.sortableGroupId
            onChange=this.handleReorder
            disabled=this.sortableDisabled
            direction=this.sortableDirection
          }}
        >
          {{! Batch actions header (inside preview container) }}
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
                  <span>Delete ({{this.selectedCount}})</span>
                </button>
              {{/if}}
            </div>
          {{/if}}

          {{#each this.uploadEntries as |entry|}}
            {{#if (eq this.variant 'gallery')}}
              <MultipleImageGalleryPreview
                @entry={{entry}}
                @allowBatchSelect={{this.allowBatchSelect}}
                @allowReorder={{this.allowReorder}}
                @sortableGroupId={{this.sortableGroupId}}
                @sortableDisabled={{this.sortableDisabled}}
                @onRemove={{this.removeImage}}
                @onToggleSelection={{this.toggleSelection}}
                @getProgressStyle={{this.getProgressStyle}}
              />
            {{else}}
              <MultipleImageDropzonePreview
                @entry={{entry}}
                @allowBatchSelect={{this.allowBatchSelect}}
                @allowReorder={{this.allowReorder}}
                @sortableGroupId={{this.sortableGroupId}}
                @sortableDisabled={{this.sortableDisabled}}
                @onRemove={{this.removeImage}}
                @onToggleSelection={{this.toggleSelection}}
                @getProgressStyle={{this.getProgressStyle}}
                @formatSize={{this.formatSize}}
              />
            {{/if}}
          {{/each}}
        </div>
      {{else}}
        {{! Upload trigger (shown when no images and not maxed) }}
        {{#unless this.maxFilesReached}}
          {{#if (eq this.variant 'gallery')}}
            <MultipleImageGalleryUpload
              @onFileSelect={{this.handleFileSelect}}
              @onDragOver={{this.handleDragOver}}
              @onDrop={{this.handleDrop}}
              @maxFilesReached={{this.maxFilesReached}}
              @currentCount={{this.uploadEntries.length}}
              @maxFiles={{this.maxFiles}}
            />
          {{else}}
            <MultipleImageDropzoneUpload
              @onFileSelect={{this.handleFileSelect}}
              @onDragOver={{this.handleDragOver}}
              @onDrop={{this.handleDrop}}
              @maxFilesReached={{this.maxFilesReached}}
              @currentCount={{this.uploadEntries.length}}
              @maxFiles={{this.maxFiles}}
              @variant={{this.variant}}
            />
          {{/if}}
        {{/unless}}
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
        max-width: 100%;
        box-sizing: border-box;
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
        gap: calc(var(--spacing, 0.25rem) * 2);
        width: 100%;
        min-height: 4rem;
        border: 2px dashed var(--primary, #3b82f6);
        border-radius: var(--radius, 0.5rem);
        background: color-mix(in srgb, var(--primary, #3b82f6) 5%, transparent);
        cursor: pointer;
        transition: all 0.2s ease;
        padding: calc(var(--spacing, 0.25rem) * 4);
      }

      .upload-trigger:hover {
        border-color: var(--accent, #60a5fa);
        background: color-mix(
          in srgb,
          var(--primary, #3b82f6) 10%,
          transparent
        );
      }

      .upload-trigger.variant-gallery,
      .upload-trigger.variant-dropzone {
        border-color: var(--primary, #3b82f6);
        background: color-mix(in srgb, var(--primary, #3b82f6) 5%, transparent);
      }

      .upload-trigger.variant-dropzone {
        flex-direction: column;
        min-height: 8rem;
      }

      .upload-trigger.variant-dropzone:hover {
        border-color: var(--accent, #60a5fa);
        background: color-mix(
          in srgb,
          var(--primary, #3b82f6) 10%,
          transparent
        );
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

      .batch-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        background: var(--background, #ffffff);
        grid-column: 1 / -1; /* Span full width in grid layout */
        margin-bottom: calc(var(--spacing, 0.25rem) * 1);
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
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        justify-content: center;
      }
      .delete-selected-button:hover {
        background: var(--destructive, #dc2626);
        opacity: 0.9;
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
        <img src={{this.firstImage.url}} alt='' class='atom-thumbnail' />
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

  get variant(): ImageInputVariant {
    return this.args.configuration?.variant || 'list';
  }

  get presentation(): ImagePresentationType {
    const presentation = this.args.configuration?.presentation || 'standard';
    return presentation === 'standard' ? 'grid' : presentation;
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
      }

      .no-images {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: calc(var(--spacing, 0.25rem) * 8);
        background: var(--muted, #f1f5f9);
        border-radius: var(--radius, 0.375rem);
        color: var(--muted-foreground, #9ca3af);
        font-size: 0.875rem;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }

      .camera-icon {
        width: 2rem;
        height: 2rem;
      }
    </style>
  </template>
}

// Actual MultipleImageField class definition
export default class MultipleImageField extends FieldDef {
  static displayName = 'Multiple Images';
  static icon = Grid3x3Icon;

  @field images = containsMany(ImageField);

  static embedded = MultipleImageFieldEmbedded;
  static atom = MultipleImageFieldAtom;
  static edit = MultipleImageFieldEdit;
}
