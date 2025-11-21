import { eq, gt } from '@cardstack/boxel-ui/helpers';
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
import UploadIcon from '@cardstack/boxel-icons/upload';
import XIcon from '@cardstack/boxel-icons/x';
import Grid3x3Icon from '@cardstack/boxel-icons/grid-3x3';
import CameraIcon from '@cardstack/boxel-icons/camera';
import Loader2Icon from '@cardstack/boxel-icons/loader-2';
import {
  SortableGroupModifier as sortableGroup,
  SortableHandleModifier as sortableHandle,
  SortableItemModifier as sortableItem,
} from '@cardstack/boxel-ui/modifiers';
import { uuidv4 } from '@cardstack/runtime-common';
import ImageField from './image-field';

export interface MultipleImageFieldConfiguration {
  variant?: 'list' | 'gallery';
  presentation?: 'default' | 'compact' | 'featured';
  options?: {
    showProgress?: boolean;
    allowBatchSelect?: boolean;
    allowReorder?: boolean;
    allowReorderItem?: boolean;
  };
}

class ImageItem extends ImageField {
  @field id = contains(StringField);
}

class MultipleImageFieldEdit extends Component<typeof MultipleImageField> {
  @tracked isUploading = false;
  @tracked uploadProgress = 0;
  @tracked selectedImageIds = new Set<string>();
  // Use a unique group name to avoid cross-instance sortable collisions
  private sortableGroupId = uuidv4();

  get variant(): 'list' | 'gallery' {
    return (
      (this.args.configuration as MultipleImageFieldConfiguration)?.variant ||
      'list'
    );
  }

  get presentation(): string {
    return (
      (this.args.configuration as MultipleImageFieldConfiguration)
        ?.presentation || 'default'
    );
  }

  get options(): NonNullable<MultipleImageFieldConfiguration['options']> {
    return (
      (this.args.configuration as MultipleImageFieldConfiguration)?.options ||
      {}
    );
  }

  get showProgress(): boolean {
    return this.options.showProgress !== false;
  }

  get allowBatchSelect(): boolean {
    return this.options.allowBatchSelect !== false;
  }

  get allowReorderItem(): boolean {
    return this.options.allowReorderItem === true;
  }

  get allowReorder(): boolean {
    return this.options.allowReorder === true || this.allowReorderItem;
  }

  get sortableDisabled(): boolean {
    return !this.allowReorder;
  }

  get sortableDirection(): 'x' | 'y' | 'grid' {
    return this.variant === 'gallery' ? 'grid' : 'y';
  }

  get allSelected(): boolean {
    if (!this.images || this.images.length === 0) {
      return false;
    }
    return this.selectedImageIds.size === this.images.length;
  }

  isSelected(imageId: string): boolean {
    return this.selectedImageIds.has(imageId);
  }

  get images(): ImageItem[] {
    return this.args.model?.images || [];
  }

