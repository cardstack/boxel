import GlimmerComponent from '@glimmer/component';
import type { SafeString } from '@ember/template';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import GripVerticalIcon from '@cardstack/boxel-icons/grip-vertical';
import XIcon from '@cardstack/boxel-icons/x';
import CheckIcon from '@cardstack/boxel-icons/check';
import CircleXIcon from '@cardstack/boxel-icons/circle-x';
import {
  SortableHandleModifier as sortableHandle,
  SortableItemModifier as sortableItem,
} from '@cardstack/boxel-ui/modifiers';

import type { UploadEntry } from '../image-upload-types';

interface MultipleImageDropzonePreviewArgs {
  Args: {
    entry: UploadEntry;
    allowBatchSelect: boolean;
    allowReorder: boolean;
    sortableGroupId: string;
    sortableDisabled: boolean;
    onRemove: (id: string) => void;
    onToggleSelection: (id: string) => void;
    getProgressStyle: (progress: number) => SafeString;
    formatSize: (bytes: number) => string;
  };
}

export default class MultipleImageDropzonePreview extends GlimmerComponent<MultipleImageDropzonePreviewArgs> {
  get readProgress(): number {
    return this.args.entry.readProgress ?? 0;
  }

  <template>
    <div
      class='list-item
        {{if @entry.selected "is-selected"}}
        {{if (eq @entry.uploadStatus "success") "upload-success"}}
        {{if (eq @entry.uploadStatus "error") "upload-error"}}'
      {{sortableItem
        groupName=@sortableGroupId
        model=@entry
        disabled=@sortableDisabled
      }}
    >
      {{#if @allowReorder}}
        <div class='drag-handle' {{sortableHandle}}>
          <GripVerticalIcon class='grip-icon' />
        </div>
      {{/if}}

      {{! List checkbox }}
      {{#if @allowBatchSelect}}
        <label>
          <input
            type='checkbox'
            class='list-checkbox'
            checked={{@entry.selected}}
            {{on 'change' (fn @onToggleSelection @entry.id)}}
            data-test-item-checkbox
          />
          <span class='sr-only'>Select image</span>
        </label>
      {{/if}}

      {{#if @entry.isReading}}
        <div class='list-reading-progress'>
          <div class='progress-indicator'>
            <div class='progress-bar-small'>
              <div
                class='progress-fill-small'
                style={{@getProgressStyle this.readProgress}}
              ></div>
            </div>
            <span class='progress-text-small'>{{this.readProgress}}%</span>
          </div>
        </div>
      {{else}}
        <div class='image-wrapper'>
          <img
            src={{if @entry.url @entry.url @entry.preview}}
            alt=''
            class='list-image'
          />

          {{! Uploading spinner overlay }}
          {{#if @entry.isUploading}}
            <div class='uploading-overlay-small'>
              <div class='spinner-small'></div>
            </div>
          {{/if}}

          {{! Upload status indicators }}
          {{#if (eq @entry.uploadStatus 'success')}}
            <div class='upload-status-icon success'>
              <CheckIcon class='status-icon' />
            </div>
          {{else if (eq @entry.uploadStatus 'error')}}
            <div class='upload-status-icon error'>
              <CircleXIcon class='status-icon' />
            </div>
          {{/if}}
        </div>
      {{/if}}

      <div class='list-info'>
        <div class='list-name'>{{if
            @entry.url
            @entry.url
            @entry.file.name
          }}</div>
        {{#unless @entry.url}}
          <div class='list-size'>{{@formatSize @entry.file.size}}</div>
        {{/unless}}
        {{#if @entry.uploadError}}
          <div class='upload-error-text'>Upload failed</div>
        {{/if}}
      </div>
      <button
        type='button'
        {{on 'click' (fn @onRemove @entry.id)}}
        class='list-remove'
      >
        <XIcon class='remove-icon' />
      </button>
    </div>

    <style scoped>
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
        border: 2px solid var(--chart2, #10b981);
        background: color-mix(in srgb, var(--chart2, #10b981) 5%, transparent);
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--chart2, #10b981) 20%, transparent);
      }

      .list-item.upload-success:hover {
        border: 2px solid var(--chart2, #10b981);
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--chart2, #10b981) 30%, transparent);
      }

      .list-item.upload-error {
        border: 2px solid var(--destructive, #ef4444);
        background: color-mix(
          in srgb,
          var(--destructive, #ef4444) 5%,
          transparent
        );
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--destructive, #ef4444) 20%, transparent);
      }

      .list-item.upload-error:hover {
        border: 2px solid var(--destructive, #ef4444);
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--destructive, #ef4444) 30%, transparent);
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
        background: color-mix(in srgb, var(--primary, #3b82f6) 5%, transparent);
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
        color: var(--destructive, #ef4444);
        margin-top: calc(var(--spacing, 0.25rem) * 1);
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
        background: var(--chart2, #10b981);
        color: var(--background, #ffffff);
      }

      .upload-status-icon.error {
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
      }

      .upload-status-icon .status-icon {
        width: 1rem;
        height: 1rem;
      }

      .uploading-overlay-small {
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
        align-items: center;
        justify-content: center;
        z-index: 3;
        border-radius: var(--radius, 0.375rem);
      }

      .spinner-small {
        width: 1.5rem;
        height: 1.5rem;
        border: 2px solid
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
        background: var(--destructive, #dc2626);
        opacity: 0.9;
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

      .remove-icon {
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
