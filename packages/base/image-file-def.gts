import NumberField from './number';
import { BaseDefComponent, Component, contains, field } from './card-api';
import { FileDef } from './file-api';

class Isolated extends Component<typeof ImageDef> {
  <template>
    <div class='image-isolated'>
      {{#if @model.url}}
        <img
          class='image-isolated__img'
          src={{@model.url}}
          alt={{@model.name}}
          width={{@model.width}}
          height={{@model.height}}
        />
        <footer class='image-isolated__meta'>
          <span class='image-isolated__name'>{{@model.name}}</span>
          {{#if @model.width}}
            <span class='image-isolated__dimensions'>{{@model.width}}
              &times;
              {{@model.height}}px</span>
          {{/if}}
        </footer>
      {{else}}
        <p class='image-isolated__empty'>{{@model.name}}</p>
      {{/if}}
    </div>
    <style scoped>
      .image-isolated {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-xs);
        max-width: 100%;
      }

      .image-isolated__img {
        max-width: 100%;
        height: auto;
        border-radius: var(--boxel-radius-sm);
      }

      .image-isolated__meta {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
      }

      .image-isolated__name {
        font-weight: 600;
        color: var(--boxel-900);
      }

      .image-isolated__empty {
        color: var(--boxel-600);
        margin: 0;
      }
    </style>
  </template>
}

class Atom extends Component<typeof ImageDef> {
  <template>
    <div class='image-atom'>
      {{#if @model.url}}
        <img
          class='image-atom__img'
          src={{@model.url}}
          alt={{@model.name}}
        />
      {{/if}}
      <span class='image-atom__name'>{{@model.name}}</span>
    </div>
    <style scoped>
      .image-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }

      .image-atom__img {
        width: 20px;
        height: 20px;
        object-fit: cover;
        border-radius: var(--boxel-radius-xs);
        flex-shrink: 0;
      }

      .image-atom__name {
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

class Embedded extends Component<typeof ImageDef> {
  <template>
    <div class='image-embedded'>
      {{#if @model.url}}
        <img
          class='image-embedded__img'
          src={{@model.url}}
          alt={{@model.name}}
        />
      {{else}}
        <p class='image-embedded__empty'>{{@model.name}}</p>
      {{/if}}
    </div>
    <style scoped>
      .image-embedded {
        width: 100%;
      }

      .image-embedded__img {
        display: block;
        width: 100%;
        height: auto;
        border-radius: var(--boxel-radius-sm);
      }

      .image-embedded__empty {
        color: var(--boxel-600);
        margin: 0;
      }
    </style>
  </template>
}

class Fitted extends Component<typeof ImageDef> {
  get backgroundImageStyle() {
    if (this.args.model.url) {
      return `background-image: url(${this.args.model.url});`;
    }
    return undefined;
  }

  <template>
    <div class='image-fitted'>
      {{#if @model.url}}
        <div
          class='image-fitted__bg'
          style={{this.backgroundImageStyle}}
          role='img'
          aria-label={{@model.name}}
        ></div>
      {{else}}
        <div class='image-fitted__placeholder'>
          <span class='image-fitted__name'>{{@model.name}}</span>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .image-fitted {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      .image-fitted__bg {
        width: 100%;
        height: 100%;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
      }

      .image-fitted__placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--boxel-100);
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
      }

      .image-fitted__name {
        font-size: var(--boxel-font-xs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
      }
    </style>
  </template>
}

export class ImageDef extends FileDef {
  static displayName = 'Image';
  static acceptTypes = 'image/*';

  @field width = contains(NumberField);
  @field height = contains(NumberField);

  static isolated: BaseDefComponent = Isolated;
  static embedded: BaseDefComponent = Embedded;
  static atom: BaseDefComponent = Atom;
  static fitted: BaseDefComponent = Fitted;
}
