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

  @action onCancel() {
    this.selectedUrl = undefined;
  }

  <template>
    <FreestyleUsage @name='MiniCardChooser'>
      <:description>
        Compact, inline card picker for side-by-side layouts. Wraps
        <code>SearchPanel</code>
        with a fluid 100%-of-parent envelope and reuses the existing recents
        section in
        <code>SearchContent</code>. The hosting container owns dismissal — this
        primitive only fires
        <code>onSelect</code>
        with the selected card URL.
      </:description>
      <:example>
        <div class='example-container'>
          <MiniCardChooser
            @onSelect={{this.onSelect}}
            @onCancel={{this.onCancel}}
          />
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
        <Args.Action
          @name='onCancel'
          @description='Declared for parity with later compositions; the primitive does not render its own cancel trigger.'
        />
        <Args.String
          @name='searchKey'
          @description='Optional initial search term.'
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
