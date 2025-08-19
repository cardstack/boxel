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
import Themes, { type Theme } from '../themes/index';
import IconsGrid from '../components/icons-grid';

import {
  BoxelSelect,
  FieldContainer,
  Switch,
  BoxelContainer,
} from '@cardstack/boxel-ui/components';

import formatComponentName from '../helpers/format-component-name';

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
      <BoxelContainer @display='flex'>
        <FieldContainer @label='Theme' @tag='label'>
          <BoxelSelect
            class='theme-selector'
            @placeholder='Select Theme'
            @selected={{this.theme}}
            @options={{this.themes}}
            @onChange={{this.selectTheme}}
            as |theme|
          >
            {{theme.name}}
          </BoxelSelect>
        </FieldContainer>
        <FieldContainer @label='Cycle Themes' @tag='label'>
          <Switch
            @label='Cycle Themes'
            @isEnabled={{this.isCycleThemesEnabled}}
            @onChange={{this.enableThemeCycles}}
          />
        </FieldContainer>
      </BoxelContainer>

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
      .theme-selector {
        min-width: 10rem;
      }
      .FreestyleUsage {
        --radius: var(--boxel-border-radius);
        --border-color: var(--boxel-border-color);
      }
    </style>
  </template>

  private themes: Theme[] = [{ name: '<None>' }, ...Themes];
  private usageComponents = ALL_USAGE_COMPONENTS.map(([name, c]) => {
    return {
      title: name,
      component: c,
    };
  }) as UsageComponent[];

  @service private declare router: RouterService;

  @tracked private theme?: Theme;
  @tracked private isCycleThemesEnabled = false;

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    let queryParams = this.router?.currentRoute?.queryParams;
    if (!queryParams) {
      return;
    }
    let { cycleThemes, theme } = queryParams;

    if (cycleThemes === 'true') {
      this.isCycleThemesEnabled = true;
      let currentTheme = this.themes.find((t) => t.name === theme);
      if (!currentTheme) {
        this.selectTheme(this.themes[1]);
      } else {
        let index = this.themes.indexOf(currentTheme);
        let nextIndex = index === this.themes.length - 1 ? 1 : index + 1;
        this.selectTheme(this.themes[nextIndex]);
      }
      return;
    }

    if (!theme) {
      return;
    }
    let currentTheme = this.themes.find((t) => t.name === theme);
    this.selectTheme(currentTheme);
  }

  @action private selectTheme(theme?: Theme) {
    this.theme = theme?.styles ? theme : undefined;
    this.router.replaceWith('index', {
      queryParams: { theme: this.theme?.name },
    });
  }

  @action private enableThemeCycles() {
    this.isCycleThemesEnabled = !this.isCycleThemesEnabled;
    this.router.replaceWith('index', {
      queryParams: {
        cycleThemes: this.isCycleThemesEnabled === true ? true : null,
      },
    });
  }
}

export default RouteTemplate(IndexComponent);
