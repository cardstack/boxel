import { contains, containsMany, linksTo, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import DateCard from 'https://cardstack.com/base/date';
import IntegerCard from 'https://cardstack.com/base/integer';
import { Vendor } from './vendor';
import { PaymentMethod } from './payment-method';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { formatUSD, balanceInCurrency } from './currency-format';
import { CardContainer, FieldContainer, Section, Label } from '@cardstack/boxel-ui';

let invoiceStyles = initStyleSheet(`
  this {
    max-width: 60rem;
    font: var(--boxel-font-sm);
    letter-spacing: var(--boxel-lsp-xs);
    overflow: hidden;
  }
  .invoice {
    padding: var(--boxel-sp-xl);
    display: grid;
    gap: var(--boxel-sp-xxl) 0;
  }

  .line-items__title-row {
    display: grid;
    grid-template-columns: 3fr 1fr 2fr;
    margin-bottom: var(--boxel-sp-xxxs);
  }
  .line-items__title-row > *:nth-child(2) {
    justify-self: center;
  }
  .line-items__title-row > *:last-child {
    justify-self: end;
  }
  .line-items__rows {
    padding: var(--boxel-sp-lg) 0;
    border-top: 1px solid var(--boxel-200);
    border-bottom: 1px solid var(--boxel-200);
  }
  .line-items__rows > * + * {
    margin-top: var(--boxel-sp-xs);
  }

  .payment {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 0 var(--boxel-sp-xs);
  }
  .payment-methods {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 var(--boxel-sp-xs);
  }
  .payment-methods__bal {
    margin-left: var(--boxel-sp-lg);
  }

  .balance-due {
    justify-items: end;
    text-align: right;
  }
  .balance-due__total {
    font: 700 var(--boxel-font-lg);
  }
`);

let detailsStyles = initStyleSheet(`
  this {
    --boxel-field-label-size: 35%;
    --boxel-field-label-align: center;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--boxel-sp-xl);
  }
  .details--edit {
    padding: var(--boxel-sp);
  }
  .details__fields {
    display: grid;
    grid-gap: var(--boxel-sp) 0;
  }
`);
class Details extends Card {
  @field invoiceNo = contains(StringCard);
  @field invoiceDate = contains(DateCard);
  @field dueDate = contains(DateCard);
  @field terms = contains(StringCard);
  @field invoiceDocument = contains(StringCard);
  @field memo = contains(TextAreaCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer {{attachStyles detailsStyles}}>
        <div class="details__fields">
          <FieldContainer @label="Invoice No." @horizontal={{true}}><@fields.invoiceNo/></FieldContainer>
          <FieldContainer @label="Invoice Date" @horizontal={{true}}><@fields.invoiceDate/></FieldContainer>
          <FieldContainer @label="Due Date" @horizontal={{true}}><@fields.dueDate/></FieldContainer>
          <FieldContainer @label="Terms" @horizontal={{true}}><@fields.terms/></FieldContainer>
          <FieldContainer @label="Invoice Document" @horizontal={{true}}><@fields.invoiceDocument/></FieldContainer>
        </div>
        <FieldContainer @label="Memo" @horizontal={{true}}><@fields.memo/></FieldContainer>
      </CardContainer>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer class="details--edit" @displayBoundaries={{true}} {{attachStyles detailsStyles}}>
        <div class="details__fields">
          <FieldContainer @tag="label" @label="Invoice No." @horizontal={{true}}><@fields.invoiceNo/></FieldContainer>
          <FieldContainer @tag="label" @label="Invoice Date" @horizontal={{true}}><@fields.invoiceDate/></FieldContainer>
          <FieldContainer @tag="label" @label="Due Date" @horizontal={{true}}><@fields.dueDate/></FieldContainer>
          <FieldContainer @tag="label" @label="Terms" @horizontal={{true}}><@fields.terms/></FieldContainer>
          <FieldContainer @tag="label" @label="Invoice Document" @horizontal={{true}}><@fields.invoiceDocument/></FieldContainer>
        </div>
        <FieldContainer @tag="label" @vertical={{true}} @label="Memo"><@fields.memo/></FieldContainer>
      </CardContainer>
    </template>
  };
}

let lineItemStyles = initStyleSheet(`
  this {
    display: grid;
    grid-template-columns: 3fr 1fr 2fr;
  }
  .line-item__qty {
    justify-self: center;
  }
  .line-item__amount {
    justify-self: end;
  }
`);
let lineItemEditStyles = initStyleSheet(`
  this {
    display: grid;
    gap: var(--boxel-sp-sm);
  }
  .line-item__row {
    display: grid;
    grid-template-columns: 3fr 1fr 2fr;
    gap: var(--boxel-sp);
    align-items: end;
  }
`);

class LineItem extends Card {
  @field name = contains(StringCard);
  @field quantity = contains(IntegerCard);
  @field amount = contains(IntegerCard);
  @field description = contains(StringCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer {{attachStyles lineItemStyles}}>
        <div>
          <div><strong><@fields.name/></strong></div>
          <@fields.description/>
        </div>
        <div class="line-item__qty"><@fields.quantity/></div>
        <div class="line-item__amount">
          <strong>{{formatUSD @model.amount}}</strong>
        </div>
      </CardContainer>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer {{attachStyles lineItemEditStyles}}>
        <div class="line-item__row">
          <FieldContainer class="line-item__field" @tag="label" @label="Goods / Services Rendered"><@fields.name/></FieldContainer>
          <FieldContainer class="line-item__field" @tag="label" @label="Qty"><@fields.quantity/></FieldContainer>
          <FieldContainer class="line-item__field" @tag="label" @label="Amount"><@fields.amount/></FieldContainer>
        </div>
        <FieldContainer @tag="label" @label="Description"><@fields.description/></FieldContainer>
      </CardContainer>
    </template>
  };
}

class InvoiceTemplate extends Component<typeof InvoicePacket> {
  <template>
    <CardContainer
      @displayBoundaries={{true}}
      @header="Invoice"
      @headerSize="large"
      {{attachStyles invoiceStyles}}
    >
      <section class="invoice">
        <Section @header="Vendor">
          <@fields.vendor/>
        </Section>
        <Section @header="Details">
          <@fields.details />
        </Section>
        <Section @header="Line Items">
          <div class="line-items__title-row">
            <Label>Goods / services rendered</Label>
            <Label>Qty</Label>
            <Label>Amount</Label>
          </div>
          <div class="line-items__rows">
            <@fields.lineItems />
          </div>
        </Section>
        <div class="payment">
          <Section @header="Payment Methods" class="payment-methods">
            <FieldContainer @label="Primary Payment Method">
              <div>
                <@fields.primaryPayment/>
                <div class="payment-methods__bal">{{balanceInCurrency @model.balanceDue @model.primaryPayment.exchangeRate @model.primaryPayment.currency}}</div>
              </div>
            </FieldContainer>
            <FieldContainer @label="Alternate Payment Methods">
              <div>
                <@fields.alternatePayment/>
                <div class="payment-methods__bal">{{balanceInCurrency @model.balanceDue @model.alternatePayment.exchangeRate @model.alternatePayment.currency}}</div>
              </div>
            </FieldContainer>
          </Section>
          <FieldContainer @vertical={{true}} @label="Balance Due" class="balance-due">
            <span class="balance-due__total">{{formatUSD @model.balanceDue}}</span>
          </FieldContainer>
        </div>
      </section>
    </CardContainer>
  </template>
}

class EditInvoiceTemplate extends Component<typeof InvoicePacket> {
  <template>
    <CardContainer
      @displayBoundaries={{true}}
      @header="Edit Invoice"
      @headerSize="large"
      {{attachStyles invoiceStyles}}
    >
      <section class="invoice">
        <Section @header="Vendor">
          <@fields.vendor/>
        </Section>
        <Section @header="Details">
          <@fields.details />
        </Section>
        <Section @header="Line Items">
          <@fields.lineItems />
        </Section>
        <Section @header="Payment Methods" class="payment-methods">
          <FieldContainer @tag="label" @label="Primary Payment Method">
            <@fields.primaryPayment/>
          </FieldContainer>
          <FieldContainer @tag="label" @label="Alternate Payment Methods">
            <@fields.alternatePayment/>
          </FieldContainer>
        </Section>
        <FieldContainer @vertical={{true}} @label="Balance Due" class="balance-due">
          <span class="balance-due__total">{{formatUSD @model.balanceDue}}</span>
        </FieldContainer>
      </section>
    </CardContainer>
  </template>
}

export class InvoicePacket extends Card {
  @field vendor = linksTo(Vendor);
  @field details = contains(Details);
  @field lineItems = containsMany(LineItem);
  @field primaryPayment = linksTo(PaymentMethod);
  @field alternatePayment = linksTo(PaymentMethod);
  @field balanceDue = contains(IntegerCard, { computeVia:
    function(this: InvoicePacket) {
      return this.lineItems.length === 0 ? 0 : this.lineItems.map(i => i.amount * i.quantity).reduce((a, b) => (a + b));
    }
  });

  static embedded = InvoiceTemplate;
  static isolated = InvoiceTemplate;
  static edit = EditInvoiceTemplate;
}
