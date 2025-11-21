// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { Component } from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import { on } from '@ember/modifier'; // ² Event handling
import XIcon from '@cardstack/boxel-icons/x'; // ³ Icon import

// ⁴ Component signature interface
interface AvatarPreviewSignature {
  Args: {
    imageData: string;
    fileName?: string;
    onRemove: () => void;
  };
}

// ⁵ Avatar variant preview component
export class AvatarPreview extends Component<AvatarPreviewSignature> {
  <template>
    <div class='avatar-preview'>
      {{! ⁶ Avatar container }}
      <div class='avatar-image-wrapper'>
        <img src={{@imageData}} alt={{@fileName}} class='avatar-image' />
        <button type='button' {{on 'click' @onRemove}} class='avatar-remove'>
          <XIcon class='icon' />
        </button>
      </div>
      <div class='avatar-info'>{{@fileName}}</div>
      {{! ⁷ File name display }}
    </div>

    <style
      scoped
    > {{! ⁸ Component styles }}
      .avatar-preview {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
      }

      .avatar-image-wrapper {
        position: relative;
        width: 8rem;
        height: 8rem;
      }

      .avatar-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 9999px;
        border: 4px solid var(--background, #ffffff);
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      }

      .avatar-remove {
        position: absolute;
        top: -0.5rem;
        right: -0.5rem;
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
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
        transition: all 0.2s ease;
      }

      .avatar-remove:hover {
        background: #dc2626;
      }

      .icon {
        width: 1rem;
        height: 1rem;
      }

      .avatar-info {
        font-size: 0.875rem;
        color: var(--muted-foreground, #9ca3af);
      }
    </style>
  </template>
}
