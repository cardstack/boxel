import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';
import { cameraCss, objectCss, perspective } from 'test-app/lib/css3d';
import type * as THREE from 'three';

/**
 * SPIKE 2 — mockup-studio's GLB in WebGL, and the phone's SCREEN as live
 * DOM, mapped onto the mesh by the one piece of ember-lume /
 * CSS3DRenderer worth taking: the coordinate mapping (`app/lib/css3d.ts`).
 *
 * mockup-studio paints its screen into a canvas and uploads it as a
 * texture, so the UI is pixels. Here the same mesh is rendered by WebGL
 * and the screen is real DOM — clickable, animating, and the same markup
 * in both 2D and 3D. That is the whole claim, and the segmented control
 * exists so the two can be put side by side.
 *
 * Nothing here uses `<Choreo>`. The point of this demo is the 3D, and an
 * icon that grows into an app is more precisely done by naming both
 * poses than by measuring them: see `panel` below.
 */

/** the DOM screen is authored at a real iPhone's logical resolution */
const SCREEN = { h: 844, w: 390 };
/** the home screen, in that resolution's own pixels */
const TILE = 82;
const RADIUS = { app: 46, tile: 20 };
const PAD = 34;
const GAP = (SCREEN.w - PAD * 2 - TILE * 3) / 2;
const ROW = [96, 236];

/**
 * The grid is AUTHORED, not measured. Every tile's box is a constant in
 * the screen's own coordinates, so the panel that grows out of a tile
 * reads its from-box from arithmetic — no `getBoundingClientRect`, and
 * therefore nothing a camera, a perspective or a 54° tilt can make
 * wrong. It is also why the home screen never moves: the icons are
 * placed absolutely and the app is an overlay, so opening one changes no
 * other element's layout at all.
 */
const APPS = [
  { hue: 8, id: 'mail', label: 'Mail' },
  { hue: 140, id: 'notes', label: 'Notes' },
  { hue: 210, id: 'maps', label: 'Maps' },
  { hue: 275, id: 'music', label: 'Music' },
  { hue: 32, id: 'photos', label: 'Photos' },
  { hue: 190, id: 'clock', label: 'Clock' },
].map((app, i) => ({
  ...app,
  x: PAD + (i % 3) * (TILE + GAP),
  y: ROW[Math.floor(i / 3)]!,
}));
type App = (typeof APPS)[number];

/**
 * Quick out, long settle, no overshoot to wobble the type — and opacity
 * on its own much shorter clock. Faded across the whole growth the panel
 * is a ghost with the home screen showing through it for half a second;
 * opaque by the time it has left the tile, it reads as the tile itself
 * getting bigger.
 */
const SWELL = {
  duration: 0.5,
  ease: [0.22, 1, 0.36, 1],
  opacity: { duration: 0.12, ease: 'linear' },
} as const;
const FADE = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;

interface SpikeWindow extends Window {
  __glb?: unknown;
}

export class MockupGlb extends Component {
  @tracked open: App | null = null;
  /** which tile the panel is parked on while closed */
  @tracked parked: App = APPS[0]!;
  /** 2D by default: the 3D engine is not downloaded until it is asked for */
  @tracked mode: '2d' | '3d' = '2d';
  @tracked status = 'flat — the same DOM, no engine loaded';

  private boot?: () => Promise<void>;
  private halt?: () => void;

  readonly apps = APPS;
  readonly screen = SCREEN;

  choose = (app: App) => {
    this.parked = app;
    this.open = app;
  };

  close = () => {
    this.open = null;
  };

  setMode = (mode: '2d' | '3d') => {
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    if (mode === '3d') {
      void this.boot?.();
    } else {
      this.halt?.();
      this.status = 'flat — the same DOM, no engine loaded';
    }
  };

  isMode = (mode: '2d' | '3d') => this.mode === mode;

  /**
   * The app panel, as one `{{motion}}` target. Open is the whole screen;
   * closed is exactly the tile it came from — both read off the authored
   * constants above, so the two poses are known numbers rather than a
   * measurement taken through a 3D camera. The corner radius travels
   * with the box, which is what sells it as the tile GROWING rather than
   * a card appearing over it.
   */
  get panel() {
    const app = this.open;
    return app
      ? {
          borderRadius: RADIUS.app,
          height: SCREEN.h,
          left: 0,
          opacity: 1,
          top: 0,
          width: SCREEN.w,
        }
      : {
          borderRadius: RADIUS.tile,
          height: TILE,
          left: this.parked.x,
          opacity: 0,
          top: this.parked.y,
          width: TILE,
        };
  }

