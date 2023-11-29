import {
  contains,
  field,
  Component,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { Person } from './person';

class GrandParent extends CardDef {
  static displayName = 'local grandparent';
}

class Parent extends GrandParent {
  static displayName = 'local parent';
}

class Activity extends FieldDef {}
class Hobby extends Activity {}
class Sport extends Hobby {}

export class Child extends Parent {
  static displayName = 'exported child';
  @field sport = contains(Sport);
}
