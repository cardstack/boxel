import { computeContentHash, sanitizeHtml } from '@cardstack/runtime-common';
import {
  staticIconSvg,
  type StaticIconSvg,
} from '@cardstack/runtime-common/static-icon';

import type { BaseDef } from '@cardstack/base/card-api';

const artifacts = new WeakMap<object, StaticIconSvg | undefined>();

// Only the default selector with a literal icon component is data-independent.
// Inherited literals work; custom selectors and accessor properties keep the
// ordinary render route. Never call a getter to decide whether it is static.
export function getStaticIconSvg(
  klass: typeof BaseDef,
  base: typeof BaseDef,
): StaticIconSvg | undefined {
  let selector = valueDescriptor(klass, 'getIconComponent');
  if (!base || !selector || selector.value !== base.getIconComponent)
    return undefined;
  let icon = valueDescriptor(klass, 'icon')?.value;
  if (!icon || (typeof icon !== 'object' && typeof icon !== 'function'))
    return undefined;
  if (artifacts.has(icon)) return artifacts.get(icon);
  artifacts.set(icon, undefined);
  let property = Object.getOwnPropertyDescriptor(icon, staticIconSvg);
  let artifact = property?.value;
  let svgValue =
    artifact && Object.getOwnPropertyDescriptor(artifact, 'svg')?.value;
  let hashValue =
    artifact && Object.getOwnPropertyDescriptor(artifact, 'contentHash')?.value;
  if (
    !artifact ||
    property?.configurable ||
    property?.writable ||
    !Object.isFrozen(artifact) ||
    typeof svgValue !== 'string' ||
    svgValue.length > 65_536 ||
    typeof hashValue !== 'string' ||
    computeContentHash(new TextEncoder().encode(svgValue)) !== hashValue
  )
    return undefined;

  // Validate once per component, without executing/rendering it. A module can
  // provide markup too, so use the existing HTML sanitizer before publishing.
  let svg = sanitizeHtml(svgValue).trim();
  let fragment = document.createElement('template');
  fragment.innerHTML = svg;
  if (
    fragment.content.childNodes.length !== 1 ||
    fragment.content.firstElementChild?.namespaceURI !==
      'http://www.w3.org/2000/svg' ||
    fragment.content.firstElementChild.localName !== 'svg'
  )
    return undefined;
  const result = Object.freeze({
    svg,
    contentHash: computeContentHash(new TextEncoder().encode(svg)),
  });
  artifacts.set(icon, result);
  return result;
}

function valueDescriptor(object: object, key: PropertyKey) {
  let holder: object | null = object;
  while (holder) {
    let descriptor = Object.getOwnPropertyDescriptor(holder, key);
    if (descriptor) return 'value' in descriptor ? descriptor : undefined;
    holder = Object.getPrototypeOf(holder);
  }
  return undefined;
}
