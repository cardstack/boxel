import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { BoxelButton, FieldContainer } from '@cardstack/boxel-ui/components';
import { task } from 'ember-concurrency';
import type { GeoModel } from '../util/index';
import { geocodeLocation } from '../util/index';

interface QuickLocationsAddonSignature {
  Args: {
    model: GeoModel;
    locations: string[];
    canEdit?: boolean;
  };
}

export default class QuickLocationsAddon extends GlimmerComponent<QuickLocationsAddonSignature> {
  @tracked loadingLocation: string | null = null;

  private geocodeAndSet = task(async (locationName: string) => {
    this.loadingLocation = locationName;
    try {
      const result = await geocodeLocation(locationName);
      if (result && this.args.model) {
        this.args.model.lat = result.lat;
        this.args.model.lon = result.lon;
      }
    } catch (error) {
      console.error('Failed to geocode location:', error);
    } finally {
      this.loadingLocation = null;
    }
  });

  @action
  selectQuickLocation(locationName: string) {
    this.geocodeAndSet.perform(locationName);
  }

  <template>
    <FieldContainer
      class='quick-locations-addon'
      @vertical={{true}}
      @label='Quick Locations'
      @tag='label'
    >
      <div class='button-grid'>
        {{#each @locations as |locationName|}}
          <BoxelButton
            @kind='default'
            @size='small'
            @rectangular={{true}}
            @disabled={{not @canEdit}}
            @loading={{eq this.loadingLocation locationName}}
            {{on 'click' (fn this.selectQuickLocation locationName)}}
          >
            {{locationName}}
          </BoxelButton>
        {{/each}}
      </div>
    </FieldContainer>

    <style scoped>
      .button-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-3xs);
      }
    </style>
  </template>
}
