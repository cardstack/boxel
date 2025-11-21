// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { eq, gt, and, not } from '@cardstack/boxel-ui/helpers'; // ¹ Helper imports
import { fn } from '@ember/helper';
import GripVerticalIcon from '@cardstack/boxel-icons/grip-vertical';
import {
  FieldDef,
  Component,
  field,
  containsMany,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency'; // ² Async task management
import UploadIcon from '@cardstack/boxel-icons/upload';
import XIcon from '@cardstack/boxel-icons/x';
import Grid3x3Icon from '@cardstack/boxel-icons/grid-3x3';
import CameraIcon from '@cardstack/boxel-icons/camera';
import { Button } from '@cardstack/boxel-ui/components'; // ³ Upload button
import {
  SortableGroupModifier as sortableGroup,
  SortableHandleModifier as sortableHandle,
  SortableItemModifier as sortableItem,
} from '@cardstack/boxel-ui/modifiers';
import { uuidv4 } from '@cardstack/runtime-common';
import ImageField from './image-field'; // ⁴ Base ImageField with uploadUrl/uploadedImageUrl
import {
  requestCloudflareUploadUrl,
  uploadFileToCloudflare,
} from './util/cloudflare-upload'; // ⁵ Cloudflare upload utilities

// ⁶ Configuration interface
export interface MultipleImageFieldConfiguration {
  variant?: 'list' | 'gallery';
  presentation?: 'default' | 'compact' | 'featured';
  options?: {
    autoUpload?: boolean; // Auto-upload after file selection
    allowReorder?: boolean; // Allow drag-drop reordering
    allowBatchSelect?: boolean; // Allow batch selection and delete (default true)
    maxFiles?: number; // Max number of files (default 10)
  };
}

// ⁷ ImageItem extends ImageField (has uploadUrl/uploadedImageUrl)
class ImageItem extends ImageField {
  @field id = contains(StringField); // Unique ID for tracking
}

// ⁸ Upload entry for local preview before upload
interface UploadEntry {
  id: string;
  file: File;
  preview: string; // Local base64 preview
  uploadedImageUrl?: string; // Cloudflare CDN URL
  selected?: boolean; // Batch selection state
}

class MultipleImageFieldEdit extends Component<typeof MultipleImageField> {
  @tracked uploadEntries: UploadEntry[] = []; // ⁹ Local preview entries
  @tracked errorMessage = ''; // ¹⁰ Upload error messages
  @tracked selectAll = false; // ³⁸ Select all checkbox state
  private sortableGroupId = uuidv4(); // ¹¹ Unique ID for sortable

  constructor(owner: any, args: any) {
    super(owner, args);
    // ¹² Load existing uploaded images
    const existingImages = Array.isArray(this.args.model?.images)
      ? this.args.model.images
      : [];
    if (existingImages.length) {
      this.uploadEntries = existingImages.map((img: ImageItem) =>
        this.createEntryFromExisting(img),
      );
    }
  }

  // ¹³ Configuration getters
  get variant(): 'list' | 'gallery' {
    return (
      (this.args.configuration as MultipleImageFieldConfiguration)?.variant ||
      'list'
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
    return this.options.allowBatchSelect !== false; // ³⁹ Default to true
  }

  get maxFiles() {
    return this.options.maxFiles || 10;
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

  get sortableDirection(): 'x' | 'y' | 'grid' {
    return this.variant === 'gallery' ? 'grid' : 'y';
  }

  // ¹⁴ State getters
  get hasImages() {
    return this.uploadEntries.length > 0;
  }

  get maxFilesReached() {
    return this.uploadEntries.length >= this.maxFiles;
  }

  get hasPendingUploads() {
    return this.uploadEntries.some((entry) => !entry.uploadedImageUrl);
  }

  get showUploadButton() {
    return this.hasImages && !this.autoUpload;
  }

  get uploadButtonLabel() {
    if (this.bulkUploadTask.isRunning) {
      return 'Uploading...';
    }
    return this.hasPendingUploads ? 'Upload All to Cloudflare' : 'Uploaded';
  }

  get uploadButtonDisabled() {
    return this.bulkUploadTask.isRunning || !this.hasPendingUploads;
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

  // ¹⁵ Process selected files
  async processFiles(files: File[]) {
    if (!files.length) return;

    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const remainingSlots = this.maxFiles - this.uploadEntries.length;
    const filesToAdd = imageFiles.slice(0, remainingSlots);

    // ¹⁶ Create preview for each file
    for (const file of filesToAdd) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const entry = this.createEntry(file, reader.result as string);
        this.uploadEntries = [...this.uploadEntries, entry];

        // ¹⁷ Auto-upload if enabled
        if (this.autoUpload) {
          this.bulkUploadTask.perform();
        }
      };
      reader.readAsDataURL(file);
    }
  }

  // ¹⁸ Create upload entry from file
  createEntry(file: File, preview: string): UploadEntry {
    return {
      id: `${Date.now()}-${Math.random()}`,
      file,
      preview,
      selected: false, // ⁴⁰ Initialize selection state
    };
  }

  // ¹⁹ Create entry from existing ImageItem
  createEntryFromExisting(img: ImageItem): UploadEntry {
    const fileLike = {
      name: 'uploaded-image',
      size: 0,
      type: 'image/jpeg',
    } as File;

    return {
      id: img.id || `${Date.now()}-${Math.random()}`,
      file: fileLike,
      preview: img.uploadedImageUrl || '',
      uploadedImageUrl: img.uploadedImageUrl,
      selected: false, // ⁴¹ Initialize selection state
    };
  }

  @action
  removeImage(id: string) {
    // ²⁰ Remove entry from local preview
    this.uploadEntries = this.uploadEntries.filter((entry) => entry.id !== id);
    this.errorMessage = '';

    // ²¹ Update model if any uploads exist
    if (this.uploadEntries.some((entry) => entry.uploadedImageUrl)) {
      this.persistEntries();
    } else {
      this.args.model.images = [];
    }
  }

  @action
  handleReorder(reorderedEntries: UploadEntry[]) {
    // ²² Reorder entries
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
    // ⁴² Toggle select all
    this.selectAll = !this.selectAll;
    this.uploadEntries = this.uploadEntries.map((entry) => ({
      ...entry,
      selected: this.selectAll,
    }));
  }

  @action
  toggleSelection(id: string) {
    // ⁴³ Toggle individual selection
    this.uploadEntries = this.uploadEntries.map((entry) =>
      entry.id === id ? { ...entry, selected: !entry.selected } : entry,
    );
    this.selectAll = this.uploadEntries.every((entry) => entry.selected);
  }

  @action
  deleteSelected() {
    // ⁴⁴ Delete all selected images
    this.uploadEntries = this.uploadEntries.filter((entry) => !entry.selected);
    this.selectAll = false;
    this.errorMessage = '';

    if (this.uploadEntries.some((entry) => entry.uploadedImageUrl)) {
      this.persistEntries();
    } else {
      this.args.model.images = [];
    }
  }

  // ²³ Save uploaded images to model
  persistEntries() {
    this.args.model.images = [];

    this.uploadEntries
      .filter((entry) => entry.uploadedImageUrl)
      .forEach((entry) => {
        const imageItem = new ImageItem();
        imageItem.id = entry.id;
        imageItem.uploadedImageUrl = entry.uploadedImageUrl;
        this.args.model.images.push(imageItem);
      });
  }

  // ²⁴ Bulk upload task - uploads all pending images
  bulkUploadTask = restartableTask(async () => {
    const pendingEntries = this.uploadEntries.filter(
      (entry) => !entry.uploadedImageUrl,
    );

    if (pendingEntries.length === 0) {
      return;
    }

    const errorMessages: string[] = [];

    // ²⁵ Upload each image individually
    for (const entry of pendingEntries) {
      try {
        // ²⁶ Step 1: Get Cloudflare upload URL
        const uploadUrl = await requestCloudflareUploadUrl(
          this.args.context?.commandContext,
          { source: 'boxel-multiple-image-field' },
        );

        // ²⁷ Step 2: Upload to Cloudflare
        const imageUrl = await uploadFileToCloudflare(uploadUrl, entry.file);

        // ²⁸ Save CDN URL
        entry.uploadedImageUrl = imageUrl;
      } catch (error: any) {
        // ²⁹ Collect error for this image
        const cleanError = (error.message || String(error))
          .replace(/\n/g, ' ')
          .trim();
        errorMessages.push(`${entry.file.name}: ${cleanError}`);
      }
    }

    // ³⁰ Trigger reactivity and persist
    this.uploadEntries = [...this.uploadEntries];
    this.persistEntries();

    // ³¹ Show errors if any failed
    if (errorMessages.length > 0) {
      this.errorMessage = `Upload failed for ${
        errorMessages.length
      } image(s):\n${errorMessages.join('\n')}`;
    } else {
      this.errorMessage = '';
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
      {{! ³² Upload trigger }}
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

      {{! ³³ Image list }}
      {{#if (gt this.uploadEntries.length 0)}}
        {{! ⁴⁵ Batch actions header }}
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
            {{! ³⁴ Gallery variant }}
            {{#if (eq this.variant 'gallery')}}
              <div
                class='gallery-item {{if entry.selected "is-selected"}}'
                {{sortableItem
                  groupName=this.sortableGroupId
                  model=entry
                  disabled=this.sortableDisabled
                }}
              >
                {{! ⁴⁶ Gallery checkbox }}
                {{#if this.allowBatchSelect}}
                  <div class='item-checkbox-gallery'>
                    <input
                      type='checkbox'
                      checked={{entry.selected}}
                      {{on 'change' (fn this.toggleSelection entry.id)}}
                      data-test-item-checkbox
                    />
                  </div>
                {{/if}}

                {{#if this.allowReorder}}
                  <div class='drag-handle' {{sortableHandle}}></div>
                {{/if}}
                <img
                  src={{if
                    entry.uploadedImageUrl
                    entry.uploadedImageUrl
                    entry.preview
                  }}
                  alt='Image'
                  class='gallery-image'
                />
                <button
                  type='button'
                  {{on 'click' (fn this.removeImage entry.id)}}
                  class='gallery-remove'
                >
                  <XIcon class='remove-icon' />
                </button>
              </div>
              {{! ³⁵ List variant }}
            {{else}}
              <div
                class='list-item {{if entry.selected "is-selected"}}'
                {{sortableItem
                  groupName=this.sortableGroupId
                  model=entry
                  disabled=this.sortableDisabled
                }}
              >
                {{! ⁴⁷ List checkbox }}
                {{#if this.allowBatchSelect}}
                  <input
                    type='checkbox'
                    class='list-checkbox'
                    checked={{entry.selected}}
                    {{on 'change' (fn this.toggleSelection entry.id)}}
                    data-test-item-checkbox
                  />
                {{/if}}

                {{#if this.allowReorder}}
                  <GripVerticalIcon class='grip-icon' />
                  <div class='drag-handle' {{sortableHandle}}></div>
                {{/if}}
                <img
                  src={{if
                    entry.uploadedImageUrl
                    entry.uploadedImageUrl
                    entry.preview
                  }}
                  alt='Image'
                  class='list-image'
                />
                <div class='list-info'>
                  <div class='list-name'>{{entry.file.name}}</div>
                  <div class='list-size'>{{this.formatSize
                      entry.file.size
                    }}</div>
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

      {{! ³⁶ Upload button (only shown when not auto-upload) }}
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

      {{! ³⁷ Error message display }}
      {{#if this.errorMessage}}
        <div class='error-message' data-test-error-message>
          {{this.errorMessage}}
        </div>
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
        border: 2px dashed var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        background: var(--input, #ffffff);
        cursor: pointer;
        transition: all 0.2s ease;
        padding: 1rem;
      }

      .upload-trigger:hover {
        border-color: var(--primary, #3b82f6);
        background: var(--accent, #f0f9ff);
      }

      .upload-trigger.variant-gallery {
        border-color: var(--primary, #3b82f6);
        background: rgba(59, 130, 246, 0.05);
      }

      .upload-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .upload-text {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
      }

      .upload-trigger.disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
        white-space: pre-wrap;
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

      .list-image {
        width: 4rem;
        height: 4rem;
        object-fit: cover;
        border-radius: var(--radius, 0.375rem);
        flex-shrink: 0;
      }

      .list-info {
        flex: 1;
        min-width: 0;
      }

      .list-name {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .list-size {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin-top: 0.125rem;
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
    </style>
  </template>
}

export class MultipleImageField extends FieldDef {
  static displayName = 'Multiple Images';
  static icon = Grid3x3Icon;

  @field images = containsMany(ImageItem);

  static embedded = class Embedded extends Component<typeof this> {
    get hasImages(): boolean {
      return this.args.model?.images && this.args.model.images.length > 0;
    }

    get presentation(): string {
      return (
        (this.args.configuration as MultipleImageFieldConfiguration)
          ?.presentation || 'default'
      );
    }

    <template>
      <div class='multiple-image-embedded presentation-{{this.presentation}}'>
        {{#if this.hasImages}}
          <div class='images-grid'>
            {{#each @model.images as |image|}}
              <img
                src={{image.uploadedImageUrl}}
                alt='Image'
                class='grid-image'
              />
            {{/each}}
          </div>
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

        .images-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr));
          gap: 0.5rem;
        }

        .grid-image {
          width: 100%;
          aspect-ratio: 1;
          object-fit: cover;
          border-radius: var(--radius, 0.375rem);
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
  };

  static atom = class Atom extends Component<typeof this> {
    get imageCount(): number {
      return this.args.model?.images?.length || 0;
    }

    get firstImage(): ImageItem | undefined {
      return this.args.model?.images?.[0];
    }

    <template>
      <span class='multiple-image-atom'>
        {{#if this.firstImage}}
          <img
            src={{this.firstImage.uploadedImageUrl}}
            alt='Image'
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
  };

  static edit = MultipleImageFieldEdit;
}

export default MultipleImageField;
