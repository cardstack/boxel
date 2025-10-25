import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import {
  eq,
  and,
  gt,
  lt,
  subtract,
  multiply,
} from '@cardstack/boxel-ui/helpers';
import { concat, fn, get } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency'; // ²⁵ Add ember-concurrency for timers and card selection
import LayoutIcon from '@cardstack/boxel-icons/layout-grid'; // ⁷² Icon for Card Board
import ImageIcon from '@cardstack/boxel-icons/image'; // ⁸⁶ Import icons for palette
import StickyNoteIcon from '@cardstack/boxel-icons/sticky-note';
import TimerIcon from '@cardstack/boxel-icons/timer';
import LinkIcon from '@cardstack/boxel-icons/link';
import { chooseCard, baseCardRef } from '@cardstack/runtime-common'; // ¹²² Import card chooser functionality
import {
  BoardItem,
  ImageNode,
  PostitNote,
  CountdownTimer,
  ExternalCard,
} from './fields/board-item'; // ¹²³ Import board item types
import { BoardPosition } from './fields/board-position'; // ¹²⁴ Import board position type
import LayoutCanvasModifier from './modifiers/layout-canvas-modifier'; // ¹²⁵ Import layout canvas modifier
import ShowCardCommand from '@cardstack/boxel-host/commands/show-card';

class Isolated extends Component<typeof AILayoutBoard> {
  @tracked transform = {
    x: this.args.model.transformX ?? 0,
    y: this.args.model.transformY ?? 0,
    k: this.args.model.transformK ?? 1,
  };
  @tracked viewMode: 'canvas' | 'list' = 'canvas'; // ¹⁶ Toggle between canvas and list views
  @tracked showToolPalette = false; // ⁸⁸ Tool palette opens by default
  @tracked selectedItemIds: string[] = []; // Track multiple selected items

  // ¹⁸⁹ Cache for itemData to prevent unnecessary re-creation
  private _cachedItemData: any[] | null = null;
  private _lastAllItemsHash: string | null = null;
  // Remember last placed rect so new items appear to the right of it
  private _lastPlacement: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;

  get itemData() {
    // ¹⁸ Convert allItems to data format for canvas interactions with caching
    const allItems = this.args.model.allItems;

    // Create a simple hash to detect changes in allItems
    const currentHash =
      allItems
        ?.map(
          (item: any, index: number) =>
            `${item.constructor.name}-${index}-${item.position?.x}-${item.position?.y}-${item.position?.width}-${item.position?.height}`,
        )
        .join('|') || '';

    // Return cached data if allItems haven't changed
    if (this._cachedItemData && this._lastAllItemsHash === currentHash) {
      return this._cachedItemData;
    }

    // Rebuild itemData
    const items: any[] = [];
    allItems?.forEach((item: any, index: number) => {
      if (!item.position) return;

      const pos = item.position;
      const itemType = item.constructor.name;

      // Use the same casing/id format as the canvas DOM (`data-item-id='ConstructorName-index'`)
      items.push({
        id: `${itemType}-${index}`,
        type: itemType,
        position: pos,
        item: item,
        x: pos.x || 0,
        y: pos.y || 0,
        width: pos.width || 120,
        height: pos.height || 80,
        layer: pos.layer || 1,
      });
    });

    const sortedItems = items.sort((a, b) => a.layer - b.layer);

    // Cache the result
    this._cachedItemData = sortedItems;
    this._lastAllItemsHash = currentHash;

    return sortedItems;
  }

  @action
  toggleViewMode() {
    // ¹⁹ Toggle between canvas and list views
    this.viewMode = this.viewMode === 'canvas' ? 'list' : 'canvas';
  }

  // Compute a placement to the right of an anchor rect, avoiding overlaps
  computeRightOf(
    anchor: { x: number; y: number; width: number; height: number },
    width: number,
    height: number,
  ) {
    try {
      const gap = this.args.model.gridSize || 20;
      const rects = (this.args.model.allItems || [])
        .filter((it: any) => it?.position)
        .map((it: any) => {
          const pos = it.position;
          const w = pos?.width || 120;
          const h = this.calculateItemHeight(it);
          return {
            x1: pos?.x || 0,
            y1: pos?.y || 0,
            x2: (pos?.x || 0) + w,
            y2: (pos?.y || 0) + h,
          };
        });

      let x = anchor.x + anchor.width + gap;
      let y = anchor.y;

      let guard = 0;
      while (guard++ < 100) {
        const nx1 = x;
        const nx2 = x + width;
        const ny1 = y;
        const ny2 = y + height;

        // Find items that vertically overlap this row
        const verticalOverlappers = rects.filter(
          (r) => !(r.y2 <= ny1 || r.y1 >= ny2),
        );
        // Among those, find any that also overlap horizontally at our current x
        const blocking = verticalOverlappers.filter(
          (r) => !(r.x2 <= nx1 || r.x1 >= nx2),
        );

        if (blocking.length === 0) break; // free slot to the right

        // Move just to the right of the right-most blocker
        x = Math.max(...blocking.map((r) => r.x2)) + gap;
      }

      return { x, y };
    } catch (_e) {
      // Fallback: anchor position
      return { x: anchor.x + anchor.width, y: anchor.y };
    }
  }

  // ⁸¹ Zoom control actions
  @action
  zoomToFit() {
    if (!this.args.model.allItems?.length) return;

    // Calculate bounding box of all items
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    this.args.model.allItems.forEach((item: any) => {
      if (item.position) {
        const x = item.position.x || 0;
        const y = item.position.y || 0;
        const width = item.position.width || 120;
        const height = item.position.height || 80;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      }
    });

    if (minX === Infinity) return;

    // Add padding
    const padding = 50;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    // Get the actual visible container dimensions from the canvas viewport
    const viewport = document.querySelector('.layout-viewport');
    if (!viewport) return;

    const viewportRect = viewport.getBoundingClientRect();
    const viewportWidth = viewportRect.width;
    const viewportHeight = viewportRect.height;

    // Calculate required scale to fit in the actual visible container
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    const scaleX = viewportWidth / contentWidth;
    const scaleY = viewportHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY, 3); // Cap at 3x zoom (300%)

    // Center the content within the visible container
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const x = viewportWidth / 2 - centerX * scale;
    const y = viewportHeight / 2 - centerY * scale;

    this.transform = { x, y, k: scale };

