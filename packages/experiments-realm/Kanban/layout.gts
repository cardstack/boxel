// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ Layout Card — Modular, rearrangeable, snap-to-grid composition engine.
// One of 5 core artifact types: Surface | Story | Layout | Table | Flow.
// Dashboard and Kanban are derivations that extend this base.

import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string'; // ³
import { tracked } from '@glimmer/tracking'; // ⁵
import { on } from '@ember/modifier'; // ⁶
import Modifier from 'ember-modifier'; // ⁶ᵃ
import { get } from '@ember/helper'; // ⁷

// ⁷ᵃ Strips Boxel host chrome, hides hover overlays, forces card to fill parent
class Chromeless extends Modifier {
  modify(el: HTMLElement) {
    const strip = () => {
      // Hide host chrome and hover overlays
      el.querySelectorAll(
        '[data-test-card-header], [data-test-edit-button], [data-test-more-options-button], ' +
          '.card-container-header, .operator-mode-card-header, .overlay-card-header, ' +
          'header.card-header, .overlay-button, .card-container-overlay, ' +
          '[data-test-overlay-card-header], .hover-button',
      ).forEach((node) => ((node as HTMLElement).style.display = 'none'));
      // Force card container to fill the cell
      el.querySelectorAll(
        '.boxel-card-container, .fitted-format, [data-test-card-format="fitted"]',
      ).forEach((node) => {
        const n = node as HTMLElement;
        n.style.width = '100%';
        n.style.height = '100%';
      });
      const firstChild = el.firstElementChild as HTMLElement | null;
      if (firstChild) {
        firstChild.style.width = '100%';
        firstChild.style.height = '100%';
      }
    };
    strip();
    const observer = new MutationObserver(strip);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }
}

import { Button } from '@cardstack/boxel-ui/components'; // ⁹
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid'; // ¹⁰

import { GridPlacementField } from './grid-placement'; // ¹¹
import { GridSettingsField } from './Layout/grid-settings'; // ¹²
import { GridPlane } from './Layout/grid-plane'; // ¹³
import { GridManager } from './Layout/grid-interaction'; // ¹⁴
import {
  // ¹⁵
  type GridPlacement,
  type GridConfig,
  autoPlace,
} from './Layout/grid-engine';
import Owner from '@ember/owner';

// ── Helpers ──────────────────────────────────────────────────────────── // ¹⁶

function placementsToEngine(fields: GridPlacementField[]): GridPlacement[] {
  return (fields ?? []).map((f) => ({
    index: f.index ?? 0,
    col: f.col ?? 1,
    row: f.row ?? 1,
    colSpan: f.colSpan ?? 1,
    rowSpan: f.rowSpan ?? 1,
  }));
}

function configFromSettings(s: GridSettingsField | null): GridConfig {
  return {
    columns: s?.columns ?? 4,
    rows: s?.rows ?? 3,
    gap: s?.gapPx ?? 16,
    padding: s?.paddingPx ?? 24,
    rowHeight: s?.rowHeight || 'minmax(200px, 1fr)',
  };
}

// ── Layout CardDef ───────────────────────────────────────────────────── // ¹⁷

class Isolated extends Component<typeof Layout> {
  @tracked sidebarOpen = false;
  @tracked selectedCardIndex: number | null = null;
  @tracked showGridLines = true;

