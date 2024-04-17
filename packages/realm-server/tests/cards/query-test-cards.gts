import {
  contains,
  field,
  linksTo,
  linksToMany,
  containsMany,
  FieldDef,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import DateField from 'https://cardstack.com/base/date';

export class Address extends FieldDef {
  @field street = contains(StringField);
  @field city = contains(StringField);
}

export class Person extends CardDef {
  @field name = contains(StringField);
  @field nickNames = containsMany(StringField);
  @field address = contains(Address);
  @field bestFriend = linksTo(() => Person);
  @field friends = linksToMany(() => Person);
}

export class FancyPerson extends Person {
  @field favoriteColor = contains(StringField);
}

export class Cat extends CardDef {
  @field name = contains(StringField);
}

export class SimpleCatalogEntry extends CardDef {
  @field title = contains(StringField);
  @field ref = contains(CodeRefField);
}

export class Event extends CardDef {
  @field title = contains(StringField);
  @field venue = contains(StringField);
  @field date = contains(DateField);
}
