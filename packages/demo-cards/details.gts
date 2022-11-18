import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import DateCard from 'https://cardstack.com/base/date';
import { initStyleSheet, attachStyles } from 'https://cardstack.com/base/attach-styles';

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

export class Details extends Card {
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