import coreElements from '../content/guides/core-elements.md?raw';
import coreInput from '../content/guides/core-input.md?raw';
import coreLayout from '../content/guides/core-layout.md?raw';
import corePresence from '../content/guides/core-presence.md?raw';
import coreStart from '../content/guides/core-start.md?raw';
import coreTesting from '../content/guides/core-testing.md?raw';
import filmAudio from '../content/guides/film-audio.md?raw';
import filmClock from '../content/guides/film-clock.md?raw';
import filmDelivery from '../content/guides/film-delivery.md?raw';
import filmShots from '../content/guides/film-shots.md?raw';
import filmStart from '../content/guides/film-start.md?raw';
import interactiveBeacons from '../content/guides/interactive-beacons.md?raw';
import interactiveStart from '../content/guides/interactive-start.md?raw';
import interactiveTimelines from '../content/guides/interactive-timelines.md?raw';
import spatialCameras from '../content/guides/spatial-cameras.md?raw';
import spatialDom from '../content/guides/spatial-dom.md?raw';
import spatialGallery from '../content/guides/spatial-gallery.md?raw';
import spatialStart from '../content/guides/spatial-start.md?raw';
import { demoGuides } from './demo-guides';
import { referenceGuides } from './guide-reference';

export interface Guide {
  demo?: { id: string; instruction: string; title: string };
  section: string;
  slug: string;
  source: string;
  summary: string;
  title: string;
}

export const guideSections = [
  {
    id: 'core',
    number: '01',
    title: 'Core glimmer-motion',
    summary:
      'Animate the elements you already have. Learn targets, springs, presence, layout, and gestures.',
    start: 'core-start',
    tags: 'ELEMENTS · LAYOUT · INPUT',
  },
  {
    id: 'interactive',
    number: '02',
    title: 'Interactive Choreo',
    summary:
      'Give an interaction a shared timeline. Coordinate changesets, regions, semantic actions, and interactive timelines.',
    start: 'interactive-start',
    tags: 'STATE · SEQUENCES · SPACE',
  },
  {
    id: 'spatial',
    number: '03',
    title: 'Spatial & 3D Choreo',
    summary:
      'Put real interfaces in space. Work with cameras, live DOM planes, room design, and interactive exhibits.',
    start: 'spatial-start',
    tags: 'CAMERAS · DOM · GALLERIES',
  },
  {
    id: 'film',
    number: '04',
    title: 'Recorded & Film Choreo',
    summary:
      'Turn a scene into a repeatable presentation. Direct the camera, connect narration, and render a film.',
    start: 'film-start',
    tags: 'CLOCKS · SHOTS · DELIVERY',
  },
];

