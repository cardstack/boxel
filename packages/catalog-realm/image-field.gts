import { or, not } from '@cardstack/boxel-ui/helpers';
import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { Button } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';
import { restartableTask } from 'ember-concurrency';

class ImageFieldEdit extends Component<typeof ImageField> {
  @tracked selectedFile: File | null = null;
  @tracked uploadStatus = '';

  @action
  handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] || null;
    this.uploadStatus = this.selectedFile
      ? `Selected: ${this.selectedFile.name}`
      : '';
  }

  generateUploadUrlTask = restartableTask(async () => {
    this.uploadStatus = 'Generating upload URL...';

    try {
      if (!this.args.context || !this.args.context.commandContext) {
        throw new Error('Missing command context for proxy request');
      }

      const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
        this.args.context.commandContext,
      );

      const result = await sendRequestViaProxyCommand.execute({
        url: 'https://api.cloudflare.com/client/v4/accounts/4a94a1eb2d21bbbe160234438a49f687/images/v2/direct_upload',
        method: 'POST',
        multipart: true,
        requestBody: JSON.stringify({
          id: `upload-${Date.now()}`,
          requireSignedURLs: 'false',
          metadata: JSON.stringify({
            source: 'boxel-image-field',
            timestamp: new Date().toISOString(),
          }),
        }),
      });

      if (result.response.ok) {
        const data = await result.response.json();
        if (data.success && data.result) {
          this.args.model.uploadUrl = data.result.uploadURL;
          this.uploadStatus = 'Ready to upload!';
        } else {
          throw new Error('Failed to get upload URL from response');
        }
      } else {
        let errorBody = '';

        try {
          const errorText = await result.response.text();
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.errors && Array.isArray(errorJson.errors)) {
              const cloudflareErrors = errorJson.errors
                .map((err: any) => `Code ${err.code}: ${err.message}`)
                .join('\n');
              errorBody = `Cloudflare API Errors:\n${cloudflareErrors}`;
            } else {
              errorBody = JSON.stringify(errorJson, null, 2);
            }
          } catch (jsonError) {
            errorBody = errorText;
          }
        } catch (parseError) {
          errorBody = '[Could not read response body]';
        }

        throw new Error(
          `Cloudflare API Error (${result.response.status})\n\n${errorBody}`,
        );
      }
    } catch (error: any) {
      console.error('Upload URL generation error:', error);
      this.uploadStatus = `Failed to generate upload URL: ${error.message}`;
    }
  });

  uploadImageTask = restartableTask(async () => {
    if (!this.selectedFile) {
      this.uploadStatus = 'Please select a file first';
      return;
    }

    // Generate fresh upload URL first
    await this.generateUploadUrlTask.perform();

    if (!this.args.model.uploadUrl) {
      return; // Error already set by generateUploadUrlTask
    }

    this.uploadStatus = 'Uploading...';

    try {
      const formData = new FormData();
      formData.append('file', this.selectedFile);

      const response = await fetch(this.args.model.uploadUrl, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        const imageUrl = result.result?.variants?.[0] || result.result?.id;
        this.args.model.uploadedImageUrl = imageUrl;
        this.uploadStatus = 'Upload successful!';
      } else {
        throw new Error(
          `Upload failed: ${response.status} ${response.statusText}`,
        );
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      this.uploadStatus = `Upload failed: ${error.message}`;
    }
  });

  <template>
    <div class='image-field-container'>
      <div class='upload-section'>
        <div class='file-select-row'>
          <input
            id='image-file-input'
            type='file'
            accept='image/*'
            {{on 'change' this.handleFileSelect}}
            class='file-input'
          />
        </div>

        {{#if this.uploadStatus}}
          <div class='status-message'>{{this.uploadStatus}}</div>
        {{/if}}

        <Button
          @variant='primary'
          @disabled={{or
            this.uploadImageTask.isRunning
            this.generateUploadUrlTask.isRunning
            (not this.selectedFile)
          }}
          {{on 'click' this.uploadImageTask.perform}}
          class='upload-button'
        >
          {{if this.uploadImageTask.isRunning 'Uploading...' 'Upload Image'}}
        </Button>
      </div>

      {{#if @model.uploadedImageUrl}}
        <div class='image-preview'>
          <img
            src={{@model.uploadedImageUrl}}
            alt='Uploaded'
            class='preview-image'
          />
        </div>
      {{/if}}
    </div>

    <style scoped>
      .image-field-container {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .upload-section {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .file-select-row {
        display: flex;
        gap: 0.5rem;
        align-items: stretch;
      }
      .file-input {
        flex: 1;
        padding: 0.5rem;
        border: 1px solid #d1d5db;
        border-radius: 0.375rem;
        font-size: 0.875rem;
      }
      .file-input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .upload-button {
        width: 100%;
        padding: 0.625rem 1rem;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 0.375rem;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
      }
      .upload-button:hover:not(:disabled) {
        background: #2563eb;
      }
      .upload-button:disabled {
        background: #9ca3af;
        cursor: not-allowed;
      }
      .status-message {
        padding: 0.5rem;
        border-radius: 0.375rem;
        background: #f3f4f6;
        border-left: 3px solid #3b82f6;
        font-size: 0.8125rem;
        white-space: pre-wrap;
      }
      .image-preview {
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        padding: 0.75rem;
        background: #f9fafb;
      }
      .preview-image {
        max-width: 100%;
        max-height: 300px;
        border-radius: 0.375rem;
        display: block;
      }
    </style>
  </template>
}

export class ImageField extends FieldDef {
  static displayName = 'Image';

  @field uploadUrl = contains(StringField);
  @field uploadedImageUrl = contains(StringField);

  static edit = ImageFieldEdit;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if @model.uploadedImageUrl}}
        <div class='embedded-image'>
          <img
            src={{@model.uploadedImageUrl}}
            alt='Uploaded'
            class='embedded-img'
          />
        </div>
      {{else}}
        <div class='no-image'>No image uploaded</div>
      {{/if}}

      <style scoped>
        .embedded-image {
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .embedded-img {
          max-width: 100%;
          max-height: 200px;
          border-radius: 0.375rem;
        }
        .no-image {
          padding: 1rem;
          text-align: center;
          color: #9ca3af;
          font-size: 0.875rem;
          font-style: italic;
        }
      </style>
    </template>
  };
}
