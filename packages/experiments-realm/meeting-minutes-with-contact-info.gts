import { MeetingMinutes } from './meeting-minutes';
import {
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import EmailField from '@cardstack/base/email';
import PhoneNumberField from '@cardstack/base/phone-number';
export class MeetingMinutesWithContactInfo extends MeetingMinutes {
  static displayName = 'Meeting Minutes';
  @field name = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(PhoneNumberField);
  @field company = contains(StringField);
}
