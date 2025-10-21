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
  @tracked isSaving = false;
  @tracked errorMessage: string | null = null;

  // Load the result image card dynamically using getCard
  resultImageResource = this.args.context?.getCard(
    this,
    () => this.args.model.resultImageId,
  );

  get canUpload() {
    return (
      !!this.args.model.sourceImageUrl &&
      !!this.args.model.targetRealmUrl &&
      !this.isUploading
    );
  }

  get statusMessage() {
    if (this.isSaving) {
      return 'Saving new image in result field...';
    }
    if (this.isUploading) {
      return 'Uploading image to Cloudflare...';
    }
    if (this.errorMessage) {
      return this.errorMessage;
    }
    if (this.args.model.resultImageId) {
      return 'Upload complete!';
    }
    return 'Provide an image URL and target realm to try the command.';
  }

  get statusClass() {
    let classes = ['status-message'];
    if (this.errorMessage) {
      classes.push('status-message--error');
    } else if (this.args.model.resultImageId) {
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
    this.args.model.resultImageId = '';

    try {
      let command = new UploadImageCommand(commandContext);
      let result = await command.execute({
        sourceImageUrl: this.args.model.sourceImageUrl,
        targetRealmUrl: this.args.model.targetRealmUrl,
      });

      // Store the card ID, which will trigger getCard to load it
      console.log('Upload result:', result);
      this.isSaving = true;
      if (result.cardId) {
        this.args.model.resultImageId = result.cardId;
      }
    } catch (error) {
      let message =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred during upload.';
      this.errorMessage = message;
    } finally {
      this.isUploading = false;
      this.isSaving = false;
    }
  }

  @action
  clearStatus() {
    this.errorMessage = null;
    this.args.model.sourceImageUrl = '';
    this.args.model.targetRealmUrl = '';
    this.args.model.resultImageId = '';
  }

  @action
  openResultCard() {
    if (this.resultImageResource?.card) {
      this.args.viewCard?.(this.resultImageResource.card, 'isolated');
    }
  }

  get renderableResultCard() {
    if (!this.resultImageResource?.card) {
      return null;
    }
    return this.resultImageResource.card.constructor.getComponent(
      this.resultImageResource.card,
    );
  }

  <template>
    <form class='image-upload-tester' {{on 'submit' this.uploadImage}}>
      <div class='field-group'>
        <FieldContainer @label='Source Image URL'>
          <@fields.sourceImageUrl @format='edit' />
        </FieldContainer>
        <FieldContainer @label='Target Realm URL'>
          <@fields.targetRealmUrl @format='edit' />
        </FieldContainer>
      </div>

      {{#if @model.resultImageId}}
        <Button @variant='secondary' {{on 'click' this.clearStatus}}>
          Reset
        </Button>
      {{else}}
        <Button
          type='submit'
          @variant='primary'
          @disabled={{not this.canUpload}}
        >
          {{if this.isUploading 'Uploading…' 'Upload Image'}}
        </Button>
      {{/if}}

      <div class={{this.statusClass}}>
        {{this.statusMessage}}
        {{#if this.renderableResultCard}}
          <div class='result-card-wrapper' {{on 'click' this.openResultCard}}>
            <this.renderableResultCard
              class='card result'
              @format='embedded'
              data-test-card-id={{this.resultImageResource.card.id}}
            />
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

      .result-card-wrapper {
        margin-top: var(--boxel-sp-sm);
        cursor: pointer;
      }

      .result-card-wrapper:hover {
        opacity: 0.9;
      }

      .result {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
        height: auto;
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

  @field sourceImageUrl = contains(UrlField);
  @field targetRealmUrl = contains(StringField);
  @field resultImageId = contains(StringField);

  static isolated = ImageUploadTesterIsolated;
}
