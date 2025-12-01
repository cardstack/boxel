import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import UploadIcon from '@cardstack/boxel-icons/upload';

interface ImageDropzoneUploadArgs {
  Args: {
    onFileSelect: (event: Event) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
}

export default class ImageDropzoneUpload extends GlimmerComponent<ImageDropzoneUploadArgs> {
  <template>
    <label
      class='dropzone-upload'
      {{on 'dragover' @onDragOver}}
      {{on 'drop' @onDrop}}
    >
      {{! Upload trigger with drag & drop }}
      <div class='dropzone-content'>
        <UploadIcon class='dropzone-icon' />
        <span class='dropzone-title'>Drag & drop image here</span>
        <span class='dropzone-subtitle'>or click to browse</span>
      </div>
      <input
        type='file'
        class='file-input'
        accept='image/*'
        {{on 'change' @onFileSelect}}
      />
    </label>

    <style scoped>
      .dropzone-upload {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 12rem;
        border: 2px dashed var(--primary, #3b82f6);
        border-radius: var(--radius, 0.5rem);
        background: color-mix(in srgb, var(--primary, #3b82f6) 5%, transparent);
        cursor: pointer;
        transition: all 0.2s ease;
        padding: calc(var(--spacing, 0.25rem) * 8);
      }

      .dropzone-upload:hover {
        border-color: var(--accent, #60a5fa);
        background: color-mix(
          in srgb,
          var(--primary, #3b82f6) 10%,
          transparent
        );
      }

      .dropzone-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
      }

      .dropzone-icon {
        width: 2.5rem;
        height: 2.5rem;
        color: var(--primary, #3b82f6);
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
