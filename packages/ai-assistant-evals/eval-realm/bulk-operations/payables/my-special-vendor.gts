import { contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { Vendor } from './vendor.gts';

export class MySpecialVendor extends Vendor {
  static displayName = 'My Special Vendor';
  @field accountManager = contains(StringField);
}
