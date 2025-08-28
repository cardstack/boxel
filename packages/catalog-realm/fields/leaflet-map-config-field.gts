import { Component, FieldDef } from 'https://cardstack.com/base/card-api';
import { action } from '@ember/object';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import StringField from 'https://cardstack.com/base/string';
import { contains, field } from 'https://cardstack.com/base/card-api';

class AtomTemplate extends Component<typeof LeafletMapConfigField> {
  get displayValue() {
    const tileserverUrl = this.args.model?.tileserverUrl;

    if (tileserverUrl) {
      return `Custom tileserver: ${tileserverUrl}`;
    }

    return 'Default map settings';
  }

  <template>
    <div class='map-config-display'>
      <span class='config-info'>{{this.displayValue}}</span>
    </div>

    <style scoped>
      .map-config-display {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        flex-shrink: 0;
      }

      .config-info {
        font-size: 14px;
        color: var(--boxel-text-muted);
        line-height: normal;
      }
    </style>
  </template>
}

class EditTemplate extends Component<typeof LeafletMapConfigField> {
  get tileserverUrlValue() {
    return this.args.model?.tileserverUrl || '';
  }

  @action
  updateTileserverUrl(value: string) {
    if (this.args.model) {
      this.args.model.tileserverUrl = value || undefined;
    }
  }

  <template>
    <div class='edit-template'>
      <div class='config-section'>
        <h4 class='section-title'>Map Configuration</h4>
        <p class='section-description'>
          Configure map display settings and behavior
        </p>
      </div>

      <div class='field-group'>
        <label class='field-label'>Tile Server URL</label>
        <BoxelInput
          type='text'
          placeholder='https://tile.openstreetmap.org/{z}/{x}/{y}.png'
          @value={{this.tileserverUrlValue}}
          @onInput={{this.updateTileserverUrl}}
        />
        <div class='field-help'>
          Leave empty to use default OpenStreetMap tiles
        </div>
      </div>
    </div>

    <style scoped>
      .edit-template {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-md);
      }

      .config-section {
        border-bottom: 1px solid var(--boxel-border-color);
        padding-bottom: var(--boxel-sp-md);
      }

      .section-title {
        margin: 0 0 var(--boxel-sp-xs) 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--boxel-text-color);
      }

      .section-description {
        margin: 0;
        font-size: 14px;
        color: var(--boxel-text-muted);
        line-height: 1.4;
      }

      .field-group {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .field-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--boxel-text-color);
      }

      .field-help {
        font-size: 12px;
        color: var(--boxel-text-muted);
        line-height: 1.3;
      }

      .checkbox-group {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .checkbox-label {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        cursor: pointer;
        font-size: 14px;
      }

      .checkbox-label input[type='checkbox'] {
        margin: 0;
      }

      .checkbox-text {
        color: var(--boxel-text-color);
      }
    </style>
  </template>
}

export class LeafletMapConfigField extends FieldDef {
  static displayName = 'Map Configuration';

  @field tileserverUrl = contains(StringField);

  static atom = AtomTemplate;
  static embedded = EditTemplate;
}
