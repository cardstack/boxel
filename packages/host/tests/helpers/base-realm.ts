import { getService } from '@universal-ember/test-support';

import { baseRealm } from '@cardstack/runtime-common';

import type * as Base64ImageFieldModule from 'https://cardstack.com/base/base64-image';
import type * as BigIntegerModule from 'https://cardstack.com/base/big-integer';
import type * as BooleanFieldModule from 'https://cardstack.com/base/boolean';
import type * as CardAPIModule from 'https://cardstack.com/base/card-api';
import type * as CardsGridModule from 'https://cardstack.com/base/cards-grid';
import type * as CodeRefModule from 'https://cardstack.com/base/code-ref';
import type * as ColorFieldModule from 'https://cardstack.com/base/color';
import type * as DateFieldModule from 'https://cardstack.com/base/date';
import type * as DayFieldModule from 'https://cardstack.com/base/date/day';
import type * as MonthFieldModule from 'https://cardstack.com/base/date/month';
import type * as MonthDayFieldModule from 'https://cardstack.com/base/date/month-day';
import type * as MonthYearFieldModule from 'https://cardstack.com/base/date/month-year';
import type * as QuarterFieldModule from 'https://cardstack.com/base/date/quarter';
import type * as WeekFieldModule from 'https://cardstack.com/base/date/week';
import type * as YearFieldModule from 'https://cardstack.com/base/date/year';
import type * as DateRangeFieldModule from 'https://cardstack.com/base/date-range-field';
import type * as DateTimeFieldModule from 'https://cardstack.com/base/datetime';
import type * as DatetimeStampFieldModule from 'https://cardstack.com/base/datetime-stamp';
import type * as EmailFieldModule from 'https://cardstack.com/base/email';
import type * as EnumModule from 'https://cardstack.com/base/enum';
import type * as EthereumAddressModule from 'https://cardstack.com/base/ethereum-address';
import type * as FileApiModule from 'https://cardstack.com/base/file-api';
import type * as MarkdownFieldModule from 'https://cardstack.com/base/markdown';
import type * as NumberFieldModule from 'https://cardstack.com/base/number';
import type * as PhoneNumberFieldModule from 'https://cardstack.com/base/phone-number';
import type * as RealmFieldModule from 'https://cardstack.com/base/realm';
import type * as RichMarkdownModule from 'https://cardstack.com/base/rich-markdown';
import type * as SearchableModule from 'https://cardstack.com/base/searchable';
import type * as SkillModule from 'https://cardstack.com/base/skill';
import type * as StringFieldModule from 'https://cardstack.com/base/string';
import type * as SystemCardModule from 'https://cardstack.com/base/system-card';
import type * as TextAreaFieldModule from 'https://cardstack.com/base/text-area';
import type * as TimeFieldModule from 'https://cardstack.com/base/time';
import type * as DurationFieldModule from 'https://cardstack.com/base/time/duration';
import type * as RelativeTimeFieldModule from 'https://cardstack.com/base/time/relative-time';
import type * as TimeRangeFieldModule from 'https://cardstack.com/base/time/time-range';

type StringField = (typeof StringFieldModule)['default'];
let StringField: StringField;

type NumberField = (typeof NumberFieldModule)['default'];
let NumberField: NumberField;

type DateField = (typeof DateFieldModule)['default'];
let DateField: DateField;

type DateTimeField = (typeof DateTimeFieldModule)['default'];
let DateTimeField: DateTimeField;

type ColorField = (typeof ColorFieldModule)['default'];
let ColorField: ColorField;

type DatetimeStampField = (typeof DatetimeStampFieldModule)['default'];
let DatetimeStampField: DatetimeStampField;

type DateRangeField = (typeof DateRangeFieldModule)['default'];
let DateRangeField: DateRangeField;

type DayField = (typeof DayFieldModule)['default'];
let DayField: DayField;

type MonthField = (typeof MonthFieldModule)['default'];
let MonthField: MonthField;

type MonthDayField = (typeof MonthDayFieldModule)['default'];
let MonthDayField: MonthDayField;

type MonthYearField = (typeof MonthYearFieldModule)['default'];
let MonthYearField: MonthYearField;

type YearField = (typeof YearFieldModule)['default'];
let YearField: YearField;

type WeekField = (typeof WeekFieldModule)['default'];
let WeekField: WeekField;

type QuarterField = (typeof QuarterFieldModule)['default'];
let QuarterField: QuarterField;

type TimeField = (typeof TimeFieldModule)['default'];
let TimeField: TimeField;

type TimeRangeField = (typeof TimeRangeFieldModule)['default'];
let TimeRangeField: TimeRangeField;

type DurationField = (typeof DurationFieldModule)['default'];
let DurationField: DurationField;

type RelativeTimeField = (typeof RelativeTimeFieldModule)['default'];
let RelativeTimeField: RelativeTimeField;

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

type RichMarkdownField = (typeof RichMarkdownModule)['RichMarkdownField'];
let RichMarkdownField: RichMarkdownField;

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
let CSSField: (typeof CardAPIModule)['CSSField'];
let createFromSerialized: (typeof CardAPIModule)['createFromSerialized'];
let updateFromSerialized: (typeof CardAPIModule)['updateFromSerialized'];
let rawSerializeCard: (typeof CardAPIModule)['serializeCard'];
let rawSerializeFileDef: (typeof CardAPIModule)['serializeFileDef'];
let searchDoc: (typeof CardAPIModule)['searchDoc'];
let searchDocFromFields: (typeof SearchableModule)['searchDocFromFields'];

