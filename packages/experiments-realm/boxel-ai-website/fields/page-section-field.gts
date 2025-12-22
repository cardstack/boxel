import {
  FieldDef,
  Component,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api'; // ¹
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import { SectionCard } from '../sections/section-card';

// Wraps section cards with metadata for layout orchestrator
export class PageSectionField extends FieldDef {
  static displayName = 'Page Section';

  @field sectionId = contains(StringField, {
    computeVia: function (this: PageSectionField) {
      return this.content?.sectionId;
    },
  });
  @field sectionNumber = contains(StringField, {
    computeVia: function (this: PageSectionField) {
      return this.content?.sectionNumber;
    },
  });
  @field sectionLabel = contains(StringField, {
    computeVia: function (this: PageSectionField) {
      return this.content?.sectionLabel;
    },
  });
  @field showInNav = contains(BooleanField, {
    computeVia: function () {
      return true;
    },
  });
  @field content = linksTo(SectionCard); // Polymorphic section card

  // Embedded template delegates to section's isolated format
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if @model.sectionId}}
        <div class='page-section-wrapper' id={{@model.sectionId}}>
          {{#if @model.content}}
            <@fields.content @format='isolated' />
          {{/if}}
        </div>
      {{/if}}
    </template>
  };
}
