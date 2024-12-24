import GlimmerComponent from '@glimmer/component';
import type { CardDef } from '../card-api';

export default class DefaultAtomViewTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: Record<string, new () => GlimmerComponent>;
  };
}> {
  get text() {
    let title =
      typeof this.args.model.title === 'string'
        ? this.args.model.title.trim()
        : null;

    return title
      ? title
      : `Untitled ${this.args.model.constructor.displayName}`;
  }
  <template>
    <span class='atom-default-template'>
      {{this.text}}
    </span>
    <style scoped>
      .atom-default-template {
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>
}
