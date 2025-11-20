import { concat } from '@ember/helper';
import { or } from '@cardstack/boxel-ui/helpers';
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import XIcon from '@cardstack/boxel-icons/x';
import GripVerticalIcon from '@cardstack/boxel-icons/grip-vertical';
import UploadProgress from './upload-progress';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    src: string;
    fileName: string;
    fileSize?: number;
    index?: number;
    showNumber?: boolean;
    showDragHandle?: boolean;
    onRemove: () => void;
    uploadProgress?: number;
    showProgress?: boolean;
    uploadedBytes?: number;
    totalBytes?: number;
    showPercentage?: boolean;
    showSizeInfo?: boolean;
    dragOffset?: number;
    isDragging?: boolean;
    handleClass?: string;
  };
}

export default class ImageListItem extends Component<Signature> {
  get formattedFileSize(): string {
    if (typeof this.args.fileSize !== 'number') {
      return '';
    }
    const bytes = this.args.fileSize;
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  get resolvedHandleClass() {
    return this.args.handleClass || 'drag-handle';
  }

  <template>
    <div
      class='list-item {{if @isDragging "list-item--dragging"}}'
      data-test-list-item
      style={{if
        (or @dragOffset @isDragging)
        (concat 'transform: translateY(' (or @dragOffset 0) 'px); z-index: 5;')
      }}
      ...attributes
    >
      {{#if @showDragHandle}}
        <button
          type='button'
          class='btn-drag {{this.resolvedHandleClass}}'
          title='Drag to reorder'
          data-test-drag-handle
        >
          <GripVerticalIcon class='icon-drag' />
        </button>
      {{/if}}

      {{#if @showNumber}}
        <div class='item-number'>{{@index}}</div>
      {{/if}}

      <div class='thumbnail-wrapper'>
        <img src={{@src}} alt={{@fileName}} class='thumbnail' />
      </div>

      <div class='file-info'>
        <div class='file-name'>{{@fileName}}</div>
        {{#if this.formattedFileSize}}
          <div class='file-size'>{{this.formattedFileSize}}</div>
        {{/if}}
      </div>

      <button
        type='button'
        class='btn-remove'
        {{on 'click' @onRemove}}
        title='Remove image'
        data-test-remove-button
      >
        <XIcon class='icon-remove' />
      </button>

      {{#if @showProgress}}
        <div class='progress-wrapper'>
          <UploadProgress
            @percentage={{@uploadProgress}}
            @showPercentage={{@showPercentage}}
            @showSizeInfo={{@showSizeInfo}}
            @uploadedBytes={{@uploadedBytes}}
            @totalBytes={{@totalBytes}}
          />
        </div>
      {{/if}}
    </div>

    <style scoped>
      .list-item {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 3);
        padding: calc(var(--spacing, 0.25rem) * 3);
        background: var(--background, #ffffff);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 0.5rem);
        transition:
          all 0.15s ease,
          transform 0.15s ease;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        overflow: hidden;
      }

      .progress-wrapper {
        width: 100%;
        order: 999;
      }

      .list-item:hover {
        background: var(--muted, #f9fafb);
        box-shadow: var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
      }

      .list-item--dragging {
        box-shadow: var(--shadow-md, 0 4px 6px rgb(0 0 0 / 0.1));
        cursor: grabbing;
      }

      .item-number {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        background: var(--muted, #f3f4f6);
        color: var(--muted-foreground, #6b7280);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.875rem;
        font-weight: 600;
        flex-shrink: 0;
      }

      .thumbnail-wrapper {
        width: 3.5rem;
        height: 3.5rem;
        flex-shrink: 0;
        border-radius: var(--radius, 0.375rem);
        overflow: hidden;
        border: 1px solid var(--border, #e5e7eb);
      }

      .thumbnail {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .file-info {
        flex: 1;
        min-width: 0;
        max-width: 100%;
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 1);
        overflow: hidden;
      }

      .file-name {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #111827);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-height: 1.4;
      }

      .file-size {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
      }

      .btn-drag,
      .btn-remove {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: calc(var(--spacing, 0.25rem) * 2);
        border: none;
        border-radius: var(--radius, 0.375rem);
        cursor: pointer;
        transition: all 0.15s ease;
        background: transparent;
      }

      .btn-drag {
        color: var(--muted-foreground, #9ca3af);
        cursor: grab;
      }

      .btn-drag:hover {
        background: var(--muted, #f3f4f6);
        color: var(--foreground, #374151);
      }

      .btn-drag:active {
        cursor: grabbing;
      }

      .btn-remove {
        color: var(--destructive, #ef4444);
      }

      .btn-remove:hover {
        background: var(--destructive, #fee2e2);
      }

      .icon-drag,
      .icon-remove {
        width: 1.25rem;
        height: 1.25rem;
      }
    </style>
  </template>
}
