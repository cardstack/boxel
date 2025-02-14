import { Member } from './member';
import { field, contains } from 'https://cardstack.com/base/card-api';
import { StatusTagField } from '../crm/contact-status-tag';

export class Lecturer extends Member {
  static displayName = 'Lecturer';
  @field statusTag = contains(StatusTagField, {
    computeVia: function (this: Lecturer) {
      return new StatusTagField({
        label: 'Lecturer',
        lightColor: '#8bff98',
        darkColor: '#01d818',
      });
    },
  });
}
