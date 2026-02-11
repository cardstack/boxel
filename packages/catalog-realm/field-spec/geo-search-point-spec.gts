import {
  Spec,
  SpecHeader,
  SpecReadmeSection,
  ExamplesWithInteractive,
  SpecModuleSection,
} from 'https://cardstack.com/base/spec';
import {
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import GeoSearchPointField from '../fields/geo-search-point';
import CodeSnippet from '../components/code-snippet';

// 1. Basic (no config)
const basicFieldCode = `@field basic = contains(GeoSearchPointField);`;

// 2. With top search results
const withTopResultsCode = `@field withTopResults = contains(GeoSearchPointField, {
  configuration: {
    options: {
      showTopSearchResults: true,
      topSearchResultsLimit: 5,
    },
  },
});`;

// 3. Top results without recent searches
const withoutRecentSearchesCode = `@field withoutRecentSearches = contains(GeoSearchPointField, {
  configuration: {
    options: {
      showTopSearchResults: true,
      topSearchResultsLimit: 5,
      showRecentSearches: false,
    },
  },
});`;

// 4. Combined: all features
const combinedCode = `@field combined = contains(GeoSearchPointField, {
  configuration: {
    options: {
      placeholder: 'Start typing an address...',
      showTopSearchResults: true,
      topSearchResultsLimit: 5,
      recentSearchesLimit: 5,
    },
  },
});`;

class GeoSearchPointFieldSpecIsolated extends Component<
  typeof GeoSearchPointFieldSpec
> {
  <template>
    <article class='container'>
      <SpecHeader @model={{@model}}>
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>

      <SpecReadmeSection @model={{@model}} @context={{@context}}>
        <@fields.readMe />
      </SpecReadmeSection>

      <ExamplesWithInteractive>
        {{! 1. Basic }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{basicFieldCode}} />
          <@fields.basic />
        </article>
        {{! 2. With top search results }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withTopResultsCode}} />
          <@fields.withTopResults />
        </article>
        {{! 3. Top results without recent searches }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withoutRecentSearchesCode}} />
          <@fields.withoutRecentSearches />
        </article>
        {{! 4. Combined }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{combinedCode}} />
          <@fields.combined />
        </article>
      </ExamplesWithInteractive>

      <SpecModuleSection @model={{@model}} />
    </article>
    <style scoped>
      .container {
        --boxel-spec-background-color: #ebeaed;
        --boxel-spec-code-ref-background-color: #e2e2e2;
        --boxel-spec-code-ref-text-color: #646464;

        height: 100%;
        min-height: max-content;
        padding: var(--boxel-sp);
        background-color: var(--boxel-spec-background-color);
      }
      .fields-configuration-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

class GeoSearchPointFieldSpecEdit extends Component<
  typeof GeoSearchPointFieldSpec
> {
  <template>
    <article class='container'>
      <SpecHeader @model={{@model}} @isEditMode={{true}}>
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>

      <SpecReadmeSection
        @model={{@model}}
        @context={{@context}}
        @isEditMode={{@canEdit}}
      >
        <@fields.readMe />
      </SpecReadmeSection>

      <ExamplesWithInteractive>
        {{! 1. Basic }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{basicFieldCode}} />
          <@fields.basic @format='edit' />
        </article>
        {{! 2. With top search results }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withTopResultsCode}} />
          <@fields.withTopResults @format='edit' />
        </article>
        {{! 3. Top results without recent searches }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withoutRecentSearchesCode}} />
          <@fields.withoutRecentSearches @format='edit' />
        </article>
        {{! 4. Combined }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{combinedCode}} />
          <@fields.combined @format='edit' />
        </article>
      </ExamplesWithInteractive>

      <SpecModuleSection @model={{@model}} />
    </article>
    <style scoped>
      .container {
        --boxel-spec-background-color: #ebeaed;
        --boxel-spec-code-ref-background-color: #e2e2e2;
        --boxel-spec-code-ref-text-color: #646464;

        height: 100%;
        min-height: max-content;
        padding: var(--boxel-sp);
        background-color: var(--boxel-spec-background-color);
      }
      .fields-configuration-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

export class GeoSearchPointFieldSpec extends Spec {
  static displayName = 'Geo Search Point Field Spec';

  // 1. Basic (no config)
  @field basic = contains(GeoSearchPointField);

  // 2. With top search results
  @field withTopResults = contains(GeoSearchPointField, {
    configuration: {
      options: {
        showTopSearchResults: true,
        topSearchResultsLimit: 5,
      },
    },
  });

  // 3. Top results without recent searches
  @field withoutRecentSearches = contains(GeoSearchPointField, {
    configuration: {
      options: {
        showTopSearchResults: true,
        topSearchResultsLimit: 5,
        showRecentSearches: false,
      },
    },
  });

  // 4. Combined: all features
  @field combined = contains(GeoSearchPointField, {
    configuration: {
      options: {
        placeholder: 'Start typing an address...',
        showTopSearchResults: true,
        topSearchResultsLimit: 5,
        recentSearchesLimit: 5,
      },
    },
  });

  static isolated =
    GeoSearchPointFieldSpecIsolated as unknown as typeof Spec.isolated;
  static edit = GeoSearchPointFieldSpecEdit as unknown as typeof Spec.edit;
}
