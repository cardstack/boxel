import { htmlSafe } from '@ember/template';
import { Object3D } from 'three';

import { catalog } from './catalog';
import { objectCss } from './css3d';

/** CSS dimensions are bounded; world units describe the architecture. */
export function galleryPlane(
  x: number,
  y: number,
  z: number,
  yaw = 0,
  pitch = 0,
  scale = 1
) {
  const object = new Object3D();
  object.position.set(x, y, z);
  object.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0);
  object.updateMatrixWorld();
  return `transform:${objectCss(object.matrixWorld.elements, scale)};`;
}
// Reserve the expanded state, including stage padding and motion clearance.
// See videos/choreo-widget-room/TILE-CAPACITY.md for the state audit.
const shapes: Record<string, [number, number]> = {
  playhead: [480, 480],
  lightbox: [480, 520],
  inbox: [480, 560],
  'inline-edit': [480, 520],
  sequence: [720, 420],
  interrupt: [720, 260],
  slides: [480, 420],
  mockup: [360, 640],
  sylva: [840, 480],
  towers: [840, 480],
  camera: [720, 480],
  presentation: [840, 540],
  wires: [720, 560],
  escort: [480, 300],
  grid: [480, 440],
  tabs: [720, 180],
  far: [720, 360],
  crossing: [720, 420],
  subdivision: [480, 480],
  drag: [360, 360],
  rack: [420, 620],
  sheet: [360, 560],
  split: [720, 380],
  reorder: [420, 480],
  layout: [420, 600],
  lists: [480, 420],
  stagger: [480, 320],
  trail: [360, 360],
  jump: [480, 420],
  keyframes: [360, 360],
  'circle-loop': [480, 380],
  'long-take': [840, 540],
  sagrada: [840, 540],
  grip: [720, 440],
  gestures: [360, 360],
  presence: [480, 320],
  parallax: [480, 560],
  enter: [480, 300],
  reveal: [480, 560],
  drift: [480, 480],
  hang: [480, 560],
  header: [480, 500],
  fold: [480, 520],
  path: [360, 360],
  pointer: [360, 360],
  'build-order': [720, 540],
};
export const galleryBays = [
  'Feel the response',
  'Keep your place',
  'Orchestrate change',
  'Follow the story',
  'Enter the space',
  'Direct the scene',
].map((name, index) => {
  const angle = -70 + index * 28,
    rad = (angle * Math.PI) / 180;
  return {
    index,
    name,
    number: String(index + 1).padStart(2, '0'),
    x: Math.sin(rad) * 5000,
    z: -Math.cos(rad) * 5000,
    yaw: -angle,
  };
});
function place(
  bay: (typeof galleryBays)[number],
  x: number,
  y: number,
  offset = 0
) {
  const angle = (bay.yaw * Math.PI) / 180;
  return {
    x: bay.x + Math.cos(angle) * x + Math.sin(angle) * offset,
    y,
    z: bay.z - Math.sin(angle) * x + Math.cos(angle) * offset,
    yaw: bay.yaw,
  };
}
const zones = [
  [
    'gestures',
    'enter',
    'presence',
    'keyframes',
    'path',
    'pointer',
    'stagger',
    'trail',
    'circle-loop',
  ],
  [
    'tabs',
    'layout',
    'lists',
    'reorder',
    'grid',
    'inline-edit',
    'lightbox',
    'split',
  ],
  [
    'inbox',
    'far',
    'crossing',
    'escort',
    'interrupt',
    'sequence',
    'wires',
    'jump',
  ],
  ['parallax', 'reveal', 'drift', 'hang', 'header', 'fold', 'sheet'],
  ['mockup', 'camera', 'long-take', 'sylva', 'subdivision', 'rack', 'grip'],
  [
    'drag',
    'slides',
    'presentation',
    'towers',
    'sagrada',
    'playhead',
    'build-order',
  ],
];
const ordered = zones.flat().map((id) => catalog.find((d) => d.id === id)!);
if (
  ordered.length !== catalog.length ||
  ordered.some((d) => !d) ||
  new Set(zones.flat()).size !== catalog.length
) {
  throw Error('The gallery must include every catalog demo once');
}
const heights = galleryBays.map(() => [0, 0, 0, 0]);
export const galleryEntries = ordered.map((demo, index) => {
  const bay = zones.findIndex((ids) => ids.includes(demo.id)),
    host = galleryBays[bay]!,
    columns = heights[bay]!;
  const [width, height] = shapes[demo.id] ?? [480, 360],
    span = width > 480 ? 2 : 1;
  let column = 0,
    best = Infinity;
  for (let c = 0; c <= 4 - span; c++) {
    const top = Math.max(...columns.slice(c, c + span));
    if (top < best) {
      best = top;
      column = c;
    }
  }
  const outerHeight = height + 60;
  for (let c = column; c < column + span; c++) {
    columns[c] = best + outerHeight + 95;
  }
  const pose = place(
    host,
    -1080 + column * 540 + (span * 540 - 60) / 2,
    2220 - best - outerHeight / 2,
    42
  );
  return {
    ...demo,
    index,
    bay,
    width,
    height,
    ...pose,
    style: htmlSafe(
      `${galleryPlane(pose.x, pose.y, pose.z, pose.yaw, 0, 4)}--tile-w:${width / 4}px;--tile-h:${height / 4}px;`
    ),
  };
});
function surface(
  name: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  yaw = 0,
  pitch = 0
) {
  return {
    name,
    style: htmlSafe(
      `${galleryPlane(x, y, z, yaw, pitch, 20)}width:${width / 20}px;height:${height / 20}px;`
    ),
  };
}
// Tangent wall panels meet at the 28-degree bay joints without overlapping fins.
const wallWidth = 2 * 5000 * Math.tan((14 * Math.PI) / 180);
const floorY =
  Math.min(
    -55,
    ...galleryEntries.map((tile) => tile.y - tile.height / 2 - 48)
  ) - 160;
