import GlimmerComponent from '@glimmer/component';
import type { CardContext, BaseDef, CardDef } from '../card-api';
// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { cardTypeDisplayName } from '@cardstack/runtime-common';
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
      @isEmpty={{this.isEmpty}}
    />
  </template>
}
