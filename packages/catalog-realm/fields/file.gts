import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import UploadFileIcon from '@cardstack/boxel-icons/upload';
import CheckIcon from '@cardstack/boxel-icons/check';
import WarningIcon from '@cardstack/boxel-icons/circle-alert';
import {
  Button,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';
import { not, or } from '@cardstack/boxel-ui/helpers';
import UploadFileCommand from '@cardstack/boxel-host/commands/upload-file';

class UploadFileFieldEdit extends Component<typeof UploadFileField> {
  @tracked selectedFile: File | null = null;
  @tracked status: string | null = null;
  @tracked error: string | null = null;
  @tracked isUploading = false;

  get accept() {
    // audio, pdf, gltf/glb
    return 'audio/*,application/pdf,model/gltf+json,model/gltf-binary,application/octet-stream';
  }

  @action
  handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.error = null;
    this.status = this.selectedFile
      ? `Selected ${this.selectedFile.name}`
      : null;
  }

  private async fileToDataUri(file: File): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(new Error('Could not read file as data URI'));
        }
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  @action
  async uploadFile() {
    if (!this.selectedFile) {
      this.error = 'Please select a file first';
      return;
    }

    if (!this.args.context || !this.args.context.commandContext) {
      this.error = 'Command context is missing';
      return;
    }

    this.isUploading = true;
    this.status = null;
    this.error = null;

    try {
      const dataUri = await this.fileToDataUri(this.selectedFile);
      const command = new UploadFileCommand(this.args.context.commandContext);
      const result = await command.execute({
        fileName: this.selectedFile.name,
        contentType: this.selectedFile.type || 'application/octet-stream',
        fileDataUri: dataUri,
        keyPrefix: this.args.model.keyPrefix ?? 'uploads',
      });

      this.args.model.uploadedUrl = result?.uploadedUrl ?? null;
      this.args.model.etag = result?.etag ?? null;
      this.status = 'Upload complete';
    } catch (e: any) {
      this.error = e?.message ?? String(e);
    } finally {
      this.isUploading = false;
    }
  }

  @action
  clearFile() {
    this.selectedFile = null;
    this.status = null;
    this.error = null;
    this.args.model.uploadedUrl = null;
  }

  <template>
    <div class='upload-file-field'>
      <label class='upload-tile'>
        <div class='icon-circle'>
          <UploadFileIcon width='32' height='32' />
        </div>
        <div class='text'>
          <div class='title'>Select a file</div>
          <div class='subtitle'>Audio, PDF, GLTF/GLB</div>
          {{#if this.selectedFile}}
            <div class='selected'>{{this.selectedFile.name}}</div>
          {{/if}}
        </div>
        <input
          type='file'
          accept={{this.accept}}
          {{on 'change' this.handleFileSelect}}
          class='hidden-input'
        />
      </label>

      <div class='actions'>
        <Button
          @variant='primary'
          @disabled={{or (not this.selectedFile) this.isUploading}}
          {{on 'click' this.uploadFile}}
        >
          {{if this.isUploading 'Uploading...' 'Upload'}}
        </Button>
        {{#if (or this.selectedFile @model.uploadedUrl)}}
          <Button
            @variant='secondary'
            @disabled={{this.isUploading}}
            {{on 'click' this.clearFile}}
          >
            Clear
          </Button>
        {{/if}}
        {{#if this.status}}
          <div class='status success'>
            <CheckIcon width='16' height='16' />
            <span>{{this.status}}</span>
          </div>
        {{/if}}
        {{#if this.error}}
          <div class='status error'>
            <WarningIcon width='16' height='16' />
            <span>{{this.error}}</span>
          </div>
        {{/if}}
      </div>

      {{#if @model.uploadedUrl}}
        <div class='result'>
          <div class='result-label'>Uploaded URL</div>
          <div class='result-value'>{{@model.uploadedUrl}}</div>
          {{#if @model.etag}}
            <div class='result-meta'>ETag: {{@model.etag}}</div>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .upload-file-field {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .upload-tile {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        border: 1px dashed var(--border, #e5e7eb);
        border-radius: 0.75rem;
        cursor: pointer;
        transition:
          border-color 0.2s,
          background 0.2s;
      }

      .upload-tile:hover {
        border-color: var(--primary, #2563eb);
        background: var(--accent, #f0f9ff);
      }

      .icon-circle {
        width: 3rem;
        height: 3rem;
        border-radius: 999px;
        background: var(--accent, #f0f9ff);
        display: grid;
        place-items: center;
        color: var(--primary, #2563eb);
      }

      .text {
        flex: 1;
      }

      .title {
        font-weight: 600;
        color: var(--foreground, #111827);
      }

      .subtitle {
        color: var(--muted-foreground, #6b7280);
        font-size: 0.9rem;
      }

      .selected {
        margin-top: 0.35rem;
        color: var(--foreground, #111827);
        font-size: 0.9rem;
      }

      .hidden-input {
        display: none;
      }

      .actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.9rem;
      }

      .status.success {
        color: var(--success, #0f766e);
      }

      .status.error {
        color: var(--danger, #b91c1c);
      }

      .result {
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 0.75rem;
        padding: 0.75rem;
        background: var(--card, #fff);
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .result-label {
        font-weight: 600;
        color: var(--foreground, #111827);
      }

      .result-value {
        word-break: break-all;
        color: var(--muted-foreground, #4b5563);
      }

      .result-meta {
        color: var(--muted-foreground, #6b7280);
        font-size: 0.85rem;
      }
    </style>
  </template>
}

export default class UploadFileField extends FieldDef {
  @field keyPrefix = contains(StringField); // optional folder prefix in bucket
  @field uploadedUrl = contains(StringField);

  static edit = UploadFileFieldEdit;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if @model.uploadedUrl}}
        <div class='file-display'>
          <CheckIcon width='16' height='16' class='file-icon' />
          <a
            href={{@model.uploadedUrl}}
            target='_blank'
            rel='noopener noreferrer'
            class='file-link'
          >
            {{@model.uploadedUrl}}
          </a>
        </div>
      {{else}}
        <div class='file-empty'>No file uploaded</div>
      {{/if}}

      <style scoped>
        .file-display {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          background: var(--accent, #f0f9ff);
          border-radius: 0.5rem;
          font-size: 0.875rem;
        }

        .file-icon {
          color: var(--success, #0f766e);
          flex-shrink: 0;
        }

        .file-link {
          color: var(--primary, #2563eb);
          text-decoration: none;
          word-break: break-all;
        }

        .file-link:hover {
          text-decoration: underline;
        }

        .file-empty {
          color: var(--muted-foreground, #6b7280);
          font-size: 0.875rem;
          font-style: italic;
        }
      </style>
    </template>
  };
}
