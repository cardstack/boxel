import { Component } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { Button } from '@cardstack/boxel-ui/components';
import NotificationBubble from '../../../../components/notification-bubble';
import { SortableGroupModifier } from '@cardstack/boxel-ui/modifiers';
import { uuidv4 } from '@cardstack/runtime-common';
import XIcon from '@cardstack/boxel-icons/x';
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from '../../util/cloudflare-upload';
import CollectionUpload from './collection-upload';
import CollectionPreview from './collection-preview';
import ImageField from '../../image-field';
import type {
  ImageFieldConfiguration,
  ImageCollectionOptions,
} from '../../image-field';

type ImageCollectionVariant = 'list' | 'gallery' | 'dropzone';
type UploadStatus = 'idle' | 'pending' | 'success' | 'error';
type SortableDirection = 'x' | 'y' | 'grid';

interface UploadEntry {
  id: string;
  file: File;
  preview: string;
  uploadedImageUrl?: string;
  selected?: boolean;
  readProgress?: number;
  isReading?: boolean;
  isUploading?: boolean;
  uploadStatus?: UploadStatus;
  uploadError?: string;
}

export default class CollectionImageFieldEdit extends Component<
  typeof ImageField
> {
  @tracked uploadEntries: UploadEntry[] = [];
  @tracked selectAll = false;
  @tracked uploadStatus: UploadStatus = 'idle';
  @tracked uploadStatusMessage = '';
  private sortableGroupId = '';

  constructor(owner: any, args: any) {
    super(owner, args);
    this.sortableGroupId = uuidv4();
    this.loadCollectionEntries();
  }

  get parentArray(): ImageField[] | undefined {
    const model = this.args.model as any;
    const parent = model.state?.containingBox;
    if (parent) {
      const parentValue = parent.value;
      if (Array.isArray(parentValue)) {
        return parentValue as ImageField[];
      }
    }
    return undefined;
  }

  get collectionVariant(): ImageCollectionVariant {
    const config = this.args.configuration as ImageFieldConfiguration;
    if (
      config &&
      'variant' in config &&
      ['list', 'gallery', 'dropzone'].includes(config.variant as string)
    ) {
      return config.variant as ImageCollectionVariant;
    }
    return 'list';
  }

  get collectionOptions(): ImageCollectionOptions {
    const config = this.args.configuration as ImageFieldConfiguration;
    if (config && 'options' in config) {
      const opts = config.options;
      if (
        opts &&
        ('allowReorder' in opts ||
          'allowBatchSelect' in opts ||
          'maxFiles' in opts)
      ) {
        return opts as ImageCollectionOptions;
      }
    }
    return {};
  }

  get collectionAutoUpload() {
    return this.collectionOptions.autoUpload !== false;
  }

  get collectionAllowReorder() {
    return this.collectionOptions.allowReorder === true;
  }

  get collectionAllowBatchSelect() {
    return this.collectionOptions.allowBatchSelect !== false;
  }

  get collectionMaxFiles() {
    return this.collectionOptions.maxFiles || 10;
  }

  get collectionShowProgress() {
    return this.collectionOptions.showProgress === true;
  }

  get hasCollectionImages() {
    return this.uploadEntries.length > 0;
  }

  get collectionMaxFilesReached() {
    return this.uploadEntries.length >= this.collectionMaxFiles;
  }

  get hasPendingCollectionUploads() {
    return this.uploadEntries.some(
      (entry) => !entry.uploadedImageUrl || entry.uploadStatus === 'error',
    );
  }

  get hasErrorCollectionImages() {
    return this.uploadEntries.some((entry) => entry.uploadStatus === 'error');
  }

  get showCollectionUploadButton() {
    return this.hasCollectionImages && !this.collectionAutoUpload;
  }

  get collectionUploadButtonLabel() {
    if (this.bulkUploadTask.isRunning) {
      return 'Uploading...';
    }
    if (this.hasErrorCollectionImages && this.hasPendingCollectionUploads) {
      return 'Retry Failed & Upload All';
    }
    if (this.hasErrorCollectionImages) {
      return 'Retry Failed Uploads';
    }
    return this.hasPendingCollectionUploads
      ? 'Upload All to Cloudflare'
      : 'Uploaded';
  }

  get collectionUploadButtonDisabled() {
    return this.bulkUploadTask.isRunning || !this.hasPendingCollectionUploads;
  }

  get hasCollectionSelection() {
    return this.uploadEntries.some((entry) => entry.selected);
  }

  get selectedCollectionCount() {
    return this.uploadEntries.filter((entry) => entry.selected).length;
  }

  get sortableDisabled() {
    return !this.collectionAllowReorder;
  }

  get sortableDirection(): SortableDirection {
    return this.collectionVariant === 'gallery' ? 'grid' : 'y';
  }

  get showNotification() {
    return !!(this.uploadStatusMessage && this.uploadStatus !== 'idle');
  }

  loadCollectionEntries() {
    const array = this.parentArray;
    if (!array) return;
    this.uploadEntries = array
      .filter((img) => img?.uploadedImageUrl)
      .map((img) => this.createEntryFromExisting(img));
  }

  createEntryFromExisting(img: ImageField): UploadEntry {
    const extractFilename = (url: string | undefined): string => {
      if (!url) return 'uploaded-image';
      try {
        const urlParts = url.split('/');
        const filename = urlParts[urlParts.length - 2] || 'uploaded-image';
        return filename;
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
      selected: false,
      uploadStatus: img.uploadedImageUrl ? 'success' : undefined,
    };
  }

  getProgressStyle(entry: UploadEntry) {
    const progress = entry.readProgress || 0;
    return `width: ${progress}%`;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  @action
  handleDragOver(event: DragEvent) {
    event.preventDefault();
  }

  @action
  async handleCollectionFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    await this.processCollectionFiles(files);
    input.value = '';
  }

  @action
  handleCollectionDrop(event: DragEvent) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []);
    this.processCollectionFiles(files);
  }

  async processCollectionFiles(files: File[]) {
    if (!files.length) return;

    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const remainingSlots = this.collectionMaxFiles - this.uploadEntries.length;
    const filesToAdd = imageFiles.slice(0, remainingSlots);

    for (const file of filesToAdd) {
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
      let progressInterval: number | undefined;
      if (this.collectionShowProgress) {
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

        if (this.collectionShowProgress) {
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

        this.uploadEntries = this.uploadEntries.map((e) =>
          e.id === entry.id
            ? { ...e, preview: reader.result as string, isReading: false }
            : e,
        );

        if (this.collectionAutoUpload) {
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

  @action
  removeCollectionImage(id: string) {
    this.uploadEntries = this.uploadEntries.filter((entry) => entry.id !== id);
    this.uploadStatus = 'idle';
    this.uploadStatusMessage = '';
    this.persistCollectionEntries();
  }

  @action
  handleCollectionReorder(reorderedEntries: UploadEntry[]) {
    this.uploadEntries = reorderedEntries;
    if (this.uploadEntries.some((entry) => entry.uploadedImageUrl)) {
      this.persistCollectionEntries();
    }
  }

  @action
  toggleCollectionSelectAll() {
    this.selectAll = !this.selectAll;
    this.uploadEntries = this.uploadEntries.map((entry) => ({
      ...entry,
      selected: this.selectAll,
    }));
  }

  @action
  toggleCollectionSelection(id: string) {
    this.uploadEntries = this.uploadEntries.map((entry) =>
      entry.id === id ? { ...entry, selected: !entry.selected } : entry,
    );
    this.selectAll = this.uploadEntries.every((entry) => entry.selected);
  }

  @action
  deleteCollectionSelected() {
    this.uploadEntries = this.uploadEntries.filter((entry) => !entry.selected);
    this.selectAll = false;
    this.uploadStatus = 'idle';
    this.uploadStatusMessage = '';
    this.persistCollectionEntries();
  }

  persistCollectionEntries() {
    const array = this.parentArray;
    if (!array) return;

    array.length = 0;
    this.uploadEntries
      .filter(
        (entry) => entry.uploadedImageUrl && entry.uploadStatus !== 'error',
      )
      .forEach((entry) => {
        const imageField = new ImageField();
        if (entry.uploadedImageUrl) {
          imageField.uploadedImageUrl = entry.uploadedImageUrl;
          array.push(imageField);
        }
      });
  }

  bulkUploadTask = restartableTask(async () => {
    const pendingEntries = this.uploadEntries.filter(
      (entry) => !entry.uploadedImageUrl || entry.uploadStatus === 'error',
    );

    if (pendingEntries.length === 0) {
      return;
    }

    this.uploadStatus = 'pending';
    this.uploadStatusMessage = 'Uploading images...';

    const errorMessages: string[] = [];

    for (const entry of pendingEntries) {
      const entryId = entry.id;
      const entryFile = entry.file;

      try {
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

        const uploadUrl = await requestCloudflareUploadUrl(
          this.args.context?.commandContext,
          { source: 'boxel-image-field' },
        );

        const imageUrl = await uploadFileToCloudflare(uploadUrl, entryFile);

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
        const cleanError = (error.message || String(error))
          .replace(/\n/g, ' ')
          .trim();
        errorMessages.push(`${entryFile.name}: ${cleanError}`);

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

    this.persistCollectionEntries();

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

      setTimeout(() => {
        if (this.uploadStatus === 'success') {
          this.uploadStatus = 'idle';
          this.uploadStatusMessage = '';
        }
      }, 3000);
    }
  });

  <template>
    <div
      class='image-field-edit multiple-image-field-edit variant-{{this.collectionVariant}}'
      data-test-image-field-edit
      data-test-multiple-image-field
    >
      {{#if this.hasCollectionImages}}
        <CollectionUpload
          @variant={{this.collectionVariant}}
          @onFileSelect={{this.handleCollectionFileSelect}}
          @onDragOver={{this.handleDragOver}}
          @onDrop={{this.handleCollectionDrop}}
          @maxFilesReached={{this.collectionMaxFilesReached}}
          @currentCount={{this.uploadEntries.length}}
          @maxFiles={{this.collectionMaxFiles}}
        />

        <div
          class='images-container variant-{{this.collectionVariant}}'
          {{SortableGroupModifier
            groupName=this.sortableGroupId
            onChange=this.handleCollectionReorder
            disabled=this.sortableDisabled
            direction=this.sortableDirection
          }}
        >
          {{#if this.collectionAllowBatchSelect}}
            <div class='batch-actions'>
              <label class='select-all-label'>
                <input
                  type='checkbox'
                  class='select-all-checkbox'
                  checked={{this.selectAll}}
                  {{on 'change' this.toggleCollectionSelectAll}}
                  data-test-select-all
                />
                <span>Select All</span>
              </label>
              {{#if this.hasCollectionSelection}}
                <button
                  type='button'
                  class='delete-selected-button'
                  {{on 'click' this.deleteCollectionSelected}}
                  data-test-delete-selected
                >
                  <XIcon class='delete-icon' />
                  Delete ({{this.selectedCollectionCount}})
                </button>
              {{/if}}
            </div>
          {{/if}}

          {{#each this.uploadEntries as |entry|}}
            <CollectionPreview
              @variant={{this.collectionVariant}}
              @entry={{entry}}
              @allowBatchSelect={{this.collectionAllowBatchSelect}}
              @allowReorder={{this.collectionAllowReorder}}
              @sortableGroupId={{this.sortableGroupId}}
              @sortableDisabled={{this.sortableDisabled}}
              @onRemove={{this.removeCollectionImage}}
              @onToggleSelection={{this.toggleCollectionSelection}}
              @getProgressStyle={{this.getProgressStyle}}
              @formatSize={{this.formatSize}}
            />
          {{/each}}
        </div>
      {{else}}
        <CollectionUpload
          @variant={{this.collectionVariant}}
          @onFileSelect={{this.handleCollectionFileSelect}}
          @onDragOver={{this.handleDragOver}}
          @onDrop={{this.handleCollectionDrop}}
          @maxFilesReached={{this.collectionMaxFilesReached}}
          @currentCount={{this.uploadEntries.length}}
          @maxFiles={{this.collectionMaxFiles}}
        />
      {{/if}}

      {{#if this.showCollectionUploadButton}}
        <Button
          class='upload-button'
          @kind='primary-dark'
          @size='tall'
          @disabled={{this.collectionUploadButtonDisabled}}
          {{on 'click' this.bulkUploadTask.perform}}
          data-test-bulk-upload-button
        >
          {{this.collectionUploadButtonLabel}}
        </Button>
      {{/if}}

      {{#if this.showNotification}}
        <NotificationBubble
          @type={{this.uploadStatus}}
          @message={{this.uploadStatusMessage}}
        />
      {{/if}}
    </div>

    <style scoped>
      .image-field-edit.multiple-image-field-edit {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .images-container {
        display: grid;
        gap: 0.75rem;
      }

      .images-container.variant-gallery {
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      }

      .images-container.variant-list {
        grid-template-columns: 1fr;
      }

      .images-container.variant-dropzone {
        grid-template-columns: 1fr;
      }

      .batch-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem;
        background: var(--muted, #f1f5f9);
        border-radius: var(--radius, 0.375rem);
        margin-bottom: 0.5rem;
      }

      .select-all-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        font-weight: 500;
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
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }

      .delete-selected-button:hover {
        background: var(--destructive, #dc2626);
        opacity: 0.9;
      }

      .delete-icon {
        width: 1rem;
        height: 1rem;
      }

      .upload-button {
        width: 100%;
      }
    </style>
  </template>
}
