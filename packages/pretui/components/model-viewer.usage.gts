// Pretui — ModelViewer usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { ModelViewer } from './model-viewer';
import type { OrbitState } from './model-viewer';
import { platePoster } from '../media-examples';
import { Token } from './token';

// ── ModelViewer ──────────────────────────────────────────────────────────
const SAMPLE_MODEL_SRC =
  'https://modelviewer.dev/shared-assets/models/Astronaut.glb';

const SAMPLE_MODEL_POSTER = platePoster('Astronaut', '1 / 1');

class ModelViewerUsage extends Component {
  src = SAMPLE_MODEL_SRC;
  poster = SAMPLE_MODEL_POSTER;

  @tracked height = 320;
  @tracked step = 15;
  @tracked ar = false;
  @tracked camera = '—';

  setHeight = (v: number | null) => (this.height = v ?? 320);
  setStep = (v: number | null) => (this.step = v ?? 15);
  setAr = (v: boolean) => (this.ar = v);
  noteOrbit = (orbit: OrbitState) =>
    (this.camera = `${Math.round(orbit.azimuth)}° / ${Math.round(orbit.elevation)}° / ${Math.round(orbit.zoom * 100)}%`);

  get usage(): string {
    return [
      '<ModelViewer',
      '  @src={{this.src}}',
      "  @alt='Astronaut — glTF sample'",
      '  @poster={{this.poster}}',
      '  @onOrbit={{this.noteOrbit}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='ModelViewer'
      @description="<model-viewer> 4.3.1+12 (Apache-2.0, vendored at ./model-viewer — read its NOTICE, not only its README: Apache-2.0 wants a statement of changes and that bundle is a modified distribution). NOTE: this is the one page in the media territory that needs the network — there is no way to synthesise a GLB, so it points at Google's own sample model, and offline it lands on its error channel, which is worth seeing. Nothing loads until you press Load 3D model: a model is megabytes and a render loop, and starting both because a component scrolled into view is the spatial version of autoplay. Once it is up, focus the stage and turn it with the keyboard — ← → orbit, Shift for a coarse step, PageUp/PageDown by a quarter turn, ↑ ↓ elevation, + and − zoom, Home to face front, End to face back — and the announced value is 'turned 45° right, 20° above, 105% zoom' rather than a quaternion."
      @source={{this.usage}}
    >
      <:example>
        <ModelViewer
          @src={{this.src}}
          @alt='Astronaut — the glTF sample model'
          @poster={{this.poster}}
          @height={{this.height}}
          @step={{this.step}}
          @ar={{this.ar}}
          @onOrbit={{this.noteOrbit}}
        />
        <p class='dm-readout'>
          <span class='dm-readoutLabel'>@onOrbit</span>
          <Token @value={{this.camera}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='src'
          @value={{this.src}}
          @description='URL of a .glb or .gltf. NETWORKED on this page — the only fixture in the media territory that is.'
          @hideControls={{true}}
        />
        <Args.String
          @name='alt'
          @value='Astronaut — the glTF sample model'
          @description='Description of the model. This is the only thing a screen reader can ever be told about a 3D object, so it carries more weight than alt text on a picture.'
          @hideControls={{true}}
        />
        <Args.String
          @name='poster'
          @value={{this.poster}}
          @description='Shown before the model is asked for, and the reserved space while it loads. A generated SVG here, so the resting state works offline even though the model does not.'
          @hideControls={{true}}
        />
        <Args.Number
          @name='height'
          @value={{this.height}}
          @min={{160}}
          @max={{560}}
          @defaultValue={{320}}
          @description='Height of the stage in px. @ratio beats it when both are given.'
          @onInput={{this.setHeight}}
        />
        <Args.Number
          @name='step'
          @value={{this.step}}
          @min={{5}}
          @max={{45}}
          @defaultValue={{15}}
          @description='Degrees moved by one arrow press. Shift is three times this.'
          @onInput={{this.setStep}}
        />
        <Args.Bool
          @name='ar'
          @value={{this.ar}}
          @defaultValue={{false}}
          @description='Offer the AR button where the device supports it. Bound as true|undefined, never false — a dynamic attribute goes through the PROPERTY, and `ar={{false}}` would set a falsy property and quietly do nothing.'
          @onInput={{this.setAr}}
        />
        <Args.Action
          @name='onOrbit'
          @description='({azimuth, elevation, zoom}) on every camera change from these controls.'
        />
        <Args.Action
          @name='onLoad'
          @description='() when the model has finished loading.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_MODEL_VIEWER: Record<string, unknown> = {
  ModelViewer: ModelViewerUsage,
};
