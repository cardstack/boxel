import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import ImagePreview from './image-preview';
import type { MultipleUploadConfig } from '../util/types';

interface ImageData {
  id: string;
  preview: string;
  name: string;
  size?: number;
}

interface ImagePreviewContainerSignature {
  Args: {
    images: ImageData[];
    config: MultipleUploadConfig;
    onRemove: (id: string) => void;
  };
}

export default class ImagePreviewContainer extends GlimmerComponent<ImagePreviewContainerSignature> {
  get gridStyles() {
    const scrollable = this.args.config.scrollable !== false; // default to true

    return {
      '--overflow-behavior': scrollable ? 'auto' : 'visible',
    } as Record<string, string>;
  }

  get containerClasses() {
    const scrollable = this.args.config.scrollable !== false; // default to true
    return `image-preview-container ${
      scrollable
        ? 'image-preview-container--scrollable'
        : 'image-preview-container--stacked'
    }`;
  }

  @action
  removeImage(id: string) {
    this.args.onRemove(id);
  }

  <template>
    <div
      class={{this.containerClasses}}
      style={{this.gridStyles}}
      data-test-image-preview-container
    >
      {{#each @images as |image|}}
        <div class='image-preview-wrapper' data-test-image-wrapper>
          <ImagePreview
            @src={{image.preview}}
            @alt={{image.name}}
            @showPreview={{@config.showPreview}}
            @showFileName={{@config.showFileName}}
            @fileName={{image.name}}
            @showFileSize={{@config.showFileSize}}
            @fileSize={{image.size}}
            @onRemove={{fn this.removeImage image.id}}
            class='image-preview-item'
            data-test-image-item
          />
        </div>
      {{/each}}
    </div>

    <style>
      .image-preview-container {
        display: grid;
        gap: 1rem;
        width: 100%;
      }

      .image-preview-container--scrollable {
        grid-auto-flow: column;
        grid-auto-columns: 200px; /* Fixed column width for horizontal flow */
        align-items: stretch;
        overflow-x: auto;
        overflow-y: hidden;
        height: 200px; /* Fixed height for horizontal scrolling */
        width: 100%;
      }

      .image-preview-container--stacked {
        overflow: visible;
        grid-auto-flow: row;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      }

      .image-preview-container--scrollable .image-preview-wrapper {
        width: 100%;
        height: 200px; /* Fixed height for 1:1 aspect ratio */
      }

      .image-preview-wrapper {
        position: relative;
        aspect-ratio: 1 / 1;
        min-height: 0;
        height: 100%; /* Ensure wrapper fills container height when scrollable */
        width: 100%;
        overflow: hidden; /* Prevent image overflow */
      }

      .image-preview-item {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 0.5rem;
      }

      /* Override ImagePreview component styles to ensure proper sizing */
      .image-preview-item .image-preview-wrapper {
        width: 100%;
        height: 100%;
        aspect-ratio: 1 / 1;
      }

      .image-preview-item .image-container {
        height: 100% !important; /* Override fixed 256px */
      }

      .image-preview-item .preview-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        aspect-ratio: 1 / 1;
      }
    </style>
  </template>
}
