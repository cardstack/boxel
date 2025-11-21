// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { eq } from '@cardstack/boxel-ui/helpers'; // ¹ Helper imports
import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import UploadIcon from '@cardstack/boxel-icons/upload';
import XIcon from '@cardstack/boxel-icons/x';
import ZoomInIcon from '@cardstack/boxel-icons/zoom-in';
import CameraIcon from '@cardstack/boxel-icons/camera';
import Loader2Icon from '@cardstack/boxel-icons/loader-2';
import { BrowsePreview } from './components/browse-preview'; // ² Preview component imports
import { AvatarPreview } from './components/avatar-preview';
import { DropzonePreview } from './components/dropzone-preview';
import { UploadProgress } from './components/upload-progress'; // ⁷ Upload progress component
import { BrowseUpload } from './components/browse-upload'; // ⁹ Upload trigger components
import { AvatarUpload } from './components/avatar-upload';
import { DropzoneUpload } from './components/dropzone-upload';
import { PreviewModal } from './components/preview-modal'; // ¹¹ Preview modal component

// ¹³ TypeScript configuration interface
export type ImageFieldConfiguration =
  | {
      variant: 'browse' | 'dropzone';
      presentation?: 'default' | 'compact' | 'featured';
      options?: {
        showProgress?: boolean;
        showImageModal?: boolean;
      };
    }
  | {
      variant: 'avatar';
      presentation?: 'default' | 'compact' | 'featured';
      options?: {
        showProgress?: boolean;
        // No showImageModal allowed here
      };
    };

class ImageFieldEdit extends Component<typeof ImageField> {
  @tracked preview: string | null = null;
  @tracked isUploading = false;
  @tracked uploadProgress = 0;
  @tracked showPreview = false;

  get hasImage() {
    return this.preview || this.args.model?.imageData;
  }

  get displayPreview() {
    return this.preview || this.args.model?.imageData || '';
  }

  get variant() {
    return (this.args.configuration as any)?.variant || 'browse';
  }

  get presentation() {
    return (this.args.configuration as any)?.presentation || 'default';
  }

  get options() {
    return (
      (this.args.configuration as ImageFieldConfiguration['options'])
        ?.options || {}
    );
  }

  get showProgress() {
    return this.options.showProgress !== false;
  }

  get showImageModal() {
    return this.options.showImageModal !== false;
  }

  @action
  handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      const img = new Image();

      img.onload = () => {
        if (this.showProgress) {
          this.isUploading = true;
          this.uploadProgress = 0;

          const interval = setInterval(() => {
            this.uploadProgress += 10;

            if (this.uploadProgress >= 100) {
              clearInterval(interval as unknown as number);
              this.isUploading = false;
              this.preview = result;
              this.args.model.imageData = result;
              this.args.model.fileName = file.name;
              this.args.model.fileSize = file.size;
              this.args.model.width = img.width;
              this.args.model.height = img.height;
            }
          }, 200);
        } else {
          this.preview = result;
          this.args.model.imageData = result;
          this.args.model.fileName = file.name;
          this.args.model.fileSize = file.size;
          this.args.model.width = img.width;
          this.args.model.height = img.height;
        }
      };