  @action
  handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);

    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (this.showProgress && imageFiles.length > 0) {
      this.isUploading = true;
      this.uploadProgress = 0;

      let processed = 0;
      const total = imageFiles.length;

      imageFiles.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          this.addImage(result, file.name, file.size);
          processed++;
          this.uploadProgress = Math.floor((processed / total) * 100);

          if (processed === total) {
            setTimeout(() => {
              this.isUploading = false;
              this.uploadProgress = 0;
            }, 500);
          }
        };
        reader.readAsDataURL(file);
      });
    } else {
      imageFiles.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          this.addImage(result, file.name, file.size);
        };
        reader.readAsDataURL(file);
      });
    }
  }

  addImage(imageData: string, fileName: string, fileSize: number): void {
    const newImage = new ImageItem();
    newImage.imageData = imageData;
    newImage.fileName = fileName;
    newImage.fileSize = fileSize.toString();
    newImage.id = Date.now().toString() + Math.random();

    if (!this.args.model.images) {
      this.args.model.images = [];
    }
    this.args.model.images = [...this.args.model.images, newImage];
  }

  @action
  removeImage(imageId: string): void {
    if (!this.args.model.images) return;
    this.args.model.images = this.args.model.images.filter(
      (img: ImageItem) => img.id !== imageId,
    );
  }

  @action
  reorderImages(reorderedImages: ImageItem[]): void {
    this.args.model.images = reorderedImages;
  }

  @action
  toggleSelectAll(): void {
    if (this.allSelected) {
      this.selectedImageIds = new Set();
    } else {
      this.selectedImageIds = new Set(this.images.map((img) => img.id!));
    }
  }

  @action
  toggleImageSelection(imageId: string): void {
    const newSet = new Set(this.selectedImageIds);
    if (newSet.has(imageId)) {
      newSet.delete(imageId);
    } else {
      newSet.add(imageId);
    }
    this.selectedImageIds = newSet;
  }

  @action
  deleteSelected(): void {
    if (!this.args.model.images) return;
    this.args.model.images = this.args.model.images.filter(
      (img) => !this.selectedImageIds.has(img.id!),
    );
    this.selectedImageIds = new Set();
  }

  @action
  handleDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  @action
  handleDrop(event: DragEvent): void {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []);

    const fakeEvent = {
      target: {
        files: files.filter((f) => f.type.startsWith('image/')),
      },
    } as any;

    if (fakeEvent.target.files.length > 0) {
      this.handleFileSelect(fakeEvent);
    }
  }

  formatSize(bytes: string): string {
    const size = Number(bytes);
    if (!size) return '';

    if (size < 1024 * 1024) {
      return (size / 1024).toFixed(1) + ' KB';
    }
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }

  <template>
    <div class='multiple-image-field-edit variant-{{this.variant}}'>
      {{#if this.isUploading}}
        <div class='upload-progress'>
          <div class='progress-header'>
            <Loader2Icon class='spinner' />
            <span class='progress-text'>Uploading images...</span>
            <span class='progress-percent'>{{this.uploadProgress}}%</span>
          </div>
          <div class='progress-bar-container'>
            <div
              class='progress-bar'
              style='width: {{this.uploadProgress}}%'
            ></div>
          </div>
        </div>
      {{/if}}

      <label
        class='upload-trigger variant-{{this.variant}}'
        {{on 'dragover' this.handleDragOver}}
        {{on 'drop' this.handleDrop}}
      >
        {{#if (eq this.variant 'gallery')}}
          <Grid3x3Icon class='upload-icon' />
          <span class='upload-text'>Add to gallery ({{this.images.length}})</span>
        {{else}}
          <UploadIcon class='upload-icon' />
          <span class='upload-text'>Add images ({{this.images.length}})</span>
        {{/if}}
        <input
          type='file'
          class='file-input'
          accept='image/*'
          multiple={{this.allowBatchSelect}}
          {{on 'change' this.handleFileSelect}}
        />
      </label>

      {{!-- {{#if this.allowBatchSelect}}
        <div class='header-actions'>
          <label class='select-all-checkbox'>
            <input
              type='checkbox'
              checked={{this.selectAll}}
              {{on 'change' this.toggleSelectAll}}
              data-test-select-all
            />
            <span>Select All</span>
          </label>
          {{#if this.hasSelection}}
            <button
              type='button'
              class='btn-delete-selected'
              {{on 'click' this.deleteSelected}}
              data-test-delete-selected
            >
              <XIcon class='icon' />
              Delete ({{this.selectedCount}})
            </button>
          {{/if}}
        </div>
      {{/if}} --}}

      {{#if (gt this.images.length 0)}}
        <div
          class='images-container variant-{{this.variant}}'
          {{sortableGroup
            groupName=this.sortableGroupId
            onChange=this.reorderImages
            disabled=this.sortableDisabled
            direction=this.sortableDirection
          }}
        >
          {{#each this.images as |image|}}
            {{#if (eq this.variant 'gallery')}}
              <div
                class='gallery-item'
                {{sortableItem
                  groupName=this.sortableGroupId
                  model=image
                  disabled=this.sortableDisabled
                }}
              >
                {{#if this.allowBatchSelect}}
                  <div class='item-checkbox item-checkbox-gallery'>
                    <input
                      type='checkbox'
                      {{!-- checked={{this.isSelected image.id}}
                      {{on 'change' (fn this.toggleImageSelection image.id)}}
                      data-test-item-checkbox --}}
                    />
                  </div>
                {{/if}}
                {{#if this.allowReorder}}
                  <div class='drag-handle' {{sortableHandle}}>
                  </div>
                {{/if}}
                <img
                  src={{image.imageData}}
                  alt={{image.fileName}}
                  class='gallery-image'
                />
                <button
                  type='button'
                  {{on 'click' (fn this.removeImage image.id)}}
                  class='gallery-remove'
                >
                  <XIcon class='remove-icon' />
                </button>
              </div>
            {{else}}
              <div
                class='list-item'
                {{sortableItem
                  groupName=this.sortableGroupId
                  model=image
                  disabled=this.sortableDisabled
                }}
              >
                {{#if this.allowReorder}}
                  <GripVerticalIcon class='grip-icon' />
                  <div class='drag-handle' {{sortableHandle}}>
                  </div>
                {{/if}}
                {{#if this.allowBatchSelect}}
                  <div class='item-checkbox item-checkbox-list-item'>
                    <input
                      type='checkbox'
                      {{!-- checked={{this.isSelected image.id}}
                      {{on 'change' (fn this.toggleImageSelection image.id)}}
                      data-test-item-checkbox --}}
                    />
                  </div>
                {{/if}}
                <img
                  src={{image.imageData}}
                  alt={{image.fileName}}
                  class='list-image'
                />
                <div class='list-info'>
                  <div class='list-name'>{{image.fileName}}</div>
                  <div class='list-size'>{{this.formatSize
                      image.fileSize
                    }}</div>
                </div>
                <button
                  type='button'
                  {{on 'click' (fn this.removeImage image.id)}}
                  class='list-remove'
                >
                  <XIcon class='remove-icon' />
                </button>
              </div>
            {{/if}}
          {{/each}}
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

      .upload-progress {
        border: 2px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        padding: 1.5rem;
        background: var(--input, #ffffff);
      }

      .progress-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
      }

      .spinner {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary, #3b82f6);
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .progress-text {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
        flex: 1;
      }

      .progress-percent {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--primary, #3b82f6);
      }

      .progress-bar-container {
        width: 100%;
        height: 0.75rem;
        background: var(--muted, #f1f5f9);
        border-radius: 9999px;
        overflow: hidden;
      }

      .progress-bar {
        height: 100%;
        background: linear-gradient(to right, var(--primary, #3b82f6), #60a5fa);
        border-radius: 9999px;
        transition: width 0.3s ease;
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
        top: calc(var(--spacing, 0.25rem) * 2);
        left: calc(var(--spacing, 0.25rem) * 2);
      }

      .item-checkbox input[type='checkbox'] {
        position: relative;
        width: 1.25rem;
        height: 1.25rem;
        cursor: pointer;
        z-index: 2;
      }

      .gallery-item.is-selected .gallery-image {
        outline: 3px solid var(--primary, #3b82f6);
        outline-offset: -3px;
        border-radius: var(--radius, 0.5rem);
      }
      .gallery-item.is-selected::after {
        content: '✔';
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        width: 1.5rem;
        height: 1.5rem;
        background: var(--primary, #3b82f6);
        color: white;
        z-index: 14;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm, 0.25rem);
        font-size: 0.875rem;
        font-weight: bold;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      }
      .list-item.is-selected {
        background-color: var(--accent, #f0f9ff);
        border-color: var(--primary, #3b82f6);
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
                src={{image.imageData}}
                alt={{image.fileName}}
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
            src={{this.firstImage.imageData}}
            alt={{this.firstImage.fileName}}
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
