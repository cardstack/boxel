import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';

import { dasherize } from '@cardstack/boxel-ui/helpers';

// Base class for all section cards
export class SectionCard extends CardDef {
  static displayName = 'Section';

  @field sectionId = contains(StringField, {
    computeVia: function (this: SectionCard) {
      return [this.sectionNumber, this.sectionLabel]
        .filter(Boolean)
        .map(dasherize)
        .join('-');
    },
  });
  @field sectionNumber = contains(StringField);
  @field sectionLabel = contains(StringField);
  @field showInNav = contains(BooleanField, {
    computeVia: function () {
      return true;
    },
  });

  // Subclasses override with their own isolated template
  // static isolated = class Isolated extends Component<typeof this> {
  //   <template>
  //     <section id={{@model.sectionId}} class='section'>
  //       <div class='section-content'>
  //         {{! Override in subclass }}
  //       </div>
  //     </section>
  //   </template>
  // };
}
