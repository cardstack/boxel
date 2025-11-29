import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
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
            @onChange={{this.toggleCycling}}
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
        font-size: var(--boxel-body-font-size, 0.875rem);
        line-height: var(--boxel-body-line-height, calc(18 / 13));
      }
      .theme-selector {
        min-width: 10rem;
      }
      .FreestyleUsageCssVar-name {
        width: 40%;
      }
      .FreestyleUsage-preview {
        --radius: var(--theme-radius, var(--boxel-border-radius));

        color: var(--foreground, var(--boxel-dark));
        background-color: var(--background, var(--boxel-light));
        border-radius: 4px;
      }
    </style>
  </template>

  private intervalId?: NodeJS.Timeout;
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

    let currentTheme = this.themes.find((t) => t.name === theme);
    this.selectTheme(currentTheme);

    if (cycleThemes === 'true') {
      this.isCycleThemesEnabled = true;
      this.maybeCycleThemes();
    }
  }

  @action private selectTheme(theme?: Theme) {
    this.theme = theme;
    this.router.replaceWith('index', {
      queryParams: { theme: this.theme?.name },
    });
  }

  @action private toggleCycling() {
    this.isCycleThemesEnabled = !this.isCycleThemesEnabled;
    this.router.replaceWith('index', {
      queryParams: {
        cycleThemes: this.isCycleThemesEnabled === true ? true : null,
      },
    });
    this.maybeCycleThemes();
  }

  @action private maybeCycleThemes() {
    if (this.isCycleThemesEnabled) {
      let index = this.theme ? this.themes.indexOf(this.theme) : 0;
      this.cycleThemes(index + 1);
    } else {
      clearInterval(this.intervalId);
    }
  }

  private cycleThemes = (i = 0) => {
    this.intervalId = setInterval(() => {
      if (i >= this.themes.length) {
        i = 0;
      }
      this.selectTheme(this.themes[i]);
      i++;
    }, 2000);
  };
}

export default RouteTemplate(IndexComponent);
