// Presentation helpers shared by all four format shells, so an icon, a byte
// count, or a date reads identically in atom, fitted, embedded, and isolated.
import { modifier } from 'ember-modifier';

import FileIcon from '@cardstack/boxel-icons/file';

import type { ComponentLike } from '@glint/template';

// Structurally the same as card-api's `CardOrFieldTypeIcon`, restated here so
// the shells need nothing from card-api — not even a type. card-api imports the
// format templates, so the dependency only runs the other way.
export type FileIconComponent = ComponentLike<{ Element: SVGSVGElement }>;

// The glyph comes from the file's own class, which already declares
// `static icon` — `AudioDef` names the music glyph, `PngDef` the PNG one. Two
// reasons the shells read it from there rather than keeping a family→glyph map:
// a family that adds itself doesn't have to also edit a shared registry, and
// each glyph's module stays out of card-api's dependency graph, which every
// card in every realm inherits. `FileDef`'s own generic icon is the fallback
// for a file whose family hasn't landed a subclass yet.
export function fileIconFor(
  source?: { icon?: FileIconComponent } | null,
): FileIconComponent {
  return source?.icon ?? FileIcon;
}

// Preserve the source's authored shape until honoring it would make the player
// unusably short or tall; extreme cinema and portrait sources matte instead.
export function boundedVideoFrameAspectRatio(value?: number | null): number {
  let ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 16 / 9;
  }
  return Math.max(4 / 5, Math.min(16 / 9, ratio));
}

// Embedded content owns its own interaction; the host chrome owns navigation.
// Without this, pressing a native control also opens the enclosing card.
export const containEmbeddedInteraction = modifier((element: HTMLElement) => {
  let stop = (event: Event) => event.stopPropagation();
  let events = [
    'click',
    'dblclick',
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'touchstart',
    'touchend',
  ];
  for (let eventName of events) {
    element.addEventListener(eventName, stop);
  }
  return () => {
    for (let eventName of events) {
      element.removeEventListener(eventName, stop);
    }
  };
});

export function humanSize(bytes?: number | null): string {
  if (bytes == null || Number.isNaN(bytes)) {
    return '';
  }
  if (bytes === 0) {
    return '0 bytes';
  }
  let units = ['bytes', 'KB', 'MB', 'GB'];
  let i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  let value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export function shortDate(value?: Date | string | null): string {
  if (!value) {
    return '';
  }
  let d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function relativeDate(value?: Date | string | null): string {
  if (!value) {
    return '';
  }
  let d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  let days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 0) {
    return shortDate(d);
  }
  if (days === 0) {
    return 'today';
  }
  if (days < 30) {
    return `${days}d ago`;
  }
  if (days < 365) {
    return `${Math.floor(days / 30)}mo ago`;
  }
  return `${Math.floor(days / 365)}y ago`;
}

export function formatClock(totalSeconds?: number | null): string {
  if (totalSeconds == null || !Number.isFinite(Number(totalSeconds))) {
    return '';
  }
  let seconds = Math.max(0, Math.round(Number(totalSeconds)));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
