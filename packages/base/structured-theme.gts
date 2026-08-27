import { tracked } from '@glimmer/tracking';
import { get } from '@ember/object';

import {
  FieldContainer,
  GridContainer,
  Swatch,
} from '@cardstack/boxel-ui/components';
import {
  eq,
  buildCssGroups,
  generateCssVariables,
  googleFontImportsFor,
  parseCssGroups,
  markdownEscape,
  type CssRuleMap,
} from '@cardstack/boxel-ui/helpers';

import {
  field,
  contains,
  containsMany,
  Component,
  CSSField,
  CssImportField,
  Theme,
  StringField,
  getFields,
  type BaseDefComponent,
} from './card-api';
import ThemeVarField, {
  ThemeTypographyField,
} from './structured-theme-variables';
import {
  ThemeDashboard,
  ThemeDashboardEmptyState,
  ThemeDashboardHeader,
  NavSection,
  ThemeVisualizer,
  ThemeImporter,
  CardContainerCss,
  ResetButton,
  type SectionSignature,
} from './default-templates/theme-dashboard';

export const GUIDE_SECTIONS = [
  {
    id: 'card-container-css',
    navTitle: 'Computed Styles',
    title: 'Card Container Computed Styles',
    fieldName: null,
  },
  {
    id: 'import-css',
    navTitle: 'Import CSS',
    title: 'Import CSS Variables',
    fieldName: null,
  },
  {
    id: 'view-code',
    navTitle: 'View Code',
    title: 'Generated CSS Variables',
    fieldName: 'cssVariables',
  },
];

// A theme-less card in edit mode leads with the import workflow; the nav and
// the body render the same list, so the importer lands at the top of the
// page too.
export const orderEditSections = (
  sections: SectionSignature[],
  hasThemeCss: boolean,
): SectionSignature[] => {
  if (hasThemeCss) {
    return sections;
  }
  let leading: SectionSignature[] = [];
  let rest: SectionSignature[] = [];
  for (let section of sections) {
    (section.id === 'import-css' || section.id === 'view-code'
      ? leading
      : rest
    ).push(section);
  }
  return [...leading, ...rest];
};

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

