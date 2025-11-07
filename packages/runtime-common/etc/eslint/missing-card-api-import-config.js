/* eslint-disable no-undef */
'use strict';

module.exports = {
  importMappings: {
    // card-api methods, classes and decorators
    Component: ['Component', 'https://cardstack.com/base/card-api'],
    CardDef: ['CardDef', 'https://cardstack.com/base/card-api'],
    FieldDef: ['FieldDef', 'https://cardstack.com/base/card-api'],
    field: ['field', 'https://cardstack.com/base/card-api'],
    contains: ['contains', 'https://cardstack.com/base/card-api'],
    linksTo: ['linksTo', 'https://cardstack.com/base/card-api'],
    containsMany: ['containsMany', 'https://cardstack.com/base/card-api'],
    linksToMany: ['linksToMany', 'https://cardstack.com/base/card-api'],

    // Base realm field defs
    AddressField: ['default', 'https://cardstack.com/base/address'],
    Base64ImageField: ['default', 'https://cardstack.com/base/base64-image'],
    BigIntegerField: ['default', 'https://cardstack.com/base/big-integer'],
    BooleanField: ['default', 'https://cardstack.com/base/boolean'],
    CodeRefField: ['default', 'https://cardstack.com/base/code-ref'],
    ColorField: ['default', 'https://cardstack.com/base/color'],
    CoordinateField: ['default', 'https://cardstack.com/base/coordinate'],
    CountryField: ['default', 'https://cardstack.com/base/country'],
    DateField: ['default', 'https://cardstack.com/base/date'],
    DateRangeField: ['default', 'https://cardstack.com/base/date-range-field'],
    DateTimeField: ['default', 'https://cardstack.com/base/datetime'],
    EmailField: ['default', 'https://cardstack.com/base/email'],
    EthereumAddressField: [
      'default',
      'https://cardstack.com/base/ethereum-address',
    ],
    MarkdownField: ['default', 'https://cardstack.com/base/markdown'],
    NumberField: ['default', 'https://cardstack.com/base/number'],
    PercentageField: ['default', 'https://cardstack.com/base/percentage'],
    PhoneNumberField: ['default', 'https://cardstack.com/base/phone-number'],
    StringField: ['default', 'https://cardstack.com/base/string'],
    TextAreaField: ['default', 'https://cardstack.com/base/text-area'],
    URLField: ['default', 'https://cardstack.com/base/url'],
    WebsiteField: ['default', 'https://cardstack.com/base/website'],

    // Enumerations
    enumField: ['default', 'https://cardstack.com/base/enum'],
    enumConfig: ['enumConfig', 'https://cardstack.com/base/enum'],

    // More
    Skill: ['default', 'https://cardstack.com/base/skill'],
  },
};