// Test-side wrappers around the raw card-api serialize functions that
// auto-supply `virtualNetwork` from the active loader. Tests that need a
// non-default VN can still pass one in `opts` and it overrides the
// defaulted value.
function serializeCard(
  card: Parameters<(typeof CardAPIModule)['serializeCard']>[0],
  opts?: Partial<Parameters<(typeof CardAPIModule)['serializeCard']>[1]>,
): ReturnType<(typeof CardAPIModule)['serializeCard']> {
  return rawSerializeCard(card, { ...opts });
}

function serializeFileDef(
  fileDef: Parameters<(typeof CardAPIModule)['serializeFileDef']>[0],
  opts?: Partial<Parameters<(typeof CardAPIModule)['serializeFileDef']>[1]>,
): ReturnType<(typeof CardAPIModule)['serializeFileDef']> {
  return rawSerializeFileDef(fileDef, { ...opts });
}
let isSaved: (typeof CardAPIModule)['isSaved'];
let getRelationshipMembershipState: (typeof CardAPIModule)['getRelationshipMembershipState'];
let getBrokenLinks: (typeof CardAPIModule)['getBrokenLinks'];
let getDataBucket: (typeof CardAPIModule)['getDataBucket'];
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
let Theme: (typeof CardAPIModule)['Theme'];
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

  ColorField = (
    await loader.import<typeof ColorFieldModule>(`${baseRealm.url}color`)
  ).default;

  DatetimeStampField = (
    await loader.import<typeof DatetimeStampFieldModule>(
      `${baseRealm.url}datetime-stamp`,
    )
  ).default;

  DateRangeField = (
    await loader.import<typeof DateRangeFieldModule>(
      `${baseRealm.url}date-range-field`,
    )
  ).default;

  DayField = (
    await loader.import<typeof DayFieldModule>(`${baseRealm.url}date/day`)
  ).default;

  MonthField = (
    await loader.import<typeof MonthFieldModule>(`${baseRealm.url}date/month`)
  ).default;

  MonthDayField = (
    await loader.import<typeof MonthDayFieldModule>(
      `${baseRealm.url}date/month-day`,
    )
  ).default;

  MonthYearField = (
    await loader.import<typeof MonthYearFieldModule>(
      `${baseRealm.url}date/month-year`,
    )
  ).default;

  YearField = (
    await loader.import<typeof YearFieldModule>(`${baseRealm.url}date/year`)
  ).default;

  WeekField = (
    await loader.import<typeof WeekFieldModule>(`${baseRealm.url}date/week`)
  ).default;

  QuarterField = (
    await loader.import<typeof QuarterFieldModule>(
      `${baseRealm.url}date/quarter`,
    )
  ).default;

  TimeField = (
    await loader.import<typeof TimeFieldModule>(`${baseRealm.url}time`)
  ).default;

  TimeRangeField = (
    await loader.import<typeof TimeRangeFieldModule>(
      `${baseRealm.url}time/time-range`,
    )
  ).default;

  DurationField = (
    await loader.import<typeof DurationFieldModule>(
      `${baseRealm.url}time/duration`,
    )
  ).default;

  RelativeTimeField = (
    await loader.import<typeof RelativeTimeFieldModule>(
      `${baseRealm.url}time/relative-time`,
    )
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

  RichMarkdownField = (
    await loader.import<typeof RichMarkdownModule>(
      `${baseRealm.url}rich-markdown`,
    )
  ).RichMarkdownField;

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
    serializeCard: rawSerializeCard,
    serializeFileDef: rawSerializeFileDef,
    isSaved,
    getRelationshipMembershipState,
    getBrokenLinks,
    getDataBucket,
    getQueryableValue,
    searchDoc,
    subscribeToChanges,
    unsubscribeFromChanges,
    flushLogs,
    queryableValue,
    MaybeBase64Field,
    CSSField,
    getFieldDescription,
    ReadOnlyField,
    instanceOf,
    CardInfoField,
    Theme,
  } = cardAPI);

  // The searchable-driven generator lives in its own base module, not on
  // card-api (so it stays out of every card's dependency closure).
  searchDocFromFields = (
    await loader.import<typeof SearchableModule>(`${baseRealm.url}searchable`)
  ).searchDocFromFields;

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
  ColorField,
  DatetimeStampField,
  DateRangeField,
  DayField,
  MonthField,
  MonthDayField,
  MonthYearField,
  YearField,
  WeekField,
  QuarterField,
  TimeField,
  TimeRangeField,
  DurationField,
  RelativeTimeField,
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
  RichMarkdownField,
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
  CSSField,
  createFromSerialized,
  updateFromSerialized,
  serializeCard,
  serializeFileDef,
  isSaved,
  getRelationshipMembershipState,
  getBrokenLinks,
  getDataBucket,
  getQueryableValue,
  searchDoc,
  searchDocFromFields,
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
  Theme,
  enumField,
  enumOptions,
  enumValues,
  enumConfig,
};
