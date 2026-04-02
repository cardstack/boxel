import { getService } from '@universal-ember/test-support';

import { baseRealm } from '@cardstack/runtime-common';

import type * as Base64ImageFieldModule from '@cardstack/base/base64-image';
import type * as BigIntegerModule from '@cardstack/base/big-integer';
import type * as BooleanFieldModule from '@cardstack/base/boolean';
import type * as CardAPIModule from '@cardstack/base/card-api';
import type * as CardsGridModule from '@cardstack/base/cards-grid';
import type * as CodeRefModule from '@cardstack/base/code-ref';
import type * as DateFieldModule from '@cardstack/base/date';
import type * as DateTimeFieldModule from '@cardstack/base/datetime';
import type * as EmailFieldModule from '@cardstack/base/email';
import type * as EnumModule from '@cardstack/base/enum';
import type * as EthereumAddressModule from '@cardstack/base/ethereum-address';
import type * as FileApiModule from '@cardstack/base/file-api';
import type * as MarkdownFieldModule from '@cardstack/base/markdown';
import type * as NumberFieldModule from '@cardstack/base/number';
import type * as PhoneNumberFieldModule from '@cardstack/base/phone-number';
import type * as RealmFieldModule from '@cardstack/base/realm';
import type * as SkillModule from '@cardstack/base/skill';
import type * as StringFieldModule from '@cardstack/base/string';
import type * as SystemCardModule from '@cardstack/base/system-card';
import type * as TextAreaFieldModule from '@cardstack/base/text-area';

type StringField = (typeof StringFieldModule)['default'];
let StringField: StringField;

type NumberField = (typeof NumberFieldModule)['default'];
let NumberField: NumberField;

type DateField = (typeof DateFieldModule)['default'];
let DateField: DateField;

type DateTimeField = (typeof DateTimeFieldModule)['default'];
let DateTimeField: DateTimeField;

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

type CommandField = (typeof SkillModule)['CommandField'];
let CommandField: CommandField;

type ModelConfiguration = (typeof SystemCardModule)['ModelConfiguration'];
let ModelConfiguration: ModelConfiguration;

type SystemCard = (typeof SystemCardModule)['SystemCard'];
let SystemCard: SystemCard;

type FileDef = (typeof FileApiModule)['FileDef'];
let FileDef: FileDef;

let cardAPI: typeof CardAPIModule;
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
let createFromSerialized: (typeof CardAPIModule)['createFromSerialized'];
let updateFromSerialized: (typeof CardAPIModule)['updateFromSerialized'];
let serializeCard: (typeof CardAPIModule)['serializeCard'];
let serializeFileDef: (typeof CardAPIModule)['serializeFileDef'];
let isSaved: (typeof CardAPIModule)['isSaved'];
let relationshipMeta: (typeof CardAPIModule)['relationshipMeta'];
let getQueryableValue: (typeof CardAPIModule)['getQueryableValue'];
let subscribeToChanges: (typeof CardAPIModule)['subscribeToChanges'];
let unsubscribeFromChanges: (typeof CardAPIModule)['unsubscribeFromChanges'];
let flushLogs: (typeof CardAPIModule)['flushLogs'];
let queryableValue: (typeof CardAPIModule)['queryableValue'];
let getFields: (typeof CardAPIModule)['getFields'];
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

  DateTimeField = (
    await loader.import<typeof DateTimeFieldModule>(`${baseRealm.url}datetime`)
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

  CommandField = (
    await loader.import<typeof SkillModule>(`${baseRealm.url}skill`)
  ).CommandField;

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

  FileDef = (
    await loader.import<typeof FileApiModule>(`${baseRealm.url}file-api`)
  ).FileDef;

  cardAPI = await loader.import<typeof CardAPIModule>(
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
    getFields,
    createFromSerialized,
    updateFromSerialized,
    serializeCard,
    serializeFileDef,
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
  cardAPI,
  StringField,
  NumberField,
  DateField,
  DateTimeField,
  EmailField,
  Base64ImageField,
  CodeRefField,
  CommandField,
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
  FileDef,
  field,
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  isCard,
  linksTo,
  linksToMany,
  MaybeBase64Field,
  createFromSerialized,
  updateFromSerialized,
  serializeCard,
  serializeFileDef,
  isSaved,
  relationshipMeta,
  getQueryableValue,
  subscribeToChanges,
  unsubscribeFromChanges,
  flushLogs,
  queryableValue,
  getFields,
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
