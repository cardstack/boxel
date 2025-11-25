import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import Grid3x3Icon from '@cardstack/boxel-icons/grid-3x3';

interface MultipleImageGalleryUploadArgs {
  Args: {
    onFileSelect: (event: Event) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    maxFilesReached: boolean;
    currentCount: number;
    maxFiles: number;
  };
}

export default class MultipleImageGalleryUpload extends GlimmerComponent<MultipleImageGalleryUploadArgs> {
  <template>
    <label
      class='upload-trigger variant-gallery
        {{if @maxFilesReached "disabled"}}'
      {{on 'dragover' @onDragOver}}
      {{on 'drop' @onDrop}}
    >
      <Grid3x3Icon class='upload-icon' />
      <span class='upload-text'>
        {{#if @maxFilesReached}}
          Max images reached ({{@currentCount}}/{{@maxFiles}})
        {{else}}
          Add to gallery ({{@currentCount}}/{{@maxFiles}})
        {{/if}}
      </span>
      <input
        type='file'
        class='file-input'
        accept='image/*'
        multiple={{true}}
        disabled={{@maxFilesReached}}
        {{on 'change' @onFileSelect}}
      />
    </label>

    <style scoped>
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

      .upload-trigger.variant-gallery {
        border-color: var(--primary, #3b82f6);
        background: rgba(59, 130, 246, 0.05);
      }

      .upload-trigger.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .upload-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary, #3b82f6);
      }

      .upload-text {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
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
    </style>
  </template>
}
