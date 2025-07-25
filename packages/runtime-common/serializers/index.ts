import * as DateSerializer from './date';
import * as DatetimeSerializer from './datetime';
import * as BigIntegerSerializer from './big-integer';
import * as BooleanSerializer from './boolean';
import * as CodeRefSerializer from './code-ref';
import * as EthereumAddressSerializer from './ethereum-address';
import * as NumberSerializer from './number';
import * as ImageSizeSerializer from './image-size';

import { type CardDocument } from '../index';
import {
  type JSONAPISingleResourceDocument,
  type SerializeOpts,
  type BaseDef,
  type BaseDefConstructor,
  type BaseInstanceType,
  type IdentityContext,
  type DeserializeOpts,
} from 'https://cardstack.com/base/card-api';

export {
  DateSerializer,
  DatetimeSerializer,
  BigIntegerSerializer,
  BooleanSerializer,
  CodeRefSerializer,
  EthereumAddressSerializer,
  NumberSerializer,
  ImageSizeSerializer,
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
    relativeTo: URL | undefined,
    doc?: CardDocument,
    identityContext?: IdentityContext,
    opts?: DeserializeOpts,
  ): Promise<BaseInstanceType<T>>;
  queryableValue(value: any, stack: BaseDef[]): any;
  formatQuery?(value: any): any;
}

const serializerMapping: { [name: string]: Serializer } = {
  date: DateSerializer,
  datetime: DatetimeSerializer,
  'big-integer': BigIntegerSerializer,
  boolean: BooleanSerializer,
  'code-ref': CodeRefSerializer,
  'ethereum-address': EthereumAddressSerializer,
  number: NumberSerializer,
  'image-size': ImageSizeSerializer,
};

type SerializerName =
  | 'date'
  | 'datetime'
  | 'big-integer'
  | 'boolean'
  | 'code-ref'
  | 'ethereum-address'
  | 'number'
  | 'image-size';

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
