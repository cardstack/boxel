import FileIcon from '@cardstack/boxel-icons/file';
import {
  BaseDef,
  BaseDefComponent,
  Component,
  StringField,
  contains,
  field,
} from './card-api';

class View extends Component<typeof FileDef> {
  <template>
    {{@model.name}}
  </template>
}

export type SerializedFile = {
  sourceUrl: string;
  url: string;
  name: string;
  contentType: string;
};

export class FileDef extends BaseDef {
  static displayName = 'File';
  static icon = FileIcon;

  @field sourceUrl = contains(StringField);
  @field url = contains(StringField);
  @field name = contains(StringField);
  @field contentType = contains(StringField);

  static embedded: BaseDefComponent = View;
  static fitted: BaseDefComponent = View;
  static isolated: BaseDefComponent = View;
  static atom: BaseDefComponent = View;

  serialize() {
    return {
      sourceUrl: this.sourceUrl,
      url: this.url,
      name: this.name,
      contentType: this.contentType,
    };
  }
}

export function createFileDef({
  url,
  sourceUrl,
  name,
  contentType,
}: {
  url?: string;
  sourceUrl: string;
  name?: string;
  contentType?: string;
}) {
  return new FileDef({ url, sourceUrl, name, contentType });
}
