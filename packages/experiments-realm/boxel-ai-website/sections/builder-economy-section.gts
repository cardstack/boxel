import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Section } from '../components/section';
import { SectionCard } from './section-card';

class SellableTypeField extends FieldDef {
  static displayName = 'Sellable Type';

  @field typeIcon = contains(StringField);
  @field typeLabel = contains(StringField);
  @field typeDescription = contains(StringField);
  @field accentColor = contains(StringField);
}

class PublishingStepField extends FieldDef {
  static displayName = 'Publishing Step';

  @field stepIcon = contains(StringField);
  @field stepLabel = contains(StringField);
  @field stepDescription = contains(StringField);
}

export class BuilderEconomySection extends SectionCard {
  static displayName = 'Builder Economy Section';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field oldWayHeadline = contains(StringField);
  @field oldWayBody = contains(StringField);
  @field newWayHeadline = contains(StringField);
  @field newWayBody = contains(StringField);
  @field newWayBullets = containsMany(StringField);
  @field generateCostRange = contains(StringField);
  @field remixCostRange = contains(StringField);
  @field sellableTypes = containsMany(SellableTypeField);
  @field publishingSteps = containsMany(PublishingStepField);
  @field footerHeadline = contains(StringField);
  @field footerBody = contains(StringField);

  /** Template Features:
   * Two-column: old way vs new way text + cost comparison card
   * Cost comparison with red/green styling
   * Two-way economy card with sellable types + publishing flow
   */

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <Section as |s|>
        <s.Header
          class='section-layout-row'
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        />
      </Section>
    </template>
  };
}
