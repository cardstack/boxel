import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import MiniFileChooser from './index';

export default class MiniFileChooserUsage extends Component {
  @tracked selectedUrl: string | undefined;

  @action onSelect(url: string) {
    this.selectedUrl = url;
  }

  <template>
    <FreestyleUsage @name='MiniFileChooser'>
      <:description>
        Compact, inline file picker for side-by-side layouts — the file-side
        sibling of
        <code>MiniCardChooser</code>. Wraps a workspace dropdown (<code
        >RealmDropdown</code>) over the indexed file tree (<code
        >IndexedFileTree</code>) in a fluid 100%-of-parent envelope, plus an
        <code>Upload&hellip;</code>
        button and drag-and-drop upload (reusing the
        <code>file-upload</code>
        service). The hosting container owns confirmation/dismissal — this
        primitive only fires
        <code>onSelect</code>
        with the picked or uploaded file's absolute URL.
      </:description>
      <:example>
        <div class='example-container'>
          <MiniFileChooser @onSelect={{this.onSelect}} />
        </div>
        {{#if this.selectedUrl}}
          <p class='selection-readout' data-test-mini-file-chooser-selection>
            Selected:
            <code>{{this.selectedUrl}}</code>
          </p>
        {{/if}}
      </:example>
      <:api as |Args|>
        <Args.Action
          @name='onSelect'
          @description='Called with the absolute URL of the picked or uploaded file.'
          @required={{true}}
        />
        <Args.String
          @name='initialRealmURL'
          @description='Optional workspace to open on first render. Read once at mount; defaults to the first known realm.'
        />
        <Args.String
          @name='selected'
          @description='Absolute URL of the currently selected file. The matching tree row (when inside the open workspace) gets the selection highlight.'
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
