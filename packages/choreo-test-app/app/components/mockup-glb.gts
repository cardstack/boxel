import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { Choreo, motion } from 'glimmer-motion';
import { cameraCss, objectCss, perspective } from 'test-app/lib/css3d';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * SPIKE 2 — mockup-studio's GLB in WebGL, and the phone's SCREEN as live
 * DOM, mapped onto the mesh by the one piece of ember-lume/CSS3DRenderer
 * worth taking: the coordinate mapping (`app/lib/css3d.ts`).
 *
 * mockup-studio paints the screen into a canvas and uploads it as a
 * texture, so the UI is pixels. Here the same mesh is rendered by WebGL
 * and the screen is a Choreo region — real DOM, still interactive, still
 * animating — standing exactly where the 3D camera says the screen is.
 */
const APPS = [
  { hue: 8, id: 'mail', label: 'Mail' },
  { hue: 140, id: 'notes', label: 'Notes' },
  { hue: 210, id: 'maps', label: 'Maps' },
  { hue: 275, id: 'music', label: 'Music' },
  { hue: 32, id: 'photos', label: 'Photos' },
  { hue: 190, id: 'clock', label: 'Clock' },
];
type App = (typeof APPS)[number];

/** the DOM screen is authored at a real iPhone's logical resolution */
const SCREEN = { h: 844, w: 390 };
const settle = { damping: 26, stiffness: 260 } as const;

interface SpikeWindow extends Window {
  __glb?: unknown;
}

export class MockupGlb extends Component {
  @tracked open: App | null = null;
  @tracked status = 'loading…';
  private stop?: () => void;

  choose = (app: App) => {
    this.open = app;
  };
  close = () => {
    this.open = null;
  };

