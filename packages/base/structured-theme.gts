import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import {
  BoxelButton,
  BoxelContainer,
  GridContainer,
} from '@cardstack/boxel-ui/components';

import {
  field,
  contains,
  Component,
  CSSField,
  Theme,
  type BaseDefComponent,
} from './card-api';
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
    <GridContainer @tag='article' class='structured-theme-card'>
      <BoxelContainer @tag='header' @display='flex' class='theme-header'>
        <h1><@fields.title /></h1>
        <p class='theme-description'>
          <@fields.description />
        </p>
      </BoxelContainer>

      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>Root Variables (:root)</h2>
          <BoxelButton
            @kind='text-only'
            @size='extra-small'
            class='section-toggle'
            aria-expanded={{this.isRootVariablesVisible}}
            aria-controls='root-variables-content'
            {{on 'click' this.toggleRootVariablesVisibility}}
          >
            {{if this.isRootVariablesVisible 'Hide' 'Show'}}
          </BoxelButton>
        </GridContainer>
        {{#if this.isRootVariablesVisible}}
          <div id='root-variables-content' class='section-body'>
            <@fields.rootVariables />
          </div>
        {{/if}}
      </GridContainer>

      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>Dark Mode Variables (.dark)</h2>
          <BoxelButton
            @kind='text-only'
            @size='extra-small'
            class='section-toggle'
            aria-expanded={{this.isDarkVariablesVisible}}
            aria-controls='dark-variables-content'
            {{on 'click' this.toggleDarkVariablesVisibility}}
          >
            {{if this.isDarkVariablesVisible 'Hide' 'Show'}}
          </BoxelButton>
        </GridContainer>
        {{#if this.isDarkVariablesVisible}}
          <div id='dark-variables-content' class='section-body'>
            <@fields.darkModeVariables />
          </div>
        {{/if}}
      </GridContainer>

      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>All CSS Variables</h2>
          <BoxelButton
            @kind='text-only'
            @size='extra-small'
            class='section-toggle'
            aria-expanded={{this.isGeneratedCSSVisible}}
            aria-controls='generated-css-content'
            {{on 'click' this.toggleGeneratedCSSVisibility}}
          >
            {{if this.isGeneratedCSSVisible 'Hide' 'Show'}}
          </BoxelButton>
        </GridContainer>
        {{#if this.isGeneratedCSSVisible}}
          <div id='generated-css-content' class='section-body'>
            <@fields.cssVariables />
          </div>
        {{/if}}
      </GridContainer>
    </GridContainer>

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
      }

      h2 {
        font-size: var(--boxel-font-size-lg);
        line-height: var(--boxel-line-height-lg);
      }

      .structured-theme-card {
        min-height: 100%;
        align-content: start;
        gap: 0;
        container-name: structured-theme-card;
        container-type: size;
      }

      .theme-header {
        min-height: 20vh;
        flex-direction: column;
        flex-wrap: nowrap;
        justify-content: center;
        padding: var(--boxel-sp-xxl);
        gap: var(--boxel-sp-xs);
        text-align: center;
        background-color: var(--card);
        color: var(--card-foreground);
      }

      .theme-description {
        color: var(--muted-foreground);
      }

      .content-section {
        padding: var(--boxel-sp) var(--boxel-sp-xxl);
      }

      .section-header {
        grid-template-columns: 1fr auto;
        align-items: center;
      }

      .section-toggle {
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xxxs);
        color: var(--primary);
        background: transparent;
        border: none;
        text-transform: uppercase;
      }

      .section-toggle:hover,
      .section-toggle:focus-visible {
        text-decoration: underline;
      }

      .section-body {
        animation: fade-in 120ms ease-out;
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

      @container structured-theme-card (width < 31.25rem) {
        .content-section {
          padding: var(--boxel-sp-xs);
        }
        .field-list {
          grid-template-columns: 1fr 1fr;
        }
        h2 {
          font-size: var(--boxel-font-size-med);
        }
      }
    </style>
  </template>
}

class StructuredTheme extends Theme {
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

  static isolated: BaseDefComponent = Isolated;
}

export { StructuredTheme };
export default StructuredTheme;
