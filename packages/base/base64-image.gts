import StringField from './string';
import NumberField from './number';
import {
  FieldDef,
  field,
  contains,
  Component,
  primitive,
  useIndexBasedKey,
} from './card-api';
import { tracked } from '@glimmer/tracking';
import Modifier from 'ember-modifier';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { hash } from '@ember/helper';
import { pick, eq } from '@cardstack/boxel-ui/helpers';
import { FieldContainer, BoxelInput } from '@cardstack/boxel-ui/components';
import { FailureBordered } from '@cardstack/boxel-ui/icons';
import { htmlSafe } from '@ember/template';

const atomImgHeight = 200;

class Edit extends Component<typeof Base64ImageField> {
  @tracked error: string | undefined;

  get base64InputState() {
    return this.error ? 'invalid' : 'initial';
  }

  fileChanged = (event: Event) => {
    this.error = undefined;
    let [file] = ((event.target as any).files as undefined | Blob[]) ?? [];
    if (!file) {
      return;
    }
    let reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      this.args.model.base64 = reader.result as string;
    };
    reader.onerror = (error) => {
      this.error = String(error);
    };
  };

  get usesActualSize() {
    return this.args.model.size === 'actual' || this.args.model.size == null;
  }

  get backgroundMaskStyle() {
    let css: string[] = [];
    if (this.args.model.height) {
      css.push(`height: ${this.args.model.height}px;`);
    }
    if (this.args.model.width) {
      css.push(`width: ${this.args.model.width}px`);
    }
    return htmlSafe(css.join(' '));
  }

  get needsHeight() {
    return (
      (this.args.model.size === 'contain' ||
        this.args.model.size === 'cover') &&
      !this.args.model.height
    );
  }

  <template>
    <div class='base64-edit'>
      <FieldContainer @label='Image' data-test-field='base64'>
        <div class='image-field'>
          {{#if @model.base64}}
            <div class='preview-wrapper'>
              {{#if this.needsHeight}}
                <div data-test-height-warning class='height-warning'>
                  <FailureBordered />
                  <span>
                    Can't render current image. Please provide a height when
                    using the "contain" or "cover" size.
                  </span>
                </div>
              {{else if this.usesActualSize}}
                <img
                  data-test-actual-img
                  src={{sanitizeBase64 @model.base64}}
                  height={{@model.height}}
                  width={{@model.width}}
                  alt={{@model.altText}}
                />
              {{else}}
                <div
                  class='checkerboard-preview-background'
                  style={{this.backgroundMaskStyle}}
                >
                  <div
                    data-test-contain-cover-img
                    role='img'
                    aria-label={{@model.altText}}
                    class='preview'
                    style={{cssForBase64
                      (hash
                        base64=@model.base64
                        size=@model.size
                        height=@model.height
                        width=@model.width
                      )
                    }}
                  >
                  </div>
                </div>
              {{/if}}
            </div>
          {{/if}}
          <BoxelInput
            data-test-base64-field
            @errorMessage={{this.error}}
            @state={{this.base64InputState}}
            {{on 'change' this.fileChanged}}
            type='file'
          />
        </div>
      </FieldContainer>
      <FieldContainer @label='Alt Text' data-test-field='altText'>
        <@fields.altText />
      </FieldContainer>
      <FieldContainer @label='Size' data-test-field='size'>
        <@fields.size />
      </FieldContainer>
      <FieldContainer @label='Height (px)' data-test-field='height'>
        <@fields.height />
      </FieldContainer>
      <FieldContainer @label='Width (px)' data-test-field='width'>
        <@fields.width />
      </FieldContainer>
    </div>

    <style>
      .base64-edit {
        display: grid;
        gap: var(--boxel-sp-lg);
      }
      .preview-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        margin-bottom: var(--boxel-sp);
      }
      .preview {
        border-radius: var(--boxel-form-control-border-radius);
        background-repeat: no-repeat;
        background-position: center;
      }
      .checkerboard-preview-background {
        width: 100%;
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        background-color: white;
        background-size: 24px 24px;
        background-position:
          12px 12px,
          -12px 0,
          0 0,
          0 12px;
        background-image: linear-gradient(
            45deg,
            var(--boxel-300) 25%,
            transparent 25%
          ),
          linear-gradient(-45deg, var(--boxel-300) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, var(--boxel-300) 75%),
          linear-gradient(-45deg, transparent 75%, var(--boxel-300) 75%);
      }
      .height-warning {
        display: flex;
        align-items: center;
        color: var(--boxel-error-200);
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
      }
      .height-warning svg {
        min-width: 20px;
      }
      .height-warning span {
        margin-left: var(--boxel-sp-xxs);
      }
    </style>
  </template>
}

// this allows multiple radio groups rendered on the page
// to stay independent of one another.
let groupNumber = 0;
class ImageSizeField extends FieldDef {
  static displayName = 'Image Size';
  @field value = primitive<'actual' | 'contain' | 'cover'>();
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='radio-group' data-test-radio-group={{@fieldName}}>
        <label for='{{this.radioGroup}}_actual'>
          Actual
          <input
            data-test-actual-size-input
            type='radio'
            {{RadioInitializer @model 'actual'}}
            id='{{this.radioGroup}}_actual'
            name='{{this.radioGroup}}'
            checked={{eq @model 'actual'}}
            {{on 'change' (pick 'target.value' (fn @set 'actual'))}}
          />
        </label>
        <label for='{{this.radioGroup}}_contain'>
          Contain
          <input
            data-test-contain-size-input
            type='radio'
            {{RadioInitializer @model 'contain'}}
            id='{{this.radioGroup}}_contain'
            name='{{this.radioGroup}}'
            checked={{eq @model 'contain'}}
            {{on 'change' (pick 'target.value' (fn @set 'contain'))}}
          />
        </label>
        <label for='{{this.radioGroup}}_cover'>
          Cover
          <input
            data-test-cover-size-input
            type='radio'
            {{RadioInitializer @model 'cover'}}
            id='{{this.radioGroup}}_cover'
            name='{{this.radioGroup}}'
            checked={{eq @model 'cover'}}
            {{on 'change' (pick 'target.value' (fn @set 'cover'))}}
          />
        </label>
      </div>
      <style>
        .radio-group {
          display: flex;
          justify-content: space-between;
        }
      </style>
    </template>

    private radioGroup = `__cardstack_img_size${groupNumber++}__`;
    constructor(owner: unknown, args: any) {
      super(owner, args);
      // initializes to 'actual'
      if (!this.args.model) {
        this.args.set('actual');
      }
    }
  };
  static atom = class Atom extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
}

interface RadioSignature {
  element: HTMLInputElement;
  Args: {
    Positional: [
      model: 'actual' | 'cover' | 'contain' | null,
      inputType: 'actual' | 'cover' | 'contain',
    ];
  };
}

class RadioInitializer extends Modifier<RadioSignature> {
  modify(
    element: HTMLInputElement,
    [model, inputType]: RadioSignature['Args']['Positional'],
  ) {
    element.checked = model === inputType;
  }
}

function getConstrainedImageSize(maxHeight: number) {
  return class ConstrainedSize extends Component<typeof Base64ImageField> {
    get height() {
      return Math.min(maxHeight, this.args.model.height || 0) || maxHeight;
    }
    <template>
      {{#if @model.base64}}
        <div
          data-test-contain-cover-img
          role='img'
          aria-label={{@model.altText}}
          class='preview'
          style={{cssForBase64
            (hash base64=@model.base64 size='contain' height=this.height)
          }}
        >
        </div>
      {{/if}}
      <style>
        .preview {
          background-repeat: no-repeat;
          background-position: center;
        }
      </style>
    </template>
  };
}

export class Base64ImageField extends FieldDef {
  static displayName = 'Base64 Image Card';
  @field altText = contains(StringField);
  @field size = contains(ImageSizeField);
  @field height = contains(NumberField);
  @field width = contains(NumberField);
  @field base64 = contains(StringField);

  static edit = Edit;
  static atom = getConstrainedImageSize(atomImgHeight);
  static isolated = class Isolated extends Component<typeof this> {
    get usesActualSize() {
      return this.args.model.size === 'actual' || this.args.model.size == null;
    }
    <template>
      {{#if @model.base64}}
        {{#if this.usesActualSize}}
          <img
            data-test-actual-img
            src={{sanitizeBase64 @model.base64}}
            height={{@model.height}}
            width={{@model.width}}
            alt={{@model.altText}}
          />
        {{else}}
          <div
            data-test-contain-cover-img
            role='img'
            aria-label={{@model.altText}}
            class='preview'
            style={{cssForBase64
              (hash
                base64=@model.base64
                size=@model.size
                height=@model.height
                width=@model.width
              )
            }}
          >
          </div>
        {{/if}}
      {{/if}}
      <style>
        .preview {
          background-repeat: no-repeat;
          background-position: center;
        }
      </style>
    </template>
  };
  static embedded = Base64ImageField.isolated;
}

// from "ember-css-url"
function sanitizeBase64(base64: string) {
  // sanitize the base64 by making sure there are no unencoded double quotes
  let encodedURL = base64.replace(/"/g, '%22');
  let match = /^([^:]+):/.exec(encodedURL);
  let proto = match?.[1].toLowerCase();
  // also make sure "data:" protocol is used (prevents "javascript://" from older browsers)
  if (proto !== 'data') {
    throw new Error(`disallowed protocol in css url: ${base64}`);
  }
  return encodedURL;
}

function cssForBase64({
  base64,
  size,
  height,
  width,
}: {
  base64: string | undefined;
  size: 'actual' | 'contain' | 'cover' | undefined;
  height?: number;
  width?: number;
}) {
  if (!base64) {
    return undefined;
  }

  let css: string[] = [];
  base64 = sanitizeBase64(base64);
  css.push(`background-image: url("${base64}");`);
  if (size && ['contain', 'cover'].includes(size)) {
    css.push(`background-size: ${size};`);
  }
  if (height) {
    css.push(`height: ${height}px;`);
  }
  if (width) {
    css.push(`width: ${width}px`);
  }
  return htmlSafe(css.join(' '));
}
