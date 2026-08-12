import {
  FieldDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';

// cardstack/contracts — layer 02, Universal Value & Render Contracts.
//
// PASS 1. A number and a currency code, printed as written.
//
// This is not a good money field and the 0.1.0 says so out loud. It has no
// grouping separators, no symbol, no idea that JPY has no minor units and
// BHD has three, no accessible label, and exactly one format. Every one of
// those is a real defect and every one of them gets fixed by a later pass —
// which is the point of publishing it: the version history of this package
// is the history of the work, not a set of numbers applied to a finished
// thing afterwards.
//
// SELF-CONTAINED, from the first Version. Everything comes from the base
// realm — no boxel-ui, no siblings outside the pack — so `findEscapingImports`
// has nothing to report and the sealed map has nothing to pin. That is what
// makes a Version portable: it runs on any server that holds it.

export class MoneyField extends FieldDef {
  static displayName = 'Money';

  @field value = contains(NumberField);
  @field currency = contains(StringField);

  static embedded = class Embedded extends Component<typeof MoneyField> {
    <template>
      <span class='money'>
        {{@model.value}}
        {{@model.currency}}
        <span class='stamp'>cardstack/contracts 0.1.0</span>
      </span>
      <style scoped>
        .money {
          font-family: ui-monospace, monospace;
          color: #444;
        }
        .stamp {
          margin-left: 0.4em;
          font-family: ui-monospace, monospace;
          font-size: 0.65em;
          color: #99a;
          white-space: nowrap;
        }
      </style>
    </template>
  };
}
