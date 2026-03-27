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
import GeoPointField from '../fields/geo-point';
import CodeSnippet from '../components/code-snippet';

// 1. Basic standard (no config needed)
const basicFieldCode = `@field basic = contains(GeoPointField);`;

// 2. With current location tracker
const withCurrentLocationFieldCode = `@field withCurrentLocation = contains(GeoPointField, {
  configuration: {
    options: {
      showCurrentLocation: true,
    },
  },
});`;

// 3. With quick locations
const withQuickLocationsFieldCode = `@field withQuickLocations = contains(GeoPointField, {
  configuration: {
    options: {
      quickLocations: ['London', 'Paris', 'Tokyo', 'New York'],
    },
  },
});`;

// 4. Combined: current location + quick locations
const combinedFieldCode = `@field combined = contains(GeoPointField, {
  configuration: {
    options: {
      showCurrentLocation: true,
      quickLocations: ['London', 'Paris', 'Tokyo', 'New York'],
    },
  },
});`;

// 5. Map picker variant (no options)
const mapPickerFieldCode = `@field mapPicker = contains(GeoPointField, {
  configuration: {
    variant: 'map-picker',
  },
});`;

// 6. Map picker with showCurrentLocation (MapPickerOptions)
const mapPickerWithCurrentLocationFieldCode = `@field mapPickerWithCurrentLocation = contains(GeoPointField, {
  configuration: {
    variant: 'map-picker',
    options: {
      mapHeight: '300px',
      showCurrentLocation: true,
    },
  },
});`;

// 7. Map picker with quickLocations (MapPickerOptions)
const mapPickerWithQuickLocationsFieldCode = `@field mapPickerWithQuickLocations = contains(GeoPointField, {
  configuration: {
    variant: 'map-picker',
    options: {
      mapHeight: '300px',
      quickLocations: ['London', 'Paris', 'Tokyo', 'New York'],
    },
  },
});`;

// 8. Map picker with both addons + map options (MapPickerOptions)
const mapPickerWithAddonsFieldCode = `@field mapPickerWithAddons = contains(GeoPointField, {
  configuration: {
    variant: 'map-picker',
    options: {
      tileserverUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      mapHeight: '300px',
      showCurrentLocation: true,
      quickLocations: ['London', 'Paris', 'Tokyo', 'New York'],
    },
  },
});`;

class GeoPointFieldSpecIsolated extends Component<typeof GeoPointFieldSpec> {
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
        {{! 2. With current location tracker }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withCurrentLocationFieldCode}} />
          <@fields.withCurrentLocation />
        </article>
        {{! 3. With quick locations }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withQuickLocationsFieldCode}} />
          <@fields.withQuickLocations />
        </article>
        {{! 4. Combined }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{combinedFieldCode}} />
          <@fields.combined />
        </article>
        {{! 5. Map picker variant }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{mapPickerFieldCode}} />
          <@fields.mapPicker />
        </article>
        {{! 6. Map picker with showCurrentLocation (using MapPickerOptions) }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{mapPickerWithCurrentLocationFieldCode}} />
          <@fields.mapPickerWithCurrentLocation />
        </article>
        {{! 7. Map picker with quickLocations (using MapPickerOptions) }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{mapPickerWithQuickLocationsFieldCode}} />
          <@fields.mapPickerWithQuickLocations />
        </article>
        {{! 8. Map picker with both addons (using MapPickerOptions) }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{mapPickerWithAddonsFieldCode}} />
          <@fields.mapPickerWithAddons />
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

class GeoPointFieldSpecEdit extends Component<typeof GeoPointFieldSpec> {
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
        {{! 2. With current location tracker }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withCurrentLocationFieldCode}} />
          <@fields.withCurrentLocation @format='edit' />
        </article>
        {{! 3. With quick locations }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withQuickLocationsFieldCode}} />
          <@fields.withQuickLocations @format='edit' />
        </article>
        {{! 4. Combined }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{combinedFieldCode}} />
          <@fields.combined @format='edit' />
        </article>
        {{! 5. Map picker variant }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{mapPickerFieldCode}} />
          <@fields.mapPicker @format='edit' />
        </article>
        {{! 6. Map picker with showCurrentLocation (using MapPickerOptions) }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{mapPickerWithCurrentLocationFieldCode}} />
          <@fields.mapPickerWithCurrentLocation @format='edit' />
        </article>
        {{! 7. Map picker with quickLocations (using MapPickerOptions) }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{mapPickerWithQuickLocationsFieldCode}} />
          <@fields.mapPickerWithQuickLocations @format='edit' />
        </article>
        {{! 8. Map picker with both addons (using MapPickerOptions) }}
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{mapPickerWithAddonsFieldCode}} />
          <@fields.mapPickerWithAddons @format='edit' />
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

export class GeoPointFieldSpec extends Spec {
  static displayName = 'Geo Point Field Spec';

  // 1. Basic standard (no config)
  @field basic = contains(GeoPointField);

  // 2. With current location tracker
  @field withCurrentLocation = contains(GeoPointField, {
    configuration: {
      options: {
        showCurrentLocation: true,
      },
    },
  });

  // 3. With quick locations
  @field withQuickLocations = contains(GeoPointField, {
    configuration: {
      options: {
        quickLocations: ['London', 'Paris', 'Tokyo', 'New York'],
      },
    },
  });

  // 4. Combined: current location + quick locations
  @field combined = contains(GeoPointField, {
    configuration: {
      options: {
        showCurrentLocation: true,
        quickLocations: ['London', 'Paris', 'Tokyo', 'New York'],
      },
    },
  });

  // 5. Map picker variant (no options)
  @field mapPicker = contains(GeoPointField, {
    configuration: {
      variant: 'map-picker',
    },
  });

  // 6. Map picker with showCurrentLocation (using MapPickerOptions)
  @field mapPickerWithCurrentLocation = contains(GeoPointField, {
    configuration: {
      variant: 'map-picker',
      options: {
        mapHeight: '300px',
        showCurrentLocation: true,
      },
    },
  });

  // 7. Map picker with quickLocations (using MapPickerOptions)
  @field mapPickerWithQuickLocations = contains(GeoPointField, {
    configuration: {
      variant: 'map-picker',
      options: {
        mapHeight: '300px',
        quickLocations: ['London', 'Paris', 'Tokyo', 'New York'],
      },
    },
  });

  // 8. Map picker with both addons + map options (using MapPickerOptions)
  @field mapPickerWithAddons = contains(GeoPointField, {
    configuration: {
      variant: 'map-picker',
      options: {
        tileserverUrl:
          'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        mapHeight: '300px',
        showCurrentLocation: true,
        quickLocations: ['London', 'Paris', 'Tokyo', 'New York'],
      },
    },
  });

  static isolated =
    GeoPointFieldSpecIsolated as unknown as typeof Spec.isolated;
  static edit = GeoPointFieldSpecEdit as unknown as typeof Spec.edit;
}
