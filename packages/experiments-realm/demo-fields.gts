import EmailField from 'https://cardstack.com/base/email';
import PercentageField from 'https://cardstack.com/base/percentage';
import WebsiteField from 'https://cardstack.com/base/website';
import RealmField from 'https://cardstack.com/base/realm';
import ColorField from 'https://cardstack.com/base/color';
import UrlField from 'https://cardstack.com/base/url';
import PhoneNumberField from 'https://cardstack.com/base/phone-number';
import AddressField from 'https://cardstack.com/base/address';
import CountryField from 'https://cardstack.com/base/country';
import DateRangeField from 'https://cardstack.com/base/date-range-field';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class DemoFields extends CardDef {
  static displayName = 'Demo Fields';
  @field email = contains(EmailField);
  @field address = contains(AddressField);
  @field phoneNo = contains(PhoneNumberField);
  @field url = contains(UrlField);
  @field color = contains(ColorField);
  @field realm = contains(RealmField);
  @field website = contains(WebsiteField);
  @field percentage = contains(PercentageField);
  @field country = contains(CountryField);
  @field dateRange = contains(DateRangeField);
}
