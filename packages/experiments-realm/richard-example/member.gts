import {
  CardDef,
  field,
  StringField,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { University } from './university';
import { Project } from './project';
import { StatusTagField } from '../crm/contact-status-tag';

export class Member extends CardDef {
  static displayName = 'Member';

  @field project = linksTo(() => Project);
  @field name = contains(StringField);
  @field university = linksTo(() => University);
   @field statusTag = contains(StatusTagField, {
    computeVia: function (this: Customer) {
      return new StatusTagField({
        label: 'Member',
        lightColor: '#8bff98',
        darkColor: '#01d818',
      });
    },
  });
}
