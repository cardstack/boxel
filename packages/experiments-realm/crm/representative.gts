import { field, contains } from 'https://cardstack.com/base/card-api';
import { Contact } from './contact';
import PresentationAnalytics from '@cardstack/boxel-icons/presentation-analytics';
import { StatusTagField } from './contact';

export class Representative extends Contact {
  static displayName = 'CRM Representative';
  static icon = PresentationAnalytics;
  @field statusTag = contains(StatusTagField, {
    computeVia: function (this: Representative) {
      return new StatusTagField({
        index: 2,
        label: 'Representative',
        lightColor: '#7FDBDA',
        darkColor: '#07BABA',
      });
    },
  });
}
