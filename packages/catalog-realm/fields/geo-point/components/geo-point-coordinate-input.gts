import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { not } from '@cardstack/boxel-ui/helpers';
import { FieldContainer, BoxelInput } from '@cardstack/boxel-ui/components';
import type { GeoModel } from '../util/index';

interface CoordinateInputSignature {
  Args: {
    model: GeoModel;
    canEdit?: boolean;
  };
}

export default class GeoPointCoordinateInput extends GlimmerComponent<CoordinateInputSignature> {
  get latState(): 'valid' | 'invalid' | 'none' {
    const lat = this.args.model.lat;
    if (lat == null) return 'none';
    return lat >= -90 && lat <= 90 ? 'valid' : 'invalid';
  }

  get latError(): string | undefined {
    return this.latState === 'invalid'
      ? 'Latitude must be between -90 and 90'
      : undefined;
  }

  get lonState(): 'valid' | 'invalid' | 'none' {
    const lon = this.args.model.lon;
    if (lon == null) return 'none';
    return lon >= -180 && lon <= 180 ? 'valid' : 'invalid';
  }

  get lonError(): string | undefined {
    return this.lonState === 'invalid'
      ? 'Longitude must be between -180 and 180'
      : undefined;
  }

  @action
  setLat(val: string) {
    if (this.args.model) {
      this.args.model.lat = val === '' ? null : Number(val);
    }
  }

  @action
  setLon(val: string) {
    if (this.args.model) {
      this.args.model.lon = val === '' ? null : Number(val);
    }
  }

  <template>
    <div class='geo-point-coordinate-input'>
      <section class='input-stack'>
        <div class='field-wrapper'>
          <FieldContainer
            class='coord-field lat'
            @vertical={{true}}
            @label='Latitude'
            @tag='label'
          >
            <BoxelInput
              @type='number'
              @value={{@model.lat}}
              @onInput={{this.setLat}}
              @disabled={{not @canEdit}}
              @state={{this.latState}}
              @errorMessage={{this.latError}}
            />
          </FieldContainer>
        </div>

        <div class='field-wrapper'>
          <FieldContainer
            class='coord-field lon'
            @vertical={{true}}
            @label='Longitude'
            @tag='label'
          >
            <BoxelInput
              @type='number'
              @value={{@model.lon}}
              @onInput={{this.setLon}}
              @disabled={{not @canEdit}}
              @state={{this.lonState}}
              @errorMessage={{this.lonError}}
            />
          </FieldContainer>
        </div>
      </section>
    </div>

    <style scoped>
      .geo-point-coordinate-input {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }

      .input-stack {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .coord-field :global(.boxel-input) {
        border-radius: var(--boxel-border-radius-sm);
        border: 1px solid var(--boxel-border-color);
        width: 100%;
      }
    </style>
  </template>
}
