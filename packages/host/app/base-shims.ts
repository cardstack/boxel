import { VirtualNetwork } from '@cardstack/runtime-common';

import * as AddressModule from './base/address';
import * as Base64ImageModule from './base/base64-image';
import * as BigIntegerModule from './base/big-integer';
import * as BooleanModule from './base/boolean';
import * as CardAPIModule from './base/card-api';
import * as CardsGridModule from './base/cards-grid';
import * as CodeRefModule from './base/code-ref';
import * as ColorModule from './base/color';
import * as CommandModule from './base/command';
import * as ContainsManyComponentModule from './base/contains-many-component';
import * as CoordinateModule from './base/coordinate';
import * as CountryModule from './base/country';
import * as DateModule from './base/date';
import * as DateRangeFieldModule from './base/date-range-field';
import * as DatetimeModule from './base/datetime';
import * as EmailModule from './base/email';
import * as EthereumAddressModule from './base/ethereum-address';
import * as FieldComponentModule from './base/field-component';
import * as FileAPIModule from './base/file-api';
import * as LinksToEditorModule from './base/links-to-editor';
import * as LinksToManyComponentModule from './base/links-to-many-component';
import * as MarkdownModule from './base/markdown';
import * as MatrixEventModule from './base/matrix-event';
import * as NumberModule from './base/number';
import * as PercentageModule from './base/percentage';
import * as PhoneNumberModule from './base/phone-number';
import * as PositionedCardModule from './base/positioned-card';
import * as SharedStateModule from './base/shared-state';
import * as SkillModule from './base/skill';
import * as StringFieldModule from './base/string';
import * as TextAreaFieldModule from './base/text-area';

export function shimBase(virtualNetwork: VirtualNetwork) {
  virtualNetwork.shimModule(
    'https://cardstack.com/base/card-api',
    CardAPIModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/string',
    StringFieldModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/address',
    AddressModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/base64-image',
    Base64ImageModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/big-integer',
    BigIntegerModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/boolean',
    BooleanModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/cards-grid',
    CardsGridModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/code-ref',
    CodeRefModule,
  );
  virtualNetwork.shimModule('https://cardstack.com/base/color', ColorModule);
  virtualNetwork.shimModule(
    'https://cardstack.com/base/command',
    CommandModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/contains-many-component',
    ContainsManyComponentModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/coordinate',
    CoordinateModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/country',
    CountryModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/date-range-field',
    DateRangeFieldModule,
  );
  virtualNetwork.shimModule('https://cardstack.com/base/date', DateModule);
  virtualNetwork.shimModule(
    'https://cardstack.com/base/datetime',
    DatetimeModule,
  );
  virtualNetwork.shimModule('https://cardstack.com/base/email', EmailModule);
  virtualNetwork.shimModule(
    'https://cardstack.com/base/ethereum-address',
    EthereumAddressModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/field-component',
    FieldComponentModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/file-api',
    FileAPIModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/links-to-editor',
    LinksToEditorModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/links-to-many-component',
    LinksToManyComponentModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/markdown',
    MarkdownModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/matrix-event',
    MatrixEventModule,
  );
  virtualNetwork.shimModule('https://cardstack.com/base/number', NumberModule);
  virtualNetwork.shimModule(
    'https://cardstack.com/base/percentage',
    PercentageModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/phone-number',
    PhoneNumberModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/positioned-card',
    PositionedCardModule,
  );
  virtualNetwork.shimModule(
    'https://cardstack.com/base/shared-state',
    SharedStateModule,
  );
  virtualNetwork.shimModule('https://cardstack.com/base/skill', SkillModule);
  virtualNetwork.shimModule(
    'https://cardstack.com/base/text-area',
    TextAreaFieldModule,
  );
}
