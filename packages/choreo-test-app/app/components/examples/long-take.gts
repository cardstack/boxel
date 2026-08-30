import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import {
  type Camera3DState,
  Choreo,
  type ChoreoContext,
  type ChoreoRun,
  motion,
} from 'glimmer-motion';
import { Board } from 'test-app/components/long-take/board';
import { BOARD, GLIDE, SHOTS } from 'test-app/components/long-take/shots';
import { cameraCss, objectCss, perspective } from 'test-app/lib/css3d';
import type * as THREE from 'three';

/**
 * ONE SHOT, NO CUTS — and two cameras on the same list.
 *
 * The laptop's screen holds a drawing that never changes. Nothing on it
 * mounts, unmounts, moves or animates for the whole film: there is no
 * `c.Move`, no changeset, no `c.Perform`, not one `@animate` anywhere in
 * `long-take/board.gts`. Every frame of it is camera.
 *
 * There are two of them, and they are nested:
 *
 *   `c.Camera` INSIDE the screen moves the frame over the drawing —
 *   `c.Frame` to arrive, `c.Aim` to travel with the zoom held, `c.Pan` to
 *   drift, `c.SlowZoom` to keep a hold alive, `c.Hold` for the beat.
 *
 *   `c.Camera3D` OUTSIDE moves the laptop in the room, and it barely
 *   moves at all. A device that swings about while you are trying to read
 *   something is a demo talking over itself, so the outer camera does one
 *   slow drift per shot and nothing else.
 *
 * They read ONE list (`long-take/shots.ts`), which is what keeps them in
 * step: a shot's length is `move + hold`, both regions are handed the
 * same number, and neither of them owns it. Two scores that each kept
 * their own timings would need those timings kept equal by hand, and the
 * first edit that forgot would be a film whose cameras had drifted a
 * second apart with nothing to point at.
 *
 * There is no 2D mode. The demo is about a camera inside a camera, and
 * flat there is only one of them.
 */

/** the DOM screen, at the model's own display aspect */
const SCREEN = { h: BOARD.h, w: BOARD.w };

/** how much of the box the laptop fills — closer than the mockup's, on purpose */
const fillFor = (h: number) => (h < 520 ? 1.06 : h < 660 ? 1.0 : 0.94);

/** the lid's own layer: the one thing the eye-level key light may not touch */
const EYE_LEVEL = 1;

const RANGE = {
  dolly: [0.5, 1.9],
  pan: [-0.4, 0.4],
  /** the top of the range is the high angle over the keyboard */
  pitch: [-20, 27],
  yaw: [-38, 38],
} as const;

interface LongTakeWindow extends Window {
  __take?: unknown;
}

export class LongTake extends Component {
  @tracked status = 'warming up the room…';
  @tracked cameraOn = true;
  @tracked roomy = true;
  @tracked take = 0;
  @tracked drawn = false;

  private region?: { run: ChoreoRun | null };
  private shotHost?: (state: Camera3DState) => void;
  private poseHost?: (
    partial: Partial<Camera3DState>,
    relative?: boolean
  ) => void;
  private leanHost?: (partial: Partial<Camera3DState>) => void;
  private resetHost?: () => void;
  private boot?: () => Promise<void>;

  readonly shots = SHOTS;
  readonly glide = GLIDE;

  /**
   * NOTHING PLAYS UNTIL THE SCREEN HAS A SIZE.
   *
   * The inner camera's first step is `c.Frame` — fit this station to the
   * frame — and a fit is a ratio of two measured boxes. The DOM plane has
   * no width at all until the GLB has landed and the display has been
   * measured, so a score that started at mount would divide by a screen
   * that is 0 wide, land on zoom 0, and then measure everything through
   * its own zero scale forever after. That is not a slow start; it is a
   * latch, and the demo comes up as a blank navy rectangle with no way
   * back.
   *
   * So both regions wait for the first mapped frame. It also happens to
   * be the honest thing: the film should not be three seconds in by the
   * time there is a laptop to look at.
   */
  get playing() {
    return this.cameraOn && this.drawn && this.roomy;
  }

  /** the outer camera's leg for a shot is exactly the shot's own length */
  legFor = (shot: (typeof SHOTS)[number]) => shot.move + shot.hold;

  shot = (state: Camera3DState) => {
    this.shotHost?.(state);
  };

  /**
   * A stick moved. Playing, it is a NUDGE laid on top of the film that
   * unwinds when you let go — lean in to read something and simply
   * release to be handed back to the shot. Stopped, the same stick
   * INTEGRATES and drives the pose itself.
   */
  nudge = (kind: string, x: number, y: number, dt: number) => {
    const lean = this.cameraOn;
    const k = lean ? 1 : dt;
    const move =
      kind === 'orbit'
        ? { pitch: y * (lean ? 20 : 62), yaw: x * (lean ? 34 : 100) }
        : kind === 'pan'
          ? { x: x * (lean ? 0.26 : 0.7), y: -y * (lean ? 0.26 : 0.7) }
          : { dolly: -y * (lean ? 0.5 : 1.1) };
    const scaled = Object.fromEntries(
      Object.entries(move).map(([key, v]) => [key, v * k])
    ) as Partial<Camera3DState>;
    if (lean) {
      this.leanHost?.(scaled);
    } else {
      this.poseHost?.(scaled, true);
    }
  };

