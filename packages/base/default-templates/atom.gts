import GlimmerComponent from '@glimmer/component';
import type { CardDef } from '../card-api';
import { untitledCardTitle } from '../untitled-card-title';
import { cn, not } from '@cardstack/boxel-ui/helpers';

export default class DefaultAtomViewTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: Record<string, new () => GlimmerComponent>;
  };
}> {
  get text() {
    if (!this.args.model) {
      return;
    }
    if (typeof this.args.model.cardTitle === 'string') {
      return this.args.model.cardTitle.trim();
    }
    return untitledCardTitle(this.args.model.constructor as typeof CardDef);
  }
  <template>
    <span class={{cn 'atom-default-template' empty-field=(not @model)}}>
      {{this.text}}
    </span>
  </template>
}
