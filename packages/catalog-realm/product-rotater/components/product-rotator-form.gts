import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

import {
  ImageUploadPreview,
  type ImagePreviewFrame,
} from '../../components/image-upload-preview';

export interface ProductRotatorFormSignature {
  Args: {
    previews?: ImagePreviewFrame[];
    onFilesSelected?: (files: File[]) => void;
    onRemove?: (index: number) => void;
    productDescription?: string;
    onDescriptionChange?: (value: string) => void;
    imageCount?: number;
    onImageCountChange?: (value: string) => void;
    generateLabel?: string;
    onGenerate?: () => void;
    generateDisabled?: boolean;
    isGenerating?: boolean;
    onExport?: () => void;
    exportDisabled?: boolean;
    isExporting?: boolean;
    errorMessage?: string;
  };
}

export class ProductRotatorForm extends Component<ProductRotatorFormSignature> {
  get previews(): ImagePreviewFrame[] {
    return this.args.previews ?? [];
  }

  get productDescription() {
    return this.args.productDescription ?? '';
  }

  get imageCount() {
    return this.args.imageCount ?? 4;
  }

  get generateLabel() {
    return this.args.generateLabel ?? 'Generate Views';
  }

  get generateDisabled() {
    return Boolean(this.args.generateDisabled);
  }

  get exportDisabled() {
    return Boolean(this.args.exportDisabled);
  }

  get hasError() {
    return Boolean(this.args.errorMessage);
  }

  @action
  handleGenerate(event: Event) {
    event.preventDefault();
    this.args.onGenerate?.();
  }

  @action
  handleExport(event: Event) {
    event.preventDefault();
    this.args.onExport?.();
  }

  <template>
    <form class='rotator-form'>
      <ImageUploadPreview
        @previews={{this.previews}}
        @onFilesSelected={{@onFilesSelected}}
        @onRemove={{@onRemove}}
      />

      <FieldContainer
        @tag='label'
        @label='2. Describe Your Product'
        @vertical={{true}}
      >
        <BoxelInput
          @type='textarea'
          @placeholder='e.g., A glossy red water bottle with chrome cap'
          @value={{this.productDescription}}
          @onInput={{@onDescriptionChange}}
        />
      </FieldContainer>

      <FieldContainer
        @tag='label'
        @label='3. Number of Rotation Images'
        @vertical={{true}}
      >
        <BoxelInput
          @type='number'
          @min='2'
          @max='12'
          @value={{this.imageCount}}
          @onInput={{@onImageCountChange}}
          @placeholder='4'
        />
        <p class='rotator-form__help'>
          More images create smoother rotations but increase generation time
          (2-12 images).
        </p>
      </FieldContainer>

      <div class='rotator-form__actions'>
        <BoxelButton
          @kind='primary'
          {{on 'click' this.handleGenerate}}
          disabled={{this.generateDisabled}}
          @loading={{@isGenerating}}
        >
          {{this.generateLabel}}
        </BoxelButton>

        <BoxelButton
          @kind='secondary'
          {{on 'click' this.handleExport}}
          disabled={{this.exportDisabled}}
          @loading={{@isExporting}}
        >
          Export Product Catalog
        </BoxelButton>
      </div>

      {{#if this.hasError}}
        <div class='rotator-form__error'>
          <strong>Error:</strong>
          {{@errorMessage}}
        </div>
      {{/if}}
    </form>

    <style scoped>
      .rotator-form {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .rotator-form__actions {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .rotator-form__help {
        font-size: 0.85rem;
        color: #6b7280;
        margin: 0.5rem 0 0;
      }

      .rotator-form__error {
        padding: 1rem;
        border-radius: 12px;
        background: rgba(254, 226, 226, 0.6);
        border: 1px solid rgba(252, 165, 165, 0.8);
        color: #b91c1c;
        font-size: 0.9rem;
      }
    </style>
  </template>
}
