import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Button } from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    onUpload?: () => void;
    disabled?: boolean;
    isUploading?: boolean;
    label?: string;
    showButton?: boolean;
  };
}

export default class CloudflareUploadButton extends Component<Signature> {
  get buttonText() {
    if (this.args.isUploading) {
      return 'Uploading...';
    }
    return this.args.label || 'Upload Image';
  }

  get shouldRenderButton() {
    if (this.args.showButton === false) {
      return false;
    }
    return typeof this.args.onUpload === 'function';
  }

  <template>
    <div class='upload-actions'>
      {{#if this.shouldRenderButton}}
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
    </style>
  </template>
}
