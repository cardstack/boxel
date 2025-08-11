import { MeetingMinutes } from './meeting-minutes';
import {
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import EmailField from 'https://cardstack.com/base/email';
import PhoneNumberField from 'https://cardstack.com/base/phone-number';
export class MeetingMinutesWithContactInfo extends MeetingMinutes {
  static displayName = 'Meeting Minutes';
  @field name = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(PhoneNumberField);
  @field company = contains(StringField);
}