function guide(
  slug: string,
  source: string,
  summary: string,
  demo?: Guide['demo']
): Guide {
  return {
    slug,
    source,
    summary,
    section: slug.split('-')[0]!,
    title: source.match(/^# (.+)/)?.[1] ?? slug,
    demo,
  };
}

const introductoryGuides = [
  guide(
    'core-start',
    coreStart,
    'Install the library and make your first element appear.',
    {
      id: 'enter',
      title: 'An entrance on real content',
      instruction:
        'Replay the example to watch the entrance. Change playback speed to inspect the timing.',
    }
  ),
  guide(
    'core-elements',
    coreElements,
    'Connect tracked state to targets and choose a transition.',
    {
      id: 'keyframes',
      title: 'Targets over time',
      instruction:
        'Watch position, shape, and color change together. Try half speed to see the keyframes.',
    }
  ),
  guide(
    'core-presence',
    corePresence,
    'Keep leaving items mounted until their exit finishes.',
    {
      id: 'presence',
      title: 'Three ways to leave',
      instruction:
        'Use the example’s controls to compare how arrivals and departures overlap.',
    }
  ),
  guide(
    'core-layout',
    coreLayout,
    'Animate changes to bounds and connect shared identities.',
    {
      id: 'layout',
      title: 'Layout becomes movement',
      instruction:
        'Click the card to change its layout. The real element travels between its measured bounds.',
    }
  ),
  guide('core-input', coreInput, 'Respond to hover, press, drag, and scroll.', {
    id: 'gestures',
    title: 'A spring you can feel',
    instruction:
      'Hover, press, or keyboard-focus the globe. Enable Override, then adjust bounce and press scale to compare the response.',
  }),
  guide(
    'core-testing',
    coreTesting,
    'Honor reduced motion and test observable outcomes.'
  ),
  guide(
    'interactive-start',
    interactiveStart,
    'Understand participants, identity, roles, and changesets.',
    {
      id: 'sequence',
      title: 'One action, a coordinated response',
      instruction:
        'Use the demo’s controls to change the scene. Watch which steps wait and which overlap.',
    }
  ),
  guide(
    'interactive-timelines',
    interactiveTimelines,
    'Compose sequences and parallel steps over a render pass.',
    {
      id: 'interrupt',
      title: 'Change your mind mid-flight',
      instruction:
        'Trigger the next state before movement finishes. Choreo should continue from the visible state.',
    }
  ),
  guide(
    'interactive-beacons',
    interactiveBeacons,
    'Move to a destination and transfer identity between regions.',
    {
      id: 'inbox',
      title: 'A destination, not a replacement',
      instruction:
        'Archive a message and watch it travel toward the destination while other rows move.',
    }
  ),
  guide(
    'spatial-start',
    spatialStart,
    'Place live DOM in a camera-directed three-dimensional scene.',
    {
      id: 'mockup',
      title: 'Real UI in a spatial frame',
      instruction:
        'Switch the example to 3D, then interact with the screen. The controls remain real DOM.',
    }
  ),
  guide(
    'spatial-cameras',
    spatialCameras,
    'Direct a camera without introducing a second animation clock.',
    {
      id: 'camera',
      title: 'Frame the subject',
      instruction:
        'Move between subjects and compare the framing before changing the camera settings.',
    }
  ),
  guide(
    'spatial-dom',
    spatialDom,
    'Project real controls into the scene and keep their hit targets aligned.',
    {
      id: 'long-take',
      title: 'A live screen in a moving device',
      instruction:
        'Explore the device and its screen. Its interface remains real DOM as the framing changes.',
    }
  ),
  guide(
    'spatial-gallery',
    spatialGallery,
    'Design a room, allocate exhibit sizes, and manage active rendering work.'
  ),
  guide(
    'film-start',
    filmStart,
    'Choose a transport or a complete film composition.',
    {
      id: 'presentation',
      title: 'An interface becomes a presentation',
      instruction:
        'Play the presentation and inspect how one timeline coordinates its parts.',
    }
  ),
  guide(
    'film-clock',
    filmClock,
    'Give an external clock explicit ownership of selected runs.',
    {
      id: 'playhead',
      title: 'The same moment, on demand',
      instruction:
        'Play, pause, and scrub the demo. Seek backward to check that the same time reconstructs the same result.',
    }
  ),
  guide(
    'film-shots',
    filmShots,
    'Organize a picture into shots, chapters, and camera moves.',
    {
      id: 'camera',
      title: 'Direct the viewer’s attention',
      instruction:
        'Use the camera controls to move between subjects. The scene remains the same as the framing changes.',
    }
  ),
  guide(
    'film-audio',
    filmAudio,
    'Connect separate narration clips and readable overlays.'
  ),
  guide(
    'film-delivery',
    filmDelivery,
    'Review deterministic frames and deploy the complete experience.'
  ),
];

export const guides: Guide[] = guideSections.flatMap((section) => [
  ...introductoryGuides.filter((item) => item.section === section.id),
  ...referenceGuides.filter((item) => item.section === section.id),
  ...demoGuides.filter((item) => item.section === section.id),
]);

export function findGuide(slug: string) {
  return guides.find(
    (item) =>
      item.slug === (slug === 'interactive-spatial' ? 'spatial-start' : slug)
  );
}