  /** a drag means "let me look", and that stops the outer camera */
  seizeCamera = () => {
    if (this.cameraOn) {
      this.cameraOn = false;
      this.region?.run?.pause();
    }
  };

  // NO RESYNC BUTTON. The drawing is inert — there is nothing on it to
  // press, so the only thing a person can take over is the camera, and the
  // camera control already hands it back. A second button that means
  // "undo the first button" is furniture.

  toggleCamera = () => {
    const next = !this.cameraOn;
    this.cameraOn = next;
    if (!next) {
      this.region?.run?.pause();
      return;
    }
    // RESUMING TAKES THE CAMERA BACK COMPLETELY. Whatever the sticks left
    // behind is discarded, because a film that resumes from someone
    // else's framing is not the film.
    this.resetHost?.();
    this.take += 1;
  };

  /** hold the region so the film can loop when its score finishes */
  wire = modifier((_el: HTMLElement, [c]: [ChoreoContext, number]) => {
    this.region = c as unknown as { run: ChoreoRun | null };
    const run = this.region.run;
    if (!run) {
      return;
    }
    let live = true;
    void run.finished.then(() => {
      if (live && this.cameraOn) {
        this.take += 1;
      }
    });
    return () => {
      live = false;
    };
  });

  /**
   * THUMBSTICKS, not sliders: progressive resistance so the outer travel
   * costs something, a damped knob that chases the finger, and an elastic
   * snap home. The camera integrates the stick's OFFSET, so a stick that
   * springs back does not undo what it did.
   */
  padDrag = modifier((el: HTMLElement, [kind]: [string]) => {
    const knob = { vx: 0, vy: 0, x: 0, y: 0 };
    let held = false;
    let raf = 0;
    let want = { x: 0, y: 0 };
    let last = 0;

    const resist = (t: number) =>
      Math.sign(t) * Math.min(1, Math.abs(t)) ** 1.7;

    const read = (ev: PointerEvent) => {
      const b = el.getBoundingClientRect();
      const half = Math.min(b.width, b.height) / 2 || 1;
      want = {
        x: resist((ev.clientX - (b.left + b.width / 2)) / half),
        y: resist((ev.clientY - (b.top + b.height / 2)) / half),
      };
    };

    const CHASE = { c: 26, k: 340 };
    const HOME = { c: 15, k: 150 };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      const target = held ? want : { x: 0, y: 0 };
      const s = held ? CHASE : HOME;
      for (const axis of ['x', 'y'] as const) {
        const v = axis === 'x' ? 'vx' : 'vy';
        const a = s.k * (target[axis] - knob[axis]) - s.c * knob[v];
        knob[v] += a * dt;
        knob[axis] += knob[v] * dt;
      }
      el.style.setProperty('--knob-x', knob.x.toFixed(4));
      el.style.setProperty('--knob-y', knob.y.toFixed(4));
      const lean = this.cameraOn;
      this.nudge(kind, lean ? want.x : knob.x, lean ? want.y : knob.y, dt);
      if (
        !held &&
        Math.hypot(knob.x, knob.y) < 0.002 &&
        Math.hypot(knob.vx, knob.vy) < 0.01
      ) {
        cancelAnimationFrame(raf);
        raf = 0;
        knob.x = 0;
        knob.y = 0;
        el.style.setProperty('--knob-x', '0');
        el.style.setProperty('--knob-y', '0');
      }
    };

    const spin = () => {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    const move = (ev: PointerEvent) => {
      if (held) {
        read(ev);
      }
    };
    const up = () => {
      held = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      spin();
    };
    const start = (ev: PointerEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      held = true;
      read(ev);
      spin();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };
    el.addEventListener('pointerdown', start);
    return () => {
      el.removeEventListener('pointerdown', start);
      up();
      if (raf) {
        cancelAnimationFrame(raf);
      }
    };
  });