const wallTop = 2920;
export const galleryArchitecture = [
  surface('stone-floor', 0, floorY, 0, 15000, 18000, 0, -90),
  surface('timber-inlay', 0, floorY + 7, -1400, 2900, 7400, 0, -90),
  surface('runner-line', -1550, floorY + 12, -700, 12, 7700, 0, -90),
  surface('runner-line', 1550, floorY + 12, -700, 12, 7700, 0, -90),
  ...galleryBays.flatMap((bay) => {
    const glow = place(bay, 0, 2750, 12);
    const foot = place(bay, 0, floorY + 4, 700);
    return [
      surface(
        'plaster',
        bay.x,
        (wallTop + floorY) / 2,
        bay.z,
        wallWidth,
        wallTop - floorY,
        bay.yaw
      ),
      surface('wall-wash', glow.x, glow.y, glow.z, 2200, 340, bay.yaw),
      surface('light-slot', glow.x, 2820, glow.z, 2200, 10, bay.yaw),
      surface('floor-wash', foot.x, foot.y, foot.z, 1700, 1700, 0, -90),
    ];
  }),
  surface('entry-fin', -3950, 1300, 1600, 2400, 2700, 58),
];
const disciplines = [
  'UX MOTION',
  'UX CONTINUITY',
  'CHOREOGRAPHY',
  'SCROLL & CONTENT',
  'SPATIAL COMPUTING',
  'FILMMAKING',
];
export const gallerySigns = galleryBays.map((bay) => {
  // 2160 × 216 world units: bottom 2412, clear of the tile rail at 2220.
  // The sign is mounted 26 units off its own wall, behind the tile faces at 42.
  const p = place(bay, 0, 2520, 26);
  return {
    ...bay,
    discipline: disciplines[bay.index],
    style: htmlSafe(galleryPlane(p.x, p.y, p.z, p.yaw, 0, 4)),
  };
});
export const galleryHome = {
  look: { x: 0, y: 1150, z: -2900 },
  dolly: 1.05,
  yaw: 8,
  pitch: 5,
  x: 0,
  y: 0,
};
export const galleryBrandStyle = htmlSafe(
  galleryPlane(-3950, 1450, 1690, 58, 0, 4)
);
export const galleryFloorMark = htmlSafe(
  galleryPlane(0, floorY + 20, 550, 0, -90, 8)
);
