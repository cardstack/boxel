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
  CardContainer,
  BoxelSelect,
  CopyButton,
  FieldContainer,
  Switch,
  BoxelContainer,
} from '@cardstack/boxel-ui/components';

import formatComponentName from '../helpers/format-component-name';

interface UsageComponent {
  title: string;
  component: ComponentLike;
  importStatement: string;
}

// A handful of usage titles differ from the name the component is exported as.
const EXPORT_NAME_OVERRIDES: Record<string, string> = {
  Container: 'BoxelContainer',
  Dropdown: 'BoxelDropdown',
  Input: 'BoxelInput',
  InputGroup: 'BoxelInputGroup',
  MultiSelect: 'BoxelMultiSelect',
  Select: 'BoxelSelect',
  Tag: 'BoxelTag',
  EntityIconDisplay: 'EntityDisplayWithIcon',
  EntityThumbnailDisplay: 'EntityDisplayWithThumbnail',
  Kanban: 'DndKanbanBoard',
};

function importStatementFor(title: string): string {
  let exportName = EXPORT_NAME_OVERRIDES[title] ?? title;
  return `import { ${exportName} } from '@cardstack/boxel-ui/components';`;
}

class IndexComponent extends Component {
  <template>
    {{pageTitle 'Boxel Components'}}
    <CardContainer
      class='boxel-freestyle-guide-container'
      @isThemed={{true}}
      style={{this.theme.styles}}
    >
      <BasicDropdownWormhole />