  stage = modifier((host: HTMLElement) => {
    const canvas = host.querySelector('canvas')!;
    const layer = host.querySelector<HTMLElement>('.lt-css')!;
    const cam = host.querySelector<HTMLElement>('.lt-cam')!;
    const plane = host.querySelector<HTMLElement>('.lt-plane')!;

    // START CLEAN: an inline matrix left by a previous mount beats the 2D
    // stylesheet and leaves a flat laptop wearing a 3D transform
    plane.style.transform = '';
    cam.style.transform = '';
    layer.style.perspective = '';

    /**
     * IS THERE ROOM TO PLAY A FILM HERE? Decided from the OBSERVED
     * height: `.ex` is `position:absolute; inset:0` and has not been laid
     * out when the modifier runs, so an early read reports a box far
     * smaller than the one the demo ends up in.
     */
    let decided = false;
    const decideRoom = (h: number) => {
      if (decided || h <= 0) {
        return;
      }
      decided = true;
      this.roomy = h >= 460;
      if (!this.roomy) {
        this.cameraOn = false;
        return;
      }
      // a region does not collect its score on its first render
      requestAnimationFrame(() => {
        this.take += 1;
      });
    };

    /**
     * ONE FIT, TWO CONSUMERS. The 3D camera solves a distance that fills
     * FILL of the box; the flat laptop is scaled by the same fraction, so
     * the 2D/3D switch does not resize the device under you.
     */
    const watch = (decide = false) => {
      if (decide) {
        decideRoom(host.clientHeight);
      }
    };
    // THE ROOM IS DECIDED BY THE OBSERVER, NEVER BY THIS CALL. A modifier
    // runs before its element has been laid out, so the height here is
    // whatever the box happened to be mid-render — and a full page read a
    // frame too early is classified as a gallery card, which opens paused
    // with no film. The ResizeObserver's first callback carries the box
    // the browser actually settled on.
    watch();
    const ro = new ResizeObserver(() => watch(true));
    ro.observe(host);

    let raf = 0;
    let running = false;
    let built = false;
    let building = false;
    let ready = false;
    let tick: (() => void) | undefined;
    let clear: (() => void) | undefined;
    let rx = -0.05;
    let ry = 0.32;
    let dolly = 1;
    let truck = 0;
    let pedestal = 0;
    let dispose: (() => void) | undefined;
    let stopTheme: (() => void) | undefined;

    /**
     * Everything 3D lives behind this. three plus a GLTF loader, a DRACO
     * decoder and an environment is a megabyte and a half of JavaScript —
     * none of which a visitor looking at the flat deck has any use for.
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
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.96;
      const scene = new T.Scene();
      const pmrem = new T.PMREMGenerator(renderer);

      /**
       * TWO ROOMS, for the same reason a real set has flags. The
       * aluminium wants a bright one — metal is nothing but the
       * reflection of its surroundings — and the glass wants a dark one,
       * or the room comes back as a white sheet over the slides. Painted
       * in equirectangular space: u is the compass with 0 at the lens.
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
        tex.colorSpace = T.SRGBColorSpace;
        tex.mapping = T.EquirectangularReflectionMapping;
        return pmrem.fromEquirectangular(tex).texture;
      };

      scene.environment = cyc('#2b3038', [
        [0.0, 0.08, 0.5, 0.16, '#ffffff', 0.72],
        [-0.22, 0.44, 0.16, 0.72, '#e8f0ff', 0.7],
        [0.34, 0.4, 0.14, 0.6, '#ffdcb4', 0.6],
        [0.05, 0.94, 0.4, 0.12, '#aab2c0', 0.45],
      ]);

      /** the flagged room, for the panel: lamps down, nothing at the lens */
      const flagged = cyc('#05060a', [
        [0.0, 0.07, 0.34, 0.07, '#ffffff', 0.95],
        [-0.26, 0.4, 0.07, 0.5, '#9fb4d6', 0.5],
        [0.36, 0.38, 0.06, 0.4, '#c9a27a', 0.4],
      ]);

      const camera = new T.PerspectiveCamera(36, 1, 1, 20000);
      camera.position.set(0, 0, 2200);

      /**
       * FIT THE LAPTOP TO THE PLATTER. World units are CSS pixels, so
       * framing is arithmetic: the height a perspective camera shows at
       * distance d is 2·d·tan(fov/2), and the same in width once aspect
       * is folded in. Solve both, take the further. A laptop is landscape
       * and so is usually width-bound — which needs no special case.
       */
      let mac = { h: 1000, w: 1600 };
      let rest = 2200;
      /** the laptop sits a touch low, leaving air for the chrome on top */
      const DROP = 0.03;
      const frame2 = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        const vFov = (camera.fov * Math.PI) / 180;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (w / h));
        const fill = fillFor(h);
        const dV = mac.h / fill / 2 / Math.tan(vFov / 2);
        const dH = mac.w / fill / 2 / Math.tan(hFov / 2);
        rest = Math.max(dV, dH);
      };

      /**
       * THE RIG. A desk, not a void: one big soft key camera-left for the
       * streak down the aluminium lid, a low bounce standing in for the
       * table the laptop is on, a warm kicker behind to cut the
       * silhouette off the backdrop, and an overhead strip that is the
       * one highlight a glossy panel SHOULD carry.
       */
      RectAreaLightUniformsLib.init();
      scene.add(new T.AmbientLight(0xffffff, 0.14));

      /**
       * KEY, at eye level — and the ONE unit the panel may not see. A
       * source level with the lens reflects off the glass straight back
       * down it: a white sheet over the slides rather than a highlight.
       * three filters lights per object by LAYER, so this one lives alone
       * on layer 1 and every mesh joins layer 1 EXCEPT the display.
       */
      const key = new T.RectAreaLight(0xffffff, 2.6, 1800, 1400);
      key.position.set(-1150, 420, 1500);
      key.lookAt(0, 0, 0);
      key.layers.set(EYE_LEVEL);
      scene.add(key);

      /** overhead strip: long, shallow, high and only just in front */
      const top = new T.RectAreaLight(0xffffff, 1.3, 2200, 380);
      top.position.set(120, 2400, 320);
      top.lookAt(0, 0, 0);
      scene.add(top);

