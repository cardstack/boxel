import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { eq } from '@cardstack/boxel-ui/helpers';

import type { MarkdownEmbedRefType } from '@cardstack/host/services/markdown-embed-chooser';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    activeTab: MarkdownEmbedRefType;
    onTabChange: (tab: MarkdownEmbedRefType) => void;
  };
  Blocks: {
    cards: [];
    files: [];
  };
}

// Two-tab shell for the combined chooser. Both panels stay mounted — the
// inactive one is `display: none` rather than `{{#if}}`'d out — so each tab's
// mini-chooser keeps its search query, highlighted row, scroll position, and
// the pane's W×H / format selection across a switch.
const MarkdownEmbedChooserTabs: TemplateOnlyComponent<Signature> = <template>
  <div class='markdown-embed-chooser-tabs' ...attributes>
    <div
      class='markdown-embed-chooser-tabs__strip'
      role='tablist'
      aria-label='Choose card or file'
    >
      <button
        type='button'
        role='tab'
        id='markdown-embed-chooser-tab-cards'
        aria-controls='markdown-embed-chooser-panel-cards'
        aria-selected={{if (eq @activeTab 'card') 'true' 'false'}}
        tabindex={{if (eq @activeTab 'card') '0' '-1'}}
        class='markdown-embed-chooser-tabs__tab
          {{if (eq @activeTab "card") "is-active"}}'
        data-test-markdown-embed-chooser-tab='card'
        {{on 'click' (fn @onTabChange 'card')}}
      >
        Cards
      </button>
      <button
        type='button'
        role='tab'
        id='markdown-embed-chooser-tab-files'
        aria-controls='markdown-embed-chooser-panel-files'
        aria-selected={{if (eq @activeTab 'file') 'true' 'false'}}
        tabindex={{if (eq @activeTab 'file') '0' '-1'}}
        class='markdown-embed-chooser-tabs__tab
          {{if (eq @activeTab "file") "is-active"}}'
        data-test-markdown-embed-chooser-tab='file'
        {{on 'click' (fn @onTabChange 'file')}}
      >
        Files
      </button>
    </div>
    <div
      role='tabpanel'
      id='markdown-embed-chooser-panel-cards'
      aria-labelledby='markdown-embed-chooser-tab-cards'
      class='markdown-embed-chooser-tabs__panel
        {{unless (eq @activeTab "card") "is-hidden"}}'
      data-test-markdown-embed-chooser-panel='card'
    >
      {{yield to='cards'}}
    </div>
    <div
      role='tabpanel'
      id='markdown-embed-chooser-panel-files'
      aria-labelledby='markdown-embed-chooser-tab-files'
      class='markdown-embed-chooser-tabs__panel
        {{unless (eq @activeTab "file") "is-hidden"}}'
      data-test-markdown-embed-chooser-panel='file'
    >
      {{yield to='files'}}
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
    .markdown-embed-chooser-tabs__strip {
      flex: 0 0 auto;
      display: flex;
      gap: var(--boxel-sp-xs);
      padding: 0 var(--boxel-sp-xs);
      border-bottom: 1px solid var(--boxel-300);
    }
    .markdown-embed-chooser-tabs__tab {
      appearance: none;
      background: none;
      border: none;
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      font: 600 var(--boxel-font-sm);
      color: var(--boxel-450);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
    }
    .markdown-embed-chooser-tabs__tab:hover {
      color: var(--boxel-dark);
    }
    .markdown-embed-chooser-tabs__tab.is-active {
      color: var(--boxel-dark);
      border-bottom-color: var(--boxel-highlight);
    }
    .markdown-embed-chooser-tabs__tab:focus-visible {
      outline: 2px solid var(--boxel-highlight);
      outline-offset: 2px;
    }
    .markdown-embed-chooser-tabs__panel {
      flex: 1 1 auto;
      min-height: 0;
      padding-top: var(--boxel-sp-sm);
    }
    .markdown-embed-chooser-tabs__panel.is-hidden {
      display: none;
    }
  </style>
</template>;

export default MarkdownEmbedChooserTabs;
