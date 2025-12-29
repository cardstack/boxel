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
          {{#each @fields.sections as |Section|}}
            <Section @format='embedded' />
          {{/each}}
        {{else}}
          <div class='empty-state'>No sections configured</div>
        {{/if}}
      </main>
    </div>

    <style scoped>
      /* Layout styles */
      .home-layout {
        --home-background: var(--background, var(--boxel-light));
        --home-foreground: var(--foreground, var(--boxel-dark));
        --home-grid-line: rgba(226, 232, 240, 0.6);
        --toolbar-bg: rgba(255, 255, 255, 0.4);
        --toolbar-border: rgba(255, 255, 255, 0.6);
        --toolbar-box-shadow:
          0 8px 32px rgba(102, 56, 255, 0.12), 0 4px 16px rgba(0, 0, 0, 0.04),
          inset 0 1px 0 rgba(255, 255, 255, 0.8);
        --mode-toggle-highlight: 0 1px 3px rgba(0, 0, 0, 0.2);

        position: relative;
        min-height: 100vh;
        background-color: var(--home-background);
        color: var(--home-foreground);
      }
      .home-layout.dark-mode {
        --home-background: var(--background, var(--boxel-700));
        --home-foreground: var(--foreground, var(--boxel-light));
        --home-grid-line: rgba(120, 115, 135, 0.25);
        --toolbar-bg: rgba(50, 45, 60, 0.85);
        --toolbar-border: rgba(100, 95, 115, 0.4);
        --toolbar-box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        --mode-toggle-highlight: 0 1px 3px rgba(255, 255, 255, 0.2);
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

      .nav-container {
        position: sticky;
        top: var(--boxel-sp);
        z-index: 1;
        padding: 0 6rem;
        container-name: navbar;
        container-type: inline-size;
      }
      .home-layout-navbar {
        margin: 0 auto;
      }

      /* CSS API for sections */
      .sections-container {
        --section-padding-block: clamp(3rem, 8vw, 6rem);
        --section-padding-inline: clamp(1.5rem, 5vw, 3rem);
        --section-max-width: 87.5rem;
        --section-gap: clamp(2rem, 6vw, 4rem);
        --hero-padding-block: clamp(5rem, 12vw, 10rem);
        --footer-padding-block: clamp(2rem, 5vw, 3rem);

        position: relative;
        z-index: 0;
        display: grid;
        gap: 8rem;
        max-width: var(--section-max-width);
        margin: 0 auto;
        padding: 0 6rem;
      }

      .empty-state {
        padding: 4rem 2rem;
        text-align: center;
        color: var(--muted-foreground, #666);
        font-size: 1.125rem;
      }

      .dark-mode-toggle {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        border: 1px solid var(--border, #e5e5e5);
        background: var(--card, #ffffff);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        box-shadow: var(--shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.1));
        transition: transform 0.2s;
        z-index: 100;
      }

      .dark-mode-toggle:hover {
        transform: scale(1.1);
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
