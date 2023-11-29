import {
  contains,
  field,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';

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
