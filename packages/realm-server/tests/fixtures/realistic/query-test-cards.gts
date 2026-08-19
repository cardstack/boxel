import {
  contains,
  field,
  linksTo,
  linksToMany,
  containsMany,
  FieldDef,
  CardDef,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import CodeRefField from '@cardstack/base/code-ref';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';

export class Address extends FieldDef {
  @field street = contains(StringField);
  @field city = contains(StringField);
  @field number = contains(NumberField);
}

export class Person extends CardDef {
  @field name = contains(StringField);
  @field nickNames = containsMany(StringField);
  @field address = contains(Address);
  @field bestFriend = linksTo(() => Person);
  @field friends = linksToMany(() => Person);
  @field age = contains(NumberField);
  @field isHairy = contains(BooleanField);
  @field lotteryNumbers = containsMany(NumberField);
}

export class FancyPerson extends Person {
  @field favoriteColor = contains(StringField);
}

export class Cat extends CardDef {
  @field name = contains(StringField);
}

export class SimpleSpec extends CardDef {
  @field cardTitle = contains(StringField);
  @field ref = contains(CodeRefField);
}

export class Event extends CardDef {
  @field cardTitle = contains(StringField);
  @field venue = contains(StringField);
  @field date = contains(DateField);
}
