import { LeadForm } from '../sale/lead';
import { CrmAccount } from '../account';

import { Opportunity } from 'crm/sale/opportunity';
import {
  CardDef,
  FieldDef,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import { LabelledPhoneNumeber } from '../sale/contact';

class TypeOfActivity extends FieldDef {
  statuses = [
    { code: 1, displayName: 'email' },
    { code: 2, displayName: 'phone' },
    { code: 3, displayName: 'meeting' },
  ];
  static displayName = 'TypeOfActivity';
}
class Task extends CardDef {}

class ActivityStatus extends FieldDef {
  static displayName = 'ActivityStatus';
  statuses = [
    { code: 1, displayName: 'pending' },
    { code: 2, displayName: 'complete' },
  ];
}

export class Activity extends CardDef {
  static displayName = 'Activity';
  @field info = contains(TextAreaCard);
  @field lead = linksTo(LeadForm, {
    description: `Country`,
  });
  @field opportunity = linksTo(Opportunity, {
    description: `Opportunity`,
  });
  @field account = linksTo(CrmAccount, {
    description: `Account`,
  });
  @field task = linksTo(Task, {
    description: `Account`,
  });
  @field type = contains(TypeOfActivity);
  @field status = contains(ActivityStatus);
}

// inheritance needs to change Activity based upon the type to PhoneActivity
//ie picklist will change the form
export class PhoneActivity extends CardDef {
  static displayName = 'Activity';
  @field phoneNumber = contains(LabelledPhoneNumeber);
}

class Location extends FieldDef {}

class Url extends FieldDef {}

export class MeetingAcitivty extends CardDef {
  static displayName = 'Activity';
  @field location = contains(Location);
  @field meetingLink = contains(Url);
}
