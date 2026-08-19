import {
  contains,
  field,
  linksToMany,
  StringField,
} from '@cardstack/base/card-api';
import Tag from '@cardstack/base/tag';
import BriefcaseIcon from '@cardstack/boxel-icons/briefcase';

import { Contact } from '../contact';

/**
 * A bench freelancer IS a Contact — the specialization is what they are good
 * at and what they cost. Contact's `role` and `account` are CRM-shaped and stay
 * empty here, which is the App 4 finding repeating on a second consumer.
 */
export class Freelancer extends Contact {
  static displayName = 'Freelancer';
  static icon = BriefcaseIcon;

  @field specialties = linksToMany(Tag);
  @field rateNote = contains(StringField);
}

export default Freelancer;