      /** the table: a wide dim source coming back up off the desk */
      const bounce = new T.RectAreaLight(0xc6cedb, 0.8, 2600, 900);
      bounce.position.set(0, -1250, 900);
      bounce.lookAt(0, 0, 0);
      bounce.layers.set(EYE_LEVEL);
      scene.add(bounce);

      /** warm kicker behind-right: the rim that lifts it off the cyc */
      const kick = new T.RectAreaLight(0xffe0b8, 3.4, 700, 1500);
      kick.position.set(1250, 700, -1200);
      kick.lookAt(0, 0, 0);
      scene.add(kick);

      /** and behind-left, low: the hairline along the lid's back edge */
      const rim = new T.RectAreaLight(0xdfe7f5, 3.2, 1700, 700);
      rim.position.set(-260, -680, -1150);
      rim.lookAt(0, 0, 0);
      scene.add(rim);

      /**
       * SCREEN GLOW — the tell that a display is on. A lit panel throws
       * its colour onto everything near it, and on a laptop that means
       * the keyboard deck and the inner bezel. Facing back at the model,
       * on the flagged layer so the one surface it may not light is the
       * glass it is standing on.
       */
      const glow = new T.RectAreaLight(0x9fb6e8, 2.2, SCREEN.w, SCREEN.h);
      glow.position.set(0, 60, 900);
      glow.lookAt(0, -300, 0);
      glow.layers.set(EYE_LEVEL);
      scene.add(glow);

      /**
       * THE SET. A backdrop the laptop stands in front of, so the eye can
       * tell the two motions apart: when the SHOT moves the horizon
       * shifts; when the DEVICE turns it does not. Without it a yaw and
       * an orbit are the same picture.
       */
      const cycCanvas = document.createElement('canvas');
      cycCanvas.width = 512;
      cycCanvas.height = 512;
      const cycCtx = cycCanvas.getContext('2d')!;
      const cycTex = new T.CanvasTexture(cycCanvas);
      cycTex.colorSpace = T.SRGBColorSpace;
      /** the set follows the page: a dark cyc behind a light page is a hole */
      const dressSet = () => {
        const light =
          document.documentElement.getAttribute('data-theme') === 'light';
        const base = light ? '#5b626e' : '#14161b';
        const floor = light ? '#3f444e' : '#090a0d';
        const pool = light ? '#ffffff2e' : '#ffffff1c';
        const g = cycCtx;
        g.fillStyle = base;
        g.fillRect(0, 0, 512, 512);
        const wash = g.createLinearGradient(0, 0, 0, 512);
        wash.addColorStop(0, '#00000047');
        wash.addColorStop(0.55, '#00000000');
        wash.addColorStop(0.6, '#ffffff12');
        wash.addColorStop(0.64, floor);
        wash.addColorStop(1, floor);
        g.fillStyle = wash;
        g.fillRect(0, 0, 512, 512);
        const spot = g.createRadialGradient(256, 330, 8, 256, 330, 210);
        spot.addColorStop(0, pool);
        spot.addColorStop(1, '#ffffff00');
        g.fillStyle = spot;
        g.fillRect(0, 0, 512, 512);
        cycTex.needsUpdate = true;
      };
      dressSet();
      const themeWatch = new MutationObserver(dressSet);
      themeWatch.observe(document.documentElement, {
        attributeFilter: ['data-theme'],
        attributes: true,
      });
      stopTheme = () => themeWatch.disconnect();
      const setPlane = new T.Mesh(
        new T.PlaneGeometry(9000, 9000),
        new T.MeshBasicMaterial({ map: cycTex })
      );
      setPlane.position.set(0, 0, -3600);
      scene.add(setPlane);

      /** everything the pointer orbits */
      const pivot = new T.Object3D();
      scene.add(pivot);
      /** the display's own frame: what the DOM plane is pinned to */
      const anchor = new T.Object3D();
      pivot.add(anchor);

