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
  contentHash?: string;
};

export type ByteStream = ReadableStream<Uint8Array>;

export class FileTypeMismatchError extends Error {
  name = 'FileTypeMismatchError';
}

export class FileDef extends BaseDef {
  static displayName = 'File';
  static icon = FileIcon;

  @field sourceUrl = contains(StringField);
  @field url = contains(StringField);
  @field name = contains(StringField);
  @field contentType = contains(StringField);
  @field contentHash = contains(StringField);

  static embedded: BaseDefComponent = View;
  static fitted: BaseDefComponent = View;
  static isolated: BaseDefComponent = View;
  static atom: BaseDefComponent = View;

  static async extractAttributes(_url: string, _stream: ByteStream) {
    return {};
  }

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
