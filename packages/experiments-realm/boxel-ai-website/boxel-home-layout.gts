import { tracked } from '@glimmer/tracking';

import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import type BrandGuide from 'https://cardstack.com/base/brand-guide';

import {
  cn,
  extractCssVariables,
  sanitizeHtmlSafe,
} from '@cardstack/boxel-ui/helpers';

import { PageSectionField } from './fields/page-section-field';
import { SiteNavbar } from './components/site-navbar';
import { Site } from './site-config';

class Isolated extends Component<typeof HomeLayoutCard> {
  @tracked isDarkMode = false;

  private toggleMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  private get themeStyles() {
    let themeCard =
      this.args.model?.cardInfo?.theme ?? this.args.model?.site?.brandGuide;
    let css = themeCard?.cssVariables;
    let selector = this.isDarkMode ? '.dark' : ':root';
    return sanitizeHtmlSafe(extractCssVariables(css, selector));
  }

  private get navLogo() {
    let brandGuide: BrandGuide | undefined = this.args.model.cardInfo?.theme as
      | BrandGuide
      | undefined;
    let lightModeLogo = brandGuide?.markUsage.primaryMark1;
    let darkModeLogo = brandGuide?.markUsage.primaryMark2 ?? lightModeLogo;
    return this.isDarkMode ? darkModeLogo : lightModeLogo;
  }

  <template>
    <div
      style={{this.themeStyles}}
      class={{cn 'home-layout' dark-mode=this.isDarkMode}}
    >
      <div class='grid-background' />

      <div class='nav-container'>
        <SiteNavbar
          class='home-layout-navbar'
          @site={{@model.site}}
          @currentPageId={{@model.currentPageId}}
          @logoUrl={{this.navLogo}}
          @toggleMode={{this.toggleMode}}
          @isDarkMode={{this.isDarkMode}}
        />
      </div>

      <main class='sections-container'>
        {{#if @model.sections.length}}
          <@fields.sections class='sections-grid' @format='embedded' />
        {{else}}
          <div class='empty-state'>No sections configured</div>
        {{/if}}
      </main>
    </div>

    <style scoped>
      .home-layout {
        --home-background: var(--background, var(--boxel-light));
        --home-foreground: var(--foreground, var(--boxel-dark));
        --home-muted: var(--muted, #f5f5f5);
        --home-grid-line: rgba(226, 232, 240, 0.6);
        --home-content-max-width: 87.5rem;
        --home-content-padding: 0 6rem;
        --diagram-background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
        --diagram-foreground: var(--home-foreground);

        container-name: home-layout;
        container-type: inline-size;
        position: relative;
        min-height: 100vh;
        background-color: var(--home-background);
        color: var(--home-foreground);
      }
      .home-layout.dark-mode {
        --home-background: var(--background, var(--boxel-700));
        --home-foreground: var(--foreground, var(--boxel-light));
        --home-grid-line: rgba(120, 115, 135, 0.25);
        --diagram-background: linear-gradient(
          180deg,
          var(--home-background) 0%,
          var(--home-muted) 100%
        );
      }

      .grid-background {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        min-height: 100vh;
        inset: 0;
        background-image:
          linear-gradient(to right, var(--home-grid-line) 1px, transparent 1px),
          linear-gradient(to bottom, var(--home-grid-line) 1px, transparent 1px);
        background-size: 32px 32px;
        background-repeat: repeat;
        pointer-events: none;
        transition: background-image 0.3s ease;
      }
      .nav-container,
      .sections-container {
        max-width: var(--home-content-max-width);
        margin: 0 auto;
        padding: var(--home-content-padding);
      }
      .nav-container {
        container-name: navbar;
        container-type: inline-size;
        position: sticky;
        top: var(--boxel-sp);
        z-index: 1;
        min-width: 32rem;
      }
      .sections-container {
        position: relative;
        padding-bottom: 6rem;
        z-index: 0;
      }
      .sections-grid {
        gap: 8rem;
      }
      .empty-state {
        padding: 4rem 2rem;
        text-align: center;
        color: var(--muted-foreground);
        font-size: 1.125rem;
      }

      @container home-layout (inline-size <= 900px) {
        .nav-container {
          --home-content-padding: 0 1rem;
        }
        .sections-container {
          --home-content-padding: 0 3rem;
        }
      }
    </style>
  </template>
}

// Home page layout orchestrator
export class HomeLayoutCard extends CardDef {
  static displayName = 'Home Layout';
  static prefersWideFormat = true;

  @field site = linksTo(() => Site, {
    description: 'Links to site configuration',
  });
  @field currentPageId = contains(StringField, {
    description: 'Identifies current page',
  });
  @field showDarkModeToggle = contains(BooleanField);
  @field sections = containsMany(PageSectionField);

  static isolated = Isolated;
}
