// Presentation helpers shared by all four format shells, so an icon, a byte
// count, or a date reads identically in atom, fitted, embedded, and isolated.
import { modifier } from 'ember-modifier';

import BoxIcon from '@cardstack/boxel-icons/box';
import BracesIcon from '@cardstack/boxel-icons/braces';
import FileIcon from '@cardstack/boxel-icons/file';
import FileArchiveIcon from '@cardstack/boxel-icons/file-archive';
import FileCodeIcon from '@cardstack/boxel-icons/file-code';
import FileSpreadsheetIcon from '@cardstack/boxel-icons/file-spreadsheet';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import FileTypeDocIcon from '@cardstack/boxel-icons/file-type-doc';
import FileTypePdfIcon from '@cardstack/boxel-icons/file-type-pdf';
import FilmIcon from '@cardstack/boxel-icons/film';
import ImageIcon from '@cardstack/boxel-icons/image';
import MusicIcon from '@cardstack/boxel-icons/music';
import PresentationIcon from '@cardstack/boxel-icons/presentation';
import TableIcon from '@cardstack/boxel-icons/table';
import TypeIcon from '@cardstack/boxel-icons/type';

type IconComponent = typeof FileIcon;

const FAMILY_ICONS: Record<string, IconComponent> = {
  image: ImageIcon,
  audio: MusicIcon,
  // MIDI is music data, not an encoded-audio subtype, but it shares the glyph.
  music: MusicIcon,
  video: FilmIcon,
  // HTML is a browser document rather than a generic text leaf.
  web: FileCodeIcon,
  document: FileTextIcon,
  code: FileCodeIcon,
  data: TableIcon,
  pdf: FileTypePdfIcon,
  office: FileTypeDocIcon,
  archive: FileArchiveIcon,
  font: TypeIcon,
  model: BoxIcon,
  generic: FileIcon,
};

// A preview kind is narrower than a family, so it wins where it differs.
const PREVIEW_ICONS: Record<string, IconComponent> = {
  json: BracesIcon,
  csv: TableIcon,
  schema: FileCodeIcon,
  html: FileCodeIcon,
  docx: FileTypeDocIcon,
  slide: PresentationIcon,
  sheet: FileSpreadsheetIcon,
};

export function iconFor(previewKind?: string, family?: string): IconComponent {
  return (
    (previewKind ? PREVIEW_ICONS[previewKind] : undefined) ??
    (family ? FAMILY_ICONS[family] : undefined) ??
    FileIcon
  );
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
