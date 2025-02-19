import {
  StringField,
  contains,
  field,
  linksTo,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import { SuperProjectAccount } from './account';
import { Component } from 'https://cardstack.com/base/card-api';
import FolderOpen from '@cardstack/boxel-icons/folder-open';
import EntityDisplayWithIcon from '../components/entity-icon-display';

class EmbeddedTemplate extends Component<typeof SuperProjectTask> {
  <template>
    <EntityDisplayWithIcon @title={{this.args.model.name}}>
      <:icon>
        <FolderOpen />
      </:icon>
    </EntityDisplayWithIcon>
  </template>
}

export class SuperProjectTask extends CardDef {
  static displayName = 'Super Project Task';

  @field name = contains(StringField);
  @field account = linksTo(() => SuperProjectAccount);

  @field title = contains(StringField, {
    computeVia: function (this: SuperProjectTask) {
      return this.name ?? `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = EmbeddedTemplate;
}
