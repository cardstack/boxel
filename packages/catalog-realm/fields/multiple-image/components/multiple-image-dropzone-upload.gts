import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import UploadIcon from '@cardstack/boxel-icons/upload';

interface MultipleImageDropzoneUploadArgs {
  Args: {
    onFileSelect: (event: Event) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    maxFilesReached: boolean;
    currentCount: number;
    maxFiles: number;
    variant: 'dropzone' | 'list' | 'gallery';
  };
}

export default class MultipleImageDropzoneUpload extends GlimmerComponent<MultipleImageDropzoneUploadArgs> {
  <template>
    <label
      class='upload-trigger variant-{{@variant}}
        {{if @maxFilesReached "disabled"}}'
      {{on 'dragover' @onDragOver}}
      {{on 'drop' @onDrop}}
    >
      <UploadIcon class='upload-icon' />
      {{#if (eq @variant 'dropzone')}}
        <div class='dropzone-text'>
          <span class='dropzone-title'>Drag & drop images here</span>
          <span class='dropzone-subtitle'>or click to browse</span>
        </div>
      {{else}}
        <span class='upload-text'>
          {{#if @maxFilesReached}}
            Max images reached ({{@currentCount}}/{{@maxFiles}})
          {{else}}
            Add images ({{@currentCount}}/{{@maxFiles}})
          {{/if}}
        </span>
      {{/if}}
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
        background: color-mix(in srgb, var(--primary, #3b82f6) 10%, transparent);
      }

      .upload-trigger.variant-dropzone {
        flex-direction: column;
        min-height: 8rem;
      }

      .upload-trigger.variant-dropzone:hover {
        border-color: var(--accent, #60a5fa);
        background: color-mix(in srgb, var(--primary, #3b82f6) 10%, transparent);
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
