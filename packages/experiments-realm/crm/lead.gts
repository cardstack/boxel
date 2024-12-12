import {
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Contact } from './contact';

import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';

export class Lead extends Contact {
  static displayName = 'CRM Lead';
  @field _computeStatusTag = contains(StringField, {
    computeVia: function (this: Lead) {
      this.statusTag = {
        index: 1,
        label: 'Lead',
        icon: TargetArrowIcon,
        lightColor: '#E6F4FF',
        darkColor: '#0090FF',
      };
    },
  });
}
