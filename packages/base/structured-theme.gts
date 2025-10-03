import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { field, contains, Component, CSSField, Theme } from './card-api';
import ThemeVarField from './structured-theme-variables';

// helpers for generating CSS from fields
function addCSSVar(
  vars: string[],
  property: string,
  value: string | undefined | null,
): void {
  let val = value?.replace(';', '')?.trim();
  if (val?.length) {
    vars.push(`  ${property}: ${val};`);
  }
}

function generateCSSBlockString(blockName: string, vars: string[]): string {
  if (vars?.length === 0) {
    return '';
  }
  return `${blockName} {\n${vars.join('\n')}\n}`;
}

function generateBlockVariables(vars: ThemeVarField | null | undefined) {
  const cssVars: string[] = [];

  if (!vars) {
    return cssVars;
  }

  // Color variables
  addCSSVar(cssVars, '--background', vars.background);
  addCSSVar(cssVars, '--foreground', vars.foreground);
  addCSSVar(cssVars, '--card', vars.card);
  addCSSVar(cssVars, '--card-foreground', vars.cardForeground);
  addCSSVar(cssVars, '--popover', vars.popover);
  addCSSVar(cssVars, '--popover-foreground', vars.popoverForeground);
  addCSSVar(cssVars, '--primary', vars.primary);
  addCSSVar(cssVars, '--primary-foreground', vars.primaryForeground);
  addCSSVar(cssVars, '--secondary', vars.secondary);
  addCSSVar(cssVars, '--secondary-foreground', vars.secondaryForeground);
  addCSSVar(cssVars, '--muted', vars.muted);
  addCSSVar(cssVars, '--muted-foreground', vars.mutedForeground);
  addCSSVar(cssVars, '--accent', vars.accent);
  addCSSVar(cssVars, '--accent-foreground', vars.accentForeground);
  addCSSVar(cssVars, '--destructive', vars.destructive);
  addCSSVar(cssVars, '--destructive-foreground', vars.destructiveForeground);
  addCSSVar(cssVars, '--border', vars.border);
  addCSSVar(cssVars, '--input', vars.input);
  addCSSVar(cssVars, '--ring', vars.ring);

  // Chart variables
  addCSSVar(cssVars, '--chart-1', vars.chart1);
  addCSSVar(cssVars, '--chart-2', vars.chart2);
  addCSSVar(cssVars, '--chart-3', vars.chart3);
  addCSSVar(cssVars, '--chart-4', vars.chart4);
  addCSSVar(cssVars, '--chart-5', vars.chart5);

  // Sidebar color variables
  addCSSVar(cssVars, '--sidebar', vars.sidebar);
  addCSSVar(cssVars, '--sidebar-foreground', vars.sidebarForeground);
  addCSSVar(cssVars, '--sidebar-primary', vars.sidebarPrimary);
  addCSSVar(
    cssVars,
    '--sidebar-primary-foreground',
    vars.sidebarPrimaryForeground,
  );
  addCSSVar(cssVars, '--sidebar-accent', vars.sidebarAccent);
  addCSSVar(
    cssVars,
    '--sidebar-accent-foreground',
    vars.sidebarAccentForeground,
  );
  addCSSVar(cssVars, '--sidebar-border', vars.sidebarBorder);
  addCSSVar(cssVars, '--sidebar-ring', vars.sidebarRing);

  // Font variables
  addCSSVar(cssVars, '--font-sans', vars.fontSans);
  addCSSVar(cssVars, '--font-serif', vars.fontSerif);
  addCSSVar(cssVars, '--font-mono', vars.fontMono);

  // Geometry variables
  addCSSVar(cssVars, '--radius', vars.radius);
  addCSSVar(cssVars, '--spacing', vars.spacing);
  addCSSVar(cssVars, '--tracking-normal', vars.trackingNormal);

  // Shadow variables
  addCSSVar(cssVars, '--shadow-2xs', vars.shadow2xs);
  addCSSVar(cssVars, '--shadow-xs', vars.shadowXs);
  addCSSVar(cssVars, '--shadow-sm', vars.shadowSm);
  addCSSVar(cssVars, '--shadow', vars.shadow);
  addCSSVar(cssVars, '--shadow-md', vars.shadowMd);
  addCSSVar(cssVars, '--shadow-lg', vars.shadowLg);
  addCSSVar(cssVars, '--shadow-xl', vars.shadowXl);
  addCSSVar(cssVars, '--shadow-2xl', vars.shadow2xl);

  return cssVars;
}

type CSSVariableBlockInput = {
  blockname: string;
  vars: ThemeVarField | null | undefined;
};

function generateBlocks(blockInputs: CSSVariableBlockInput[]): string {
  const blocks: string[] = [];
  for (let { blockname, vars } of blockInputs) {
    const varList = generateBlockVariables(vars);
    const blockString = generateCSSBlockString(blockname, varList);
    if (blockString) {
      blocks.push(blockString);
    }
  }
  if (blocks.length === 0) {
    return '';
  }
  return blocks.join('\n\n');
}

