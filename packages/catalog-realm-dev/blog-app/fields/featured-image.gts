import { hash } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import {
  Component,
  field,
  contains,
  StringField,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { ImageSizeField } from 'https://cardstack.com/base/base64-image';
import UrlField from 'https://cardstack.com/base/url';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { FailureBordered } from '@cardstack/boxel-ui/icons';
import PhotoIcon from '@cardstack/boxel-icons/photo';

const setBackgroundImage = (backgroundURL: string | null | undefined) => {
  if (!backgroundURL) {
    return;
  }
  return htmlSafe(`background-image: url(${backgroundURL});`);
};

function cssForFeaturedImage({
  imageUrl,
  size,
  height,
  width,
}: {
  imageUrl: string | undefined;
  size: 'actual' | 'contain' | 'cover' | undefined;
  height?: number;
  width?: number;
}) {
  if (!imageUrl) {
    return undefined;
  }

  let css: string[] = [];
  css.push(`background-image: url("${imageUrl}");`);
  if (size && ['contain', 'cover'].includes(size)) {
    css.push(`background-size: ${size};`);
  }
  if (height) {
    css.push(`height: ${height}px;`);
  }
  if (width) {
    css.push(`width: ${width}px`);
  } else {
    css.push(`width: 100%`);
  }
  return htmlSafe(css.join(' '));
}

export class FeaturedImageField extends FieldDef {
  static displayName = 'Featured Image';
  static icon = PhotoIcon;
  @field imageUrl = contains(UrlField);
  @field credit = contains(StringField);
  @field caption = contains(StringField);
  @field altText = contains(StringField);
  @field size = contains(ImageSizeField);
  @field height = contains(NumberField);
  @field width = contains(NumberField);
  static edit = class Edit extends Component<typeof this> {
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
      <div class='featured-image-edit'>
        {{#if @model.imageUrl}}
          <FieldContainer class='preview-field' @label='Preview' @tag='label'>
            {{#if this.needsHeight}}
              <p class='height-warning'>
                <FailureBordered />
                Can't render current image. Please provide a height when using
                the "contain" or "cover" size.
              </p>
            {{else if this.usesActualSize}}
              <img
                class='image'
                src={{@model.imageUrl}}
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
                  class='image'
                  role='img'
                  aria-label={{@model.altText}}
                  style={{cssForFeaturedImage
                    (hash
                      imageUrl=@model.imageUrl
                      size=@model.size
                      height=@model.height
                      width=@model.width
                    )
                  }}
                />
              </div>
            {{/if}}
          </FieldContainer>
        {{/if}}
        <FieldContainer @label='Image Url' @tag='label'>
          <@fields.imageUrl />
        </FieldContainer>
        <FieldContainer @label='Alt Text' @tag='label'>
          <@fields.altText />
        </FieldContainer>
        <FieldContainer @label='Caption' @tag='label'>
          <@fields.caption />
        </FieldContainer>
        <FieldContainer @label='Credit' @tag='label'>
          <@fields.credit />
        </FieldContainer>
        <FieldContainer @label='Size' @tag='label'>
          <@fields.size />
        </FieldContainer>
        <FieldContainer @label='Height (px)' @tag='label'>
          <@fields.height />
        </FieldContainer>
        <FieldContainer @label='Width (px)' @tag='label'>
          <@fields.width />
        </FieldContainer>
      </div>

      <style scoped>
        .featured-image-edit {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
          background-color: var(--boxel-100);
          border-radius: var(--boxel-form-control-border-radius);
        }
        .preview-field :deep(.content) {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
        }
        .preview-field.boxel-field > :deep(.content) > .image {
          flex: unset;
        }
        .image {
          background-repeat: no-repeat;
          background-position: center;
        }
        .checkerboard-preview-background {
          display: flex;
          align-items: center;
          justify-content: center;
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
          background-image:
            linear-gradient(45deg, var(--boxel-300) 25%, transparent 25%),
            linear-gradient(-45deg, var(--boxel-300) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, var(--boxel-300) 75%),
            linear-gradient(-45deg, transparent 75%, var(--boxel-300) 75%);
          overflow: hidden;
        }
        .height-warning {
          display: flex;
          align-items: center;
          margin: 0;
          color: var(--boxel-error-200);
          font: 500 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .height-warning svg {
          min-width: 20px;
          margin-right: var(--boxel-sp-xxs);
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.imageUrl}}
        <div
          class='image'
          role='img'
          alt={{@model.altText}}
          style={{setBackgroundImage @model.imageUrl}}
        />
      {{/if}}
      <style scoped>
        .image {
          width: var(--atom-image-width, auto);
          height: var(--atom-image-height, 100px);
          background-size: var(--atom-image-background-size, contain);
          background-repeat: no-repeat;
          background-position: center;
        }
      </style>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    get usesActualSize() {
      return this.args.model.size === 'actual' || this.args.model.size == null;
    }
    <template>
      {{#if @model.imageUrl}}
        <figure>
          {{#if this.usesActualSize}}
            <img
              class='image'
              src={{@model.imageUrl}}
              height={{@model.height}}
              width={{@model.width}}
              alt={{@model.altText}}
            />
          {{else}}
            <div
              class='image'
              role='img'
              aria-label={{@model.altText}}
              style={{cssForFeaturedImage
                (hash
                  imageUrl=@model.imageUrl
                  size=@model.size
                  height=@model.height
                  width=@model.width
                )
              }}
            >
            </div>
          {{/if}}
          <figcaption>
            <p class='credit'><small><@fields.credit /></small></p>
            <p class='caption'><@fields.caption /></p>
          </figcaption>
        </figure>
      {{/if}}
      <style scoped>
        figure,
        img {
          max-width: 100%;
        }
        figure,
        p {
          margin: 0;
        }
        figcaption {
          font-size: 0.8125em;
          font-style: italic;
        }
        .image {
          background-repeat: no-repeat;
          background-position: center;
        }
        .credit {
          line-height: 1.1;
        }
        .credit + .caption {
          margin-top: var(--boxel-sp-4xs);
        }
      </style>
    </template>
  };
}
