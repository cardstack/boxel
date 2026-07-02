import { rri } from '@cardstack/runtime-common';

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
    type: {
      module: rri('@cardstack/base/card-api'),
      name: 'FileDef',
    },
  },
  realm: '$REALM',
};

export class FileQueryCard extends CardDef {
  @field nameFilter = contains(StringField);
  @field matchingFiles = linksToMany(FileDef, { query: fileSearchQuery });
}
