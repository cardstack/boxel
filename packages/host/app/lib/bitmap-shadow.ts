// The primary card owns two shadow snapshots. Paint at the two endpoints;
// Choreo crossfades the raster faces while moving their shared border box.
// No per-frame shadow, filter, DOM measurement, or second animation clock.
let nextShadow = 0;

// Removing a direct child of <body> restyles the whole document. Layers come
// and go inside one persistent, boxless host so each crossing only touches it.
function shadowHost() {
  let host = document.body.querySelector<HTMLElement>(
    ':scope > .bitmap-shadow-host',
  );
  if (!host) {
    host = document.createElement('div');
    host.className = 'bitmap-shadow-host';
    host.style.display = 'contents';
    document.body.append(host);
  }
  return host;
}

export function prepareBitmapShadow(source: HTMLElement) {
  let token = String(++nextShadow);
  let layers: HTMLElement[] = [];
  let suppressed = new Set<HTMLElement>();
  let place = (element: HTMLElement) => {
    // All reads precede writes. These are the same viewport bounds used by
    // the primary snapshot, including transforms on ancestor stack elements.
    let box = element.getBoundingClientRect();
    let style = getComputedStyle(element);
    let zoom = element.offsetWidth ? box.width / element.offsetWidth : 1;
    let radius = [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ]
      .map((value) =>
        value.endsWith('px') ? `${parseFloat(value) * zoom}px` : value,
      )
      .join(' ');
    let restingShadow = style.boxShadow;
    let raised = element.classList.contains('stack-item-card');
    let painted: boolean[] = [];
    for (let [index, layer] of layers.entries()) {
      let boxShadow =
        index === 0
          ? raised
            ? 'var(--boxel-motion-lifted-contact)'
            : restingShadow
          : raised
            ? 'var(--boxel-motion-pool)'
            : 'none';
      painted.push(boxShadow !== 'none');
      Object.assign(layer.style, {
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        borderRadius: radius,
        boxShadow,
      });
    }
    element.setAttribute('data-bitmap-shadowed', token);
    suppressed.add(element);
    return painted;
  };
  for (let kind of ['contact', 'pool']) {
    let layer = document.createElement('div');
    layer.className = 'bitmap-shadow';
    layer.dataset.bitmapShadow = kind;
    layer.setAttribute('aria-hidden', 'true');
    layers.push(layer);
  }
  let sourcePainted = place(source);
  shadowHost().append(...layers);
  return {
    layers,
    sourcePainted,
    update(destination: HTMLElement | null) {
      if (destination) return place(destination);
      for (let layer of layers) layer.remove();
      return [false, false];
    },
    release() {
      for (let layer of layers) layer.remove();
      for (let element of suppressed)
        if (element.getAttribute('data-bitmap-shadowed') === token)
          element.removeAttribute('data-bitmap-shadowed');
    },
  };
}
