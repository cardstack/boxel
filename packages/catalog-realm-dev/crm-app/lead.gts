import { field, contains } from 'https://cardstack.com/base/card-api';
import { Contact } from './contact';
import { StatusTagField } from './contact-status-tag';

import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';

export class Lead extends Contact {
  static displayName = 'Lead';
  static icon = TargetArrowIcon;
  @field statusTag = contains(StatusTagField, {
    computeVia: function (this: Lead) {
      return new StatusTagField({
        label: 'Lead',
        lightColor: '#E6F4FF',
        darkColor: '#0090FF',
      });
    },
  });
}
