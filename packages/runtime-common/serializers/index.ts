import * as DateSerializer from './date';
import * as DatetimeSerializer from './datetime';
import * as BigIntegerSerializer from './big-integer';
import * as BooleanSerializer from './boolean';
import * as CodeRefSerializer from './code-ref';
import * as AbsoluteCodeRefSerializer from './absolute-code-ref';
import * as EthereumAddressSerializer from './ethereum-address';
import * as NumberSerializer from './number';
import * as EmailSerializer from './email';
import * as ImageSizeSerializer from './image-size';
import * as PhoneSerializer from './phone';
import * as StringToContentSerializer from './string-to-content';

import type { CardDocument, RealmResourceIdentifier } from '../index';
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
