// Pretui — Slider example gallery.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import {
  TEAS,
  seedFrom,
  take,
} from '../examples-kit';
import type { ExampleSpec } from '../examples-kit';
import { Slider } from './slider';

// ── Slider ───────────────────────────────────────────────────────────────
const SLI = seedFrom('Slider');
const sliTeas = take(SLI, 0, 2, TEAS);
const sliBlendTicks = ['0%', '50%', '100%'];
const sliHumidityTicks = ['40', '55', '70'];

const SliderBlend: TemplateOnlyComponent = <template>
  <div class='ex-wide'>
    <Slider @label='Blend ratio' @defaultValue={{60}} @ticks={{sliBlendTicks}} />
  </div>
  <style scoped>
    .ex-wide {
      min-width: 220px;
    }
  </style>
</template>;

const SliderHumidity: TemplateOnlyComponent = <template>
  <div class='ex-wide'>
    <Slider
      @label='Curing-room humidity'
      @min={{40}}
      @max={{70}}
      @step={{5}}
      @defaultValue={{55}}
      @ticks={{sliHumidityTicks}}
    />
  </div>
  <style scoped>
    .ex-wide {
      min-width: 220px;
    }
  </style>
</template>;

export const EXAMPLES_SLIDER: Record<string, ExampleSpec[]> = {
  Slider: [
    {
      title: 'Blend ratio',
      note:
        sliTeas[0] + ' against ' + sliTeas[1] + ' — ticks mark the anchors.',
      component: SliderBlend,
    },
    {
      title: 'Stepped range',
      note: 'Humidity snaps to 5-point steps between 40 and 70.',
      component: SliderHumidity,
    },
  ],
};

