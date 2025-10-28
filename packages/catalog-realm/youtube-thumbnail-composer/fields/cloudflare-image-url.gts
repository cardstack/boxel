import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import UrlField from 'https://cardstack.com/base/url';
import StringField from 'https://cardstack.com/base/string';
import RealmField from 'https://cardstack.com/base/realm';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { not } from '@cardstack/boxel-ui/helpers';
import { Button, FieldContainer } from '@cardstack/boxel-ui/components';

import UploadImageCommand from '../../commands/upload-image';
import { CloudflareImage } from '../../cloudflare-image';

class Edit extends Component<typeof CloudflareImageUrlField> {
  @tracked isUploading = false;
  @tracked errorMessage: string | null = null;
  @tracked selectedFile: File | null = null;
  private currentFileObjectUrl: string | null = null;
  @tracked currentCommand: UploadImageCommand | null = null;
  fileInputId = `cf-file-${Math.random().toString(36).slice(2)}`;

  resultImageResource = this.args.context?.getCard(
    this,
    () => this.args.model?.resultImageId,
  );

  get canUpload() {
    if (this.isUploading) return false;
    if (!this.args.model?.targetRealmUrl) return false;
    return !!this.selectedFile;
  }

  get statusMessage() {
    if (this.errorMessage) return this.errorMessage;
    if (this.isUploading) return this.progressStatusMessage;
    if (this.args.model?.url) return 'Upload complete!';
    return 'Choose an image and realm to upload.';
  }

  get progressStatusMessage() {
    switch (this.currentCommand?.progressStep) {
      case 'requesting-direct-upload-url':
        return 'Requesting upload URL…';
      case 'parsing-data-uri':
        return 'Parsing data URI…';
      case 'fetching-local-file':
        return 'Preparing file…';
      case 'uploading-local-file':
        return 'Uploading file to Cloudflare…';
      case 'uploading-remote-url':
        return 'Uploading remote image to Cloudflare…';
      case 'saving-card':
        return 'Saving Cloudflare image card…';
      case 'completed':
        return 'Finalizing…';
      case 'error':
        return 'Upload failed.';
      default:
        return 'Uploading image…';
    }
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
    if (!file || !this.args.model) return;
    let objectUrl = URL.createObjectURL(file);
    this.currentFileObjectUrl = objectUrl;
    this.selectedFile = file;
    this.args.model.sourceImageUrl = objectUrl;
  }

  private resetFileSelection() {
    if (this.currentFileObjectUrl) {
      try {
        URL.revokeObjectURL(this.currentFileObjectUrl);
      } catch {}
    }
    this.currentFileObjectUrl = null;
    this.selectedFile = null;
    if (this.args.model) {
      this.args.model.sourceImageUrl = '';
    }
  }

  @action
  async uploadImage(event?: Event) {
    event?.preventDefault();
    if (!this.canUpload || !this.args.model) return;

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.errorMessage =
        'Command context unavailable. Open this card in the host app.';
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

      if (result.cardId) {
        // Store id so we can load the card and also provide a stable link
        this.args.model.resultImageId = result.cardId;
        // Load the saved CloudflareImage card to get its URL
        let resource = this.resultImageResource; // already bound to resultImageId
        // Wait a tick for resource to hydrate
        await Promise.resolve();
        let imageCard = resource?.card as CloudflareImage | undefined;
        if (imageCard) {
          // Set the URL directly from the CloudflareImage card
          this.args.model.url = imageCard.url;
        }
      }
    } catch (e) {
      this.errorMessage =
        e instanceof Error ? e.message : 'Unexpected error during upload.';
    } finally {
      this.isUploading = false;
    }
  }

  @action
  clearStatus() {
    if (!this.args.model) return;
    this.errorMessage = null;
    this.args.model.sourceImageUrl = '';
    this.args.model.targetRealmUrl = '';
    this.args.model.resultImageId = '';
    this.args.model.url = '';
    this.resetFileSelection();
  }

  <template>
    <div class='cf-url-field'>
      <div class='input-grid'>
        <FieldContainer @label='Source Image'>
          <input
            id={{this.fileInputId}}
            class='file-input__native'
            type='file'
            accept='image/*'
            aria-label='Select image file'
            {{on 'change' this.handleFileSelection}}
          />
          <div class='file-input'>
            <label class='file-button' for={{this.fileInputId}}>Choose File</label>
            <span class='file-input__label'>
              {{if this.selectedFile this.selectedFile.name 'No file selected'}}
            </span>
          </div>
        </FieldContainer>

        <FieldContainer @label='Target Realm URL'>
          <@fields.targetRealmUrl @format='edit' />
        </FieldContainer>
      </div>

      <div class='actions'>
        {{#if @model.url}}
          <Button @variant='secondary' {{on 'click' this.clearStatus}}>
            Reset
          </Button>
        {{else}}
          <Button
            @variant='primary'
            @disabled={{not this.canUpload}}
            {{on 'click' this.uploadImage}}
          >
            {{if this.isUploading 'Uploading…' 'Upload Image'}}
          </Button>
        {{/if}}
      </div>

      <div class='status'>
        {{this.statusMessage}}
      </div>

      {{#if @model.url}}
        <div class='result'>
          <div class='result__url'>{{@model.url}}</div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .cf-url-field {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-xs);
        background: var(--boxel-50);
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
      }
      .input-grid {
        display: grid;
        gap: var(--boxel-sp);
      }
      .file-input {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .file-input__native {
        display: none;
      }
      .file-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px 12px;
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-highlight);
        color: var(--boxel-900);
        cursor: pointer;
        user-select: none;
      }
      .file-button:hover {
        background: var(--boxel-300);
      }
      .file-input__label {
        font: var(--boxel-font-sm);
        color: var(--boxel-500);
      }
      .actions {
        display: flex;
        gap: var(--boxel-sp-sm);
      }
      .actions > * {
        flex-grow: 1;
      }
      .status {
        font: var(--boxel-font-sm);
        color: var(--boxel-600);
      }
      .result {
        padding: var(--boxel-sp);
        background: var(--boxel-highlight);
        border-radius: var(--boxel-border-radius);
      }
      .result__url {
        font-family: var(--boxel-font-mono);
        word-break: break-all;
      }
    </style>
  </template>
}

export class CloudflareImageUrlField extends FieldDef {
  static displayName = 'Cloudflare Image URL';

  // Inputs for upload flow
  @field sourceImageUrl = contains(UrlField);
  @field targetRealmUrl = contains(RealmField);

  // Store the id for resource loading convenience
  @field resultImageId = contains(StringField);
  // Store the URL directly to avoid circular dependency with linksTo
  @field url = contains(UrlField);

  static edit = Edit;
}
