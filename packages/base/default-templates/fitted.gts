import GlimmerComponent from '@glimmer/component';
import type { CardContext, BaseDef, CardDef } from '../card-api';
import { cardTypeDisplayName, cardTypeIcon } from '@cardstack/runtime-common';
import { BasicFitted } from '@cardstack/boxel-ui/components';

export default class DefaultFittedTemplate extends GlimmerComponent<{
  Args: {
    cardOrField: typeof BaseDef;
    model: CardDef;
    fields: Record<string, new () => GlimmerComponent>;
    context?: CardContext;
  };
}> {
  get isEmpty() {
    return !this.args.model;
  }
  <template>
    <BasicFitted
      @primary={{@model.title}}
      @secondary={{cardTypeDisplayName @model}}
      @description={{@model.description}}
      @thumbnailURL={{@model.thumbnailURL}}
      @iconComponent={{cardTypeIcon @model}}
      @isEmpty={{this.isEmpty}}
    />
  </template>
}
