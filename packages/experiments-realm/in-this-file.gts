import {
  contains,
  field,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export const exportedVar = 'exported var';

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const localVar = 'local var';

class LocalClass {}

export class ExportedClass {}

export class ExportedClassInheritLocalClass extends LocalClass {}

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function localFunction() {}

export function exportedFunction() {}

export { LocalClass as AClassWithExportName };

class LocalCard extends CardDef {
  static displayName = 'local card';
}

export class ExportedCard extends CardDef {
  static displayName = 'exported card';
  @field someString = contains(StringField);
}

export class ExportedCardInheritLocalCard extends LocalCard {
  static displayName = 'exported card extends local card';
}

class LocalField extends FieldDef {
  static displayName = 'local field';
}
export class ExportedField extends FieldDef {
  static displayName = 'exported field';
  @field someString = contains(StringField);
}

export class ExportedFieldInheritLocalField extends LocalField {
  static displayName = 'exported field extends local field';
}

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class LocalCardWithoutExportRelationship extends CardDef {
  static displayName = 'local card but without export relationship';
}

export default class DefaultClass {}
