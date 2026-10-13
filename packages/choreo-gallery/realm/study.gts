import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import type { ComponentLike } from '@glint/template';

import { ownClicks } from './lib/pointer';
import { ChoreoRoot } from './shell/choreo-root';

class Rendered extends Component<typeof GuideStudy> {
  get Study() {
    return (this.args.model.constructor as typeof GuideStudy).study;
  }

  <template>
    <ChoreoRoot class='study' {{ownClicks}}>
      {{#if this.Study}}
        <this.Study />
      {{/if}}
    </ChoreoRoot>
    <style scoped>
      .study {
        padding: 4px;
      }
    </style>
  </template>
}

class Fitted extends Component<typeof GuideStudy> {
  <template>
    <ChoreoRoot class='fitted'>
      <span class='fitted-kicker'>Guide study</span>
      <span class='fitted-title'>{{@model.title}}</span>
    </ChoreoRoot>
    <style scoped>
      .fitted {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 4px;
        height: 100%;
        padding: 10px 12px;
        overflow: hidden;
      }

      .fitted-kicker {
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ember-hot);
      }

      .fitted-title {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 1rem;
        letter-spacing: -0.03em;
        line-height: 1.1;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
}

/**
 * The small application a first-steps guide builds, live in the guide that
 * builds it. A subclass per study, in `studies/`, supplies the component as
 * the class's `study`; the guide embeds its instance.
 */
export class GuideStudy extends CardDef {
  static displayName = 'Choreo Guide Study';

  /** the application the guide builds */
  static study: ComponentLike | undefined;

  @field title = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: GuideStudy) {
      return this.title;
    },
  });

  static isolated = Rendered;
  static embedded = Rendered;
  static fitted = Fitted;
}