    // ¹⁸³ Save transform state to model
    this.args.model.transformX = x;
    this.args.model.transformY = y;
    this.args.model.transformK = scale;
  }

  @action
  zoomToActual() {
    // ⁸² Reset to 100% zoom but maintain current center position
    // Get the actual visible container dimensions
    const viewport = document.querySelector('.layout-viewport');
    if (!viewport) {
      this.transform = { x: 0, y: 0, k: 1 };
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const viewportWidth = viewportRect.width;
    const viewportHeight = viewportRect.height;

    // Calculate the current center point in world coordinates
    const currentCenterX =
      (viewportWidth / 2 - this.transform.x) / this.transform.k;
    const currentCenterY =
      (viewportHeight / 2 - this.transform.y) / this.transform.k;

    // Calculate new transform to keep the same center at 100% zoom
    const newX = viewportWidth / 2 - currentCenterX;
    const newY = viewportHeight / 2 - currentCenterY;

    this.transform = { x: newX, y: newY, k: 1 };

    // ¹⁸⁴ Save transform state to model
    this.args.model.transformX = newX;
    this.args.model.transformY = newY;
    this.args.model.transformK = 1;
  }

  @action
  zoomIn() {
    // ⁸³ Zoom in by 25% relative to current view center - limited to 300% max
    const newScale = Math.min(this.transform.k * 1.25, 3);

    // Get the actual visible container dimensions
    const viewport = document.querySelector('.layout-viewport');
    if (!viewport) {
      this.transform = {
        x: this.transform.x,
        y: this.transform.y,
        k: newScale,
      };
      // ¹⁸⁷ Save transform state to model even when viewport not found
      this.args.model.transformX = this.transform.x;
      this.args.model.transformY = this.transform.y;
      this.args.model.transformK = newScale;
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const viewportCenterX = viewportRect.width / 2;
    const viewportCenterY = viewportRect.height / 2;

    // Calculate the current center point in world coordinates
    const worldCenterX =
      (viewportCenterX - this.transform.x) / this.transform.k;
    const worldCenterY =
      (viewportCenterY - this.transform.y) / this.transform.k;

    // Calculate new transform to keep the same center at new zoom level
    const newX = viewportCenterX - worldCenterX * newScale;
    const newY = viewportCenterY - worldCenterY * newScale;

    this.transform = { x: newX, y: newY, k: newScale };

    // ¹⁸⁵ Save transform state to model
    this.args.model.transformX = newX;
    this.args.model.transformY = newY;
    this.args.model.transformK = newScale;
  }

  @action
  zoomOut() {
    // ⁸⁴ Zoom out by 20% relative to current view center
    const newScale = Math.max(this.transform.k * 0.8, 0.1);

    // Get the actual visible container dimensions
    const viewport = document.querySelector('.layout-viewport');
    if (!viewport) {
      this.transform = {
        x: this.transform.x,
        y: this.transform.y,
        k: newScale,
      };
      // ¹⁸⁸ Save transform state to model even when viewport not found
      this.args.model.transformX = this.transform.x;
      this.args.model.transformY = this.transform.y;
      this.args.model.transformK = newScale;
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const viewportCenterX = viewportRect.width / 2;
    const viewportCenterY = viewportRect.height / 2;

    // Calculate the current center point in world coordinates
    const worldCenterX =
      (viewportCenterX - this.transform.x) / this.transform.k;
    const worldCenterY =
      (viewportCenterY - this.transform.y) / this.transform.k;

    // Calculate new transform to keep the same center at new zoom level
    const newX = viewportCenterX - worldCenterX * newScale;
    const newY = viewportCenterY - worldCenterY * newScale;

    this.transform = { x: newX, y: newY, k: newScale };

    // ¹⁸⁶ Save transform state to model
    this.args.model.transformX = newX;
    this.args.model.transformY = newY;
    this.args.model.transformK = newScale;
  }

  get formattedZoom() {
    // ⁸⁵ Format zoom percentage for display
    return `${Math.round(this.transform.k * 100)}%`;
  }

  // Helper method to calculate item height
  calculateItemHeight(item: any) {
    if (!item?.position) return 80;

    const position = item.position;
    if (position.format === 'fitted') {
      return position.autoHeight || 80;
    }
    if (position.customHeight && position.customHeight > 0) {
      return position.customHeight;
    }
    return position.autoHeight || 80;
  }

  // Getter to safely compute allItems length
  get allItemsLength(): number {
    return this.args.model.allItems?.length || 0;
  }

  handleTransform = (newTransform: any) => {
    // ²⁰ Transform handler - now persists to model
    this.transform = newTransform;

    // ¹⁸² Save transform state to model for persistence
    this.args.model.transformX = newTransform.x;
    this.args.model.transformY = newTransform.y;
    this.args.model.transformK = newTransform.k;
  };

  // ¹⁴⁵ Item selection handler (toggle multi-select)
  handleItemSelect = (itemId: string | null) => {
    if (itemId === null) {
      this.selectedItemIds = [];
    } else {
      const set = new Set(this.selectedItemIds);
      if (set.has(itemId)) {
        set.delete(itemId);
      } else {
        set.add(itemId);
      }
      this.selectedItemIds = Array.from(set);
    }
  };

  // Delete selected item(s)
  @action
  deleteSelectedItems() {
    if (!this.selectedItemIds.length) return;

    const ids = new Set(this.selectedItemIds);
    const toDelete = this.itemData.filter((d: any) => ids.has(d.id));
    if (!toDelete.length) return;

    // Remove from appropriate arrays based on item type
    for (const d of toDelete) {
      switch (d.type) {
        case 'ImageNode':
          this.args.model.images =
            this.args.model.images?.filter((item: any) => item !== d.item) ||
            [];
          break;
        case 'PostitNote':
          this.args.model.notes =
            this.args.model.notes?.filter((item: any) => item !== d.item) || [];
          break;
        case 'CountdownTimer':
          this.args.model.timers =
            this.args.model.timers?.filter((item: any) => item !== d.item) ||
            [];
          break;
        case 'ExternalCard':
          this.args.model.externalCards =
            this.args.model.externalCards?.filter(
              (item: any) => item !== d.item,
            ) || [];
          break;
      }
    }

    // Clear selection
    this.selectedItemIds = [];

    // Clear itemData cache since items changed
    this._cachedItemData = null;
    this._lastAllItemsHash = null;
  }

  // ¹⁴⁷ Clear selection when clicking canvas background
  @action
  clearSelection() {
    this.selectedItemIds = [];
  }

  // Handle Delete key for deleting selected items
  @action
  handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const isEditable =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        (target as any).isContentEditable);

    if (isEditable) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedItemIds.length > 0) {
        event.preventDefault();
        this.deleteSelectedItems();
      }
    }
  }

  // ¹⁷² Open external card in stack action
  @action
  openCardInStack(cardId: string) {
    try {
      // Normalize to URL object to satisfy hosts that expect URL over string
      let cardURL: URL | null = null;

      try {
        cardURL = new URL(cardId);
      } catch (urlErr) {
        console.warn('openCardInStack: invalid cardId, not an absolute URL', {
          cardId,
          urlErr,
        });
        return;
      }

      // Fallback: use host command via commandContext
      const commandContext = this.args.context?.commandContext;
      if (commandContext) {
        new ShowCardCommand(commandContext).execute({
          cardId: cardURL.href,
          format: 'isolated',
        });
        return;
      }
    } catch (error) {
      console.error('Failed to open card in stack:', { cardId, error });
    }
  }

  // ⁸⁹ Tool palette actions
  @action
  toggleToolPalette() {
    this.showToolPalette = !this.showToolPalette;
  }

  @action
  createBoardItem(itemType: string) {
    // ⁹⁰ Create new board items at canvas center
    const viewport = document.querySelector('.layout-viewport');
    if (!viewport) return;

    const viewportRect = viewport.getBoundingClientRect();
    const canvasX =
      (viewportRect.width / 2 - this.transform.x) / this.transform.k;
    const canvasY =
      (viewportRect.height / 2 - this.transform.y) / this.transform.k;

    // Compute a placement to the right of the last placed (or selected) item
    const width = 400;
    const gap = this.args.model.gridSize || 20;
    let anchor = this._lastPlacement;
    if (!anchor && this.selectedItemIds?.length) {
      const lastSel = this.selectedItemIds[this.selectedItemIds.length - 1];
      const data = (this.itemData || []).find((d: any) => d.id === lastSel);
      if (data?.position) {
        const h = this.calculateItemHeight(data.item ?? data);
        anchor = {
          x: data.position.x || 0,
          y: data.position.y || 0,
          width: data.position.width || 120,
          height: h || 80,
        };
      }
    }
    if (!anchor) {
      anchor = {
        x: canvasX - width - gap,
        y: canvasY - 60,
        width: 0,
        height: 0,
      };
    }
    const placed = this.computeRightOf(anchor, width, 120);

    // Create position object without null values
    const defaultPosition = new BoardPosition({
      x: placed.x,
      y: placed.y,
      width,
      autoHeight: 120,
      customHeight: 0, // Use 0 instead of null
      layer: 1,
      format: 'embedded', // ¹³² Default format set to embedded with auto height
    });

    let newItem;

    switch (itemType) {
      case 'image':
        newItem = new ImageNode({
          imageUrl: 'https://picsum.photos/300/200',
          caption: 'New Image',
          position: defaultPosition,
        });
        this.args.model.images = [...(this.args.model.images || []), newItem];
        break;

      case 'note':
        newItem = new PostitNote({
          content: 'New sticky note',
          color: '#fef08a',
          position: defaultPosition,
        });
        this.args.model.notes = [...(this.args.model.notes || []), newItem];
        break;

      case 'timer':
        const futureDate = new Date();
        futureDate.setHours(futureDate.getHours() + 24); // 24 hours from now
        newItem = new CountdownTimer({
          title: 'New Timer',
          targetDate: futureDate,
          position: defaultPosition,
        });
        this.args.model.timers = [...(this.args.model.timers || []), newItem];
        break;

      case 'external':
        // ¹²³ Use card chooser instead of creating blank external card
        this.openCardChooser.perform(canvasX, canvasY);
        return; // Don't hide palette yet, wait for selection
    }

    // Remember last placement and clear caches
    this._lastPlacement = { x: placed.x, y: placed.y, width, height: 120 };
    // ¹⁹¹ Clear itemData cache since items changed
    this._cachedItemData = null;
    this._lastAllItemsHash = null;

    // Keep palette visible after creation
  }

  // ¹²⁴ Card chooser task for external cards
  openCardChooser = restartableTask(
    async (canvasX: number, canvasY: number) => {
      try {
        // Open card chooser with no type filter (any card can be linked)
        const cardId = await chooseCard(
          { filter: { type: baseCardRef } }, // Allow any card type
          {
            offerToCreate: {
              ref: baseCardRef,
              relativeTo: undefined,
              realmURL: new URL(
                new URL(String(this.args.model.id)).origin + '/',
              ),
            },
            consumingRealm: new URL(
              new URL(String(this.args.model.id)).origin + '/',
            ),
          },
        );

        if (cardId) {
          // ¹²⁸ Create external card with selected card from chooser, right of anchor
          const width = 400;
          const gap = this.args.model.gridSize || 20;
          let anchor = this._lastPlacement || {
            x: canvasX - width - gap,
            y: canvasY - 60,
            width: 0,
            height: 0,
          };
          const placed = this.computeRightOf(anchor, width, 120);
          const defaultPosition = new BoardPosition({
            x: placed.x,
            y: placed.y,
            width,
            autoHeight: 120,
            customHeight: 0,
            layer: 1,
            format: 'embedded',
          });

          // Use the selected card ID to create a new ExternalCard with proper linking
          const newItem = new ExternalCard({
            caption: 'Selected Card',
            position: defaultPosition,
          });

          // Link the selected card to the external card
          if (this.args.context?.store) {
            try {
              const selectedCard = await this.args.context.store.get(cardId);
              if (selectedCard instanceof CardDef) {
                newItem.externalCard = selectedCard;
                newItem.caption = selectedCard.title || 'External Card';
              } else {
                console.warn(
                  'Selected card is not a CardDef; skipping external link',
                  selectedCard,
                );
                newItem.caption = 'External Card';
              }
            } catch (storeError) {
              console.warn(
                'Could not load selected card from store:',
                storeError,
              );
              newItem.caption = 'External Card';
            }
          }

          this.args.model.externalCards = [
            ...(this.args.model.externalCards || []),
            newItem,
          ];

          // Remember last placement and clear caches
          this._lastPlacement = {
            x: placed.x,
            y: placed.y,
            width,
            height: 120,
          };
          // ¹⁹² Clear itemData cache since items changed
          this._cachedItemData = null;
          this._lastAllItemsHash = null;
        }
      } catch (error) {
        console.error('Error selecting card:', error);
        // ¹²⁹ Fallback: create empty external card if chooser fails
        const width = 400;
        const gap = this.args.model.gridSize || 20;
        let anchor = this._lastPlacement || {
          x: canvasX - width - gap,
          y: canvasY - 60,
          width: 0,
          height: 0,
        };
        const placed = this.computeRightOf(anchor, width, 120);
        const defaultPosition = new BoardPosition({
          x: placed.x,
          y: placed.y,
          width,
          autoHeight: 120,
          customHeight: 0,
          layer: 1,
          format: 'embedded',
        });

        const newItem = new ExternalCard({
          caption: 'External Card',
          externalCard: null,
          position: defaultPosition,
        });

        this.args.model.externalCards = [
          ...(this.args.model.externalCards || []),
          newItem,
        ];

        // Remember last placement and clear caches
        this._lastPlacement = { x: placed.x, y: placed.y, width, height: 120 };
        // ¹⁹³ Clear itemData cache since items changed
        this._cachedItemData = null;
        this._lastAllItemsHash = null;
      } finally {
        // Keep palette visible after selection (success or failure)
      }
    },
  );

  get transformStyle() {
    // ²² CSS transform for canvas pane
    const { x, y, k } = this.transform;
    return `translate(${x}px, ${y}px) scale(${k})`;
  }

  <template>
    <div class='layout-board'>
      {{! Optimized Header with title and essential controls }}
      <header class='board-header'>
        <div class='header-left'>
          <h1 class='board-title'>{{if
              @model.title
              @model.title
              'Layout Board'
            }}</h1>
          {{#if @model.description}}
            <span class='board-description'>{{@model.description}}</span>
          {{/if}}
        </div>

        <div class='header-center'>
          <button
            class={{concat
              'item-summary'
              (if (eq this.viewMode 'list') ' active' '')
            }}
            {{on 'click' this.toggleViewMode}}
            type='button'
            title={{if
              (eq this.viewMode 'canvas')
              'Switch to list view'
              'Switch to canvas view'
            }}
          >
            <span class='summary-count'>{{this.allItemsLength}}</span>
            <span class='summary-label'>items</span>
          </button>
        </div>

        <div class='header-right'>
          {{! Space for future controls }}
        </div>
      </header>

      {{! Canvas View }}
      {{#if (eq this.viewMode 'canvas')}}
        <div class='canvas-section'>
          {{! template-lint-disable no-invalid-interactive }}
          <div
            class='layout-viewport'
            tabindex='0'
            style={{htmlSafe
              (concat
                'height: '
                (if @model.canvasHeight @model.canvasHeight 800)
                'px;'
              )
            }}
            {{on 'keydown' this.handleKeyDown}}
            {{LayoutCanvasModifier
              onTransform=this.handleTransform
              onItemSelect=this.handleItemSelect
              selectedItemIds=this.selectedItemIds
              itemData=this.itemData
              onOpenCard=this.openCardInStack
              onDeleteSelected=this.deleteSelectedItems
            }}
          >
            {{! Grid background anchored to viewport (not scaled by transform) }}
            <div
              class='grid-background'
              style={{htmlSafe
                (concat
                  'background-size: '
                  (multiply
                    (if @model.gridSize @model.gridSize 20) this.transform.k
                  )
                  'px '
                  (multiply
                    (if @model.gridSize @model.gridSize 20) this.transform.k
                  )
                  'px; '
                  'background-position: '
                  this.transform.x
                  'px '
                  this.transform.y
                  'px; '
                  'opacity: '
                  (if (lt this.transform.k 0.5) '0' '1')
                  ';'
                )
              }}
            ></div>
            <div
              class='pan-zoom-pane'
              style={{htmlSafe (concat 'transform: ' this.transformStyle)}}
            >
              {{! Grid now rendered above, outside transform }}

              {{! ²³ Render items using allItems-@model-loop-delegateToEmbedded pattern }}
              {{#each @model.allItems as |item index|}}
                {{#if item.position}}
                  <div
                    class='layout-item-positioned'
                    data-item-id='{{concat item.constructor.name "-" index}}'
                    style={{htmlSafe
                      (concat
                        'position: absolute; '
                        'left: '
                        item.position.x
                        'px; '
                        'top: '
                        item.position.y
                        'px; '
                        'width: '
                        item.position.width
                        'px; '
                        'height: '
                        (this.calculateItemHeight item)
                        'px; '
                        'z-index: '
                        item.position.layer
                        '; '
                        'container-type: size; '
                      )
                    }}
                  >
                    {{! ⁶¹ Direct delegation for ExternalCard, bypass its own formats }}
                    {{#if (eq item.constructor.name 'ExternalCard')}}
                      {{! ⁶² For ExternalCard: Render the linked card directly }}
                      {{#if (get item 'externalCard')}}
                        {{#let (get item 'externalCard') as |linkedCard|}}
                          {{#if
                            (and linkedCard (get linkedCard 'constructor'))
                          }}
                            {{#let
                              (get linkedCard 'constructor')
                              as |LinkedCtor|
                            }}
                              {{#let
                                (if
                                  (eq item.position.format 'fitted')
                                  'fitted'
                                  (if
                                    (eq item.position.format 'embedded')
                                    'embedded'
                                    'isolated'
                                  )
                                )
                                as |format|
                              }}
                                {{#if (get LinkedCtor format)}}
                                  {{#let (get LinkedCtor format) as |Template|}}
                                    <div
                                      class='external-card-wrapper board-interactive'
                                    >
                                      {{! ¹⁴³ Card type header with icon and display name }}
                                      <div class='card-type-header'>
                                        <span
                                          class='card-type-icon-placeholder'
                                        >📄</span>
                                        <span class='card-type-name'>{{if
                                            (get LinkedCtor 'displayName')
                                            (get LinkedCtor 'displayName')
                                            'Card'
                                          }}</span>
                                      </div>

                                      <div class='external-content'>
                                        {{! @glint-ignore }}
                                        {{component Template model=linkedCard}}
                                      </div>
                                    </div>
                                  {{/let}}
                                {{else}}
                                  <div class='unsupported-item'>Linked card
                                    missing
                                    {{format}}
                                    format</div>
                                {{/if}}
                              {{/let}}
                            {{/let}}
                          {{else}}
                            <div class='unsupported-item'>Linked card not
                              available</div>
                          {{/if}}
                        {{/let}}
                      {{else}}
                        <div class='external-placeholder'>🔗 No card linked</div>
                      {{/if}}
                    {{else}}
                      {{! ²⁴ Standard delegation for other items }}
                      {{! @glint-ignore }}
                      {{#if (and item (get item 'constructor'))}}
                        {{#let (get item 'constructor') as |Ctor|}}
                          {{#let
                            (if
                              (eq item.position.format 'fitted')
                              'fitted'
                              'embedded'
                            )
                            as |format|
                          }}
                            {{#if (get Ctor format)}}
                              {{#let (get Ctor format) as |Template|}}
                                <div class='board-interactive'>
                                  {{! @glint-ignore }}
                                  {{component Template model=item}}
                                </div>
                              {{/let}}
                            {{else}}
                              <div class='unsupported-item'>Missing
                                {{format}}
                                format for
                                {{item.constructor.name}}</div>
                            {{/if}}
                          {{/let}}
                        {{/let}}
                      {{else}}
                        <div class='unsupported-item'>Unsupported item type</div>
                      {{/if}}
                    {{/if}}
                  </div>
                {{/if}}
              {{/each}}
            </div>

            {{! Compact zoom controls }}
            <div class='canvas-controls'>
              <button
                class='zoom-btn'
                {{on 'click' this.zoomToFit}}
                title='Fit all items in view'
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='2' y='3' width='20' height='14' rx='2' ry='2' />
                  <path d='M8 21l4-7 4 7' />
                  <path d='M8 21h8' />
                </svg>
                Fit
              </button>
              <button
                class='zoom-btn'
                {{on 'click' this.zoomToActual}}
                title='Reset to 100% zoom'
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='11' cy='11' r='8' />
                  <path d='M21 21l-4.35-4.35' />
                </svg>
                100%
              </button>
              <button
                class='zoom-btn'
                {{on 'click' this.zoomIn}}
                title='Zoom in'
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='11' cy='11' r='8' />
                  <path d='M21 21l-4.35-4.35' />
                  <line x1='8' y1='11' x2='14' y2='11' />
                  <line x1='11' y1='8' x2='11' y2='14' />
                </svg>
              </button>
              <button
                class='zoom-btn'
                {{on 'click' this.zoomOut}}
                title='Zoom out'
              >
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='11' cy='11' r='8' />
                  <path d='M21 21l-4.35-4.35' />
                  <line x1='8' y1='11' x2='14' y2='11' />
                </svg>
              </button>
              <div class='zoom-info'>
                <span class='zoom-display'>{{this.formattedZoom}}</span>
              </div>
            </div>

            {{! Delete button - show when there are selected items }}
            {{#if (gt (get this 'selectedItemIds.length') 0)}}
              <div class='delete-button-container'>
                <button
                  class='delete-button'
                  {{on 'click' this.deleteSelectedItems}}
                  title='Delete selected items'
                >
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polyline points='3,6 5,6 21,6'></polyline>
                    <path
                      d='m19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2'
                    ></path>
                    <line x1='10' y1='11' x2='10' y2='17'></line>
                    <line x1='14' y1='11' x2='14' y2='17'></line>
                  </svg>
                  <span class='delete-label'>Delete</span>
                  <span
                    class='delete-count'
                  >({{this.selectedItemIds.length}})</span>
                </button>
              </div>
            {{/if}}

            {{! ⁹¹ Floating Tool Palette }}
            <div class='tool-palette-container'>

              {{#if this.showToolPalette}}
                <div class='tool-palette'>
                  <div class='palette-header'>
                    <span class='palette-title'>Board Items</span>
                  </div>
                  <div class='palette-tools'>
                    <button
                      class='tool-item'
                      {{on 'click' (fn this.createBoardItem 'image')}}
                      title='Add Image Node'
                    >
                      {{! @glint-ignore }}
                      {{component
                        AILayoutBoard.ImageNodeIcon
                        class='tool-icon'
                      }}
                      <span class='tool-label'>Image</span>
                    </button>
                    <button
                      class='tool-item'
                      {{on 'click' (fn this.createBoardItem 'note')}}
                      title='Add Sticky Note'
                    >
                      {{! @glint-ignore }}
                      {{component
                        AILayoutBoard.PostitNoteIcon
                        class='tool-icon'
                      }}
                      <span class='tool-label'>Note</span>
                    </button>
                    <button
                      class='tool-item'
                      {{on 'click' (fn this.createBoardItem 'timer')}}
                      title='Add Countdown Timer'
                    >
                      {{! @glint-ignore }}
                      {{component
                        AILayoutBoard.CountdownTimerIcon
                        class='tool-icon'
                      }}
                      <span class='tool-label'>Timer</span>
                    </button>
                    <button
                      class='tool-item'
                      {{on 'click' (fn this.createBoardItem 'external')}}
                      title='Add External Card'
                    >
                      {{! @glint-ignore }}
                      {{component
                        AILayoutBoard.ExternalCardIcon
                        class='tool-icon'
                      }}
                      <span class='tool-label'>External</span>
                    </button>
                  </div>
                </div>
              {{/if}}

              <button
                class='tool-palette-trigger'
                {{on 'click' this.toggleToolPalette}}
                title='Toggle tool palette'
              >
                {{#if this.showToolPalette}}
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <line x1='18' y1='6' x2='6' y2='18'></line>
                    <line x1='6' y1='6' x2='18' y2='18'></line>
                  </svg>
                {{else}}
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <line x1='12' y1='5' x2='12' y2='19'></line>
                    <line x1='5' y1='12' x2='19' y2='12'></line>
                  </svg>
                {{/if}}
              </button>
            </div>
          </div>
        </div>
      {{else}}
        {{! List View - borrowed from NarrativeBoard }}
        <div class='list-section'>
          {{#if (gt this.allItemsLength 0)}}
            <div class='items-container'>
              {{#each @model.allItems as |item|}}
                <div class='list-item-entry'>
                  {{! ⁶⁴ Direct delegation for ExternalCard in list view }}
                  {{#if (eq item.constructor.name 'ExternalCard')}}
                    {{#if (get item 'externalCard')}}
                      {{#let (get item 'externalCard') as |linkedCard|}}
                        {{#if (and linkedCard (get linkedCard 'constructor'))}}
                          {{#let
                            (get linkedCard 'constructor')
                            as |LinkedCtor|
                          }}
                            {{#if (get LinkedCtor 'embedded')}}
                              {{#let (get LinkedCtor 'embedded') as |Embedded|}}
                                <div class='external-card-wrapper'>
                                  {{#if (get item 'caption')}}
                                    <div class='external-list-caption'>
                                      {{! @glint-ignore }}
                                      {{get item 'caption'}}
                                    </div>
                                  {{/if}}
                                  {{! @glint-ignore }}
                                  {{component Embedded model=linkedCard}}
                                </div>
                              {{/let}}
                            {{else}}
                              <div class='unsupported-item'>Linked card has no
                                embedded format</div>
                            {{/if}}
                          {{/let}}
                        {{else}}
                          <div class='unsupported-item'>Linked card not
                            available</div>
                        {{/if}}
                      {{/let}}
                    {{else}}
                      <div class='external-placeholder'>
                        🔗 No card linked
                        {{! @glint-ignore }}
                        {{#if (get item 'caption')}}
                          ({{concat '' (get item 'caption')}}){{/if}}
                      </div>
                    {{/if}}
                  {{else}}
                    {{! Standard delegation for other items }}
                    {{! @glint-ignore }}
                    {{#if (and item (get item 'constructor'))}}
                      {{#let (get item 'constructor') as |Ctor|}}
                        {{#if (get Ctor 'embedded')}}
                          {{#let (get Ctor 'embedded') as |Embedded|}}
                            {{! @glint-ignore }}
                            {{component Embedded model=item}}
                          {{/let}}
                        {{else}}
                          <div class='unsupported-item'>No embedded format</div>
                        {{/if}}
                      {{/let}}
                    {{else}}
                      <div class='unsupported-item'>Unsupported item</div>
                    {{/if}}
                  {{/if}}

                  {{#if item.position}}
                    <div class='position-caption'>
                      Position:
                      {{item.position.x}},{{item.position.y}}
                      • Size:
                      {{item.position.width}}×{{item.position.height}}
                      • Layer:
                      {{item.position.layer}}
                      • Format:
                      {{if
                        (eq item.position.format 'fitted')
                        'Fitted'
                        'Embedded'
                      }}
                    </div>
                  {{/if}}
                </div>
              {{/each}}
            </div>
          {{else}}
            <div class='empty-state'>
              <div class='empty-icon'>📋</div>
              <h3>Empty Layout Board</h3>
              <p>Add images, notes, and timers to create your layout.</p>
            </div>
          {{/if}}
        </div>
      {{/if}}

      {{! Footer removed - summary moved to header }}
    </div>

    <style scoped>
      .layout-board {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
      }

      /* Optimized Header */
      .board-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1.5rem;
        background: white;
        border-bottom: 1px solid #e5e7eb;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        min-height: 60px;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex: 1;
        min-width: 0;
      }

      .board-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0;
        white-space: nowrap;
      }

      .board-description {
        font-size: 0.8125rem;
        color: #6b7280;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      .header-center {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .item-summary {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.375rem 0.75rem;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .item-summary:hover {
        background: #e5e7eb;
        border-color: #d1d5db;
      }

      .item-summary.active {
        background: #3b82f6;
        border-color: #3b82f6;
        color: white;
      }

      .item-summary.active .summary-count {
        color: white;
      }

      .item-summary.active .summary-label {
        color: rgba(255, 255, 255, 0.9);
      }

      .item-summary.active:hover {
        background: #2563eb;
        border-color: #2563eb;
      }

      .summary-count {
        font-size: 1rem;
        font-weight: 600;
        color: #3b82f6;
      }

      .summary-label {
        font-size: 0.75rem;
        color: #6b7280;
      }

      .header-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
      }

      .header-btn {
        width: 40px;
        height: 40px;
        padding: 0;
        background: #f9fafb;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 1.125rem;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .header-btn:hover {
        background: #f3f4f6;
        border-color: #9ca3af;
      }

      .view-toggle {
        background: #3b82f6;
        border-color: #3b82f6;
        color: white;
      }

      .view-toggle:hover {
        background: #2563eb;
        border-color: #2563eb;
      }

      /* Canvas Section */
      .canvas-section {
        flex: 1;
        position: relative;
        overflow: hidden;
      }

      .layout-viewport {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #f8fafc;
        cursor: grab;
        user-select: none; /* ⁹⁴ Prevent text selection during drag */
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
      }

      .layout-viewport:active {
        cursor: grabbing;
      }

      .pan-zoom-pane {
        width: 100%;
        height: 100%;
        position: relative;
        transform-origin: 0 0;
        user-select: none; /* ⁹⁶ Prevent text selection on the pan-zoom pane */
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
      }

      .grid-background {
        position: absolute;
        inset: 0; /* fill full width and height of the canvas pane */
        width: 100%;
        height: 100%;
        background-image:
          linear-gradient(rgba(0, 0, 0, 0.1) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0, 0, 0, 0.1) 1px, transparent 1px);
        background-repeat: repeat;
        background-size: 20px 20px; /* overridden by inline style based on grid size */
        pointer-events: none;
      }

      .layout-item-positioned {
        pointer-events: auto;
        position: relative;
        user-select: none; /* ⁹⁵ Prevent text selection on canvas items */
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
      }

      /* Ensure interactive children are recognized by canvas guards */
      .layout-item-positioned > .board-interactive,
      .external-card-wrapper.board-interactive,
      .tile-interactive-wrapper,
      .card-interactive-wrapper {
        pointer-events: auto;
      }

      /* Frost effect styling for hovered items */
      .layout-item-wrapper.hovered::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255, 255, 255, 0.4);
        backdrop-filter: blur(12px);
        border-radius: 8px;
        pointer-events: none;
        z-index: -1;
        opacity: 1;
        transition: opacity 0.2s ease;
      }

      /* ¹⁵² Selected item styling - SUPER prominent orange halo effect */
      .layout-item-wrapper.selected {
        z-index: 20 !important;
      }

      .layout-item-wrapper.selected .window-frame {
        border: none !important;
        background: transparent !important;
        opacity: 1 !important;
        box-shadow:
          0 0 0 0px transparent,
          0 0 20px 8px rgba(245, 158, 11, 0.6),
          0 0 40px 12px rgba(245, 158, 11, 0.3),
          0 0 60px 16px rgba(245, 158, 11, 0.1) !important;
        display: block !important; /* Force frame to be visible */
      }

      .layout-item-wrapper.selected .window-header {
        background: #f59e0b !important;
        opacity: 1 !important;
        box-shadow:
          0 4px 12px rgba(245, 158, 11, 0.5),
          0 0 0 2px rgba(245, 158, 11, 0.8);
        display: flex !important; /* Force header to be visible */
      }

      /* ¹⁵⁸ Force visibility of frame and header for selected items */
      .layout-item-wrapper.selected .window-frame,
      .layout-item-wrapper.selected .window-header {
        opacity: 1 !important;
        visibility: visible !important;
      }

      /* ¹⁵³ Delete button styling */
      .delete-button-container {
        position: absolute;
        top: 2%;
        right: 2%;
        z-index: 100;
        pointer-events: auto;
      }

      .delete-button {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        border: none;
        border-radius: 9999px;
        color: white;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 14px;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
        transition: all 0.2s ease;
        font-weight: 600;
      }

      .delete-button:hover {
        background: linear-gradient(135deg, #dc2626, #b91c1c);
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(239, 68, 68, 0.5);
      }

      .delete-button svg {
        width: 20px;
        height: 20px;
        stroke-width: 2;
      }

      .delete-button .delete-label {
        font-size: 0.875rem;
        line-height: 1;
      }

      .delete-button .delete-count {
        font-size: 0.875rem;
        opacity: 0.9;
      }

      /* ⁶⁶ External card wrapper styling */
      .external-card-wrapper {
        position: relative;
        width: 100%;
        height: auto;
        display: flex;
        flex-direction: column;
      }

      /* ¹⁴² Card type header styling */
      .card-type-header {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.125rem 0.375rem;
        background: transparent;
        border-radius: 3px;
        font-size: 0.625rem;
        font-weight: 500;
        color: #6b7280;
        pointer-events: none;
        z-index: 1;
        flex-shrink: 0;
        position: absolute;
        top: -32px;
        left: 0px;
      }

      .card-type-icon {
        width: 8px;
        height: 8px;
        opacity: 0.8;
        flex-shrink: 0;
      }

      .card-type-icon-placeholder {
        font-size: 8px;
        opacity: 0.8;
        flex-shrink: 0;
      }

      .card-type-name {
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      .external-content {
        flex: 1;
        min-height: 0;
        position: relative;
      }

      .external-caption {
        position: absolute;
        top: -0.75rem;
        left: 0.5rem;
        background: #8b5cf6;
        color: white;
        padding: 0.25rem 0.75rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        z-index: 10;
        white-space: nowrap;
        pointer-events: none; /* caption must not block clicks */
      }

      .external-list-caption {
        background: #8b5cf6;
        color: white;
        padding: 0.375rem 0.75rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
        display: inline-block;
      }

      .external-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        background: rgba(139, 92, 246, 0.1);
        border: 2px dashed #8b5cf6;
        border-radius: 8px;
        color: #6b7280;
        font-size: 0.875rem;
        font-weight: 500;
        text-align: center;
        padding: 1rem;
      }

      .canvas-controls {
        position: absolute;
        top: 2%;
        left: 2%;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        font-size: 0.75rem;
        color: #374151;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        display: flex;
        align-items: center;
        gap: 1px;
        padding: 4px;
        pointer-events: auto;
      }

      .zoom-btn {
        height: 28px;
        padding: 0 8px;
        background: white;
        border: none;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 500;
        color: #374151;
        cursor: pointer;
        transition: background 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        white-space: nowrap;
      }

      .zoom-btn svg {
        width: 12px;
        height: 12px;
        stroke-width: 2;
      }

      .zoom-btn:hover {
        background: #f3f4f6;
      }

      .zoom-info {
        padding: 0 8px;
        border-left: 1px solid #e5e7eb;
        margin-left: 4px;
      }

      .zoom-display {
        font-weight: 600;
        color: #1f2937;
        font-size: 0.75rem;
      }

      /* ⁹² Tool Palette Styling */
      .tool-palette-container {
        position: absolute;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        pointer-events: auto;
      }

      .tool-palette-trigger {
        width: 48px;
        height: 48px;
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        border: none;
        border-radius: 50%;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        transition: all 0.2s ease;
        position: relative;
        z-index: 1001;
      }

      .tool-palette-trigger:hover {
        background: linear-gradient(135deg, #2563eb, #1e40af);
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(59, 130, 246, 0.5);
      }

      .tool-palette-trigger svg {
        width: 24px;
        height: 24px;
        stroke-width: 2.5;
      }

      .tool-palette {
        position: absolute;
        bottom: 64px;
        left: 50%;
        transform: translateX(-50%);
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        backdrop-filter: blur(12px);
        padding: 16px;
        min-width: 320px;
        animation: paletteSlideUp 0.2s ease-out;
      }

      @keyframes paletteSlideUp {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      .palette-header {
        text-align: center;
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #f3f4f6;
      }

      .palette-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: #374151;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .palette-tools {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }

      .tool-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 12px 8px;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.15s ease;
        position: relative;
        overflow: hidden;
      }

      .tool-item:hover {
        background: #f3f4f6;
        border-color: #3b82f6;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
      }

      .tool-item:active {
        transform: translateY(0);
        background: #e5e7eb;
      }

      .tool-icon {
        width: 24px;
        height: 24px;
        color: #374151;
        transition: color 0.15s ease;
      }

      .tool-item:hover .tool-icon {
        color: #3b82f6;
      }

      .tool-label {
        font-size: 0.75rem;
        font-weight: 500;
        color: #6b7280;
        transition: color 0.15s ease;
      }

      .tool-item:hover .tool-label {
        color: #374151;
      }

      .empty-canvas {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        text-align: center;
        color: #6b7280;
      }

      .empty-canvas .empty-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
      }

      .empty-canvas h3 {
        font-size: 1.5rem;
        font-weight: 600;
        color: #374151;
        margin: 0 0 0.5rem 0;
      }

      .empty-canvas p {
        font-size: 1rem;
        margin: 0;
      }

      .empty-add-button {
        margin-top: 1.5rem;
        padding: 0.75rem 1.5rem;
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        border: none;
        border-radius: 8px;
        color: white;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.15s ease;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
      }

      .empty-add-button:hover {
        background: linear-gradient(135deg, #2563eb, #1e40af);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
      }

      .empty-add-button svg {
        width: 18px;
        height: 18px;
      }

      /* List Section */
      .list-section {
        flex: 1;
        padding: 2rem;
        overflow-y: auto;
      }

      .items-container {
        max-width: 56rem;
        margin: 0 auto;
      }

      .items-container .list-item-entry {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 1.5rem;
        padding: 1.5rem;
        background: white;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .position-caption {
        color: #6b7280;
        font-size: 0.75rem;
        font-family:
          'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas,
          'Courier New', monospace;
        padding: 0.5rem;
        background: #f3f4f6;
        border-radius: 6px;
      }

      .unsupported-item {
        padding: 0.75rem;
        border-radius: 6px;
        background: #fff7ed;
        color: #9a3412;
        font-size: 0.8125rem;
        border: 1px dashed #f59e0b;
      }

      .empty-state {
        text-align: center;
        padding: 4rem 2rem;
        background: white;
        border-radius: 16px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
      }

      .empty-state .empty-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
      }

      .empty-state h3 {
        font-size: 1.5rem;
        font-weight: 600;
        color: #374151;
        margin: 0 0 0.5rem 0;
      }

      .empty-state p {
        font-size: 1rem;
        color: #6b7280;
        margin: 0;
      }

      /* Removed Summary Footer - information moved to header */

      @media (max-width: 768px) {
        .board-header {
          flex-direction: column;
          gap: 1rem;
          text-align: center;
        }

        .list-section {
          padding: 1rem;
        }

        .item-counts {
          gap: 1rem;
        }
      }
    </style>
  </template>
}

class Embedded extends Component<typeof AILayoutBoard> {
  // Getter to safely compute allItems length (mirrors Isolated)
  get allItemsLength(): number {
    return this.args.model.allItems?.length || 0;
  }

  <template>
    <div class='layout-board-embedded'>
      <div class='embedded-header'>
        <h3 class='embedded-title'>{{if
            @model.title
            @model.title
            '2D Layout Board'
          }}</h3>
        <div class='embedded-counts'>
          {{if @model.images.length @model.images.length 0}}
          images,
          {{if @model.notes.length @model.notes.length 0}}
          notes,
          {{if @model.timers.length @model.timers.length 0}}
          timers,
          {{! ⁶⁷ External cards in embedded view }}
          {{if @model.externalCards.length @model.externalCards.length 0}}
          external • Spatial layout with canvas interaction
        </div>
      </div>

      {{#if (gt this.allItemsLength 0)}}
        <div class='embedded-preview'>
          <div class='layout-minimap'>
            {{#each @model.allItems as |item index|}}
              {{#if (lt index 6)}}
                <div
                  class={{concat
                    'minimap-item '
                    (if
                      (eq item.constructor.name 'ImageNode') 'minimap-image ' ''
                    )
                    (if
                      (eq item.constructor.name 'PostitNote') 'minimap-note ' ''
                    )
                    (if
                      (eq item.constructor.name 'CountdownTimer')
                      'minimap-timer '
                      ''
                    )
                    (if
                      (eq item.constructor.name 'ExternalCard')
                      'minimap-external '
                      ''
                    )
                  }}
                  title={{concat
                    item.constructor.name
                    ' at ('
                    item.position.x
                    ','
                    item.position.y
                    ')'
                  }}
                >
                  {{#if (eq item.constructor.name 'ImageNode')}}📷{{/if}}
                  {{#if (eq item.constructor.name 'PostitNote')}}📝{{/if}}
                  {{#if (eq item.constructor.name 'CountdownTimer')}}⏱️{{/if}}
                  {{#if (eq item.constructor.name 'ExternalCard')}}🔗{{/if}}
                </div>
              {{/if}}
            {{/each}}
          </div>
          {{#if (gt this.allItemsLength 6)}}
            <div class='more-indicator'>+{{subtract this.allItemsLength 6}}
              more items</div>
          {{/if}}
        </div>
      {{else}}
        <div class='embedded-empty'>No layout items yet</div>
      {{/if}}
    </div>

    <style scoped>
      .layout-board-embedded {
        background: white;
        border-radius: 12px;
        padding: 1rem;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .embedded-header {
        margin-bottom: 1rem;
      }

      .embedded-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0 0 0.25rem 0;
      }

      .embedded-counts {
        font-size: 0.875rem;
        color: #6b7280;
      }

      .embedded-preview {
        position: relative;
      }

      .layout-minimap {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 4px;
        width: 100%;
        height: 80px;
        background: #f8fafc;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        overflow: hidden;
        align-content: flex-start;
      }

      .minimap-item {
        width: 20px;
        height: 20px;
        border-radius: 2px;
        font-size: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .minimap-image {
        background: #3b82f6;
      }
      .minimap-note {
        background: #f59e0b;
      }
      .minimap-timer {
        background: #8b5cf6;
      }
      .minimap-external {
        background: #10b981;
      }

      .more-indicator {
        text-align: center;
        font-size: 0.75rem;
        color: #6b7280;
        font-style: italic;
        margin-top: 0.5rem;
      }

      .embedded-empty {
        text-align: center;
        color: #9ca3af;
        font-style: italic;
        padding: 2rem;
        background: #f8fafc;
        border-radius: 8px;
      }
    </style>
  </template>
}

class Fitted extends Component<typeof AILayoutBoard> {
  // Getter to safely compute allItems length (mirrors Isolated)
  get allItemsLength(): number {
    return this.args.model.allItems?.length || 0;
  }

  // Normalized data for the card minimap so items always fit and are visible
  get minimapData() {
    const items = (this.args.model.allItems || []).filter(
      (it: any) => it && it.position,
    );
    if (!items.length) return [] as any[];

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    items.forEach((item: any) => {
      const x = item.position.x || 0;
      const y = item.position.y || 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });

    const rangeX = Math.max(0, maxX - minX);
    const rangeY = Math.max(0, maxY - minY);
    const margin = 5; // percent padding inside minimap
    const span = 100 - margin * 2;

    return items.map((item: any) => {
      const x = item.position.x || 0;
      const y = item.position.y || 0;
      const normX = rangeX === 0 ? 0.5 : (x - minX) / rangeX;
      const normY = rangeY === 0 ? 0.5 : (y - minY) / rangeY;
      const left = margin + normX * span;
      const top = margin + normY * span;
      return {
        type: item.constructor?.name || 'Item',
        x,
        y,
        left,
        top,
      };
    });
  }

  <template>
    <div class='fitted-container'>
      {{! Badge Format }}
      <div class='badge-format'>
        <div class='layout-badge'>
          <div class='badge-icon'>🎨</div>
          <div class='badge-text'>
            <div class='primary-text'>{{if
                @model.title
                @model.title
                'Layout'
              }}</div>
          </div>
          <div class='badge-count'>{{this.allItemsLength}}</div>
        </div>
      </div>

      {{! Strip Format }}
      <div class='strip-format'>
        <div class='strip-icon'>🎨</div>
        <div class='strip-content'>
          <div class='primary-text'>{{if
              @model.title
              @model.title
              '2D Layout Board'
            }}</div>
          <div class='tertiary-text'>{{this.allItemsLength}}
            items in spatial layout</div>
        </div>
      </div>

      {{! Tile Format }}
      <div class='tile-format'>
        <div class='tile-layout'>
          <div class='tile-header'>
            <div class='primary-text'>{{if
                @model.title
                @model.title
                'Layout'
              }}</div>
            <div class='layout-icon'>🎨</div>
          </div>
          <div class='tile-body'>
            <div class='tile-minimap'>
              {{#each @model.allItems as |item index|}}
                {{#if (lt index 9)}}
                  <div
                    class={{concat
                      'tile-mini-item '
                      (if
                        (eq item.constructor.name 'ImageNode')
                        'tile-mini-image '
                        ''
                      )
                      (if
                        (eq item.constructor.name 'PostitNote')
                        'tile-mini-note '
                        ''
                      )
                      (if
                        (eq item.constructor.name 'CountdownTimer')
                        'tile-mini-timer '
                        ''
                      )
                      (if
                        (eq item.constructor.name 'ExternalCard')
                        'tile-mini-external '
                        ''
                      )
                    }}
                    title={{concat
                      item.constructor.name
                      ' at ('
                      item.position.x
                      ','
                      item.position.y
                      ')'
                    }}
                  >
                    {{#if (eq item.constructor.name 'ImageNode')}}📷{{/if}}
                    {{#if (eq item.constructor.name 'PostitNote')}}📝{{/if}}
                    {{#if (eq item.constructor.name 'CountdownTimer')}}⏱️{{/if}}
                    {{#if (eq item.constructor.name 'ExternalCard')}}🔗{{/if}}
                  </div>
                {{/if}}
              {{/each}}
            </div>
            {{#if (gt this.allItemsLength 9)}}
              <div class='overflow-indicator'>+{{subtract
                  this.allItemsLength
                  9
                }}</div>
            {{/if}}
          </div>
        </div>
      </div>

      {{! Card Format }}
      <div class='card-format'>
        <div class='card-layout'>
          <div class='card-header'>
            <div class='primary-text'>{{if
                @model.title
                @model.title
                '2D Layout Board'
              }}</div>
            <div class='layout-icon'>🎨</div>
          </div>
          <div class='card-body'>
            <div class='tile-minimap'>
              {{#each this.minimapData as |mItem index|}}
                {{#if (lt index 8)}}
                  <div
                    class='tile-mini-item'
                    title={{concat mItem.type ' at (' mItem.x ',' mItem.y ')'}}
                  >
                    {{#if (eq mItem.type 'ImageNode')}}📷{{/if}}
                    {{#if (eq mItem.type 'PostitNote')}}📝{{/if}}
                    {{#if (eq mItem.type 'CountdownTimer')}}⏱️{{/if}}
                    {{#if (eq mItem.type 'ExternalCard')}}🔗{{/if}}
                  </div>
                {{/if}}
              {{/each}}
            </div>
            <div class='card-stats'>
              <div class='stat-row'>
                <span>Items: {{this.allItemsLength}}</span>
                <span>{{@model.canvasWidth}}×{{@model.canvasHeight}}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .fitted-container {
        width: 100%;
        height: 100%;
      }

      /* Hide all by default */
      .badge-format,
      .strip-format,
      .tile-format,
      .card-format {
        display: none;
        width: 100%;
        height: 100%;
        padding: clamp(0.1875rem, 2%, 0.625rem);
        box-sizing: border-box;
      }

      /* Badge Format */
      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
          align-items: center;
        }
      }

      .layout-badge {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.25rem 0.5rem;
        background: linear-gradient(135deg, #8b5cf6, #7c3aed);
        border-radius: 6px;
        color: white;
      }

      .badge-icon {
        font-size: 1rem;
        flex-shrink: 0;
      }

      .badge-text {
        flex: 1;
        min-width: 0;
      }

      .badge-count {
        font-size: 0.75rem;
        font-weight: 600;
        background: rgba(255, 255, 255, 0.2);
        padding: 0.125rem 0.375rem;
        border-radius: 4px;
        flex-shrink: 0;
      }

      /* Strip Format */
      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
          align-items: center;
        }
      }

      .strip-format {
        gap: 0.75rem;
      }

      .strip-icon {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #8b5cf6, #7c3aed);
        font-size: 1.25rem;
        color: white;
        flex-shrink: 0;
      }

      .strip-content {
        flex: 1;
        min-width: 0;
      }

      /* Tile Format */
      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
        }
      }

      .tile-layout {
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #f8fafc, #e2e8f0);
        border-radius: 12px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
      }

      .tile-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;
      }

      .layout-icon {
        font-size: 1.25rem;
        opacity: 0.7;
      }

      .tile-body {
        flex: 1;
        position: relative;
      }

      .tile-minimap {
        position: relative;
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        padding: 0.1rem;
        background: white;
        border-radius: 6px;
        border: 1px solid #e5e7eb;
        overflow: hidden;
        margin-bottom: 0.5rem;
      }

      .tile-mini-item {
        position: relative;
        width: 25px;
        height: 25px;
        border-radius: 4px;
        font-size: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        border: 1px solid rgba(0, 0, 0, 0.06);
      }

      .tile-mini-image {
        background: #3b82f6;
      }
      .tile-mini-note {
        background: #f59e0b;
      }
      .tile-mini-timer {
        background: #8b5cf6;
      }
      .tile-mini-external {
        background: #10b981;
      }

      .overflow-indicator {
        position: absolute;
        bottom: 0;
        right: 0;
        font-size: 0.75rem;
        color: #6b7280;
        background: white;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
      }

      /* ¹⁸⁶ Interactive wrapper styles for embedded cards */
      .tile-interactive-wrapper,
      .card-interactive-wrapper {
        position: relative;
        width: 100%;
        height: 100%;
        /* Enable all pointer events for interactivity */
        pointer-events: auto;
      }

      /* ¹⁸⁷ Full space content wrapper - ensures fitted component fills 100% */
      .full-space-content {
        width: 100%;
        height: 100%;
        /* Container queries will work on the actual fitted component inside */
        container-type: size;
      }

      .tile-caption,
      .card-caption {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        background: rgba(139, 92, 246, 0.95);
        color: white;
        padding: 0.25rem 0.75rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        z-index: 10;
        backdrop-filter: blur(4px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        pointer-events: none; /* Caption doesn't block interaction */
      }

      /* Error state styling for tile and card formats */
      .tile-error,
      .card-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        background: #fef2f2;
        border: 2px dashed #f87171;
        border-radius: 8px;
        color: #dc2626;
        text-align: center;
        padding: 1rem;
      }

      .tile-error .error-icon,
      .card-error .error-icon {
        font-size: 1.5rem;
        margin-bottom: 0.5rem;
      }

      .tile-error .error-text,
      .card-error .error-text {
        font-size: 0.875rem;
        font-weight: 500;
      }

      /* Card Format */
      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
          flex-direction: column;
        }
      }

      .card-layout {
        flex: 1;
        background: linear-gradient(135deg, #f8fafc, #e2e8f0);
        border-radius: 16px;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        margin-bottom: 0.75rem;
      }

      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.5rem;
      }

      .card-body {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .card-stats {
        margin-top: auto;
      }

      .stat-row {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        color: #6b7280;
      }

      /* Typography hierarchy */
      .primary-text {
        font-size: 1em;
        font-weight: 600;
        color: currentColor;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tertiary-text {
        font-size: 0.75em;
        font-weight: 400;
        color: rgba(0, 0, 0, 0.7);
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

// ³⁴ 2D Layout Board Card - Similar to NarrativeBoard but with spatial canvas
export class AILayoutBoard extends CardDef {
  static displayName = 'Card Board'; // ⁷³ Updated display name
  static icon = LayoutIcon; // ⁷⁴ Added layout grid icon
  static prefersWideFormat = true;

  @field images = containsMany(ImageNode);
  @field notes = containsMany(PostitNote);
  @field timers = containsMany(CountdownTimer);
  @field externalCards = containsMany(ExternalCard); // ⁵⁹ External cards field

  // ¹⁴ Canvas settings
  @field canvasWidth = contains(StringField, {
    computeVia: function (this: AILayoutBoard) {
      return '100%';
    },
  }); // This is needed be 100% accurate for the canvas width
  @field canvasHeight = contains(NumberField);
  @field gridSize = contains(NumberField);

  // ¹⁸⁰ Canvas transform state for persistence
  @field transformX = contains(NumberField);
  @field transformY = contains(NumberField);
  @field transformK = contains(NumberField);

  // ⁸⁷ Add icons for each BoardItem type
  static ImageNodeIcon = ImageIcon;
  static PostitNoteIcon = StickyNoteIcon;
  static CountdownTimerIcon = TimerIcon;
  static ExternalCardIcon = LinkIcon;

  // ¹⁵ Computed field to get all items sorted by layer - borrowed from NarrativeBoard
  @field allItems = containsMany(BoardItem, {
    computeVia: function (this: AILayoutBoard) {
      try {
        const allItems: BoardItem[] = [];

        // ¹⁶⁶ Enhanced null safety for all array field access
        const images = this.images;
        if (images && Array.isArray(images)) {
          allItems.push(
            ...images.filter(
              (item) => item != null && typeof item === 'object',
            ),
          );
        }

        const notes = this.notes;
        if (notes && Array.isArray(notes)) {
          allItems.push(
            ...notes.filter((item) => item != null && typeof item === 'object'),
          );
        }

        const timers = this.timers;
        if (timers && Array.isArray(timers)) {
          allItems.push(
            ...timers.filter(
              (item) => item != null && typeof item === 'object',
            ),
          );
        }

        const externalCards = this.externalCards;
        if (externalCards && Array.isArray(externalCards)) {
          allItems.push(
            ...externalCards.filter(
              (item) => item != null && typeof item === 'object',
            ),
          );
        }

        // ¹⁶⁷ Enhanced sorting with comprehensive validation
        return allItems
          .filter((item) => {
            return (
              item != null &&
              typeof item === 'object' &&
              item.position != null &&
              typeof item.position === 'object'
            );
          })
          .sort((a, b) => {
            try {
              const layerA =
                a.position && typeof a.position.layer === 'number'
                  ? a.position.layer
                  : 0;
              const layerB =
                b.position && typeof b.position.layer === 'number'
                  ? b.position.layer
                  : 0;
              return layerA - layerB;
            } catch (sortError) {
              console.warn(
                'AILayoutBoard: Error sorting items by layer',
                sortError,
              );
              return 0;
            }
          });
      } catch (e) {
        console.error('AILayoutBoard: Error computing allItems', e, {
          images: this.images,
          notes: this.notes,
          timers: this.timers,
          externalCards: this.externalCards,
        });
        return [];
      }
    },
  });

  static isolated = Isolated;
  static embedded = Embedded;
  static fitted = Fitted;
}
