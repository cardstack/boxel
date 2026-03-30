import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import config from '@cardstack/host/config/environment';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { IconGlobe, Lock, StarFilled } from '@cardstack/boxel-ui/icons';

import MockWorkspace from './mock-workspace';
import Workspace from './workspace';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    sortOrder: 'default' | 'hosted-only';
    onSortChange: (event: Event) => void;
  };
}

const REALM_ICON_FONTS = [
  // Serif
  'Georgia, serif',
  "'Times New Roman', serif",
  'Palatino, serif',
  "'Book Antiqua', Palatino, serif",
  "'Garamond', Georgia, serif",
  "'Didot', 'Bodoni MT', serif",
  "'Baskerville', 'Palatino Linotype', serif",
  // Sans-serif
  'Impact, sans-serif',
  'Verdana, sans-serif',
  "'Trebuchet MS', sans-serif",
  'Tahoma, sans-serif',
  "'Arial Black', sans-serif",
  "'Gill Sans', sans-serif",
  "'Franklin Gothic Medium', sans-serif",
  "'Helvetica Neue', Helvetica, sans-serif",
  "'Futura', 'Century Gothic', sans-serif",
  "'Century Gothic', sans-serif",
  "'Optima', Candara, sans-serif",
  'Candara, sans-serif',
  // Monospace
  "'Courier New', monospace",
  "'Lucida Console', 'Courier New', monospace",
  // Display / decorative
  "'Rockwell', 'Courier Bold', serif",
  "'Copperplate', 'Copperplate Gothic Light', fantasy",
  "'Papyrus', fantasy",
  "'Big Caslon', 'Book Antiqua', serif",
];

const GRADIENT_COLORS_2 = [
  // Electric / vivid (high chroma, mid-bright)
  '#FF3CAC', '#FC466B', '#F7971E', '#FF006E', '#3A86FF',
  '#FB5607', '#F72585', '#FF9A3C', '#FF6B9D', '#FD1D1D',
  '#E63946', '#E76F51', '#EF4444', '#F97316', '#EC4899',
  // Vivid cool
  '#06D6A0', '#4CC9F0', '#00C9FF', '#55EFC4', '#00CEC9',
  '#0EA5E9', '#14B8A6', '#10B981', '#0891B2', '#22D3EE',
  // Vivid purples / pinks
  '#7C3AED', '#8B5CF6', '#A855F7', '#9333EA', '#C026D3',
  '#7B2FBE', '#BE185D', '#DB2777', '#6A0572', '#A8324A',
  // Vivid reds / oranges
  '#DC2626', '#B91C1C', '#C1121F', '#C7254E', '#EA580C',
  '#BB3E03', '#D97706', '#F59E0B',
  // Vivid greens / teals
  '#15803D', '#16A34A', '#0F766E', '#0E7490', '#2A9D8F',
  '#047857', '#0A7029', '#1B6CA8', '#2D6A4F',
  // Vivid blues
  '#1D4ED8', '#2563EB', '#1B6CA8', '#457B9D', '#0369A1',
  '#1E40AF', '#3B82F6', '#6366F1', '#4F46E5',
];

type GradientFactory = (c1: string, c2: string) => { defs: string; bg: string };

