import StringCard from './string';
import { CardDef, field, contains, Component } from './card-api';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

class Edit extends Component<typeof Base64ImageCard> {
  @tracked error: string | undefined;
  fileChanged = (event: Event) => {
    this.error = undefined;
    let here = this;
    let [file] = ((event.target as any).files as undefined | Blob[]) ?? [];
    if (!file) {
      return;
    }
    let reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      console.log(reader.result);
      here.args.model.base64 = reader.result as string;
    };
    reader.onerror = function (error) {
      here.error = String(error);
    };
  };

  <template>
    {{#if this.error}}
      <div class='error'>{{this.error}}</div>
    {{else if @model.base64}}
      <img src={{@model.base64}} />
    {{else}}
      <div>Upload image</div>
    {{/if}}
    <input {{on 'change' this.fileChanged}} type='file' />
  </template>
}

export class Base64ImageCard extends CardDef {
  static displayName = 'Base64 Image Card';
  @field base64 = contains(StringCard);
  @field altText = contains(StringCard);

  static edit = Edit;
  static isolated = class Isolated extends Component<typeof this> {
    get imageSrc() {
      return `data:image/png;base64, ${this.args.model.base64}`;
    }
    <template>
      {{#if @model.base64}}
        <img src={{@model.base64}} />
      {{/if}}
    </template>
  };

  static embedded = Base64ImageCard.isolated;
}
