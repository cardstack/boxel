import { type TestContext, getContext } from '@ember/test-helpers';

import { baseRealm } from '@cardstack/runtime-common';

import type LoaderService from '@cardstack/host/services/loader-service';

import type * as Base64ImageFieldModule from 'https://cardstack.com/base/base64-image';
import type * as BigIntegerModule from 'https://cardstack.com/base/big-integer';
import type * as BooleanFieldModule from 'https://cardstack.com/base/boolean';
import type * as CardAPIModule from 'https://cardstack.com/base/card-api';
import type * as CodeRefModule from 'https://cardstack.com/base/code-ref';
import type * as DateFieldModule from 'https://cardstack.com/base/date';
import type * as DatetimeFieldModule from 'https://cardstack.com/base/datetime';
import type * as EthereumAddressModule from 'https://cardstack.com/base/ethereum-address';
import type * as MarkdownFieldModule from 'https://cardstack.com/base/markdown';
import type * as NumberFieldModule from 'https://cardstack.com/base/number';
import type * as StringFieldModule from 'https://cardstack.com/base/string';
import type * as TextAreaFieldModule from 'https://cardstack.com/base/text-area';

type StringField = (typeof StringFieldModule)['default'];
let StringField: StringField;

type NumberField = (typeof NumberFieldModule)['default'];
let NumberField: NumberField;

type DateField = (typeof DateFieldModule)['default'];
let DateField: DateField;

type DatetimeField = (typeof DatetimeFieldModule)['default'];
let DatetimeField: DatetimeField;

type Base64ImageField = (typeof Base64ImageFieldModule)['Base64ImageField'];
let Base64ImageField: Base64ImageField;

type CodeRefField = (typeof CodeRefModule)['default'];
let CodeRefField: CodeRefField;

type BigIntegerField = (typeof BigIntegerModule)['default'];
let BigIntegerField: BigIntegerField;

type EthereumAddressField = (typeof EthereumAddressModule)['default'];
let EthereumAddressField: EthereumAddressField;

type BooleanField = (typeof BooleanFieldModule)['default'];
let BooleanField: BooleanField;

type MarkdownField = (typeof MarkdownFieldModule)['default'];
let MarkdownField: MarkdownField;

type TextAreaField = (typeof TextAreaFieldModule)['default'];
let TextAreaField: TextAreaField;

let field: (typeof CardAPIModule)['field'];
let CardDef: (typeof CardAPIModule)['CardDef'];
let Component: (typeof CardAPIModule)['Component'];
let FieldDef: (typeof CardAPIModule)['FieldDef'];
let contains: (typeof CardAPIModule)['contains'];
let containsMany: (typeof CardAPIModule)['containsMany'];
let linksTo: (typeof CardAPIModule)['linksTo'];
let linksToMany: (typeof CardAPIModule)['linksToMany'];
let MaybeBase64Field: (typeof CardAPIModule)['MaybeBase64Field'];
let recompute: (typeof CardAPIModule)['recompute'];
let createFromSerialized: (typeof CardAPIModule)['createFromSerialized'];
let updateFromSerialized: (typeof CardAPIModule)['updateFromSerialized'];
let serializeCard: (typeof CardAPIModule)['serializeCard'];
let isSaved: (typeof CardAPIModule)['isSaved'];
let relationshipMeta: (typeof CardAPIModule)['relationshipMeta'];
let getQueryableValue: (typeof CardAPIModule)['getQueryableValue'];
let subscribeToChanges: (typeof CardAPIModule)['subscribeToChanges'];
let unsubscribeFromChanges: (typeof CardAPIModule)['unsubscribeFromChanges'];
let flushLogs: (typeof CardAPIModule)['flushLogs'];
let queryableValue: (typeof CardAPIModule)['queryableValue'];
let getFieldDescription: (typeof CardAPIModule)['getFieldDescription'];
let ReadOnlyField: (typeof CardAPIModule)['ReadOnlyField'];

async function initialize() {
  let owner = (getContext() as TestContext).owner;
  let loader = (owner.lookup('service:loader-service') as LoaderService).loader;

  StringField = (
    await loader.import<typeof StringFieldModule>(`${baseRealm.url}string`)
  ).default;

  NumberField = (
    await loader.import<typeof NumberFieldModule>(`${baseRealm.url}number`)
  ).default;

  DateField = (
    await loader.import<typeof DateFieldModule>(`${baseRealm.url}date`)
  ).default;

  DatetimeField = (
    await loader.import<typeof DatetimeFieldModule>(`${baseRealm.url}datetime`)
  ).default;

  Base64ImageField = (
    await loader.import<typeof Base64ImageFieldModule>(
      `${baseRealm.url}base64-image`,
    )
  ).Base64ImageField;

  CodeRefField = (
    await loader.import<typeof CodeRefModule>(`${baseRealm.url}code-ref`)
  ).default;

  BigIntegerField = (
    await loader.import<typeof BigIntegerModule>(`${baseRealm.url}big-integer`)
  ).default;

  EthereumAddressField = (
    await loader.import<typeof EthereumAddressModule>(
      `${baseRealm.url}ethereum-address`,
    )
  ).default;

  BooleanField = (
    await loader.import<typeof BooleanFieldModule>(`${baseRealm.url}boolean`)
  ).default;

  MarkdownField = (
    await loader.import<typeof MarkdownFieldModule>(`${baseRealm.url}markdown`)
  ).default;

  TextAreaField = (
    await loader.import<typeof TextAreaFieldModule>(`${baseRealm.url}text-area`)
  ).default;

  let cardAPI = await loader.import<typeof CardAPIModule>(
    `${baseRealm.url}card-api`,
  );

  ({
    field,
    CardDef,
    Component,
    FieldDef,
    contains,
    containsMany,
    linksTo,
    linksToMany,
    recompute,
    createFromSerialized,
    updateFromSerialized,
    serializeCard,
    isSaved,
    relationshipMeta,
    getQueryableValue,
    subscribeToChanges,
    unsubscribeFromChanges,
    flushLogs,
    queryableValue,
    MaybeBase64Field,
    getFieldDescription,
    ReadOnlyField,
  } = cardAPI);
}

export async function setupBaseRealm(hooks: NestedHooks) {
  hooks.beforeEach(initialize);
}

export {
  StringField,
  NumberField,
  DateField,
  DatetimeField,
  Base64ImageField,
  CodeRefField,
  BigIntegerField,
  EthereumAddressField,
  BooleanField,
  MarkdownField,
  TextAreaField,
  field,
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  recompute,
  MaybeBase64Field,
  createFromSerialized,
  updateFromSerialized,
  serializeCard,
  isSaved,
  relationshipMeta,
  getQueryableValue,
  subscribeToChanges,
  unsubscribeFromChanges,
  flushLogs,
  queryableValue,
  getFieldDescription,
  ReadOnlyField,
};