      img.src = result;
    };

    reader.readAsDataURL(file);
  }

  @action
  removeImage() {
    this.preview = null;
    this.args.model.imageData = undefined;
    this.args.model.fileName = undefined;
    this.args.model.fileSize = undefined;
    this.args.model.width = undefined;
    this.args.model.height = undefined;
  }

  @action
  handleDragOver(event: DragEvent) {
    event.preventDefault();
  }

  @action
  handleDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];

    if (file && file.type.startsWith('image/')) {
      const fakeEvent = {
        target: {
          files: [file],
        },
      } as any;
      this.handleFileSelect(fakeEvent);
    }
  }

  @action
  togglePreview() {
    this.showPreview = !this.showPreview;
  }

  get formattedSize() {
    const bytes = this.args.model?.fileSize;
    if (!bytes) return '';

    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  <template>
    <div class='image-field-edit' data-test-image-field-edit>
      {{#if this.isUploading}}
        {{! ⁸ Upload progress component }}
        <UploadProgress @progress={{this.uploadProgress}} />
      {{else if this.hasImage}}
        {{! ³ Image preview display }}
        {{#if (eq this.variant 'avatar')}}
          <AvatarPreview
            @imageData={{this.displayPreview}}
            @fileName={{@model.fileName}}
            @onRemove={{this.removeImage}}
          />
        {{else if (eq this.variant 'dropzone')}}
          <DropzonePreview
            @imageData={{this.displayPreview}}
            @fileName={{@model.fileName}}
            @fileSize={{@model.fileSize}}
            @width={{@model.width}}
            @height={{@model.height}}
            @onRemove={{this.removeImage}}
            @onZoom={{this.togglePreview}}
            @showZoomButton={{this.showImageModal}}
          />
        {{else}}
          <BrowsePreview
            @imageData={{this.displayPreview}}
            @fileName={{@model.fileName}}
            @fileSize={{@model.fileSize}}
            @width={{@model.width}}
            @height={{@model.height}}
            @onRemove={{this.removeImage}}
            @onZoom={{this.togglePreview}}
            @showZoomButton={{this.showImageModal}}
          />
        {{/if}}
      {{else}}
        {{! ¹⁰ Upload trigger components }}
        {{#if (eq this.variant 'avatar')}}
          <AvatarUpload @onFileSelect={{this.handleFileSelect}} />
        {{else if (eq this.variant 'dropzone')}}
          <DropzoneUpload
            @onFileSelect={{this.handleFileSelect}}
            @onDragOver={{this.handleDragOver}}
            @onDrop={{this.handleDrop}}
          />
        {{else}}
          <BrowseUpload @onFileSelect={{this.handleFileSelect}} />
        {{/if}}
      {{/if}}

      {{#if this.showPreview}}
        {{! ¹² Full-screen preview modal }}
        <PreviewModal
          @imageData={{this.displayPreview}}
          @fileName={{@model.fileName}}
          @fileSize={{@model.fileSize}}
          @onClose={{this.togglePreview}}
        />
      {{/if}}
    </div>

    <style scoped>
      .image-field-edit {
        width: 100%;
      }
    </style>
  </template>
}

export class ImageField extends FieldDef {
  static displayName = 'Image';
  static icon = CameraIcon;

  @field imageData = contains(StringField);
  @field fileName = contains(StringField);
  @field fileSize = contains(NumberField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
  @field altText = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    get hasImage() {
      return !!this.args.model?.imageData;
    }

    get presentation() {
      return (this.args.configuration as any)?.presentation || 'default';
    }

    <template>
      <div class='image-embedded presentation-{{this.presentation}}'>
        {{#if this.hasImage}}
          <img
            src={{@model.imageData}}
            alt={{if @model.altText @model.altText @model.fileName}}
            class='embedded-image'
          />
        {{else}}
          <div class='no-image'>
            <CameraIcon class='camera-icon' />
            <span>No image</span>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .image-embedded {
          width: 100%;
          height: 100%;
          min-height: 8rem;
        }

        .embedded-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: var(--radius, 0.375rem);
        }

        .no-image {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          background: var(--muted, #f1f5f9);
          border-radius: var(--radius, 0.375rem);
          color: var(--muted-foreground, #9ca3af);
          font-size: 0.875rem;
          gap: 0.5rem;
        }

        .camera-icon {
          width: 2rem;
          height: 2rem;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get hasImage() {
      return !!this.args.model?.imageData;
    }

    <template>
      <span class='image-atom'>
        {{#if this.hasImage}}
          <img
            src={{@model.imageData}}
            alt={{if @model.altText @model.altText @model.fileName}}
            class='atom-thumbnail'
          />
          <span class='atom-name'>{{@model.fileName}}</span>
        {{else}}
          <CameraIcon class='atom-icon' />
          <span>No image</span>
        {{/if}}
      </span>

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
      </style>
    </template>
  };

  static edit = ImageFieldEdit;
}

export default ImageField;