  gridManager: GridManager | null = null;
  containerEl: HTMLElement | null = null;
  saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.initManager();
  }

  initManager(): void {
    // ²⁶
    this.gridManager = new GridManager({
      config: () => this.engineConfig,
      placements: () => this.enginePlacements,
      containerElement: () => this.containerEl,
      onChange: (newPlacements) => this.commitPlacements(newPlacements),
      onSelect: (index) => {
        this.selectedCardIndex = index;
      },
    });
  }

  get engineConfig(): GridConfig {
    // ²⁷
    return configFromSettings(this.args.model?.gridSettings ?? null);
  }

  get enginePlacements(): GridPlacement[] {
    // ²⁸
    const fields = this.args.model?.placements;
    if (!fields || fields.length === 0) {
      // Auto-place if no placements exist yet
      const cardCount = this.args.model?.cards?.length ?? 0;
      if (cardCount > 0) {
        return autoPlace(cardCount, this.engineConfig);
      }
      return [];
    }
    return placementsToEngine(fields);
  }

  get manager(): GridManager {
    // ²⁹
    if (!this.gridManager) this.initManager();
    return this.gridManager!;
  }

  get hasCards(): boolean {
    // ³⁰
    return (this.args.model?.cards?.length ?? 0) > 0;
  }

  get selectedPlacement(): GridPlacement | null {
    // ³¹
    if (this.selectedCardIndex === null) return null;
    return (
      this.enginePlacements.find((p) => p.index === this.selectedCardIndex) ??
      null
    );
  }

  get cardCount(): number {
    // ³²
    return this.args.model?.cards?.length ?? 0;
  }

  get columnCount(): number {
    // ³³
    return this.engineConfig.columns;
  }

  // ── Actions ──────────────────────────────────────────────────────

  commitPlacements = (newPlacements: GridPlacement[]): void => {
    // ³⁴
    // Mutate existing FieldDef instances directly for instant reactivity.
    // Boxel auto-save writes behind — no debounce needed for the mutation.
    try {
      const model = this.args.model;
      if (!model) return;
      const existingFields = model.placements as
        | GridPlacementField[]
        | undefined;

      if (existingFields && existingFields.length > 0) {
        // Update existing fields in-place (triggers Glimmer reactivity immediately)
        for (const np of newPlacements) {
          const existing = existingFields.find(
            (f: GridPlacementField) => f.index === np.index,
          );
          if (existing) {
            existing.col = np.col;
            existing.row = np.row;
            existing.colSpan = np.colSpan;
            existing.rowSpan = np.rowSpan;
          }
        }
      } else {
        // First time: create new FieldDef instances
        const fields = newPlacements.map((p) => {
          const f = new GridPlacementField();
          f.index = p.index;
          f.col = p.col;
          f.row = p.row;
          f.colSpan = p.colSpan;
          f.rowSpan = p.rowSpan;
          f.format = 'fitted';
          return f;
        });
        model.placements = fields;
      }
    } catch (e) {
      console.error('Layout: Failed to save placements', e);
    }
  };

  toggleSidebar = (): void => {
    // ³⁵
    this.sidebarOpen = !this.sidebarOpen;
  };

  toggleGridLines = (): void => {
    // ³⁶
    this.showGridLines = !this.showGridLines;
  };

  updateColumns = (e: Event): void => {
    // ³⁷
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(val) && val >= 1 && val <= 12 && this.args.model?.gridSettings) {
      this.args.model.gridSettings.columns = val;
    }
  };

  updateGap = (e: Event): void => {
    // ³⁸
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(val) && val >= 0 && val <= 64 && this.args.model?.gridSettings) {
      this.args.model.gridSettings.gapPx = val;
    }
  };

  get rowHeightValue(): number {
    const rh = this.args.model?.gridSettings?.rowHeight;
    if (!rh) return 200;
    const match = rh.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 200;
  }

  updateRowHeight = (e: Event): void => {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (
      !isNaN(val) &&
      val >= 100 &&
      val <= 500 &&
      this.args.model?.gridSettings
    ) {
      this.args.model.gridSettings.rowHeight = `minmax(${val}px, 1fr)`;
    }
  };

  // ── Template ─────────────────────────────────────────────────────

  <template>
    {{! ³⁹ Isolated template }}
    <div class='layout-surface'>
      {{! ⁴⁰ Toolbar }}
      <header class='layout-toolbar'>
        <div class='toolbar-left'>
          <h2 class='layout-title'>
            <svg
              width='18'
              height='18'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
              stroke-linecap='round'
              stroke-linejoin='round'
            >
              <rect x='3' y='3' width='7' height='7' rx='1' />
              <rect x='14' y='3' width='7' height='7' rx='1' />
              <rect x='3' y='14' width='7' height='7' rx='1' />
              <rect x='14' y='14' width='7' height='7' rx='1' />
            </svg>
            {{if @model.title @model.title 'Untitled Layout'}}
          </h2>
          <span class='card-count'>{{this.cardCount}} cards</span>
        </div>
        <div class='toolbar-right'>
          <Button
            @kind='secondary-light'
            @size='small'
            class='toolbar-btn'
            {{on 'click' this.toggleSidebar}}
          >
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='3' width='18' height='18' rx='2' />
              <line x1='15' y1='3' x2='15' y2='21' />
            </svg>
            Settings
          </Button>
        </div>
      </header>

      {{! ⁴¹ Main content area }}
      <div class='layout-body'>
        <div class='layout-main'>
          <GridPlane
            @config={{this.engineConfig}}
            @placements={{this.enginePlacements}}
            @manager={{this.manager}}
            @showGridLines={{false}}
            @interactive={{true}}
          >
            <:cell as |placement|>
              {{#let (get @fields.cards placement.index) as |CardField|}}
                {{#if CardField}}
                  <div class='card-fill' {{Chromeless}}>
                    <CardField @format='fitted' />
                  </div>
                {{else}}
                  <div class='cell-placeholder'>
                    <span class='placeholder-index'>{{placement.index}}</span>
                  </div>
                {{/if}}
              {{/let}}
            </:cell>
            <:empty>
              <div class='empty-layout'>
                <svg
                  width='48'
                  height='48'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.5'
                  opacity='0.4'
                >
                  <rect x='3' y='3' width='7' height='7' rx='1' />
                  <rect x='14' y='3' width='7' height='7' rx='1' />
                  <rect x='3' y='14' width='7' height='7' rx='1' />
                  <rect x='14' y='14' width='7' height='7' rx='1' />
                </svg>
                <p>No cards in this layout yet.</p>
                <p class='hint'>Add cards via the edit panel to get started.</p>
              </div>
            </:empty>
            <:ghost as |dragIdx|>
              {{#let (get @fields.cards dragIdx) as |CardField|}}
                {{#if CardField}}
                  <div class='ghost-card-wrapper'>
                    <CardField @format='fitted' />
                  </div>
                {{/if}}
              {{/let}}
            </:ghost>
          </GridPlane>
        </div>

        {{! ⁴² Sidebar }}
        {{#if this.sidebarOpen}}
          <aside class='layout-sidebar'>
            <div class='sidebar-header'>
              <h3 class='sidebar-title'>Settings</h3>
              <Button
                @kind='text-only'
                @size='extra-small'
                class='sidebar-close'
                {{on 'click' this.toggleSidebar}}
              >
                <svg
                  width='16'
                  height='16'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <line x1='18' y1='6' x2='6' y2='18' />
                  <line x1='6' y1='6' x2='18' y2='18' />
                </svg>
              </Button>
            </div>

            <div class='sidebar-body'>
              {{! ⁴³ Grid configuration }}
              <section class='settings-section'>
                <h4 class='section-label'>Grid</h4>
                <div class='setting-row'>
                  <label class='setting-label'>Columns</label>
                  <input
                    type='range'
                    min='1'
                    max='12'
                    value={{this.columnCount}}
                    class='setting-range'
                    {{on 'input' this.updateColumns}}
                  />
                  <span class='setting-value'>{{this.columnCount}}</span>
                </div>
                <div class='setting-row'>
                  <label class='setting-label'>Gap</label>
                  <input
                    type='range'
                    min='0'
                    max='48'
                    value={{this.engineConfig.gap}}
                    class='setting-range'
                    {{on 'input' this.updateGap}}
                  />
                  <span class='setting-value'>{{this.engineConfig.gap}}px</span>
                </div>
                <div class='setting-row'>
                  <label class='setting-label'>Row H</label>
                  <input
                    type='range'
                    min='100'
                    max='500'
                    value={{this.rowHeightValue}}
                    class='setting-range'
                    {{on 'input' this.updateRowHeight}}
                  />
                  <span class='setting-value'>{{this.rowHeightValue}}px</span>
                </div>
              </section>

              {{! ⁴⁴ Selected card info }}
              {{#if this.selectedPlacement}}
                <section class='settings-section'>
                  <h4 class='section-label'>Selected Card</h4>
                  <div class='selected-info'>
                    <div class='info-row'>
                      <span class='info-label'>Position</span>
                      <span class='info-value'>
                        Col
                        {{this.selectedPlacement.col}}, Row
                        {{this.selectedPlacement.row}}
                      </span>
                    </div>
                    <div class='info-row'>
                      <span class='info-label'>Span</span>
                      <span class='info-value'>
                        {{this.selectedPlacement.colSpan}}
                        &times;
                        {{this.selectedPlacement.rowSpan}}
                      </span>
                    </div>
                  </div>
                </section>
              {{/if}}

              {{! ⁴⁵ Help section }}
              <section class='settings-section help-section'>
                <h4 class='section-label'>Shortcuts</h4>
                <div class='shortcut-list'>
                  <div class='shortcut'><kbd>Click</kbd> Select card</div>
                  <div class='shortcut'><kbd>Drag</kbd> Move / swap</div>
                  <div class='shortcut'><kbd>Edge drag</kbd> Resize span</div>
                  <div class='shortcut'><kbd>Arrow keys</kbd> Navigate</div>
                  <div class='shortcut'><kbd>Tab</kbd> Cycle cards</div>
                  <div class='shortcut'><kbd>Del</kbd> Remove card</div>
                  <div class='shortcut'><kbd>Esc</kbd> Deselect</div>
                </div>
              </section>
            </div>
          </aside>
        {{/if}}
      </div>
    </div>

    <style scoped>
      {{! ⁴⁶ Isolated styles }}/* ── Surface ──────────────────────────────────────────────── */
                                      .layout-surface {
                                        display: flex;
                                        flex-direction: column;
                                        height: 100%;
                                        min-height: 100%;
                                        background: var(--background, #fafafa);
                                        color: var(--foreground, #0f172a);
                                        font-family: var(--font-sans, system-ui, sans-serif);
                                      }

                                      /* ── Toolbar ──────────────────────────────────────────────── */
                                      .layout-toolbar {
                                        display: flex;
                                        align-items: center;
                                        justify-content: space-between;
                                        padding: var(--boxel-sp-xs, 8px) var(--boxel-sp, 16px);
                                        border-bottom: 1px solid var(--border, #e2e8f0);
                                        background: var(--card, #fff);
                                        flex-shrink: 0;
                                      }

                                      .toolbar-left {
                                        display: flex;
                                        align-items: center;
                                        gap: var(--boxel-sp-xs, 8px);
                                      }

                                      .toolbar-right {
                                        display: flex;
                                        align-items: center;
                                        gap: var(--boxel-sp-3xs, 4px);
                                      }

                                      .layout-title {
                                        display: flex;
                                        align-items: center;
                                        gap: 6px;
                                        font-size: var(--boxel-font-size, 0.875rem);
                                        font-weight: 600;
                                        margin: 0;
                                        color: var(--foreground, #0f172a);
                                      }

                                      .card-count {
                                        font-size: var(--boxel-font-size-xs, 0.75rem);
                                        color: var(--muted-foreground, #94a3b8);
                                        padding: 2px 8px;
                                        background: var(--muted, #f1f5f9);
                                        border-radius: var(--boxel-border-radius-xs, 4px);
                                      }

                                      .toolbar-btn {
                                        display: inline-flex;
                                        align-items: center;
                                        gap: 4px;
                                        font-size: var(--boxel-font-size-xs, 0.75rem);
                                      }

                                      /* ── Body ─────────────────────────────────────────────────── */
                                      .layout-body {
                                        display: flex;
                                        flex: 1;
                                        min-height: 0;
                                        overflow: hidden;
                                      }

                                      .layout-main {
                                        flex: 1;
                                        min-width: 0;
                                        overflow: hidden;
                                      }

                                      /* ── Card Fill — stretches card to fill the well ────────── */
                                      .card-fill {
                                        width: 100%;
                                        height: 100%;
                                        overflow: hidden;
                                        border-radius: inherit;
                                      }

                                      .cell-placeholder {
                                        width: 100%;
                                        height: 100%;
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                        background: var(--muted, #f1f5f9);
                                        border: 1px dashed var(--border, #d1d5db);
                                        border-radius: inherit;
                                      }

                                      .placeholder-index {
                                        width: 24px;
                                        height: 24px;
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                        font-size: 10px;
                                        font-family: var(--font-mono, monospace);
                                        color: var(--muted-foreground, #94a3b8);
                                        background: var(--background, #fff);
                                        border-radius: 50%;
                                      }

                                      /* ── Drag Ghost Card ───────────────────────────────────────── */
                                      .ghost-card-wrapper {
                                        width: 100%;
                                        height: 100%;
                                        overflow: hidden;
                                        border-radius: inherit;
                                      }

                                      /* ── Empty Layout ─────────────────────────────────────────── */
                                      .empty-layout {
                                        display: flex;
                                        flex-direction: column;
                                        align-items: center;
                                        gap: var(--boxel-sp-xs, 8px);
                                        color: var(--muted-foreground, #94a3b8);
                                      }

                                      .empty-layout p {
                                        margin: 0;
                                        font-size: var(--boxel-font-size-sm, 0.875rem);
                                      }

                                      .empty-layout .hint {
                                        font-size: var(--boxel-font-size-xs, 0.75rem);
                                        opacity: 0.7;
                                      }

                                      /* ── Sidebar ──────────────────────────────────────────────── */
                                      .layout-sidebar {
                                        width: 280px;
                                        flex-shrink: 0;
                                        border-left: 1px solid var(--border, #e2e8f0);
                                        background: var(--card, #fff);
                                        display: flex;
                                        flex-direction: column;
                                        overflow-y: auto;
                                      }

                                      .sidebar-header {
                                        display: flex;
                                        align-items: center;
                                        justify-content: space-between;
                                        padding: var(--boxel-sp-xs, 8px) var(--boxel-sp-sm, 12px);
                                        border-bottom: 1px solid var(--border, #e2e8f0);
                                      }

                                      .sidebar-title {
                                        font-size: var(--boxel-font-size-sm, 0.875rem);
                                        font-weight: 600;
                                        margin: 0;
                                      }

                                      .sidebar-close {
                                        padding: 2px;
                                      }

                                      .sidebar-body {
                                        padding: var(--boxel-sp-sm, 12px);
                                        display: flex;
                                        flex-direction: column;
                                        gap: var(--boxel-sp, 16px);
                                      }

                                      .settings-section {
                                        display: flex;
                                        flex-direction: column;
                                        gap: var(--boxel-sp-xs, 8px);
                                      }

                                      .section-label {
                                        font-size: 11px;
                                        font-weight: 600;
                                        text-transform: uppercase;
                                        letter-spacing: 0.05em;
                                        color: var(--muted-foreground, #94a3b8);
                                        margin: 0;
                                      }

                                      .setting-row {
                                        display: flex;
                                        align-items: center;
                                        gap: var(--boxel-sp-xs, 8px);
                                      }

                                      .setting-label {
                                        font-size: var(--boxel-font-size-xs, 0.75rem);
                                        color: var(--foreground, #334155);
                                        min-width: 56px;
                                      }

                                      .setting-range {
                                        flex: 1;
                                        height: 4px;
                                        accent-color: var(--primary, #3b82f6);
                                      }

                                      .setting-value {
                                        font-size: 11px;
                                        font-family: var(--font-mono, monospace);
                                        color: var(--muted-foreground, #64748b);
                                        min-width: 28px;
                                        text-align: right;
                                      }

                                      /* ── Selected Card Info ────────────────────────────────────── */
                                      .selected-info {
                                        display: flex;
                                        flex-direction: column;
                                        gap: 4px;
                                      }

                                      .info-row {
                                        display: flex;
                                        justify-content: space-between;
                                        font-size: var(--boxel-font-size-xs, 0.75rem);
                                      }

                                      .info-label {
                                        color: var(--muted-foreground, #94a3b8);
                                      }

                                      .info-value {
                                        font-family: var(--font-mono, monospace);
                                        font-weight: 500;
                                      }

                                      /* ── Shortcuts ────────────────────────────────────────────── */
                                      .help-section {
                                        border-top: 1px solid var(--border, #e2e8f0);
                                        padding-top: var(--boxel-sp, 16px);
                                      }

                                      .shortcut-list {
                                        display: flex;
                                        flex-direction: column;
                                        gap: 4px;
                                      }

                                      .shortcut {
                                        display: flex;
                                        align-items: center;
                                        gap: var(--boxel-sp-xs, 8px);
                                        font-size: 11px;
                                        color: var(--muted-foreground, #64748b);
                                      }

                                      .shortcut kbd {
                                        font-family: var(--font-mono, monospace);
                                        font-size: 10px;
                                        padding: 1px 4px;
                                        background: var(--muted, #f1f5f9);
                                        border: 1px solid var(--border, #e2e8f0);
                                        border-radius: 3px;
                                        min-width: 60px;
                                        text-align: center;
                                      }
    </style>
  </template>
}

export class Layout extends CardDef {
  static displayName = 'Layout';
  static icon = LayoutGridIcon; // ¹⁸
  static prefersWideFormat = true;

  @field title = contains(StringField); // ¹⁹
  @field cards = linksToMany(CardDef); // ²⁰
  @field gridSettings = contains(GridSettingsField); // ²¹
  @field placements = containsMany(GridPlacementField); // ²²

  @field cardTitle = contains(StringField, {
    // ²³
    computeVia: function (this: Layout) {
      return this.cardInfo?.name ?? this.title ?? 'Untitled Layout';
    },
  });

  // ── Isolated Format ────────────────────────────────────────────────

  static isolated = Isolated;

  // ── Fitted Format ──────────────────────────────────────────────────

  static fitted = class Fitted extends Component<typeof Layout> {
    // ⁴⁷

    get cols(): number {
      return this.args.model?.gridSettings?.columns ?? 4;
    }

    get cardCount(): number {
      return this.args.model?.cards?.length ?? 0;
    }

    get miniGridStyle(): string {
      return `grid-template-columns: repeat(${this.cols}, 1fr)`;
    }

    get miniCells(): number[] {
      const count = Math.min(this.cardCount, this.cols * 3);
      return Array.from({ length: count }, (_, i) => i);
    }

    <template>
      {{! ⁴⁸ Fitted template }}
      <div class='fitted-layout'>
        <div class='fitted-header'>
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <rect x='3' y='3' width='7' height='7' rx='1' />
            <rect x='14' y='3' width='7' height='7' rx='1' />
            <rect x='3' y='14' width='7' height='7' rx='1' />
            <rect x='14' y='14' width='7' height='7' rx='1' />
          </svg>
          <span class='fitted-title'>{{if
              @model.title
              @model.title
              'Layout'
            }}</span>
        </div>
        <div class='fitted-preview' style={{this.miniGridStyle}}>
          {{#each this.miniCells as |_cellIdx|}}
            <div class='mini-cell'></div>
          {{/each}}
        </div>
        <span class='fitted-meta'>{{this.cardCount}}
          cards &middot;
          {{this.cols}}
          cols</span>
      </div>

      <style scoped>
        .fitted-layout {
          container-type: size;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs, 4px);
          padding: var(--boxel-sp-xs, 8px);
          background: var(--card, #fff);
          font-family: var(--font-sans, system-ui, sans-serif);
          overflow: hidden;
        }

        .fitted-header {
          display: flex;
          align-items: center;
          gap: 4px;
          color: var(--foreground, #0f172a);
          flex-shrink: 0;
        }

        .fitted-title {
          font-size: var(--boxel-font-size-xs, 0.75rem);
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .fitted-preview {
          display: grid;
          gap: 3px;
          flex: 1;
          min-height: 0;
        }

        .mini-cell {
          background: var(--muted, #f1f5f9);
          border-radius: 2px;
          min-height: 0;
        }

        .fitted-meta {
          font-size: 10px;
          color: var(--muted-foreground, #94a3b8);
          flex-shrink: 0;
        }

        /* ── Container query adaptations ───────────────────────────── */
        @container (max-height: 80px) {
          .fitted-preview {
            display: none;
          }
          .fitted-meta {
            display: none;
          }
        }

        @container (max-width: 120px) {
          .fitted-meta {
            display: none;
          }
        }
      </style>
    </template>
  };

  // ── Embedded Format ────────────────────────────────────────────────

  static embedded = class Embedded extends Component<typeof Layout> {
    // ⁴⁹

    get cardCount(): number {
      return this.args.model?.cards?.length ?? 0;
    }

    get cols(): number {
      return this.args.model?.gridSettings?.columns ?? 4;
    }

    <template>
      {{! ⁵⁰ Embedded template }}
      <div class='embedded-layout'>
        <div class='embedded-icon'>
          <svg
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <rect x='3' y='3' width='7' height='7' rx='1' />
            <rect x='14' y='3' width='7' height='7' rx='1' />
            <rect x='3' y='14' width='7' height='7' rx='1' />
            <rect x='14' y='14' width='7' height='7' rx='1' />
          </svg>
        </div>
        <div class='embedded-info'>
          <span class='embedded-title'>{{if
              @model.title
              @model.title
              'Layout'
            }}</span>
          <span class='embedded-meta'>{{this.cardCount}}
            cards &middot;
            {{this.cols}}-column grid</span>
        </div>
      </div>

      <style scoped>
        .embedded-layout {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs, 8px);
          padding: var(--boxel-sp-xs, 8px) var(--boxel-sp-sm, 12px);
          background: var(--card, #fff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: var(--boxel-border-radius-sm, 6px);
          font-family: var(--font-sans, system-ui, sans-serif);
        }

        .embedded-icon {
          flex-shrink: 0;
          color: var(--muted-foreground, #94a3b8);
        }

        .embedded-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .embedded-title {
          font-size: var(--boxel-font-size-sm, 0.875rem);
          font-weight: 600;
          color: var(--foreground, #0f172a);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .embedded-meta {
          font-size: var(--boxel-font-size-xs, 0.75rem);
          color: var(--muted-foreground, #94a3b8);
        }
      </style>
    </template>
  };
}
