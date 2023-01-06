import { contains, containsMany, linksTo, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import DateCard from 'https://cardstack.com/base/date';
import DatetimeCard from "https://cardstack.com/base/datetime";
import IntegerCard from 'https://cardstack.com/base/integer';
import { Vendor } from './vendor';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { formatUSD, balanceInCurrency } from './currency-format';
import { CardContainer, FieldContainer, Label, Message } from '@cardstack/boxel-ui';
import { Token, Currency } from './asset';

let invoiceStyles = initStyleSheet(`
  this {
    max-width: 50rem;
    font: var(--boxel-font-sm);
    letter-spacing: var(--boxel-lsp-xs);
    overflow: hidden;
  }
  .invoice-template-editor {
    --boxel-label-color: var(--boxel-dark);
  }
  .invoice {
    padding: var(--boxel-sp-xl);
    display: grid;
    gap: var(--boxel-sp-xxl) 0;
  }
  h2 {
    margin-top: 0;
    margin-bottom: var(--boxel-sp);
    font: 700 var(--boxel-font);
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

  .payment,
  .payment-methods {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 var(--boxel-sp-xs);
  }
  .payment-method__item {
    display: inline-grid;
    grid-template-columns: var(--boxel-sp) 1fr;
    gap: var(--boxel-sp-xxxs);
    font: 700 var(--boxel-font);
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

  .extras {
    padding: var(--boxel-sp-xl);
    display: grid;
    gap: var(--boxel-sp-xxl) 0;
    background-color: var(--boxel-100);
  }

  .notes,
  .history {
    --boxel-border-radius: 20px;
    padding: var(--boxel-sp);
  }
  .notes > * + *,
  .history > * + * {
    margin-top: var(--boxel-sp);
    padding-top: var(--boxel-sp);
    border-top: 1px solid var(--boxel-200);
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
          <FieldContainer @label="Invoice No."><@fields.invoiceNo/></FieldContainer>
          <FieldContainer @label="Invoice Date"><@fields.invoiceDate/></FieldContainer>
          <FieldContainer @label="Due Date"><@fields.dueDate/></FieldContainer>
          <FieldContainer @label="Terms"><@fields.terms/></FieldContainer>
          <FieldContainer @label="Invoice Document"><@fields.invoiceDocument/></FieldContainer>
        </div>
        <FieldContainer @label="Memo"><@fields.memo/></FieldContainer>
      </CardContainer>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer class="details--edit" @displayBoundaries={{true}} {{attachStyles detailsStyles}}>
        <div class="details__fields">
          <FieldContainer @tag="label" @label="Invoice No."><@fields.invoiceNo/></FieldContainer>
          <FieldContainer @tag="label" @label="Invoice Date"><@fields.invoiceDate/></FieldContainer>
          <FieldContainer @tag="label" @label="Due Date"><@fields.dueDate/></FieldContainer>
          <FieldContainer @tag="label" @label="Terms"><@fields.terms/></FieldContainer>
          <FieldContainer @tag="label" @label="Invoice Document"><@fields.invoiceDocument/></FieldContainer>
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
          <FieldContainer class="line-item__field" @tag="label" @label="Goods / Services Rendered" @vertical={{true}}><@fields.name/></FieldContainer>
          <FieldContainer class="line-item__field" @tag="label" @label="Qty" @vertical={{true}}><@fields.quantity/></FieldContainer>
          <FieldContainer class="line-item__field" @tag="label" @label="Amount" @vertical={{true}}><@fields.amount/></FieldContainer>
        </div>
        <FieldContainer @tag="label" @label="Description" @vertical={{true}}><@fields.description/></FieldContainer>
      </CardContainer>
    </template>
  };
}

class Note extends Card {
  @field text = contains(TextAreaCard);
  @field authorName = contains(StringCard); /* computed */
  @field authorImage = contains(StringCard); /* computed */
  @field timestamp = contains(DatetimeCard); /* computed */

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <Message
        @name={{@model.authorName}}
        @imgURL={{@model.authorImage}}
        @datetime={{@model.timestamp}}
      >
        <@fields.text/>
      </Message>
    </template>
  }
}

class InvoiceTemplate extends Component<typeof InvoicePacket> {
  <template>
    <CardContainer
      @displayBoundaries={{true}}
      @title="Invoice"
      {{attachStyles invoiceStyles}}
    >
      <section class="invoice">
        <section>
          <h2>Vendor</h2>
          <@fields.vendor/>
        </section>
        <section>
          <h2>Details</h2>
          <@fields.details/>
        </section>
        <section>
          <h2>Line Items</h2>
          <div class="line-items__title-row">
            <Label>Goods / services rendered</Label>
            <Label>Qty</Label>
            <Label>Amount</Label>
          </div>
          <div class="line-items__rows">
            <@fields.lineItems />
          </div>
        </section>
        <div class="payment">
          <section>
            <h2>Payment Methods</h2>
            <div class="payment-methods">
              <FieldContainer @label="Primary Payment Method" @vertical={{true}}>
                <div>
                  <@fields.primaryPayment/>
                  {{#if @model.primaryPayment}}
                    <div class="payment-methods__bal">{{balanceInCurrency @model.balanceDue @model.primaryPayment}}</div>
                  {{/if}}
                </div>
              </FieldContainer>
              {{#if @model.alternatePayment.length}}
                <FieldContainer @label="Alternate Payment Methods" @vertical={{true}}>
                  <div>
                    {{#each @model.alternatePayment as |payment|}}
                      <div class="payment-method__item">{{#if payment.logoURL}}<img src={{payment.logoURL}}>{{/if}} {{payment.symbol}}</div>
                      <div class="payment-methods__bal">{{balanceInCurrency @model.balanceDue payment}}</div>
                    {{/each}}
                  </div>
                </FieldContainer>
              {{/if}}
            </div>
          </section>
          <FieldContainer @vertical={{true}} @label="Balance Due" class="balance-due">
            <span class="balance-due__total">
              {{formatUSD @model.balanceDue}}
            </span>
          </FieldContainer>
        </div>
      </section>
      {{#if @model.notes.length}}
        <section class="extras">
          <section>
            <h2>Notes</h2>
            <CardContainer class="notes">
              <@fields.notes/>
            </CardContainer>
          </section>
        </section>
      {{/if}}
    </CardContainer>
  </template>
}

class EditTemplate extends Component<typeof InvoicePacket> {
  <template>
    <CardContainer
      @displayBoundaries={{true}}
      @title="Edit Invoice"
      class="invoice-template-editor"
      {{attachStyles invoiceStyles}}
    >
      <section class="invoice">
        <section>
          <h2>Vendor</h2>
          <@fields.vendor/>
        </section>
        <section>
          <h2>Details</h2>
          <@fields.details />
        </section>
        <section>
          <h2>Line Items</h2>
          <@fields.lineItems />
        </section>
        <section>
          <h2>Payment Methods</h2>
          <div class="payment-methods">
            <FieldContainer @tag="label" @label="Primary Payment Method" @vertical={{true}}>
              <@fields.primaryPayment/>
            </FieldContainer>
            <FieldContainer @tag="label" @label="Alternate Payment Methods" @vertical={{true}}>
              <@fields.alternatePayment/>
            </FieldContainer>
          </div>
        </section>
        <FieldContainer @label="Balance Due" class="balance-due" @vertical={{true}}>
          <span class="balance-due__total">
            {{formatUSD @model.balanceDue}}
          </span>
        </FieldContainer>
      </section>
    </CardContainer>
  </template>
}

export class InvoicePacket extends Card {
  @field vendor = linksTo(Vendor);
  @field details = contains(Details);
  @field lineItems = containsMany(LineItem);
  @field primaryPayment = contains(Token || Currency, { computeVia: function(this: InvoicePacket) {
    return this.vendor?.preferredPaymentMethod?.cryptoPayment?.token ?? this.vendor?.preferredPaymentMethod?.wireTransfer?.currency
  }});
  @field alternatePayment = containsMany(Token || Currency, { computeVia: function(this: InvoicePacket) {
    // TODO: implementation below is not working
    // this is a computed containsMany field trying to read fields off of a `vendor` linksTo field
    return this.vendor?.alternatePaymentMethod?.length ?  this.vendor.alternatePaymentMethod.map(p =>  p.cryptoPayment?.token ?? p.wireTransfer?.currency) : [];
  }});
  @field balanceDue = contains(IntegerCard, { computeVia:
    function(this: InvoicePacket) {
      return this.lineItems.length === 0 ? 0 : this.lineItems.map(i => i.amount * i.quantity).reduce((a, b) => (a + b));
    }
  });
  @field notes = containsMany(Note);

  static embedded = InvoiceTemplate;
  static isolated = InvoiceTemplate;
  static edit = EditTemplate;
}
