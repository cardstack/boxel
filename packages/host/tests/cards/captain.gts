import {
  contains,
  field,
  CardDef,
  StringField,
} from 'https://cardstack.com/base/card-api';

export class Boat extends CardDef {
  @field name = contains(StringField);
}

export class Captain extends CardDef {
  @field firstName = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Captain) {
      return this.firstName;
    },
  });

  createEponymousBoat() {
    return new Boat({ name: this.firstName });
  }
}
