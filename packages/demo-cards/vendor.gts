import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { CardContainer } from '@cardstack/boxel-ui';

let styleSheet = initStyleSheet(`
  this {
    display: grid;
    grid-template-columns: 1fr auto;
    line-height: 1.5;
  }
  address {
    font-style: normal;
  }
`);

class VendorTemplate extends Component<typeof Vendor> {
  <template>
    <CardContainer {{attachStyles styleSheet}}>
      {{#if @model.vendorName}}
        <div>
          <@fields.vendorName/>
          <address>
            <div><@fields.addressLine/></div>
            <@fields.city/> <@fields.state/> <@fields.zipCode/> <@fields.country/>
          </address>
          <@fields.email/>
        </div>
        <img src={{@model.logo}} />
      {{else}}
        {{!-- PLACEHOLDER CONTENT --}}
        <div>
          <strong>Vendor Name</strong>
          <address>
            <div>123 California St Ste 1234</div>
            <div>San Francisco, CA 12345 USA</div>
          </address>
          email@vendorname.com
        </div>
      {{/if}}
    </CardContainer>
  </template>
}

export class Vendor extends Card {
  @field vendorName = contains(StringCard);
  @field addressLine = contains(StringCard);
  @field city = contains(StringCard);
  @field state = contains(StringCard);
  @field zipCode = contains(StringCard);
  @field country = contains(StringCard);
  @field email = contains(StringCard);
  @field logo = contains(StringCard);

  static embedded = VendorTemplate;
  static isolated = VendorTemplate;
}
