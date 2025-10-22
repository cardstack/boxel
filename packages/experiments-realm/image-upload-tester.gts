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
import { fn } from '@ember/helper';
import { not } from '@cardstack/boxel-ui/helpers';
import UploadImageCommand from '@cardstack/catalog/commands/upload-image';
import { Button, FieldContainer } from '@cardstack/boxel-ui/components';
import RealmField from 'https://cardstack.com/base/realm';

class ImageUploadTesterIsolated extends Component<typeof ImageUploadTester> {
  @tracked isUploading = false;
  @tracked errorMessage: string | null = null;
  @tracked uploadMode: 'url' | 'file' = 'url';
  @tracked selectedFile: File | null = null;
  @tracked currentCommand: UploadImageCommand | null = null;

  private cachedRemoteUrl = '';
  private currentFileObjectUrl: string | null = null;

  // Load the result image card dynamically using getCard
  resultImageResource = this.args.context?.getCard(
    this,
    () => this.args.model.resultImageId,
  );

  get canUpload() {
    if (!this.args.model.targetRealmUrl || this.isUploading) {
      return false;
    }

    if (this.uploadMode === 'file') {
      return !!this.selectedFile;
    }

    return !!this.args.model.sourceImageUrl;
  }

  get statusMessage() {
    if (this.isUploading) {
      return this.progressStatusMessage;
    }
    if (this.errorMessage) {
      return this.errorMessage;
    }
    if (this.args.model.resultImageId) {
      return 'Upload complete!';
    }
    return 'Provide an image URL and target realm to try the command.';
  }

  get progressStatusMessage() {
    switch (this.currentCommand?.progressStep) {
      case 'requesting-direct-upload-url':
        return 'Requesting Cloudflare upload URL...';
      case 'fetching-local-file':
        return 'Preparing selected file...';
      case 'uploading-local-file':
        return 'Uploading file to Cloudflare...';
      case 'uploading-remote-url':
        return 'Uploading remote image to Cloudflare...';
      case 'saving-card':
        return 'Saving new image in result field...';
      case 'completed':
        return 'Finalizing upload...';
      case 'error':
        return 'Upload failed.';
      default:
        return 'Uploading image to Cloudflare...';
    }
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
  selectUploadMode(mode: 'url' | 'file') {
    if (mode === this.uploadMode) {
      return;
    }

    if (mode === 'file') {
      this.cachedRemoteUrl = this.args.model.sourceImageUrl ?? '';
      this.resetFileSelection({ clearSource: false });
      this.args.model.sourceImageUrl = '';
    } else {
      this.resetFileSelection({ clearSource: false });
      this.args.model.sourceImageUrl = this.cachedRemoteUrl;
    }

    this.uploadMode = mode;
    this.errorMessage = null;
  }

  @action
  handleFileSelection(event: Event) {
    let input = event.target as HTMLInputElement | null;
    if (!input?.files || input.files.length === 0) {
      this.resetFileSelection();
      return;
    }

    let file = input.files[0];
    this.setSelectedFile(file);
    input.value = '';
  }

  private setSelectedFile(file: File | null) {
    this.resetFileSelection();
    if (!file) {
      return;
    }

    let objectUrl = URL.createObjectURL(file);
    this.currentFileObjectUrl = objectUrl;
    this.selectedFile = file;
    this.args.model.sourceImageUrl = objectUrl;
  }

  private resetFileSelection(options?: { clearSource?: boolean }) {
    if (this.currentFileObjectUrl) {
      try {
        URL.revokeObjectURL(this.currentFileObjectUrl);
      } catch {
        // The URL may already be revoked; ignore.
      }
    }
    this.currentFileObjectUrl = null;
    this.selectedFile = null;
    const shouldClearSource =
      options?.clearSource ?? this.uploadMode === 'file';
    if (shouldClearSource) {
      this.args.model.sourceImageUrl = '';
    }
  }

  get selectedFileName() {
    return this.selectedFile?.name ?? 'No file selected';
  }

  get isFileMode() {
    return this.uploadMode === 'file';
  }

  get isUrlMode() {
    return this.uploadMode === 'url';
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
      this.currentCommand = command;
      let result = await command.execute({
        sourceImageUrl: this.args.model.sourceImageUrl,
        targetRealmUrl: this.args.model.targetRealmUrl,
      });

      // Store the card ID, which will trigger getCard to load it
      console.log('Upload result:', result);
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
    }
  }

  @action
  clearStatus() {
    this.errorMessage = null;
    this.args.model.sourceImageUrl = '';
    this.args.model.targetRealmUrl = '';
    this.args.model.resultImageId = '';
    this.cachedRemoteUrl = '';
    this.currentCommand = null;
    this.resetFileSelection();
  }

  @action
  openResultCard() {
    if (this.resultImageResource?.card) {
      this.args.viewCard?.(this.resultImageResource.card, 'isolated');
    }
  }

  override willDestroy(): void {
    super.willDestroy();
    this.resetFileSelection();
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
    {{! template-lint-disable no-invalid-interactive }}
    <form class='image-upload-tester' {{on 'submit' this.uploadImage}}>
      <div class='field-group'>
        <FieldContainer @label='Upload Type'>
          <div class='mode-toggle'>
            <label>
              <input
                type='radio'
                name='upload-mode'
                value='url'
                checked={{this.isUrlMode}}
                {{on 'change' (fn this.selectUploadMode 'url')}}
              />
              URL
            </label>
            <label>
              <input
                type='radio'
                name='upload-mode'
                value='file'
                checked={{this.isFileMode}}
                {{on 'change' (fn this.selectUploadMode 'file')}}
              />
              File
            </label>
          </div>
        </FieldContainer>

        {{#if this.isUrlMode}}
          <FieldContainer @label='Source Image URL'>
            <@fields.sourceImageUrl @format='edit' />
          </FieldContainer>
        {{/if}}

        {{#if this.isFileMode}}
          <FieldContainer @label='Select Image File'>
            <div class='file-input'>
              <input
                type='file'
                accept='image/*'
                aria-label='Select image file'
                {{on 'change' this.handleFileSelection}}
              />
              <span class='file-input__label'>{{this.selectedFileName}}</span>
            </div>
          </FieldContainer>
        {{/if}}

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

      .mode-toggle {
        display: flex;
        gap: var(--boxel-sp);
      }

      .mode-toggle label {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font: var(--boxel-font-sm);
      }

      .file-input {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .file-input__label {
        font: var(--boxel-font-sm);
        color: var(--boxel-500);
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
  @field targetRealmUrl = contains(RealmField);
  @field resultImageId = contains(StringField);

  static isolated = ImageUploadTesterIsolated;
}
