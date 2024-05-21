import GlimmerComponent from '@glimmer/component';
import type CardDef from '../../card-def';

export class DefaultAtomViewTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: Record<string, new () => GlimmerComponent>;
  };
}> {
  get text() {
    return (
      this.args.model.title?.trim() ||
      `Untitled ${this.args.model.constructor.displayName}`
    );
  }
  <template>
    {{this.text}}
  </template>
}
