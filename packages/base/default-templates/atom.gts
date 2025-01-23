import GlimmerComponent from '@glimmer/component';
import { type CardDef, isCompoundField } from '../card-api';
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
    if (typeof this.args.model.title === 'string') {
      return this.args.model.title.trim();
    }
    if (isCompoundField(this.args.model)) {
      return;
    }
    return `Untitled ${this.args.model.constructor.displayName}`;
  }
  <template>
    <span class={{cn 'atom-default-template' empty-field=(not @model)}}>
      {{this.text}}
    </span>
  </template>
}
