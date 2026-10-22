import Component from '@glimmer/component';

import type { GalleryDemo, StageSignature } from '../demo';
import { labSlug } from '../lib/lab';

interface Signature {
  Args: StageSignature['Args'] & { demo: GalleryDemo };
}

/**
 * A demo's live stage: the component its card class supplies as `stage`, or
 * a placeholder while the demo has no stage of its own yet. It carries the
 * demo's lab slug, which is how a lab finds every stage showing its demo to
 * retime the motion running there; it draws no box of its own.
 */
export class DemoStage extends Component<Signature> {
  get Stage() {
    return (this.args.demo.constructor as typeof GalleryDemo).stage;
  }

  get labSlug() {
    return labSlug(this.args.demo);
  }

  <template>
    <div
      class='demo-stage'
      data-demo-tuning={{this.labSlug}}
      data-test-demo-stage
    >
      {{#if this.Stage}}
        <this.Stage
          @face={{@face}}
          @filmLink={{@filmLink}}
          @open={{@open}}
          @theater={{@theater}}
        />
      {{else}}
        <div class='stage-pending' data-stage-pending>
          <span>Stage coming soon</span>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .demo-stage {
        display: contents;
      }

      .stage-pending {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 16px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }
    </style>
  </template>
}
