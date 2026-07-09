import {
  CardDef,
  FieldDef,
  BaseDef as BDef,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';

export const exportedVar = 'exported var';

export { StringField as StrCard };

export { FieldDef as FDef, CardDef, contains, BDef };

export * from './in-this-file'; //Will not display inside "in-this-file"

export default NumberField;

export { Person as Human } from './person';

export { default as Date } from '@cardstack/base/date';
