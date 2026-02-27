import EmailField from '@cardstack/base/email';
import PercentageField from '@cardstack/base/percentage';
import WebsiteField from '@cardstack/base/website';
import RealmField from '@cardstack/base/realm';
import ColorField from '@cardstack/base/color';
import UrlField from '@cardstack/base/url';
import PhoneNumberField from '@cardstack/base/phone-number';
import AddressField from '@cardstack/base/address';
import CountryField from '@cardstack/base/country';
import DateRangeField from '@cardstack/base/date-range-field';
import { CardDef, field, contains } from '@cardstack/base/card-api';

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
