import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import { tracked } from '@glimmer/tracking';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import type EmberFreestyle from 'ember-freestyle/services/ember-freestyle';

import BasicDropdownWormhole from 'ember-basic-dropdown/components/basic-dropdown';

import FreestyleGuide from 'ember-freestyle/components/freestyle-guide';
import FreestyleMenu from 'ember-freestyle/components/freestyle-menu';
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

// The scroll spy schedules FreestyleMenu#scrollActiveItemIntoView while the
// user scrolls the page. Upstream it uses Element#scrollIntoView, which also
// scrolls the document — hijacking the in-progress page scroll whenever the
// active menu item sits outside the nav's visible area. Constrain the
// auto-scroll to the nav's own scroll container.
FreestyleMenu.prototype.scrollActiveItemIntoView = function () {
  let el = document.querySelector('.FreestyleMenu-submenuItem.is-active');
  let nav = el?.closest('.FreestyleGuide-nav');
  if (!el || !nav) {
    return;
  }
  let elRect = el.getBoundingClientRect();
  let navRect = nav.getBoundingClientRect();
  if (elRect.top < navRect.top) {
    nav.scrollTop += elRect.top - navRect.top;
  } else if (elRect.bottom > navRect.bottom) {
    nav.scrollTop += elRect.bottom - navRect.bottom;
  }
};

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

// Must match the mobile breakpoint used by the media queries below.
const SMALL_SCREEN = '(max-width: 599px)';

function importStatementFor(title: string): string {
  let exportName = EXPORT_NAME_OVERRIDES[title] ?? title;
  return `import { ${exportName} } from '@cardstack/boxel-ui/components';`;
}

class IndexComponent extends Component {
  <template>
    {{pageTitle 'Boxel Components'}}
    {{! data-theme sets the inherited --boxel-color-scheme signal (theme.css)
        that the scoped theme stylesheet's dark container query reads, so it
        must live on an ancestor of the themed CardContainer. }}
    <div class='boxel-freestyle-mode-wrapper' data-theme={{this.mode}}>
      <CardContainer
        class='boxel-freestyle-guide-container'
        @isThemed={{true}}
        @themeCss={{this.theme.cssVariables}}
        @themeScope='boxel-freestyle-guide'
      >
        <BasicDropdownWormhole />

