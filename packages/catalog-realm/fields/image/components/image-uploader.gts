import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { concat } from '@ember/helper';
import UploadIcon from '@cardstack/boxel-icons/upload';

interface Signature {
  Element: HTMLLabelElement;
  Args: {
    uploadText: string;
    uploadHint?: string;
    onFileSelect: (event: Event) => void;
    multiple?: boolean;
    height?: string;
    iconSize?: string;
    marginBottom?: string;
    testId?: string;
  };
}

export default class ImageUploader extends Component<Signature> {
  <template>
    <label class='upload-area' data-test-upload-area={{@testId}}>
      <div class='upload-content'>
        <UploadIcon
          class='upload-icon'
          style={{if
            @iconSize
            (concat 'width: ' @iconSize '; height: ' @iconSize)
          }}
        />
        <p class='upload-text'>
          <span class='upload-text-bold'>{{@uploadText}}</span>
          {{#if @uploadHint}}
            <br />
            <span class='upload-text-hint'>{{@uploadHint}}</span>
          {{/if}}
        </p>
      </div>
      <input
        type='file'
        class='file-input'
        accept='image/*'
        multiple={{@multiple}}
        {{on 'change' @onFileSelect}}
        data-test-file-input
      />
    </label>

    <style
      scoped
    >
      .upload-area {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: {{@height}};
        border: 2px dashed var(--boxel-300, #d1d5db);
        border-radius: var(--boxel-border-radius, 0.5rem);
        background-color: var(--boxel-100, #f9fafb);
        cursor: pointer;
        transition: all 0.2s ease;
        margin-bottom: {{@marginBottom}};
      }

      .upload-area:hover {
        background-color: var(--boxel-200, #f3f4f6);
      }

      .file-input {
        display: none;
      }

      .upload-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 1.25rem 1.5rem;
      }

      .upload-icon {
        width: 3rem;
        height: 3rem;
        color: var(--boxel-400, #9ca3af);
        margin-bottom: 0.75rem;
      }

      .upload-text {
        text-align: center;
        margin: 0;
      }

      .upload-text-bold {
        font-weight: 600;
        color: var(--boxel-700, #374151);
      }

      .upload-text-hint {
        font-size: 0.875rem;
        color: var(--boxel-500, #6b7280);
        margin-top: 0.25rem;
      }
    </style>
  </template>
}
