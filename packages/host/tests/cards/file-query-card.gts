import {
  contains,
  linksToMany,
  field,
  CardDef,
} from '@cardstack/base/card-api';
import { FileDef } from '@cardstack/base/file-api';
import StringField from '@cardstack/base/string';

const fileSearchQuery = {
  filter: {
    type: { module: '@cardstack/base/file-api', name: 'FileDef' },
  },
  realm: '$thisRealm',
};

export class FileQueryCard extends CardDef {
  @field nameFilter = contains(StringField);
  @field matchingFiles = linksToMany(FileDef, { query: fileSearchQuery });
}
