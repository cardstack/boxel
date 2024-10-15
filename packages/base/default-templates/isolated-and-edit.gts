import GlimmerComponent from '@glimmer/component';
import type { CardDef, Format } from '../card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { startCase } from 'lodash';
import { getField } from '@cardstack/runtime-common';
import { get } from '@ember/helper';

export default class DefaultCardDefTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: Record<string, new () => GlimmerComponent>;
    format: Format;
  };
}> {
  getFieldIcon = (key: string) => {
    return getField(this.args.model.constructor, key)?.card?.icon;
  };
  <template>
    <div class={{cn 'default-card-template' @format}}>
      {{#each-in @fields as |key Field|}}
        {{#unless (eq key 'id')}}
          {{#if (eq @format 'edit')}}
            {{log (get @model key)}}
            {{log (get (get (getField @model.constructor key) 'card') 'icon')}}
          {{/if}}
          <FieldContainer
            {{! @glint-ignore (glint is arriving at an incorrect type signature for 'startCase') }}
            @label={{startCase key}}
            @icon={{this.getFieldIcon key}}
            data-test-field={{key}}
          >
            <Field />
          </FieldContainer>
        {{/unless}}
      {{/each-in}}
    </div>
    <style scoped>
      .default-card-template {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
      /* this aligns edit fields with containsMany, linksTo, and linksToMany fields */
      .default-card-template.edit
        > .boxel-field
        > :deep(
          *:nth-child(2):not(.links-to-many-editor):not(
              .contains-many-editor
            ):not(.links-to-editor)
        ) {
        padding-right: var(--boxel-icon-lg);
      }
    </style>
  </template>
}