  stage = modifier((host: HTMLElement) => {
    const canvas = host.querySelector('canvas')!;
    const layer = host.querySelector<HTMLElement>('.mg-css')!;
    const cam = host.querySelector<HTMLElement>('.mg-cam')!;
    const plane = host.querySelector<HTMLElement>('.mg-plane')!;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    const scene = new THREE.Scene();
    // something for the glass to reflect: without an environment the
    // screen is a flat tint and the trick reads as a coloured overlay
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;

    /**
     * A SEPARATE environment for the glass alone: a plain vertical
     * gradient, no geometry in it at all. A room reflects as recognisable
     * boxes, and a phone screen with furniture in it is a picture of a
     * phone rather than a screen you are meant to read. A gradient
     * reflected sharply is still a hard-edged sheen — glossy, not matte —
     * but there is nothing in it to look at.
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
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.mapping = THREE.EquirectangularReflectionMapping;
    const skyEnv = pmrem.fromEquirectangular(skyTex).texture;
    const camera = new THREE.PerspectiveCamera(38, 1, 1, 20000);
    camera.position.set(0, 0, 1500);

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(600, 900, 800);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1);
    rim.position.set(-800, 400, -600);
    scene.add(rim);

    /** everything the pointer orbits */
    const pivot = new THREE.Object3D();
    scene.add(pivot);
    /** the screen's own frame: what the DOM plane is pinned to */
    const anchor = new THREE.Object3D();
    pivot.add(anchor);

    let ready = false;
    let loaded: THREE.Object3D | null = null;

    // mockup-studio's GLB is DRACO-compressed (drei sets this up from a CDN;
    // here the decoder is served from public/draco)
    const draco = new DRACOLoader().setDecoderPath('/draco/');
    const loader = new GLTFLoader().setDRACOLoader(draco);
    loader.load('/models/iphone-15-pro.glb', (gltf) => {
      const model = gltf.scene;
      model.updateMatrixWorld(true);

      // THE SCREEN, found by geometry — this GLB's node names are
      // obfuscated (`xXDHkMplTIDAXLN`), so mockup-studio's name list never
      // matches it either and it falls back to a heuristic too. The
      // display is the flattest large panel whose aspect is a phone's:
      // 2.510 / 1.162 = 2.161, against the iPhone 15 Pro's 2556/1179 =
      // 2.168. The glass cover sits just in front of it and is a shade
      // wider, which is what the ratio test separates them by.
      const PHONE_ASPECT = 2556 / 1179;
      // thresholds relative to the model's own bounds — a GLB arrives at
      // whatever scale its author left it in (this one is 0.01 per node)
      const whole = new THREE.Box3()
        .setFromObject(model)
        .getSize(new THREE.Vector3());
      let best: { box: THREE.Box3; mesh: THREE.Mesh; miss: number } | null =
        null;
      model.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) {
          return;
        }
        const mesh = child as THREE.Mesh;
        const box = new THREE.Box3().setFromObject(mesh);
        const v = box.getSize(new THREE.Vector3());
        // flat, and most of the body's width: a panel, not a rail
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
        return;
      }
      const found = best as { box: THREE.Box3; mesh: THREE.Mesh; miss: number };

      // ONE WORLD UNIT IS ONE CSS PIXEL. This is the CSS3D contract, and
      // it is not optional: `perspective` and the camera's translateZ are
      // written in px, so a scene authored at "2.6 units for a whole
      // phone" projects nothing like the WebGL one. It LOOKS close at
      // small angles, which is the trap — the giveaway is that the DOM's
      // projected rect goes to five figures and hit-testing stops working.
      // So scale the model until the display mesh is exactly as wide as
      // the DOM screen, and every matrix below is in pixels.
      // EVERY MEASUREMENT BELOW HAPPENS WITH THE ORBIT AT REST. A Box3 is
      // world-space and axis-aligned, so measuring the display under a
      // rotated pivot returns the bounding box of the ROTATED panel — its
      // centre and its front face both wrong, and wrong by more the
      // further the phone is turned. That is what made the DOM float off
      // the glass at grazing angles. The tick loop rewrites the rotation
      // on the next frame, so zeroing it here costs nothing.
      pivot.rotation.set(0, 0, 0);
      pivot.updateMatrixWorld(true);

      const raw = found.box.getSize(new THREE.Vector3());
      model.scale.multiplyScalar(SCREEN.w / raw.x);
      pivot.add(model);
      loaded = model;
      pivot.updateMatrixWorld(true);

      // centre the phone on its own bounds
      const bounds = new THREE.Box3().setFromObject(model);
      model.position.sub(bounds.getCenter(new THREE.Vector3()));
      pivot.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(found.mesh);
      const dims = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      // FLUSH: the plane sits exactly ON the display's front face (this
      // model faces -Z, so that is box.min.z). There is no z-fighting to
      // avoid — the DOM is on the CSS layer and never enters the depth
      // buffer — and any offset at all is parallax you can see the moment
      // the phone turns.
      anchor.position.set(centre.x, centre.y, box.min.z);
      anchor.rotation.y = Math.PI;
      plane.style.width = `${SCREEN.w}px`;
      plane.style.height = `${Math.round(dims.y)}px`;
      // THE GLASS. Lume's `<lume-mixed-plane>` is a MeshPhysicalMaterial
      // with `blending: NoBlending` — which is the whole trick, because
      // NoBlending writes the material's RGB *and its alpha* straight
      // into the framebuffer, replacing the opaque body fragments already
      // drawn there. The canvas becomes a hole exactly the shape of the
      // display, the DOM layer beneath shows through tinted by `color`,
      // and the surface still takes a specular highlight off the
      // environment. So the screen is under the glass, not over it.
      found.mesh.material = new THREE.MeshPhysicalMaterial({
        blending: THREE.NoBlending,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        // near-black and barely there: with NoBlending the alpha written
        // IS this opacity, uniformly, so every point of tint is a point of
        // haze over the UI. Clear glass wants the tint near zero — the
        // reflection is added back by the mesh below, which can be bright
        // without making the glass frosted.
        color: 0x05070b,
        metalness: 0,
        opacity: 0.06,
        roughness: 0.02,
        transparent: true,
      });
      // THE REFLECTION, as its own pass. The clear-glass material above
      // can only be as bright as its alpha, so a specular strong enough to
      // read would also be a haze strong enough to fog the screen. A
      // coincident black mirror has no diffuse of its own — it contributes
      // only what the environment reflects.
      //
      // But it must add LIGHT without adding COVER. Plain AdditiveBlending
      // adds the source alpha too, so the canvas turns opaque over the
      // whole panel and the screen goes muddy — which is the opposite of
      // the ask. CustomBlending separates the two: RGB is One+One (add the
      // reflection), alpha is Zero+One (leave the hole exactly as the
      // glass left it).
      //
      // It reflects the gradient, not the room, and `color` on a metal
      // multiplies what comes back — so this is the one dial for how much
      // sheen there is. Keep it low: the screen is the subject.
      const glare = found.mesh.clone();
      glare.material = new THREE.MeshPhysicalMaterial({
        blendDst: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor,
        blendSrc: THREE.OneFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blending: THREE.CustomBlending,
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
        `screen "${found.mesh.name}" · ${SCREEN.w}×${Math.round(dims.y)} css px ` +
        `= ${dims.x.toFixed(1)}×${dims.y.toFixed(1)} world · scale 1:1`;
    });

    // orbit
    let down: { x: number; y: number } | null = null;
    let ry = Math.PI + 0.3;
    let rx = -0.12;
    const grab = (ev: PointerEvent) => {
      if ((ev.target as Element).closest('.mg-plane')) {
        return;
      } // the screen is UI
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

    let raf = 0;
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
      // ── the whole mapping, three lines ──────────────────────────────
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
    tick();

    (window as SpikeWindow).__glb = {
      look: (x: number, y: number) => {
        rx = x;
        ry = y;
      },
      open: (id: string) => {
        this.open = APPS.find((a) => a.id === id) ?? null;
      },
      close: () => {
        this.open = null;
      },
      plane: () => plane.getBoundingClientRect().toJSON(),
      meshes: () => {
        const rows: unknown[] = [];
        pivot.rotation.set(0, 0, 0);
        pivot.updateMatrixWorld(true);
        loaded?.traverse((child) => {
          if (!(child as THREE.Mesh).isMesh) {
            return;
          }
          const b = new THREE.Box3().setFromObject(child);
          const v = b.getSize(new THREE.Vector3());
          const c = b.getCenter(new THREE.Vector3());
          rows.push({
            name: child.name,
            size: [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)],
            centre: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)],
            areaXY: +(v.x * v.y).toFixed(3),
          });
        });
        return rows.sort(
          (a, b) =>
            (b as { areaXY: number }).areaXY - (a as { areaXY: number }).areaXY
        );
      },
      pick: (name: string) => {
        loaded?.traverse((child) => {
          if (child.name !== name || !(child as THREE.Mesh).isMesh) {
            return;
          }
          const b = new THREE.Box3().setFromObject(child);
          const v = b.getSize(new THREE.Vector3());
          const c = b.getCenter(new THREE.Vector3());
          anchor.position.set(c.x, c.y, b.max.z + 0.004);
          plane.style.width = `${SCREEN.w}px`;
          plane.style.height = `${SCREEN.h}px`;
          (child as THREE.Mesh).visible = false;
          ready = true;
          this.status = `picked "${name}" · ${v.x.toFixed(3)}×${v.y.toFixed(3)}`;
        });
      },
    };