class Isolated extends Component<typeof StructuredTheme> {
  @tracked isGeneratedCSSVisible = true;
  @tracked isRootVariablesVisible = true;
  @tracked isDarkVariablesVisible = true;

  @action toggleGeneratedCSSVisibility() {
    this.isGeneratedCSSVisible = !this.isGeneratedCSSVisible;
  }

  @action toggleRootVariablesVisibility() {
    this.isRootVariablesVisible = !this.isRootVariablesVisible;
  }

  @action toggleDarkVariablesVisibility() {
    this.isDarkVariablesVisible = !this.isDarkVariablesVisible;
  }

  <template>
    <article class='structured-theme-card'>
      <header class='theme-header'>
        <h1><@fields.title /></h1>
        <p class='theme-description'>
          <@fields.description />
        </p>
      </header>

      <section class='root-section'>
        <header class='section-header'>
          <h2>Root Variables (:root)</h2>
          <button
            type='button'
            class='section-toggle'
            aria-expanded={{this.isRootVariablesVisible}}
            aria-controls='root-variables-content'
            {{on 'click' this.toggleRootVariablesVisibility}}
          >
            {{if this.isRootVariablesVisible 'Hide' 'Show'}}
          </button>
        </header>
        {{#if this.isRootVariablesVisible}}
          <div id='root-variables-content' class='section-body'>
            <@fields.rootVariables />
          </div>
        {{/if}}
      </section>

      <section class='dark-section'>
        <header class='section-header'>
          <h2>Dark Mode Variables (.dark)</h2>
          <button
            type='button'
            class='section-toggle'
            aria-expanded={{this.isDarkVariablesVisible}}
            aria-controls='dark-variables-content'
            {{on 'click' this.toggleDarkVariablesVisibility}}
          >
            {{if this.isDarkVariablesVisible 'Hide' 'Show'}}
          </button>
        </header>
        {{#if this.isDarkVariablesVisible}}
          <div id='dark-variables-content' class='section-body'>
            <@fields.darkModeVariables />
          </div>
        {{/if}}
      </section>

      <section class='generated-css-section'>
        <header class='section-header'>
          <h2>Calculated CSS Variables</h2>
          <button
            type='button'
            class='section-toggle'
            aria-expanded={{this.isGeneratedCSSVisible}}
            aria-controls='generated-css-content'
            {{on 'click' this.toggleGeneratedCSSVisibility}}
          >
            {{if this.isGeneratedCSSVisible 'Hide' 'Show'}}
          </button>
        </header>
        {{#if this.isGeneratedCSSVisible}}
          <div id='generated-css-content' class='section-body'>
            <@fields.cssVariables />
          </div>
        {{/if}}
      </section>
    </article>

    <style scoped>
      p {
        margin: 0;
      }

      h1,
      h2 {
        margin: 0;
        font-weight: var(--boxel-font-weight-semibold);
      }

      h1 {
        font-size: var(--boxel-font-size-xl);
        line-height: var(--boxel-line-height-xl);
        margin-bottom: var(--boxel-sp-xl);
      }

      h2 {
        font-size: var(--boxel-font-size-lg);
        line-height: var(--boxel-line-height-lg);
      }

      .structured-theme-card {
        max-width: 56rem;
        padding: 2rem;
        font-size: 0.875rem;
        line-height: 1.3;
      }

      .theme-header {
        margin-bottom: 2rem;
      }

      .theme-description {
        color: var(--muted-foreground);
        font-size: 0.875rem;
      }

      .root-section,
      .dark-section,
      .generated-css-section {
        margin-bottom: 2rem;
      }

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        margin-bottom: 1rem;
      }

      .section-body {
        animation: fade-in 120ms ease-out;
      }

      .section-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-3xs);
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--primary, var(--boxel-color-link, inherit));
        background: transparent;
        border: none;
        border-radius: var(--boxel-border-radius-xs);
        cursor: pointer;
      }

      .section-toggle:hover,
      .section-toggle:focus-visible {
        text-decoration: underline;
      }

      @keyframes fade-in {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    </style>
  </template>
}

export default class StructuredTheme extends Theme {
  static displayName = 'Structured Theme';

  @field rootVariables = contains(ThemeVarField, {
    description:
      '`:root {}` variables for default (light mode) theme. CSS variable names are the dasherized and lowercase version of the field names, prefixed with "--".',
  });
  @field darkModeVariables = contains(ThemeVarField, {
    description:
      '`.dark {}` variables for dark mode theme. CSS variable names are the dasherized and lowercase version of the field names, prefixed with "--".',
  });

  // CSS Variables computed from field entries
  @field cssVariables = contains(CSSField, {
    computeVia: function (this: StructuredTheme) {
      return generateBlocks([
        { blockname: ':root', vars: this.rootVariables },
        { blockname: '.dark', vars: this.darkModeVariables },
      ]);
    },
  });

  static isolated = Isolated;
}
