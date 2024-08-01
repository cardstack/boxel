import { CrmAccount } from '../account';
import {
  CardDef,
  FieldDef,
  StringField,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import DatetimeField from 'https://cardstack.com/base/datetime';
import NumberField from 'https://cardstack.com/base/number';
import { LeadForm } from './lead';
import { Currency } from '../../asset';

class OpportunityStage extends FieldDef {
  // Qualify: Determine if the potential customer has a need for your product or service, and if they are ready to buy.
  // Negotiate: Discuss terms, prices, and conditions after identifying a mutual interest.
  // Meet & Present: Engage directly with the potential customer to present your solution.
  // Closed Won: The stage where the deal is successfully completed, and the sale is made.
  // Closed Lost: The opportunity did not result in a sale and is considered lost.
  stages = [
    { code: 1, displayName: 'Qualify' },
    { code: 2, displayName: 'Negotiate' },
    { code: 3, displayName: 'Meet & Present' },
    { code: 4, displayName: 'Closed Won' },
    { code: 5, displayName: 'Closed Lost' },
  ];
  @field stage = contains(StringField);
}

//less granular to group than opportunity stage
class ForecastCategory extends FieldDef {
  // Omitted: Excludes the opportunity from forecasts, often used for lost or inactive deals.
  // Pipeline: Opportunities that are in the early stages, indicating potential future sales.
  // Best Case: Opportunities that are more likely to close, beyond just being in the pipeline.
  // Commit: Highly likely to close, where the sales team commits to the forecast.
  // Closed: The opportunity has either been won or lost.
  statuses = [
    { code: 1, displayName: 'Omitted' },
    { code: 2, displayName: 'Pipeline' },
    { code: 3, displayName: 'Best Case' },
    { code: 4, displayName: 'Commit' },
    { code: 5, displayName: 'Closed' },
  ];
  @field status = contains(StringField);
}

class PercentField extends NumberField {
  //validation for percentage
}

class OpportunityStatus extends FieldDef {
  @field stage = contains(OpportunityStage);
  @field probability = contains(PercentField); //ai generate probablitly
  @field forecastCategory = contains(ForecastCategory);
}

export class Opportunity extends CardDef {
  static displayName = 'Crm Opportunity';
  @field name = contains(StringField);
  @field account = linksTo(CrmAccount);
  @field closeDate = contains(DatetimeField);
  @field status = contains(OpportunityStatus);
  @field leadSource = linksTo(LeadForm);
  @field amount = linksTo(Currency);
}
