import { tracked } from '@glimmer/tracking';
import { get } from '@ember/object';

import { GridContainer } from '@cardstack/boxel-ui/components';
import {
  eq,
  buildCssGroups,
  generateCssVariables,
  parseCssGroups,
  extractCssVariables,
  sanitizeHtmlSafe,
  type CssRuleMap,
} from '@cardstack/boxel-ui/helpers';

import {
  field,
  contains,
  Component,
  CSSField,
  Theme,
  StringField,
  type BaseDefComponent,
} from './card-api';
import ThemeVarField, {
  ThemeTypographyField,
} from './structured-theme-variables';
import {
  ThemeDashboard,
  NavSection,
  ThemeVisualizer,
  CssFieldEditor,
  ResetButton,
  SimpleNavBar,
  type SectionSignature,
} from './default-templates/theme-dashboard';

export const GUIDE_SECTIONS = [
  {
    id: 'import-css',
    navTitle: 'Import CSS',
    title: 'Import Custom CSS',
    fieldName: null,
  },
  {
    id: 'view-code',
    navTitle: 'View Code',
    title: 'Generated CSS',
    fieldName: 'cssVariables',
  },
];

// Applies parsed CSS rules back onto the card fields for editing.
export const applyCssRulesToField = (
  field: ThemeVarField | undefined,
  rules: CssRuleMap | undefined,
) => {
  if (!field || !rules?.size) {
    return;
  }
  const cssFields = field.cssVariableFields;
  if (!cssFields?.length) {
    return;
  }
  const lookup = new Map<string, string>(
    cssFields.map((f) => [f.cssVariableName, f.fieldName]),
  );
  for (let [property, value] of rules.entries()) {
    const fieldName = lookup.get(property);
    if (!fieldName) {
      continue;
    }
    (field as any)[fieldName] = value;
  }
};

const resetCssVariables = (field: ThemeVarField | undefined) => {
  let cssFields = field?.cssVariableFields;
  if (!cssFields?.length) {
    return;
  }

  for (let { fieldName } of cssFields) {
    if (!fieldName) {
      continue;
    }
    (field as any)[fieldName] = null;
  }
};

// TODO: move to boxel-ui helpers
export const mergeRuleMaps = (
  ...maps: (CssRuleMap | undefined)[]
): CssRuleMap | undefined => {
  let combined: CssRuleMap | undefined;
  for (let map of maps) {
    if (!map?.size) {
      continue;
    }
    if (!combined) {
      combined = new Map(map);
      continue;
    }
    for (let [name, value] of map.entries()) {
      if (!name || !value) {
        continue;
      }
      combined.set(name, value);
    }
  }
  return combined;
};

class Isolated extends Component<typeof StructuredTheme> {
  @tracked private isDarkMode = false;

  private toggleDarkMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  <template>
    <ThemeDashboard
      class='structured-theme-card'
      style={{if this.isDarkMode @model.darkModeStyles}}
      @title={{@model.title}}
      @description={{@model.description}}
      @isDarkMode={{this.isDarkMode}}
      @version={{@model.version}}
    >
      <:navBar>
        <SimpleNavBar @items={{@model.guideSections}} />
      </:navBar>
      <:default>
        <GridContainer class='structured-theme-grid'>
          <ThemeVisualizer
            @toggleDarkMode={{this.toggleDarkMode}}
            @isDarkMode={{this.isDarkMode}}
          >
            <:colorPalette>
              {{#if this.isDarkMode}}
                <@fields.darkModeVariables data-test-dark-vars />
              {{else}}
                <@fields.rootVariables data-test-root-vars />
              {{/if}}
            </:colorPalette>
            <:typography>
              <@fields.typography />
            </:typography>
          </ThemeVisualizer>
          {{#each @model.guideSections as |section|}}
            <NavSection
              @id={{section.id}}
              @title={{if section.title section.title section.navTitle}}
              @hideSectionCounter={{true}}
            >
              {{#if (eq section.id 'import-css')}}
                <CssFieldEditor @setCss={{@model.setCss}} />
              {{else if section.fieldName}}
                {{#let (get @fields section.fieldName) as |FieldContent|}}
                  {{! @glint-ignore }}
                  <FieldContent />
                {{/let}}
              {{else}}
                <p><em>No content available.</em></p>
              {{/if}}
            </NavSection>
          {{/each}}
          <GridContainer>
            <h2>Reset CSS</h2>
            <div>
              <ResetButton @reset={{@model.resetCss}} />
            </div>
          </GridContainer>
        </GridContainer>
      </:default>
    </ThemeDashboard>

    <style scoped>
      @layer baseComponent {
        .structured-theme-grid {
          gap: var(--boxel-sp-2xl);
        }
      }
    </style>
  </template>
}

export default class StructuredTheme extends Theme {
  static displayName = 'Structured Theme';

  @field typography = contains(ThemeTypographyField, {
    description:
      'Typography styles for headings, body, and captions whose values are emitted as theme CSS variables.',
  });
  @field rootVariables = contains(ThemeVarField, {
    description:
      '`:root {}` variables for default (light mode) theme. CSS variable names are the dasherized and lowercase version of the field names, prefixed with "--".',
  });
  @field darkModeVariables = contains(ThemeVarField, {
    description:
      '`.dark {}` variables for dark mode theme. CSS variable names are the dasherized and lowercase version of the field names, prefixed with "--".',
  });
  @field version = contains(StringField, {
    description: 'Theme document version',
  });

  // CSS Variables computed from field entries
  @field cssVariables = contains(CSSField, {
    computeVia: function (this: StructuredTheme) {
      if (!generateCssVariables || !buildCssGroups) {
        return;
      }
      let rootRules = mergeRuleMaps(
        this.rootVariables?.cssRuleMap,
        this.typography?.cssRuleMap,
      );
      let darkRules = mergeRuleMaps(
        this.darkModeVariables?.cssRuleMap,
        this.typography?.cssRuleMap,
      );
      return generateCssVariables(
        buildCssGroups([
          { selector: ':root', rules: rootRules },
          { selector: '.dark', rules: darkRules },
        ]),
      );
    },
  });

  guideSections: SectionSignature[] = GUIDE_SECTIONS;

  get darkModeStyles() {
    return sanitizeHtmlSafe(extractCssVariables(this.cssVariables, '.dark'));
  }

  setCss = (content: string) => {
    if (!content || !parseCssGroups) {
      return;
    }
    const groups = parseCssGroups(content);
    if (!groups?.size) {
      return;
    }
    applyCssRulesToField(this.rootVariables, groups.get(':root'));
    applyCssRulesToField(this.darkModeVariables, groups.get('.dark'));
  };

  resetCss = () => {
    resetCssVariables(this.rootVariables);
    resetCssVariables(this.darkModeVariables);
  };

  static isolated: BaseDefComponent = Isolated;
}
