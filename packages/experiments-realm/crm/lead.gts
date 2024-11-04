import { contains, field, FieldDef } from 'https://cardstack.com/base/card-api';

import { Contact } from './contact';
// import { OptionList } from 'https://cardstack.com/base/select-list';

export class HotnessField extends FieldDef {
  static displayName = 'Crm Lead';
  // @field hotness = contains(OptionList);
}

export class Lead extends Contact {
  static displayName = 'Crm Lead';
  @field hotness = contains(HotnessField);
}
