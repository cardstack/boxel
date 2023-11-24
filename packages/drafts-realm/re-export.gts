import {
  CardDef,
  FieldDef,
  BaseDef as BDef,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export const exportedVar = 'exported var';

export { StringCard as StrCard };

export { FieldDef as FDef, CardDef, contains, BDef };

export * from './in-this-file';
