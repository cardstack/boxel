import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { BoxelButton } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import { isCardErrorJSONAPI } from '@cardstack/runtime-common';

import {
  type BfmSizeSpec,
  fileNameFromUrl,
  parseBfmSizeSpec,
} from '@cardstack/runtime-common/bfm-card-references';

import MiniCardChooser from '@cardstack/host/components/card-chooser/mini';
import MiniFileChooser from '@cardstack/host/components/file-chooser/mini';

import type {
  MarkdownEmbedInitialTarget,
  MarkdownEmbedRefType,
} from '@cardstack/host/services/markdown-embed-chooser';
import type StoreService from '@cardstack/host/services/store';

import type { CardDef, FileDef } from 'https://cardstack.com/base/card-api';

import MarkdownEmbedPreviewPane, { type OptionValue } from './pane';
import TabPills from './tab-pills';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    refType: MarkdownEmbedRefType;
    // The chooser's active tab + switch handler. The segmented pill control
    // lives at the top of this panel's left (search) column, so each visible
    // tab carries its own pills directly above its search bar — matching the
    // design where the tabs sit inside the search section, not as a
    // full-width bar across the modal.
    activeTab: MarkdownEmbedRefType;
    onTabChange: (tab: MarkdownEmbedRefType) => void;
    onInsert: (bfm: string, url: string) => void;
    // Optional edit-mode preload for this tab. When set, the tab starts in
    // `current` mode showing the placed target with Replace / Remove buttons;
    // the pane is seeded with the matching size + placement.
    initialTarget?: MarkdownEmbedInitialTarget;
    // Fired when the user clicks "Remove" in `current` mode. The modal
    // resolves its deferred with `{ remove: true }`.
    onRemove?: () => void;
  };
}

// One tab of the combined chooser: pairs the matching mini chooser (left
// panel) with the shared preview pane (right panel). Owns the tab-local
// `selectedTarget` so left-panel state — search query, highlighted row,
// scroll position — and pane state survive a switch to the other tab. In
// edit mode (`initialTarget` set), the left panel renders a "current target"
// tile with Replace / Remove buttons instead of the mini chooser; clicking
// Replace flips it back to the chooser so the user can swap in a new ref.
export default class MarkdownEmbedChooserTabPanel extends Component<Signature> {
  @service declare private store: StoreService;

  @tracked private selectedTarget: CardDef | FileDef | undefined;
  @tracked private selectedUrl: string | undefined;
  @tracked private mode: 'choose' | 'current' = 'choose';
  @tracked private dirty = false;