        <h1 class='boxel-sr-only'>Boxel Components Documentation</h1>
        <FreestyleGuide
          class='boxel-freestyle-guide'
          @title='Boxel UI Components'
          @subtitle='Living Component Documentation'
        >
          <BoxelContainer
            class='boxel-freestyle-theme-settings'
            @display='flex'
          >
            <FieldContainer
              class='theme-field'
              @inline={{true}}
              @label='Theme'
              @tag='label'
            >
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
            <FieldContainer
              class='theme-field'
              @inline={{true}}
              @label='Cycle Themes'
              @tag='label'
            >
              <Switch
                @label='Cycle Themes'
                @isEnabled={{this.isCycleThemesEnabled}}
                @onChange={{this.toggleCycling}}
              />
            </FieldContainer>
            <FieldContainer
              class='theme-field'
              @inline={{true}}
              @label='Dark Mode'
              @tag='label'
            >
              <Switch
                @label='Dark Mode'
                @isEnabled={{this.isDarkMode}}
                @onChange={{this.toggleMode}}
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
            {{#each this.usageComponents key='title' as |c|}}
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
    </div>
    <style scoped>
      .boxel-freestyle-guide input:not(.boxel-input):not([type='checkbox']),
      .boxel-freestyle-guide select:not(.boxel-select) {
        max-width: 100%;
        background-color: var(--background);
        color: var(--foreground);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-sm);
      }
      .boxel-freestyle-guide
        input:not(.boxel-input):not([type='checkbox'])::placeholder {
        color: var(--muted-foreground);
      }
      .boxel-freestyle-guide
        input:not(.boxel-input):not([type='checkbox']):focus:focus-visible,
      .boxel-freestyle-guide select:not(.boxel-select):focus:focus-visible {
        outline: 1px solid var(--ring);
      }
      .boxel-freestyle-mode-wrapper {
        /* Render native UI (select menus, scrollbars, form controls) in the
           scheme the data-theme toggle resolves to via theme.css. */
        color-scheme: var(--boxel-color-scheme, light);
        background-color: var(--background);
      }
      .boxel-freestyle-guide-container {
        border-radius: 0;
        /* CardContainer's overflow: hidden makes it the containing scroll
           box for the sticky nav sidebar, which then never sticks to the
           viewport. Nothing needs clipping here (no rounded corners). */
        overflow: visible;
      }
      .boxel-freestyle-theme-settings {
        --boxel-container-gap: var(--boxel-sp-2xs) var(--boxel-sp);
        --boxel-container-padding: var(--boxel-sp-xs) var(--boxel-sp);
      }
      .boxel-freestyle-theme-selector {
        min-width: 12.5rem;
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
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: color-mix(in oklab, var(--foreground) 60%, transparent);
      }
      .FreestyleGuide-body {
        background-color: inherit;
      }
      .FreestyleGuide-nav {
        background-color: var(--sidebar);
        color: var(--sidebar-foreground);
        border-right-color: var(--sidebar-border);
        z-index: 1;
      }
      .FreestyleGuide-content {
        /* As a flex: 1 child its default min-width: auto lets wide content
           (tables, code blocks) push the column past the space the row
           gives it; never let it grow beyond that. */
        min-width: 0;
        max-width: 100%;
        /* ember-freestyle's overflow: auto makes the content column the
           containing scroll box for sticky descendants (e.g. the icons-grid
           header), but the page body is what actually scrolls at every
           width — the column is never height-constrained — so they never
           stick. */
        overflow: visible;
      }
      @media (max-width: 599px) {
        /* Standard modal-drawer scroll lock: only bites while the drawer is
           open, since the nav is removed from the DOM when closed. */
        body:has(.FreestyleGuide-nav) {
          overflow: hidden;
        }
        .FreestyleGuide-header {
          padding: var(--boxel-sp) var(--boxel-sp) var(--boxel-sp-sm);
        }
        .FreestyleGuide-title {
          font-size: 20px;
        }
        .FreestyleGuide-subtitle {
          font-size: 10px;
        }
        .theme-field {
          --boxel-label-font-size: var(--boxel-font-size-xs);
        }
        /* Backdrop behind the drawer. It lives on the nav's own parent so
           both share a stacking context — a body-level pseudo could end up
           on the wrong side of the themed container's stacking context.
           Taps land on .FreestyleGuide-body, outside the nav, which the
           delegated click handler treats as dismissal. */
        .FreestyleGuide-body:has(.FreestyleGuide-nav)::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: 2;
          background-color: color-mix(
            in oklab,
            var(--foreground) 40%,
            transparent
          );
          animation: freestyle-backdrop-fade-in 200ms ease;
        }
        .FreestyleGuide-nav {
          position: fixed;
          inset: 0 auto 0 0;
          width: var(--boxel-xs-container);
          max-width: 85vw;
          height: auto;
          background: var(--muted);
          overscroll-behavior: contain;
          z-index: 3;
          animation: freestyle-nav-slide-in 200ms ease;
        }
        .FreestyleGuide-content {
          flex: 1;
          min-height: 0;
          margin-top: 0;
        }
        .FreestyleUsage-apiTable,
        .FreestyleUsage-cssVarsTable {
          display: block;
          overflow-x: auto;
        }
      }
      @keyframes freestyle-nav-slide-in {
        from {
          transform: translateX(-100%);
        }
      }
      @keyframes freestyle-backdrop-fade-in {
        from {
          opacity: 0;
        }
      }
      .FreestyleMenu-itemLink,
      .FreestyleMenu-submenuItemLink {
        color: inherit;
      }
      .FreestyleMenu-itemLink.active,
      .FreestyleMenu-submenuItemLink.active,
      .FreestyleMenu-submenuItem.is-active > .FreestyleMenu-submenuItemLink {
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
      .FreestyleMenu-submenuItemLink.active:hover,
      .FreestyleMenu-submenuItem.is-active
        > .FreestyleMenu-submenuItemLink:hover {
        background-color: color-mix(
          in oklab,
          var(--sidebar-foreground) 80%,
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
        max-width: 100%;
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
        font-size: var(--boxel-font-size-sm);
      }
      .FreestyleUsage-preview {
        --radius: var(--theme-radius, var(--boxel-border-radius));
        color: var(--foreground, var(--boxel-dark));
        background-color: var(--background, var(--boxel-light));
        border-radius: var(--boxel-border-radius-xs);
        overflow: hidden;
      }
      .FreestyleUsage-preview:after {
        background: var(--secondary);
        color: var(--secondary-foreground);
      }
      .FreestyleUsage-apiTable tr:nth-child(even),
      .FreestyleUsage-cssVarsTable tr:nth-child(even) {
        background-color: color-mix(in oklab, var(--border) 30%, transparent);
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
      .FreestyleGuide-ctaIcon {
        fill: var(--foreground);
      }
      .FreestyleGuide-aside {
        z-index: 3;
      }
      .FreestyleUsageControls {
        background: var(--popover);
        color: var(--popover-foreground);
      }
      .FreestyleUsageControls-itemControl {
        max-width: 100%;
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
  @service('ember-freestyle') declare private emberFreestyle: EmberFreestyle;

  @tracked private theme?: Theme;
  @tracked private mode: 'light' | 'dark' = 'light';
  @tracked private isCycleThemesEnabled = false;

  private get isDarkMode() {
    return this.mode === 'dark';
  }

  constructor(owner: Owner, args: {}) {
    super(owner, args);

    // On small screens the nav is a modal drawer: closed by default so the
    // page lands on scrollable content, opened via the hamburger, dismissed
    // by tapping the backdrop or choosing a menu entry.
    if (window.matchMedia(SMALL_SCREEN).matches) {
      this.emberFreestyle.set('showMenu', false);
    }
    document.addEventListener('click', this.handleNavClick);
    this.syncNavToggleAria();

    let queryParams = this.router?.currentRoute?.queryParams;
    if (!queryParams) {
      return;
    }
    let { cycleThemes, mode, theme } = queryParams;

    if (mode === 'dark') {
      this.mode = 'dark';
    }

    let currentTheme = this.themes.find((t) => t.name === theme);
    this.selectTheme(currentTheme);

    if (cycleThemes === 'true') {
      this.isCycleThemesEnabled = true;
      this.maybeCycleThemes();
    }
  }

  override willDestroy() {
    super.willDestroy();
    document.removeEventListener('click', this.handleNavClick);
    clearInterval(this.intervalId);
  }

  // The hamburger, nav links, and backdrop all live in ember-freestyle's or
  // the browser's markup, so drawer dismissal is handled with one delegated
  // listener rather than per-element modifiers.
  private handleNavClick = (ev: Event) => {
    let target = ev.target as Element | null;
    if (target?.closest?.('.FreestyleGuide-cta--nav')) {
      // the hamburger already toggles showMenu; just reflect the new state
      this.syncNavToggleAria();
      return;
    }
    if (!window.matchMedia(SMALL_SCREEN).matches) {
      return;
    }
    if (!this.emberFreestyle.showMenu) {
      return;
    }
    let insideNav = target?.closest?.('.FreestyleGuide-nav');
    let onMenuLink = target?.closest?.(
      '.FreestyleMenu-itemLink, .FreestyleMenu-submenuItemLink',
    );
    // Close on any tap outside the drawer (the backdrop covers the rest of
    // the viewport) or on a menu selection, so the chosen section is
    // revealed immediately.
    if (!insideNav || onMenuLink) {
      this.emberFreestyle.set('showMenu', false);
      this.syncNavToggleAria();
    }
  };

  private syncNavToggleAria = () => {
    requestAnimationFrame(() => {
      document
        .querySelector('.FreestyleGuide-cta--nav')
        ?.setAttribute('aria-expanded', String(this.emberFreestyle.showMenu));
    });
  };

  @action private selectTheme(theme?: Theme) {
    this.theme = theme;
    this.router.replaceWith('index', {
      queryParams: { theme: this.theme?.name },
    });
  }

  @action private toggleMode() {
    this.mode = this.mode === 'dark' ? 'light' : 'dark';
    this.router.replaceWith('index', {
      queryParams: { mode: this.mode === 'dark' ? 'dark' : null },
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
