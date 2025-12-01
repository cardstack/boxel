import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import CameraIcon from '@cardstack/boxel-icons/camera';
import { Button } from '@cardstack/boxel-ui/components';
import ReadingProgress from './reading-progress';

interface ImageAvatarPreviewArgs {
  Args: {
    imageData: string;
    fileName?: string;
    onRemove: () => void;
    onFileSelect: (event: Event) => void;
    hasPendingUpload?: boolean;
    isReading?: boolean;
    readProgress?: number;
  };
}

export default class ImageAvatarPreview extends GlimmerComponent<ImageAvatarPreviewArgs> {
  get readProgress(): number {
    return this.args.readProgress ?? 0;
  }

  get imageStyle() {
    return htmlSafe('object-fit: cover;');
  }

  <template>
    <div class='avatar-preview'>
      {{! Avatar container }}
      <label class='avatar-image-wrapper' for='avatar-file-input'>
        {{#if @isReading}}
          {{! Progress indicator during file reading }}
          <div class='avatar-reading-overlay'>
            <ReadingProgress @readProgress={{this.readProgress}} />
          </div>
        {{else}}
          <img
            src={{@imageData}}
            alt={{@fileName}}
            class='avatar-image'
            style={{this.imageStyle}}
          />
        {{/if}}
        <div class='avatar-camera-icon'>
          <CameraIcon class='icon' />
        </div>
        <input
          type='file'
          id='avatar-file-input'
          class='file-input'
          accept='image/*'
          {{on 'change' @onFileSelect}}
        />
      </label>
      <div class='avatar-info'>{{@fileName}}</div>
      {{! File name display }}

      {{! Remove button - only show when no pending upload }}
      {{#unless @hasPendingUpload}}
        <Button
          class='avatar-remove-button'
          @kind='danger-dark'
          @size='tall'
          {{on 'click' @onRemove}}
          data-test-avatar-remove
        >
          Remove Image
        </Button>
      {{/unless}}
    </div>

    <style scoped>
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
        cursor: pointer;
        display: block;
      }

      .avatar-reading-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 9999px;
        overflow: hidden;
      }

      .avatar-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 9999px;
        border: 4px solid var(--background, #ffffff);
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
        transition: opacity 0.2s ease;
      }

      .avatar-image-wrapper:hover .avatar-image {
        opacity: 0.9;
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

      .avatar-image-wrapper:hover .avatar-camera-icon {
        background: var(--accent, #60a5fa);
        transform: scale(1.05);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
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

      .avatar-info {
        font-size: 0.875rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .avatar-remove-button {
        width: 100%;
        justify-content: center;
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
      }

      .avatar-remove-button:hover {
        background: var(--destructive, #dc2626);
        opacity: 0.9;
      }
    </style>
  </template>
}
