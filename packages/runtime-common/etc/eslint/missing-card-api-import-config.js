/* eslint-disable no-undef */
'use strict';

module.exports = {
  importMappings: {
    // card-api methods, classes and decorators
    Component: ['Component', '@cardstack/base/card-api'],
    CardDef: ['CardDef', '@cardstack/base/card-api'],
    FieldDef: ['FieldDef', '@cardstack/base/card-api'],
    field: ['field', '@cardstack/base/card-api'],
    contains: ['contains', '@cardstack/base/card-api'],
    linksTo: ['linksTo', '@cardstack/base/card-api'],
    containsMany: ['containsMany', '@cardstack/base/card-api'],
    linksToMany: ['linksToMany', '@cardstack/base/card-api'],

    // Base realm field defs
    AddressField: ['default', '@cardstack/base/address'],
    Base64ImageField: ['default', '@cardstack/base/base64-image'],
    BigIntegerField: ['default', '@cardstack/base/big-integer'],
    BooleanField: ['default', '@cardstack/base/boolean'],
    CodeRefField: ['default', '@cardstack/base/code-ref'],
    ColorField: ['default', '@cardstack/base/color'],
    CoordinateField: ['default', '@cardstack/base/coordinate'],
    CountryField: ['default', '@cardstack/base/country'],
    DateField: ['default', '@cardstack/base/date'],
    DateRangeField: ['default', '@cardstack/base/date-range-field'],
    DateTimeField: ['default', '@cardstack/base/datetime'],
    EmailField: ['default', '@cardstack/base/email'],
    EthereumAddressField: [
      'default',
      '@cardstack/base/ethereum-address',
    ],
    MarkdownField: ['default', '@cardstack/base/markdown'],
    NumberField: ['default', '@cardstack/base/number'],
    PercentageField: ['default', '@cardstack/base/percentage'],
    PhoneNumberField: ['default', '@cardstack/base/phone-number'],
    StringField: ['default', '@cardstack/base/string'],
    TextAreaField: ['default', '@cardstack/base/text-area'],
    URLField: ['default', '@cardstack/base/url'],
    WebsiteField: ['default', '@cardstack/base/website'],

    // Enumerations
    enumField: ['default', '@cardstack/base/enum'],
    enumConfig: ['enumConfig', '@cardstack/base/enum'],

    // More
    Skill: ['default', '@cardstack/base/skill'],
  },
};
