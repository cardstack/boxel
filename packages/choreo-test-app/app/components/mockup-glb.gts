import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { beacon, motion } from 'glimmer-motion';
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
/** what the home screen throws onto the rails: a cool, dim wash */
const HOME_GLOW = 0x9fb4d6;

/** an app's tile colour as a flat hex, for the light it spills */
const hsl = (hue: number): number => {
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = 0.62 * Math.min(0.7, 1 - 0.7);
    return Math.round(
      255 * (0.7 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
    );
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
};

/** the layer the eye-level key light lives on, and the screen does not */
const EYE_LEVEL = 1;

const SWELL = {
  duration: 0.5,
  ease: [0.22, 1, 0.36, 1],
  // opacity on its own much shorter clock: faded across the whole growth
  // the panel is a ghost with the home screen showing through it
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
  private tint?: (hex: number) => void;

  readonly apps = APPS;
  readonly screen = SCREEN;

  choose = (app: App) => {
    this.parked = app;
    this.open = app;
    this.tint?.(hsl(app.hue));
  };

  close = () => {
    this.open = null;
    this.tint?.(HOME_GLOW);
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
   * THE APP, as two named poses again.
   *
   * The beacon version of this flight was exact in 2D and head-on, and
   * wrong by 42px at a 54° tilt — and it landed on a MEASURED box rather
   * than the CSS one, so the panel jumped at the end of every open. Both
   * are the same fact: a beacon is a page-space measurement, the page is
   * behind a 3D camera, and a projection is not a scale. The tiles still
   * carry their beacons — they cost nothing and the moment beacons are
   * measured in plane-local space this can go straight back.
   *
   * Named poses have no such error at any angle, because there is nothing
   * to measure: open is the screen, closed is the tile, and both are
   * arithmetic on the authored grid.
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
    /** set once the scene exists; re-entry restarts THIS, not the build */
    let tick: (() => void) | undefined;
    let clear: (() => void) | undefined;
    let mapped = '';
    let rx = -0.12;
    let ry = Math.PI + 0.3;
    let dispose: (() => void) | undefined;
    let keyLight: THREE.Object3D | undefined;
    let screenGlow: THREE.RectAreaLight | undefined;

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
      const [T, { RectAreaLightUniformsLib }, { DRACOLoader }, { GLTFLoader }] =
        await Promise.all([
          import('three'),
          import('three/examples/jsm/lights/RectAreaLightUniformsLib.js'),
          import('three/examples/jsm/loaders/DRACOLoader.js'),
          import('three/examples/jsm/loaders/GLTFLoader.js'),
        ]);

      const renderer = new T.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
      });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      // five sources clip to white without it; this is the curve product
      // footage is graded on
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const scene = new T.Scene();
      const pmrem = new T.PMREMGenerator(renderer);

      /**
       * THE ROOM, built rather than borrowed — and there are two of them,
       * for the same reason a real set has flags.
       *
       * A phone is two materials with opposite needs. The titanium wants
       * a BRIGHT room: metal is nothing but the reflection of its
       * surroundings, and in a dark room it reads as painted plastic.
       * The glass wants a DARK one: it is a mirror, so a bright room
       * comes back as a white sheet over the UI and no amount of light
       * tuning fixes it.
       *
       * `RoomEnvironment` is one bright box for everything, which is why
       * it forced a choice between a milky screen and a dead body. On a
       * set you do not choose — you light the product and flag the
       * screen. `scene.environment` is the lit set; the display carries
       * its OWN `envMap`, the same room with the lamps down and a flag
       * across the lens azimuth.
       *
       * Both are painted in equirectangular space: u is the compass with
       * 0 at the lens, v is elevation, top of the canvas is up.
       */
      const cyc = (
        walls: string,
        lamps: [number, number, number, number, string, number][]
      ) => {
        const c = document.createElement('canvas');
        c.width = 1024;
        c.height = 512;
        const g = c.getContext('2d')!;
        const U = c.width;
        const V = c.height;
        g.fillStyle = walls;
        g.fillRect(0, 0, U, V);
        for (const [at, v, w, h, tint, power] of lamps) {
          const cx = ((0.5 + at + 1) % 1) * U;
          const grad = g.createRadialGradient(cx, v * V, 0, cx, v * V, w * U);
          grad.addColorStop(0, tint);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.save();
          g.globalAlpha = power;
          g.translate(cx, v * V);
          g.scale(1, (h * V) / (w * U));
          g.translate(-cx, -(v * V));
          g.fillStyle = grad;
          g.fillRect(0, 0, U, V);
          g.restore();
        }
        const tex = new T.CanvasTexture(c);
        tex.mapping = T.EquirectangularReflectionMapping;
        return pmrem.fromEquirectangular(tex).texture;
      };

      // THE SET, for the body: mid-grey walls so the titanium has
      // something to be, a broad overhead, a tall book light camera-left
      // for the streak down the rail, a warm kicker behind-right, and a
      // table bounce underneath.
      scene.environment = cyc('#3a4049', [
        [0.0, 0.08, 0.5, 0.16, '#ffffff', 1],
        [-0.22, 0.44, 0.16, 0.72, '#e8f0ff', 0.95],
        [0.34, 0.4, 0.14, 0.6, '#ffdcb4', 0.85],
        [0.05, 0.94, 0.4, 0.12, '#aab2c0', 0.6],
      ]);

      // THE FLAGGED ROOM, for the glass: the same set with the lamps
      // down, near-black walls, and NOTHING at the lens azimuth — so the
      // middle of the screen, where the UI is, reflects darkness and the
      // only highlight it carries is the overhead strip near the top.
      const flagged = cyc('#05060a', [
        [0.0, 0.07, 0.34, 0.07, '#ffffff', 0.95],
        [-0.26, 0.4, 0.07, 0.5, '#9fb4d6', 0.5],
        [0.36, 0.38, 0.06, 0.4, '#c9a27a', 0.4],
      ]);

      const camera = new T.PerspectiveCamera(38, 1, 1, 20000);
      camera.position.set(0, 0, 1500);

      /**
       * THE RIG. A product shoot, not a scene: big soft sources for the
       * long specular that runs down a metal rail, a warm kicker to lift
       * the silhouette off the background, and one small hard source for
       * a glint on the camera bump. RectAreaLight is what makes a
       * softbox a softbox — a point light gives a dot, an area light
       * gives the streak.
       */
      RectAreaLightUniformsLib.init();
      /**
       * THE UNITS, on top of the room. The cyc above does the ambient
       * work — what these add is the crisp, directional specular that
       * an image-based light cannot: the hard streak down a rail, the
       * glint off the camera ring.
       */
      scene.add(new T.AmbientLight(0xffffff, 0.18));

      /**
       * KEY, at eye level — and the ONE unit the screen may not see.
       *
       * A source level with the lens reflects off the glass straight back
       * down it, which is a white sheet over the UI rather than a
       * highlight. three.js filters lights per object by LAYER: a light
       * lights an object only when they share one. This one lives alone
       * on layer 1 and every mesh joins layer 1 EXCEPT the display — so
       * it models the body and the glass never sees it. It is the direct
       * equivalent of the black flag painted into the room.
       */
      const key = new T.RectAreaLight(0xffffff, 4.6, 1250, 1650);
      key.position.set(-760, 80, 1120);
      key.lookAt(0, 0, 0);
      key.layers.set(EYE_LEVEL);
      scene.add(key);

      /** overhead strip: the one highlight a glossy screen SHOULD carry.
       *  Long, shallow, high and only just in front, so it mirrors as a
       *  band near the top edge instead of a sheet over the icons. */
      const top = new T.RectAreaLight(0xffffff, 2.4, 1500, 320);
      top.position.set(90, 1950, 240);
      top.lookAt(0, 0, 0);
      scene.add(top);

      /** book light camera-left: the long specular down the titanium */
      const book = new T.RectAreaLight(0xd6e6ff, 2.2, 420, 1500);
      book.position.set(-1150, 380, 520);
      book.lookAt(0, 0, 0);
      scene.add(book);

      /** warm kicker behind-right: the rim that cuts it off the page */
      const kick = new T.RectAreaLight(0xffe0b8, 4.4, 560, 1450);
      kick.position.set(880, 560, -980);
      kick.lookAt(0, 0, 0);
      scene.add(kick);

      /** bounce card low and in front — a big dim source standing in for
       *  the table, so the bottom third is modelled rather than black */
      const bounce = new T.RectAreaLight(0xbfc7d4, 1.1, 1600, 700);
      bounce.position.set(0, -1150, 700);
      bounce.lookAt(0, 0, 0);
      bounce.layers.set(EYE_LEVEL);
      scene.add(bounce);

      /** one hard source for the glint on the camera ring. three counts
       *  point lights in candela, so reaching this far with decay 2 is a
       *  large number by construction, not by taste. */
      const glint = new T.PointLight(0xffffff, 750_000, 0, 2);
      glint.position.set(-360, 1000, 720);
      scene.add(glint);

      /**
       * SCREEN GLOW — the tell that a display is actually on.
       *
       * A lit panel throws its own colour onto everything around it, and
       * on a phone that means the inner bezel and the top of the rails
       * pick up whatever is on screen. So: a source the size of the
       * display, just in front of it, facing back at the phone, tinted
       * by the app that is open. It is on the flagged layer, because the
       * one surface it must NOT light is the glass it is standing on.
       */
      const glow = new T.RectAreaLight(0xffffff, 1.6, SCREEN.w, 843);
      glow.position.set(0, 0, -560);
      glow.lookAt(0, 0, 0);
      glow.layers.set(EYE_LEVEL);
      scene.add(glow);
      screenGlow = glow;
      keyLight = key;

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
          // GLOSSY. The face is smooth glass again — the fix for the
          // white-out was never to sand it down, it was to keep the one
          // eye-level source off it. Everything else in the rig is above,
          // beside or behind, so what it reflects reads as a highlight.
          found.mesh.material = new T.MeshPhysicalMaterial({
            blending: T.NoBlending,
            clearcoat: 1,
            clearcoatRoughness: 0.03,
            color: 0x010206,
            // The glass reflects the room, because that is what glass
            // does — but the room is now a dark cyc with a flag where the
            // lens is, so what comes back is the overhead strip and not a
            // white sheet. Killing the reflection outright (intensity 0)
            // reads like a screen in a void.
            envMap: flagged,
            envMapIntensity: 0.9,
            metalness: 0,
            // AN OLED EMITS; IT IS NOT LIT. Whatever this alpha is, that
            // much of the DOM is replaced by shaded glass — so a tint
            // heavy enough to look like a filter is also a screen with
            // its brightness turned down. Five percent of near-black is
            // depth without dimming.
            opacity: 0.05,
            roughness: 0.05,
            transparent: true,
          });

          // every mesh joins the key light's layer EXCEPT this one
          model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh && child !== found.mesh) {
              child.layers.enable(EYE_LEVEL);
            }
          });

          ready = true;
          mapped =
            `iPhone 15 Pro GLB · screen "${found.mesh.name}" · ` +
            `${SCREEN.w}×${Math.round(dims.y)} css px = ` +
            `${dims.x.toFixed(1)}×${dims.y.toFixed(1)} world · 1:1`;
          this.status = mapped;
          resolve();
        });
      });

      tick = () => {
        raf = requestAnimationFrame(tick!);
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

      // leaving 3D stops the loop, and a stopped canvas keeps its last
      // frame forever — a ghost phone under the flat bezel. Clear it.
      clear = () => renderer.clear();
      dispose = () => {
        cancelAnimationFrame(raf);
        raf = 0;
        renderer.dispose();
      };
      built = true;
      building = false;
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
        /** A/B the exclusion: 1 = off the screen (default), 0 = on it */
        keyLayer: (n: number) => keyLight?.layers.set(n),
      };
    };

    /** idempotent: safe on every entry into 3D, built or not */
    const run3d = async () => {
      running = true;
      await build();
      if (!running || raf || !tick) {
        return;
      }
      host.dataset['ready'] = mapped ? 'yes' : '';
      if (mapped) {
        this.status = mapped;
      }
      tick();
    };

    /**
     * ORBIT, INCLUDING ACROSS THE SCREEN ITSELF. A phone you can only
     * turn by grabbing its bezel is a phone with a dead face, so the
     * whole plane drags — and a press that never moves is still a tap.
     * Four pixels is the whole rule: under it the press was a click and
     * the icon gets it, over it the press was a rotation and the click
     * that follows is swallowed.
     */
    const SLOP = 4;
    let press: { lx: number; ly: number; ox: number; oy: number } | null = null;
    let dragged = false;

    /**
     * NO POINTER CAPTURE, ANYWHERE.
     *
     * Capture was the obvious way to keep a drag alive outside the stage,
     * and it is a trap here twice over. It retargets the `click` that
     * follows to the capture element, so capturing on pointerdown means
     * an icon never hears its own tap. And if the matching `pointerup` is
     * ever missed — the pointer leaves the window, the gesture is
     * cancelled, a drag ends off-target — the host keeps the pointer
     * FOREVER, every later event retargets to it, and no click can reach
     * an icon again for the life of the page. That is the failure this
     * demo actually hit, and it looks exactly like "the glass is eating
     * my clicks" when the glass is innocent.
     *
     * Window listeners give the same reach with none of it: the target of
     * a click stays whatever the pointer is really over.
     */
    const track = (ev: PointerEvent) => {
      if (!press) {
        return;
      }
      if (
        !dragged &&
        Math.hypot(ev.clientX - press.ox, ev.clientY - press.oy) < SLOP
      ) {
        return;
      }
      if (!dragged) {
        dragged = true;
        host.dataset['dragging'] = 'yes';
      }
      ry += (ev.clientX - press.lx) * 0.008;
      rx += (ev.clientY - press.ly) * 0.008;
      rx = Math.max(-0.9, Math.min(0.9, rx));
      press.lx = ev.clientX;
      press.ly = ev.clientY;
    };
    const release = () => {
      press = null;
      delete host.dataset['dragging'];
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    const grab = (ev: PointerEvent) => {
      if (!running) {
        return; // 2D has nothing to orbit
      }
      if ((ev.target as Element).closest('.mg-seg')) {
        return; // the switch is a control, not the scene
      }
      release(); // whatever the last gesture left behind, it ends here
      press = {
        lx: ev.clientX,
        ly: ev.clientY,
        ox: ev.clientX,
        oy: ev.clientY,
      };
      dragged = false;
      window.addEventListener('pointermove', track);
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    };
    // the click arrives AFTER pointerup, so `dragged` is still standing
    // here; swallow it on the way down, before any icon can hear it
    const swallow = (ev: MouseEvent) => {
      if (!dragged) {
        return;
      }
      dragged = false;
      ev.stopPropagation();
      ev.preventDefault();
    };
    host.addEventListener('pointerdown', grab);
    host.addEventListener('click', swallow, true);

    this.tint = (hex: number) => screenGlow?.color.setHex(hex);
    this.boot = run3d;
    this.halt = () => {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      delete host.dataset['ready'];
      clear?.();
      // hand the plane back to CSS: in 2D it is an ordinary centred box
      layer.style.perspective = '';
      cam.style.transform = '';
      plane.style.transform = '';
    };

    return () => {
      this.halt?.();
      dispose?.();
      release();
      host.removeEventListener('pointerdown', grab);
      host.removeEventListener('click', swallow, true);
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
                {{#if (this.isMode "2d")}}
                  <span class="mg-island" aria-hidden="true"></span>
                {{/if}}

                {{! the home screen. Absolutely placed at authored
                    coordinates, so it never reflows and never moves —
                    opening an app changes no other element's box. Each
                    tile still claims a beacon under its own name. }}
                {{#each this.apps as |app|}}
                  <button
                    type="button"
                    class="mg-icon"
                    data-app={{app.id}}
                    style="--hue:{{app.hue}};left:{{app.x}}px;top:{{app.y}}px"
                    {{on "click" (fn this.choose app)}}
                  >
                    <span class="mg-tile" {{beacon app.id}}></span>
                    <span class="mg-icon-name">{{app.label}}</span>
                  </button>
                {{/each}}

                {{! ONE element, two named poses, the corner radius
                    travelling with the box }}
                <div
                  class="mg-app"
                  data-open={{if this.open "yes" ""}}
                  style="--hue:{{this.shown.hue}}"
                  {{motion animate=this.panel transition=SWELL}}
                >
                  <span
                    class="mg-app-name"
                    {{motion animate=this.title transition=FADE}}
                  >{{this.shown.label}}</span>

                  {{! CLOSING IS A GESTURE ON THE HOME BAR, not a tap
                      anywhere on the app. A full-screen close target
                      meant the click that opened an app could be
                      followed by any stray click and the app would shut
                      again before you saw it — which reads exactly like
                      "tapping icons does not work". }}
                  <button
                    type="button"
                    class="mg-home"
                    aria-label="Close {{this.shown.label}}"
                    {{on "click" this.close}}
                  ></button>
                </div>
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
        /* THE SCREEN IS 390x844 IN BOTH MODES. It has to be: the icons
           are placed at authored coordinates in that space, so any inset
           here would put them somewhere else than the 3D phone puts them.
           The rim is therefore drawn OUTSIDE the box with rings, never as
           padding — padding here plus the screen's own inset was insetting
           it twice, and the flat screen came out 368x821, a different
           shape from the one the GLB displays.

           0.656 is not a taste: it is 554/844, the height the 3D plane
           projects to at the default camera, so the switch does not
           resize the phone under you. */
        .mg-stage[data-mode="2d"] .mg-plane {
          top: 50%;
          left: 50%;
          width: 390px;
          height: 844px;
          transform: translate(-50%, -50%) scale(0.656);
          border-radius: 46px;
          box-shadow:
            0 0 0 12px #212429,
            0 0 0 13px #71767f,
            0 0 0 15px #2b2e34,
            0 34px 60px -18px #00000088;
        }
        .mg-screen {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: 46px;
          background: #0d1220;
        }
        .mg-stage[data-mode="2d"] .mg-screen {
          inset: 0;
          border-radius: 46px;
        }
        /* the island, so the flat phone is recognisably the same device
           the GLB draws over the DOM in 3D. It needs a wallpaper behind
           it or it is black type on a black page. */
        .mg-screen {
          background-image:
            radial-gradient(120% 80% at 50% -10%, #2b3350 0%, #0d122000 70%),
            radial-gradient(90% 60% at 20% 110%, #1d2a44 0%, #0d122000 70%);
        }
        .mg-island {
          position: absolute;
          z-index: 2;
          left: 50%;
          top: 13px;
          width: 118px;
          height: 35px;
          border-radius: 18px;
          background: #05070a;
          transform: translateX(-50%);
          pointer-events: none;
        }
        /* it is a phone screen, not a document: a drag across it is a
           gesture, never a text selection */
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
        .mg-app:not([data-open="yes"]) {
          pointer-events: none;
        }
        .mg-app {
          position: absolute;
          overflow: hidden;
          display: grid;
          place-items: center;
          display: grid;
          place-items: center;
          background: linear-gradient(
            150deg,
            hsl(var(--hue) 78% 62%),
            hsl(var(--hue) 70% 42%)
          );
        }
        /* the home bar: the only thing that closes an app */
        .mg-home {
          all: unset;
          cursor: pointer;
          position: absolute;
          bottom: 12px;
          left: 50%;
          width: 140px;
          height: 5px;
          border-radius: 3px;
          transform: translateX(-50%);
          background: #ffffffcc;
          box-shadow: 0 0 12px #ffffff66;
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
