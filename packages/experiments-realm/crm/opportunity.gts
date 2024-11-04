import {
  contains,
  field,
  CardDef,
  FieldDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';

import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import { WebUrl } from 'https://cardstack.com/base/web-url';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { CrmAccount } from './account';
import { MatrixUser } from '../matrix-user';

export class Opportunity extends CardDef {
  static displayName = 'Crm Opportunity';
  @field name = contains(StringField);
  @field owner = linksTo(MatrixUser);
  @field account = linksTo(CrmAccount);
  @field closeDate = contains(DatetimeField);
  @field status = contains(OpportunityStatus);
  @field leadSource = linksTo(Lead);
  @field amount = linksTo(Currency);
}

class OpportunityStage extends FieldDef {
  // Qualify: Determine if the potential customer has a need for your product or service, and if they are ready to buy.
  // Negotiate: Discuss terms, prices, and conditions after identifying a mutual interest.
  // Meet & Present: Engage directly with the potential customer to present your solution.
  // Closed Won: The stage where the deal is successfully completed, and the sale is made.
  // Closed Lost: The opportunity did not result in a sale and is considered lost.
}

class OpportunityStatus extends FieldDef {
  @field stage = contains(OpportunityStage);
  @field probability = contains(PercentField);
  @field forecastCategory = contains(ForecastCategory);
}
class ForecastCategory extends FieldDef {
  // Omitted: Excludes the opportunity from forecasts, often used for lost or inactive deals.
  // Pipeline: Opportunities that are in the early stages, indicating potential future sales.
  // Best Case: Opportunities that are more likely to close, beyond just being in the pipeline.
  // Commit: Highly likely to close, where the sales team commits to the forecast.
  // Closed: The opportunity has either been won or lost.
}

class PercentField extends NumberField {
  //validation for percentage
}

class Lead extends CardDef {}

class Currency extends CardDef {
  @field tickSymbol = contains(StringField);
  @field amount = contains(NumberField);
  @field logoURL = contains(WebUrl);
}
