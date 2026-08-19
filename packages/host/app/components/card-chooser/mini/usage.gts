import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import MiniCardChooser from './index';

export default class MiniCardChooserUsage extends Component {
  @tracked selectedUrl: string | undefined;

  @action onSelect(url: string) {
    this.selectedUrl = url;
  }

  <template>
    <FreestyleUsage @name='MiniCardChooser'>
      <:description>
        Compact, inline card picker for side-by-side layouts. Wraps
        <code>SearchPanel</code>
        with a fluid 100%-of-parent envelope and renders the mini visual variant
        of
        <code>SearchContent</code>: single-line rows, no per-section &quot;show
        only&quot; toggle, results count visible on every section, and a
        pill-shaped show-more button. The hosting container owns dismissal —
        this primitive only fires
        <code>onSelect</code>
        with the selected card URL.
      </:description>
      <:example>
        <div class='example-container'>
          <MiniCardChooser @onSelect={{this.onSelect}} />
        </div>
        {{#if this.selectedUrl}}
          <p class='selection-readout' data-test-mini-card-chooser-selection>
            Selected:
            <code>{{this.selectedUrl}}</code>
          </p>
        {{/if}}
      </:example>
      <:api as |Args|>
        <Args.Action
          @name='onSelect'
          @description='Called with the selected card URL (no .json suffix).'
          @required={{true}}
        />
        <Args.String
          @name='initialSearchKey'
          @description='Optional initial search term. Read once at mount; subsequent parent updates are ignored.'
        />
        <Args.String
          @name='selected'
          @description='URL of the currently selected card. The matching row gets the teal selection fill + checkmark.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .example-container {
        width: 360px;
        height: 480px;
        border: 1px solid var(--boxel-border-color, var(--boxel-300));
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .selection-readout {
        margin-top: var(--boxel-sp-xs);
        font: var(--boxel-font-sm);
      }
    </style>
  </template>
}
