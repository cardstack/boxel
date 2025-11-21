// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { Component } from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import { on } from '@ember/modifier'; // ² Event handling
import CameraIcon from '@cardstack/boxel-icons/camera'; // ³ Icon import

// ⁴ Component signature interface
interface AvatarUploadSignature {
  Args: {
    onFileSelect: (event: Event) => void;
  };
}

// ⁵ Avatar variant upload trigger
export class AvatarUpload extends Component<AvatarUploadSignature> {
  <template>
    <label class='avatar-upload'>
      {{! ⁶ Upload trigger }}
      <div class='avatar-placeholder'>
        <CameraIcon class='avatar-icon' />
      </div>
      <span class='avatar-label'>Upload Photo</span>
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
      .avatar-upload {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        cursor: pointer;
        padding: 1rem;
      }

      .avatar-placeholder {
        width: 8rem;
        height: 8rem;
        border-radius: 9999px;
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.1),
          rgba(147, 51, 234, 0.1)
        );
        border: 4px solid var(--background, #ffffff);
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .avatar-upload:hover .avatar-placeholder {
        box-shadow: var(--shadow-xl, 0 20px 25px -5px rgb(0 0 0 / 0.1));
        transform: scale(1.05);
      }

      .avatar-icon {
        width: 3rem;
        height: 3rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .avatar-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--primary, #3b82f6);
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
