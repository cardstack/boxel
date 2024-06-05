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

let _string: (typeof StringFieldModule)['default'];
let _number: (typeof NumberFieldModule)['default'];
let _date: (typeof DateFieldModule)['default'];
let _datetime: (typeof DatetimeFieldModule)['default'];
let _base64Image: (typeof Base64ImageFieldModule)['Base64ImageField'];
let _codeRef: (typeof CodeRefModule)['default'];
let _bigInteger: (typeof BigIntegerModule)['default'];
let _ethereumAddress: (typeof EthereumAddressModule)['default'];
let _boolean: (typeof BooleanFieldModule)['default'];
let _markdown: (typeof MarkdownFieldModule)['default'];
let _textarea: (typeof TextAreaFieldModule)['default'];

let field: (typeof CardAPIModule)['field'];
let CardDef: (typeof CardAPIModule)['CardDef'];
let Component: (typeof CardAPIModule)['Component'];
let FieldDef: (typeof CardAPIModule)['FieldDef'];
let contains: (typeof CardAPIModule)['contains'];
let containsMany: (typeof CardAPIModule)['containsMany'];
let linksTo: (typeof CardAPIModule)['linksTo'];
let linksToMany: (typeof CardAPIModule)['linksToMany'];
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

async function initialize() {
  let owner = (getContext() as TestContext).owner;
  let loader = (owner.lookup('service:loader-service') as LoaderService).loader;

  _string = (
    await loader.import<typeof StringFieldModule>(`${baseRealm.url}string`)
  ).default;

  _number = (
    await loader.import<typeof NumberFieldModule>(`${baseRealm.url}number`)
  ).default;

  _date = (await loader.import<typeof DateFieldModule>(`${baseRealm.url}date`))
    .default;

  _datetime = (
    await loader.import<typeof DatetimeFieldModule>(`${baseRealm.url}datetime`)
  ).default;

  _base64Image = (
    await loader.import<typeof Base64ImageFieldModule>(
      `${baseRealm.url}base64-image`,
    )
  ).Base64ImageField;

  _codeRef = (
    await loader.import<typeof CodeRefModule>(`${baseRealm.url}code-ref`)
  ).default;

  _bigInteger = (
    await loader.import<typeof BigIntegerModule>(`${baseRealm.url}big-integer`)
  ).default;

  _ethereumAddress = (
    await loader.import<typeof EthereumAddressModule>(
      `${baseRealm.url}ethereum-address`,
    )
  ).default;

  _boolean = (
    await loader.import<typeof BooleanFieldModule>(`${baseRealm.url}boolean`)
  ).default;

  _markdown = (
    await loader.import<typeof MarkdownFieldModule>(`${baseRealm.url}markdown`)
  ).default;

  _textarea = (
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
    getFieldDescription,
  } = cardAPI);
}

export async function setupBaseRealm(hooks: NestedHooks) {
  hooks.beforeEach(initialize);
}

export {
  _string as StringField,
  _number as NumberField,
  _date as DateField,
  _datetime as DatetimeField,
  _base64Image as Base64ImageField,
  _codeRef as CodeRefField,
  _bigInteger as BigIntegerField,
  _ethereumAddress as EthereumAddressField,
  _boolean as BooleanField,
  _markdown as MarkdownField,
  _textarea as TextAreaField,
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
  getFieldDescription,
};
