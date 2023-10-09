import {
  contains,
  field,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export const exportedVar = 'exported var';

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _localVar = 'local var';

class _LocalClass {}

export class ExportedClass {}

export class ExportedClassInheritLocalClass extends _LocalClass {}

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _localFunction() {}

export function exportedFunction() {}

export { _LocalClass as AClassWithExportName };

class LocalCard extends CardDef {
  static displayName = 'local card';
}

export class ExportedCard extends CardDef {
  static displayName = 'exported card';
  @field someString = contains(StringCard);
}

export class ExportedCardInheritLocalCard extends LocalCard {
  static displayName = 'exported card extends local card';
}

class LocalField extends FieldDef {
  static displayName = 'local field';
}
export class ExportedField extends FieldDef {
  static displayName = 'exported field';
  @field someString = contains(StringCard);
}

export class ExportedFieldInheritLocalField extends LocalField {
  static displayName = 'exported field extends local field';
}

export default class DefaultClass {}
