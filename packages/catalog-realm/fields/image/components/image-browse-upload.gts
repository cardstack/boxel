import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import UploadIcon from '@cardstack/boxel-icons/upload';

interface ImageBrowseUploadArgs {
  Args: {
    onFileSelect: (event: Event) => void;
  };
}

export default class ImageBrowseUpload extends GlimmerComponent<ImageBrowseUploadArgs> {
  <template>
    <label class='browse-upload'>
      {{! Upload trigger }}
      <UploadIcon class='browse-icon' />
      <span class='browse-text'>Click to upload image</span>
      <input
        type='file'
        class='file-input'
        accept='image/*'
        {{on 'change' @onFileSelect}}
      />
    </label>

    <style scoped>
      .browse-upload {
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
        gap: calc(var(--spacing, 0.25rem) * 2);
      }

      .browse-upload:hover {
        border-color: var(--accent, #60a5fa);
        background: color-mix(
          in srgb,
          var(--primary, #3b82f6) 10%,
          transparent
        );
      }

      .browse-icon {
        width: 2.5rem;
        height: 2.5rem;
        color: var(--primary, #3b82f6);
      }

      .browse-text {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
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
