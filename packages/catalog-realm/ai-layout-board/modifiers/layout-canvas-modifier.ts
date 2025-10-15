// ³ Canvas Modifier for 2D Layout interactions - simplified from Flow2D
import Modifier from 'ember-modifier';

type LayoutCanvasNamedArgs = {
  onTransform?: (t: { x: number; y: number; k: number }) => void;
  onItemDrag?: (item: any, isDragEnd?: boolean) => void;
  onItemSelect?: (id: string | null) => void;
  selectedItemId?: string | null;
  itemData?: any[];
  onOpenCard?: (cardId: string) => void;
};

export default class LayoutCanvasModifier extends Modifier<{
  Args: { Positional: []; Named: LayoutCanvasNamedArgs };
  Element: HTMLElement;
}> {
  private element: HTMLElement | null = null;
  private args: { positional: []; named: LayoutCanvasNamedArgs } | null = null;
  private panZoomPane: HTMLElement | null = null;
  private isDragging = false;
  private dragStartPos = { x: 0, y: 0 };
  private lastPanPos = { x: 0, y: 0 };
  private currentTransform = { x: 0, y: 0, k: 1 };
  private nodeElements = new Map<string, HTMLElement>();
  private overlayMeasureIntervals = new Map<
    HTMLElement,
    ReturnType<typeof setInterval>
  >();

  constructor(owner: any, args: any) {
    super(owner, args);
  }

  private cleanupOverlay(overlay: HTMLElement) {
    const storedInterval = this.overlayMeasureIntervals.get(overlay);
    const intervalId =
      storedInterval ??
      (overlay.dataset.measureInterval
        ? Number(overlay.dataset.measureInterval)
        : undefined);

    if (intervalId !== undefined) {
      window.clearInterval(intervalId as number);
    }

    if (storedInterval !== undefined) {
      this.overlayMeasureIntervals.delete(overlay);
    }

    if (overlay.dataset.measureInterval) {
      delete overlay.dataset.measureInterval;
    }
  }

  private teardownNodes() {
    this.nodeElements.forEach((overlay) => {
      this.cleanupOverlay(overlay);
      overlay.remove();
    });
    this.nodeElements.clear();
    this.overlayMeasureIntervals.clear();

    if (this.panZoomPane) {
      this.panZoomPane
        .querySelectorAll('.layout-item-wrapper')
        .forEach((node) => {
          if (node instanceof HTMLElement) {
            this.cleanupOverlay(node);
          }
          node.remove();
        });
    }
  }

  setupCanvas(element: HTMLElement) {
    // ⁴ Setup canvas with native DOM events - borrowed from Flow2D
    this.panZoomPane = element.querySelector('.pan-zoom-pane');
    if (!this.panZoomPane) return;

    // Setup zoom with mouse wheel
    element.addEventListener('wheel', this.handleWheel, { passive: false });

    // Setup pan with mouse drag
    element.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);

    // Setup nodes for drag behavior
    this.setupNodes();
  }

  handleWheel = (event: WheelEvent) => {
    const target = event.target as HTMLElement;

    // ¹²⁰ CRITICAL: Only prevent wheel on drag handles, allow content interaction
    if (target.closest('.drag-handle')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Pass through if this originates from an interactive child of a board item
    if (target.closest('.board-interactive')) {
      return;
    }

    // Only handle wheel events on the canvas background itself
    if (
      !target.closest('.layout-viewport') ||
      (!target.classList.contains('pan-zoom-pane') &&
        !target.classList.contains('grid-background') &&
        !target.classList.contains('layout-viewport'))
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (!this.element) return;
    const rect = this.element.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // ⁷⁷ More sensitive zoom calculation with easing
    const sensitivity = 0.05; // Reduced from implicit ~0.1 (0.9/1.1 difference)
    const zoomDirection = event.deltaY > 0 ? -1 : 1;
    const zoomDelta = sensitivity * zoomDirection;

    // ⁷⁸ Apply zoom with smoother progression - limited to 300% max
    const currentScale = this.currentTransform.k;
    const targetScale = currentScale * (1 + zoomDelta);
    const newScale = Math.min(Math.max(targetScale, 0.1), 3);

    // ⁷⁹ Calculate zoom point in world coordinates (relative to the panned/scaled content)
    const worldMouseX =
      (mouseX - this.currentTransform.x) / this.currentTransform.k;
    const worldMouseY =
      (mouseY - this.currentTransform.y) / this.currentTransform.k;

    // ⁸⁰ Calculate new pan to keep the cursor position locked during zoom
    const newX = mouseX - worldMouseX * newScale;
    const newY = mouseY - worldMouseY * newScale;

    this.currentTransform = { x: newX, y: newY, k: newScale };
    this.applyTransform();

    const { onTransform } = this.args?.named || {};
    onTransform?.(this.currentTransform);
  };

  handleMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement;

    // ¹²¹ CRITICAL: Only prevent pan on drag handles, allow content interaction
    if (target.closest('.drag-handle')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Pass through if click originates from interactive child content
    if (target.closest('.board-interactive')) {
      return;
    }

    // Only handle mouse events on the canvas background itself
    if (
      !target.closest('.layout-viewport') ||
      (!target.classList.contains('pan-zoom-pane') &&
        !target.classList.contains('grid-background') &&
        !target.classList.contains('layout-viewport'))
    ) {
      return;
    }

    // Still allow drag handles to work for item repositioning
    if (
      target.classList.contains('drag-handle') ||
      target.closest('.drag-handle')
    ) {
      return; // Let node drag handle this
    }

    this.isDragging = true;
    this.dragStartPos = { x: event.clientX, y: event.clientY };
    this.lastPanPos = {
      x: this.currentTransform.x,
      y: this.currentTransform.y,
    };

    if (this.element) {
      this.element.style.cursor = 'grabbing';
    }
  };

  handleMouseMove = (event: MouseEvent) => {
    // ⁷ Handle pan drag
    if (!this.isDragging) return;

    const deltaX = event.clientX - this.dragStartPos.x;
    const deltaY = event.clientY - this.dragStartPos.y;

    this.currentTransform.x = this.lastPanPos.x + deltaX;
    this.currentTransform.y = this.lastPanPos.y + deltaY;

    this.applyTransform();

    const { onTransform } = this.args?.named || {};
    onTransform?.(this.currentTransform);
  };

  handleMouseUp = () => {
    // ⁸ Handle pan end
    if (this.isDragging) {
      this.isDragging = false;
      if (this.element) {
        this.element.style.cursor = 'grab';
      }
    }
  };

  applyTransform() {
    // ⁹ Apply CSS transform to pan-zoom pane with 3D acceleration
    if (this.panZoomPane) {
      const { x, y, k } = this.currentTransform;
      this.panZoomPane.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`;
    }
  }

  setupNodes() {
    // ¹⁰ Setup node drag behavior - simplified approach
    const { itemData, onItemDrag, onItemSelect, selectedItemId } =
      this.args?.named || {};
    if (!this.panZoomPane) return;
    // Clear existing nodes
    this.teardownNodes();

    if (!itemData || !Array.isArray(itemData)) return;

    // Create drag overlay elements for each item
    itemData.forEach((item: any) => {
      const dragOverlay = this.createDragOverlay(
        item,
        onItemDrag,
        onItemSelect,
        selectedItemId,
      );
      this.panZoomPane!.appendChild(dragOverlay);
      this.nodeElements.set(item.id, dragOverlay);
    });
  }

  createDragOverlay(
    itemData: any,
    onItemDrag: any,
    onItemSelect?: any,
    selectedItemId?: string | null,
  ) {
    // ¹¹ Create drag overlay for layout items
    const existingOverlay = this.nodeElements.get(itemData.id);
    if (existingOverlay) {
      this.cleanupOverlay(existingOverlay);
      existingOverlay.remove();
      this.nodeElements.delete(itemData.id);
    }

    const overlay = document.createElement('div');
    overlay.className = 'layout-item-wrapper';
    overlay.dataset.itemId = itemData.id; // Add ID for height measurement

    // ¹⁴⁹ Apply selection styling if this item is selected
    if (selectedItemId === itemData.id) {
      overlay.classList.add('selected');
    }

    // Apply size and position from BoardPosition
    const pos = itemData.position || {};
    const width = Math.max(pos.width || 120, 120);

    // For external cards, use the same height logic as the canvas rendering
    let height;
    if (pos.format === 'embedded') {
      height = Math.max(pos.customHeight || pos.autoHeight || 80, 80);
    } else {
      height = Math.max(pos.autoHeight || 80, 80);
    }

    overlay.style.cssText = `
        position: absolute;
        transform: translate3d(${pos.x || 0}px, ${pos.y || 0}px, 0);
        width: ${width}px;
        height: ${height}px;
        z-index: ${pos.layer || 1};
        /* Let content underneath receive events by default */
        pointer-events: none;
        user-select: none;
      `;

    // Frosted background layer - using ::before pseudo-element via inline style won't work
    // Instead, we'll add the frost as a background that appears on hover
    overlay.dataset.hasFrost = 'true';

    // Window frame (hidden by default) - no gap
    const frame = document.createElement('div');
    frame.className = 'window-frame';
    frame.style.cssText = `
        position: absolute;
        top: -24px; left: 0; right: 0; bottom: 0;
        border: 2px solid #3b82f6;
        border-radius: 8px;
        background: rgba(59, 130, 246, 0.05);
        opacity: 0;
        transition: opacity 0.15s ease;
        pointer-events: none;
      `;
    overlay.appendChild(frame);

    // Draggable header - no gap
    const header = document.createElement('div');
    header.className = 'window-header drag-handle';
    header.style.cssText = `
          position: absolute;
          top: -24px; left: 0; right: 0; height: 24px;
          background: #3b82f6;
          border-radius: 6px 6px 0 0;
          display: flex; align-items: center; justify-content: space-between;
          cursor: move; opacity: 0;
          transition: opacity 0.15s ease;
          color: white; font-size: 0.75rem; font-weight: 500;
          pointer-events: auto; user-select: none;
          padding: 0 8px;
          z-index: 100; /* ensure only the header sits above content */
        `;

    // Drag text and select button
    const dragText = document.createElement('span');
    dragText.textContent = '⋮⋮ Drag to move';
    dragText.style.cssText = 'flex: 1; text-align: center;';
    header.appendChild(dragText);

    // ¹⁵⁰ Select button (same height and treatment as format toggle)
    const selectButton = document.createElement('button');
    selectButton.className = 'select-button';
    selectButton.style.cssText = `
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        color: white;
        padding: 2px 6px;
        font-size: 0.625rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
        margin-right: 4px;
        height: auto;
      `;

    // ¹⁶⁰ Enhanced selection state with clear visual hierarchy
    if (selectedItemId === itemData.id) {
      selectButton.innerHTML = `
          <div style="display: flex; align-items: center; gap: 3px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20,6 9,17 4,12"></polyline>
            </svg>
            <span>SELECTED</span>
          </div>
        `;
      selectButton.title = 'Click to deselect this item';
      selectButton.style.background =
        'linear-gradient(135deg, #f59e0b, #d97706)';
      selectButton.style.borderColor = '#f59e0b';
      selectButton.style.color = 'white';
      selectButton.style.boxShadow =
        '0 0 12px rgba(245, 158, 11, 0.6), 0 2px 8px rgba(0, 0, 0, 0.2)';
      selectButton.style.transform = 'scale(1.05)';
    } else {
      selectButton.innerHTML = `
          <div style="display: flex; align-items: center; gap: 3px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="8"/>
            </svg>
            <span>SELECT</span>
          </div>
        `;
      selectButton.title = 'Click to select this item for actions';
      selectButton.style.background = 'rgba(255, 255, 255, 0.95)';
      selectButton.style.borderColor = '#3b82f6';
      selectButton.style.color = '#3b82f6';
      selectButton.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
      selectButton.style.transform = 'scale(1)';
    }
    header.appendChild(selectButton);

    // Format toggle button
    const formatToggle = document.createElement('button');
    formatToggle.className = 'format-toggle';
    formatToggle.style.cssText = `
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        color: white;
        padding: 2px 6px;
        font-size: 0.625rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
        margin-left: 4px;
      `;
    formatToggle.textContent = pos.format === 'fitted' ? 'FIT' : 'EMB';
    formatToggle.title =
      pos.format === 'fitted' ? 'Switch to Embedded' : 'Switch to Fitted';
    header.appendChild(formatToggle);

    overlay.appendChild(header);

    // Resize handles
    const resizeRight = document.createElement('div');
    resizeRight.className = 'resize-handle resize-right';
    resizeRight.style.cssText = `
        position: absolute;
        right: -4px; top: 0; bottom: 0; width: 8px;
        cursor: ew-resize; opacity: 0;
        transition: opacity 0.15s ease;
        pointer-events: auto; z-index: 5;
      `;
    overlay.appendChild(resizeRight);

    const resizeBottom = document.createElement('div');
    resizeBottom.className = 'resize-handle resize-bottom';
    resizeBottom.style.cssText = `
        position: absolute;
        bottom: -4px; left: 0; right: 0; height: 8px;
        cursor: ns-resize; opacity: 0;
        transition: opacity 0.15s ease;
        pointer-events: auto; z-index: 5;
      `;
    overlay.appendChild(resizeBottom);

    const resizeCorner = document.createElement('div');
    resizeCorner.className = 'resize-handle resize-corner';
    resizeCorner.style.cssText = `
        position: absolute;
        right: -4px; bottom: -4px; width: 16px; height: 16px;
        cursor: nwse-resize; opacity: 0;
        transition: opacity 0.15s ease;
        pointer-events: auto; z-index: 6;
      `;
    resizeCorner.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="white" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
          <path d="M16 16L16 10L14 12L12 10L10 12L12 14L10 16Z"/>
        </svg>
      `;
    overlay.appendChild(resizeCorner);

    // Auto button for both embedded and isolated formats with custom height
    const autoButton = document.createElement('button');
    autoButton.className = 'auto-height-button';
    autoButton.style.cssText = `
        position: absolute;
        bottom: 4px; left: 50%; transform: translateX(-50%);
        background: #10b981; color: white;
        border: none; border-radius: 4px;
        padding: 4px 8px; font-size: 0.625rem; font-weight: 600;
        cursor: pointer; opacity: 0;
        transition: opacity 0.15s ease, background 0.15s ease;
        pointer-events: auto; z-index: 7;
        display: none;
      `;
    autoButton.textContent = 'Auto';
    autoButton.title = 'Reset to auto height';
    overlay.appendChild(autoButton);

    // Height measurement indicator for embedded format
    const heightIndicator = document.createElement('div');
    heightIndicator.className = 'height-indicator';
    heightIndicator.style.cssText = `
        position: absolute;
        top: 4px; right: 4px;
        background: rgba(59, 130, 246, 0.9); color: white;
        border-radius: 4px;
        padding: 2px 6px; font-size: 0.625rem; font-weight: 600;
        pointer-events: none; z-index: 8;
        display: none;
        white-space: nowrap;
      `;
    overlay.appendChild(heightIndicator);

    // Function to measure actual content height
    const measureContentHeight = () => {
      if (pos.format === 'embedded' || pos.format === 'isolated') {
        // Wait a bit for content to render
        setTimeout(() => {
          // Find the actual rendered content element by matching position
          const allPositionedItems = document.querySelectorAll(
            '.layout-item-positioned',
          );
          let contentElement: Element | null = null;

          allPositionedItems.forEach((el) => {
            const style = el.getAttribute('style') || '';
            const leftMatch = style.match(/left:\s*([^;]+)px/);
            const topMatch = style.match(/top:\s*([^;]+)px/);

            if (leftMatch && topMatch) {
              const left = parseFloat(leftMatch[1]);
              const top = parseFloat(topMatch[1]);

              // Check if this element matches our item's position (with small tolerance)
              if (
                Math.abs(left - (pos.x || 0)) < 1 &&
                Math.abs(top - (pos.y || 0)) < 1
              ) {
                contentElement = el;
              }
            }
          });

          if (contentElement) {
            // First check if there's actual content inside (not just empty wrapper)
            const hasContent = (contentElement as Element).querySelector(
              '.postit-note, .countdown-timer, .external-card-wrapper, .image-node, .unsupported-item',
            );

            if (hasContent) {
              // Get the first child element which should be the actual content
              const innerContent = (contentElement as Element)
                .firstElementChild;
              let actualHeight = 80; // Default

              if (innerContent) {
                // Try multiple methods to get the actual height
                const htmlElement = innerContent as HTMLElement;
                actualHeight = Math.max(
                  htmlElement.scrollHeight || 0,
                  htmlElement.offsetHeight || 0,
                  htmlElement.getBoundingClientRect().height || 0,
                  80, // Minimum height
                );

                // For elements with padding/margin, also check the computed style
                const computedStyle = window.getComputedStyle(innerContent);
                const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
                const paddingBottom =
                  parseFloat(computedStyle.paddingBottom) || 0;
                const marginTop = parseFloat(computedStyle.marginTop) || 0;
                const marginBottom =
                  parseFloat(computedStyle.marginBottom) || 0;

                // Don't add margins/padding if they're already included in the height
                if (
                  actualHeight < 100 &&
                  paddingTop + paddingBottom + marginTop + marginBottom > 0
                ) {
                  // The height might not include padding/margins
                  actualHeight =
                    actualHeight +
                    paddingTop +
                    paddingBottom +
                    marginTop +
                    marginBottom;
                }
              }

              // Only update if we have a valid height that's different from current
              if (
                actualHeight &&
                actualHeight > 20 &&
                Math.abs(actualHeight - (pos.autoHeight || 80)) > 2
              ) {
                // Update the autoHeight with the measured value - defer to avoid circular dependency
                setTimeout(() => {
                  itemData.position.autoHeight = Math.round(actualHeight);
                }, 0);

                // Update height indicator
                if (pos.customHeight) {
                  heightIndicator.textContent = `H: ${
                    pos.customHeight
                  }px (auto: ${Math.round(actualHeight)}px)`;
                  heightIndicator.style.background = 'rgba(239, 68, 68, 0.9)'; // Red for custom
                } else {
                  heightIndicator.textContent = `H: ${Math.round(
                    actualHeight,
                  )}px (auto)`;
                  heightIndicator.style.background = 'rgba(16, 185, 129, 0.9)'; // Green for auto
                }

                // If not using custom height, update the overlay height immediately
                if (!pos.customHeight) {
                  overlay.style.height = `${actualHeight}px`;
                  height = actualHeight;
                }

                onItemDrag?.(itemData);
              }
            }
          } else {
            // If we can't find by position, try to find by data-item-id
            const itemId = overlay.dataset.itemId;
            if (itemId) {
              const itemByDataId = document.querySelector(
                `[data-item-id="${itemId}"]`,
              );
              if (itemByDataId && itemByDataId !== overlay) {
                const innerContent = itemByDataId.firstElementChild;
                if (innerContent) {
                  const htmlElement = innerContent as HTMLElement;
                  const actualHeight = Math.max(
                    htmlElement.scrollHeight || 0,
                    htmlElement.offsetHeight || 0,
                    htmlElement.getBoundingClientRect().height || 0,
                    80,
                  );

                  if (
                    actualHeight > 20 &&
                    Math.abs(actualHeight - (pos.autoHeight || 80)) > 2
                  ) {
                    // Defer to avoid circular dependency
                    setTimeout(() => {
                      itemData.position.autoHeight = Math.round(actualHeight);
                    }, 0);

                    if (!pos.customHeight) {
                      overlay.style.height = `${actualHeight}px`;
                    }

                    onItemDrag?.(itemData);
                  }
                }
              }
            }
          }
        }, 500); // Give more time for content to render
      }
    };

    // Schedule measurement after content renders for both embedded and isolated
    if (pos.format === 'embedded' || pos.format === 'isolated') {
      // Initial measurement immediately after creation
      setTimeout(measureContentHeight, 100);
      // Secondary measurement after content likely rendered
      setTimeout(measureContentHeight, 500);
      // Also measure periodically to catch async content changes
      const measureInterval = setInterval(measureContentHeight, 2000);
      this.overlayMeasureIntervals.set(overlay, measureInterval);
      overlay.dataset.measureInterval = measureInterval.toString();
    }

    // Setup hover effects
    overlay.addEventListener('mouseenter', () => {
      if (
        !overlay.classList.contains('dragging') &&
        !overlay.classList.contains('resizing')
      ) {
        overlay.classList.add('hovered');
        frame.style.opacity = '1';
        header.style.opacity = '1';
        resizeRight.style.opacity = '1';
        resizeBottom.style.opacity = '1';
        resizeCorner.style.opacity = '1';
        // Do NOT raise whole overlay; only header/handles remain clickable
        overlay.style.zIndex = (pos.layer || 1).toString();

        // Show auto button if embedded or isolated with custom height
        if (
          (pos.format === 'embedded' || pos.format === 'isolated') &&
          pos.customHeight != null
        ) {
          autoButton.style.display = 'block';
          autoButton.style.opacity = '1';
        }

        // Show height indicator for embedded and isolated formats
        if (pos.format === 'embedded' || pos.format === 'isolated') {
          heightIndicator.style.display = 'block';
          // Re-measure on hover to ensure we have latest height
          measureContentHeight();

          if (pos.customHeight) {
            heightIndicator.textContent = `H: ${pos.customHeight}px (auto: ${
              pos.autoHeight || 80
            }px)`;
            heightIndicator.style.background = 'rgba(239, 68, 68, 0.9)'; // Red for custom
          } else {
            heightIndicator.textContent = `H: ${pos.autoHeight || 80}px (auto)`;
            heightIndicator.style.background = 'rgba(16, 185, 129, 0.9)'; // Green for auto
          }
        }
      }
    });

    overlay.addEventListener('mouseleave', () => {
      if (
        !overlay.classList.contains('dragging') &&
        !overlay.classList.contains('resizing')
      ) {
        overlay.classList.remove('hovered');

        // ¹⁵⁹ Don't hide controls if this item is selected
        const isSelected = selectedItemId === itemData.id;
        if (!isSelected) {
          frame.style.opacity = '0';
          header.style.opacity = '0';
          resizeRight.style.opacity = '0';
          resizeBottom.style.opacity = '0';
          resizeCorner.style.opacity = '0';
          autoButton.style.opacity = '0';
          heightIndicator.style.display = 'none';
          setTimeout(() => {
            if (autoButton.style.opacity === '0') {
              autoButton.style.display = 'none';
            }
          }, 150);
          overlay.style.zIndex = (pos.layer || 1).toString();
        }
      }
    });

    // Setup drag behavior
    let isDraggingItem = false;
    let dragStart = { x: 0, y: 0 };
    let initialPos = { x: pos.x || 0, y: pos.y || 0 };

    header.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      event.preventDefault();

      isDraggingItem = true;
      dragStart = { x: event.clientX, y: event.clientY };
      initialPos = { x: pos.x || 0, y: pos.y || 0 };

      // While dragging, the overlay must capture events reliably
      overlay.style.pointerEvents = 'auto';

      // Visual feedback
      overlay.classList.add('dragging');
      overlay.style.zIndex = '20';
      frame.style.opacity = '1';
      frame.style.background = 'rgba(59, 130, 246, 0.2)';
      frame.style.borderColor = '#2563eb';
      frame.style.boxShadow = '0 8px 24px rgba(59, 130, 246, 0.3)';
      header.style.opacity = '1';
      header.style.background = '#2563eb';
    });

    const handleItemMouseMove = (event: MouseEvent) => {
      if (!isDraggingItem) return;

      const deltaX = event.clientX - dragStart.x;
      const deltaY = event.clientY - dragStart.y;

      // Adjust for current zoom level
      const scale = this.currentTransform.k;
      const newX = initialPos.x + deltaX / scale;
      const newY = initialPos.y + deltaY / scale;

      // Update visual position only - don't update card data during drag
      overlay.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;

      // Store the new position for when drag ends
      (overlay as any)._dragPosition = { x: newX, y: newY };

      onItemDrag?.(itemData);
    };

    const handleItemMouseUp = () => {
      if (!isDraggingItem) return;

      isDraggingItem = false;

      // Reset pointer pass-through now that drag has ended
      overlay.style.pointerEvents = 'none';

      // Reset visual state
      overlay.classList.remove('dragging');
      overlay.style.zIndex = (pos.layer || 1).toString();
      frame.style.background = 'rgba(59, 130, 246, 0.05)';
      frame.style.borderColor = '#3b82f6';
      frame.style.boxShadow = 'none';
      header.style.background = '#3b82f6';

      // Update card data with final position - this will trigger save
      const finalPosition = (overlay as any)._dragPosition;
      if (finalPosition) {
        itemData.position.x = finalPosition.x;
        itemData.position.y = finalPosition.y;
        // Clear the temporary position
        delete (overlay as any)._dragPosition;
      }

      // Persist position
      onItemDrag?.(itemData, true);
    };

    // Setup resize behavior
    let isResizing = false;
    let resizeType = '';
    let resizeStart = { x: 0, y: 0, width: 0, height: 0 };

    const startResize = (event: MouseEvent, type: string) => {
      event.stopPropagation();
      event.preventDefault();

      isResizing = true;
      resizeType = type;

      // While resizing, the overlay must capture events reliably
      overlay.style.pointerEvents = 'auto';

      // Get current height from the actual overlay element for accurate measurement
      const currentHeight = overlay.offsetHeight;

      resizeStart = {
        x: event.clientX,
        y: event.clientY,
        width: pos.width || 120,
        height: currentHeight,
      };

      overlay.classList.add('resizing');
      overlay.style.zIndex = '20';
      frame.style.opacity = '1';
      frame.style.borderColor = '#2563eb';
    };

    resizeRight.addEventListener('mousedown', (e) => startResize(e, 'right'));
    resizeBottom.addEventListener('mousedown', (e) => startResize(e, 'bottom'));
    resizeCorner.addEventListener('mousedown', (e) => startResize(e, 'corner'));

    const handleResizeMove = (event: MouseEvent) => {
      if (!isResizing) return;

      const deltaX = event.clientX - resizeStart.x;
      const deltaY = event.clientY - resizeStart.y;
      const scale = this.currentTransform.k;

      let newWidth = resizeStart.width;
      let newHeight = resizeStart.height;

      if (resizeType === 'right' || resizeType === 'corner') {
        newWidth = Math.max(120, resizeStart.width + deltaX / scale);
      }

      if (resizeType === 'bottom' || resizeType === 'corner') {
        newHeight = Math.max(80, resizeStart.height + deltaY / scale);
      }

      // Update visual size
      overlay.style.width = `${newWidth}px`;
      overlay.style.height = `${newHeight}px`;

      // Update itemData - defer to avoid circular dependency
      setTimeout(() => {
        itemData.position.width = newWidth;
        if (pos.format === 'embedded' || pos.format === 'isolated') {
          itemData.position.customHeight = newHeight;
        } else {
          itemData.position.autoHeight = newHeight;
        }
      }, 0);

      onItemDrag?.(itemData);
    };

    const handleResizeUp = () => {
      if (!isResizing) return;

      isResizing = false;
      resizeType = '';

      // Restore pass-through after resize
      overlay.style.pointerEvents = 'none';

      overlay.classList.remove('resizing');
      overlay.style.zIndex = (pos.layer || 1).toString();
      frame.style.borderColor = '#3b82f6';

      // Persist size
      onItemDrag?.(itemData, true);
    };

    // Auto button click handler
    autoButton.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();

      // Remove custom height to return to auto - defer to avoid circular dependency
      setTimeout(() => {
        itemData.position.customHeight = 0;
      }, 0);

      // Update visual height based on autoHeight
      const autoHeight = itemData.position.autoHeight || 80;
      overlay.style.height = `${autoHeight}px`;

      // Hide the button
      autoButton.style.opacity = '0';
      setTimeout(() => {
        autoButton.style.display = 'none';
      }, 150);

      // Persist change
      onItemDrag?.(itemData, true);
    });

    // Format toggle click handler
    formatToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();

      // Toggle format between fitted, embedded, and isolated
      let newFormat;
      if (pos.format === 'fitted') {
        newFormat = 'embedded';
      } else if (pos.format === 'embedded') {
        newFormat = 'isolated';
      } else {
        newFormat = 'fitted';
      }
      // Defer to avoid circular dependency
      setTimeout(() => {
        itemData.position.format = newFormat;
      }, 0);

      // Update button text and tooltip
      if (newFormat === 'fitted') {
        formatToggle.textContent = 'FIT';
        formatToggle.title = 'Switch to Embedded';
      } else if (newFormat === 'embedded') {
        formatToggle.textContent = 'EMB';
        formatToggle.title = 'Switch to Isolated';
      } else {
        formatToggle.textContent = 'ISO';
        formatToggle.title = 'Switch to Fitted';
      }

      // Update height based on new format
      let newHeight;
      if (newFormat === 'embedded' || newFormat === 'isolated') {
        newHeight = Math.max(pos.customHeight || pos.autoHeight || 80, 80);
      } else {
        newHeight = Math.max(pos.autoHeight || 80, 80);
      }
      overlay.style.height = `${newHeight}px`;

      // Persist change
      onItemDrag?.(itemData, true);
    });

    // Format toggle hover effects
    formatToggle.addEventListener('mouseenter', () => {
      formatToggle.style.background = 'rgba(255, 255, 255, 0.3)';
      formatToggle.style.borderColor = 'rgba(255, 255, 255, 0.5)';
    });

    formatToggle.addEventListener('mouseleave', () => {
      formatToggle.style.background = 'rgba(255, 255, 255, 0.2)';
      formatToggle.style.borderColor = 'rgba(255, 255, 255, 0.3)';
    });

    autoButton.addEventListener('mouseenter', () => {
      autoButton.style.background = '#059669';
    });

    autoButton.addEventListener('mouseleave', () => {
      autoButton.style.background = '#10b981';
    });

    // ¹⁵¹ Select button click handler
    selectButton.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();

      if (onItemSelect) {
        // ¹⁵⁵ Toggle selection instead of always selecting
        const isCurrentlySelected = selectedItemId === itemData.id;
        if (isCurrentlySelected) {
          onItemSelect(null); // Deselect
        } else {
          onItemSelect(itemData.id); // Select this item

          // ¹⁶³ Immediately show controls for newly selected item to prevent flicker
          frame.style.opacity = '1';
          header.style.opacity = '1';
          overlay.classList.add('selected');
        }
      }
    });

    // ¹⁶⁸ Open button for external cards to view in card stack
    const openButton = document.createElement('button');
    openButton.className = 'open-button';
    openButton.style.cssText = `
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        color: white;
        padding: 2px 6px;
        font-size: 0.625rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
        margin-right: 4px;
        height: auto;
        display: none;
      `;
    openButton.innerHTML = `
        <div style="display: flex; align-items: center; gap: 3px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15,3 21,3 21,9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
          <span>OPEN</span>
        </div>
      `;
    openButton.title = 'Open external card in stack';

    // ¹⁶⁹ Always show open button for ExternalCard when there is a linked card,
    // regardless of current format (isolated/embedded/fitted)
    if (itemData.type === 'ExternalCard') {
      if (itemData.item?.externalCard) {
        openButton.style.display = 'block';
        header.insertBefore(openButton, selectButton);
      } else {
        // No linked card yet - keep the space for consistent toolbar layout but disabled
        openButton.style.display = 'none';
      }
    }

    // ¹⁷⁰ Open button click handler
    openButton.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();

      // Get the linked card ID and open it in the stack
      const linkedCard = itemData.item?.externalCard;
      const linkedId =
        typeof linkedCard?.id === 'string' ? linkedCard.id : null;

      if (linkedId && typeof this.args?.named?.onOpenCard === 'function') {
        console.log('Opening external card in stack:', linkedId);
        this.args?.named?.onOpenCard?.(linkedId);
      } else {
        console.warn(
          'Open button clicked but no linked card ID or onOpenCard action not available',
          {
            hasLinkedCard: !!linkedCard,
            linkedType: typeof linkedCard,
            linkedIdType: typeof linkedCard?.id,
            hasOnOpenCard: typeof this.args?.named?.onOpenCard === 'function',
          },
        );
      }
    });

    // ¹⁷¹ Open button hover effects
    openButton.addEventListener('mouseenter', () => {
      openButton.style.background = 'rgba(34, 197, 94, 0.9)';
      openButton.style.borderColor = '#22c55e';
      openButton.style.color = 'white';
      openButton.style.transform = 'scale(1.03)';
      openButton.style.boxShadow =
        '0 0 8px rgba(34, 197, 94, 0.5), 0 4px 8px rgba(0, 0, 0, 0.15)';
    });

    openButton.addEventListener('mouseleave', () => {
      openButton.style.background = 'rgba(255, 255, 255, 0.2)';
      openButton.style.borderColor = 'rgba(255, 255, 255, 0.3)';
      openButton.style.color = 'white';
      openButton.style.transform = 'scale(1)';
      openButton.style.boxShadow = 'none';
    });

    // ¹⁶¹ Enhanced hover effects with clear state transitions
    selectButton.addEventListener('mouseenter', () => {
      if (selectedItemId === itemData.id) {
        // Selected state hover
        selectButton.style.background =
          'linear-gradient(135deg, #d97706, #b45309)';
        selectButton.style.transform = 'scale(1.08)';
        selectButton.style.boxShadow =
          '0 0 16px rgba(245, 158, 11, 0.8), 0 4px 12px rgba(0, 0, 0, 0.3)';
      } else {
        // Unselected state hover
        selectButton.style.background =
          'linear-gradient(135deg, #3b82f6, #2563eb)';
        selectButton.style.borderColor = '#2563eb';
        selectButton.style.color = 'white';
        selectButton.style.transform = 'scale(1.03)';
        selectButton.style.boxShadow =
          '0 0 8px rgba(59, 130, 246, 0.5), 0 4px 8px rgba(0, 0, 0, 0.15)';
      }
    });

    selectButton.addEventListener('mouseleave', () => {
      if (selectedItemId === itemData.id) {
        // Return to selected state
        selectButton.style.background =
          'linear-gradient(135deg, #f59e0b, #d97706)';
        selectButton.style.transform = 'scale(1.05)';
        selectButton.style.boxShadow =
          '0 0 12px rgba(245, 158, 11, 0.6), 0 2px 8px rgba(0, 0, 0, 0.2)';
      } else {
        // Return to unselected state
        selectButton.style.background = 'rgba(255, 255, 255, 0.95)';
        selectButton.style.borderColor = '#3b82f6';
        selectButton.style.color = '#3b82f6';
        selectButton.style.transform = 'scale(1)';
        selectButton.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
      }
    });

    document.addEventListener('mousemove', handleItemMouseMove);
    document.addEventListener('mouseup', handleItemMouseUp);
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeUp);

    return overlay;
  }

  modify(element: HTMLElement, positional: [], named: LayoutCanvasNamedArgs) {
    this.element = element;
    this.args = { positional, named };
    this.setupCanvas(element);
  }

  willDestroy() {
    // ¹² Cleanup event listeners and measurement intervals
    if (this.element) {
      this.element.removeEventListener('wheel', this.handleWheel);
      this.element.removeEventListener('mousedown', this.handleMouseDown);
    }
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);

    // Clear all measurement intervals
    this.teardownNodes();
  }
}
