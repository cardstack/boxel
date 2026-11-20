import {
  CardDef,
  FieldDef,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

export class ProductTypeSales extends FieldDef {
  static displayName = 'Product Type Sales';
  @field productType = contains(StringField);
  @field units = contains(NumberField);
  // In USD.
  @field revenue = contains(NumberField);
}

export class CustomerSpend extends FieldDef {
  static displayName = 'Customer Spend';
  @field name = contains(StringField);
  @field email = contains(StringField);
  @field orders = contains(NumberField);
  // In USD.
  @field spend = contains(NumberField);
}

export class SalesReport extends CardDef {
  static displayName = 'Sales Report';
  // The month the report covers, such as "October 2026".
  @field period = contains(StringField);
  @field paidOrders = contains(NumberField);
  @field unitsSold = contains(NumberField);
  // In USD.
  @field revenue = contains(NumberField);
  @field productTypes = containsMany(ProductTypeSales);
  @field topCustomers = containsMany(CustomerSpend);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: SalesReport) {
      return this.period ? `Sales report: ${this.period}` : 'Sales report';
    },
  });
}
