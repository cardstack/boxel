import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { task } from 'ember-concurrency';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import type { GeoModel } from '../util/index';

interface CurrentLocationAddonSignature {
  Args: {
    model: GeoModel;
    canEdit?: boolean;
  };
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

export default class CurrentLocationAddon extends GlimmerComponent<CurrentLocationAddonSignature> {
  private locateTask = task(async () => {
    if (!navigator.geolocation) {
      throw new Error('Geolocation is not supported by this browser.');
    }
    const position = await getPosition();
    if (this.args.model) {
      this.args.model.lat = position.coords.latitude;
      this.args.model.lon = position.coords.longitude;
    }
  });

  get errorMessage(): string | null {
    const error = this.locateTask.last?.error;
    if (!error) return null;
    return error instanceof GeolocationPositionError
      ? `Location error: ${error.message}`
      : (error as Error).message;
  }

  @action
  getCurrentLocation() {
    this.locateTask.perform();
  }

  <template>
    <div class='current-location-addon'>
      <BoxelButton
        @kind='primary-dark'
        @size='small'
        @loading={{this.locateTask.isRunning}}
        @disabled={{not @canEdit}}
        class='current-location-button'
        {{on 'click' this.getCurrentLocation}}
      >
        <MapPinIcon width='14' height='14' />
        Use Current Location
      </BoxelButton>

      {{#if this.errorMessage}}
        <div class='error-message'>
          {{this.errorMessage}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .current-location-addon {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }

      .current-location-button {
        gap: var(--boxel-sp-2xs);
      }

      .error-message {
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-sm);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        background: var(--boxel-error-100);
        border-left: 3px solid var(--boxel-error-300);
        color: var(--boxel-error-300);
      }
    </style>
  </template>
}
