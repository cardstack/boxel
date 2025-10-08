import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

import {
  Button,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

export interface ImagePreviewFrame {
  url: string;
  label: string;
}

export interface ProductImageUploadSectionSignature {
  Args: {
    label?: string;
    previews?: ImagePreviewFrame[];
    onFilesSelected?: (files: File[]) => void;
    onRemove?: (index: number) => void;
  };
}

export class ProductImageUploadSection extends Component<ProductImageUploadSectionSignature> {
  @tracked inputId = `product-upload-${Math.random().toString(36).slice(2)}`;

  get previews(): ImagePreviewFrame[] {
    return this.args.previews ?? [];
  }

  get label() {
    return this.args.label ?? '1. Select Product Images';
  }

  @action
  openPicker(event: Event) {
    event.preventDefault();
    let input = document.getElementById(this.inputId) as HTMLInputElement | null;
    input?.click();
  }

  @action
  handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }

    const files = Array.from(input.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    );

    if (files.length) {
      this.args.onFilesSelected?.(files);
    }

    input.value = '';
  }

  @action
  handleRemove(index: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.args.onRemove?.(index);
  }

  <template>
    <FieldContainer
      @tag='section'
      @label={{this.label}}
      @vertical={{true}}
      class='product-upload'
    >
      <label for={{this.inputId}} class='product-upload__trigger'>
        <Button @kind='secondary' {{on 'click' this.openPicker}}>
          Add Images
        </Button>
      </label>

      <input
        id={{this.inputId}}
        type='file'
        accept='image/*'
        multiple={{true}}
        class='product-upload__input'
        {{on 'change' this.handleFileChange}}
      />

      {{#if this.previews.length}}
        <div class='product-upload__previews'>
          <p class='product-upload__count'>
            Selected {{this.previews.length}} image(s)
          </p>

          <div class='product-upload__grid'>
            {{#each this.previews as |preview index|}}
              <div class='product-upload__item'>
                <div class='product-upload__image-wrapper'>
                  <img src={{preview.url}} alt={{preview.label}} />
                  <button
                    type='button'
                    class='product-upload__remove'
                    title='Remove image'
                    {{on 'click' (fn this.handleRemove index)}}
                  >
                    ×
                  </button>
                </div>
                <span class='product-upload__label'>{{preview.label}}</span>
              </div>
            {{/each}}
          </div>
        </div>
      {{else}}
        <p class='product-upload__hint'>
          Upload multiple product reference images to guide the generator.
        </p>
      {{/if}}
    </FieldContainer>

    <style scoped>
      .product-upload__input {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
      }

      .product-upload__trigger {
        display: inline-flex;
      }

      .product-upload__previews {
        margin-top: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .product-upload__count {
        margin: 0;
        font-size: 0.875rem;
        color: #6b7280;
        font-weight: 500;
      }

      .product-upload__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 0.75rem;
      }

      .product-upload__item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.35rem;
      }

      .product-upload__image-wrapper {
        position: relative;
        width: 100%;
      }

      .product-upload__image-wrapper img {
        width: 100%;
        height: 100%;
        border-radius: 8px;
        object-fit: cover;
        aspect-ratio: 1 / 1;
        border: 1px solid rgba(148, 163, 184, 0.4);
        box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.2);
      }

      .product-upload__remove {
        position: absolute;
        top: -8px;
        right: -8px;
        width: 22px;
        height: 22px;
        border-radius: 9999px;
        border: none;
        background: #ef4444;
        color: #ffffff;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
        line-height: 1;
        transition: transform 0.2s ease;
      }

      .product-upload__remove:hover {
        transform: scale(1.1);
      }

      .product-upload__label {
        font-size: 0.75rem;
        color: #4b5563;
        font-weight: 500;
      }

      .product-upload__hint {
        margin: 0.5rem 0 0;
        font-size: 0.85rem;
        color: #6b7280;
      }
    </style>
  </template>
}
