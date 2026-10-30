import { rri } from '@cardstack/runtime-common';

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
