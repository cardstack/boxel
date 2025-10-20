import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ImageIcon from '@cardstack/boxel-icons/image';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { Button } from '@cardstack/boxel-ui/components';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';

export class CloudImage extends CardDef {
  static displayName = 'Cloud Image';
  static icon = ImageIcon;

  // Cloudflare Images configuration for all subclasses
  static cloudflareConfig = {
    imageDeliveryUrl: 'https://imagedelivery.net/TB1OM65i5Go9UkT2wcBzeA', // Using correct account hash
  };

  @field sourceFileURL = contains(StringField);
  @field originalFileName = contains(StringField);
  @field cloudflareImageId = contains(StringField);
  @field uploadTimestamp = contains(StringField);

  // Override the inherited thumbnailURL field to use our Cloudflare image
  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: CloudImage) {
      if (!this.cloudflareImageId) return '';

      const deliveryUrl = (this.constructor as typeof CloudImage)
        .cloudflareConfig.imageDeliveryUrl;
      return `${deliveryUrl}/${this.cloudflareImageId}/w=400,h=300,fit=cover,f=auto,q=85`;
    },
  });

  // Computed field for full-size image URL
  @field imageURL = contains(StringField, {
    computeVia: function (this: CloudImage) {
      if (!this.cloudflareImageId) return '';

      const deliveryUrl = (this.constructor as typeof CloudImage)
        .cloudflareConfig.imageDeliveryUrl;
      return `${deliveryUrl}/${this.cloudflareImageId}/public`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    @tracked isDragOver = false;
    @tracked isUploading = false;
    @tracked uploadError = '';
    @tracked isUploadingFromFile = false;

    get hasImage() {
      return (
        !!this.args.model.cloudflareImageId &&
        this.args.model.cloudflareImageId.trim() !== ''
      );
    }

    get hasSourceFile() {
      return (
        !!this.args.model.sourceFileURL &&
        this.args.model.sourceFileURL.trim() !== '' &&
        this.args.model.sourceFileURL.includes('.txt')
      );
    }

    @action
    handleFileSelect(event: Event) {
      const input = event.target as HTMLInputElement;
      if (input.files && input.files[0]) {
        this.uploadFile(input.files[0]);
      }
    }

    @action
    handleDragOver(event: DragEvent) {
      event.preventDefault();
      this.isDragOver = true;
    }

    @action
    handleDragLeave(event: DragEvent) {
      event.preventDefault();
      this.isDragOver = false;
    }

    @action
    handleDrop(event: DragEvent) {
      event.preventDefault();
      this.isDragOver = false;

      const files = event.dataTransfer?.files;
      if (files && files[0]) {
        this.uploadFile(files[0]);
      }
    }

    @action
    triggerFileInput() {
      const input = document.querySelector('.file-input') as HTMLInputElement;
      input?.click();
    }

    async uploadFile(file: File) {
      if (!file.type.startsWith('image/')) {
        this.uploadError = 'Please select an image file';
        return;
      }

      this.isUploading = true;
      this.uploadError = '';

      try {
        // Step 1: Get direct upload URL from Cloudflare
        const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
          this.args.context.commandContext,
        );

        const uploadUrlResponse = await sendRequestViaProxyCommand.execute({
          url: 'https://api.cloudflare.com/client/v4/accounts/4a94a1eb2d21bbbe160234438a49f687/images/v2/direct_upload',
          method: 'POST',
          multipart: true,
          requestBody: JSON.stringify({
            id: `upload-${Date.now()}`,
            requireSignedURLs: 'false',
            metadata: JSON.stringify({
              source: 'boxel-upload',
              originalName: file.name,
              timestamp: new Date().toISOString(),
            }),
          }),
        });

        if (!uploadUrlResponse.response.ok) {
          throw new Error(
            `Failed to get upload URL: ${uploadUrlResponse.response.status}`,
          );
        }

        const uploadUrlData = await uploadUrlResponse.response.json();

        if (!uploadUrlData.success || !uploadUrlData.result?.uploadURL) {
          throw new Error('Failed to get upload URL from Cloudflare');
        }

        // Step 2: Upload file directly using FormData
        const formData = new FormData();
        formData.append('file', file);

        const uploadResponse = await fetch(uploadUrlData.result.uploadURL, {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.status}`);
        }

        const uploadResult = await uploadResponse.json();

        if (!uploadResult.success || !uploadResult.result?.id) {
          throw new Error('Upload succeeded but no image ID returned');
        }

        // Update the card with the upload results
        this.args.model.originalFileName = file.name;
        this.args.model.cloudflareImageId = uploadResult.result.id;
        this.args.model.uploadTimestamp = new Date().toISOString();
      } catch (error) {
        console.error('Upload error:', error);
        this.uploadError = 'Upload failed. Please try again.';
      } finally {
        this.isUploading = false;
      }
    }

    @action
    async uploadFromSourceFile() {
      if (!this.args.model.sourceFileURL) {
        this.uploadError = 'No source file URL provided';
        return;
      }

      this.isUploadingFromFile = true;
      this.uploadError = '';

      try {
        // Fetch the base64 file directly from the URL (same approach as image viewer)
        const response = await fetch(this.args.model.sourceFileURL);

        if (!response.ok) {
          throw new Error(
            `Failed to read base64 file from realm: ${response.statusText}`,
          );
        }

        const base64Content = await response.text();

        // Ensure it's a valid base64 data URL or raw base64
        let base64Data: string;
        if (base64Content.startsWith('data:image/')) {
          // It's already a data URL, extract the base64 part
          base64Data = base64Content.split(',')[1];
        } else {
          // It's raw base64, use as is
          base64Data = base64Content;
        }

        // Convert base64 to blob for Cloudinary upload
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/png' });

        // Step 1: Get direct upload URL from Cloudflare
        const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
          this.args.context.commandContext,
        );

        const uploadUrlResponse = await sendRequestViaProxyCommand.execute({
          url: 'https://api.cloudflare.com/client/v4/accounts/4a94a1eb2d21bbbe160234438a49f687/images/v2/direct_upload',
          method: 'POST',
          multipart: true,
          requestBody: JSON.stringify({
            id: `base64-upload-${Date.now()}`,
            requireSignedURLs: 'false',
            metadata: JSON.stringify({
              source: 'boxel-base64-upload',
              originalName:
                this.args.model.originalFileName || 'base64-image.png',
              timestamp: new Date().toISOString(),
            }),
          }),
        });

        if (!uploadUrlResponse.response.ok) {
          throw new Error(
            `Failed to get upload URL: ${uploadUrlResponse.response.status}`,
          );
        }

        const uploadUrlData = await uploadUrlResponse.response.json();

        if (!uploadUrlData.success || !uploadUrlData.result?.uploadURL) {
          throw new Error('Failed to get upload URL from Cloudflare');
        }

        // Step 2: Upload blob directly using FormData
        const formData = new FormData();
        formData.append('file', blob, 'base64-image.png');

        const cloudflareResponse = await fetch(uploadUrlData.result.uploadURL, {
          method: 'POST',
          body: formData,
        });

        if (!cloudflareResponse.ok) {
          throw new Error('Failed to upload to Cloudflare');
        }

        const cloudflareResult = await cloudflareResponse.json();

        if (!cloudflareResult.success || !cloudflareResult.result?.id) {
          throw new Error('Upload succeeded but no image ID returned');
        }

        // Update the card with the upload results
        this.args.model.originalFileName =
          this.args.model.originalFileName || 'base64-image.png';
        this.args.model.cloudflareImageId = cloudflareResult.result.id;
        this.args.model.uploadTimestamp = new Date().toISOString();

        console.log('Successfully uploaded base64 file to Cloudflare');
      } catch (error) {
        console.error('Upload from source file error:', error);
        this.uploadError = `Failed to upload from source file: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
      } finally {
        this.isUploadingFromFile = false;
      }
    }

    <template>
      <div
        class='cloud-image-isolated {{if this.isDragOver "drag-over"}}'
        {{on 'dragover' this.handleDragOver}}
        {{on 'dragleave' this.handleDragLeave}}
        {{on 'drop' this.handleDrop}}
      >
        <!-- Hidden file input -->
        <input
          type='file'
          accept='image/*'
          class='file-input'
          style='display: none;'
          {{on 'change' this.handleFileSelect}}
        />

        {{#if this.isUploading}}
          <!-- Upload Progress State -->
          <div class='state-container upload-progress'>
            <div class='content-area'>
              <div class='loading-indicator'>
                <div class='pulse-ring'>
                  <div class='pulse-core'></div>
                </div>
                <h2 class='state-title'>Processing Upload</h2>
                <p class='state-description'>
                  Your image is being optimized and delivered to the global CDN
                </p>
              </div>
            </div>
          </div>
        {{else if this.isUploadingFromFile}}
          <!-- Base64 Processing State -->
          <div class='state-container upload-progress'>
            <div class='content-area'>
              <div class='loading-indicator'>
                <div class='pulse-ring'>
                  <div class='pulse-core'></div>
                </div>
                <h2 class='state-title'>Processing Base64 File</h2>
                <p class='state-description'>
                  Converting and uploading to Cloudflare for optimized delivery
                </p>
              </div>
            </div>
          </div>
        {{else if this.hasImage}}
          <!-- Image Display State -->
          <div class='state-container image-display'>
            <!-- Hero Image Section -->
            <section class='hero-section'>
              <div class='image-viewport'>
                <div class='image-container'>
                  <img
                    src={{@model.imageURL}}
                    alt={{if
                      @model.originalFileName
                      @model.originalFileName
                      'Cloud Image'
                    }}
                    class='hero-image'
                    loading='lazy'
                    onerror="this.style.display='none'"
                  />
                </div>
              </div>
            </section>

            <!-- Metadata Panel -->
            <section class='metadata-section'>
              <header class='metadata-header'>
                <div class='title-group'>
                  <h1
                    class='asset-title
                      {{unless @model.cardInfo.title "filename-fallback"}}'
                  >
                    {{if
                      @model.cardInfo.title
                      @model.cardInfo.title
                      (if
                        @model.originalFileName
                        @model.originalFileName
                        'Untitled Asset'
                      )
                    }}
                  </h1>
                  {{#if @model.cardInfo.description}}
                    <p
                      class='asset-description'
                    >{{@model.cardInfo.description}}</p>
                  {{/if}}
                  {{#if @model.uploadTimestamp}}
                    <time class='upload-timestamp'>
                      Uploaded
                      {{formatDateTime @model.uploadTimestamp size='medium'}}
                    </time>
                  {{/if}}
                </div>
              </header>

              <div class='metadata-content'>
                <!-- Asset Details -->
                <div class='detail-group'>
                  <h3 class='group-label'>Asset Information</h3>
                  <div class='detail-grid'>
                    <div class='detail-item'>
                      <label class='detail-label'>Asset ID</label>
                      <code
                        class='detail-value mono'
                      >{{@model.cloudflareImageId}}</code>
                    </div>
                    {{#if @model.originalFileName}}
                      <div class='detail-item'>
                        <label class='detail-label'>{{if
                            @model.cardInfo.title
                            'Original File Name'
                            'File Name'
                          }}</label>
                        <span
                          class='detail-value'
                        >{{@model.originalFileName}}</span>
                      </div>
                    {{/if}}
                  </div>
                </div>

                <!-- Delivery URLs -->
                <div class='detail-group'>
                  <h3 class='group-label'>Delivery URLs</h3>
                  <div class='url-group'>
                    <div class='url-field'>
                      <label class='detail-label'>Optimized Thumbnail</label>
                      <div class='url-input-group'>
                        <code class='url-display'>{{@model.thumbnailURL}}</code>
                        <button class='copy-btn' type='button' title='Copy URL'>
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <rect
                              x='9'
                              y='9'
                              width='13'
                              height='13'
                              rx='2'
                              ry='2'
                            />
                            <path
                              d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div class='url-field'>
                      <label class='detail-label'>Full Resolution</label>
                      <div class='url-input-group'>
                        <code class='url-display'>{{@model.imageURL}}</code>
                        <button class='copy-btn' type='button' title='Copy URL'>
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <rect
                              x='9'
                              y='9'
                              width='13'
                              height='13'
                              rx='2'
                              ry='2'
                            />
                            <path
                              d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        {{else if this.hasSourceFile}}
          <!-- Base64 Source Available State -->
          <div class='state-container source-ready'>
            <div class='content-area'>
              <div class='state-icon-wrapper'>
                <svg
                  class='state-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z'
                  />
                  <polyline points='14,2 14,8 20,8' />
                </svg>
              </div>
              <h2 class='state-title'>Base64 File Ready</h2>
              <p class='state-description'>
                A base64 image file is available in your realm. Convert it to an
                optimized asset for better performance.
              </p>

              <div class='source-info'>
                <label class='info-label'>Source File</label>
                <code class='source-path'>{{@model.sourceFileURL}}</code>
              </div>

              <Button
                class='primary-action'
                @disabled={{this.isUploadingFromFile}}
                {{on 'click' this.uploadFromSourceFile}}
              >
                {{#if this.isUploadingFromFile}}
                  <div class='button-spinner'></div>
                  Processing...
                {{else}}
                  <svg
                    class='button-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                    <polyline points='7,10 12,15 17,10' />
                    <line x1='12' y1='15' x2='12' y2='3' />
                  </svg>
                  Convert to Asset
                {{/if}}
              </Button>
            </div>
          </div>
        {{else}}
          <!-- Upload Ready State -->
          <div class='state-container upload-ready'>
            <div class='content-area'>
              <div class='upload-zone'>
                <div class='upload-icon-wrapper'>
                  <ImageIcon class='upload-icon' />
                </div>
                <h2 class='state-title'>Upload Image Asset</h2>
                <p class='state-description'>
                  Drag and drop your image here, or click below to select a file
                  from your device.
                </p>

                <Button
                  class='primary-action'
                  {{on 'click' this.triggerFileInput}}
                >
                  <svg
                    class='button-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                    <polyline points='7,10 12,15 17,10' />
                    <line x1='12' y1='15' x2='12' y2='3' />
                  </svg>
                  Choose File
                </Button>
              </div>
            </div>
          </div>
        {{/if}}

        <!-- Error State -->
        {{#if this.uploadError}}
          <div class='error-alert'>
            <svg
              class='error-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <line x1='15' y1='9' x2='9' y2='15' />
              <line x1='9' y1='9' x2='15' y2='15' />
            </svg>
            <span class='error-message'>{{this.uploadError}}</span>
          </div>
        {{/if}}

        <!-- Drag Overlay -->
        {{#if this.isDragOver}}
          <div class='drag-overlay'>
            <div class='drag-content'>
              <div class='drag-icon-wrapper'>
                <ImageIcon class='drag-icon' />
              </div>
              <h3 class='drag-title'>Drop to Upload</h3>
              <p class='drag-subtitle'>Your image will be processed instantly</p>
            </div>
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* Main Container */
        .cloud-image-isolated {
          width: 100%;
          height: 100%;
          position: relative;
          font-family: var(--font-sans, 'Poppins', sans-serif);
          color: var(--foreground, #000000);
          background: var(--background, #ffffff);
          transition: background-color 0.2s ease;
          overflow-y: auto;
        }

        .cloud-image-isolated.drag-over {
          background: var(--muted, #f8f7fa);
        }

        /* State Containers */
        .state-container {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .content-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 3rem 2rem;
          text-align: center;
          max-width: 600px;
          margin: 0 auto;
        }

        /* Image Display Layout */
        .image-display {
          flex-direction: column;
        }

        .hero-section {
          flex: 1;
          background: linear-gradient(
            135deg,
            var(--muted, #f8f7fa) 0%,
            var(--accent, #e8e8e8) 100%
          );
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          min-height: 60vh;
        }

        .image-viewport {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }

        .image-container {
          position: relative;
          max-width: 100%;
          max-height: 100%;
          border-radius: calc(var(--radius, 0.625rem) * 0.8);
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
          background: var(--card, #ffffff);
          transition: transform 0.3s ease;
        }

        .image-container:hover {
          transform: scale(1.02);
        }

        .hero-image {
          width: 100%;
          height: auto;
          max-height: 60vh;
          object-fit: contain;
          display: block;
        }

        /* Metadata Panel */
        .metadata-section {
          width: 100%;
          background: var(--background, #ffffff);
          border-top: 1px solid var(--border, #d3d3d3);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }

        .metadata-header {
          padding: 2rem 2rem 1.5rem;
          border-bottom: 1px solid var(--border, #d3d3d3);
        }

        .asset-title {
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--foreground, #000000);
          margin: 0 0 0.5rem 0;
          line-height: 1.3;
          word-break: break-word;
        }

        .asset-title.filename-fallback {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--muted-foreground, #272330);
        }

        .asset-description {
          font-size: 1rem;
          color: var(--muted-foreground, #272330);
          margin: 0.5rem 0 0.75rem 0;
          line-height: 1.4;
          opacity: 0.9;
        }

        .upload-timestamp {
          font-size: 0.875rem;
          color: var(--muted-foreground, #272330);
          opacity: 0.7;
        }

        .metadata-content {
          flex: 1;
          padding: 1.5rem 2rem 2rem;
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        .detail-group {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .group-label {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground, #000000);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 0;
        }

        .detail-grid {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }

        .detail-label {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--muted-foreground, #272330);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          opacity: 0.8;
        }

        .detail-value {
          font-size: 0.75rem;
          color: var(--foreground, #000000);
          font-weight: 400;
        }

        .detail-value.mono {
          font-family: var(--font-mono, 'Roboto Mono', monospace);
          background: var(--muted, #f8f7fa);
          padding: 0.5rem 0.75rem;
          border-radius: calc(var(--radius, 0.625rem) * 0.6);
          border: 1px solid var(--border, #d3d3d3);
          word-break: break-all;
          font-size: 0.75rem;
        }

        /* URL Fields */
        .url-group {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .url-field {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .url-input-group {
          display: flex;
          background: var(--muted, #f8f7fa);
          border: 1px solid var(--border, #d3d3d3);
          border-radius: calc(var(--radius, 0.625rem) * 0.6);
          overflow: hidden;
        }

        .url-display {
          flex: 1;
          font-family: var(--font-mono, 'Roboto Mono', monospace);
          font-size: 0.6875rem;
          padding: 0.625rem 0.75rem;
          color: var(--muted-foreground, #272330);
          background: transparent;
          border: none;
          word-break: break-all;
          line-height: 1.4;
          margin: 0;
        }

        .copy-btn {
          width: 2.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--card, #ffffff);
          border: none;
          border-left: 1px solid var(--border, #d3d3d3);
          color: var(--muted-foreground, #272330);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .copy-btn:hover {
          background: var(--accent, #e8e8e8);
          color: var(--foreground, #000000);
        }

        .copy-btn svg {
          width: 1rem;
          height: 1rem;
        }

        /* Loading States */
        .loading-indicator {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.5rem;
        }

        .pulse-ring {
          position: relative;
          width: 80px;
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .pulse-core {
          width: 24px;
          height: 24px;
          background: var(--primary, #00ffba);
          border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }

        .pulse-ring::before {
          content: '';
          position: absolute;
          width: 100%;
          height: 100%;
          border: 2px solid var(--primary, #00ffba);
          border-radius: 50%;
          opacity: 0.3;
          animation: ring-pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.1);
          }
        }

        @keyframes ring-pulse {
          0% {
            transform: scale(0.8);
            opacity: 0.3;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.1;
          }
          100% {
            transform: scale(1.3);
            opacity: 0;
          }
        }

        /* Upload Zone */
        .upload-zone {
          width: 100%;
          max-width: 500px;
          padding: 3rem 2rem;
          border: 2px dashed var(--border, #d3d3d3);
          border-radius: var(--radius, 0.625rem);
          background: var(--muted, #f8f7fa);
          transition: all 0.3s ease;
        }

        .upload-zone:hover {
          border-color: var(--primary, #00ffba);
          background: var(--accent, #e8e8e8);
        }

        .state-icon-wrapper,
        .upload-icon-wrapper {
          width: 80px;
          height: 80px;
          background: var(--accent, #e8e8e8);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
        }

        .state-icon,
        .upload-icon {
          width: 40px;
          height: 40px;
          color: var(--muted-foreground, #272330);
        }

        /* Typography */
        .state-title {
          font-size: 1.5rem;
          font-weight: 600;
          color: var(--foreground, #000000);
          margin: 0 0 0.75rem 0;
          line-height: 1.3;
        }

        .state-description {
          font-size: 1rem;
          color: var(--muted-foreground, #272330);
          line-height: 1.5;
          margin: 0 0 2rem 0;
          opacity: 0.8;
        }

        /* Source Info */
        .source-info {
          width: 100%;
          background: var(--card, #ffffff);
          padding: 1.5rem;
          border-radius: calc(var(--radius, 0.625rem) * 0.8);
          border: 1px solid var(--border, #d3d3d3);
          margin-bottom: 2rem;
          text-align: left;
        }

        .info-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--muted-foreground, #272330);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.5rem;
          opacity: 0.8;
        }

        .source-path {
          font-family: var(--font-mono, 'Roboto Mono', monospace);
          font-size: 0.75rem;
          color: var(--foreground, #000000);
          word-break: break-all;
          line-height: 1.4;
        }

        /* Buttons */
        .primary-action {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.875rem 2rem;
          background: var(--primary, #00ffba);
          color: var(--primary-foreground, #000000);
          border: none;
          border-radius: calc(var(--radius, 0.625rem) * 0.8);
          font-family: var(--font-sans, 'Poppins', sans-serif);
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: var(--shadow, 0 1px 3px 0 rgba(0 0 0 / 25%));
        }

        .primary-action:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 255, 186, 0.3);
        }

        .primary-action:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .button-icon {
          width: 1.25rem;
          height: 1.25rem;
        }

        .button-spinner {
          width: 1.25rem;
          height: 1.25rem;
          border: 2px solid rgba(0, 0, 0, 0.3);
          border-top: 2px solid currentColor;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        /* Error Alert */
        .error-alert {
          position: absolute;
          bottom: 2rem;
          left: 2rem;
          right: 2rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          background: rgba(255, 80, 80, 0.1);
          color: var(--destructive, #ff5050);
          padding: 1rem 1.25rem;
          border-radius: calc(var(--radius, 0.625rem) * 0.8);
          border: 1px solid rgba(255, 80, 80, 0.2);
        }

        .error-icon {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
        }

        .error-message {
          font-size: 0.875rem;
          font-weight: 500;
        }

        /* Drag Overlay */
        .drag-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 255, 186, 0.05);
          border: 2px dashed var(--primary, #00ffba);
          border-radius: var(--radius, 0.625rem);
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(8px);
          z-index: 100;
        }

        .drag-content {
          text-align: center;
          padding: 2rem;
          background: var(--card, #ffffff);
          border-radius: calc(var(--radius, 0.625rem) * 0.8);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        }

        .drag-icon-wrapper {
          width: 80px;
          height: 80px;
          background: var(--primary, #00ffba);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1rem;
        }

        .drag-icon {
          width: 40px;
          height: 40px;
          color: var(--primary-foreground, #000000);
        }

        .drag-title {
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--foreground, #000000);
          margin: 0 0 0.5rem 0;
        }

        .drag-subtitle {
          font-size: 0.875rem;
          color: var(--muted-foreground, #272330);
          opacity: 0.8;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
          .hero-section {
            min-height: 50vh;
          }

          .hero-image {
            max-height: 50vh;
          }

          .content-area {
            padding: 2rem 1.5rem;
          }

          .state-title {
            font-size: 1.25rem;
          }

          .state-description {
            font-size: 0.875rem;
          }

          .metadata-header {
            padding: 1.5rem 1.5rem 1rem;
          }

          .metadata-content {
            padding: 1rem 1.5rem 1.5rem;
          }
        }

        /* Focus States */
        .primary-action:focus-visible,
        .copy-btn:focus-visible {
          outline: 2px solid var(--primary, #00ffba);
          outline-offset: 2px;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get hasImage() {
      return (
        !!this.args.model.cloudflareImageId &&
        this.args.model.cloudflareImageId.trim() !== ''
      );
    }

    <template>
      <div class='cloud-image-embedded'>
        {{#if this.hasImage}}
          <div class='image-container'>
            <!-- Hero Image Display -->
            <div class='image-display'>
              <img
                src={{@model.thumbnailURL}}
                alt={{if
                  @model.cardInfo.title
                  @model.cardInfo.title
                  (if
                    @model.originalFileName
                    @model.originalFileName
                    'Cloud Image'
                  )
                }}
                class='embedded-image'
                loading='lazy'
                onerror="this.style.display='none'"
              />
            </div>

            <!-- Content Overlay -->
            <div class='content-overlay'>
              <div class='content-header'>
                <h3 class='asset-title'>
                  {{if
                    @model.cardInfo.title
                    @model.cardInfo.title
                    (if
                      @model.originalFileName
                      @model.originalFileName
                      'Untitled Asset'
                    )
                  }}
                </h3>
                {{#if @model.cardInfo.description}}
                  <p
                    class='asset-description'
                  >{{@model.cardInfo.description}}</p>
                {{/if}}
              </div>

            </div>
          </div>
        {{else}}
          <div class='empty-state'>
            <div class='empty-content'>
              <div class='empty-icon-wrapper'>
                <svg
                  class='empty-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                  <circle cx='9' cy='9' r='2' />
                  <path d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
                </svg>
              </div>
              <div class='empty-text'>
                <span class='empty-title'>No Image Asset</span>
                <span class='empty-hint'>Upload an image to display here</span>
              </div>
            </div>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .cloud-image-embedded {
          width: 100%;
          height: 100%;
          font-family: var(--font-sans, 'Poppins', sans-serif);
          position: relative;
          border-radius: calc(var(--radius, 0.625rem) * 0.8);
          overflow: hidden;
          background: var(--background, #ffffff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        /* Image Container */
        .image-container {
          width: 100%;
          height: 100%;
          position: relative;
          display: flex;
          flex-direction: column;
        }

        .image-display {
          flex: 1;
          position: relative;
          background: linear-gradient(
            135deg,
            var(--muted, #f8f7fa) 0%,
            var(--accent, #e8e8e8) 50%,
            var(--muted, #f8f7fa) 100%
          );
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .embedded-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.3s ease;
        }

        .image-container:hover .embedded-image {
          transform: scale(1.05);
        }

        /* Content Overlay */
        .content-overlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(
            to top,
            rgba(0, 0, 0, 0.8) 0%,
            rgba(0, 0, 0, 0.4) 50%,
            transparent 100%
          );
          padding: 1rem;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          color: white;
        }

        .content-header {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        }

        .asset-title {
          font-size: 1rem;
          font-weight: 600;
          color: white;
          margin: 0 0 0.25rem 0;
          line-height: 1.3;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .asset-description {
          font-size: 0.8125rem;
          color: rgba(255, 255, 255, 0.9);
          margin: 0;
          line-height: 1.4;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* Empty State */
        .empty-state {
          width: 100%;
          height: 100%;
          background: linear-gradient(
            135deg,
            var(--muted, #f8f7fa) 0%,
            var(--accent, #e8e8e8) 100%
          );
          border: 2px dashed var(--border, #d3d3d3);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: calc(var(--radius, 0.625rem) * 0.8);
        }

        .empty-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 1.5rem;
          max-width: 280px;
        }

        .empty-icon-wrapper {
          width: 64px;
          height: 64px;
          background: var(--background, #ffffff);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .empty-icon {
          width: 32px;
          height: 32px;
          color: var(--muted-foreground, #272330);
          opacity: 0.6;
        }

        .empty-text {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .empty-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground, #000000);
        }

        .empty-hint {
          font-size: 0.75rem;
          color: var(--muted-foreground, #272330);
          opacity: 0.8;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
          .content-overlay {
            padding: 0.75rem;
          }

          .asset-title {
            font-size: 0.875rem;
            -webkit-line-clamp: 1;
          }

          .asset-description {
            font-size: 0.75rem;
            -webkit-line-clamp: 1;
          }

          .asset-badge {
            padding: 0.25rem 0.5rem;
            font-size: 0.625rem;
            gap: 0.25rem;
          }

          .badge-icon {
            width: 0.75rem;
            height: 0.75rem;
          }

          .empty-content {
            padding: 1rem;
          }

          .empty-icon-wrapper {
            width: 48px;
            height: 48px;
          }

          .empty-icon {
            width: 24px;
            height: 24px;
          }

          .empty-title {
            font-size: 0.8125rem;
          }

          .empty-hint {
            font-size: 0.6875rem;
          }
        }

        /* Container Queries for Different Sizes */
        @container (max-height: 200px) {
          .content-overlay {
            min-height: 60%;
            padding: 0.5rem;
          }

          .asset-title {
            font-size: 0.8125rem;
            -webkit-line-clamp: 1;
          }

          .asset-description {
            display: none;
          }

          .content-header {
            margin-bottom: 0.5rem;
          }
        }

        @container (max-width: 250px) {
          .asset-title {
            font-size: 0.8125rem;
            -webkit-line-clamp: 1;
          }

          .asset-description {
            font-size: 0.75rem;
            -webkit-line-clamp: 1;
          }

          .asset-badge {
            padding: 0.25rem 0.5rem;
            font-size: 0.625rem;
          }
        }
      </style>
    </template>
  };
}
