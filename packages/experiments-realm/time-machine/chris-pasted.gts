import { fn } from '@ember/helper';
import { gt } from '@cardstack/boxel-ui/helpers';
import { get } from '@ember/helper';
import { on } from '@ember/modifier';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { Button } from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';
import Modifier from 'ember-modifier';

// Keyboard navigation modifier for lightbox
class KeyboardNavigationModifier extends Modifier {
  element!: HTMLElement;

  modify(element: HTMLElement, [onKeyDown]: [(event: KeyboardEvent) => void]) {
    this.element = element;

    // Make element focusable
    element.setAttribute('tabindex', '0');
    element.focus();

    // Add keyboard event listener
    element.addEventListener('keydown', onKeyDown);

    // Cleanup function
    return () => {
      element.removeEventListener('keydown', onKeyDown);
    };
  }
}

export class ThroughTheAges extends CardDef {
  static displayName = 'Through the Ages';
  static prefersWideFormat = true;

  @field sourceImageUrl = contains(UrlField);
  @field generatedImages = contains(StringField);
  @field creativeNote = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    @tracked isLoading = false;
    @tracked error = '';
    @tracked imageUrls: { [decade: string]: string } = {};
    @tracked loadingStates: { [decade: string]: boolean } = {};
    @tracked errors: { [decade: string]: string } = {};
    @tracked uploadedImageData = '';
    @tracked selectedDecadeIndex: number | null = null;
    @tracked isLightboxOpen = false;

    decades = [
      '1950s',
      '1960s',
      '1970s',
      '1980s',
      '1990s',
      '2000s',
      '2010s',
      '2020s',
    ];

    @action
    updateImageUrl(event: Event) {
      const target = event.target as HTMLInputElement;
      this.args.model.sourceImageUrl = target.value;
    }

    @action
    updateCreativeNote(event: Event) {
      const target = event.target as HTMLTextAreaElement;
      this.args.model.creativeNote = target.value;
    }

    @action
    async uploadImage(event: Event) {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];

      if (!file) return;

      // Validate file type
      if (!file.type.startsWith('image/')) {
        this.error = 'Please upload a valid image file (PNG, JPG, etc.)';
        return;
      }

