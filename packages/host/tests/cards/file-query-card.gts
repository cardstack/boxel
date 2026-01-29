import {
  contains,
  linksToMany,
  field,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import { FileDef } from 'https://cardstack.com/base/file-api';
import StringField from 'https://cardstack.com/base/string';

const fileSearchQuery = {
  filter: {
    type: { module: 'https://cardstack.com/base/file-api', name: 'FileDef' },
  },
  realm: '$thisRealm',
};

export class FileQueryCard extends CardDef {
  @field nameFilter = contains(StringField);
  @field matchingFiles = linksToMany(FileDef, { query: fileSearchQuery });
}
