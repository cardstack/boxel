import {
  contains,
  containsMany,
  linksTo,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import DateCard from 'https://cardstack.com/base/date';
import DatetimeCard from 'https://cardstack.com/base/datetime';
import NumberCard from 'https://cardstack.com/base/number';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import { Vendor } from './vendor';
import { formatUSD, balanceInCurrency } from './currency-format';
import { FieldContainer, Label, Message } from '@cardstack/boxel-ui';
import { Token, Currency } from './asset';

class Details extends Card {
  @field invoiceNo = contains(StringCard);
  @field invoiceDate = contains(DateCard);
  @field dueDate = contains(DateCard);
  @field terms = contains(StringCard);
  @field invoiceDocument = contains(StringCard);
  @field memo = contains(TextAreaCard);
  @field title = contains(StringCard, {
    computeVia: function (this: Details) {
      return `Invoice ${this.invoiceNo}`;
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='details'>
        <div class='details__fields'>
          <FieldContainer @label='Invoice No.'><@fields.invoiceNo
            /></FieldContainer>
          <FieldContainer @label='Invoice Date'><@fields.invoiceDate
            /></FieldContainer>
          <FieldContainer @label='Due Date'><@fields.dueDate /></FieldContainer>
          <FieldContainer @label='Terms'><@fields.terms /></FieldContainer>
          <FieldContainer @label='Invoice Document'><@fields.invoiceDocument
            /></FieldContainer>
        </div>
        <FieldContainer @label='Memo'><@fields.memo /></FieldContainer>
      </div>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='details details--edit'>
        <div class='details__fields'>
          <FieldContainer @tag='label' @label='Invoice No.'><@fields.invoiceNo
            /></FieldContainer>
          <FieldContainer
            @tag='label'
            @label='Invoice Date'
          ><@fields.invoiceDate /></FieldContainer>
          <FieldContainer @tag='label' @label='Due Date'><@fields.dueDate
            /></FieldContainer>
          <FieldContainer @tag='label' @label='Terms'><@fields.terms
            /></FieldContainer>
          <FieldContainer
            @tag='label'
            @label='Invoice Document'
          ><@fields.invoiceDocument /></FieldContainer>
        </div>
        <FieldContainer
          @tag='label'
          @vertical={{true}}
          @label='Memo'
        ><@fields.memo /></FieldContainer>
      </div>
    </template>
  };
}

class LineItem extends Card {
  @field name = contains(StringCard);
  @field quantity = contains(NumberCard);
  @field amount = contains(NumberCard);
  @field description = contains(StringCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='line-item'>
        <div>
          <div><strong><@fields.name /></strong></div>
          <@fields.description />
        </div>
        <div class='line-item__qty'><@fields.quantity /></div>
        <div class='line-item__amount'>
          <strong>{{formatUSD @model.amount}}</strong>
        </div>
      </div>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='line-item--edit'>
        <div class='line-item__row'>
          <FieldContainer
            class='line-item__field'
            @tag='label'
            @label='Goods / Services Rendered'
            @vertical={{true}}
          ><@fields.name /></FieldContainer>
          <FieldContainer
            class='line-item__field'
            @tag='label'
            @label='Qty'
            @vertical={{true}}
          ><@fields.quantity /></FieldContainer>
          <FieldContainer
            class='line-item__field'
            @tag='label'
            @label='Amount'
            @vertical={{true}}
          ><@fields.amount /></FieldContainer>
        </div>
        <FieldContainer
          @tag='label'
          @label='Description'
          @vertical={{true}}
        ><@fields.description /></FieldContainer>
      </div>
    </template>
  };
}

class Note extends Card {
  @field text = contains(TextAreaCard);
  @field authorName = contains(StringCard); /* computed */
  @field authorImage = contains(StringCard); /* computed */
  @field timestamp = contains(DatetimeCard); /* computed */
  @field authorImageHref = contains(StringCard, {
    computeVia: function (this: Note) {
      return new URL(this.authorImage, import.meta.url).href;
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <Message
        @name={{@model.authorName}}
        @imgURL={{@model.authorImageHref}}
        @datetime={{@model.timestamp}}
      >
        <@fields.text />
      </Message>
    </template>
  };
}

class InvoiceTemplate extends Component<typeof InvoicePacket> {
  <template>
    <div class='invoice-template'>
      <section class='invoice'>
        <section>
          <h2>Title</h2>
          <@fields.title />
        </section>
        <section>
          <h2>Vendor</h2>
          <@fields.vendor />
        </section>
        <section>
          <h2>Details</h2>
          <@fields.details />
        </section>
        <section>
          <h2>Line Items</h2>
          <div class='line-items__title-row'>
            <Label>Goods / services rendered</Label>
            <Label>Qty</Label>
            <Label>Amount</Label>
          </div>
          <div class='line-items__rows'>
            <@fields.lineItems />
          </div>
        </section>
        <div class='payment'>
          <section>
            <h2>Payment Methods</h2>
            <div class='payment-methods'>
              <FieldContainer
                @label='Primary Payment Method'
                @vertical={{true}}
              >
                <div>
                  <@fields.primaryPayment />
                  {{#if @model.primaryPayment}}
                    <div class='payment-methods__bal'>{{balanceInCurrency
                        @model.balanceDue
                        @model.primaryPayment
                      }}</div>
                  {{/if}}
                </div>
              </FieldContainer>
              {{#if @model.alternatePayment.length}}
                <FieldContainer
                  @label='Alternate Payment Methods'
                  @vertical={{true}}
                >
                  <div>
                    {{#each @model.alternatePayment as |payment|}}
                      <div class='payment-method__item'>{{#if
                          payment.logoHref
                        }}<img src={{payment.logoHref}} />{{/if}}
                        {{payment.symbol}}</div>
                      <div class='payment-methods__bal'>{{balanceInCurrency
                          @model.balanceDue
                          payment
                        }}</div>
                    {{/each}}
                  </div>
                </FieldContainer>
              {{/if}}
            </div>
          </section>
          <FieldContainer
            @vertical={{true}}
            @label='Balance Due'
            class='balance-due'
          >
            <span class='balance-due__total'>
              {{formatUSD @model.balanceDue}}
            </span>
          </FieldContainer>
        </div>
      </section>
      {{#if @model.notes.length}}
        <section class='extras'>
          <section>
            <h2>Notes</h2>
            <div class='notes'>
              <@fields.notes />
            </div>
          </section>
        </section>
      {{/if}}
    </div>
  </template>
}

class EditTemplate extends Component<typeof InvoicePacket> {
  <template>
    <div class='invoice-template invoice-template--edit'>
      <section class='invoice'>
        <section>
          <h2>Vendor</h2>
          <@fields.vendor />
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
          <div class='payment-methods'>
            <FieldContainer
              @tag='label'
              @label='Primary Payment Method'
              @vertical={{true}}
            >
              <@fields.primaryPayment />
            </FieldContainer>
            <FieldContainer
              @tag='label'
              @label='Alternate Payment Methods'
              @vertical={{true}}
            >
              <@fields.alternatePayment />
            </FieldContainer>
          </div>
        </section>
        <FieldContainer
          @label='Balance Due'
          class='balance-due'
          @vertical={{true}}
        >
          <span class='balance-due__total'>
            {{formatUSD @model.balanceDue}}
          </span>
        </FieldContainer>
      </section>
    </div>
  </template>
}

export class InvoicePacket extends Card {
  static displayName = 'Invoice Packet';
  @field vendor = linksTo(Vendor);
  @field details = contains(Details);
  @field lineItems = containsMany(LineItem);
  @field primaryPayment = contains(Token || Currency, {
    computeVia: function (this: InvoicePacket) {
      return (
        this.vendor?.preferredPaymentMethod?.cryptoPayment?.token ??
        this.vendor?.preferredPaymentMethod?.wireTransfer?.currency
      );
    },
  });
  @field alternatePayment = containsMany(Token || Currency, {
    computeVia: function (this: InvoicePacket) {
      return [];
      // TODO: implementation below is not working
      // this is a computed containsMany field trying to read fields off of a `vendor` linksTo field
      // return this.vendor?.alternatePaymentMethod?.length ?  this.vendor.alternatePaymentMethod.map(p =>  p.cryptoPayment?.token ?? p.wireTransfer?.currency) : [];
    },
  });
  @field balanceDue = contains(NumberCard, {
    computeVia: function (this: InvoicePacket) {
      return this.lineItems.length === 0
        ? 0
        : this.lineItems
            .map((i) => i.amount * i.quantity)
            .reduce((a, b) => a + b);
    },
  });
  @field notes = containsMany(Note);

  static embedded = InvoiceTemplate;
  static isolated = InvoiceTemplate;
  static edit = EditTemplate;
}
