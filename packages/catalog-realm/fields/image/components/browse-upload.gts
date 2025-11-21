// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { Component } from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import { on } from '@ember/modifier'; // ² Event handling
import UploadIcon from '@cardstack/boxel-icons/upload'; // ³ Icon import

// ⁴ Component signature interface
interface BrowseUploadSignature {
  Args: {
    onFileSelect: (event: Event) => void;
  };
}

// ⁵ Browse variant upload trigger
export class BrowseUpload extends Component<BrowseUploadSignature> {
  <template>
    <label class='browse-upload'>
      {{! ⁶ Upload trigger }}
      <UploadIcon class='browse-icon' />
      <span class='browse-text'>Click to upload image</span>
      <span class='browse-hint'>PNG, JPG, WebP, GIF</span>
      <input
        type='file'
        class='file-input'
        accept='image/*'
        {{on 'change' @onFileSelect}}
      />
    </label>

    <style
      scoped
    > {{! ⁷ Component styles }}
      .browse-upload {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 12rem;
        border: 2px dashed var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        background: var(--input, #ffffff);
        cursor: pointer;
        transition: all 0.2s ease;
        padding: 2rem;
        gap: 0.5rem;
      }

      .browse-upload:hover {
        border-color: var(--primary, #3b82f6);
        background: var(--accent, #f0f9ff);
      }

      .browse-icon {
        width: 2.5rem;
        height: 2.5rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .browse-text {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }

      .browse-hint {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
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