    this.stop = () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointerdown', grab);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      renderer.dispose();
      delete (window as SpikeWindow).__glb;
    };
    return () => this.stop?.();
  });

  <template>
    <div class="mg-page">
      <div class="mg-stage" {{this.stage}}>
        <canvas></canvas>
        <div class="mg-css">
          <div class="mg-cam">
            <div class="mg-plane">
              <Choreo class="mg-screen" as |c|>
                {{#if this.open}}
                  <button
                    type="button"
                    class="mg-app"
                    data-sprite={{this.open.id}}
                    style="--hue:{{this.open.hue}}"
                    {{on "click" this.close}}
                    {{motion id=this.open.id role="tile"}}
                  >
                    <span class="mg-app-name">{{this.open.label}}</span>
                  </button>
                {{else}}
                  <div class="mg-grid">
                    {{#each APPS as |app|}}
                      <button
                        type="button"
                        class="mg-icon"
                        data-sprite={{app.id}}
                        style="--hue:{{app.hue}}"
                        {{on "click" (fn this.choose app)}}
                        {{motion id=app.id role="tile"}}
                      >
                        <span class="mg-icon-name">{{app.label}}</span>
                      </button>
                    {{/each}}
                  </div>
                {{/if}}
                <c.Move @of={{c.moved "tile"}} @spring={{settle}} />
              </Choreo>
            </div>
          </div>
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
          height: 620px;
          touch-action: none;
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
        .mg-css {
          position: absolute;
          inset: 0;
          z-index: 0;
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
        /* it is a phone screen, not a document: a drag across it is a
           gesture, never a text selection. Declared on every element the
           screen owns because `all: unset` on the buttons resets
           user-select back to auto and would undo an inherited value. */
        .mg-plane,
        .mg-screen,
        .mg-grid,
        .mg-icon,
        .mg-icon-name,
        .mg-app,
        .mg-app-name {
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
        }
        .mg-screen {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: 52px;
          background: #0d1220;
        }
        .mg-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 34px 18px;
          padding: 70px 34px;
        }
        .mg-icon {
          all: unset;
          cursor: pointer;
          display: grid;
          justify-items: center;
          gap: 10px;
        }
        .mg-icon::before {
          content: "";
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
          inset: 0;
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
        .mg-status {
          color: #889;
          margin-top: 12px;
        }
      </style>
    </div>
  </template>
}

export default MockupGlb;
