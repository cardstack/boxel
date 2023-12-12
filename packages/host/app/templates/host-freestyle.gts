import Component from '@glimmer/component';

import FreestyleGuide from 'ember-freestyle/components/freestyle-guide';
import FreestyleSection from 'ember-freestyle/components/freestyle-section';

// @ts-expect-error no types
import { pageTitle } from 'ember-page-title';
import RouteTemplate from 'ember-route-template';

import SearchSheetUsage from '@cardstack/host/components/search-sheet/usage';

import formatComponentName from '../helpers/format-component-name';

interface UsageComponent {
  title: string;
  component: ComponentLike;
}

interface HostFreestyleSignature {
  Args: {};
}

class HostFreestyleComponent extends Component<HostFreestyleSignature> {
  formatComponentName = formatComponentName;

  get usageComponents() {
    return [['SearchSheet', SearchSheetUsage]].map(([name, c]) => {
      return {
        title: name,
        component: c,
      };
    }) as UsageComponent[];
  }

  <template>
    {{pageTitle 'Host Components'}}

    <h1 class='boxel-sr-only'>Boxel Host Components Documentation</h1>

    <FreestyleGuide
      @title='Boxel Host Components'
      @subtitle='Living Component Documentation'
    >
      <FreestyleSection
        @name='Components'
        class='freestyle-components-section'
        as |Section|
      >
        {{#each this.usageComponents as |c|}}
          <Section.subsection @name={{this.formatComponentName c.title}}>
            <c.component />
          </Section.subsection>
        {{/each}}
      </FreestyleSection>
    </FreestyleGuide>
  </template>
}

export default RouteTemplate(HostFreestyleComponent);
