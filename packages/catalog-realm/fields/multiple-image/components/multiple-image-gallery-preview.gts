import GlimmerComponent from '@glimmer/component';
import { fn } from '@ember/helper';
import type { SafeString } from '@ember/template';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import XIcon from '@cardstack/boxel-icons/x';
import CheckIcon from '@cardstack/boxel-icons/check';
import CircleXIcon from '@cardstack/boxel-icons/circle-x';
import {
  SortableHandleModifier as sortableHandle,
  SortableItemModifier as sortableItem,
} from '@cardstack/boxel-ui/modifiers';

import type { UploadEntry } from '../image-upload-types';

interface MultipleImageGalleryPreviewArgs {
  Args: {
    entry: UploadEntry;
    allowBatchSelect: boolean;
    allowReorder: boolean;
    sortableGroupId: string;
    sortableDisabled: boolean;
    onRemove: (id: string) => void;
    onToggleSelection: (id: string) => void;
    getProgressStyle: (progress: number) => SafeString;
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
          src={{if @entry.url @entry.url @entry.preview}}
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
            <CheckIcon class='status-icon' />
          </div>
        {{else if (eq @entry.uploadStatus 'error')}}
          <div class='gallery-error-badge'>
            <CircleXIcon class='error-badge-icon' />
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
        border: 2px solid var(--chart2, #10b981);
        background: color-mix(in srgb, var(--chart2, #10b981) 5%, transparent);
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--chart2, #10b981) 20%, transparent);
      }

      .gallery-item.upload-success:hover {
        border: 2px solid var(--chart2, #10b981);
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--chart2, #10b981) 30%, transparent);
      }

      .gallery-item.upload-error {
        border: 2px solid var(--destructive, #ef4444);
        background: color-mix(
          in srgb,
          var(--destructive, #ef4444) 5%,
          transparent
        );
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--destructive, #ef4444) 20%, transparent);
      }

      .gallery-item.upload-error:hover {
        border: 2px solid var(--destructive, #ef4444);
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--destructive, #ef4444) 30%, transparent);
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
        background: color-mix(in srgb, var(--primary, #3b82f6) 5%, transparent);
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
        margin: 0;
        padding: 0;
      }

      .gallery-item:hover .gallery-remove {
        opacity: 1;
      }

      .gallery-remove:hover {
        background: var(--destructive, #dc2626);
        opacity: 0.9;
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
        background: var(--chart2, #10b981);
        color: var(--background, #ffffff);
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
        gap: calc(var(--spacing, 0.25rem) * 1.5);
        padding: calc(var(--spacing, 0.25rem) * 1.5)
          calc(var(--spacing, 0.25rem) * 2.5);
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.75rem;
        font-weight: 600;
        z-index: 2;
        box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.2));
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
        background: color-mix(
          in srgb,
          var(--foreground, #1a1a1a) 60%,
          transparent
        );
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        z-index: 3;
      }

      .spinner {
        width: 2.5rem;
        height: 2.5rem;
        border: 3px solid
          color-mix(in srgb, var(--background, #ffffff) 30%, transparent);
        border-top-color: var(--background, #ffffff);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .uploading-text {
        color: var(--background, #ffffff);
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
