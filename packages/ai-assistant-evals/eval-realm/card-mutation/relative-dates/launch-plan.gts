import { CardDef, contains, field } from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import DateTimeField from '@cardstack/base/datetime';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

const DAY_MS = 24 * 60 * 60 * 1000;

export class LaunchPlan extends CardDef {
  static displayName = 'Launch Plan';
  @field product = contains(StringField);
  @field owner = contains(StringField);
  @field budget = contains(NumberField);
  @field kickoff = contains(DateField);
  @field designFreeze = contains(DateField);
  @field betaStart = contains(DateField);
  @field launchDate = contains(DateField);
  @field launchEvent = contains(DateTimeField);
  @field retro = contains(DateField);
  @field daysToLaunch = contains(NumberField, {
    computeVia: function (this: LaunchPlan) {
      if (!this.kickoff || !this.launchDate) {
        return undefined;
      }
      return Math.round(
        (this.launchDate.getTime() - this.kickoff.getTime()) / DAY_MS,
      );
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: LaunchPlan) {
      return `${this.product ?? 'Untitled'} launch`;
    },
  });
}
