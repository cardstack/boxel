import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';

import { dayjsFormat } from '@cardstack/boxel-ui/helpers';
import { CardContainer } from '@cardstack/boxel-ui/components';

import { BrandTheme as Theme, sanitize } from './theme';

export class ThemedInvoice extends CardDef {
  static displayName = 'Themed Invoice';

  // Basic invoice information
  @field invoiceNumber = contains(StringField);
  @field issueDate = contains(DateField);
  @field dueDate = contains(DateField);
  @field amount = contains(NumberField);
  @field cardDescription = contains(StringField);

  // Theme configuration
  @field currentTheme = linksTo(Theme);

  // Customer information
  @field customerName = contains(StringField);
  @field customerEmail = contains(StringField);
  @field customerAddress = contains(StringField);

  // Company information
  @field companyName = contains(StringField);
  @field companyEmail = contains(StringField);
  @field companyAddress = contains(StringField);

  static isolated = class Isolated extends Component<typeof ThemedInvoice> {
    <template>
      <div
        class='themed-invoice-container'
        style={{sanitize @model.currentTheme.cssVariables}}
      >
        <CardContainer>
          <div class='themed-invoice'>
            <header>
              <div class='logo-container'>
                <img
                  src={{@model.currentTheme.logoURL}}
                  alt={{@model.currentTheme.brand}}
                  class='brand-logo'
                />
              </div>
              <div class='invoice-label'>INVOICE</div>
            </header>

            <div class='invoice-info'>
              <div class='invoice-number'>
                <span class='label'>Invoice #:</span>
                <span class='value'>{{@model.invoiceNumber}}</span>
              </div>
              <div class='invoice-date'>
                <span class='label'>Issue Date:</span>
                <span class='value'>{{dayjsFormat
                    @model.issueDate
                    'MMMM D, YYYY'
                  }}</span>
              </div>
              <div class='invoice-due'>
                <span class='label'>Due Date:</span>
                <span class='value'>{{dayjsFormat
                    @model.dueDate
                    'MMMM D, YYYY'
                  }}</span>
              </div>
            </div>

            <div class='parties'>
              <div class='from-section'>
                <h3>From</h3>
                <div class='company-name'>{{@model.companyName}}</div>
                <div class='company-email'>{{@model.companyEmail}}</div>
                <div class='company-address'>{{@model.companyAddress}}</div>
              </div>

              <div class='to-section'>
                <h3>To</h3>
                <div class='customer-name'>{{@model.customerName}}</div>
                <div class='customer-email'>{{@model.customerEmail}}</div>
                <div class='customer-address'>{{@model.customerAddress}}</div>
              </div>
            </div>

            <div class='invoice-description'>
              <h3>Description</h3>
              <p>{{@model.cardDescription}}</p>
            </div>

            <div class='invoice-total'>
              <div class='total-label'>Total Due</div>
              <div class='total-amount'>$ {{@model.amount}}</div>
            </div>

            <footer>
              <div class='pattern-background'></div>
              <div class='brand-message'>
                Thank you for choosing
                {{@model.currentTheme.brand}}. All payments are due within 30
                days.
              </div>
              <div class='symbol-container'>
                <img
                  src={{@model.currentTheme.symbolURL}}
                  alt='{{@model.currentTheme.brand}} Symbol'
                  class='brand-symbol'
                />
              </div>
            </footer>
          </div>
        </CardContainer>
      </div>

      <style scoped>
        /* Base styles for the invoice */
        .themed-invoice {
          font-family: var(--font-family-base);
          line-height: var(--lineheight-base);
          background-color: var(--color-light);
          color: var(--color-dark);
          border-radius: var(--radius-base);
          padding: calc(var(--spacing-unit) * 4);
          max-width: 800px;
          margin: 0 auto;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }

        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: calc(var(--spacing-unit) * 4);
          padding-bottom: calc(var(--spacing-unit) * 2);
          border-bottom: 2px solid var(--color-primary);
        }

        .brand-logo {
          height: calc(var(--logo-min-height-digital) * 2);
          max-width: 200px; /* Increased to accommodate larger logo */
          margin-right: calc(
            var(--spacing-unit) * 2
          ); /* Keeps spacing consistent */
        }

        .invoice-label {
          font-size: var(--typescale-h1);
          font-weight: bold;
          color: var(--color-primary);
        }

        .invoice-info {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: calc(var(--spacing-unit) * 2);
          margin-bottom: calc(var(--spacing-unit) * 4);
          padding: calc(var(--spacing-unit) * 2);
          background-color: var(--color-background);
          border-radius: var(--radius-base);
        }

        .label {
          font-weight: bold;
          display: block;
          font-size: 14px;
          color: var(--color-primary);
        }

        .value {
          font-size: var(--typescale-body);
        }

        .parties {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: calc(var(--spacing-unit) * 4);
          margin-bottom: calc(var(--spacing-unit) * 4);
        }

        .from-section,
        .to-section {
          padding: calc(var(--spacing-unit) * 2);
          border-radius: var(--radius-base);
          background-color: rgba(var(--color-background-rgb, 0, 0, 0), 0.05);
        }

        h3 {
          color: var(--color-primary);
          font-size: 18px;
          margin-top: 0;
          margin-bottom: calc(var(--spacing-unit));
          border-bottom: 1px solid var(--color-secondary);
          padding-bottom: calc(var(--spacing-unit) / 2);
        }

        .invoice-description {
          margin-bottom: calc(var(--spacing-unit) * 4);
          padding: calc(var(--spacing-unit) * 2);
          border-radius: var(--radius-base);
          background-color: rgba(var(--color-background-rgb, 0, 0, 0), 0.05);
        }

        .invoice-total {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: calc(var(--spacing-unit) * 4);
          padding: calc(var(--spacing-unit) * 2);
          background-color: var(--color-primary);
          color: var(--color-light);
          border-radius: var(--radius-base);
        }

        .total-label {
          font-size: 18px;
          font-weight: bold;
        }

        .total-amount {
          font-size: 24px;
          font-weight: bold;
        }

        footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: calc(var(--spacing-unit) * 4);
          padding-top: calc(var(--spacing-unit) * 2);
          border-top: 2px solid var(--color-primary);
          position: relative;
        }

        .pattern-background {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: url(var(--pattern-background-url));
          background-size: 200px;
          background-repeat: repeat;
          opacity: 0.05;
          z-index: -1;
        }

        .brand-message {
          font-size: 14px;
          font-style: italic;
          color: var(--color-dark);
          max-width: 70%;
        }

        .brand-symbol {
          height: 40px;
          width: auto;
        }
      </style>
    </template>
  };
}
