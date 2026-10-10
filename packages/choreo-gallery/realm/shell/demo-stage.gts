import Component from '@glimmer/component';

import type { GalleryDemo, StageSignature } from '../demo';

interface Signature {
  Args: StageSignature['Args'] & { demo: GalleryDemo };
}

/**
 * A demo's live stage: the component its card class supplies as `stage`, or
 * a placeholder while the demo has no stage of its own yet.
 */
export class DemoStage extends Component<Signature> {
  get Stage() {
    return (this.args.demo.constructor as typeof GalleryDemo).stage;
  }

  <template>
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
    <style scoped>
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
