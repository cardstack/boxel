import { FieldDef } from 'https://cardstack.com/base/card-api';
import { contains, field } from 'https://cardstack.com/base/card-api';
import { Address as AddressField } from '../../address';
import { StringField } from 'https://cardstack.com/base/card-api';
import DatetimeField from 'https://cardstack.com/base/datetime';

export class Meeting extends FieldDef {
  static displayName = 'Meeting Activity';
  @field location = contains(AddressField);
  @field startTime = contains(DatetimeField);
  @field endTime = contains(DatetimeField);

  @field title = contains(StringField, {
    computeVia: function (this: Meeting) {
      const startTimeStr = this.startTime?.toLocaleString() ?? '';
      const endTimeStr = this.endTime?.toLocaleString() ?? '';
      return `${startTimeStr} to ${endTimeStr}`;
    },
  });
}