  /** the app's own title: it FADES. It is never the icon's label morphed. */
  get title() {
    return { opacity: this.open ? 1 : 0 };
  }

  get shown() {
    return this.open ?? this.parked;
  }

  stage = modifier((host: HTMLElement) => {
    const canvas = host.querySelector('canvas')!;
    const layer = host.querySelector<HTMLElement>('.mg-css')!;
    const cam = host.querySelector<HTMLElement>('.mg-cam')!;
    const plane = host.querySelector<HTMLElement>('.mg-plane')!;

    let raf = 0;
    let running = false;
    let built = false;
    let building = false;
    let ready = false;
    let rx = -0.12;
    let ry = Math.PI + 0.3;
    let dispose: (() => void) | undefined;

    /**
     * Everything 3D lives behind this. `three` plus a GLTF loader, a
     * DRACO decoder and an environment is a megabyte and a half of
     * JavaScript and another of model and decoder — none of which a
     * visitor looking at the flat screen has any use for. It is fetched
     * on the first press of "3D" and never again.
     */
    const build = async () => {
      if (built || building) {
        return;
      }
      building = true;
      this.status = 'fetching the 3D engine…';
      const [T, { RoomEnvironment }, { DRACOLoader }, { GLTFLoader }] =
        await Promise.all([
          import('three'),
          import('three/examples/jsm/environments/RoomEnvironment.js'),
          import('three/examples/jsm/loaders/DRACOLoader.js'),
          import('three/examples/jsm/loaders/GLTFLoader.js'),
        ]);

      const renderer = new T.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
      });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      const scene = new T.Scene();
      const pmrem = new T.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;

      /**
       * A SEPARATE environment for the glass alone: a plain vertical
       * gradient, no geometry in it at all. A room reflects as
       * recognisable boxes, and a phone screen with furniture in it is a
       * picture of a phone rather than a screen you are meant to read. A
       * gradient reflected sharply is still a hard-edged sheen — glossy,
       * not matte — but there is nothing in it to look at.
       */
      const sky = document.createElement('canvas');
      sky.width = 4;
      sky.height = 256;
      const sctx = sky.getContext('2d')!;
      const grad = sctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.34, '#c9d4e4');
      grad.addColorStop(0.52, '#39414f');
      grad.addColorStop(1, '#0b0d12');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 4, 256);
      const skyTex = new T.CanvasTexture(sky);
      skyTex.mapping = T.EquirectangularReflectionMapping;
      const skyEnv = pmrem.fromEquirectangular(skyTex).texture;

      const camera = new T.PerspectiveCamera(38, 1, 1, 20000);
      camera.position.set(0, 0, 1500);

      scene.add(new T.AmbientLight(0xffffff, 1.05));
      // OVERHEAD. A key light off to the side rakes across the glass and
      // puts its highlight over the middle of the screen; from above, the
      // sheen sits at the top of the panel where a real room light would
      // put it, and the UI keeps the rest.
      const key = new T.DirectionalLight(0xffffff, 2.3);
      key.position.set(0, 1800, 620);
      scene.add(key);
      const fill = new T.DirectionalLight(0x9fc4ff, 0.85);
      fill.position.set(-900, 500, -700);
      scene.add(fill);

      /** everything the pointer orbits */
      const pivot = new T.Object3D();
      scene.add(pivot);
      /** the screen's own frame: what the DOM plane is pinned to */
      const anchor = new T.Object3D();
      pivot.add(anchor);

      const draco = new DRACOLoader().setDecoderPath('/draco/');
      const loader = new GLTFLoader().setDRACOLoader(draco);
      await new Promise<void>((resolve) => {
        loader.load('/models/iphone-15-pro.glb', (gltf) => {
          const model = gltf.scene;
          model.updateMatrixWorld(true);

          // THE SCREEN, found by geometry — this GLB's node names are
          // obfuscated (`xXDHkMplTIDAXLN`), so mockup-studio's own name
          // list never matches it either and it falls back to a heuristic
          // too. The display is the flattest large panel whose aspect is
          // a phone's: 2.510 / 1.162 = 2.161, against the iPhone 15 Pro's
          // 2556/1179 = 2.168. The glass cover sits just in front of it
          // and is a shade wider, which is what the ratio separates.
          const PHONE_ASPECT = 2556 / 1179;
          const whole = new T.Box3()
            .setFromObject(model)
            .getSize(new T.Vector3());
          let best: { box: THREE.Box3; mesh: THREE.Mesh; miss: number } | null =
            null;
          model.traverse((child) => {
            if (!(child as THREE.Mesh).isMesh) {
              return;
            }
            const mesh = child as THREE.Mesh;
            const box = new T.Box3().setFromObject(mesh);
            const v = box.getSize(new T.Vector3());
            if (v.z > whole.z * 0.08 || v.x < whole.x * 0.7) {
              return;
            }
            const miss = Math.abs(v.y / v.x - PHONE_ASPECT);
            if (!best || miss < best.miss) {
              best = { box, mesh, miss };
            }
          });
          if (!best) {
            this.status = 'no screen mesh found';
            resolve();
            return;
          }
          const found = best as {
            box: THREE.Box3;
            mesh: THREE.Mesh;
            miss: number;
          };

          // EVERY MEASUREMENT BELOW HAPPENS WITH THE ORBIT AT REST. A
          // Box3 is world-space and axis-aligned, so measuring the
          // display under a rotated pivot returns the bounding box of the
          // ROTATED panel — centre and front face both wrong, and wrong
          // by more the further the phone is turned.
          pivot.rotation.set(0, 0, 0);
          pivot.updateMatrixWorld(true);

          // ONE WORLD UNIT IS ONE CSS PIXEL. `perspective` and the
          // camera's translateZ are written in px, so a scene authored at
          // "2.6 units for a whole phone" projects nothing like the WebGL
          // one. It looks nearly right at small angles, which is the
          // trap. Scale the model until the display is exactly as wide as
          // the DOM screen and every matrix below is in pixels.
          const raw = found.box.getSize(new T.Vector3());
          model.scale.multiplyScalar(SCREEN.w / raw.x);
          pivot.add(model);
          pivot.updateMatrixWorld(true);
          const bounds = new T.Box3().setFromObject(model);
          model.position.sub(bounds.getCenter(new T.Vector3()));
          pivot.updateMatrixWorld(true);

          const box = new T.Box3().setFromObject(found.mesh);
          const dims = box.getSize(new T.Vector3());
          const centre = box.getCenter(new T.Vector3());
          // FLUSH: exactly ON the display's front face (this model faces
          // -Z). There is no z-fighting to avoid — the DOM is on the CSS
          // layer and never enters the depth buffer — and any offset at
          // all is parallax you see the moment the phone turns.
          anchor.position.set(centre.x, centre.y, box.min.z);
          anchor.rotation.y = Math.PI;
          plane.style.width = `${SCREEN.w}px`;
          plane.style.height = `${Math.round(dims.y)}px`;

          // THE GLASS. Lume's `<lume-mixed-plane>` is a
          // MeshPhysicalMaterial with `blending: NoBlending` — the whole
          // trick, because NoBlending writes the material's RGB *and its
          // alpha* straight into the framebuffer, replacing the opaque
          // body fragments already drawn there. The canvas becomes a hole
          // the shape of the display and the DOM beneath shows through.
          // With NoBlending the alpha written IS this opacity, uniformly,
          // so every point of tint is a point of haze over the UI: clear
          // glass wants it near zero.
          found.mesh.material = new T.MeshPhysicalMaterial({
            blending: T.NoBlending,
            clearcoat: 1,
            clearcoatRoughness: 0.02,
            color: 0x05070b,
            metalness: 0,
            opacity: 0.06,
            roughness: 0.02,
            transparent: true,
          });

          // THE REFLECTION, as its own pass, because clear glass can only
          // be as bright as its alpha. Plain AdditiveBlending adds the
          // source alpha too and the canvas turns opaque; CustomBlending
          // separates them — RGB One+One, alpha Zero+One — so it adds
          // light without adding cover. It reflects the gradient, not the
          // room, and `color` on a metal multiplies what comes back, so
          // that is the one dial for how much sheen there is.
          const glare = found.mesh.clone();
          glare.material = new T.MeshPhysicalMaterial({
            blendDst: T.OneFactor,
            blendDstAlpha: T.OneFactor,
            blendSrc: T.OneFactor,
            blendSrcAlpha: T.ZeroFactor,
            blending: T.CustomBlending,
            color: 0x2b3038,
            depthWrite: false,
            envMap: skyEnv,
            metalness: 1,
            roughness: 0.02,
            transparent: true,
          });
          found.mesh.parent?.add(glare);

          ready = true;
          this.status =
            `iPhone 15 Pro GLB · screen "${found.mesh.name}" · ` +
            `${SCREEN.w}×${Math.round(dims.y)} css px = ` +
            `${dims.x.toFixed(1)}×${dims.y.toFixed(1)} world · 1:1`;
          resolve();
        });
      });

      const tick = () => {
        raf = requestAnimationFrame(tick);
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (renderer.domElement.width !== w || camera.aspect !== w / h) {
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }
        pivot.rotation.set(rx, ry, 0);
        pivot.updateMatrixWorld(true);
        renderer.render(scene, camera);
        if (!ready) {
          return;
        }
        // ── the whole mapping, three lines ────────────────────────────
        const focal = perspective(camera.projectionMatrix.elements, h);
        layer.style.perspective = `${focal}px`;
        cam.style.transform = cameraCss(
          camera.matrixWorldInverse.elements,
          focal,
          w,
          h
        );
        plane.style.transform = objectCss(anchor.matrixWorld.elements);
      };

      dispose = () => {
        cancelAnimationFrame(raf);
        raf = 0;
        renderer.dispose();
      };
      built = true;
      building = false;
      if (running) {
        tick();
      }
      (window as SpikeWindow).__glb = {
        close: () => {
          this.open = null;
        },
        look: (x: number, y: number) => {
          rx = x;
          ry = y;
        },
        open: (id: string) => {
          const app = APPS.find((a) => a.id === id);
          if (app) {
            this.choose(app);
          }
        },
        plane: () => plane.getBoundingClientRect().toJSON(),
      };
      const loop = () => {
        if (running && !raf) {
          tick();
        }
      };
      loop();
    };

    // orbit — only meaningful in 3D, and harmless otherwise
    let down: { x: number; y: number } | null = null;
    const grab = (ev: PointerEvent) => {
      if ((ev.target as Element).closest('.mg-plane, .mg-seg')) {
        return; // the screen is UI, and so is the switch
      }
      down = { x: ev.clientX, y: ev.clientY };
      host.setPointerCapture(ev.pointerId);
    };
    const move = (ev: PointerEvent) => {
      if (!down) {
        return;
      }
      ry += (ev.clientX - down.x) * 0.008;
      rx += (ev.clientY - down.y) * 0.008;
      rx = Math.max(-0.9, Math.min(0.9, rx));
      down = { x: ev.clientX, y: ev.clientY };
    };
    const up = () => (down = null);
    host.addEventListener('pointerdown', grab);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);

    this.boot = async () => {
      running = true;
      await build();
    };
    this.halt = () => {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      // hand the plane back to CSS: in 2D it is an ordinary centred box
      layer.style.perspective = '';
      cam.style.transform = '';
      plane.style.transform = '';
    };

    return () => {
      this.halt?.();
      dispose?.();
      host.removeEventListener('pointerdown', grab);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      delete (window as SpikeWindow).__glb;
      this.boot = undefined;
      this.halt = undefined;
    };
  });

  <template>
    <div class="mg-page">
      <div class="mg-stage" data-mode={{this.mode}} {{this.stage}}>
        <canvas></canvas>

        <div class="mg-css">
          <div class="mg-cam">
            <div class="mg-plane">
              <div class="mg-screen">
                {{! the home screen. Absolutely placed at authored
                    coordinates, so it never reflows and never moves —
                    opening an app changes no other element's box. }}
                {{#each this.apps as |app|}}
                  <button
                    type="button"
                    class="mg-icon"
                    data-app={{app.id}}
                    style="--hue:{{app.hue}};left:{{app.x}}px;top:{{app.y}}px"
                    {{on "click" (fn this.choose app)}}
                  >
                    <span class="mg-tile"></span>
                    <span class="mg-icon-name">{{app.label}}</span>
                  </button>
                {{/each}}

                {{! the app: ONE element, two named poses, and the corner
                    radius travelling with the box }}
                <button
                  type="button"
                  class="mg-app"
                  style="--hue:{{this.shown.hue}}"
                  {{on "click" this.close}}
                  {{motion animate=this.panel transition=SWELL}}
                >
                  <span
                    class="mg-app-name"
                    {{motion animate=this.title transition=FADE}}
                  >{{this.shown.label}}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {{! the switch, on the platter — 3D is not downloaded until it is
            pressed, so the flat page costs nothing }}
        <div class="mg-seg" role="group" aria-label="Presentation">
          <button
            type="button"
            aria-pressed="{{this.isMode '2d'}}"
            {{on "click" (fn this.setMode "2d")}}
          >2D</button>
          <button
            type="button"
            aria-pressed="{{this.isMode '3d'}}"
            {{on "click" (fn this.setMode "3d")}}
          >3D</button>
        </div>
      </div>
      <p class="mg-status">{{this.status}}</p>

      <style>
        .mg-page {
          padding: 24px;
          font:
            12px/1.4 ui-monospace,
            monospace;
        }
        .mg-stage {
          position: relative;
          width: 100%;
          height: 640px;
          touch-action: none;
        }
        .mg-stage[data-mode="3d"] {
          cursor: grab;
        }
        .mg-stage canvas {
          position: absolute;
          inset: 0;
          z-index: 1;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }
        .mg-stage[data-mode="2d"] canvas {
          display: none;
        }
        .mg-css {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .mg-cam {
          position: absolute;
          inset: 0;
          transform-style: preserve-3d;
        }
        .mg-plane {
          position: absolute;
          top: 0;
          left: 0;
          transform-style: preserve-3d;
          pointer-events: auto;
        }
        /* 2D: no camera, no matrices — the same plane, centred by CSS,
           inside a plain bezel so the comparison is like for like */
        .mg-stage[data-mode="2d"] .mg-plane {
          top: 50%;
          left: 50%;
          width: 390px;
          height: 844px;
          transform: translate(-50%, -50%) scale(0.66);
          border-radius: 62px;
          padding: 14px;
          background: #15171c;
          box-shadow:
            0 0 0 2px #3a3d45 inset,
            0 30px 60px -20px #0007;
        }
        .mg-screen {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: 46px;
          background: #0d1220;
        }
        .mg-stage[data-mode="2d"] .mg-screen {
          inset: 14px;
          border-radius: 50px;
        }
        /* it is a phone screen, not a document: a drag across it is a
           gesture, never a text selection */
        .mg-plane,
        .mg-screen,
        .mg-icon,
        .mg-icon-name,
        .mg-app,
        .mg-app-name {
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
        }
        .mg-icon {
          all: unset;
          cursor: pointer;
          position: absolute;
          width: 82px;
          display: grid;
          justify-items: center;
          gap: 9px;
        }
        .mg-tile {
          display: block;
          width: 82px;
          height: 82px;
          border-radius: 20px;
          background: linear-gradient(
            150deg,
            hsl(var(--hue) 78% 62%),
            hsl(var(--hue) 70% 42%)
          );
        }
        .mg-icon-name {
          color: #dfe4f2;
          font-size: 15px;
          font-family: ui-sans-serif, system-ui;
        }
        .mg-app {
          all: unset;
          cursor: pointer;
          position: absolute;
          overflow: hidden;
          display: grid;
          place-items: center;
          background: linear-gradient(
            150deg,
            hsl(var(--hue) 78% 62%),
            hsl(var(--hue) 70% 42%)
          );
        }
        .mg-app-name {
          color: #fff;
          font-size: 40px;
          font-weight: 600;
          font-family: ui-sans-serif, system-ui;
        }
        .mg-seg {
          position: absolute;
          top: 0;
          right: 0;
          z-index: 3;
          display: flex;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid #c9c6bd;
          background: #fbf9f5;
        }
        .mg-seg button {
          all: unset;
          cursor: pointer;
          padding: 5px 14px;
          font:
            600 12px/1 ui-monospace,
            monospace;
          color: #6b6960;
        }
        .mg-seg button[aria-pressed="true"] {
          background: #22242a;
          color: #f6f4ef;
        }
        .mg-status {
          color: #889;
          margin-top: 12px;
        }
      </style>
    </div>
  </template>
}

export default MockupGlb;
