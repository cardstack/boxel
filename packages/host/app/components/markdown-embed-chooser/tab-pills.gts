import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import type { MarkdownEmbedRefType } from '@cardstack/host/services/markdown-embed-chooser';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    activeTab: MarkdownEmbedRefType;
    onTabChange: (tab: MarkdownEmbedRefType) => void;
  };
}

// Segmented pill control for the combined chooser's two tabs. Sits at the top
// of the active tab's left (search) column, directly above its search bar; the
// matching tabpanels render alongside in the modal body. Button ids are
// referenced by the panels' `aria-labelledby`, so they're kept stable here.
const MarkdownEmbedChooserTabPills: TemplateOnlyComponent<Signature> =
  <template>
    <div
      class='markdown-embed-chooser-tab-pills'
      role='tablist'
      aria-label='Choose card or file'
      ...attributes
    >
      <button
        type='button'
        role='tab'
        id='markdown-embed-chooser-tab-cards'
        aria-controls='markdown-embed-chooser-panel-cards'
        aria-selected={{if (eq @activeTab 'card') 'true' 'false'}}
        tabindex={{if (eq @activeTab 'card') '0' '-1'}}
        class={{cn
          'markdown-embed-chooser-tab-pills__tab'
          is-active=(eq @activeTab 'card')
        }}
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
        class={{cn
          'markdown-embed-chooser-tab-pills__tab'
          is-active=(eq @activeTab 'file')
        }}
        data-test-markdown-embed-chooser-tab='file'
        {{on 'click' (fn @onTabChange 'file')}}
      >
        Files
      </button>
    </div>
    <style scoped>
      .markdown-embed-chooser-tab-pills {
        display: flex;
        width: 100%;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-5xs);
        border-radius: 999px;
        background-color: var(--boxel-200);
      }
      .markdown-embed-chooser-tab-pills__tab {
        appearance: none;
        flex: 1 1 0;
        border: none;
        background: transparent;
        padding: var(--boxel-sp-4xs) var(--boxel-sp);
        border-radius: 999px;
        font: 600 var(--boxel-font-sm);
        color: var(--boxel-450);
        cursor: pointer;
        line-height: 1.4;
      }
      .markdown-embed-chooser-tab-pills__tab:hover {
        color: var(--boxel-dark);
      }
      .markdown-embed-chooser-tab-pills__tab.is-active {
        color: var(--boxel-dark);
        background-color: var(--boxel-light);
        box-shadow: var(--boxel-box-shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.15));
      }
      .markdown-embed-chooser-tab-pills__tab:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
    </style>
  </template>;

export default MarkdownEmbedChooserTabPills;
