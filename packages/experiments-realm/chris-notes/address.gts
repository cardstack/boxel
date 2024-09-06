// base address

import {
  CardDef,
  FieldDef,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import TextAreaCard from 'https://cardstack.com/base/text-area';

// google address
// types address and auto-completes

// shipping address

export class TestAddress extends FieldDef {
  @field address = contains(TextAreaCard);
}

export class SpecificTestAddress extends TestAddress {
  @field country = contains(StringField);
  @field postcode = contains(StringField);
  @field address = contains(TextAreaCard, {
    computeVia: function (this: SpecificTestAddress) {
      return this.country + ' ' + this.postcode;
    },
  });
}

export class TestContact extends CardDef {
  @field address = contains(TestAddress); //SpecifictestAddress serializeation json @field correctly
}

//We need meta syntax/api inside the json doc to render the based upon different subclasses field type
