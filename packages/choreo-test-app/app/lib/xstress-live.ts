/**
 * Live innards for the stress-test plate. Not Choreo participants — they
 * ride inside the kept hero and keep running while it flies. CSS loops on
 * the hero itself freeze during a crossing (they would fight the flight
 * transform); a <video>, a WebGL field, and an overflow pane do not.
 */
import { modifier } from 'ember-modifier';
import config from 'test-app/config/environment';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
} from 'three';

const IN_TEST = config.environment === 'test';
const TINTS = [0x1f7c86, 0xc45a24, 0x8b6cff] as const;

function reduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function slideOf(el: Element) {
  const n = el.closest<HTMLElement>('[data-slide]')?.dataset.slide;
  const i = n === '1' ? 1 : n === '2' ? 2 : 0;
  return i;
}

/**
 * A small Points cloud. Keeps drawing during a crossing — that is the
 * stress (WebGL in a transforming ancestor). Reduced-motion holds still.
 */
export const particles = modifier((canvas: HTMLCanvasElement) => {
  // The suite visits this route before integration tests. An infinite rAF
  // plus a live WebGL context will starve later layout springs — skip both
  // in test; the <canvas> still sits in the plate for the stress assertions.
  if (IN_TEST) {
    return;
  }
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      alpha: true,
      antialias: false,
      canvas,
      powerPreference: 'low-power',
    });
  } catch {
    return;
  }
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 20);
  camera.position.z = 3.2;
  const count = reduced() ? 28 : 96;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    positions[o] = (Math.random() - 0.5) * 3.2;
    positions[o + 1] = (Math.random() - 0.5) * 3.2;
    positions[o + 2] = (Math.random() - 0.5) * 2.4;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const mat = new PointsMaterial({
    color: new Color(TINTS[0]),
    opacity: 0.82,
    size: 0.07,
    sizeAttenuation: true,
    transparent: true,
  });
  const cloud = new Points(geo, mat);
  scene.add(cloud);

  let raf = 0;
  let alive = true;
  const tick = () => {
    if (!alive) {
      return;
    }
    const box = canvas.getBoundingClientRect();
    if (box.width > 2 && box.height > 2) {
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(box.width, box.height, false);
      camera.aspect = box.width / box.height;
      camera.updateProjectionMatrix();
    }
    mat.color.setHex(TINTS[slideOf(canvas)]);
    if (!reduced()) {
      cloud.rotation.y += 0.007;
      cloud.rotation.x += 0.0024;
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    geo.dispose();
    mat.dispose();
    renderer.dispose();
  };
});

/**
 * muted autoplay is allowed; still kick it in case the browser waited.
 */
export const playClip = modifier((video: HTMLVideoElement) => {
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  if (IN_TEST || reduced()) {
    video.pause();
    return;
  }
  const kick = () => {
    video.play().catch(() => {
      /* autoplay can still refuse; the element is the stress, not the decode */
    });
  };
  kick();
  video.addEventListener('canplay', kick);
  return () => video.removeEventListener('canplay', kick);
});

/**
 * Auto-scrolls a real overflow pane (scrollTop, not a translate loop) so a
 * cut can land mid-scroll. Reduced-motion leaves it still.
 */
export const liveScroll = modifier((el: HTMLElement) => {
  if (IN_TEST || reduced()) {
    return;
  }
  let raf = 0;
  let alive = true;
  const step = () => {
    if (!alive) {
      return;
    }
    const max = el.scrollHeight - el.clientHeight;
    if (max > 1) {
      const next = el.scrollTop + 0.45;
      el.scrollTop = next >= max - 0.5 ? 0 : next;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
  };
});
