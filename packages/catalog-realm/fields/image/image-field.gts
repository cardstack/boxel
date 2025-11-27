import { eq } from '@cardstack/boxel-ui/helpers';
import {
  FieldDef,
  Component,
  field,
  contains,
  Box,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import CameraIcon from '@cardstack/boxel-icons/camera';
import Grid3x3Icon from '@cardstack/boxel-icons/grid-3x3';
// Single image components
import SingleEmbeddedPresentation from './components/single/single-embedded-presentation';
import SingleImageFieldEdit from './components/single/single-image-field-edit';

// Collection (multiple image) components
import CollectionEmbeddedPresentation from './components/collection/collection-embedded-presentation';
import CollectionImageFieldEdit from './components/collection/collection-image-field-edit';

// Type definitions
type ImagePresentationType = 'standard' | 'image' | 'inline' | 'card';
type ImageCollectionVariant = 'list' | 'gallery' | 'dropzone';
type ImageCollectionPresentationType = 'standard' | 'grid' | 'carousel';

// Collection options type
export type ImageCollectionOptions = {
  autoUpload?: boolean; // Default to true, will auto upload the image to Cloudflare when the file is selected
  allowReorder?: boolean; // Default to false, will not allow drag-drop reordering
  allowBatchSelect?: boolean; // Default to true, will allow batch selection and delete
  maxFiles?: number; // Default to 10, will limit the number of images that can be uploaded
  showProgress?: boolean; // Default to false, will not show progress during file reading
};

// TypeScript configuration interface
// When used with contains(ImageField) - single image mode
// When used with containsMany(ImageField) - collection mode (uses collection variants)
export type ImageFieldConfiguration =
  | {
      variant: 'browse' | 'dropzone';
      presentation?: ImagePresentationType;
      options?: {
        showImageModal?: boolean;
        autoUpload?: boolean;
        showProgress?: boolean; // Show progress during file reading
      };
    }
  | {
      variant: 'avatar';
      presentation?: ImagePresentationType;
      options?: {
        autoUpload?: boolean;
        showProgress?: boolean; // Show progress during file reading
        // No showImageModal allowed here
      };
    }
  | {
      // Collection mode configuration (used when containsMany(ImageField) is used)
      variant?: ImageCollectionVariant; // 'list' | 'gallery' | 'dropzone'
      presentation?: ImageCollectionPresentationType; // 'standard' | 'grid' | 'carousel'
      options?: ImageCollectionOptions;
    };

// Type for Box with internal state access (state is private but we need it for collection detection)
// We create a type that represents the runtime shape without conflicting with Box's private state
export type BoxWithState<T> = {
  value: T;
  set: <V extends T>(value: V) => void;
  field: <K extends keyof T>(
    fieldName: K,
    useIndexBasedKeys?: boolean,
  ) => Box<T[K]>;
  state?: {
    type: 'derived';
    containingBox: Box<any>;
    fieldName: string;
  };
  name?: string | number;
};

function isInContainsManyContext(model: any): boolean {
  return Array.isArray(model) && model.length >= 0;
}

class ImageFieldEdit extends Component<typeof ImageField> {
  // Detect if we're in a containsMany context
  get isCollectionMode(): boolean {
    console.log('collection mode', this.args.model);
    return isInContainsManyContext(this.args.model);
  }

  // Only the first item in a collection should render the collection UI
  get shouldRenderCollection(): boolean {
    if (!this.isCollectionMode) return false;
    const model = this.args.model as unknown as BoxWithState<ImageField>;
    const modelName = model.name;
    return modelName === '0' || modelName === 0;
  }

  <template>
    {{#if this.isCollectionMode}}
      {{#if this.shouldRenderCollection}}
        <CollectionImageFieldEdit
          @model={{@model}}
          @fields={{@fields}}
          @set={{@set}}
          @fieldName={{@fieldName}}
          @context={{@context}}
          @configuration={{@configuration}}
        />
      {{else}}
        <div style='display: none;' aria-hidden='true'></div>
      {{/if}}
    {{else}}
      <SingleImageFieldEdit
        @model={{@model}}
        @fields={{@fields}}
        @set={{@set}}
        @fieldName={{@fieldName}}
        @context={{@context}}
        @configuration={{@configuration}}
      />
    {{/if}}
  </template>
}

class ImageFieldEmbedded extends Component<typeof ImageField> {
  get isCollectionMode(): boolean {
    return isInContainsManyContext(this.args.model);
  }

  get parentArray(): ImageField[] | undefined {
    if (!this.isCollectionMode) return undefined;
    const model = this.args.model as unknown as BoxWithState<ImageField>;
    const parent = model.state?.containingBox;
    if (parent) {
      const parentValue = parent.value;
      if (Array.isArray(parentValue)) {
        return parentValue as ImageField[];
      }
    }
    return undefined;
  }

  /** Single image mode: Check if this image has an uploaded URL */
  get hasImage() {
    return !!this.args.model?.uploadedImageUrl;
  }

  /** Collection mode: Check if the array has any images */
  get hasCollectionImages(): boolean {
    const array = this.parentArray;
    return !!(array && array.length > 0);
  }

  get collectionPresentation(): ImageCollectionPresentationType {
    const config = this.args.configuration as ImageFieldConfiguration;
    const presentation = config?.presentation || 'standard';
    if (['grid', 'carousel'].includes(presentation as string)) {
      return presentation as ImageCollectionPresentationType;
    }
    return 'grid'; // Default to grid for collection mode
  }

  get presentation(): ImagePresentationType {
    const config = this.args.configuration as ImageFieldConfiguration;
    // If it's a collection presentation, return 'image' as default
    if (['grid', 'carousel'].includes(config?.presentation as string)) {
      return 'image';
    }
    const presentation = config?.presentation || 'standard';
    return presentation === 'standard'
      ? 'image'
      : (presentation as ImagePresentationType);
  }

  get shouldRenderCollection(): boolean {
    if (!this.isCollectionMode) return false;
    const model = this.args.model as unknown as BoxWithState<ImageField>;
    const modelName = model.name;
    return modelName === '0' || modelName === 0;
  }

  <template>
    {{! Collection mode (containsMany) or single image mode (contains) }}
    {{#if this.isCollectionMode}}
      {{#if this.shouldRenderCollection}}
        <CollectionEmbeddedPresentation
          @images={{this.parentArray}}
          @presentation={{this.collectionPresentation}}
          @hasImages={{this.hasCollectionImages}}
        />
      {{else}}
        <div style='display: none;' aria-hidden='true'></div>
      {{/if}}
    {{else}}
      <SingleEmbeddedPresentation
        @imageUrl={{@model.uploadedImageUrl}}
        @presentation={{this.presentation}}
        @hasImage={{this.hasImage}}
      />
    {{/if}}

    <style scoped>
      .multiple-image-embedded {
        width: 100%;
      }

      .no-images {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: calc(var(--spacing, 0.25rem) * 8);
        background: var(--muted, #f1f5f9);
        border-radius: var(--radius, 0.375rem);
        color: var(--muted-foreground, #9ca3af);
        font-size: 0.875rem;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }

      .camera-icon {
        width: 2rem;
        height: 2rem;
      }
    </style>
  </template>
}

class ImageFieldAtom extends Component<typeof ImageField> {
  // Check if we're in collection mode
  get isCollectionMode(): boolean {
    return isInContainsManyContext(this.args.model);
  }

  // Get parent array when in collection mode
  get parentArray(): ImageField[] | undefined {
    if (!this.isCollectionMode) return undefined;
    const model = this.args.model as unknown as BoxWithState<ImageField>;
    const parent = model.state?.containingBox;
    if (parent) {
      const parentValue = parent.value;
      if (Array.isArray(parentValue)) {
        return parentValue as ImageField[];
      }
    }
    return undefined;
  }

  // Only the first item in a collection should render the collection UI
  // This prevents duplicate UIs when containsMany creates multiple component instances
  get shouldRenderCollection(): boolean {
    if (!this.isCollectionMode) return false;
    const model = this.args.model as unknown as BoxWithState<ImageField>;
    const modelName = model.name;
    return modelName === '0' || modelName === 0;
  }

  get hasImage() {
    return !!this.args.model?.uploadedImageUrl;
  }

  get imageCount(): number {
    const array = this.parentArray;
    return array?.length || 0;
  }

  get firstImage(): ImageField | undefined {
    const array = this.parentArray;
    return array?.[0];
  }

  <template>
    {{#if this.isCollectionMode}}
      {{#if this.shouldRenderCollection}}
        {{! Collection mode - show count with first image }}
        <span class='image-atom multiple-image-atom'>
          {{#if this.firstImage}}
            <img
              src={{this.firstImage.uploadedImageUrl}}
              alt=''
              class='atom-thumbnail'
            />
            <span class='atom-count'>{{this.imageCount}}
              {{if (eq this.imageCount 1) 'image' 'images'}}</span>
          {{else}}
            <Grid3x3Icon class='atom-icon' />
            <span>No images</span>
          {{/if}}
        </span>
        {{! Collection mode but not first item - render nothing }}
        <span style='display: none;'></span>
      {{/if}}
    {{else}}
      {{! Single image mode }}
      <span class='image-atom'>
        {{#if this.hasImage}}
          <img src={{@model.uploadedImageUrl}} alt='' class='atom-thumbnail' />
          <span class='atom-name'>Image</span>
        {{else}}
          <CameraIcon class='atom-icon' />
          <span>No image</span>
        {{/if}}
      </span>
    {{/if}}

    <style scoped>
      .image-atom {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.5rem;
        background: var(--muted, #f1f5f9);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.8125rem;
        max-width: 12rem;
      }

      .atom-thumbnail {
        width: 1.5rem;
        height: 1.5rem;
        object-fit: cover;
        border-radius: calc(var(--radius, 0.375rem) * 0.5);
        flex-shrink: 0;
      }

      .atom-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--foreground, #1a1a1a);
      }

      .atom-icon {
        width: 1rem;
        height: 1rem;
        color: var(--muted-foreground, #9ca3af);
        flex-shrink: 0;
      }

      .multiple-image-atom {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.5rem;
        background: var(--muted, #f1f5f9);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.8125rem;
      }

      .atom-count {
        color: var(--foreground, #1a1a1a);
        font-weight: 500;
      }
    </style>
  </template>
}

export class ImageField extends FieldDef {
  static displayName = 'Image';
  static icon = CameraIcon;

  // Cloudflare upload fields (replaces imageData)
  @field uploadUrl = contains(StringField); // Temporary upload URL from Cloudflare
  @field uploadedImageUrl = contains(StringField); // Permanent CDN URL

  // static embedded = ImageFieldEmbedded;
  // static atom = ImageFieldAtom;
  // static edit = ImageFieldEdit;
}

export default ImageField;
