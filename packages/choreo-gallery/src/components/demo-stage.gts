import Component from '@glimmer/component';
import {
  SagradaFrameStage,
  SylvaFrameStage,
  TowersFrameStage,
} from 'choreo-gallery/components/special-stages';
import { configureAssetRoot } from 'choreo-gallery/config/environment';
import { createCatalog } from 'choreo-gallery/lib/catalog';

const catalog = createCatalog({
  SagradaStage: SagradaFrameStage,
  SylvaStage: SylvaFrameStage,
  TowerStage: TowersFrameStage,
});

interface Signature {
  Args: { assetRoot?: string | URL; id: string };
}

/** One canonical demo stage, used by generated Boxel embedded card formats. */
export class DemoStage extends Component<Signature> {
  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args);
    configureAssetRoot(args.assetRoot);
  }

  get demo() {
    return catalog.find((entry) => entry.id === this.args.id);
  }

  <template>
    {{#if this.demo}}
      {{#let this.demo.Example as |Example|}}
        <Example />
      {{/let}}
    {{/if}}
  </template>
}
