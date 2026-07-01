import Component from '@glimmer/component';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import type { MarkdownEmbedRefType } from '@cardstack/host/services/markdown-embed-chooser';

import EmbedFormatSelection, {
  type FormatSelectionSeeds,
} from './format-selection';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    activeTab: MarkdownEmbedRefType;
    // Initial format/placement/size for the shared selection (edit-mode preload
    // in the modal; empty in choose mode).
    seeds: FormatSelectionSeeds;
  };
  Blocks: {
    cards: [EmbedFormatSelection];
    files: [EmbedFormatSelection];
  };
}

// The two tabpanels for the combined chooser. The matching segmented pill
// control sits at the top of each panel's left search column (see
// `tab-pills.gts`); each panel's `aria-labelledby` points back to its pill
// button by id. Both panels stay mounted — the inactive one is `display: none`
// rather than `{{#if}}`'d out — so each tab's mini-chooser keeps its search
// query, highlighted row, scroll position, and the pane's W×H / format
// selection across a switch.
export default class MarkdownEmbedChooserTabs extends Component<Signature> {
  // Created once per modal-open: this component lives inside the modal's
  // `{{#if request}}` block, so it (and the selection) is torn down on close
  // and rebuilt on the next chooser invocation — seeded from the edited
  // directive in edit mode. Yielded to both tab blocks so the format choice
  // is shared and survives a tab switch.
  private selection = new EmbedFormatSelection(this.args.seeds);

  <template>
    <div class='markdown-embed-chooser-tabs' ...attributes>
      <div
        role='tabpanel'
        id='markdown-embed-chooser-panel-cards'
        aria-labelledby='markdown-embed-chooser-tab-cards'
        class={{cn
          'markdown-embed-chooser-tabs__panel'
          is-hidden=(unless (eq @activeTab 'card') true)
        }}
        data-test-markdown-embed-chooser-panel='card'
      >
        {{yield this.selection to='cards'}}
      </div>
      <div
        role='tabpanel'
        id='markdown-embed-chooser-panel-files'
        aria-labelledby='markdown-embed-chooser-tab-files'
        class={{cn
          'markdown-embed-chooser-tabs__panel'
          is-hidden=(unless (eq @activeTab 'file') true)
        }}
        data-test-markdown-embed-chooser-panel='file'
      >
        {{yield this.selection to='files'}}
      </div>
    </div>
    <style scoped>
      .markdown-embed-chooser-tabs {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
      }
      .markdown-embed-chooser-tabs__panel {
        flex: 1 1 auto;
        min-height: 0;
      }
      .markdown-embed-chooser-tabs__panel.is-hidden {
        display: none;
      }
    </style>
  </template>
}