const resetTypographyVariables = (
  typography: ThemeTypographyField | undefined,
) => {
  if (!typography) return;
  let fields = getFields(typography);
  if (!fields) return;
  for (let fieldName of Object.keys(fields)) {
    let subField = (typography as any)[fieldName];
    if (!subField?.fieldEntries) continue;
    for (let { name } of subField.fieldEntries) {
      if (name && name !== 'sampleText') (subField as any)[name] = null;
    }
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
  // Edit extends this template with the field editors swapped in
  protected editMode = false;

  @tracked private isDarkMode = false;

  private toggleDarkMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  private get hasThemeCss() {
    return Boolean(this.args.model?.cssVariables);
  }

  // In edit mode the visualizer hosts the field editors, so it renders even
  // before a theme is imported.
  private get showVisualizer() {
    return this.editMode || this.hasThemeCss;
  }

  // A theme-less isolated view shows the dashboard empty state instead of
  // any sections; importing happens in edit mode.
  private get showEmptyState() {
    return !this.editMode && !this.hasThemeCss;
  }

  private get visibleSections() {
    let sections = this.args.model?.guideSections ?? [];
    // every field stays editable in edit mode; the Card Container CSS
    // reference is display-only and stays out of the editor
    if (this.editMode) {
      return orderEditSections(
        sections.filter((section) => section.id !== 'card-container-css'),
        this.hasThemeCss,
      );
    }
    if (this.hasThemeCss) {
      // the importer is an editing tool, so the isolated view leaves it out
      return sections.filter((section) => section.id !== 'import-css');
    }
    return [];
  }

  // the visualizer renders ahead of the numbered sections; the nav lists
  // it as Preview when the card has a theme (a theme-less edit view leads
  // with the import section instead)
  private get navSections() {
    if (!this.hasThemeCss) {
      return this.visibleSections;
    }
    return [{ id: 'preview', navTitle: 'Preview' }, ...this.visibleSections];
  }

  <template>
    <ThemeDashboard
      class='structured-theme-card'
      @themeCss={{@model.cssVariables}}
      @themeId={{@model.id}}
      @isDarkMode={{this.isDarkMode}}
      @sections={{this.navSections}}
    >
      <:header>
        <ThemeDashboardHeader
          @title={{@model.cardTitle}}
          @description={{@model.cardDescription}}
          @version={{@model.version}}
          @model={{@model}}
          @fields={{@fields}}
          @mode={{if this.editMode 'edit' 'isolated'}}
          @metaLabel='Theme Guide'
        />
      </:header>
      <:default>
        {{#if this.showEmptyState}}
          <ThemeDashboardEmptyState />
        {{else}}
          <GridContainer class='structured-theme-grid'>
            {{#if this.showVisualizer}}
              <ThemeVisualizer
                id='preview'
                @toggleDarkMode={{this.toggleDarkMode}}
                @isDarkMode={{this.isDarkMode}}
                @fontStack={{@model.fontStacksFor this.isDarkMode}}
                @cssImports={{@model.cssImports}}
                @editMode={{this.editMode}}
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
                <:cssImports>
                  <FieldContainer
                    @label='CSS Imports'
                    @tag='label'
                    @vertical={{true}}
                  >
                    <@fields.customCssImports />
                  </FieldContainer>
                </:cssImports>
              </ThemeVisualizer>
            {{/if}}
            {{#each this.visibleSections as |section|}}
              <NavSection
                @id={{section.id}}
                @title={{if section.title section.title section.navTitle}}
                @hideSectionCounter={{true}}
              >
                {{#if (eq section.id 'card-container-css')}}
                  {{#if @model.cssVariables}}
                    <CardContainerCss @cssVariables={{@model.cssVariables}} />
                  {{else}}
                    <p><em>No theme variables added</em></p>
                  {{/if}}
                {{else if (eq section.id 'import-css')}}
                  {{! the cardInfo editor in the header owns the name and
                    description, so the importer only handles CSS here }}
                  <ThemeImporter @setCss={{@model.setCss}} />
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
            {{#if this.editMode}}
              <GridContainer>
                <h2>Reset CSS</h2>
                <div>
                  <ResetButton @reset={{@model.resetCss}} />
                </div>
              </GridContainer>
            {{/if}}
          </GridContainer>
        {{/if}}
      </:default>
    </ThemeDashboard>

    <style scoped>
      @layer baseComponent {
        .theme-description {
          max-width: 37.5rem;
          color: var(--muted-foreground);
        }
        .structured-theme-grid {
          gap: var(--boxel-sp-2xl);
        }
      }
    </style>
  </template>
}

// Same dashboard layout as Isolated; fields render as editors, the css
// imports field appears under Font Imports, and the view-only display sections are dropped.
class Edit extends Isolated {
  protected editMode = true;
}

export default class StructuredTheme extends Theme {
  static displayName = 'Theme';

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
  @field cardTitle = contains(StringField, {
    computeVia: function (this: StructuredTheme) {
      return this.cardInfo?.name ?? 'Untitled Theme';
    },
  });

  @field customCssImports = containsMany(CssImportField, {
    description:
      'CSS links added by hand (e.g. Adobe Fonts) that are kept alongside the derived Google Fonts imports.',
  });

  // Mirrors the docs guide's theme font loading: the Google Fonts stylesheets
  // for the theme's font stacks are derived from the font fields, so they can
  // never fall out of sync when a font is edited. CardContainer links
  // cssImports wherever the theme is applied.
  @field cssImports = containsMany(CssImportField, {
    computeVia: function (this: StructuredTheme) {
      let fontImports = googleFontImportsFor
        ? googleFontImportsFor([
            ...[this.rootVariables, this.darkModeVariables].flatMap((field) => [
              field?.fontSans,
              field?.fontSerif,
              field?.fontMono,
            ]),
            ...(this.typography?.cssVariableFields ?? [])
              .filter(({ cssVariableName }) =>
                cssVariableName.endsWith('-font-family'),
              )
              .map(({ value }) => value),
          ])
        : [];
      return [...(this.customCssImports ?? []), ...fontImports];
    },
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

  // The rows the Theme Visualizer's Fonts section previews, following the
  // active color mode with the other mode's stack as the fallback
  fontStacksFor = (isDarkMode?: boolean) => {
    let [preferred, fallback] = isDarkMode
      ? [this.darkModeVariables, this.rootVariables]
      : [this.rootVariables, this.darkModeVariables];
    let stack = (fieldName: 'fontSans' | 'fontSerif' | 'fontMono') =>
      preferred?.[fieldName] ?? fallback?.[fieldName];
    return [
      { label: 'sans-serif', stack: stack('fontSans') },
      { label: 'serif', stack: stack('fontSerif') },
      { label: 'monospace', stack: stack('fontMono') },
    ];
  };

  setCss = (content: string): boolean => {
    if (!content || !parseCssGroups) {
      return false;
    }
    const groups = parseCssGroups(content);
    const rootRules = groups?.get(':root');
    const darkRules = groups?.get('.dark');
    if (!rootRules?.size && !darkRules?.size) {
      return false;
    }
    applyCssRulesToField(this.rootVariables, rootRules);
    applyCssRulesToField(this.darkModeVariables, darkRules);
    return true;
  };

  // bound property so templates can pass it around; subclasses extend the
  // reset by overriding resetCssFields
  resetCss = () => {
    this.resetCssFields();
  };

  protected resetCssFields() {
    resetCssVariables(this.rootVariables);
    resetCssVariables(this.darkModeVariables);
    resetTypographyVariables(this.typography);
  }

  static isolated: BaseDefComponent = Isolated;
  static edit: BaseDefComponent = Edit;

  // CS-10787: emit a compact structured summary of the theme — title,
  // description, version, and the sub-field renderings for typography and
  // root variables. Avoids the noisy HTML-to-markdown fallback output
  // produced by the dashboard isolated template.
  static markdown: BaseDefComponent = class Markdown extends Component<
    typeof StructuredTheme
  > {
    get text() {
      let model = this.args.model;
      if (!model) {
        return '';
      }
      let parts: string[] = [];
      let title = model.cardTitle;
      if (title) {
        parts.push(`# ${markdownEscape(title)}`);
      }
      if (model.cardDescription) {
        parts.push(markdownEscape(model.cardDescription));
      }
      if (model.version) {
        parts.push(`Version: \`${model.version}\``);
      }
      let typographyEntries = model.typography?.cssVariableFields ?? [];
      if (typographyEntries.length) {
        parts.push('## Typography');
        let rows: string[] = [];
        for (let { name, value } of typographyEntries) {
          if (!value) continue;
          rows.push(`- ${markdownEscape(name ?? '')}: \`${value}\``);
        }
        if (rows.length) {
          parts.push(rows.join('\n'));
        }
      }
      let rootEntries = model.rootVariables?.cssVariableFields ?? [];
      let rootRows: string[] = [];
      for (let { name, value } of rootEntries) {
        if (!value) continue;
        rootRows.push(`- ${markdownEscape(name ?? '')}: \`${value}\``);
      }
      if (rootRows.length) {
        parts.push('## Root Variables');
        parts.push(rootRows.join('\n'));
      }
      return parts.join('\n\n');
    }
    <template>{{this.text}}</template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='structured-theme-embedded'>
        <header class='structured-theme-embedded__header'>
          <div>
            <h3 class='structured-theme-embedded__title'>
              <@fields.cardTitle />
            </h3>
            {{#if @model.cardDescription}}
              <p class='structured-theme-embedded__description'>
                <@fields.cardDescription />
              </p>
            {{/if}}
          </div>
          {{#if @model.version}}
            <span class='structured-theme-embedded__version'>
              v{{@model.version}}
            </span>
          {{/if}}
        </header>

        {{#if @model.rootVariables}}
          <div class='structured-theme-embedded__swatches'>
            <Swatch
              class='structured-theme-embedded__swatch'
              @label='Background'
              @color={{@model.rootVariables.background}}
            />
            <Swatch
              class='structured-theme-embedded__swatch'
              @label='Foreground'
              @color={{@model.rootVariables.foreground}}
            />
            <Swatch
              class='structured-theme-embedded__swatch'
              @label='Primary'
              @color={{@model.rootVariables.primary}}
            />
          </div>
        {{/if}}
      </article>

      <style scoped>
        .structured-theme-embedded {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
        }
        .structured-theme-embedded__header {
          display: flex;
          justify-content: space-between;
          gap: var(--boxel-sp);
          align-items: flex-start;
        }
        .structured-theme-embedded__title {
          margin: 0;
          font-size: var(--boxel-font-size-lg);
        }
        .structured-theme-embedded__description {
          margin: 0;
          color: var(--muted-foreground);
        }
        .structured-theme-embedded__version {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
        }
        .structured-theme-embedded__swatches {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
          gap: var(--boxel-sp-2xs);
          align-items: stretch;
        }
        .structured-theme-embedded__swatch :deep(.boxel-swatch) {
          width: 100%;
        }
        :deep(.boxel-swatch-value) {
          font-size: var(--boxel-caption-font-size);
        }
      </style>
    </template>
  };
}
