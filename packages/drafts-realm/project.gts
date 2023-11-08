import { InvoicePacket as InvoicePacketCard } from './invoice-packet';
import NumberField from 'https://cardstack.com/base/number';
import DateCard from 'https://cardstack.com/base/date';
import StringField from 'https://cardstack.com/base/string';
import { Customer as CustomerCard } from './customer';
import { AmountField } from './asset';
import {
  contains,
  containsMany,
  linksTo,
  field,
  CardDef,
  FieldDef,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
class ResourceAllocation extends FieldDef {
  static displayName = 'ResourceAllocation';
  @field
  role = contains(StringField);
  @field
  dayRate = contains(AmountField);
  @field
  perDay = contains(NumberField);
}
export class Project extends CardDef {
  static displayName = 'Project';
  @field
  name = contains(StringField);
  @field
  customer = linksTo(CustomerCard);
  @field
  startDate = contains(DateCard);
  @field
  duration = contains(NumberField); // in days
  @field
  budget = contains(AmountField);
  @field
  description = contains(StringField);
  @field
  resourceAllocations = containsMany(ResourceAllocation);
  @field
  invoices = linksToMany(InvoicePacketCard);
  @field title = contains(StringField, {
    computeVia: function (this: Project) {
      return this.name;
    },
  });
  @field costEstimate = contains(AmountField, {
    computeVia: function (this: Project) {
      if (this.resourceAllocations.length === 0) {
        return undefined;
      }
      let estimateQuantity = this.resourceAllocations.reduce(
        (estimateSoFar, currentResourceAllocation) => {
          let quantityPerDay =
            currentResourceAllocation?.dayRate?.quantity || 0;
          return (
            estimateSoFar + quantityPerDay * currentResourceAllocation.perDay
          );
        },
        0,
      );
      let firstCurrency = this.resourceAllocations[0].dayRate.currency;
      return new AmountField({
        quantity: estimateQuantity,
        currency: firstCurrency,
      });
    },
  });
}