      <h1 class='boxel-sr-only'>Boxel Components Documentation</h1>
      <FreestyleGuide
        class='boxel-freestyle-guide'
        @title='Boxel UI Components'
        @subtitle='Living Component Documentation'
      >
        <BoxelContainer class='boxel-freestyle-theme-settings' @display='flex'>
          <FieldContainer @label='Theme' @tag='label'>
            <BoxelSelect
              class='boxel-freestyle-theme-selector'
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
        <FreestyleSection @name='Icons' class='freestyle-components-section'>
          <IconsGrid />
        </FreestyleSection>
        <FreestyleSection
          @name='Components'
          class='freestyle-components-section'
          as |Section|
        >
          {{#each this.usageComponents as |c|}}
            <Section.subsection @name={{formatComponentName c.title}}>
              <BoxelContainer>
                <div class='subsection-import'>
                  <code
                    class='subsection-import-code'
                  >{{c.importStatement}}</code>
                  <CopyButton
                    @textToCopy={{c.importStatement}}
                    @tooltipText='Copy import'
                    @ariaLabel='Copy import statement'
                    @size='small'
                  />
                </div>
                <CardContainer
                  class='subsection-card'
                  @displayBoundaries={{true}}
                >
                  <c.component />
                </CardContainer>
              </BoxelContainer>
            </Section.subsection>
          {{/each}}
        </FreestyleSection>
      </FreestyleGuide>
    </CardContainer>
    <style scoped>
      .boxel-freestyle-guide-container {
        border-radius: 0;
      }
      .boxel-freestyle-theme-settings {
        --boxel-container-gap: 0;
        --boxel-container-padding: 0;
        --boxel-form-control-height: 30px;
        position: absolute;
        top: var(--boxel-sp-lg);
        right: var(--boxel-sp-4xl);
        width: min-content;
      }
      .boxel-freestyle-theme-selector {
        min-width: 10rem;
      }
      .subsection-import {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-sm);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-4xs) var(--boxel-sp-4xs)
          var(--boxel-sp-xs);
        background-color: color-mix(in oklab, var(--muted) 70%, transparent);
        border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
        border-radius: var(--theme-radius, var(--boxel-border-radius));
      }
      .subsection-import-code {
        flex: 1;
        overflow-x: auto;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        line-height: 1.5;
        white-space: nowrap;
        color: color-mix(in oklab, var(--foreground) 85%, transparent);
      }
      .subsection-card {
        background-color: var(--card);
        color: var(--card-foreground);
      }
      .FreestyleGuide {
        display: grid;
      }
      .FreestyleUsage {
        --radius: var(--theme-radius);
        --border-color: var(--border);
      }
      .FreestyleGuide-header {
        position: relative;
        padding: var(--boxel-sp-xl) var(--boxel-sp-xl) var(--boxel-sp-lg);
        background-image: linear-gradient(
          135deg,
          var(--muted) 0%,
          color-mix(in oklab, var(--muted) 60%, var(--background)) 100%
        );
        color: var(--foreground);
        border-bottom: 1px solid
          color-mix(in oklab, var(--border) 60%, transparent);
      }
      .FreestyleGuide-title {
        margin: 0;
        font-size: 1.75rem;
        line-height: 1.15;
      }
      .FreestyleGuide-subtitle {
        margin-top: var(--boxel-sp-4xs);
        font-size: 0.875rem;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: color-mix(in oklab, var(--foreground) 60%, transparent);
      }
      .FreestyleGuide-body {
        height: 100%;
        overflow: hidden;
        background-color: inherit;
      }
      .FreestyleGuide-nav {
        height: 100%;
        background-color: var(--sidebar);
        color: var(--sidebar-foreground);
        border-right-color: var(--sidebar-border);
      }
      .FreestyleMenu-itemLink,
      .FreestyleMenu-submenuItemLink {
        color: inherit;
      }
      .FreestyleMenu-itemLink.active,
      .FreestyleMenu-submenuItemLink.active {
        background-color: var(--sidebar-foreground);
        color: var(--sidebar);
        font-weight: normal;
      }
      .FreestyleMenu-itemLink:hover,
      .FreestyleMenu-submenuItemLink:hover {
        background-color: color-mix(
          in oklab,
          var(--sidebar-foreground) 10%,
          transparent
        );
        color: var(--sidebar-foreground);
      }
      .FreestyleMenu-itemLink.active:hover,
      .FreestyleMenu-submenuItemLink.active:hover {
        background-color: color-mix(
          in oklab,
          var(--sidebar-foreground) 90%,
          transparent
        );
        color: var(--sidebar);
      }
      .FreestyleUsage + .FreestyleUsage {
        border-top: 1px solid var(--border);
      }
      .FreestyleUsage:last-child {
        border-bottom: unset;
      }
      .FreestyleUsageCssVar-name {
        width: 40%;
      }
      .FreestyleGuide-title,
      .FreestyleUsage-name {
        font-weight: 600;
      }
      .FreestyleSection-name {
        margin-bottom: var(--boxel-sp);
        padding-bottom: var(--boxel-sp-xs);
        font-size: 1.375rem;
        font-weight: 600;
        line-height: 1.2;
        border-bottom: 1px solid
          color-mix(in oklab, var(--border) 60%, transparent);
      }
      .FreestyleSubsection-name {
        font-family: var(--font-mono);
        font-size: 1.0625rem;
        font-weight: 600;
        line-height: 1.3;
      }
      .FreestyleUsage-name {
        margin-block: var(--boxel-sp-lg);
        font-size: 1.0625rem;
        line-height: 1.3;
      }
      .FreestyleUsage-name {
        color: var(--foreground);
      }
      .FreestyleUsage-description {
        line-height: 1.55;
        color: color-mix(in oklab, var(--foreground) 75%, transparent);
      }
      .FreestyleUsage-preview {
        --radius: var(--theme-radius, var(--boxel-border-radius));

        color: var(--foreground, var(--boxel-dark));
        background-color: var(--background, var(--boxel-light));
        border-radius: 4px;
      }
      .FreestyleUsage-apiTable tr:nth-child(even),
      .FreestyleUsage-cssVarsTable tr:nth-child(even) {
        background-color: color-mix(
          in oklab,
          var(--background) 90%,
          var(--foreground)
        );
      }
      .FreestyleUsage-apiTable tr,
      .FreestyleUsage-cssVarsTable tr {
        border-bottom-color: color-mix(
          in oklab,
          var(--border) 50%,
          transparent
        );
      }
      .u-codePill {
        background-color: var(--muted);
        color: var(--muted-foreground);
        font-family: var(--font-mono);
      }
      .FreestyleUsage-sourceContainer,
      .FreestyleUsage-apiTable,
      .FreestyleUsage-cssVarsTable {
        margin-inline: unset;
      }
    </style>
  </template>

  private intervalId?: NodeJS.Timeout;
  private themes: Theme[] = [{ name: '<None>' }, ...Themes];
  private usageComponents = ALL_USAGE_COMPONENTS.map(([name, c]) => {
    return {
      title: name,
      component: c,
      importStatement: importStatementFor(name as string),
    };
  }) as UsageComponent[];

  @service declare private router: RouterService;

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
