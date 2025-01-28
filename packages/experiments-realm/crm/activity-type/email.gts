import { FieldDef } from 'https://cardstack.com/base/card-api';
import { contains, field } from 'https://cardstack.com/base/card-api';
import { StringField } from 'https://cardstack.com/base/card-api';
import { EmailField } from '../../email';
import DatetimeField from 'https://cardstack.com/base/datetime';

export class Email extends FieldDef {
  static displayName = 'Email Activity';
  @field emailAddress = contains(EmailField);
  @field emailContent = contains(StringField);
  @field sentTime = contains(DatetimeField);

  @field title = contains(StringField, {
    computeVia: function (this: Email) {
      const emailStr = this.emailAddress?.toString() ?? '';
      const timeStr = this.sentTime?.toLocaleString() ?? '';
      return `${emailStr} - ${timeStr}`;
    },
  });
}