      const draco = new DRACOLoader().setDecoderPath('/draco/');
      const loader = new GLTFLoader().setDRACOLoader(draco);
      await new Promise<void>((resolve) => {
        loader.load('/models/macbook-pro.glb', (gltf) => {
          const model = gltf.scene;
          model.updateMatrixWorld(true);

          /**
           * THE DISPLAY, BY NAME. Unlike the phone's GLB this model was
           * exported with its materials named, and one of them is
           * `screen.001` — so the panel is simply the mesh wearing it. A
           * geometry fallback is kept for the day that stops being true:
           * the thinnest mesh whose face is close to the lid's aspect.
           */
          let found: THREE.Mesh | undefined;
          let fallback: { mesh: THREE.Mesh; thin: number } | undefined;
          model.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) {
              return;
            }
            const mats = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            if (mats.some((m) => /screen/i.test(m?.name ?? ''))) {
              found ??= mesh;
            }
            mesh.geometry.computeBoundingBox();
            const b = mesh.geometry.boundingBox!;
            const d = b.max.clone().sub(b.min);
            const thin = Math.min(d.x, d.y, d.z);
            const bulk = Math.max(d.x, d.y, d.z);
            if (
              thin / bulk < 0.01 &&
              (!fallback || bulk > fallback.thin) &&
              bulk > 3
            ) {
              fallback = { mesh, thin: bulk };
            }
          });
          const panel = found ?? fallback?.mesh;
          if (!panel) {
            this.status = 'no screen mesh found';
            resolve();
            return;
          }

          // EVERY MEASUREMENT BELOW HAPPENS WITH THE ORBIT AT REST. A
          // Box3 is world-space and axis-aligned, so measuring under a
          // rotated pivot returns the box of the ROTATED lid.
          pivot.rotation.set(0, 0, 0);
          pivot.updateMatrixWorld(true);

          /**
           * ONE WORLD UNIT IS ONE CSS PIXEL. `perspective` and the
           * camera's translateZ are written in px, so a scene authored at
           * "8 units for a laptop" projects nothing like the WebGL one.
           * Scale the model until the display is exactly as wide as the
           * DOM screen and every matrix below is in pixels.
           *
           * The width is taken from the panel's OWN geometry rather than
           * from a world box, because the lid is hinged: an axis-aligned
           * box of a tilted panel is bigger than the panel.
           */
          panel.geometry.computeBoundingBox();
          const local = panel.geometry.boundingBox!;
          const span = local.max.clone().sub(local.min);
          // the thin axis is the normal; the other two are width x height
          const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
          const normalAxis = axes.reduce((a, b) => (span[a] < span[b] ? a : b));
          const face = axes.filter((a) => a !== normalAxis);
          const wLocal = Math.max(span[face[0]!], span[face[1]!]);
          const hLocal = Math.min(span[face[0]!], span[face[1]!]);

          const worldScale = panel.getWorldScale(new T.Vector3()).x || 1;
          model.scale.multiplyScalar(SCREEN.w / (wLocal * worldScale));
          pivot.add(model);
          pivot.updateMatrixWorld(true);

          // centre the whole laptop on the origin, so a dolly closes in on
          // the device rather than drifting off it
          const bounds = new T.Box3().setFromObject(model);
          model.position.sub(bounds.getCenter(new T.Vector3()));
          pivot.updateMatrixWorld(true);

          const whole = new T.Box3()
            .setFromObject(model)
            .getSize(new T.Vector3());
          // the silhouette a turned laptop sweeps, so a yaw does not push
          // a corner out of frame
          mac = { h: whole.y, w: Math.hypot(whole.x, whole.z) };
          frame2();

          /**
           * THE ANCHOR TAKES THE LID'S OWN ORIENTATION.
           *
           * The panel's local frame is (width, normal, height) in some
           * order; the DOM wants (right, up, out). That is one fixed
           * rotation, and composing it with the panel's WORLD rotation
           * pins the plane to the glass at whatever angle the hinge left
           * it — including the degree or so this model is off vertical,
           * which is invisible head-on and a visible parallax the moment
           * the shot turns.
           */
          const q = panel.getWorldQuaternion(new T.Quaternion());
          const correct = new T.Quaternion().setFromEuler(
            normalAxis === 'y'
              ? new T.Euler(-Math.PI / 2, 0, 0)
              : normalAxis === 'x'
                ? new T.Euler(0, Math.PI / 2, 0)
                : new T.Euler(0, 0, 0)
          );
          anchor.quaternion.copy(q).multiply(correct);

          const box = new T.Box3().setFromObject(panel);
          const centre = box.getCenter(new T.Vector3());
          // FLUSH, on the face the panel actually points at. There is no
          // z-fighting to avoid — the DOM never enters the depth buffer —
          // and any offset at all is parallax the moment the lid turns.
          const out = new T.Vector3(0, 0, 1).applyQuaternion(anchor.quaternion);
          const half = (span[normalAxis]! * worldScale * model.scale.x) / 2;
          anchor.position.copy(centre).addScaledVector(out, half);

          plane.style.width = `${SCREEN.w}px`;
          plane.style.height = `${Math.round(SCREEN.w * (hLocal / wLocal))}px`;

          /**
           * THE GLASS. `blending: NoBlending` writes the material's RGB
           * *and its alpha* straight into the framebuffer, replacing the
           * opaque fragments already drawn there — so the canvas becomes
           * a hole the shape of the display and the DOM beneath shows
           * through. Whatever this alpha is, that much of the slide is
           * replaced by shaded glass: five percent of near-black is depth
           * without dimming.
           */
          panel.material = new T.MeshPhysicalMaterial({
            blending: T.NoBlending,
            clearcoat: 1,
            clearcoatRoughness: 0.04,
            color: 0x01030a,
            envMap: flagged,
            envMapIntensity: 0.85,
            metalness: 0,
            opacity: 0.05,
            roughness: 0.06,
            transparent: true,
          });

          model.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh && mesh !== panel) {
              // every mesh joins the key light's layer EXCEPT the display
              mesh.layers.enable(EYE_LEVEL);
            }
          });

          ready = true;
          this.status =
            `MacBook Pro GLB · display "${panel.name}" · ` +
            `${SCREEN.w}×${Math.round(SCREEN.w * (hLocal / wLocal))} css px = ` +
            `${wLocal.toFixed(2)}×${hLocal.toFixed(2)} model units · 1:1`;
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
          frame2();
        }
        camera.position.set(truck, pedestal + mac.h * DROP, rest * dolly);
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
        // THE SEAM. The hole is a polygon edge, and the GPU antialiases it
        // by writing partial coverage into ALPHA — which NoBlending writes
        // verbatim, so the boundary comes out in a half-transparent
        // stair-step MSAA cannot fix because MSAA is what makes it. The
        // DOM plane's own edge IS properly antialiased, so oversizing it a
        // touch lays the clean edge over the ragged one.
        plane.style.transform = objectCss(anchor.matrixWorld.elements, 1.006);
        if (!this.drawn) {
          this.drawn = true;
        }
      };

      // leaving 3D stops the loop, and a stopped canvas keeps its last
      // frame forever — a ghost laptop under the flat one. Clear it.
      clear = () => renderer.clear();
      dispose = () => {
        cancelAnimationFrame(raf);
        raf = 0;
        renderer.dispose();
      };
      built = true;
      building = false;
      (window as LongTakeWindow).__take = {
        state: () => ({ built, raf, ready, running, tick: !!tick }),
        look: (x: number, y: number) => {
          rx = x;
          ry = y;
        },
        plane: () => plane.getBoundingClientRect().toJSON(),
      };
    };

    /** idempotent: safe on every entry into 3D, built or not */
    const run3d = async () => {
      running = true;
      await build();
      if (!running || raf || !tick) {
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    /**
     * DRAG THE SET TO LOOK. A drag anywhere that is not the screen orbits
     * the laptop — and it takes the film's camera, because a drag means
     * "let me look" rather than "surprise me".
     */
    let dragging = false;
    let from = { rx: 0, ry: 0, x: 0, y: 0 };
    const track = (ev: PointerEvent) => {
      if (!dragging) {
        return;
      }
      const k = 0.0045;
      this.poseHost?.({
        pitch: ((from.rx + (ev.clientY - from.y) * k) * 180) / Math.PI,
        yaw: ((from.ry + (ev.clientX - from.x) * k) * 180) / Math.PI,
      });
    };
    const release = () => {
      dragging = false;
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    const grab = (ev: PointerEvent) => {
      if ((ev.target as HTMLElement)?.closest('.lt-plane, .lt-chrome')) {
        return;
      }
      dragging = true;
      this.seizeCamera();
      from = { rx, ry, x: ev.clientX, y: ev.clientY };
      window.addEventListener('pointermove', track);
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    };
    host.addEventListener('pointerdown', grab);

    /**
     * ONE POSE, TWO RENDERERS. The film publishes a pose; this applies it
     * to three.js AND to a handful of custom properties the flat laptop
     * is transformed by. There is no second camera track to keep in sync.
     */
    const pose: Camera3DState = { dolly: 1, pitch: 0, x: 0, y: 0, yaw: 0 };
    const lean: Camera3DState = { dolly: 0, pitch: 0, x: 0, y: 0, yaw: 0 };
    const LIMIT = RANGE;
    const clamp = (v: number, span?: readonly [number, number]) =>
      span ? Math.max(span[0], Math.min(span[1], v)) : v;
    const shown = (): Camera3DState => ({
      dolly: clamp(pose.dolly + lean.dolly, LIMIT.dolly),
      pitch: clamp(pose.pitch + lean.pitch, LIMIT.pitch),
      x: clamp(pose.x + lean.x, LIMIT.pan),
      y: clamp(pose.y + lean.y, LIMIT.pan),
      yaw: clamp(pose.yaw + lean.yaw, LIMIT.yaw),
    });
    const share = (at: Camera3DState) => {
      const pct = (v: number, [lo, hi]: readonly [number, number]) =>
        Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
      host.style.setProperty('--yaw-at', String(pct(at.yaw, LIMIT.yaw)));
      host.style.setProperty('--pitch-at', String(pct(at.pitch, LIMIT.pitch)));
      host.style.setProperty('--pan-x-at', String(pct(at.x, LIMIT.pan)));
      host.style.setProperty('--pan-y-at', String(pct(at.y, LIMIT.pan)));
      host.style.setProperty('--dolly-at', String(pct(at.dolly, LIMIT.dolly)));
    };
    const apply = () => {
      const at = shown();
      // the lid faces +Z at rest (the base extends toward the viewer), so
      // unlike the phone there is no half turn to undo
      ry = (at.yaw * Math.PI) / 180;
      rx = (at.pitch * Math.PI) / 180;
      dolly = at.dolly;
      // truck and pedestal as fractions of the framed width, so the same
      // pose reads the same whatever box the demo was given
      truck = at.x * SCREEN.w;
      pedestal = at.y * SCREEN.w;
      share(at);
    };
    this.shotHost = (next) => {
      Object.assign(pose, next);
      apply();
    };
    this.resetHost = () => {
      Object.assign(pose, { dolly: 1, pitch: 0, x: 0, y: 0, yaw: 0 });
      Object.assign(lean, { dolly: 0, pitch: 0, x: 0, y: 0, yaw: 0 });
      apply();
    };
    this.leanHost = (partial) => {
      Object.assign(lean, { dolly: 0, pitch: 0, x: 0, y: 0, yaw: 0 }, partial);
      apply();
    };
    this.poseHost = (partial, relative) => {
      if (relative) {
        for (const axis of ['yaw', 'pitch', 'x', 'y', 'dolly'] as const) {
          const add = partial[axis];
          if (add === undefined) {
            continue;
          }
          const span =
            axis === 'dolly'
              ? LIMIT.dolly
              : axis === 'yaw'
                ? LIMIT.yaw
                : axis === 'pitch'
                  ? LIMIT.pitch
                  : LIMIT.pan;
          pose[axis] = clamp(pose[axis] + add, span);
        }
      } else {
        Object.assign(pose, partial);
      }
      apply();
    };
    apply();

    this.boot = run3d;
    // NO SWITCH, SO NO WAITING TO BE ASKED. The mockup keeps the engine
    // behind a 2D/3D control because flat is a real thing to look at
    // there. Here flat is nothing — a camera inside a camera has no
    // meaning with one of them missing — so the engine is fetched as soon
    // as the stage exists, and the room says so until it lands.
    void run3d();

    return () => {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      clear?.();
      dispose?.();
      release();
      stopTheme?.();
      ro.disconnect();
      host.removeEventListener('pointerdown', grab);
      delete (window as LongTakeWindow).__take;
      this.boot = undefined;
    };
  });

  <template>
    <div class="lt-page">
      <Choreo
        class="lt-stage"
        data-ready={{if this.drawn "yes" ""}}
        @onCamera3D={{this.shot}}
        {{this.stage}}
        as |c|
      >
        <canvas></canvas>

        <div class="lt-css">
          <div class="lt-cam">
            <div class="lt-plane">
              <div class="lt-screen">
                {{! THE BOOST. `backdrop-filter` re-renders everything
                    BEHIND this pane, so a transparent sheet over the
                    drawing lifts the whole panel's luminance without
                    touching a colour in the markup — the closest thing
                    the platform has to turning a screen up. }}
                <div class="lt-boost" aria-hidden="true"></div>

                {{! THE INNER CAMERA'S WHOLE WORLD. Its own region, its
                    own frame, its own score — and the outer stage tells
                    it only two things: whether to play, and which take
                    this is. }}
                <Board @playing={{this.playing}} @take={{this.take}} />
              </div>
            </div>
          </div>
        </div>

        {{#unless this.drawn}}
          <p class="lt-loading">{{this.status}}</p>
        {{/unless}}

        {{! THE OUTER FILM. One `c.Camera3D` per shot, and its duration is
            the shot's own `move + hold` — the same number the board's
            camera is given. Neither region owns it, which is the only
            reason they cannot drift. }}
        {{#if this.playing}}
          <div
            class="lt-clock"
            data-take={{this.take}}
            style="width:{{this.take}}px"
            aria-hidden="true"
            {{motion id="clock"}}
            {{this.wire c this.take}}
          >{{this.take}}</div>

          <c.Sequence>
            {{#each this.shots key="@index" as |shot|}}
              <c.Camera3D
                @yaw={{shot.yaw}}
                @pitch={{shot.pitch}}
                @dolly={{shot.dolly}}
                @duration={{this.legFor shot}}
                @ease={{this.glide}}
              />
            {{/each}}
          </c.Sequence>
        {{/if}}
      </Choreo>

      {{! THE CHROME PLANE. Outside the region: the transport and the
          sticks belong to the viewer, not to the shot. }}
      <div class="lt-chrome">
        <div class="lt-transport">
          <button
            type="button"
            data-on={{if this.cameraOn "yes" ""}}
            {{on "click" this.toggleCamera}}
          >
            {{#if this.cameraOn}}
              <svg class="lt-ico" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            {{else}}
              <svg class="lt-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            {{/if}}
            camera
          </button>
        </div>

        <div class="lt-pads">
          <div class="lt-pad" {{this.padDrag "orbit"}}>
            <span class="lt-pad-dot"></span>
            <span class="lt-pad-name">rotate</span>
          </div>
          <div class="lt-pad" {{this.padDrag "pan"}}>
            <span class="lt-pad-dot"></span>
            <span class="lt-pad-name">pan</span>
          </div>
          <div class="lt-zoom" {{this.padDrag "dolly"}}>
            <span class="lt-zoom-dot"></span>
            <span class="lt-pad-name">dolly</span>
          </div>
        </div>
      </div>

      <style>
        .lt-page,
        .lt-page * {
          user-select: none;
          -webkit-user-select: none;
        }
        .lt-page {
          padding: 24px;
          font:
            12px/1.4 ui-monospace,
            monospace;
        }
        .lt-stage {
          position: absolute;
          inset: 0;
          overflow: hidden;
          touch-action: none;
          background:
            radial-gradient(
              120% 90% at 50% 8%,
              #23262d 0%,
              #14161b 46%,
              #090a0d 100%
            ),
            #14161b;
        }
        :root[data-theme="light"] .lt-stage {
          background:
            radial-gradient(
              120% 90% at 50% 8%,
              #6d7481 0%,
              #5b626e 46%,
              #3f444e 100%
            ),
            #5b626e;
        }
        /* THE CANVAS SITS ABOVE THE DOM, and that is what makes the
           laptop's own body occlude the drawing.

           There is no per-pixel depth test between a canvas and the DOM —
           they are separate compositing layers — so the ordering has to do
           the work. The display mesh punches its hole with `NoBlending`,
           and the DOM underneath shows through it. But the hole is
           depth-TESTED like anything else: where the base and the keyboard
           are nearer the camera than the lid, the display's fragments fail
           that test and the aluminium stays. So the drawing disappears
           behind the bottom of the laptop exactly when it should, out of
           the depth buffer that was already there.

           With the layers the other way round the DOM paints over
           everything and the board floats in front of the keyboard — the
           giveaway that a mockup is a texture pretending to be a screen. */
        .lt-stage canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 2;
          pointer-events: none;
        }
        .lt-css {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .lt-cam {
          position: absolute;
          inset: 0;
          transform-style: preserve-3d;
        }
        .lt-plane {
          position: absolute;
          top: 0;
          left: 0;
          transform-style: preserve-3d;
          pointer-events: auto;
        }
        .lt-screen {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background: #0a1420;
        }
        .lt-boost {
          position: absolute;
          inset: 0;
          z-index: 8;
          pointer-events: none;
          backdrop-filter: brightness(1.3) saturate(1.1);
          -webkit-backdrop-filter: brightness(1.3) saturate(1.1);
        }
        .lt-clock {
          position: absolute;
          left: -9999px;
          top: -9999px;
          opacity: 0;
          pointer-events: none;
        }
        .lt-loading {
          position: absolute;
          z-index: 3;
          left: 0;
          right: 0;
          top: 50%;
          margin: 0;
          text-align: center;
          font: 11px/1 var(--font-mono, ui-monospace, monospace);
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #ffffff8c;
        }

        /* ── the player ──────────────────────────────────────────────── */

        .lt-transport {
          position: absolute;
          z-index: 4;
          top: 10px;
          left: 10px;
          display: flex;
          gap: 6px;
        }
        .lt-transport button {
          all: unset;
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          padding: 7px 12px;
          border: 1px solid #ffffff5c;
          border-radius: 999px;
          background: transparent;
          color: #ffffff;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          line-height: 1;
          white-space: nowrap;
        }
        .lt-transport button[data-on="yes"] {
          border-color: #ffffff8f;
          background: #ffffff1f;
        }
        .lt-ico {
          width: 12px;
          height: 12px;
          margin-right: 5px;
          vertical-align: -1px;
          fill: currentColor;
        }

        /* GLASSMORPHIC THUMB CONTROLS: a frosted disc that sits on the
           picture rather than in a panel beside it, and a knob that rides
           a spring inside it. */
        .lt-pads {
          position: absolute;
          z-index: 5;
          right: 14px;
          bottom: 26px;
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .lt-pad,
        .lt-zoom {
          position: relative;
          touch-action: none;
          cursor: grab;
          border-radius: 999px;
          border: 1px solid #ffffff2e;
          background: linear-gradient(
            160deg,
            #ffffff26 0%,
            #ffffff0f 42%,
            #ffffff08 100%
          );
          backdrop-filter: blur(14px) saturate(1.4);
          -webkit-backdrop-filter: blur(14px) saturate(1.4);
          box-shadow:
            0 1px 0 #ffffff3d inset,
            0 8px 20px -8px #00000073;
        }
        .lt-pad:active,
        .lt-zoom:active {
          cursor: grabbing;
        }
        .lt-pad {
          width: 54px;
          height: 54px;
        }
        .lt-zoom {
          width: 32px;
          height: 54px;
        }
        .lt-pad-name {
          position: absolute;
          left: 0;
          right: 0;
          bottom: -12px;
          text-align: center;
          font: 9px/1 var(--font-mono, ui-monospace, monospace);
          color: var(--ink-faint, #b8aea3);
          letter-spacing: 0.04em;
          pointer-events: none;
        }
        .lt-pad-dot,
        .lt-zoom-dot {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 21px;
          height: 21px;
          margin: -10.5px 0 0 -10.5px;
          border-radius: 50%;
          pointer-events: none;
          background: radial-gradient(
            120% 120% at 34% 26%,
            #ffffffe6 0%,
            #ffffff8c 40%,
            #ffffff33 100%
          );
          box-shadow:
            0 2px 6px #00000059,
            0 0 0 1px #ffffff40 inset;
          transform: translate(
            calc(var(--knob-x, 0) * 15px),
            calc(var(--knob-y, 0) * 15px)
          );
        }
        .lt-zoom-dot {
          width: 19px;
          height: 19px;
          margin: -9.5px 0 0 -9.5px;
          transform: translate(0, calc(var(--knob-y, 0) * 14px));
        }
        @container (max-height: 460px) {
          .lt-pads {
            display: none;
          }
        }
      </style>
    </div>
  </template>
}

export default LongTake;
