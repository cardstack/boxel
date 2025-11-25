import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import CameraIcon from '@cardstack/boxel-icons/camera';
import ImageIcon from '@cardstack/boxel-icons/image';

interface ImageAvatarUploadArgs {
  Args: {
    onFileSelect: (event: Event) => void;
  };
}

export default class ImageAvatarUpload extends GlimmerComponent<ImageAvatarUploadArgs> {
  <template>
    <label class='avatar-upload'>
      {{! Upload trigger }}
      <div class='avatar-placeholder'>
        <ImageIcon class='placeholder-icon' />
        <div class='avatar-camera-icon'>
          <CameraIcon class='icon' />
        </div>
      </div>
      <span class='avatar-label'>Upload Photo</span>
      <input
        type='file'
        class='file-input'
        accept='image/*'
        {{on 'change' @onFileSelect}}
      />
    </label>

    <style scoped>
      .avatar-upload {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        cursor: pointer;
        padding: 1rem;
      }

      .avatar-placeholder {
        position: relative;
        width: 8rem;
        height: 8rem;
        border-radius: 9999px;
        background: linear-gradient(
          135deg,
          color-mix(in srgb, var(--primary, #3b82f6) 10%, transparent),
          color-mix(in srgb, var(--accent, #60a5fa) 10%, transparent)
        );
        border: 4px solid var(--background, #ffffff);
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .avatar-upload:hover .avatar-placeholder {
        box-shadow: var(--shadow-xl, 0 20px 25px -5px rgb(0 0 0 / 0.1));
        transform: scale(1.05);
      }

      .avatar-camera-icon {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 2.5rem;
        height: 2.5rem;
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border: 3px solid var(--background, #ffffff);
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
        transition: all 0.2s ease;
      }

      .avatar-upload:hover .avatar-camera-icon {
        background: var(--accent, #60a5fa);
        transform: scale(1.05);
      }

      .placeholder-icon {
        width: 3rem;
        height: 3rem;
        color: var(--primary, #3b82f6);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
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
