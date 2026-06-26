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

interface Signature {
  Element: HTMLDivElement;
  Args: {
    refType: MarkdownEmbedRefType;
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
    return (t as CardDef).title ?? t.id ?? this.selectedUrl ?? '';
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
            @selected={{this.selectedUrl}}
          />
        {{/if}}
      </div>
      <div class='markdown-embed-chooser-tab-panel__right'>
        <MarkdownEmbedPreviewPane
          @target={{this.selectedTarget}}
          @refType={{@refType}}
          @onInsert={{this.handleInsert}}
          @initialFormat={{this.initialPaneFormat}}
          @initialWidth={{this.initialPaneWidth}}
          @initialHeight={{this.initialPaneHeight}}
          @initialKind={{this.initialPaneKind}}
          @ctaLabelOverride={{this.ctaLabelOverride}}
          @onDirtyChange={{this.onPaneDirtyChange}}
        />
      </div>
    </div>
    <style scoped>
      .markdown-embed-chooser-tab-panel {
        display: flex;
        gap: var(--boxel-sp);
        width: 100%;
        height: 100%;
        min-height: 0;
      }
      .markdown-embed-chooser-tab-panel__left,
      .markdown-embed-chooser-tab-panel__right {
        flex: 1 1 0;
        min-width: 0;
        min-height: 0;
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        background-color: var(--boxel-light);
      }
      .markdown-embed-chooser-tab-panel__current {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp);
        height: 100%;
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
