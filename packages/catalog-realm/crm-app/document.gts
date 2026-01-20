import {
  CardDef,
  contains,
  StringField,
  field,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';

export class Document extends CardDef {
  static displayName = 'Document';
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Document) {
      return 'Document';
    },
  });
}

export class Proposal extends Document {
  static displayName = 'Proposal';
  @field summary = contains(MarkdownField);
  @field terms = contains(MarkdownField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Document) {
      return 'Proposal';
    },
  });
}
