import { contains, field, Card, Component, linksTo } from "https://cardstack.com/base/card-api";
import StringCard from 'https://cardstack.com/base/string';
import { PaymentType } from './payment-type';
import { Chain } from './chain';

export class WireTransfer extends Card {
  @field currency = contains(StringCard); // dropdown of currencies
  @field iban = contains(StringCard); // IBAN format
  @field bic = contains(StringCard); // BIC format
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div><@fields.iban/></div>
      <div><@fields.bic/></div>
    </template>
  }
  static embedded = this.isolated;
}

export class Payment extends Card {
  @field typeId = linksTo(PaymentType); // Dropdown (CryptoPayment, WireTransfer)
  @field cryptoPayment = linksTo(Chain);
  @field wireTransfer = contains(WireTransfer);
  static edit = class Edit extends Component<typeof this> {
    <template>
      <@fields.typeId/>
    </template>
  };
}
