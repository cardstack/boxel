import {
  CardDef,
  FieldDef,
  BaseDef as BDef,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import NumberCard from 'https://cardstack.com/base/number';

export const exportedVar = 'exported var';

export { StringCard as StrCard };

export { FieldDef as FDef, CardDef, contains, BDef };

export * from './in-this-file';

export default NumberCard;