  private initialPaneFormat: OptionValue | undefined;
  private initialPaneWidth: number | string | undefined;
  private initialPaneHeight: number | undefined;
  private initialPaneKind: 'inline' | 'block' | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    let it = args.initialTarget;
    if (it) {
      this.mode = 'current';
      this.selectedUrl = it.url;
      let derived = derivePaneSeeds(normalizeSizeSpec(it.sizeSpec));
      this.initialPaneFormat = derived.format;
      this.initialPaneWidth = derived.width;
      this.initialPaneHeight = derived.height;
      this.initialPaneKind = derived.kind;
      this.loadTarget.perform(it.url, it.refType);
    }
  }

  private get isEditMode(): boolean {
    return !!this.args.initialTarget;
  }

  // 'DONE' until the user diverges from the initial preload, 'ACCEPT' once
  // they do — matches Zeplin 08B. Non-edit (choose) tabs keep the dynamic
  // "Insert as …" label.
  private get ctaLabelOverride(): string | undefined {
    if (!this.isEditMode) return undefined;
    return this.dirty ? 'ACCEPT' : 'DONE';
  }

  private get currentTargetLabel(): string {
    let t = this.selectedTarget;
    if (!t) return this.selectedUrl ?? '';
    if (this.args.refType === 'file') {
      return fileNameFromUrl(t.id ?? this.selectedUrl ?? '');
    }
    return (t as CardDef).cardTitle ?? t.id ?? this.selectedUrl ?? '';
  }

  @action
  private onCardSelect(url: string) {
    this.loadTarget.perform(url, 'card');
  }

  @action
  private onFileSelect(url: string) {
    this.loadTarget.perform(url, 'file');
  }

  // Restart on every pick so a slow earlier load can't stomp the newer one.
  private loadTarget = restartableTask(
    async (url: string, refType: MarkdownEmbedRefType) => {
      this.selectedUrl = url;
      let result =
        refType === 'card'
          ? await this.store.get(url)
          : await this.store.get<FileDef>(url, { type: 'file-meta' });
      if (isCardErrorJSONAPI(result)) {
        this.selectedTarget = undefined;
        return;
      }
      this.selectedTarget = result as CardDef | FileDef;
    },
  );

  @action
  private handleInsert(bfm: string) {
    let url = this.selectedTarget?.id ?? this.selectedUrl;
    if (!url) return;
    this.args.onInsert(bfm, url);
  }

  @action
  private onPaneDirtyChange(dirty: boolean) {
    this.dirty = dirty;
  }

  @action
  private startReplace() {
    this.mode = 'choose';
  }

  @action
  private clickRemove() {
    this.args.onRemove?.();
  }

  <template>
    <div
      class='markdown-embed-chooser-tab-panel'
      data-test-markdown-embed-chooser-tab-panel={{@refType}}
      ...attributes
    >
      <div class='markdown-embed-chooser-tab-panel__left'>
        {{! Both tab panels stay mounted to preserve their state, so the pills
          render only in the active one — a single set of tabs in the DOM. }}
        {{#if (eq @refType @activeTab)}}
          <div class='markdown-embed-chooser-tab-panel__tabbar'>
            <TabPills @activeTab={{@activeTab}} @onTabChange={{@onTabChange}} />
          </div>
        {{/if}}
        {{#if (eq this.mode 'current')}}
          <div
            class='markdown-embed-chooser-tab-panel__current'
            data-test-markdown-embed-chooser-current
          >
            <span
              class='markdown-embed-chooser-tab-panel__current-label'
              data-test-markdown-embed-chooser-current-label
            >
              {{this.currentTargetLabel}}
            </span>
            <div class='markdown-embed-chooser-tab-panel__current-actions'>
              <BoxelButton
                {{on 'click' this.startReplace}}
                data-test-markdown-embed-chooser-replace
              >
                {{#if (eq @refType 'card')}}
                  Replace Card
                {{else}}
                  Replace File
                {{/if}}
              </BoxelButton>
              <BoxelButton
                @kind='secondary-light'
                {{on 'click' this.clickRemove}}
                data-test-markdown-embed-chooser-remove
              >
                {{#if (eq @refType 'card')}}
                  Remove Card
                {{else}}
                  Remove File
                {{/if}}
              </BoxelButton>
            </div>
          </div>
        {{else if (eq @refType 'card')}}
          <MiniCardChooser
            @onSelect={{this.onCardSelect}}
            @selected={{this.selectedUrl}}
          />
        {{else}}
          <MiniFileChooser
            @onSelect={{this.onFileSelect}}
            @onHighlight={{this.onFileSelect}}
            @selected={{this.selectedUrl}}
          />
        {{/if}}
      </div>
      <div class='markdown-embed-chooser-tab-panel__right'>
        {{#if this.selectedTarget}}
          <MarkdownEmbedPreviewPane
            @target={{this.selectedTarget}}
            @refType={{@refType}}
            @onInsert={{this.handleInsert}}
            @initialFormat={{this.initialPaneFormat}}
            @initialWidth={{this.initialPaneWidth}}
            @initialHeight={{this.initialPaneHeight}}
            @initialKind={{this.initialPaneKind}}
            @initialTargetUrl={{@initialTarget.url}}
            @ctaLabelOverride={{this.ctaLabelOverride}}
            @onDirtyChange={{this.onPaneDirtyChange}}
          />
        {{else}}
          <p
            class='markdown-embed-chooser-tab-panel__empty'
            data-test-markdown-embed-preview-empty
          >
            Search for a
            {{@refType}}
            &amp; preview its format here
          </p>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .markdown-embed-chooser-tab-panel {
        display: flex;
        width: 100%;
        height: 100%;
        min-height: 0;
        background-color: var(--boxel-light);
      }
      .markdown-embed-chooser-tab-panel__left,
      .markdown-embed-chooser-tab-panel__right {
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
      /* The chooser column is narrower than the preview column (~2:3), per the
         design. A single full-height divider between the two columns — no boxed
         borders, so the panels read as one continuous surface. The left
         column stacks the tab pills above the mini chooser. */
      .markdown-embed-chooser-tab-panel__left {
        flex: 2 1 0;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--boxel-300);
      }
      /* Pills sit at the top of the search column, directly above the search
         bar; the chooser below fills the remaining height. */
      .markdown-embed-chooser-tab-panel__tabbar {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs) 0;
      }
      /* The chooser (or current-target tile) fills the column below the pills.
         The mini choosers set their own `height: 100%`, which would resolve
         against the full column height and overflow past the pills — grow to
         the remaining space instead. */
      .markdown-embed-chooser-tab-panel__left > :deep(.mini-card-chooser),
      .markdown-embed-chooser-tab-panel__left > :deep(.mini-file-chooser),
      .markdown-embed-chooser-tab-panel__current {
        flex: 1 1 auto;
        min-height: 0;
        height: auto;
      }
      .markdown-embed-chooser-tab-panel__right {
        flex: 3 1 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
        /* The preview column reads as an off-white surface, distinct from the
           white chooser column on the left. */
        background-color: #fbf8f8;
      }
      /* Centered placeholder shown until a row is picked and its instance
         resolves; the pane mounts in its place once a target arrives. */
      .markdown-embed-chooser-tab-panel__empty {
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: var(--boxel-sp);
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        text-align: center;
      }
      .markdown-embed-chooser-tab-panel__current {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
        text-align: center;
      }
      .markdown-embed-chooser-tab-panel__current-label {
        font: 600 var(--boxel-font);
        word-break: break-word;
      }
      .markdown-embed-chooser-tab-panel__current-actions {
        display: flex;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

function normalizeSizeSpec(
  input: BfmSizeSpec | string | undefined,
): BfmSizeSpec | undefined {
  if (!input) return undefined;
  if (typeof input === 'string') {
    return parseBfmSizeSpec(input) ?? undefined;
  }
  return input;
}

interface PaneSeeds {
  format?: OptionValue;
  width?: number | string;
  height?: number;
  kind?: 'inline' | 'block';
}

function derivePaneSeeds(spec: BfmSizeSpec | undefined): PaneSeeds {
  if (!spec) {
    return {};
  }
  if (spec.format === 'atom') {
    return { format: 'atom', kind: 'inline' };
  }
  if (spec.format === 'embedded') {
    return { format: 'embedded', kind: 'block' };
  }
  if (spec.format === 'isolated') {
    return { format: 'isolated', kind: 'block' };
  }
  // Fitted with optional W×H.
  return {
    format: 'custom',
    width: spec.width,
    height: spec.height,
    kind: 'block',
  };
}
