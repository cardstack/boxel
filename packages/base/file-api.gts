import { concat } from '@ember/helper';
import FileIcon from '@cardstack/boxel-icons/file';
import {
  BaseDef,
  BaseDefComponent,
  Component,
  ReadOnlyField,
  StringField,
  contains,
  field,
} from './card-api';

class View extends Component<typeof FileDef> {
  <template>
    {{@model.name}}
  </template>
}

class Edit extends Component<typeof FileDef> {
  <template>
    <div class='filedef-edit-unavailable' data-test-filedef-edit-unavailable>
      This file
      {{if (concat '(' @model.id ')') ''}}
      is not editable via this interface. Replace it via file upload.
    </div>
    <style scoped>
      .filedef-edit-unavailable {
        background: var(--boxel-light);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-radius-sm);
        color: var(--boxel-700);
        font-size: var(--boxel-font-sm);
        padding: var(--boxel-sp-md);
      }
    </style>
  </template>
}

export type SerializedFile = {
  sourceUrl: string;
  url: string;
  name: string;
  contentType: string;
  contentHash?: string;
};

export class FileDef extends BaseDef {
  static displayName = 'File';
  static icon = FileIcon;

  @field id = contains(ReadOnlyField);
  @field sourceUrl = contains(StringField);
  @field url = contains(StringField);
  @field name = contains(StringField);
  @field contentType = contains(StringField);
  @field contentHash = contains(StringField);

  static embedded: BaseDefComponent = View;
  static fitted: BaseDefComponent = View;
  static isolated: BaseDefComponent = View;
  static atom: BaseDefComponent = View;
  static edit: BaseDefComponent = Edit;

  serialize() {
    return {
      sourceUrl: this.sourceUrl,
      url: this.url,
      name: this.name,
      contentType: this.contentType,
      contentHash: this.contentHash,
    };
  }
}

export interface SerializedFileDef {
  url?: string;
  sourceUrl: string;
  name?: string;
  contentHash?: string;
  contentType?: string;
  content?: string;
  error?: string;
}

export function createFileDef({
  url,
  sourceUrl,
  name,
  contentType,
  contentHash,
}: SerializedFileDef) {
  return new FileDef({ url, sourceUrl, name, contentType, contentHash });
}
