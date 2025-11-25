import GlimmerComponent from '@glimmer/component';
import { fn, htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import XIcon from '@cardstack/boxel-icons/x';
import {
  SortableHandleModifier as sortableHandle,
  SortableItemModifier as sortableItem,
} from '@cardstack/boxel-ui/modifiers';

type UploadStatus = 'idle' | 'pending' | 'success' | 'error';

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

interface MultipleImageGalleryPreviewArgs {
  Args: {
    entry: UploadEntry;
    allowBatchSelect: boolean;
    allowReorder: boolean;
    sortableGroupId: string;
    sortableDisabled: boolean;
    onRemove: (id: string) => void;
    onToggleSelection: (id: string) => void;
    getProgressStyle: (progress: number) => ReturnType<typeof htmlSafe>;
  };
}

export default class MultipleImageGalleryPreview extends GlimmerComponent<MultipleImageGalleryPreviewArgs> {
  get readProgress(): number {
    return this.args.entry.readProgress ?? 0;
  }

  <template>
    <div
      class='gallery-item
        {{if @entry.selected "is-selected"}}
        {{if (eq @entry.uploadStatus "success") "upload-success"}}
        {{if (eq @entry.uploadStatus "error") "upload-error"}}'
      {{sortableItem
        groupName=@sortableGroupId
        model=@entry
        disabled=@sortableDisabled
      }}
    >
      {{! Gallery checkbox }}
      {{#if @allowBatchSelect}}
        <div class='item-checkbox-gallery'>
          <label>
            <input
              type='checkbox'
              checked={{@entry.selected}}
              {{on 'change' (fn @onToggleSelection @entry.id)}}
              data-test-item-checkbox
            />
            <span class='sr-only'>Select image</span>
          </label>
        </div>
      {{/if}}

      {{#if @allowReorder}}
        <div class='drag-handle' {{sortableHandle}}></div>
      {{/if}}

      {{#if @entry.isReading}}
        <div class='gallery-reading-progress'>
          <div class='progress-indicator'>
            <div class='progress-bar-gallery'>
              <div
                class='progress-fill-gallery'
                style={{@getProgressStyle this.readProgress}}
              ></div>
            </div>
            <span class='progress-text-gallery'>{{@entry.readProgress}}%</span>
          </div>
        </div>
      {{else}}
        <img
          src={{if
            @entry.uploadedImageUrl
            @entry.uploadedImageUrl
            @entry.preview
          }}
          alt=''
          class='gallery-image'
        />

        {{! Uploading spinner overlay }}
        {{#if @entry.isUploading}}
          <div class='uploading-overlay'>
            <div class='spinner'></div>
            <span class='uploading-text'>Uploading...</span>
          </div>
        {{/if}}

        {{! Upload status indicators }}
        {{#if (eq @entry.uploadStatus 'success')}}
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
        {{else if (eq @entry.uploadStatus 'error')}}
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
        {{on 'click' (fn @onRemove @entry.id)}}
        class='gallery-remove'
      >
        <XIcon class='remove-icon' />
      </button>
    </div>

    <style scoped>
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

      .progress-indicator {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
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

      .upload-status-icon .status-icon {
        width: 1rem;
        height: 1rem;
      }

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

      .spinner {
        width: 2.5rem;
        height: 2.5rem;
        border: 3px solid rgba(255, 255, 255, 0.3);
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
