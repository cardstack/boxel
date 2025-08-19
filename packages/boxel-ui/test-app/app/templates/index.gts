import { action } from '@ember/object';
import Component from '@glimmer/component';
import { ComponentLike } from '@glint/template';
import { tracked } from '@glimmer/tracking';

import BasicDropdownWormhole from 'ember-basic-dropdown/components/basic-dropdown';

import FreestyleGuide from 'ember-freestyle/components/freestyle-guide';
import FreestyleSection from 'ember-freestyle/components/freestyle-section';
import { pageTitle } from 'ember-page-title';
import RouteTemplate from 'ember-route-template';

import { ALL_USAGE_COMPONENTS } from '@cardstack/boxel-ui/usage';
import THEMES from '../themes/index.ts';
import IconsGrid from '../components/icons-grid';

import { BoxelSelect, FieldContainer } from '@cardstack/boxel-ui/components';
import {
  extractCssVariables,
  styleConversions,
} from '@cardstack/boxel-ui/helpers';

import formatComponentName from '../helpers/format-component-name';

interface Theme {
  name: string;
  styles?: string;
}

interface UsageComponent {
  title: string;
  component: ComponentLike;
}

interface HostFreestyleSignature {
  Args: {};
}

function getThemeStyles(cssString: string) {
  if (!extractCssVariables) {
    return;
  }
  return styleConversions + extractCssVariables(cssString);
}

class IndexComponent extends Component<HostFreestyleSignature> {
  <template>
    {{pageTitle 'Boxel Components'}}
    <BasicDropdownWormhole />

    <h1 class='boxel-sr-only'>Boxel Components Documentation</h1>
    <FreestyleGuide
      class='boxel-freestyle-guide'
      @title='Boxel UI Components'
      @subtitle='Living Component Documentation'
      style={{this.currentTheme.styles}}
    >
      <FieldContainer class='theme-select' @label='Current Theme' @tag='label'>
        <BoxelSelect
          @placeholder='Select Theme'
          @selected={{this.currentTheme}}
          @options={{this.themes}}
          @onChange={{this.selectTheme}}
          as |theme|
        >
          {{theme.name}}
        </BoxelSelect>
      </FieldContainer>

      <FreestyleSection
        @name='Components'
        class='freestyle-components-section'
        as |Section|
      >
        {{#each this.usageComponents as |c|}}
          <Section.subsection @name={{formatComponentName c.title}}>
            <c.component />
          </Section.subsection>
        {{/each}}
      </FreestyleSection>
      <FreestyleSection
        @name='boxel-icons'
        class='freestyle-components-section'
      >
        <IconsGrid />
      </FreestyleSection>
    </FreestyleGuide>
    <style scoped>
      .boxel-freestyle-guide {
        color: var(--foreground, var(--boxel-dark));
        font-family: var(--font-sans, var(--boxel-font-family));
        background-color: var(--background, var(--boxel-light));
        font-size: var(--typescale-body, 13px);
        line-height: var(--lineheight-base, calc(18 / 13));
      }
      .theme-select {
        max-width: 500px;
        padding: 1rem;
      }
      .FreestyleUsage {
        --radius: var(--boxel-border-radius);
        --border-color: var(--boxel-border-color);
      }
    </style>
  </template>

  themes: Theme[] = [
    { name: '<None Selected>' },
    ...Object.entries(THEMES).map(([name, vars]) => ({
      name,
      styles: getThemeStyles(vars),
    })),
  ];
  usageComponents = ALL_USAGE_COMPONENTS.map(([name, c]) => {
    return {
      title: name,
      component: c,
    };
  }) as UsageComponent[];

  @tracked currentTheme?: Theme;

  @action selectTheme(theme: Theme) {
    this.currentTheme = theme?.styles ? theme : undefined;
  }
}

export default RouteTemplate(IndexComponent);
