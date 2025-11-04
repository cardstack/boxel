import { getService } from '@universal-ember/test-support';

import { baseRealm } from '@cardstack/runtime-common';

import type * as Base64ImageFieldModule from 'https://cardstack.com/base/base64-image';
import type * as BigIntegerModule from 'https://cardstack.com/base/big-integer';
import type * as BooleanFieldModule from 'https://cardstack.com/base/boolean';
import type * as CardAPIModule from 'https://cardstack.com/base/card-api';
import type * as CardsGridModule from 'https://cardstack.com/base/cards-grid';
import type * as CodeRefModule from 'https://cardstack.com/base/code-ref';
import type * as DateFieldModule from 'https://cardstack.com/base/date';
import type * as DatetimeFieldModule from 'https://cardstack.com/base/datetime';
import type * as EmailFieldModule from 'https://cardstack.com/base/email';
import type * as EnumModule from 'https://cardstack.com/base/enum';
import type * as EthereumAddressModule from 'https://cardstack.com/base/ethereum-address';
import type * as MarkdownFieldModule from 'https://cardstack.com/base/markdown';
import type * as NumberFieldModule from 'https://cardstack.com/base/number';
import type * as PhoneNumberFieldModule from 'https://cardstack.com/base/phone-number';
import type * as RealmFieldModule from 'https://cardstack.com/base/realm';
import type * as SkillModule from 'https://cardstack.com/base/skill';
import type * as StringFieldModule from 'https://cardstack.com/base/string';
import type * as SystemCardModule from 'https://cardstack.com/base/system-card';
import type * as TextAreaFieldModule from 'https://cardstack.com/base/text-area';

type StringField = (typeof StringFieldModule)['default'];
let StringField: StringField;

type NumberField = (typeof NumberFieldModule)['default'];
let NumberField: NumberField;

type DateField = (typeof DateFieldModule)['default'];
let DateField: DateField;

type DatetimeField = (typeof DatetimeFieldModule)['default'];
let DatetimeField: DatetimeField;

type EmailField = (typeof EmailFieldModule)['default'];
let EmailField: EmailField;

type Base64ImageField = (typeof Base64ImageFieldModule)['default'];
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

type RealmField = (typeof RealmFieldModule)['default'];
let RealmField: RealmField;

type PhoneNumberField = (typeof PhoneNumberFieldModule)['default'];
let PhoneNumberField: PhoneNumberField;

type CardsGrid = (typeof CardsGridModule)['CardsGrid'];
let CardsGrid: CardsGrid;

type Skill = (typeof SkillModule)['Skill'];
let Skill: Skill;

type ModelConfiguration = (typeof SystemCardModule)['ModelConfiguration'];
let ModelConfiguration: ModelConfiguration;

type SystemCard = (typeof SystemCardModule)['SystemCard'];
let SystemCard: SystemCard;

let field: (typeof CardAPIModule)['field'];
let CardDef: (typeof CardAPIModule)['CardDef'];
let Component: (typeof CardAPIModule)['Component'];
let FieldDef: (typeof CardAPIModule)['FieldDef'];
let contains: (typeof CardAPIModule)['contains'];
let containsMany: (typeof CardAPIModule)['containsMany'];
let isCard: (typeof CardAPIModule)['isCard'];
let linksTo: (typeof CardAPIModule)['linksTo'];
let linksToMany: (typeof CardAPIModule)['linksToMany'];
let MaybeBase64Field: (typeof CardAPIModule)['MaybeBase64Field'];
let ensureLinksLoaded: (typeof CardAPIModule)['ensureLinksLoaded'];
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
let instanceOf: (typeof CardAPIModule)['instanceOf'];
let CardInfoField: (typeof CardAPIModule)['CardInfoField'];
let enumField: (typeof EnumModule)['default'];
let enumOptions: (typeof EnumModule)['enumOptions'];
let enumValues: (typeof EnumModule)['enumValues'];
let enumConfig: (typeof EnumModule)['enumConfig'];

async function initialize() {
  let loader = getService('loader-service').loader;

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

  EmailField = (
    await loader.import<typeof EmailFieldModule>(`${baseRealm.url}email`)
  ).default;

  Base64ImageField = (
    await loader.import<typeof Base64ImageFieldModule>(
      `${baseRealm.url}base64-image`,
    )
  ).default;

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

  RealmField = (
    await loader.import<typeof RealmFieldModule>(`${baseRealm.url}realm`)
  ).default;

  PhoneNumberField = (
    await loader.import<typeof PhoneNumberFieldModule>(
      `${baseRealm.url}phone-number`,
    )
  ).default;

  CardsGrid = (
    await loader.import<typeof CardsGridModule>(`${baseRealm.url}cards-grid`)
  ).CardsGrid;

  Skill = (await loader.import<typeof SkillModule>(`${baseRealm.url}skill`))
    .Skill;

  ModelConfiguration = (
    await loader.import<typeof SystemCardModule>(`${baseRealm.url}system-card`)
  ).ModelConfiguration;

  SystemCard = (
    await loader.import<typeof SystemCardModule>(`${baseRealm.url}system-card`)
  ).SystemCard;

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
    isCard,
    linksTo,
    linksToMany,
    ensureLinksLoaded,
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
    instanceOf,
    CardInfoField,
  } = cardAPI);

  enumField = (await loader.import<typeof EnumModule>(`${baseRealm.url}enum`))
    .default;
  const enumModule = await loader.import<typeof EnumModule>(
    `${baseRealm.url}enum`,
  );
  enumOptions = enumModule.enumOptions;
  enumValues = enumModule.enumValues;
  enumConfig = enumModule.enumConfig;
}

export async function setupBaseRealm(hooks: NestedHooks) {
  hooks.beforeEach(initialize);
}

export {
  StringField,
  NumberField,
  DateField,
  DatetimeField,
  EmailField,
  Base64ImageField,
  CodeRefField,
  BigIntegerField,
  EthereumAddressField,
  BooleanField,
  MarkdownField,
  TextAreaField,
  RealmField,
  PhoneNumberField,
  CardsGrid,
  SystemCard,
  ModelConfiguration,
  field,
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  isCard,
  linksTo,
  linksToMany,
  ensureLinksLoaded,
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
  Skill,
  instanceOf,
  CardInfoField,
  enumField,
  enumOptions,
  enumValues,
  enumConfig,
};
