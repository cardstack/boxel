import { contains, field } from 'https://cardstack.com/base/card-api';
import CardDef from 'https://cardstack.com/base/card-def';
import FieldDef from 'https://cardstack.com/base/field-def';

class GrandParent extends CardDef {
  static displayName = 'local grandparent';
}

class Parent extends GrandParent {
  static displayName = 'local parent';
}

class Activity extends FieldDef {
  static displayName = 'my activity';
}
class Hobby extends Activity {
  static displayName = 'my hobby';
}
class Sport extends Hobby {
  static displayName = 'my sport';
}

export class Child extends Parent {
  static displayName = 'exported child';
  @field sport = contains(Sport);
}
