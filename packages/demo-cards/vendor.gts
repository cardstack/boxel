import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import { initStyleSheet, attachStyles } from 'https://cardstack.com/base/attach-styles';

let styleSheet = initStyleSheet(`
  this { 
    display: grid;
    grid-template-columns: 1fr 1fr;
    line-height: 1.5;
  }
  header {
    font-weight: bold;
  }
  address {
    font-style: normal;
  }
`);

class VendorTemplate extends Component<typeof Vendor> {
  <template>
    {{#if @model.vendorName}}
      <div {{attachStyles styleSheet}}>
        <div>
          <header><@fields.vendorName/></header>
          <address>
            <div><@fields.addressLine/></div>
            <@fields.city/> <@fields.state/> <@fields.zipCode/>
          </address>
          <@fields.email/>
        </div>
        <@fields.logo/>
      </div>
    {{/if}}
  </template>
}

export class Vendor extends Card {
  @field vendorName = contains(StringCard);
  @field addressLine = contains(StringCard);
  @field city = contains(StringCard);
  @field state = contains(StringCard);
  @field zipCode = contains(IntegerCard);
  @field email = contains(StringCard);
  @field logo = contains(StringCard);
  
  static embedded = VendorTemplate;
  static isolated = VendorTemplate;
}