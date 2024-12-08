import WorldWwwIcon from '@cardstack/boxel-icons/world-www';
import { UrlField } from './url';
import { Component } from 'https://cardstack.com/base/card-api';

export class WebsiteField extends UrlField {
  static icon = WorldWwwIcon;
  static displayName = 'Website';

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model}}
        <div class='row'>
          <WorldWwwIcon class='icon' />
          <span>{{@model}}</span>
        </div>
      {{/if}}
      <style scoped>
        .row {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
        }
        .icon {
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          flex-shrink: 0;
        }
      </style>
    </template>
  };
}
