import * as DateSerializer from './date.ts';
import * as DatetimeSerializer from './datetime.ts';
import * as BigIntegerSerializer from './big-integer.ts';
import * as BooleanSerializer from './boolean.ts';
import * as CodeRefSerializer from './code-ref.ts';
import * as AbsoluteCodeRefSerializer from './absolute-code-ref.ts';
import * as EthereumAddressSerializer from './ethereum-address.ts';
import * as NumberSerializer from './number.ts';
import * as EmailSerializer from './email.ts';
import * as ImageSizeSerializer from './image-size.ts';
import * as PhoneSerializer from './phone.ts';
import * as StringToContentSerializer from './string-to-content.ts';

import type { CardDocument, RealmResourceIdentifier } from '../index.ts';
import type {
  JSONAPISingleResourceDocument,
  SerializeOpts,
  BaseDef,
  BaseDefConstructor,
  BaseInstanceType,
  CardStore,
  DeserializeOpts,
} from 'https://cardstack.com/base/card-api';

export {
  DateSerializer,
  DatetimeSerializer,
  BigIntegerSerializer,
  BooleanSerializer,
  CodeRefSerializer,
  AbsoluteCodeRefSerializer,
  EthereumAddressSerializer,
  NumberSerializer,
  ImageSizeSerializer,
  EmailSerializer,
  PhoneSerializer,
  StringToContentSerializer,
};

interface Serializer {
  serialize(
    value: any,
    doc?: JSONAPISingleResourceDocument,
    visited?: Set<string>,
    opts?: SerializeOpts,
  ): any;
  deserialize<T extends BaseDefConstructor>(
    data: any,
    relativeTo: RealmResourceIdentifier | URL | undefined,
    doc?: CardDocument,
    store?: CardStore,
    opts?: DeserializeOpts,
  ): Promise<BaseInstanceType<T>>;
  queryableValue(value: any, stack?: BaseDef[]): any;
  formatQuery?(value: any): any;
}

const serializerMapping: { [name: string]: Serializer } = {
  date: DateSerializer,
  datetime: DatetimeSerializer,
  'big-integer': BigIntegerSerializer,
  boolean: BooleanSerializer,
  'code-ref': CodeRefSerializer,
  'absolute-code-ref': AbsoluteCodeRefSerializer,
  'ethereum-address': EthereumAddressSerializer,
  number: NumberSerializer,
  'image-size': ImageSizeSerializer,
  email: EmailSerializer,
  phone: PhoneSerializer,
  'string-to-content': StringToContentSerializer,
};

export type SerializerName =
  | 'date'
  | 'datetime'
  | 'big-integer'
  | 'boolean'
  | 'code-ref'
  | 'absolute-code-ref'
  | 'ethereum-address'
  | 'number'
  | 'image-size'
  | 'email'
  | 'phone'
  | 'string-to-content';

export function getSerializer(name: SerializerName): Serializer {
  assertIsSerializerName(name);
  return serializerMapping[name];
}

export function assertIsSerializerName(
  name: any,
): asserts name is SerializerName {
  if (
    typeof name !== 'string' ||
    !Object.keys(serializerMapping).includes(name)
  ) {
    throw new Error(`the name '${name}' is not a valid serializer name`);
  }
}
