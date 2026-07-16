import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { BoxelButton } from '@cardstack/boxel-ui/components';
import type {
  BrokenLinkErrorDoc,
  BrokenLinkItemType,
  BrokenLinkState,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  isCardErrorJSONAPI,
  type CardErrorJSONAPI,
} from '@cardstack/runtime-common';

import {
  cardTypeName,
  fileNameFromUrl,
  type BfmSizeSpec,
} from '@cardstack/runtime-common/bfm-card-references';

import MiniCardChooser from '@cardstack/host/components/card-chooser/mini';
import MiniFileChooser from '@cardstack/host/components/file-chooser/mini';

import type {
  MarkdownEmbedInitialTarget,
  MarkdownEmbedRefType,
} from '@cardstack/host/services/markdown-embed-chooser';
import type StoreService from '@cardstack/host/services/store';

import MarkdownEmbedPreviewPane from './pane';
import MarkdownEmbedPreview from './preview';
import TabPills from './tab-pills';

import type EmbedFormatSelection from './format-selection';
import type { CardDef, FileDef } from '@cardstack/base/card-api';

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
    // The shared format/placement/size selection, owned by the modal and
    // passed to both tabs' panes so the choice sticks across a tab switch.
    selection: EmbedFormatSelection;
    // Optional edit-mode preload for this tab. When set, the tab starts in
    // `current` mode showing the placed target with Replace / Remove buttons.
    // (The pane's format seed comes from the shared `@selection`, which the
    // modal seeds from this same target.)
    initialTarget?: MarkdownEmbedInitialTarget;
    // The editing document's own URL. The label and the inserted ref are both
    // relativized against it, so a fallback URL label reads as `../Type/id` —
    // the same form the pane serializes into the directive.
    documentBaseUrl?: string;
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
  // Set when the picked/preloaded ref fails to resolve (deleted, moved, no
  // permission). Distinguishes "resolution failed" from "still loading /
  // nothing picked" so the pane can render the broken-ref visual instead of
  // the empty placeholder.
  @tracked private selectedError: CardErrorJSONAPI | undefined;
  @tracked private mode: 'choose' | 'current' = 'choose';

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    let it = args.initialTarget;
    if (it) {
      this.mode = 'current';
      this.selectedUrl = it.url;
      this.loadTarget.perform(it.url, it.refType);
    }
  }

  private get isEditMode(): boolean {
    return !!this.args.initialTarget;
  }

  // URL currently staged for insertion: the resolved target wins, falling back
  // to the picked URL while its instance is still loading.
  private get currentUrl(): string | undefined {
    return this.selectedTarget?.id ?? this.selectedUrl;
  }

  // In edit mode, the user has diverged once either the shared format selection
  // changed or they swapped in a different target (Replace).
  private get targetChanged(): boolean {
    let initial = this.args.initialTarget?.url;
    if (initial === undefined) return false;
    return this.currentUrl !== initial;
  }

  // 'Done' until the user diverges from the initial preload, 'Accept' once
  // they do — matches Zeplin 08B. Non-edit (choose) tabs keep the dynamic
  // "Insert as …" label.
  private get ctaLabelOverride(): string | undefined {
    if (!this.isEditMode) return undefined;
    let dirty = this.args.selection.isDirty || this.targetChanged;
    return dirty ? 'Accept' : 'Done';
  }

  // The current-target tile renders the placed card/file as a compact fitted
  // chip — a fixed Double Strip (250×65), independent of the format the user
  // picks for the actual embed in the preview pane. It's an identity marker for
  // "what's placed here now", not the embed being configured.
  private get currentTileSize(): BfmSizeSpec {
    return { format: 'fitted', width: 250, height: 65 };
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
  // Clear `selectedTarget` up front so the pane unmounts to its placeholder
  // while the new instance loads — otherwise a quick Insert during the load
  // window would serialize the previously-resolved target's URL.
  private loadTarget = restartableTask(
    async (url: string, refType: MarkdownEmbedRefType) => {
      this.selectedUrl = url;
      this.selectedTarget = undefined;
      this.selectedError = undefined;
      let result =
        refType === 'card'
          ? await this.store.get(url)
          : await this.store.get<FileDef>(url, { type: 'file-meta' });
      if (isCardErrorJSONAPI(result)) {
        // Keep `selectedUrl` and leave `selectedTarget` undefined; the pane
        // renders the broken-ref visual from `selectedError` instead of the
        // resolved embed.
        this.selectedError = result;
        return;
      }
      this.selectedTarget = result as CardDef | FileDef;
    },
  );

  // The pane mounts once a row is picked and either resolves (selectedTarget)
  // or fails (selectedError); the empty placeholder shows only before then.
  private get hasPreview(): boolean {
    return !!this.selectedTarget || !!this.selectedError;
  }

  // Broken-ref state threaded to the pane. Each is undefined unless the load
  // failed, so the pane renders the resolved embed on the happy path and the
  // broken visual only when `selectedError` is set.
  private get brokenUrl(): string | undefined {
    return this.selectedError ? this.selectedUrl : undefined;
  }

  private get brokenState(): BrokenLinkState | undefined {
    if (!this.selectedError) return undefined;
    return this.selectedError.status === 404 ? 'not-found' : 'error';
  }

  private get brokenErrorDoc(): BrokenLinkErrorDoc | undefined {
    let e = this.selectedError;
    if (!e) return undefined;
    return {
      status: e.status,
      title: e.title,
      message: e.message,
      stack: e.meta?.stack ?? undefined,
      additionalErrors: e.additionalErrors ?? null,
    };
  }

  // Card refs label by type name; file refs label by filename — matching the
  // label the base `linksTo` broken visual derives for cards.
  private get brokenDisplayName(): string | undefined {
    if (!this.selectedError || !this.selectedUrl) return undefined;
    return this.args.refType === 'file'
      ? fileNameFromUrl(this.selectedUrl)
      : cardTypeName(this.selectedUrl);
  }

  // Drives the broken-ref overlay headline ("Linked file not found" vs the
  // card wording) so a broken `:file[...]` ref doesn't read as a card.
  private get brokenItemType(): BrokenLinkItemType | undefined {
    if (!this.selectedError) return undefined;
    return this.args.refType === 'file' ? 'file' : 'card';
  }

  @action
  private handleInsert(bfm: string) {
    let url = this.currentUrl;
    if (!url) return;
    this.args.onInsert(bfm, url);
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
            <MarkdownEmbedPreview
              class='markdown-embed-chooser-tab-panel__current-preview'
              @target={{this.selectedTarget}}
              @format='fitted'
              @sizeSpec={{this.currentTileSize}}
              @kind='block'
              @brokenUrl={{this.brokenUrl}}
              @brokenState={{this.brokenState}}
              @brokenDisplayName={{this.brokenDisplayName}}
              @brokenItemType={{this.brokenItemType}}
              @errorDoc={{this.brokenErrorDoc}}
              data-test-markdown-embed-chooser-current-preview
            />
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
        {{#if this.hasPreview}}
          <MarkdownEmbedPreviewPane
            @target={{this.selectedTarget}}
            @refType={{@refType}}
            @selection={{@selection}}
            @documentBaseUrl={{@documentBaseUrl}}
            @onInsert={{this.handleInsert}}
            @ctaLabelOverride={{this.ctaLabelOverride}}
            @brokenUrl={{this.brokenUrl}}
            @brokenState={{this.brokenState}}
            @brokenDisplayName={{this.brokenDisplayName}}
            @brokenItemType={{this.brokenItemType}}
            @errorDoc={{this.brokenErrorDoc}}
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
           white chooser column on the left — same token as the inner viewport. */
        background-color: var(--boxel-100);
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
      /* The fitted chip carries its own fixed footprint; keep it from
         stretching to the centered column's cross axis. */
      .markdown-embed-chooser-tab-panel__current-preview {
        flex: 0 0 auto;
      }
      .markdown-embed-chooser-tab-panel__current-actions {
        display: flex;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
