import {
  contains,
  containsMany,
  linksTo,
  field,
  CardDef,
  FieldDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import DateCard from 'https://cardstack.com/base/date';
import DatetimeCard from 'https://cardstack.com/base/datetime';
import NumberCard from 'https://cardstack.com/base/number';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import { Vendor } from './vendor';
import { formatUSD, balanceInCurrency } from './currency-format';
import { FieldContainer, Label, Message } from '@cardstack/boxel-ui/components';

import { TokenField, CurrencyField } from './asset';
import GlimmerComponent from '@glimmer/component';

class Details extends FieldDef {
  static displayName = 'Details';
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
      <DetailsContainer>
        <DetailsFieldsContainer>
          <FieldContainer @label='Invoice No.'><@fields.invoiceNo
            /></FieldContainer>
          <FieldContainer @label='Invoice Date'><@fields.invoiceDate
            /></FieldContainer>
          <FieldContainer @label='Due Date'><@fields.dueDate /></FieldContainer>
          <FieldContainer @label='Terms'><@fields.terms /></FieldContainer>
          <FieldContainer @label='Invoice Document'><@fields.invoiceDocument
            /></FieldContainer>
        </DetailsFieldsContainer>
        <FieldContainer @label='Memo'><@fields.memo /></FieldContainer>
      </DetailsContainer>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <DetailsContainer class='edit'>
        <DetailsFieldsContainer>
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
        </DetailsFieldsContainer>
        <FieldContainer
          @tag='label'
          @vertical={{true}}
          @label='Memo'
        ><@fields.memo /></FieldContainer>
      </DetailsContainer>
      <style>
        .edit {
          padding: var(--boxel-sp);
        }
      </style>
    </template>
  };
}

interface GenericContainerSignature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

class DetailsContainer extends GlimmerComponent<GenericContainerSignature> {
  <template>
    <div class='details' ...attributes>
      {{yield}}
    </div>
    <style>
      .details {
        --boxel-field-label-size: 35%;
        --boxel-field-label-align: center;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

class DetailsFieldsContainer extends GlimmerComponent<GenericContainerSignature> {
  <template>
    <div class='fields' ...attributes>
      {{yield}}
    </div>
    <style>
      .fields {
        display: grid;
        grid-gap: var(--boxel-sp) 0;
      }
    </style>
  </template>
}

class LineItem extends FieldDef {
  static displayName = 'LineItem';
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
        <div class='qty'><@fields.quantity /></div>
        <div class='amount'>
          <strong>{{formatUSD @model.amount}}</strong>
        </div>
      </div>
      <style>
        .line-item {
          display: grid;
          grid-template-columns: 3fr 1fr 2fr;
        }

        .qty {
          justify-self: center;
        }

        .amount {
          justify-self: end;
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='edit'>
        <div class='row'>
          <FieldContainer
            @tag='label'
            @label='Goods / Services Rendered'
            @vertical={{true}}
          ><@fields.name /></FieldContainer>
          <FieldContainer
            @tag='label'
            @label='Qty'
            @vertical={{true}}
          ><@fields.quantity /></FieldContainer>
          <FieldContainer
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
      <style>
        .edit {
          display: grid;
          gap: var(--boxel-sp-sm);
        }

        .row {
          display: grid;
          grid-template-columns: 3fr 1fr 2fr;
          gap: var(--boxel-sp);
          align-items: end;
        }
      </style>
    </template>
  };
}

class Note extends FieldDef {
  static displayName = 'Note';
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
    <InvoiceContainer>
      <:default>
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
            <PaymentMethodsContainer>
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
            </PaymentMethodsContainer>
          </section>
          <BalanceDue @balanceDue={{@model.balanceDue}} />
        </div>
      </:default>
      <:extras>
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
      </:extras>
    </InvoiceContainer>
    <style>
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

      .extras {
        padding: var(--boxel-sp-xl);
        background-color: var(--boxel-100);
      }

      .notes,
      .history {
        --boxel-border-radius: 20px;
      }

      .notes > * + *,
      .history > * + * {
        margin-top: var(--boxel-sp);
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--boxel-200);
      }
    </style>
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
          <PaymentMethodsContainer>
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
          </PaymentMethodsContainer>
        </section>
        <BalanceDue @balanceDue={{@model.balanceDue}} />
      </section>
    </div>
  </template>
}

interface InvoiceContainerSignature {
  Element: HTMLElement;
  Blocks: {
    default: [];
    extras: [];
  };
}

class InvoiceContainer extends GlimmerComponent<InvoiceContainerSignature> {
  <template>
    <div class='invoice-template' ...attributes>
      <section class='invoice'>
        {{yield}}
      </section>
      {{yield to='extras'}}
    </div>
    <style>
      .invoice-template {
        max-width: 50rem;
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        overflow: hidden;
      }

      .invoice-template :deep(h2) {
        margin-top: 0;
        margin-bottom: var(--boxel-sp);
        font: 700 var(--boxel-font);
      }

      .invoice {
        padding: var(--boxel-sp-lg);
        display: grid;
        gap: var(--boxel-sp-xxl) 0;
      }
    </style>
  </template>
}

class PaymentMethodsContainer extends GlimmerComponent<GenericContainerSignature> {
  <template>
    <div class='payment-methods'>
      {{yield}}
    </div>
    <style>
      .payment-methods {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0 var(--boxel-sp-xs);
      }
    </style>
  </template>
}

interface BalanceDueSignature {
  Element: HTMLElement;
  Args: {
    balanceDue?: number;
  };
}

class BalanceDue extends GlimmerComponent<BalanceDueSignature> {
  <template>
    <FieldContainer @label='Balance Due' class='balance-due' @vertical={{true}}>
      <span class='total'>
        {{formatUSD @balanceDue}}
      </span>
    </FieldContainer>
    <style>
      .balance-due {
        justify-items: end;
        text-align: right;
      }

      .total {
        font: 700 var(--boxel-font-lg);
      }
    </style>
  </template>
}

export class InvoicePacket extends CardDef {
  static displayName = 'Invoice Packet';
  @field vendor = linksTo(Vendor);
  @field details = contains(Details);
  @field lineItems = containsMany(LineItem);
  @field primaryPayment = contains(TokenField || CurrencyField, {
    computeVia: function (this: InvoicePacket) {
      return (
        this.vendor?.preferredPaymentMethod?.cryptoPayment?.token ??
        this.vendor?.preferredPaymentMethod?.wireTransfer?.currency
      );
    },
  });
  @field alternatePayment = containsMany(TokenField || CurrencyField, {
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
