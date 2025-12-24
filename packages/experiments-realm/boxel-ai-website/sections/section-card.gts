import {
  Component,
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';

import { dasherize } from '@cardstack/boxel-ui/helpers';

import { Section } from '../components/section';

// Base class for all section cards
export class SectionCard extends CardDef {
  static displayName = 'Section';

  @field sectionId = contains(StringField, {
    computeVia: function (this: SectionCard) {
      return dasherize(this.headerLabel?.replace(' - ', ' '));
    },
  });
  @field sectionNumber = contains(StringField);
  @field sectionLabel = contains(StringField);
  @field showInNav = contains(BooleanField, {
    computeVia: function () {
      return true;
    },
  });
  @field headerLabel = contains(StringField, {
    computeVia: function (this: SectionCard) {
      return [this.sectionNumber, this.sectionLabel]
        .filter(Boolean)
        .join(' - ');
    },
  });

  // Subclasses override with their own isolated template
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <Section id={{@model.sectionId}} class='section'>
        <div class='section-content'>
          {{! Override in subclass }}
        </div>
      </Section>
    </template>
  };
}
