import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Button } from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    onUpload: () => void;
    disabled?: boolean;
    isUploading?: boolean;
    uploadStatus?: string;
    text?: string;
  };
}

export default class CloudflareUploadButton extends Component<Signature> {
  get buttonText() {
    if (this.args.isUploading) {
      return 'Uploading...';
    }
    return this.args.text || 'Upload Image to Cloudflare';
  }

  <template>
    <div class='upload-actions'>
      <Button
        class='upload-button'
        @kind='primary-dark'
        @size='tall'
        @disabled={{@disabled}}
        {{on 'click' @onUpload}}
        data-test-upload-to-cloudflare
      >
        {{this.buttonText}}
      </Button>

      {{#if @uploadStatus}}
        <div class='status-message'>{{@uploadStatus}}</div>
      {{/if}}

    </div>

    <style scoped>
      .upload-actions {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.75rem;
      }

      .upload-button {
        width: 100%;
        justify-content: center;
      }

      .status-message {
        padding: 0.5rem 0.75rem;
        border-radius: 0.375rem;
        background: #f3f4f6;
        border-left: 3px solid var(--boxel-primary-500, #3b82f6);
        font-size: 0.8125rem;
        white-space: pre-wrap;
      }
    </style>
  </template>
}
