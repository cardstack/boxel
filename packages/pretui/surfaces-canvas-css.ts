// surfaces-canvas-css.ts — generated from surfaces/canvas/styles/canvas.css
// (comments stripped). The canvas package needs this stylesheet globally;
// a <link> to the realm CSS 401s (private realm, header auth) and a
// side-effect CSS import is fetched as JS by the realm loader, so the
// text is embedded and injected into document.head by the probe card.
export const CANVAS_CSS = `.boxel-canvas {
  direction: ltr;

  --xy-edge-stroke-default: #b1b1b7;
  --xy-edge-stroke-width-default: 1;
  --xy-edge-stroke-selected-default: #555;

  --xy-connectionline-stroke-default: #b1b1b7;
  --xy-connectionline-stroke-width-default: 1;

  --xy-attribution-background-color-default: rgba(255, 255, 255, 0.5);

  --xy-minimap-background-color-default: #fff;
  --xy-minimap-mask-background-color-default: rgba(240, 240, 240, 0.6);
  --xy-minimap-mask-stroke-color-default: transparent;
  --xy-minimap-mask-stroke-width-default: 1;
  --xy-minimap-node-background-color-default: #e2e2e2;
  --xy-minimap-node-stroke-color-default: transparent;
  --xy-minimap-node-stroke-width-default: 2;

  --xy-background-color-default: transparent;
  --xy-background-pattern-dots-color-default: #91919a;
  --xy-background-pattern-lines-color-default: #eee;
  --xy-background-pattern-cross-color-default: #e2e2e2;
}

.boxel-canvas.dark {
  --xy-edge-stroke-default: #3e3e3e;
  --xy-edge-stroke-width-default: 1;
  --xy-edge-stroke-selected-default: #727272;

  --xy-connectionline-stroke-default: #b1b1b7;
  --xy-connectionline-stroke-width-default: 1;

  --xy-attribution-background-color-default: rgba(150, 150, 150, 0.25);

  --xy-minimap-background-color-default: #141414;
  --xy-minimap-mask-background-color-default: rgba(60, 60, 60, 0.6);
  --xy-minimap-mask-stroke-color-default: transparent;
  --xy-minimap-mask-stroke-width-default: 1;
  --xy-minimap-node-background-color-default: #2b2b2b;
  --xy-minimap-node-stroke-color-default: transparent;
  --xy-minimap-node-stroke-width-default: 2;

  --xy-background-color-default: #141414;
  --xy-background-pattern-dots-color-default: #777;
  --xy-background-pattern-lines-color-default: #777;
  --xy-background-pattern-cross-color-default: #777;
}

.boxel-canvas {
  background-color: var(--xy-background-color, var(--xy-background-color-default));
}

.boxel-canvas__background {
  background-color: var(--xy-background-color-props, var(--xy-background-color, var(--xy-background-color-default)));
}

.boxel-canvas__container {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
}

.boxel-canvas__pane {
  z-index: 1;

  &.draggable {
    cursor: grab;
  }

  &.dragging {
    cursor: grabbing;
  }

  &.selection {
    cursor: pointer;
  }
}

.boxel-canvas__viewport {
  transform-origin: 0 0;
  z-index: 2;
  pointer-events: none;
}

.boxel-canvas__renderer {
  z-index: 4;
}

.boxel-canvas__selection {
  z-index: 6;
}

.boxel-canvas__nodesselection-rect:focus,
.boxel-canvas__nodesselection-rect:focus-visible {
  outline: none;
}

.boxel-canvas__edge-path {
  stroke: var(--xy-edge-stroke, var(--xy-edge-stroke-default));
  stroke-width: var(--xy-edge-stroke-width, var(--xy-edge-stroke-width-default));
  fill: none;
}

.boxel-canvas__connection-path {
  stroke: var(--xy-connectionline-stroke, var(--xy-connectionline-stroke-default));
  stroke-width: var(--xy-connectionline-stroke-width, var(--xy-connectionline-stroke-width-default));
  fill: none;
}

.boxel-canvas .boxel-canvas__edges {
  position: absolute;
  /* A zero-area box: browsers skip painting an SVG whose used size is 0,
     even with overflow visible, so every edge was silently invisible.
     1px of used size turns painting back on; overflow shows the rest. */
  width: 1px;
  height: 1px;

  svg {
    overflow: visible;
    position: absolute;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
}

.boxel-canvas__edge {
  pointer-events: visibleStroke;

  &.selectable {
    cursor: pointer;
  }

  &.animated path {
    stroke-dasharray: 5;
    animation: dashdraw 0.5s linear infinite;
  }

  &.animated path.boxel-canvas__edge-interaction {
    stroke-dasharray: none;
    animation: none;
  }

  &.inactive {
    pointer-events: none;
  }

  &.selected,
  &:focus,
  &:focus-visible {
    outline: none;
  }

  &.selected .boxel-canvas__edge-path,
  &.selectable:focus .boxel-canvas__edge-path,
  &.selectable:focus-visible .boxel-canvas__edge-path {
    stroke: var(--xy-edge-stroke-selected, var(--xy-edge-stroke-selected-default));
  }

  &-textwrapper {
    pointer-events: all;
  }

  .boxel-canvas__edge-text {
    pointer-events: none;
    user-select: none;
  }
}

.boxel-canvas__arrowhead polyline {
  stroke: var(--xy-edge-stroke, var(--xy-edge-stroke-default));
}

.boxel-canvas__arrowhead polyline.arrowclosed {
  fill: var(--xy-edge-stroke, var(--xy-edge-stroke-default));
}

.boxel-canvas__connection {
  pointer-events: none;

  .animated {
    stroke-dasharray: 5;
    animation: dashdraw 0.5s linear infinite;
  }
}

svg.boxel-canvas__connectionline {
  z-index: 1001;
  overflow: visible;
  position: absolute;
}

.boxel-canvas__nodes {
  pointer-events: none;
  transform-origin: 0 0;
}

.boxel-canvas__node {
  position: absolute;
  user-select: none;
  pointer-events: all;
  transform-origin: 0 0;
  box-sizing: border-box;
  cursor: default;

  &.selectable {
    cursor: pointer;
  }

  &.draggable {
    cursor: grab;
    pointer-events: all;

    &.dragging {
      cursor: grabbing;
    }
  }
}

.boxel-canvas__nodesselection {
  z-index: 3;
  transform-origin: left top;
  pointer-events: none;

  &-rect {
    position: absolute;
    pointer-events: all;
    cursor: grab;
  }
}

.boxel-canvas__handle {
  position: absolute;
  pointer-events: none;
  min-width: 5px;
  min-height: 5px;

  &.connectingfrom {
    pointer-events: all;
  }

  &.connectionindicator {
    pointer-events: all;
    cursor: crosshair;
  }

  &-bottom {
    top: auto;
    left: 50%;
    bottom: 0;
    transform: translate(-50%, 50%);
  }

  &-top {
    top: 0;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  &-left {
    top: 50%;
    left: 0;
    transform: translate(-50%, -50%);
  }

  &-right {
    top: 50%;
    right: 0;
    transform: translate(50%, -50%);
  }
}

.boxel-canvas__edgeupdater {
  cursor: move;
  pointer-events: all;
}

.boxel-canvas__pane.selection .boxel-canvas__panel {
  pointer-events: none;
}

.boxel-canvas__panel {
  position: absolute;
  z-index: 5;
  margin: 15px;

  &.top {
    top: 0;
  }

  &.bottom {
    bottom: 0;
  }

  &.top,
  &.bottom {
    &.center {
      left: 50%;
      transform: translateX(-15px) translateX(-50%);
    }
  }

  &.left {
    left: 0;
  }

  &.right {
    right: 0;
  }

  &.left,
  &.right {
    &.center {
      top: 50%;
      transform: translateY(-15px) translateY(-50%);
    }
  }
}

.boxel-canvas__attribution {
  font-size: 10px;
  background: var(--xy-attribution-background-color, var(--xy-attribution-background-color-default));
  padding: 2px 3px;
  margin: 0;

  a {
    text-decoration: none;
    color: #999;
  }
}

@keyframes dashdraw {
  from {
    stroke-dashoffset: 10;
  }
}

.boxel-canvas__edgelabel-renderer {
  position: absolute;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
  left: 0;
  top: 0;
}

.boxel-canvas__viewport-portal {
  position: absolute;
  width: 100%;
  height: 100%;
  left: 0;
  top: 0;
  user-select: none;
}

.boxel-canvas__minimap {
  background: var(
    --xy-minimap-background-color-props,
    var(--xy-minimap-background-color, var(--xy-minimap-background-color-default))
  );

  &-svg {
    display: block;
  }

  &-mask {
    fill: var(
      --xy-minimap-mask-background-color-props,
      var(--xy-minimap-mask-background-color, var(--xy-minimap-mask-background-color-default))
    );
    stroke: var(
      --xy-minimap-mask-stroke-color-props,
      var(--xy-minimap-mask-stroke-color, var(--xy-minimap-mask-stroke-color-default))
    );
    stroke-width: var(
      --xy-minimap-mask-stroke-width-props,
      var(--xy-minimap-mask-stroke-width, var(--xy-minimap-mask-stroke-width-default))
    );
  }

  &-node {
    fill: var(
      --xy-minimap-node-background-color-props,
      var(--xy-minimap-node-background-color, var(--xy-minimap-node-background-color-default))
    );
    stroke: var(
      --xy-minimap-node-stroke-color-props,
      var(--xy-minimap-node-stroke-color, var(--xy-minimap-node-stroke-color-default))
    );
    stroke-width: var(
      --xy-minimap-node-stroke-width-props,
      var(--xy-minimap-node-stroke-width, var(--xy-minimap-node-stroke-width-default))
    );
  }
}

.boxel-canvas__background {
  pointer-events: none;
  z-index: -1;
}

.boxel-canvas__background-pattern {
  &.dots {
    fill: var(
      --xy-background-pattern-color-props,
      var(--xy-background-pattern-color, var(--xy-background-pattern-dots-color-default))
    );
  }

  &.lines {
    stroke: var(
      --xy-background-pattern-color-props,
      var(--xy-background-pattern-color, var(--xy-background-pattern-lines-color-default))
    );
  }

  &.cross {
    stroke: var(
      --xy-background-pattern-color-props,
      var(--xy-background-pattern-color, var(--xy-background-pattern-cross-color-default))
    );
  }
}

.boxel-canvas__controls {
  display: flex;
  flex-direction: column;

  &.horizontal {
    flex-direction: row;
  }

  &-button {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 26px;
    width: 26px;
    padding: 4px;

    svg {
      width: 100%;
      max-width: 12px;
      max-height: 12px;
      fill: currentColor;
    }
  }
}

.boxel-canvas {
  --xy-node-border-default: 1px solid #bbb;
  --xy-node-border-selected-default: 1px solid #555;

  --xy-handle-background-color-default: #333;

  --xy-selection-background-color-default: rgba(150, 150, 180, 0.1);
  --xy-selection-border-default: 1px dotted rgba(155, 155, 155, 0.8);
}

.boxel-canvas.dark {
  --xy-node-color-default: #f8f8f8;
}

.boxel-canvas__handle {
  background-color: var(--xy-handle-background-color, var(--xy-handle-background-color-default));
}

.boxel-canvas__node-input,
.boxel-canvas__node-default,
.boxel-canvas__node-output,
.boxel-canvas__node-group {
  border: var(--xy-node-border, var(--xy-node-border-default));
  color: var(--xy-node-color, var(--xy-node-color-default));

  &.selected,
  &:focus,
  &:focus-visible {
    outline: none;
    border: var(--xy-node-border-selected, var(--xy-node-border-selected-default));
  }
}

.boxel-canvas__nodesselection-rect,
.boxel-canvas__selection {
  background: var(--xy-selection-background-color, var(--xy-selection-background-color-default));
  border: var(--xy-selection-border, var(--xy-selection-border-default));
}

.boxel-canvas {
  --xy-resize-background-color-default: #3367d9;
}

.boxel-canvas__resize-control {
  position: absolute;
}

.boxel-canvas__resize-control.left,
.boxel-canvas__resize-control.right {
  cursor: ew-resize;
}

.boxel-canvas__resize-control.top,
.boxel-canvas__resize-control.bottom {
  cursor: ns-resize;
}

.boxel-canvas__resize-control.top.left,
.boxel-canvas__resize-control.bottom.right {
  cursor: nwse-resize;
}

.boxel-canvas__resize-control.bottom.left,
.boxel-canvas__resize-control.top.right {
  cursor: nesw-resize;
}

.boxel-canvas__resize-control.handle {
  width: 5px;
  height: 5px;
  border: 1px solid #fff;
  border-radius: 1px;
  background-color: var(--xy-resize-background-color, var(--xy-resize-background-color-default));
  translate: -50% -50%;
}

.boxel-canvas__resize-control.handle.left {
  left: 0;
  top: 50%;
}
.boxel-canvas__resize-control.handle.right {
  left: 100%;
  top: 50%;
}
.boxel-canvas__resize-control.handle.top {
  left: 50%;
  top: 0;
}
.boxel-canvas__resize-control.handle.bottom {
  left: 50%;
  top: 100%;
}
.boxel-canvas__resize-control.handle.top.left {
  left: 0;
}
.boxel-canvas__resize-control.handle.bottom.left {
  left: 0;
}
.boxel-canvas__resize-control.handle.top.right {
  left: 100%;
}
.boxel-canvas__resize-control.handle.bottom.right {
  left: 100%;
}

.boxel-canvas__resize-control.line {
  border-color: var(--xy-resize-background-color, var(--xy-resize-background-color-default));
  border-width: 0;
  border-style: solid;
}

.boxel-canvas__resize-control.line.left,
.boxel-canvas__resize-control.line.right {
  width: 1px;
  transform: translate(-50%, 0);
  top: 0;
  height: 100%;
}

.boxel-canvas__resize-control.line.left {
  left: 0;
  border-left-width: 1px;
}

.boxel-canvas__resize-control.line.right {
  left: 100%;
  border-right-width: 1px;
}

.boxel-canvas__resize-control.line.top,
.boxel-canvas__resize-control.line.bottom {
  height: 1px;
  transform: translate(0, -50%);
  left: 0;
  width: 100%;
}

.boxel-canvas__resize-control.line.top {
  top: 0;
  border-top-width: 1px;
}

.boxel-canvas__resize-control.line.bottom {
  border-bottom-width: 1px;
  top: 100%;
}

.boxel-canvas {
  --xy-node-color-default: inherit;
  --xy-node-border-default: 1px solid #1a192b;
  --xy-node-background-color-default: #fff;
  --xy-node-group-background-color-default: rgba(240, 240, 240, 0.25);
  --xy-node-boxshadow-hover-default: 0 1px 4px 1px rgba(0, 0, 0, 0.08);
  --xy-node-boxshadow-selected-default: 0 0 0 0.5px #1a192b;
  --xy-node-border-radius-default: 3px;

  --xy-handle-background-color-default: #1a192b;
  --xy-handle-border-color-default: #fff;

  --xy-selection-background-color-default: rgba(0, 89, 220, 0.08);
  --xy-selection-border-default: 1px dotted rgba(0, 89, 220, 0.8);

  --xy-controls-button-background-color-default: #fefefe;
  --xy-controls-button-background-color-hover-default: #f4f4f4;
  --xy-controls-button-color-default: inherit;
  --xy-controls-button-color-hover-default: inherit;
  --xy-controls-button-border-color-default: #eee;
  --xy-controls-box-shadow-default: 0 0 2px 1px rgba(0, 0, 0, 0.08);

  --xy-edge-label-background-color-default: #ffffff;
  --xy-edge-label-color-default: inherit;
}

.boxel-canvas.dark {
  --xy-node-color-default: #f8f8f8;
  --xy-node-border-default: 1px solid #3c3c3c;
  --xy-node-background-color-default: #1e1e1e;
  --xy-node-group-background-color-default: rgba(240, 240, 240, 0.25);
  --xy-node-boxshadow-hover-default: 0 1px 4px 1px rgba(255, 255, 255, 0.08);
  --xy-node-boxshadow-selected-default: 0 0 0 0.5px #999;

  --xy-handle-background-color-default: #bebebe;
  --xy-handle-border-color-default: #1e1e1e;

  --xy-selection-background-color-default: rgba(200, 200, 220, 0.08);
  --xy-selection-border-default: 1px dotted rgba(200, 200, 220, 0.8);

  --xy-controls-button-background-color-default: #2b2b2b;
  --xy-controls-button-background-color-hover-default: #3e3e3e;
  --xy-controls-button-color-default: #f8f8f8;
  --xy-controls-button-color-hover-default: #fff;
  --xy-controls-button-border-color-default: #5b5b5b;
  --xy-controls-box-shadow-default: 0 0 2px 1px rgba(0, 0, 0, 0.08);

  --xy-edge-label-background-color-default: #141414;
  --xy-edge-label-color-default: #f8f8f8;
}

.boxel-canvas__edge {
  &.updating {
    .boxel-canvas__edge-path {
      stroke: #777;
    }
  }

  &-text {
    font-size: 10px;
  }
}

.boxel-canvas__node.selectable {
  &:focus,
  &:focus-visible {
    outline: none;
  }
}

.boxel-canvas__node-input,
.boxel-canvas__node-default,
.boxel-canvas__node-output,
.boxel-canvas__node-group {
  padding: 10px;
  border-radius: var(--xy-node-border-radius, var(--xy-node-border-radius-default));
  width: 150px;
  font-size: 12px;
  color: var(--xy-node-color, var(--xy-node-color-default));
  text-align: center;
  border: var(--xy-node-border, var(--xy-node-border-default));
  background-color: var(--xy-node-background-color, var(--xy-node-background-color-default));

  &.selectable {
    &:hover {
      box-shadow: var(--xy-node-boxshadow-hover, var(--xy-node-boxshadow-hover-default));
    }

    &.selected,
    &:focus,
    &:focus-visible {
      box-shadow: var(--xy-node-boxshadow-selected, var(--xy-node-boxshadow-selected-default));
    }
  }
}

.boxel-canvas__node-group {
  background-color: var(--xy-node-group-background-color, var(--xy-node-group-background-color-default));
}

.boxel-canvas__nodesselection-rect,
.boxel-canvas__selection {
  background: var(--xy-selection-background-color, var(--xy-selection-background-color-default));
  border: var(--xy-selection-border, var(--xy-selection-border-default));

  &:focus,
  &:focus-visible {
    outline: none;
  }
}

.boxel-canvas__handle {
  width: 6px;
  height: 6px;
  background-color: var(--xy-handle-background-color, var(--xy-handle-background-color-default));
  border: 1px solid var(--xy-handle-border-color, var(--xy-handle-border-color-default));
  border-radius: 100%;
}

.boxel-canvas__controls {
  box-shadow: var(--xy-controls-box-shadow, var(--xy-controls-box-shadow-default));

  &-button {
    border: none;
    background: var(--xy-controls-button-background-color, var(--xy-controls-button-background-color-default));
    border-bottom: 1px solid
      var(
        --xy-controls-button-border-color-props,
        var(--xy-controls-button-border-color, var(--xy-controls-button-border-color-default))
      );
    color: var(
      --xy-controls-button-color-props,
      var(--xy-controls-button-color, var(--xy-controls-button-color-default))
    );
    cursor: pointer;
    user-select: none;

    &:hover {
      background: var(
        --xy-controls-button-background-color-hover-props,
        var(--xy-controls-button-background-color-hover, var(--xy-controls-button-background-color-hover-default))
      );
      color: var(
        --xy-controls-button-color-hover-props,
        var(--xy-controls-button-color-hover, var(--xy-controls-button-color-hover-default))
      );
    }

    &:disabled {
      pointer-events: none;

      svg {
        fill-opacity: 0.4;
      }
    }
  }

  &-button:last-child {
    border-bottom: none;
  }

  &.horizontal &-button {
    border-bottom: none;
    border-right: 1px solid
      var(
        --xy-controls-button-border-color-props,
        var(--xy-controls-button-border-color, var(--xy-controls-button-border-color-default))
      );
  }

  &.horizontal &-button:last-child {
    border-right: none;
  }
}

.boxel-canvas__edge-label {
  text-align: center;
  position: absolute;
}

.boxel-canvas__edge-label.transparent {
  background: transparent;
  padding: 0;
}

.boxel-canvas__viewport {
  transform-origin: 0 0;
  z-index: 2;
  pointer-events: none;
}

.boxel-canvas__viewport.is-transforming {
  will-change: transform;
}

.boxel-canvas__renderer {
  z-index: 4;
}

.boxel-canvas__pane {
  z-index: 1;
}

.boxel-canvas.pan-activation,
.boxel-canvas.pan-activation .boxel-canvas__pane,
.boxel-canvas.pan-activation .boxel-canvas__node,
.boxel-canvas.pan-activation .boxel-canvas__edge,
.boxel-canvas.pan-activation * {
  cursor: grab !important;
}

.boxel-canvas.panning,
.boxel-canvas.panning .boxel-canvas__pane,
.boxel-canvas.panning .boxel-canvas__node,
.boxel-canvas.panning .boxel-canvas__edge,
.boxel-canvas.panning * {
  cursor: grabbing !important;
}

.boxel-canvas__panel {
  position: absolute;
  z-index: 5;
  margin: 15px;
}

.boxel-canvas__panel.top {
  top: 0;
}

.boxel-canvas__panel.bottom {
  bottom: 0;
}

.boxel-canvas__panel.left {
  left: 0;
}

.boxel-canvas__panel.right {
  right: 0;
}

.boxel-canvas__panel.top.center,
.boxel-canvas__panel.bottom.center {
  left: 50%;
  transform: translateX(-15px) translateX(-50%);
}

.boxel-canvas__panel.left.center,
.boxel-canvas__panel.right.center {
  top: 50%;
  transform: translateY(-15px) translateY(-50%);
}

.boxel-canvas__controls {
  display: flex;
  flex-direction: column;
}

.boxel-canvas__controls.horizontal {
  flex-direction: row;
}

.boxel-canvas__controls-button {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 26px;
  width: 26px;
  padding: 4px;
}

.boxel-canvas__controls-button svg {
  width: 100%;
  max-width: 14px;
  max-height: 14px;
  fill: currentColor;
}

.boxel-canvas__edges {
  position: absolute;
}

.boxel-canvas__edge-wrapper {
  overflow: visible;
  position: absolute;
  pointer-events: none;
}

.boxel-canvas__edge-path {
  stroke: var(--xy-edge-stroke, var(--xy-edge-stroke-default));
  stroke-width: var(--xy-edge-stroke-width, var(--xy-edge-stroke-width-default));
  fill: none;
}

.boxel-canvas__edge-interaction {
  stroke: transparent;
  fill: none;
  pointer-events: stroke;
  vector-effect: non-scaling-stroke;
}

.boxel-canvas__edge {
  pointer-events: visibleStroke;
}

.boxel-canvas__edge.selectable {
  cursor: pointer;
}

.boxel-canvas__edge.animated .boxel-canvas__edge-path {
  stroke-dasharray: 5;
  animation: dashdraw 0.5s linear infinite;
}

.boxel-canvas__edge.animated .boxel-canvas__edge-interaction {
  stroke-dasharray: none;
  animation: none;
}

.boxel-canvas__edge-selection {
  stroke: var(--xy-edge-stroke-selected, var(--xy-edge-stroke-selected-default));
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-opacity: 0.12;
  fill: none;
  pointer-events: none;
}

.boxel-canvas__edge.selected .boxel-canvas__edge-path {
  stroke: var(--xy-edge-stroke-selected, var(--xy-edge-stroke-selected-default));
}

.boxel-canvas__edgeupdater {
  cursor: move;
  pointer-events: all;
}

.boxel-canvas__edge-textwrapper {
  pointer-events: all;
  user-select: none;
}

.boxel-canvas__edge.selectable .boxel-canvas__edge-textwrapper {
  cursor: pointer;
}

.boxel-canvas__edge-textbg {
  fill: var(--xy-edge-label-background-color, var(--xy-edge-label-background-color-default, #fff));
  stroke: transparent;
  stroke-width: 1;
}

.boxel-canvas__edge.selectable:hover .boxel-canvas__edge-textbg {
  stroke: var(--xy-edge-stroke-selected, var(--xy-edge-stroke-selected-default));
  stroke-opacity: 0.35;
}

.boxel-canvas__edge-text {
  fill: var(--xy-edge-label-color, var(--xy-edge-label-color-default, inherit));
  font-size: 10px;
  pointer-events: none;
}

.boxel-canvas__edge-toolbar {
  border-radius: 6px;
  box-shadow: 0 1px 4px rgb(15 23 42 / 0.12);
  background: var(--xy-node-background-color, var(--xy-node-background-color-default));
  color: var(--xy-node-color, var(--xy-node-color-default));
  border: 1px solid var(--xy-node-border, var(--xy-node-border-default));
}

.boxel-canvas__viewport-portal {
  position: absolute;
  inset: 0 auto auto 0;
  pointer-events: none;
}

.boxel-canvas__connectionline {
  z-index: 1001;
  overflow: visible;
  position: absolute;
  pointer-events: none;
}

.boxel-canvas__connection-path {
  stroke: var(--xy-connectionline-stroke, var(--xy-connectionline-stroke-default));
  stroke-width: var(--xy-connectionline-stroke-width, var(--xy-connectionline-stroke-width-default));
  fill: none;
}

.boxel-canvas__connection.invalid .boxel-canvas__connection-path {
  stroke: var(--xy-connectionline-invalid-stroke, #ef4444);
}

.boxel-canvas__handle.connectingto.invalid {
  background: var(--xy-connectionline-invalid-stroke, #ef4444);
  border-color: var(--xy-connectionline-invalid-stroke, #ef4444);
}

.boxel-canvas__selection {
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0;
  pointer-events: none;
  z-index: 6;
}

.boxel-canvas__nodes {
  pointer-events: none;
  transform-origin: 0 0;
}

.boxel-canvas__edgelabel-renderer {
  pointer-events: none;
  user-select: none;
  z-index: 3;
}

.boxel-canvas__node {
  position: absolute;
  user-select: none;
  pointer-events: all;
  transform-origin: 0 0;
  box-sizing: border-box;
}

.boxel-canvas__node.dragging {
  will-change: transform;
}

.boxel-canvas__handle {
  position: absolute;
  width: 6px;
  height: 6px;
  min-width: 5px;
  min-height: 5px;
  background-color: var(--xy-handle-background-color, var(--xy-handle-background-color-default, #333));
  border: 1px solid var(--xy-handle-border-color, var(--xy-handle-border-color-default, #fff));
  border-radius: 100%;
  pointer-events: all;
  z-index: 1;
  box-sizing: border-box;
}

.boxel-canvas__handle.connectionindicator {
  cursor: crosshair;
}

.boxel-canvas__handle.connectingto.valid {
  box-shadow:
    0 0 0 5px rgba(37, 99, 235, 0.18),
    0 0 0 1px var(--xy-background-color, #fff);
}

.boxel-canvas__handle-top {
  top: 0;
  left: 50%;
  transform: translate(-50%, -50%);
}

.boxel-canvas__handle-right {
  top: 50%;
  right: 0;
  transform: translate(50%, -50%);
}

.boxel-canvas__handle-bottom {
  bottom: 0;
  left: 50%;
  transform: translate(-50%, 50%);
}

.boxel-canvas__handle-left {
  top: 50%;
  left: 0;
  transform: translate(-50%, -50%);
}

.boxel-canvas__node-toolbar {
  position: absolute;
  z-index: 1000;
  pointer-events: all;
  display: flex;
  gap: 4px;
}

.boxel-canvas__resize-control.handle {
  width: 9px;
  height: 9px;
  pointer-events: all;
}

.boxel-canvas__resize-control.line {
  pointer-events: all;
}

.boxel-canvas__resize-control.line.left,
.boxel-canvas__resize-control.line.right {
  width: 10px;
}

.boxel-canvas__resize-control.line.top,
.boxel-canvas__resize-control.line.bottom {
  height: 10px;
}

.boxel-canvas__minimap {
  background: var(
    --xy-minimap-background-color-props,
    var(--xy-minimap-background-color, var(--xy-minimap-background-color-default, #fff))
  );
}

.boxel-canvas__minimap-svg {
  display: block;
}

.boxel-canvas__minimap-mask {
  fill: var(
    --xy-minimap-mask-background-color-props,
    var(--xy-minimap-mask-background-color, var(--xy-minimap-mask-background-color-default, rgba(240, 240, 240, 0.6)))
  );
  stroke: var(
    --xy-minimap-mask-stroke-color-props,
    var(--xy-minimap-mask-stroke-color, var(--xy-minimap-mask-stroke-color-default, transparent))
  );
  stroke-width: var(
    --xy-minimap-mask-stroke-width-props,
    var(--xy-minimap-mask-stroke-width, var(--xy-minimap-mask-stroke-width-default, 1))
  );
}

.boxel-canvas__minimap-node {
  fill: var(
    --xy-minimap-node-background-color-props,
    var(--xy-minimap-node-background-color, var(--xy-minimap-node-background-color-default, #e2e2e2))
  );
  stroke: var(
    --xy-minimap-node-stroke-color-props,
    var(--xy-minimap-node-stroke-color, var(--xy-minimap-node-stroke-color-default, transparent))
  );
  stroke-width: var(
    --xy-minimap-node-stroke-width-props,
    var(--xy-minimap-node-stroke-width, var(--xy-minimap-node-stroke-width-default, 2))
  );
}

.boxel-canvas__node-DragHandleNode .container {
  width: 100px;
  height: 50px;
  background: red;
  display: flex;
  align-items: center;
  justify-content: center;
}

.boxel-canvas__node-DragHandleNode .drag-handle {
  display: inline-block;
  width: 25px;
  height: 25px;
  background-color: green;
}

.boxel-canvas__container {
  user-select: none;
}

.boxel-canvas {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  z-index: 0;
}

.boxel-canvas__edge-label {
  text-align: center;
  position: absolute;
  padding: 2px;
  font-size: 10px;
  color: var(--xy-edge-label-color, var(--xy-edge-label-color-default));
  background: var(--xy-edge-label-background-color, var(--xy-edge-label-background-color-default));
}

.boxel-canvas__edge-label.transparent {
  background: transparent;
  padding: 0;
}

.boxel-canvas__viewport {
  transform-origin: 0 0;
  z-index: 2;
  pointer-events: none;
}

.boxel-canvas__viewport.is-transforming {
  will-change: transform;
}

.boxel-canvas__renderer {
  z-index: 4;
}

.boxel-canvas__pane {
  z-index: 1;
}

.boxel-canvas.pan-activation,
.boxel-canvas.pan-activation .boxel-canvas__pane,
.boxel-canvas.pan-activation .boxel-canvas__node,
.boxel-canvas.pan-activation .boxel-canvas__edge,
.boxel-canvas.pan-activation * {
  cursor: grab !important;
}

.boxel-canvas.panning,
.boxel-canvas.panning .boxel-canvas__pane,
.boxel-canvas.panning .boxel-canvas__node,
.boxel-canvas.panning .boxel-canvas__edge,
.boxel-canvas.panning * {
  cursor: grabbing !important;
}

.boxel-canvas__panel {
  position: absolute;
  z-index: 5;
  margin: 15px;
}

.boxel-canvas__panel.top {
  top: 0;
}

.boxel-canvas__panel.bottom {
  bottom: 0;
}

.boxel-canvas__panel.left {
  left: 0;
}

.boxel-canvas__panel.right {
  right: 0;
}

.boxel-canvas__panel.top.center,
.boxel-canvas__panel.bottom.center {
  left: 50%;
  transform: translateX(-15px) translateX(-50%);
}

.boxel-canvas__panel.left.center,
.boxel-canvas__panel.right.center {
  top: 50%;
  transform: translateY(-15px) translateY(-50%);
}

.boxel-canvas__controls {
  display: flex;
  flex-direction: column;
  box-shadow: var(--xy-controls-box-shadow, var(--xy-controls-box-shadow-default));
}

.boxel-canvas__controls.horizontal {
  flex-direction: row;
}

.boxel-canvas__controls-button {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 26px;
  width: 26px;
  padding: 4px;
  border: none;
  border-bottom: 1px solid
    var(
      --xy-controls-button-border-color-props,
      var(--xy-controls-button-border-color, var(--xy-controls-button-border-color-default))
    );
  background: var(--xy-controls-button-background-color, var(--xy-controls-button-background-color-default));
  color: var(
    --xy-controls-button-color-props,
    var(--xy-controls-button-color, var(--xy-controls-button-color-default))
  );
  cursor: pointer;
  user-select: none;
}

.boxel-canvas__controls-button:hover {
  background: var(
    --xy-controls-button-background-color-hover-props,
    var(--xy-controls-button-background-color-hover, var(--xy-controls-button-background-color-hover-default))
  );
  color: var(
    --xy-controls-button-color-hover-props,
    var(--xy-controls-button-color-hover, var(--xy-controls-button-color-hover-default))
  );
}

.boxel-canvas__controls-button:disabled {
  pointer-events: none;
}

.boxel-canvas__controls-button:disabled svg {
  fill-opacity: 0.4;
}

.boxel-canvas__controls-button:last-child {
  border-bottom: none;
}

.boxel-canvas__controls.horizontal .boxel-canvas__controls-button {
  border-right: 1px solid
    var(
      --xy-controls-button-border-color-props,
      var(--xy-controls-button-border-color, var(--xy-controls-button-border-color-default))
    );
  border-bottom: none;
}

.boxel-canvas__controls.horizontal .boxel-canvas__controls-button:last-child {
  border-right: none;
}

.boxel-canvas__controls-button svg {
  width: 100%;
  max-width: 14px;
  max-height: 14px;
  fill: currentColor;
}

.boxel-canvas__controls-interactive.is-locked {
  background: #111827;
  color: #fff;
}

.boxel-canvas__controls-interactive.is-locked:hover {
  background: #111827;
  color: #fff;
}

.boxel-canvas__edges {
  position: absolute;
}

.boxel-canvas__edge-wrapper {
  overflow: visible;
  position: absolute;
  pointer-events: none;
}

.boxel-canvas__edge-path {
  stroke: var(--xy-edge-stroke, var(--xy-edge-stroke-default));
  stroke-width: var(--xy-edge-stroke-width, var(--xy-edge-stroke-width-default));
  fill: none;
}

.boxel-canvas__edge-interaction {
  stroke: transparent;
  fill: none;
  pointer-events: stroke;
  vector-effect: non-scaling-stroke;
}

.boxel-canvas__edge {
  pointer-events: visibleStroke;
}

.boxel-canvas__edge.selectable {
  cursor: pointer;
}

.boxel-canvas__edge.animated .boxel-canvas__edge-path {
  stroke-dasharray: 5;
  animation: dashdraw 0.5s linear infinite;
}

.boxel-canvas__edge.animated .boxel-canvas__edge-interaction {
  stroke-dasharray: none;
  animation: none;
}

.boxel-canvas__edge-selection {
  stroke: var(--xy-edge-stroke-selected, var(--xy-edge-stroke-selected-default));
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-opacity: 0.12;
  fill: none;
  pointer-events: none;
}

.boxel-canvas__edge.selected .boxel-canvas__edge-path {
  stroke: var(--xy-edge-stroke-selected, var(--xy-edge-stroke-selected-default));
}

.boxel-canvas__edgeupdater {
  cursor: move;
  pointer-events: all;
}

.boxel-canvas__edge-textwrapper {
  pointer-events: all;
  user-select: none;
}

.boxel-canvas__edge.selectable .boxel-canvas__edge-textwrapper {
  cursor: pointer;
}

.boxel-canvas__edge-textbg {
  fill: var(--xy-edge-label-background-color, var(--xy-edge-label-background-color-default, #fff));
  stroke: transparent;
  stroke-width: 1;
}

.boxel-canvas__edge.selectable:hover .boxel-canvas__edge-textbg {
  stroke: var(--xy-edge-stroke-selected, var(--xy-edge-stroke-selected-default));
  stroke-opacity: 0.35;
}

.boxel-canvas__edge-text {
  fill: var(--xy-edge-label-color, var(--xy-edge-label-color-default, inherit));
  font-size: 10px;
  pointer-events: none;
}

.boxel-canvas__edge-toolbar {
  border-radius: 6px;
  box-shadow: 0 1px 4px rgb(15 23 42 / 0.12);
  background: var(--xy-node-background-color, var(--xy-node-background-color-default));
  color: var(--xy-node-color, var(--xy-node-color-default));
  border: 1px solid var(--xy-node-border, var(--xy-node-border-default));
}

.boxel-canvas__viewport-portal {
  position: absolute;
  inset: 0 auto auto 0;
  pointer-events: none;
}

.boxel-canvas__connectionline {
  z-index: 1001;
  overflow: visible;
  position: absolute;
  pointer-events: none;
}

.boxel-canvas__connection-path {
  stroke: var(--xy-connectionline-stroke, var(--xy-connectionline-stroke-default));
  stroke-width: var(--xy-connectionline-stroke-width, var(--xy-connectionline-stroke-width-default));
  fill: none;
}

.boxel-canvas__connection.invalid .boxel-canvas__connection-path {
  stroke: var(--xy-connectionline-invalid-stroke, #ef4444);
}

.boxel-canvas__handle.connectingto.invalid {
  background: var(--xy-connectionline-invalid-stroke, #ef4444);
  border-color: var(--xy-connectionline-invalid-stroke, #ef4444);
}

.boxel-canvas__selection {
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0;
  pointer-events: none;
  z-index: 6;
}

.boxel-canvas__nodes {
  pointer-events: none;
  transform-origin: 0 0;
}

.boxel-canvas__edgelabel-renderer {
  pointer-events: none;
  user-select: none;
  z-index: 3;
}

.boxel-canvas__node {
  position: absolute;
  user-select: none;
  pointer-events: all;
  transform-origin: 0 0;
  box-sizing: border-box;
}

.boxel-canvas__node.dragging {
  will-change: transform;
}

.boxel-canvas__handle {
  position: absolute;
  width: 6px;
  height: 6px;
  min-width: 5px;
  min-height: 5px;
  background-color: var(--xy-handle-background-color, var(--xy-handle-background-color-default, #333));
  border: 1px solid var(--xy-handle-border-color, var(--xy-handle-border-color-default, #fff));
  border-radius: 100%;
  pointer-events: all;
  z-index: 1;
  box-sizing: border-box;
}

.boxel-canvas__handle.connectionindicator {
  cursor: crosshair;
}

.boxel-canvas__handle.connectingto.valid {
  box-shadow:
    0 0 0 5px rgba(37, 99, 235, 0.18),
    0 0 0 1px var(--xy-background-color, #fff);
}

.boxel-canvas__handle-top {
  top: 0;
  left: 50%;
  transform: translate(-50%, -50%);
}

.boxel-canvas__handle-right {
  top: 50%;
  right: 0;
  transform: translate(50%, -50%);
}

.boxel-canvas__handle-bottom {
  bottom: 0;
  left: 50%;
  transform: translate(-50%, 50%);
}

.boxel-canvas__handle-left {
  top: 50%;
  left: 0;
  transform: translate(-50%, -50%);
}

.boxel-canvas__node-toolbar {
  position: absolute;
  z-index: 1000;
  pointer-events: all;
  display: flex;
  gap: 4px;
}

.boxel-canvas__resize-control.handle {
  width: 9px;
  height: 9px;
  pointer-events: all;
}

.boxel-canvas__resize-control.line {
  pointer-events: all;
}

.boxel-canvas__resize-control.line.left,
.boxel-canvas__resize-control.line.right {
  width: 10px;
}

.boxel-canvas__resize-control.line.top,
.boxel-canvas__resize-control.line.bottom {
  height: 10px;
}

.boxel-canvas__minimap {
  background: var(
    --xy-minimap-background-color-props,
    var(--xy-minimap-background-color, var(--xy-minimap-background-color-default, #fff))
  );
}

.boxel-canvas__minimap-svg {
  display: block;
}

.boxel-canvas__minimap-mask {
  fill: var(
    --xy-minimap-mask-background-color-props,
    var(--xy-minimap-mask-background-color, var(--xy-minimap-mask-background-color-default, rgba(240, 240, 240, 0.6)))
  );
  stroke: var(
    --xy-minimap-mask-stroke-color-props,
    var(--xy-minimap-mask-stroke-color, var(--xy-minimap-mask-stroke-color-default, transparent))
  );
  stroke-width: var(
    --xy-minimap-mask-stroke-width-props,
    var(--xy-minimap-mask-stroke-width, var(--xy-minimap-mask-stroke-width-default, 1))
  );
}

.boxel-canvas__minimap-node {
  fill: var(
    --xy-minimap-node-background-color-props,
    var(--xy-minimap-node-background-color, var(--xy-minimap-node-background-color-default, #e2e2e2))
  );
  stroke: var(
    --xy-minimap-node-stroke-color-props,
    var(--xy-minimap-node-stroke-color, var(--xy-minimap-node-stroke-color-default, transparent))
  );
  stroke-width: var(
    --xy-minimap-node-stroke-width-props,
    var(--xy-minimap-node-stroke-width, var(--xy-minimap-node-stroke-width-default, 2))
  );
}

.boxel-canvas__node-DragHandleNode .container {
  width: 100px;
  height: 50px;
  background: red;
  display: flex;
  align-items: center;
  justify-content: center;
}

.boxel-canvas__node-DragHandleNode .drag-handle {
  display: inline-block;
  width: 25px;
  height: 25px;
  background-color: green;
}

.boxel-canvas__container {
  user-select: none;
}`;
