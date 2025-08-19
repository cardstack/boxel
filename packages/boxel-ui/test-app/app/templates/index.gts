import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { ComponentLike } from '@glint/template';
import { tracked } from '@glimmer/tracking';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

import BasicDropdownWormhole from 'ember-basic-dropdown/components/basic-dropdown';

import FreestyleGuide from 'ember-freestyle/components/freestyle-guide';
import FreestyleSection from 'ember-freestyle/components/freestyle-section';
import { pageTitle } from 'ember-page-title';
import RouteTemplate from 'ember-route-template';

import { ALL_USAGE_COMPONENTS } from '@cardstack/boxel-ui/usage';
import Themes from '../themes/index';
import IconsGrid from '../components/icons-grid';

import { BoxelSelect, FieldContainer } from '@cardstack/boxel-ui/components';

import formatComponentName from '../helpers/format-component-name';

interface Theme {
  name: string;
  styles?: string;
}

interface UsageComponent {
  title: string;
  component: ComponentLike;
}

class IndexComponent extends Component {
  <template>
    {{pageTitle 'Boxel Components'}}
    <BasicDropdownWormhole />

    <h1 class='boxel-sr-only'>Boxel Components Documentation</h1>
    <FreestyleGuide
      class='boxel-freestyle-guide'
      @title='Boxel UI Components'
      @subtitle='Living Component Documentation'
      style={{this.theme.styles}}
    >
      <FieldContainer class='theme-select' @label='Current Theme' @tag='label'>
        <BoxelSelect
          @placeholder='Select Theme'
          @selected={{this.theme}}
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

  themes: Theme[] = [{ name: '<None Selected>' }, ...Themes];
  usageComponents = ALL_USAGE_COMPONENTS.map(([name, c]) => {
    return {
      title: name,
      component: c,
    };
  }) as UsageComponent[];

  @service declare router: RouterService;

  @tracked theme?: Theme;

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    let themeName = this.router?.currentRoute?.queryParams?.theme;
    if (!themeName) {
      return;
    }
    this.theme = this.themes.find((t) => t.name === themeName);
  }

  @action selectTheme(theme: Theme) {
    this.theme = theme?.styles ? theme : undefined;
    this.router.replaceWith('index', {
      queryParams: { theme: this.theme?.name },
    });
  }
}

export default RouteTemplate(IndexComponent);