const GRADIENT_FACTORIES: GradientFactory[] = [
  // ── Linear — varied angles ──
  (c1, c2) => ({ defs: `<linearGradient id="g" x1="0" y1="20" x2="40" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<linearGradient id="g" x1="20" y1="0" x2="20" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<linearGradient id="g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<linearGradient id="g" x1="40" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<linearGradient id="g" x1="0" y1="20" x2="40" y2="20" gradientUnits="userSpaceOnUse" gradientTransform="rotate(30,20,20)"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<linearGradient id="g" x1="0" y1="20" x2="40" y2="20" gradientUnits="userSpaceOnUse" gradientTransform="rotate(60,20,20)"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<linearGradient id="g" x1="0" y1="20" x2="40" y2="20" gradientUnits="userSpaceOnUse" gradientTransform="rotate(120,20,20)"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<linearGradient id="g" x1="0" y1="20" x2="40" y2="20" gradientUnits="userSpaceOnUse" gradientTransform="rotate(150,20,20)"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<linearGradient id="g" x1="0" y1="20" x2="40" y2="20" gradientUnits="userSpaceOnUse" gradientTransform="rotate(210,20,20)"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<linearGradient id="g" x1="0" y1="20" x2="40" y2="20" gradientUnits="userSpaceOnUse" gradientTransform="rotate(300,20,20)"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  // ── Radial — varied focal points ──
  (c1, c2) => ({ defs: `<radialGradient id="g" cx="50%" cy="50%" r="70%" fx="50%" fy="50%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<radialGradient id="g" cx="20%" cy="20%" r="85%" fx="20%" fy="20%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<radialGradient id="g" cx="80%" cy="20%" r="85%" fx="80%" fy="20%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<radialGradient id="g" cx="20%" cy="80%" r="85%" fx="20%" fy="80%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<radialGradient id="g" cx="80%" cy="80%" r="85%" fx="80%" fy="80%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<radialGradient id="g" cx="50%" cy="0%" r="100%" fx="50%" fy="0%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<radialGradient id="g" cx="50%" cy="100%" r="100%" fx="50%" fy="100%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  // Radial elliptical — wide/tall focal
  (c1, c2) => ({ defs: `<radialGradient id="g" cx="50%" cy="50%" r="50%" fx="50%" fy="50%" gradientTransform="scale(2,1) translate(-10,0)"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  (c1, c2) => ({ defs: `<radialGradient id="g" cx="50%" cy="50%" r="50%" fx="50%" fy="50%" gradientTransform="scale(1,2) translate(0,-10)"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`, bg: '<rect width="40" height="40" fill="url(#g)"/>' }),
  // ── Blended composites (conic-like smooth sweeps) ──
  // H×V corner sweep — like conic-gradient(c1, c2)
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/></linearGradient><linearGradient id="b" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/></linearGradient>`, bg: `<rect width="40" height="40" fill="${c2}"/><rect width="40" height="40" fill="url(#a)"/><rect width="40" height="40" fill="url(#b)"/>` }),
  // Diagonal×diagonal cross-blend
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/></linearGradient><linearGradient id="b" x1="1" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/></linearGradient>`, bg: `<rect width="40" height="40" fill="${c1}"/><rect width="40" height="40" fill="url(#a)"/><rect width="40" height="40" fill="url(#b)"/>` }),
  // Dual opposite-corner radials
  (c1, c2) => ({ defs: `<radialGradient id="a" cx="0%" cy="0%" r="80%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/></radialGradient><radialGradient id="b" cx="100%" cy="100%" r="80%"><stop offset="0%" stop-color="${c2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/></radialGradient>`, bg: `<rect width="40" height="40" fill="${c2}"/><rect width="40" height="40" fill="url(#a)"/><rect width="40" height="40" fill="url(#b)"/>` }),
  // Dual diagonal-corner radials
  (c1, c2) => ({ defs: `<radialGradient id="a" cx="100%" cy="0%" r="80%"><stop offset="0%" stop-color="${c2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/></radialGradient><radialGradient id="b" cx="0%" cy="100%" r="80%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/></radialGradient>`, bg: `<rect width="40" height="40" fill="${c1}"/><rect width="40" height="40" fill="url(#a)"/><rect width="40" height="40" fill="url(#b)"/>` }),
  // Center spotlight over base
  (c1, c2) => ({ defs: `<radialGradient id="a" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="${c2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/></radialGradient>`, bg: `<rect width="40" height="40" fill="${c1}"/><rect width="40" height="40" fill="url(#a)"/>` }),
  // Halo / ring (glow at edges)
  (c1, c2) => ({ defs: `<radialGradient id="a" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="${c1}" stop-opacity="0"/><stop offset="60%" stop-color="${c1}" stop-opacity="0"/><stop offset="100%" stop-color="${c1}"/></radialGradient>`, bg: `<rect width="40" height="40" fill="${c2}"/><rect width="40" height="40" fill="url(#a)"/>` }),
  // Shimmer — diagonal blend + centre highlight
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient><radialGradient id="b" cx="50%" cy="50%" r="40%"><stop offset="0%" stop-color="white" stop-opacity="0.3"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient>`, bg: `<rect width="40" height="40" fill="url(#a)"/><rect width="40" height="40" fill="url(#b)"/>` }),
  // Atmospheric — diagonal + outer vignette
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient><radialGradient id="b" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="black" stop-opacity="0"/><stop offset="100%" stop-color="black" stop-opacity="0.4"/></radialGradient>`, bg: `<rect width="40" height="40" fill="url(#a)"/><rect width="40" height="40" fill="url(#b)"/>` }),
  // Corner sweep from top-left
  (c1, c2) => ({ defs: `<radialGradient id="a" cx="0%" cy="0%" r="100%"><stop offset="0%" stop-color="${c1}"/><stop offset="50%" stop-color="${c2}"/><stop offset="100%" stop-color="${c2}"/></radialGradient>`, bg: `<rect width="40" height="40" fill="url(#a)"/>` }),
  // Corner sweep from bottom-right
  (c1, c2) => ({ defs: `<radialGradient id="a" cx="100%" cy="100%" r="100%"><stop offset="0%" stop-color="${c2}"/><stop offset="50%" stop-color="${c1}"/><stop offset="100%" stop-color="${c1}"/></radialGradient>`, bg: `<rect width="40" height="40" fill="url(#a)"/>` }),
  // V-fade (bright edges, deep centre)
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c2}" stop-opacity="0.8"/><stop offset="50%" stop-color="${c2}" stop-opacity="0"/><stop offset="100%" stop-color="${c2}" stop-opacity="0.8"/></linearGradient>`, bg: `<rect width="40" height="40" fill="${c1}"/><rect width="40" height="40" fill="url(#a)"/>` }),
  // Horizontal V-fade
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c2}" stop-opacity="0.8"/><stop offset="50%" stop-color="${c2}" stop-opacity="0"/><stop offset="100%" stop-color="${c2}" stop-opacity="0.8"/></linearGradient>`, bg: `<rect width="40" height="40" fill="${c1}"/><rect width="40" height="40" fill="url(#a)"/>` }),
  // Tri-stop diagonal (c1 → mid-dark → c2)
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c1}"/><stop offset="50%" stop-color="black" stop-opacity="0.35"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: `<rect width="40" height="40" fill="url(#a)"/>` }),
  // Tri-stop horizontal (c1 → c2 → c1)
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c1}"/><stop offset="50%" stop-color="${c2}"/><stop offset="100%" stop-color="${c1}"/></linearGradient>`, bg: `<rect width="40" height="40" fill="url(#a)"/>` }),
  // Tri-stop vertical (c2 → c1 → c2)
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${c2}"/><stop offset="50%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: `<rect width="40" height="40" fill="url(#a)"/>` }),
  // Starburst — radial from centre, dark outer ring
  (c1, c2) => ({ defs: `<radialGradient id="a" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="${c2}"/><stop offset="70%" stop-color="${c1}"/><stop offset="100%" stop-color="black" stop-opacity="0.5"/></radialGradient>`, bg: `<rect width="40" height="40" fill="url(#a)"/>` }),
  // Four-corner mesh — four radials, each corner a different mix
  (c1, c2) => ({ defs: `<radialGradient id="a" cx="0%" cy="0%" r="70%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/></radialGradient><radialGradient id="b" cx="100%" cy="100%" r="70%"><stop offset="0%" stop-color="${c2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/></radialGradient><radialGradient id="c" cx="100%" cy="0%" r="60%"><stop offset="0%" stop-color="${c2}" stop-opacity="0.6"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/></radialGradient>`, bg: `<rect width="40" height="40" fill="${c1}"/><rect width="40" height="40" fill="url(#a)"/><rect width="40" height="40" fill="url(#b)"/><rect width="40" height="40" fill="url(#c)"/>` }),
  // Bottom-lit — dark top, vivid bottom
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="black" stop-opacity="0.5"/><stop offset="60%" stop-color="${c1}" stop-opacity="0"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`, bg: `<rect width="40" height="40" fill="${c1}"/><rect width="40" height="40" fill="url(#a)"/>` }),
  // Split diagonal — hard-ish divide
  (c1, c2) => ({ defs: `<linearGradient id="a" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop offset="40%" stop-color="${c1}"/><stop offset="60%" stop-color="${c2}"/></linearGradient>`, bg: `<rect width="40" height="40" fill="url(#a)"/>` }),
];

const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h * 360;
}

// Blending warm (red/orange/yellow) with green produces olive/mud — block it explicitly
function isMuddyPair(h1: number, h2: number): boolean {
  const isWarm  = (h: number) => h >= 330 || h <= 75;  // reds, oranges, yellows
  const isGreen = (h: number) => h > 75 && h <= 175;   // yellow-greens through teals
  return (isWarm(h1) && isGreen(h2)) || (isGreen(h1) && isWarm(h2));
}

function realmIcon(letter: string, color: string): string {
  const seed =
    letter.charCodeAt(0) + (parseInt(color.replace('#', ''), 16) % 97);
  const font = REALM_ICON_FONTS[seed % REALM_ICON_FONTS.length]!;
  const h1 = hexToHue(color);
  // Walk the pool from the seed position; skip any candidate that would create a muddy blend
  let color2 = GRADIENT_COLORS_2[seed % GRADIENT_COLORS_2.length]!;
  for (let i = 0; i < GRADIENT_COLORS_2.length; i++) {
    const candidate = GRADIENT_COLORS_2[(seed + i) % GRADIENT_COLORS_2.length]!;
    if (!isMuddyPair(h1, hexToHue(candidate))) { color2 = candidate; break; }
  }
  const { defs, bg } =
    GRADIENT_FACTORIES[(seed * 7) % GRADIENT_FACTORIES.length]!(color, color2);
  const fontWeight = FONT_WEIGHTS[(seed * 17) % FONT_WEIGHTS.length]!;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">` +
    `<defs>${defs || ''}</defs>` +
    bg +
    `<rect width="40" height="40" fill="black" fill-opacity="0.12"/>` +
    `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-size="22" font-weight="${fontWeight}" fill="white" font-family="${font}">${letter}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export default class WorkspaceChooser extends Component<Signature> {
  @service declare realmServer: RealmServerService;

  private get displayCatalogWorkspaces() {
    return (
      this.realmServer.catalogRealmURLs &&
      this.realmServer.catalogRealmURLs.length > 0
    );
  }

  private readonly mockCatalogTiles: Array<{
    name: string;
    backgroundImageURL: string;
    realmIconURL?: string;
    hostLocations?: Array<{ realmIconURL: string; url: string }>;
    visibility?: 'public' | 'private';
    darken?: boolean;
  }> = [
    {
      name: 'Design System',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-sand-stone.jpg)',
      realmIconURL: realmIcon('D', '#6366F1'),
      darken: true,
      hostLocations: [
        { realmIconURL: realmIcon('D', '#6366F1'), url: 'boxel.ai/design-system' },
        { realmIconURL: realmIcon('D', '#6366F1'), url: 'chris.boxel.space/design-system' },
        { realmIconURL: realmIcon('D', '#6366F1'), url: 'acme.boxel.space/ds' },
        { realmIconURL: realmIcon('D', '#6366F1'), url: 'staging.boxel.ai/design-system' },
      ],
    },
    {
      name: 'Marketing Hub',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-water-surface.jpg)',
      realmIconURL: realmIcon('M', '#EC4899'),
      darken: true,
      visibility: 'private',
      hostLocations: [
        { realmIconURL: realmIcon('M', '#EC4899'), url: 'boxel.ai/marketing-hub' },
        { realmIconURL: realmIcon('M', '#EC4899'), url: 'acme.boxel.space/marketing' },
        { realmIconURL: realmIcon('M', '#EC4899'), url: 'hana.boxel.space/mktg' },
      ],
    },
    {
      name: 'Project Templates',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-rolling-hills.jpg)',
      realmIconURL: realmIcon('P', '#F59E0B'),
      darken: true,
      hostLocations: [
        { realmIconURL: realmIcon('P', '#F59E0B'), url: 'boxel.ai/templates' },
        { realmIconURL: realmIcon('P', '#F59E0B'), url: 'studio.boxel.space/templates' },
        { realmIconURL: realmIcon('P', '#F59E0B'), url: 'ivan.boxel.space/project-templates' },
        { realmIconURL: realmIcon('P', '#F59E0B'), url: 'jess.boxel.space/templates' },
        { realmIconURL: realmIcon('P', '#F59E0B'), url: 'sandbox.boxel.ai/templates' },
      ],
    },
    {
      name: 'Data Catalog',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-desert-dunes.jpg)',
      realmIconURL: realmIcon('C', '#10B981'),
      darken: true,
      visibility: 'private',
      hostLocations: [
        { realmIconURL: realmIcon('C', '#10B981'), url: 'boxel.ai/data-catalog' },
        { realmIconURL: realmIcon('C', '#10B981'), url: 'data.boxel.space/catalog' },
        { realmIconURL: realmIcon('C', '#10B981'), url: 'brenda.boxel.space/data' },
        { realmIconURL: realmIcon('C', '#10B981'), url: 'research.boxel.ai/catalog' },
      ],
    },
    {
      name: 'Developer Tools',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-wood-grain.jpg)',
      realmIconURL: realmIcon('T', '#3B82F6'),
      darken: true,
      hostLocations: [
        { realmIconURL: realmIcon('T', '#3B82F6'), url: 'boxel.ai/dev-tools' },
        { realmIconURL: realmIcon('T', '#3B82F6'), url: 'dev.boxel.space/tools' },
        { realmIconURL: realmIcon('T', '#3B82F6'), url: 'evan.boxel.space/devtools' },
      ],
    },
    {
      name: 'Content Library',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-wildflower-field.jpg)',
      realmIconURL: realmIcon('L', '#8B5CF6'),
      darken: true,
      visibility: 'private',
      hostLocations: [
        { realmIconURL: realmIcon('L', '#8B5CF6'), url: 'boxel.ai/content-library' },
        { realmIconURL: realmIcon('L', '#8B5CF6'), url: 'media.boxel.space/library' },
        { realmIconURL: realmIcon('L', '#8B5CF6'), url: 'fatima.boxel.space/content' },
        { realmIconURL: realmIcon('L', '#8B5CF6'), url: 'alice.boxel.space/library' },
        { realmIconURL: realmIcon('L', '#8B5CF6'), url: 'publish.boxel.ai/content-library' },
      ],
    },
    {
      name: 'Analytics Suite',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-silver-fur.jpg)',
      realmIconURL: realmIcon('A', '#EF4444'),
      darken: true,
      hostLocations: [
        { realmIconURL: realmIcon('A', '#EF4444'), url: 'boxel.ai/analytics' },
        { realmIconURL: realmIcon('A', '#EF4444'), url: 'stats.boxel.space/analytics' },
        { realmIconURL: realmIcon('A', '#EF4444'), url: 'diana.boxel.space/analytics' },
      ],
    },
    {
      name: 'Starter Packs',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-thick-frost.jpg)',
      realmIconURL: realmIcon('S', '#14B8A6'),
      darken: true,
      visibility: 'private',
      hostLocations: [
        { realmIconURL: realmIcon('S', '#14B8A6'), url: 'boxel.ai/starter-packs' },
        { realmIconURL: realmIcon('S', '#14B8A6'), url: 'onboard.boxel.space/starters' },
        { realmIconURL: realmIcon('S', '#14B8A6'), url: 'george.boxel.space/starter-packs' },
        { realmIconURL: realmIcon('S', '#14B8A6'), url: 'carlos.boxel.space/onboarding' },
      ],
    },
  ];

  private readonly mockPublicTiles: Array<{
    name: string;
    backgroundImageURL: string;
    realmIconURL?: string;
    hosted?: boolean;
    hostLocations?: Array<{ realmIconURL: string; url: string }>;
    darken?: boolean;
  }> = [
    {
      name: 'Open Research',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-mountain-runway.jpg)',
      realmIconURL: realmIcon('O', '#0EA5E9'),
      hosted: true,
      hostLocations: [
        { realmIconURL: realmIcon('O', '#0EA5E9'), url: 'research.boxel.ai/open' },
        { realmIconURL: realmIcon('O', '#0EA5E9'), url: 'labs.boxel.space/research' },
      ],
    },
    {
      name: 'Community Blog',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-joshua-dawn.jpg)',
      realmIconURL: realmIcon('C', '#FBBF24'),
    },
    {
      name: 'Public Docs',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-coral-reefs.jpg)',
      realmIconURL: realmIcon('D', '#C084FC'),
      hosted: true,
    },
    {
      name: 'Shared Assets',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-metallic-leather.jpg)',
      realmIconURL: realmIcon('S', '#34D399'),
      hosted: true,
      hostLocations: [
        { realmIconURL: realmIcon('S', '#34D399'), url: 'assets.boxel.ai/shared' },
        { realmIconURL: realmIcon('S', '#34D399'), url: 'cdn.boxel.space/assets' },
        { realmIconURL: realmIcon('S', '#34D399'), url: 'media.boxel.space/shared' },
      ],
    },
    {
      name: 'Learning Hub',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-crescent-lake.jpg)',
      realmIconURL: realmIcon('L', '#F87171'),
    },
    {
      name: 'Project Showcase',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-granite-peaks.jpg)',
      realmIconURL: realmIcon('R', '#60A5FA'),
      hosted: true,
    },
    {
      name: 'API Reference',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-watercolor-splashes.jpg)',
      realmIconURL: realmIcon('A', '#F97316'),
      hosted: true,
      hostLocations: [
        { realmIconURL: realmIcon('A', '#F97316'), url: 'api.boxel.ai/reference' },
        { realmIconURL: realmIcon('A', '#F97316'), url: 'docs.boxel.space/api' },
      ],
    },
    {
      name: 'Boxel Skills',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-silver-fur.jpg)',
      realmIconURL: realmIcon('B', '#DB2777'),
      hosted: true,
      darken: true,
    },
  ];

  private readonly mockPrivateTiles: Array<{
    name: string;
    backgroundImageURL: string;
    realmIconURL?: string;
    hosted?: boolean;
    hostLocations?: Array<{ realmIconURL: string; url: string }>;
    darken?: boolean;
  }> = [
    {
      name: 'HR Records',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-fallen-leaves.jpg)',
      realmIconURL: realmIcon('H', '#FCD34D'),
      hosted: true,
      hostLocations: [
        { realmIconURL: realmIcon('H', '#FCD34D'), url: 'hr.boxel.space/records' },
        { realmIconURL: realmIcon('H', '#FCD34D'), url: 'internal.boxel.space/hr' },
      ],
    },
    {
      name: 'Internal Tools',
      backgroundImageURL:
        'url(https://boxel-images.boxel.ai/background-images/4k-lava-river.jpg)',
      realmIconURL: realmIcon('I', '#818CF8'),
    },
  ];

  @tracked favoritedTileNames: string[] = [];

  private get sortOrder() {
    return this.args.sortOrder;
  }

  private get allMockTiles() {
    return [
      ...this.mockCatalogTiles.map((t) => ({ ...t, hosted: true as const })),
      ...this.mockPublicTiles,
      ...this.mockPrivateTiles.map((t) => ({
        ...t,
        visibility: 'private' as const,
      })),
    ];
  }

  private get favoritedTiles() {
    const tiles = this.allMockTiles.filter((t) =>
      this.favoritedTileNames.includes(t.name),
    );
    if (this.sortOrder === 'hosted-only') {
      return tiles.filter((t) => t.hosted === true);
    }
    return tiles;
  }

  private get favoritesEmptyMessage(): string | null {
    if (this.favoritedTileNames.length === 0) {
      return 'You have no favorites yet';
    }
    if (this.favoritedTiles.length === 0) {
      return 'No matching results';
    }
    return null;
  }

  private get publicCatalogTiles() {
    return this.mockCatalogTiles.filter((t) => t.visibility !== 'private');
  }

  private get privateCatalogTiles() {
    return this.mockCatalogTiles.filter((t) => t.visibility === 'private');
  }

  private get filteredMockPublicTiles() {
    if (this.sortOrder === 'hosted-only') {
      return this.mockPublicTiles.filter((t) => t.hosted === true);
    }
    return this.mockPublicTiles;
  }

  private get filteredMockPrivateTiles() {
    if (this.sortOrder === 'hosted-only') {
      return this.mockPrivateTiles.filter((t) => t.hosted === true);
    }
    return this.mockPrivateTiles;
  }

  private get publicSectionHasTiles() {
    return (
      this.publicCatalogTiles.length > 0 ||
      this.filteredMockPublicTiles.length > 0
    );
  }

  private get privateSectionHasTiles() {
    return (
      this.privateCatalogTiles.length > 0 ||
      this.filteredMockPrivateTiles.length > 0
    );
  }

  isTileFavorited = (name: string) => this.favoritedTileNames.includes(name);

  @action toggleTileFavorite(name: string) {
    if (this.favoritedTileNames.includes(name)) {
      this.favoritedTileNames = this.favoritedTileNames.filter(
        (n) => n !== name,
      );
    } else {
      this.favoritedTileNames = [...this.favoritedTileNames, name];
    }
  }

  private get communityRealmURLs() {
    let realmURLs = this.realmServer.catalogRealmURLs ?? [];
    if (config.environment !== 'production') {
      return realmURLs;
    }
    return realmURLs.filter(
      (realmURL) => !realmURL.includes('/boxel-homepage/'),
    );
  }

  <template>
    <div class='workspace-chooser' data-test-workspace-chooser>
      <div class='workspace-chooser__content'>
        <div class='sections-wrapper'>
          <div class='workspace-section'>
            <div class='section-header'>
              <StarFilled width='20' height='20' class='section-header-icon' />
              <span class='workspace-chooser__title'>Favorites</span>
            </div>
            {{#if this.favoritesEmptyMessage}}
              <span class='section-empty'>{{this.favoritesEmptyMessage}}</span>
            {{else}}
              <div class='workspace-list'>
                {{#each this.favoritedTiles as |tile|}}
                  <MockWorkspace
                    @name={{tile.name}}
                    @backgroundImageURL={{tile.backgroundImageURL}}
                    @realmIconURL={{tile.realmIconURL}}
                    @hosted={{tile.hosted}}
                    @hostLocations={{tile.hostLocations}}
                    @isFavorited={{true}}
                    @visibility={{tile.visibility}}
                    @darken={{tile.darken}}
                    @onToggleFavorite={{fn this.toggleTileFavorite tile.name}}
                  />
                {{/each}}
              </div>
            {{/if}}
          </div>
          <div class='workspace-section'>
            <div class='section-header'>
              <IconGlobe width='20' height='20' class='section-header-icon' />
              <span class='workspace-chooser__title'>Public</span>
            </div>
            {{#if this.publicSectionHasTiles}}
              <div class='workspace-list'>
                {{#each this.publicCatalogTiles as |tile|}}
                  <MockWorkspace
                    @name={{tile.name}}
                    @backgroundImageURL={{tile.backgroundImageURL}}
                    @realmIconURL={{tile.realmIconURL}}
                    @hosted={{true}}
                    @hostLocations={{tile.hostLocations}}
                    @darken={{tile.darken}}
                    @isFavorited={{(this.isTileFavorited tile.name)}}
                    @onToggleFavorite={{fn this.toggleTileFavorite tile.name}}
                  />
                {{/each}}
                {{#each this.filteredMockPublicTiles as |tile|}}
                  <MockWorkspace
                    @name={{tile.name}}
                    @backgroundImageURL={{tile.backgroundImageURL}}
                    @realmIconURL={{tile.realmIconURL}}
                    @hosted={{tile.hosted}}
                    @hostLocations={{tile.hostLocations}}
                    @darken={{tile.darken}}
                    @isFavorited={{(this.isTileFavorited tile.name)}}
                    @onToggleFavorite={{fn this.toggleTileFavorite tile.name}}
                  />
                {{/each}}
              </div>
            {{else}}
              <span class='section-empty'>No matching results</span>
            {{/if}}
          </div>
          <div class='workspace-section'>
            <div class='section-header'>
              <Lock width='20' height='20' class='section-header-icon' />
              <span class='workspace-chooser__title'>Private</span>
            </div>
            {{#if this.privateSectionHasTiles}}
              <div class='workspace-list'>
                {{#each this.privateCatalogTiles as |tile|}}
                  <MockWorkspace
                    @name={{tile.name}}
                    @backgroundImageURL={{tile.backgroundImageURL}}
                    @realmIconURL={{tile.realmIconURL}}
                    @hosted={{true}}
                    @hostLocations={{tile.hostLocations}}
                    @darken={{tile.darken}}
                    @isFavorited={{(this.isTileFavorited tile.name)}}
                    @visibility='private'
                    @onToggleFavorite={{fn this.toggleTileFavorite tile.name}}
                  />
                {{/each}}
                {{#each this.filteredMockPrivateTiles as |tile|}}
                  <MockWorkspace
                    @name={{tile.name}}
                    @backgroundImageURL={{tile.backgroundImageURL}}
                    @realmIconURL={{tile.realmIconURL}}
                    @hosted={{tile.hosted}}
                    @hostLocations={{tile.hostLocations}}
                    @darken={{tile.darken}}
                    @isFavorited={{(this.isTileFavorited tile.name)}}
                    @visibility='private'
                    @onToggleFavorite={{fn this.toggleTileFavorite tile.name}}
                  />
                {{/each}}
              </div>
            {{else}}
              <span class='section-empty'>No matching results</span>
            {{/if}}
          </div>
{{#if this.displayCatalogWorkspaces}}
            <div class='workspace-section'>
              <span class='workspace-chooser__title'>Community Catalogs</span>
              <div class='workspace-list' data-test-catalog-list>
                {{#each this.communityRealmURLs as |realmURL|}}
                  <Workspace @realmURL={{realmURL}} />
                {{/each}}
              </div>
            </div>
          {{/if}}
        </div>
      </div>
    </div>
    <style scoped>
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .workspace-chooser {
        opacity: 0;
        position: absolute;
        background-color: #1a1628;
        height: 100%;
        width: 100%;
        animation: fadeIn 0.5s ease-in forwards;
        z-index: var(--host-workspace-chooser-z-index);
      }
      .workspace-chooser__content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-lg);
        height: 100%;
        padding: calc(5rem + 60px) 5rem 5rem;
        overflow: auto;
      }
      .sections-wrapper {
        display: flex;
        flex-direction: column;
        gap: calc(var(--boxel-sp-lg) + 50px);
      }
      .workspace-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      .section-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .section-header-icon {
        --icon-color: #00FFBA;
        color: #00FFBA;
        flex-shrink: 0;
      }
      .workspace-chooser__title {
        color: var(--boxel-light);
        font: 400 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp);
      }

      .workspace-list {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--boxel-sp-lg) + 20px);
        padding: var(--boxel-sp-xs) 0;
      }
      .section-empty {
        color: var(--boxel-400);
        font: 400 var(--boxel-font-sm);
      }
    </style>
  </template>
}
