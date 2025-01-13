import { FieldDef } from 'https://cardstack.com/base/card-api';
import { contains, field } from 'https://cardstack.com/base/card-api';
import { StringField } from 'https://cardstack.com/base/card-api';
import { PhoneField } from '../../phone-number';
import DatetimeField from 'https://cardstack.com/base/datetime';

export class Call extends FieldDef {
  static displayName = 'Call Activity';
  @field phoneNumber = contains(PhoneField);
  @field callTime = contains(DatetimeField);
  @field callDuration = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: Call) {
      const phoneStr =
        `${this.phoneNumber.countryCode}-${this.phoneNumber.number}` ?? '';
      const timeStr = this.callTime?.toLocaleString() ?? '';
      const durationStr = this.callDuration ?? '';
      return `${phoneStr} - ${timeStr} - ${durationStr}`;
    },
  });
}
