import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import UrlField from 'https://cardstack.com/base/url';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { not } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import UploadImageCommand from '@cardstack/catalog/commands/upload-image';
import { Button, FieldContainer } from '@cardstack/boxel-ui/components';

class ImageUploadTesterIsolated extends Component<typeof ImageUploadTester> {
  @tracked isUploading = false;
  @tracked errorMessage: string | null = null;
  @tracked uploadedCardId: string | null = null;

  get canUpload() {
    return (
      !!this.args.model.sourceUrl &&
      !!this.args.model.targetRealm &&
      !this.isUploading
    );
  }

  get statusMessage() {
    if (this.isUploading) {
      return 'Uploading image to Cloudflare...';
    }
    if (this.errorMessage) {
      return this.errorMessage;
    }
    if (this.uploadedCardId) {
      return 'Upload complete!';
    }
    return 'Provide an image URL and target realm to try the command.';
  }

  get statusClass() {
    let classes = ['status-message'];
    if (this.errorMessage) {
      classes.push('status-message--error');
    } else if (this.uploadedCardId) {
      classes.push('status-message--success');
    }
    return classes.join(' ');
  }

  @action
  async uploadImage(event?: Event) {
    event?.preventDefault();
    if (!this.canUpload) {
      return;
    }
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.errorMessage =
        'Command context is not available. Open this card inside the host app.';
      return;
    }

    this.isUploading = true;
    this.errorMessage = null;
    this.uploadedCardId = null;

    try {
      let command = new UploadImageCommand(commandContext);
      let result = await command.execute({
        sourceUrl: this.args.model.sourceUrl,
        targetRealm: this.args.model.targetRealm,
      });
      this.uploadedCardId = result.cardId;
    } catch (error) {
      let message =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred during upload.';
      this.errorMessage = message;
    } finally {
      this.isUploading = false;
    }
  }

  @action
  clearStatus() {
    this.errorMessage = null;
    this.uploadedCardId = null;
  }

  <template>
    <form class='image-upload-tester' {{on 'submit' this.uploadImage}}>
      <div class='field-group'>
        <FieldContainer @label='Source Image URL'>
          <div {{on 'input' this.clearStatus}}>
            <@fields.sourceUrl />
          </div>
        </FieldContainer>
        <FieldContainer @label='Target Realm URL'>
          <div {{on 'input' this.clearStatus}}>
            <@fields.targetRealm />
          </div>
        </FieldContainer>
      </div>

      <Button type='submit' @variant='primary' @disabled={{not this.canUpload}}>
        {{if this.isUploading 'Uploading…' 'Upload Image'}}
      </Button>

      <div class={{this.statusClass}}>
        {{this.statusMessage}}
        {{#if this.uploadedCardId}}
          <div class='result'>
            <span class='result-label'>Card ID:</span>
            <code class='result-id'>{{this.uploadedCardId}}</code>
            <Button
              @kind='primary'
              @size='base'
              {{on 'click' (fn @viewCard this.uploadedCardId)}}
            >
              View Image Card
            </Button>
          </div>
        {{/if}}
      </div>
    </form>

    <style scoped>
      .image-upload-tester {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-lg);
        border-radius: var(--boxel-border-radius-lg);
        background: var(--boxel-panel);
        box-shadow: var(--boxel-shadow-md);
        max-width: 600px;
      }

      .field-group {
        display: grid;
        gap: var(--boxel-sp);
      }

      .status-message {
        padding: var(--boxel-sp);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-50);
        color: var(--boxel-600);
        font: 500 var(--boxel-font-sm);
      }

      .status-message--error {
        background: var(--boxel-error-50);
        color: var(--boxel-error-400);
      }

      .status-message--success {
        background: var(--boxel-success-50);
        color: var(--boxel-success-400);
      }

      .result {
        margin-top: var(--boxel-sp-sm);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .result-label {
        font-weight: 600;
      }

      .result-id {
        font-family: var(--boxel-font-mono);
        padding: 2px 6px;
        border-radius: var(--boxel-border-radius-sm);
        background: rgba(0, 0, 0, 0.05);
      }

      .result-link {
        color: var(--boxel-primary-500);
        text-decoration: none;
        font-weight: 600;
      }

      .result-link:hover {
        text-decoration: underline;
      }
    </style>
  </template>
}

export class ImageUploadTester extends CardDef {
  static displayName = 'Image Upload Tester';

  @field sourceUrl = contains(UrlField);
  @field targetRealm = contains(StringField);

  static isolated = ImageUploadTesterIsolated;
}
