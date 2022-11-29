import { contains, containsMany, linksTo, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import DateCard from 'https://cardstack.com/base/date';
import IntegerCard from 'https://cardstack.com/base/integer';
import { Vendor } from './vendor';
import { PaymentMethod } from './payment-method';
import { initStyleSheet, attachStyles } from 'https://cardstack.com/base/attach-styles';
import { balanceInCurrency, formatUSD } from './currency-format';

let invoiceStyles = initStyleSheet(`
  this {
    max-width: 50rem;
    background-color: #fff;
    border: 1px solid gray;
    border-radius: 10px;
    font-family: "Open Sans", Helvetica, Arial, sans-serif;
    font-size: 0.8125rem;
    letter-spacing: 0.01em;
    line-height: 1.25;
    overflow: hidden;
  }
  .header {
    padding: 2rem;
    background-color: #F8F7FA;
  }
  .invoice {
    padding: 2rem;
    display: grid;
    gap: 3rem 0;
  }
  h1 {
    margin: 0;
    font-size: 1.275rem;
    letter-spacing: 0;
    line-height: 1.875;
  }
  h2 {
    margin-top: 0;
    font-size: 1rem;
    letter-spacing: 0.03em;
    line-height: 1.375;
  }
  .label {
    margin-bottom: 1rem;
    color: #A0A0A0;
    font-size: 0.6875rem;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    line-height: 1.25;
  }

  .line-items__header {
    display: grid;
    grid-template-columns: 3fr 1fr 2fr;
  }
  .line-items__header > *:nth-child(2) {
    justify-self: center;
  }
  .line-items__header > *:last-child {
    justify-self: end;
  }
  .line-items__rows {
    padding: 2rem 0;
    border-top: 1px solid #E8E8E8;
    border-bottom: 1px solid #E8E8E8;
  }
  .line-items__rows > * + * {
    margin-top: 1.25rem;
  }

  .payment,
  .payment-methods {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .payment-methods__list > * + * {
    margin-top: 1rem;
  }

  .balance-due {
    text-align: right;
  }
  .balance-due__total {
    font-size: 1.625rem;
    font-weight: bold;
  }
`);

let detailsStyles = initStyleSheet(`
  this {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .details__fields {
    display: grid;
    grid-template-columns: 1fr 2fr;
    grid-gap: 0 1em;
  }
  .label {
    margin-bottom: 1rem;
    color: #A0A0A0;
    font-size: 0.6875rem;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    line-height: 1.25;
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
      <div {{attachStyles detailsStyles}}>
        <div class="details__fields">
          <div class="label">Invoice No.</div><div><@fields.invoiceNo/></div>
          <div class="label">Invoice Date</div><div><@fields.invoiceDate/></div>
          <div class="label">Due Date</div><div><@fields.dueDate/></div>
          <div class="label">Terms</div> <div><@fields.terms/></div>
          <div class="label">Invoice Document</div> <div><@fields.invoiceDocument/></div>
        </div>
        <div class="details__fields">
          <div class="label">Memo</div> <div><@fields.memo/></div>
        </div>
      </div>
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

class LineItem extends Card {
  @field name = contains(StringCard);
  @field quantity = contains(IntegerCard);
  @field amount = contains(IntegerCard);
  @field description = contains(StringCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div {{attachStyles lineItemStyles}}>
        <div>
          <div><strong><@fields.name/></strong></div>
          <@fields.description/>
        </div>
        <div class="line-item__qty"><@fields.quantity/></div>
        <div class="line-item__amount">
          <strong>{{formatUSD @model.amount}}</strong>
        </div>
      </div>
    </template>
  };
}

class InvoiceTemplate extends Component<typeof InvoicePacket> {
  <template>
    <div {{attachStyles invoiceStyles}}>
      <header class="header">
        <h1>Invoice</h1>
      </header>
      <section class="invoice">
        <section class="vendor">
          <h2>Vendor</h2>
          <@fields.vendor/>
        </section>
        <section class="details">
          <h2>Details</h2>
          <@fields.details />
        </section>
        <section class="line-items">
          <h2>Line Items</h2>
          <header class="line-items__header">
            <div class="label">Goods / services rendered</div>
            <div class="label line-items__qty">Qty</div>
            <div class="label line-items__amount">Amount</div>
          </header>
          <div class="line-items__rows">
            <@fields.lineItems />
          </div>
        </section>
        <div class="payment">
          <section>
            <h2>Payment Methods</h2>
            <div class="payment-methods">
              <div>
                <div class="label">Primary<br> Payment Method</div>
                <@fields.primaryPayment/>
              </div>
              <div class="payment-methods__list">
                <div class="label">Alternate<br> Payment Methods</div>
                <@fields.alternatePayments/>
              </div>
            </div>
          </section>
          <section class="balance-due">
            <div class="label">Balance Due</div>
            <div class="balance-due__total">{{formatUSD @model.balanceDue}}</div>
          </section>
        </div>
      </section>
    </div>
  </template>
}

class EditInvoiceTemplate extends Component<typeof InvoicePacket> {
  <template>
    <div {{attachStyles invoiceStyles}}>
      <header class="header">
        <h1>Edit Invoice</h1>
      </header>
      <section class="invoice">
        <section class="vendor">
          <h2>Vendor</h2>
          <@fields.vendor/>
        </section>
        <section class="details">
          <h2>Details</h2>
          <@fields.details />
        </section>
        <section class="line-items">
          <h2>Line Items</h2>
          <header class="line-items__header">
            <div class="label">Goods / services rendered</div>
            <div class="label line-items__qty">Qty</div>
            <div class="label line-items__amount">Amount</div>
          </header>
          <div class="line-items__rows">
            <@fields.lineItems />
          </div>
        </section>
        <div class="payment">
          <section>
            <h2>Payment Methods</h2>
            <div class="payment-methods">
              <div>
                <div class="label">Primary<br> Payment Method</div>
                <@fields.primaryPayment/>
              </div>
              <div class="payment-methods__list">
                <div class="label">Alternate<br> Payment Methods</div>
                <@fields.alternatePayments/>
              </div>
            </div>
          </section>
          <section class="balance-due">
            <div class="label">Balance Due</div>
            <div class="balance-due__total">{{formatUSD @model.balanceDue}}</div>
          </section>
        </div>
      </section>
    </div>
  </template>
}

export class InvoicePacket extends Card {
  @field vendor = linksTo(Vendor);
  @field details = contains(Details);
  @field lineItems = containsMany(LineItem);
  @field primaryPayment = contains(PaymentMethod);
  @field alternatePayments = containsMany(PaymentMethod);
  @field balanceDue = contains(IntegerCard, { computeVia:
    function(this: InvoicePacket) {
      return this.lineItems.length === 0 ? 0 : this.lineItems.map(i => i.amount * i.quantity).reduce((a, b) => (a + b));
    }
  });

  static embedded = InvoiceTemplate;
  static isolated = InvoiceTemplate;
  static edit = EditInvoiceTemplate;
}
