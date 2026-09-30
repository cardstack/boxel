/**
 * Live innards for the stress-test plate. Not Choreo participants — they
 * ride inside the kept hero and keep running while it flies. CSS loops on
 * the hero itself freeze during a crossing (they would fight the flight
 * transform); a <video> and an overflow pane do not. The three.js field is
 * a slow drift over the slide ground, not in the plate — a hitch in the
 * Magic Move would freeze it.
 */
import { modifier } from 'ember-modifier';
import config from 'test-app/config/environment';
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
} from 'three';

const IN_TEST = config.environment === 'test';
const TINTS = [0x73ffe8, 0xff7a2e, 0xc79bff] as const;

/** ~16°/s on Y — slow drift; a freeze of a few frames is obvious. */
const SPIN_Y = 0.0046;
const SPIN_X = 0.0015;

function reduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function discMap() {
  const size = 64;
  const g = document.createElement('canvas');
  g.width = size;
  g.height = size;
  const ctx = g.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const map = new CanvasTexture(g);
  map.needsUpdate = true;
  return map;
}

function slideOf(el: Element) {
  const n = el.closest<HTMLElement>('[data-slide]')?.dataset.slide;
  const i = n === '1' ? 1 : n === '2' ? 2 : 0;
  return i;
}

/**
 * three.js Points over the slide ground. Keeps drifting during a crossing
 * so a discontinuity is obvious. Reduced-motion holds still. Skip the
 * rAF/WebGL loop in test — the <canvas> still mounts.
 */
export const particles = modifier((canvas: HTMLCanvasElement) => {
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
  const camera = new PerspectiveCamera(42, 1, 0.1, 24);
  camera.position.z = 4.2;
  const count = reduced() ? 48 : 280;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    positions[o] = (Math.random() - 0.5) * 8.5;
    positions[o + 1] = (Math.random() - 0.5) * 8.5;
    positions[o + 2] = (Math.random() - 0.5) * 5.5;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const map = discMap();
  const mat = new PointsMaterial({
    blending: AdditiveBlending,
    color: new Color(TINTS[0]),
    depthWrite: false,
    map,
    opacity: 0.62,
    size: 0.09,
    sizeAttenuation: true,
    transparent: true,
  });
  const cloud = new Points(geo, mat);
  scene.add(cloud);

  let raf = 0;
  let alive = true;
  const hold = reduced();
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
    if (!hold) {
      cloud.rotation.y += SPIN_Y;
      cloud.rotation.x += SPIN_X;
    }
    canvas.dataset.spin = String(cloud.rotation.y);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    geo.dispose();
    mat.dispose();
    map.dispose();
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
