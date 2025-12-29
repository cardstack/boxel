import {
  FieldDef,
  Component,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';

import { dasherize } from '@cardstack/boxel-ui/helpers';

import { SectionCard } from '../sections/section-card';

// Wraps section cards with metadata for layout orchestrator
export class PageSectionField extends FieldDef {
  static displayName = 'Page Section';

  @field sectionId = contains(StringField, {
    description: 'Used as anchor link id',
    computeVia: function (this: PageSectionField) {
      return [this.sectionNumber, this.sectionLabel]
        .filter(Boolean)
        .map(dasherize)
        .join('-');
    },
  });
  @field sectionNumber = contains(StringField, {
    description: 'For dropdown display',
  });
  @field sectionLabel = contains(StringField, {
    description: 'For dropdown display',
  });
  @field showInNav = contains(BooleanField, {
    description: 'Whether page should appear in section dropdown in nav item',
  });
  @field content = linksTo(SectionCard); // Polymorphic section card

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div id={{@model.sectionId}} class='page-section-embedded'>
        <@fields.content
          class='page-section-content'
          @format='isolated'
          @displayContainer={{false}}
        />
      </div>
      <style scoped>
        .page-section-embedded {
          scroll-margin-top: 2rem;
        }
        .page-section-content {
          background: none;
        }
      </style>
    </template>
  };
}