      // Convert file to base64 data URL and store in memory
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        this.uploadedImageData = result;
        this.error = ''; // Clear any previous errors
      };
      reader.readAsDataURL(file);
    }

    @action
    clearUploadedImage() {
      this.uploadedImageData = '';
      // Clear the file input
      const fileInput = document.getElementById(
        'image-upload',
      ) as HTMLInputElement;
      if (fileInput) {
        fileInput.value = '';
      }
    }

    @action
    openLightbox(decade: string) {
      const decadeIndex = this.decades.indexOf(decade);
      if (decadeIndex !== -1 && this.imageUrls[decade]) {
        this.selectedDecadeIndex = decadeIndex;
        this.isLightboxOpen = true;
        // Prevent body scroll when lightbox is open
        document.body.style.overflow = 'hidden';
      }
    }

    @action
    closeLightbox() {
      this.isLightboxOpen = false;
      this.selectedDecadeIndex = null;
      // Restore body scroll
      document.body.style.overflow = '';
    }

    @action
    navigateToNext() {
      if (this.selectedDecadeIndex === null) return;

      // Find next decade with an image
      let nextIndex = this.selectedDecadeIndex + 1;
      while (nextIndex < this.decades.length) {
        const nextDecade = this.decades[nextIndex];
        if (this.imageUrls[nextDecade]) {
          // Add slide animation class to entire polaroid before changing
          const lightboxPolaroid = document.querySelector('.lightbox-polaroid');
          if (lightboxPolaroid) {
            lightboxPolaroid.classList.add('slide-out-left');
            setTimeout(() => {
              this.selectedDecadeIndex = nextIndex;
              lightboxPolaroid.classList.remove('slide-out-left');
              lightboxPolaroid.classList.add('slide-in-right');
              setTimeout(() => {
                lightboxPolaroid.classList.remove('slide-in-right');
              }, 400);
            }, 200);
          } else {
            this.selectedDecadeIndex = nextIndex;
          }
          return;
        }
        nextIndex++;
      }
    }

    @action
    navigateToPrevious() {
      if (this.selectedDecadeIndex === null) return;

      // Find previous decade with an image
      let prevIndex = this.selectedDecadeIndex - 1;
      while (prevIndex >= 0) {
        const prevDecade = this.decades[prevIndex];
        if (this.imageUrls[prevDecade]) {
          // Add slide animation class to entire polaroid before changing
          const lightboxPolaroid = document.querySelector('.lightbox-polaroid');
          if (lightboxPolaroid) {
            lightboxPolaroid.classList.add('slide-out-right');
            setTimeout(() => {
              this.selectedDecadeIndex = prevIndex;
              lightboxPolaroid.classList.remove('slide-out-right');
              lightboxPolaroid.classList.add('slide-in-left');
              setTimeout(() => {
                lightboxPolaroid.classList.remove('slide-in-left');
              }, 400);
            }, 200);
          } else {
            this.selectedDecadeIndex = prevIndex;
          }
          return;
        }
        prevIndex--;
      }
    }

    @action
    handleKeyDown(event: KeyboardEvent) {
      if (!this.isLightboxOpen) return;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          this.closeLightbox();
          break;
        case 'ArrowRight':
          event.preventDefault();
          this.addNavPulse(event);
          this.navigateToNext();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          this.addNavPulse(event);
          this.navigateToPrevious();
          break;
      }
    }

    @action
    addNavPulse(event: Event | KeyboardEvent) {
      // Add pulse effect to navigation buttons
      const isLeftArrow =
        (event instanceof KeyboardEvent && event.key === 'ArrowLeft') ||
        (event.target as HTMLElement)?.classList.contains('lightbox-nav-prev');

      const navButton = document.querySelector(
        isLeftArrow ? '.lightbox-nav-prev' : '.lightbox-nav-next',
      );

      if (navButton) {
        navButton.classList.add('pulse');
        setTimeout(() => {
          navButton.classList.remove('pulse');
        }, 300);
      }

      // Add text change animation to caption
      const caption = document.querySelector('.lightbox-caption');
      if (caption) {
        caption.classList.add('changing');
        setTimeout(() => {
          caption.classList.remove('changing');
        }, 600);
      }
    }

    get currentDecade() {
      if (this.selectedDecadeIndex === null) return null;
      return this.decades[this.selectedDecadeIndex];
    }

    get currentImageUrl() {
      if (!this.currentDecade) return null;
      return this.imageUrls[this.currentDecade];
    }

    get hasNextImage() {
      if (this.selectedDecadeIndex === null) return false;

      for (let i = this.selectedDecadeIndex + 1; i < this.decades.length; i++) {
        if (this.imageUrls[this.decades[i]]) return true;
      }
      return false;
    }

    get hasPreviousImage() {
      if (this.selectedDecadeIndex === null) return false;

      for (let i = this.selectedDecadeIndex - 1; i >= 0; i--) {
        if (this.imageUrls[this.decades[i]]) return true;
      }
      return false;
    }

    @action
    async generateAllImages() {
      if (!this.uploadedImageData && !this.args.model.sourceImageUrl) {
        this.error = 'Please upload an image or provide a source image URL';
        return;
      }

      this.isLoading = true;
      this.error = '';
      this.imageUrls = {};
      this.errors = {};

      const initialLoadingStates: { [decade: string]: boolean } = {};
      this.decades.forEach((decade) => {
        initialLoadingStates[decade] = true;
      });
      this.loadingStates = initialLoadingStates;

      const promises = this.decades.map((decade) =>
        this.generateImageForDecade(decade),
      );

      try {
        await Promise.all(promises);
      } catch (error) {
        this.error =
          error instanceof Error
            ? error.message
            : 'An unknown error occurred during image generation';
      } finally {
        this.isLoading = false;
      }
    }

    async generateImageForDecade(decade: string) {
      try {
        const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
          this.args.context.commandContext,
        );

        let imageBase64 = '';
        let imageType = '';

        // Priority: 1. Uploaded image (in memory), 2. Image URL
        if (this.uploadedImageData) {
          // Use uploaded image data (already base64)
          imageBase64 = this.uploadedImageData;
          imageType =
            this.uploadedImageData.includes('jpeg') ||
            this.uploadedImageData.includes('jpg')
              ? 'jpeg'
              : 'png';
        } else if (this.args.model.sourceImageUrl) {
          // Convert image URL to base64 if it's not already
          if (this.args.model.sourceImageUrl.startsWith('data:image/')) {
            // Already base64 encoded
            imageBase64 = this.args.model.sourceImageUrl;
            imageType =
              this.args.model.sourceImageUrl.includes('jpeg') ||
              this.args.model.sourceImageUrl.includes('jpg')
                ? 'jpeg'
                : 'png';
          } else {
            // Fetch the image and convert to base64
            try {
              const imageResponse = await fetch(this.args.model.sourceImageUrl);
              const blob = await imageResponse.blob();

              // Determine image type from blob or URL
              imageType =
                blob.type.includes('jpeg') ||
                blob.type.includes('jpg') ||
                this.args.model.sourceImageUrl.toLowerCase().includes('.jpg') ||
                this.args.model.sourceImageUrl.toLowerCase().includes('.jpeg')
                  ? 'jpeg'
                  : 'png';

              // Convert to base64
              const reader = new FileReader();
              imageBase64 = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
            } catch (fetchError) {
              throw new Error(`Failed to fetch source image: ${fetchError}`);
            }
          }
        }

        // Build the prompt text with optional creative note
        let promptText = `Create a new photograph of the person in the provided image as if they were living in the ${decade}. The new photograph should be a realistic depiction, capturing the distinct fashion, hairstyles, and overall atmosphere of that time period. Make the final image a clear photograph that looks authentic to the era.`;

        // Add creative note if provided
        if (
          this.args.model.creativeNote &&
          this.args.model.creativeNote.trim()
        ) {
          promptText += ` Additional creative direction: ${this.args.model.creativeNote.trim()}`;
        }

        const messages: any[] = [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: promptText,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64,
                },
              },
            ],
          },
        ];

        const result = await sendRequestViaProxyCommand.execute({
          url: 'https://openrouter.ai/api/v1/chat/completions',
          method: 'POST',
          requestBody: JSON.stringify({
            model: 'google/gemini-2.5-flash-image-preview',
            messages: messages,
          }),
        });

        if (!result.response.ok) {
          throw new Error(
            `Failed to generate image for ${decade}: ${result.response.statusText}`,
          );
        }

        const responseData = await result.response.json();
        const messageContent = responseData.choices?.[0]?.message;

        if (messageContent?.images && Array.isArray(messageContent.images)) {
          const imageUrl = messageContent.images
            .map((img: any) => img.image_url?.url)
            .find((url: string) => url && url.startsWith('data:image/'));

          if (imageUrl) {
            this.imageUrls = { ...this.imageUrls, [decade]: imageUrl };
          } else {
            const errorMessage =
              responseData.choices?.[0]?.message?.content ||
              'No image was generated in the response.';
            this.errors = {
              ...this.errors,
              [decade]: `Image generation failed: ${errorMessage}`,
            };
          }
        }
      } catch (error) {
        console.error(`Error generating image for ${decade}:`, error);
        this.errors = {
          ...this.errors,
          [decade]:
            error instanceof Error
              ? error.message
              : 'An unknown error occurred',
        };
      } finally {
        this.loadingStates = { ...this.loadingStates, [decade]: false };
      }
    }

    <template>
      <div class='through-the-ages-card'>
        <header class='card-header'>
          <h1>Through the Ages</h1>
        </header>

        <div class='input-section'>
          <div class='upload-section'>
            <label for='image-upload'>Upload Image (PNG/JPG):</label>
            <input
              id='image-upload'
              type='file'
              accept='image/*'
              class='file-input'
              {{on 'change' this.uploadImage}}
            />
            {{#if this.uploadedImageData}}
              <Button
                @kind='secondary'
                class='clear-upload-button'
                {{on 'click' this.clearUploadedImage}}
              >
                Clear Uploaded Image
              </Button>
            {{/if}}
          </div>

          <div class='url-input-section'>
            <label for='image-url'>Or use Image URL:</label>
            <input
              id='image-url'
              type='url'
              class='image-url-input'
              placeholder='Enter the URL of a publicly available image...'
              value={{this.args.model.sourceImageUrl}}
              {{on 'input' this.updateImageUrl}}
              disabled={{this.uploadedImageData}}
            />
          </div>

          {{#if this.uploadedImageData}}
            <div class='image-preview'>
              <label>Uploaded Image Preview:</label>
              <img
                src={{this.uploadedImageData}}
                alt='Uploaded image preview'
                class='preview-image'
              />
            </div>
          {{else if this.args.model.sourceImageUrl}}
            <div class='image-preview'>
              <label>URL Image Preview:</label>
              <img
                src={{this.args.model.sourceImageUrl}}
                alt='Source image preview'
                class='preview-image'
              />
            </div>
          {{/if}}

          <div class='creative-note-section'>
            <div class='post-it-note'>
              <div class='post-it-header'>
                <span class='post-it-title'>Creative Notes</span>
                <span class='post-it-pin'>📌</span>
              </div>
              <textarea
                class='post-it-textarea'
                placeholder='Add creative suggestions for the photos... 
e.g., "Make them look like a professional photographer", "Add vintage lighting", "Include period-appropriate props"...'
                value={{this.args.model.creativeNote}}
                {{on 'input' this.updateCreativeNote}}
              ></textarea>
              <div class='post-it-footer'>
                <span class='post-it-signature'>✨ Photo tips</span>
              </div>
            </div>
          </div>

          <Button
            @kind='primary'
            class='generate-button'
            {{on 'click' this.generateAllImages}}
            disabled={{this.isLoading}}
          >
            {{if
              this.isLoading
              'Generating Images...'
              'Generate Through the Ages'
            }}
          </Button>
        </div>

        {{#if this.error}}
          <div class='error-message'>
            <strong>Error:</strong>
            {{this.error}}
          </div>
        {{/if}}

        <div class='polaroids-container'>
          {{#each this.decades as |decade|}}
            <div
              class='polaroid
                {{if (get this.imageUrls decade) "polaroid-clickable"}}'
              {{on
                'click'
                (if (get this.imageUrls decade) (fn this.openLightbox decade))
              }}
            >
              <div class='polaroid-photo'>
                {{#if (get this.loadingStates decade)}}
                  <div class='loading-spinner'>
                    <div class='spinner'></div>
                    <p>Generating {{decade}}...</p>
                  </div>
                {{else if (get this.imageUrls decade)}}
                  <img
                    src={{get this.imageUrls decade}}
                    alt='Generated image for {{decade}}'
                    class='generated-image'
                  />
                {{else if (get this.errors decade)}}
                  <div class='polaroid-error'>
                    <p><strong>Error for {{decade}}</strong></p>
                    <p>{{get this.errors decade}}</p>
                  </div>
                {{else}}
                  <div class='placeholder'>
                    <p>{{decade}}</p>
                  </div>
                {{/if}}
              </div>
              <div class='polaroid-caption'>
                <span class='decade-text'>{{decade}}</span>
              </div>
            </div>
          {{/each}}
        </div>

        {{#if this.isLightboxOpen}}
          <div
            class='lightbox-overlay'
            {{KeyboardNavigationModifier this.handleKeyDown}}
            {{on 'click' this.closeLightbox}}
          >
            <div
              class='lightbox-content'
              {{on 'click' (fn (mut false))}}
              role='dialog'
              aria-modal='true'
              aria-labelledby='lightbox-title'
            >
              <!-- Navigation and close buttons - positioned outside polaroid -->
              <button
                class='lightbox-close'
                {{on 'click' this.closeLightbox}}
                aria-label='Close lightbox'
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M18 6L6 18M6 6l12 12' />
                </svg>
              </button>

              {{#if this.hasPreviousImage}}
                <button
                  class='lightbox-nav lightbox-nav-prev'
                  {{on 'click' this.navigateToPrevious}}
                  {{on 'click' this.addNavPulse}}
                  aria-label='Previous image'
                >
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M15 18l-6-6 6-6' />
                  </svg>
                </button>
              {{/if}}

              {{#if this.hasNextImage}}
                <button
                  class='lightbox-nav lightbox-nav-next'
                  {{on 'click' this.navigateToNext}}
                  {{on 'click' this.addNavPulse}}
                  aria-label='Next image'
                >
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M9 18l6-6-6-6' />
                  </svg>
                </button>
              {{/if}}

              <div class='lightbox-polaroid'>
                <div class='lightbox-photo'>
                  {{#if this.currentImageUrl}}
                    <img
                      src={{this.currentImageUrl}}
                      alt='Generated image for {{this.currentDecade}}'
                      class='lightbox-image'
                      id='lightbox-title'
                    />
                  {{/if}}
                </div>

                <div class='lightbox-caption'>
                  <span
                    class='lightbox-decade-text'
                  >{{this.currentDecade}}</span>
                </div>
              </div>
            </div>
          </div>
        {{/if}}
      </div>

      <style scoped>
        @import url('https://fonts.googleapis.com/css2?family=Recoleta:wght@400;600;700&family=Inter:wght@300;400;500;600&family=Kalam:wght@400;700&display=swap');

        .through-the-ages-card {
          padding: 0.75rem;
          margin: 0 auto;
          font-family: var(
            --font-sans,
            'Inter',
            -apple-system,
            BlinkMacSystemFont,
            'Segoe UI',
            sans-serif
          );
          background: var(--background, #faf7f2);
          color: var(--foreground, #2c2c2c);
          min-height: 100vh;
          max-width: 100%;
          width: 100%;
        }

        /* Ultra-wide screens (1400px+) - Museum gallery layout */
        @media (min-width: 1400px) {
          .through-the-ages-card {
            padding: 1.5rem 2rem;
            display: grid;
            grid-template-columns: 1fr 2fr;
            grid-template-rows: auto auto 1fr;
            gap: 2rem;
            max-width: none;
            grid-template-areas:
              'header header'
              'controls .'
              'controls gallery';
          }

          .card-header {
            grid-area: header;
            margin-bottom: 0;
          }

          .input-section {
            grid-area: controls;
            margin-bottom: 0;
            max-width: 320px;
            position: sticky;
            top: 1rem;
            height: fit-content;
          }

          .polaroids-container {
            grid-area: gallery;
            margin-top: 0;
          }
        }

        /* Large screens (1024px - 1399px) - Standard layout */
        @media (min-width: 1024px) and (max-width: 1399px) {
          .through-the-ages-card {
            padding: 1.25rem;
            max-width: 1200px;
          }
        }

        /* Medium screens (768px - 1023px) - Tablet layout */
        @media (min-width: 768px) and (max-width: 1023px) {
          .through-the-ages-card {
            padding: 1rem;
            max-width: 900px;
          }
        }

        /* Small screens (below 768px) - Mobile layout */
        @media (max-width: 767px) {
          .through-the-ages-card {
            padding: 0.75rem;
          }
        }

        .card-header {
          text-align: center;
          margin-bottom: 1rem;
        }

        .card-header h1 {
          font-family: var(--font-serif, 'Recoleta', Georgia, serif);
          color: var(--foreground, #2c2c2c);
          font-size: clamp(1.5rem, 3vw, 2.25rem);
          font-weight: 600;
          margin-bottom: 0;
          text-shadow: var(--shadow-sm, 2px 2px 4px rgba(0, 0, 0, 0.1));
          letter-spacing: -0.02em;
        }

        /* Ultra-wide header adjustments */
        @media (min-width: 1400px) {
          .card-header {
            text-align: left;
            padding-left: 0;
            margin-bottom: 0.75rem;
          }

          .card-header h1 {
            font-size: 2rem;
          }
        }

        .input-section {
          background: var(--card, rgba(255, 255, 255, 0.8));
          padding: 1rem;
          border-radius: var(--radius, 12px);
          margin-bottom: 1.25rem;
          border: 1px solid var(--border, rgba(208, 122, 78, 0.1));
          backdrop-filter: blur(10px);
          box-shadow: var(--shadow-lg, 0 6px 24px rgba(0, 0, 0, 0.08));
        }

        /* Ultra-wide input adjustments */
        @media (min-width: 1400px) {
          .input-section {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            border: 2px solid rgba(208, 122, 78, 0.15);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
          }
        }

        /* Medium and small screen adjustments */
        @media (max-width: 767px) {
          .input-section {
            padding: 1rem;
            border-radius: 10px;
          }
        }

        @media (max-width: 480px) {
          .input-section {
            padding: 0.875rem;
          }
        }

        .upload-section {
          margin-bottom: 1.5rem;
          padding-bottom: 1.5rem;
          border-bottom: 2px solid rgba(208, 122, 78, 0.15);
        }

        .upload-section label {
          display: block;
          margin-bottom: 0.75rem;
          font-family: var(--font-sans, 'Inter', sans-serif);
          font-weight: 600;
          color: var(--foreground, #2c2c2c);
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .file-input {
          width: 100%;
          padding: 1rem;
          border: 2px dashed var(--border, rgba(208, 122, 78, 0.3));
          border-radius: var(--radius, 12px);
          font-family: var(--font-sans, 'Inter', sans-serif);
          font-size: 0.95rem;
          background: var(--muted, rgba(250, 247, 242, 0.5));
          cursor: pointer;
          transition: all 0.3s ease;
          margin-bottom: 0.75rem;
          color: var(--foreground, #2c2c2c);
        }

        .file-input:hover {
          border-color: rgba(208, 122, 78, 0.6);
          background: rgba(208, 122, 78, 0.05);
          transform: translateY(-1px);
        }

        .clear-upload-button {
          padding: 0.75rem 1.25rem;
          font-family: 'Inter', sans-serif;
          font-size: 0.85rem;
          font-weight: 500;
          border-radius: 8px;
          border: 2px solid rgba(220, 53, 69, 0.3);
          background: rgba(255, 255, 255, 0.9);
          color: #dc3545;
          cursor: pointer;
          transition: all 0.3s ease;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .clear-upload-button:hover {
          background: #dc3545;
          color: white;
          border-color: #dc3545;
          transform: translateY(-1px);
        }

        .url-input-section {
          margin-bottom: 1.5rem;
        }

        .url-input-section label {
          display: block;
          margin-bottom: 0.75rem;
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          color: #2c2c2c;
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .image-url-input {
          width: 100%;
          padding: 1rem;
          border: 2px solid var(--input, rgba(208, 122, 78, 0.2));
          border-radius: var(--radius, 12px);
          font-family: var(--font-sans, 'Inter', sans-serif);
          font-size: 0.95rem;
          background: var(--card, rgba(255, 255, 255, 0.7));
          transition: all 0.3s ease;
          color: var(--foreground, #2c2c2c);
        }

        .image-url-input:focus {
          outline: none;
          border-color: rgba(208, 122, 78, 0.6);
          box-shadow: 0 0 0 4px rgba(208, 122, 78, 0.1);
          background: rgba(255, 255, 255, 0.9);
        }

        .image-url-input:disabled {
          background: #f8f9fa;
          color: #6c757d;
          cursor: not-allowed;
          opacity: 0.6;
        }

        .image-preview {
          margin-bottom: 1.5rem;
        }

        .image-preview label {
          display: block;
          margin-bottom: 0.75rem;
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          color: #2c2c2c;
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .preview-image {
          max-width: 180px;
          max-height: 180px;
          border-radius: 8px;
          border: 3px solid #ffffff;
          object-fit: cover;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15);
          transition: transform 0.3s ease;
        }

        .preview-image:hover {
          transform: scale(1.02);
        }

        /* Creative Note Post-it Styles */
        .creative-note-section {
          margin-bottom: 1.5rem;
          display: flex;
          justify-content: center;
          position: relative;
        }

        .post-it-note {
          background: linear-gradient(135deg, #fff9c4 0%, #fff3a0 100%);
          border: 1px solid #f4d03f;
          border-radius: 2px;
          box-shadow:
            2px 2px 6px rgba(0, 0, 0, 0.1),
            0 0 0 1px rgba(244, 208, 63, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
          transform: rotate(-1deg);
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          width: 100%;
          max-width: 320px;
          position: relative;
          font-family: 'Kalam', cursive;
          padding: 0;
          overflow: hidden;
        }

        .post-it-note:hover {
          transform: rotate(0deg) scale(1.02);
          box-shadow:
            4px 4px 12px rgba(0, 0, 0, 0.15),
            0 0 0 1px rgba(244, 208, 63, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        }

        .post-it-note::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: repeating-linear-gradient(
            transparent,
            transparent 20px,
            rgba(244, 208, 63, 0.1) 20px,
            rgba(244, 208, 63, 0.1) 21px
          );
          pointer-events: none;
          z-index: 1;
        }

        .post-it-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px 6px 12px;
          border-bottom: 1px dashed rgba(244, 208, 63, 0.4);
          background: rgba(255, 255, 255, 0.2);
          position: relative;
          z-index: 2;
        }

        .post-it-title {
          font-weight: 700;
          font-size: 0.9rem;
          color: #8b6f15;
          text-shadow: 0 1px 1px rgba(255, 255, 255, 0.8);
          transform: rotate(-0.5deg);
        }

        .post-it-pin {
          font-size: 1rem;
          filter: drop-shadow(1px 1px 1px rgba(0, 0, 0, 0.2));
        }

        .post-it-textarea {
          width: 100%;
          min-height: 100px;
          padding: 12px 15px 8px 15px;
          border: none;
          background: transparent;
          font-family: 'Kalam', cursive;
          font-size: 0.85rem;
          font-weight: 400;
          color: #6b5b0f;
          line-height: 1.4;
          resize: vertical;
          outline: none;
          position: relative;
          z-index: 2;
        }

        .post-it-textarea::placeholder {
          color: rgba(139, 111, 21, 0.6);
          font-style: italic;
          font-weight: 400;
        }

        .post-it-textarea:focus {
          background: rgba(255, 255, 255, 0.1);
        }

        .post-it-footer {
          padding: 6px 12px 8px 12px;
          text-align: right;
          border-top: 1px dashed rgba(244, 208, 63, 0.3);
          background: rgba(255, 255, 255, 0.1);
          position: relative;
          z-index: 2;
        }

        .post-it-signature {
          font-size: 0.75rem;
          color: rgba(139, 111, 21, 0.7);
          font-weight: 700;
          transform: rotate(0.5deg);
          display: inline-block;
          text-shadow: 0 1px 1px rgba(255, 255, 255, 0.8);
        }

        /* Ultra-wide post-it adjustments */
        @media (min-width: 1400px) {
          .creative-note-section {
            justify-content: flex-start;
            margin-left: 0;
          }

          .post-it-note {
            max-width: 300px;
          }
        }

        /* Mobile post-it adjustments */
        @media (max-width: 767px) {
          .post-it-note {
            max-width: 100%;
            transform: rotate(-0.5deg);
          }

          .post-it-textarea {
            min-height: 80px;
            font-size: 0.8rem;
          }
        }

        .generate-button {
          padding: 1rem 2.5rem;
          font-family: var(--font-sans, 'Inter', sans-serif);
          font-size: 0.95rem;
          font-weight: 600;
          border-radius: var(--radius, 12px);
          border: none;
          background: var(
            --primary,
            linear-gradient(135deg, #d87a4e 0%, #e8b954 100%)
          );
          color: var(--primary-foreground, #ffffff);
          cursor: pointer;
          transition: all 0.3s ease;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          box-shadow: var(--shadow-md, 0 4px 16px rgba(216, 122, 78, 0.3));
        }

        .generate-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(216, 122, 78, 0.4);
          background: linear-gradient(135deg, #c96a3e 0%, #d9a844 100%);
        }

        .generate-button:disabled {
          background: linear-gradient(135deg, #9ca3af 0%, #6b7280 100%);
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .error-message {
          padding: 1.25rem;
          background: var(--destructive, rgba(248, 215, 218, 0.8));
          border: 2px solid var(--destructive, rgba(245, 198, 203, 0.6));
          border-radius: var(--radius, 12px);
          color: var(--destructive-foreground, #721c24);
          margin-bottom: 2rem;
          font-family: var(--font-sans, 'Inter', sans-serif);
          font-weight: 500;
          backdrop-filter: blur(10px);
        }

        .polaroids-container {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1.25rem;
          margin-top: 1.25rem;
        }

        /* Ultra-wide gallery - wider polaroids per row */
        @media (min-width: 1400px) {
          .polaroids-container {
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            padding: 0.5rem;
          }
        }

        /* Large screens - optimize grid */
        @media (min-width: 1024px) and (max-width: 1399px) {
          .polaroids-container {
            grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
            gap: 1.25rem;
          }
        }

        /* Medium screens - fewer columns */
        @media (min-width: 768px) and (max-width: 1023px) {
          .polaroids-container {
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
          }
        }

        /* Small screens - single or double column */
        @media (max-width: 767px) {
          .polaroids-container {
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
          }
        }

        /* Very small screens - single column */
        @media (max-width: 480px) {
          .polaroids-container {
            grid-template-columns: 1fr;
            gap: 0.875rem;
          }
        }

        .polaroid {
          background: var(--card, #ffffff);
          padding: 0.75rem 0.75rem 2.5rem 0.75rem;
          box-shadow: var(--shadow-lg, 0 6px 24px rgba(0, 0, 0, 0.12));
          border-radius: 8px;
          transform: rotate(-2deg);
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          border: 1px solid var(--border, rgba(0, 0, 0, 0.05));
          position: relative;
          user-select: none;
        }

        .polaroid-clickable {
          cursor: pointer;
        }

        .polaroid-clickable:active {
          transform: rotate(0deg) scale(0.98) translateY(2px);
          box-shadow: var(--shadow-md, 0 4px 16px rgba(0, 0, 0, 0.1));
          transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Ultra-wide polaroid adjustments */
        @media (min-width: 1400px) {
          .polaroid {
            padding: 0.875rem 0.875rem 3rem 0.875rem;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
          }

          .polaroid:hover {
            transform: rotate(0deg) scale(1.06);
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
            z-index: 10;
          }
        }

        /* Mobile polaroid adjustments */
        @media (max-width: 767px) {
          .polaroid {
            padding: 0.625rem 0.625rem 2.25rem 0.625rem;
          }
        }

        @media (max-width: 480px) {
          .polaroid {
            padding: 0.5rem 0.5rem 2rem 0.5rem;
          }
        }

        .polaroid:nth-child(even) {
          transform: rotate(1.5deg);
        }

        .polaroid:nth-child(3n) {
          transform: rotate(-0.5deg);
        }

        .polaroid:nth-child(4n) {
          transform: rotate(2.5deg);
        }

        .polaroid:hover {
          transform: rotate(0deg) scale(1.05) translateY(-4px);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
          z-index: 10;
        }

        .polaroid-clickable:hover {
          transform: rotate(0deg) scale(1.08) translateY(-6px);
          box-shadow: 0 24px 72px rgba(0, 0, 0, 0.3);
          z-index: 10;
        }

        .polaroid-clickable:hover::before {
          opacity: 0.15;
        }

        .polaroid-clickable:hover .polaroid-photo {
          transform: scale(1.02);
        }

        .polaroid-clickable:hover .decade-text {
          transform: rotate(0deg) scale(1.05);
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
        }

        .polaroid::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.1) 0%,
            rgba(255, 255, 255, 0.05) 50%,
            rgba(0, 0, 0, 0.02) 100%
          );
          border-radius: 8px;
          pointer-events: none;
          opacity: 0.7;
          transition: opacity 0.4s ease;
        }

        /* Add subtle paper texture overlay */
        .polaroid::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image:
            radial-gradient(
              circle at 25% 25%,
              rgba(255, 255, 255, 0.2) 1px,
              transparent 1px
            ),
            radial-gradient(
              circle at 75% 75%,
              rgba(0, 0, 0, 0.02) 1px,
              transparent 1px
            );
          background-size: 20px 20px;
          border-radius: 8px;
          pointer-events: none;
          opacity: 0.3;
          mix-blend-mode: overlay;
        }

        .polaroid-photo {
          width: 100%;
          height: 220px;
          background: var(--muted, #f8f9fa);
          border: 1px solid var(--border, #dee2e6);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          position: relative;
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        /* Ultra-wide photo sizing */
        @media (min-width: 1400px) {
          .polaroid-photo {
            height: 230px;
          }
        }

        /* Medium screen adjustments */
        @media (min-width: 768px) and (max-width: 1023px) {
          .polaroid-photo {
            height: 210px;
          }
        }

        /* Mobile photo sizing */
        @media (max-width: 767px) {
          .polaroid-photo {
            height: 190px;
          }
        }

        @media (max-width: 480px) {
          .polaroid-photo {
            height: 180px;
          }
        }

        .generated-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .loading-spinner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.25rem;
          color: #6b7280;
          font-family: 'Inter', sans-serif;
          font-weight: 500;
        }

        .spinner {
          width: 44px;
          height: 44px;
          border: 3px solid rgba(216, 122, 78, 0.1);
          border-top: 3px solid #d87a4e;
          border-radius: 50%;
          animation: spin 1.2s ease-in-out infinite;
        }

        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        .placeholder {
          color: #9ca3af;
          font-family: 'Inter', sans-serif;
          font-style: italic;
          font-size: 1.1rem;
          font-weight: 400;
        }

        .polaroid-error {
          padding: 1.25rem;
          color: #721c24;
          font-family: 'Inter', sans-serif;
          font-size: 0.85rem;
          font-weight: 500;
          text-align: center;
          word-break: break-word;
          line-height: 1.4;
        }

        .polaroid-caption {
          margin-top: 1.25rem;
          text-align: center;
          position: relative;
        }

        .decade-text {
          font-family: 'Kalam', cursive;
          font-size: 1.1rem;
          color: var(--foreground, #2c2c2c);
          font-weight: 700;
          transform: rotate(-1deg);
          display: inline-block;
          text-shadow: var(--shadow-xs, 1px 1px 2px rgba(0, 0, 0, 0.1));
          letter-spacing: 0.02em;
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .polaroid:nth-child(even) .decade-text {
          transform: rotate(0.5deg);
        }

        .polaroid:nth-child(3n) .decade-text {
          transform: rotate(-0.5deg);
        }

        /* Lightbox Styles */
        .lightbox-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.9);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(8px);
          animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        .lightbox-content {
          position: relative;
          max-width: 90vw;
          max-height: 90vh;
          animation: scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          padding: 80px 120px; /* Add padding to create space for navigation controls */
          display: flex;
          align-items: center;
          justify-content: center;
        }

        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.8) rotate(-2deg);
          }
          to {
            opacity: 1;
            transform: scale(1) rotate(0deg);
          }
        }

        .lightbox-polaroid {
          background: var(--card, #ffffff);
          padding: 1.5rem 1.5rem 4rem 1.5rem;
          border-radius: 8px;
          box-shadow: var(--shadow-2xl, 0 25px 50px rgba(0, 0, 0, 0.25));
          border: 1px solid var(--border, rgba(0, 0, 0, 0.05));
          max-width: 600px;
          max-height: 80vh;
        }

        .lightbox-photo {
          width: 100%;
          max-height: 500px;
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid var(--border, #dee2e6);
          background: var(--muted, #f8f9fa);
        }

        .lightbox-image {
          width: 100%;
          height: 100%;
          object-fit: contain;
          max-height: 500px;
        }

        .lightbox-caption {
          margin-top: 2rem;
          text-align: center;
        }

        .lightbox-decade-text {
          font-family: 'Kalam', cursive;
          font-size: 1.5rem;
          color: var(--foreground, #2c2c2c);
          font-weight: 700;
          text-shadow: var(--shadow-xs, 1px 1px 2px rgba(0, 0, 0, 0.1));
          letter-spacing: 0.02em;
        }

        .lightbox-close {
          position: absolute;
          top: 20px;
          right: 20px;
          width: 48px;
          height: 48px;
          background: rgba(0, 0, 0, 0.7);
          border: 2px solid rgba(255, 255, 255, 0.2);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s ease;
          color: white;
          backdrop-filter: blur(10px);
          box-shadow: var(--shadow-lg, 0 6px 24px rgba(0, 0, 0, 0.3));
          z-index: 10;
        }

        .lightbox-close:hover {
          background: rgba(255, 255, 255, 0.2);
          color: white;
          transform: scale(1.1);
          border-color: rgba(255, 255, 255, 0.4);
        }

        .lightbox-close svg {
          width: 20px;
          height: 20px;
        }

        .lightbox-nav {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 60px;
          height: 60px;
          background: rgba(0, 0, 0, 0.7);
          border: 2px solid rgba(255, 255, 255, 0.2);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s ease;
          color: white;
          backdrop-filter: blur(10px);
          box-shadow: var(--shadow-lg, 0 6px 24px rgba(0, 0, 0, 0.3));
          z-index: 10;
        }

        .lightbox-nav:hover {
          background: rgba(255, 255, 255, 0.2);
          color: white;
          transform: translateY(-50%) scale(1.1);
          border-color: rgba(255, 255, 255, 0.4);
        }

        .lightbox-nav-prev {
          left: 20px;
        }

        .lightbox-nav-next {
          right: 20px;
        }

        .lightbox-nav svg {
          width: 24px;
          height: 24px;
        }

        /* Mobile lightbox adjustments */
        @media (max-width: 768px) {
          .lightbox-content {
            max-width: 95vw;
            max-height: 95vh;
            padding: 60px 80px; /* Reduced padding for mobile */
          }

          .lightbox-polaroid {
            padding: 1rem 1rem 3rem 1rem;
            max-width: none;
          }

          .lightbox-photo {
            max-height: 400px;
          }

          .lightbox-image {
            max-height: 400px;
          }

          .lightbox-close {
            top: 15px;
            right: 15px;
            width: 44px;
            height: 44px;
          }

          .lightbox-close svg {
            width: 18px;
            height: 18px;
          }

          .lightbox-nav {
            width: 52px;
            height: 52px;
          }

          .lightbox-nav-prev {
            left: 15px;
          }

          .lightbox-nav-next {
            right: 15px;
          }

          .lightbox-nav svg {
            width: 20px;
            height: 20px;
          }
        }

        /* Very small screens - minimal padding */
        @media (max-width: 480px) {
          .lightbox-content {
            padding: 50px 60px; /* Further reduced padding for small screens */
          }

          .lightbox-close {
            top: 10px;
            right: 10px;
            width: 40px;
            height: 40px;
          }

          .lightbox-nav {
            width: 48px;
            height: 48px;
          }

          .lightbox-nav-prev {
            left: 10px;
          }

          .lightbox-nav-next {
            right: 10px;
          }
        }

        /* Lightbox Navigation Animations - Now animating entire polaroid */
        .lightbox-polaroid.slide-out-left {
          animation: slideOutLeft 0.2s ease-in forwards;
        }

        .lightbox-polaroid.slide-out-right {
          animation: slideOutRight 0.2s ease-in forwards;
        }

        .lightbox-polaroid.slide-in-left {
          animation: slideInLeft 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .lightbox-polaroid.slide-in-right {
          animation: slideInRight 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)
            forwards;
        }

        @keyframes slideOutLeft {
          from {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
          to {
            transform: translateX(-100px) scale(0.9);
            opacity: 0;
          }
        }

        @keyframes slideOutRight {
          from {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
          to {
            transform: translateX(100px) scale(0.9);
            opacity: 0;
          }
        }

        @keyframes slideInLeft {
          from {
            transform: translateX(-100px) scale(0.9);
            opacity: 0;
          }
          to {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
        }

        @keyframes slideInRight {
          from {
            transform: translateX(100px) scale(0.9);
            opacity: 0;
          }
          to {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
        }

        /* Enhanced navigation button animations */
        .lightbox-nav {
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .lightbox-nav:active {
          transform: translateY(-50%) scale(0.95);
          transition: all 0.15s ease;
        }

        /* Add pulse effect when navigation is triggered */
        .lightbox-nav.pulse {
          animation: navPulse 0.3s ease;
        }

        @keyframes navPulse {
          0% {
            transform: translateY(-50%) scale(1);
          }
          50% {
            transform: translateY(-50%) scale(1.15);
            box-shadow: 0 0 20px rgba(216, 122, 78, 0.4);
          }
          100% {
            transform: translateY(-50%) scale(1);
          }
        }

        /* Decade text animation */
        .lightbox-decade-text {
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .lightbox-caption.changing .lightbox-decade-text {
          animation: textChange 0.6s ease;
        }

        @keyframes textChange {
          0% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
          25% {
            transform: translateY(-10px) scale(0.95);
            opacity: 0.7;
          }
          75% {
            transform: translateY(10px) scale(1.05);
            opacity: 0.9;
          }
          100% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
      </style>
    </template>
  };
}
