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
    allowedFormats?: string[];
  };
}

export default class ImageUploader extends Component<Signature> {
  get acceptAttribute(): string {
    if (this.args.allowedFormats && this.args.allowedFormats.length > 0) {
      return this.args.allowedFormats.join(',');
    }
    return 'image/*';
  }

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
        accept={{this.acceptAttribute}}
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
        border: 2px dashed var(--border, #d1d5db);
        border-radius: var(--radius, 0.5rem);
        background-color: var(--muted, #f9fafb);
        cursor: pointer;
        transition: all 0.2s ease;
        margin-bottom: {{@marginBottom}};
      }

      .upload-area:hover {
        background-color: var(--accent, #f3f4f6);
        border-color: var(--primary, #3b82f6);
      }

      .file-input {
        display: none;
      }

      .upload-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: calc(var(--spacing, 0.25rem) * 5)
          calc(var(--spacing, 0.25rem) * 6);
      }

      .upload-icon {
        width: 3rem;
        height: 3rem;
        color: var(--muted-foreground, #9ca3af);
        margin-bottom: calc(var(--spacing, 0.25rem) * 3);
      }

      .upload-text {
        text-align: center;
        margin: 0;
      }

      .upload-text-bold {
        font-weight: 600;
        color: var(--foreground, #374151);
      }

      .upload-text-hint {
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
        margin-top: calc(var(--spacing, 0.25rem));
      }
    </style>
  </template>
}
