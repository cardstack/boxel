import { hash } from '@ember/helper';
import { modifier } from 'ember-modifier';
import {
  motion,
  motionValue,
  styleEffect,
  type MotionValue,
} from 'glimmer-motion';
import { Presence } from 'glimmer-motion/presence';
import { Choreo } from '@cardstack/choreo';
import { Clip } from '@cardstack/choreo/film';
import {
  CardDef,
  Component as CardComponent,
  field,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// glimmer-motion and Choreo are workspace packages rather than boxel-cli
// dependencies: the host shims them into realms, and parse reaches them
// through path aliases onto the bundled source. Each import is used, so a
// module that failed to resolve, or a component whose args no longer
// match, surfaces here as a diagnostic.
const opacity: MotionValue<number> = motionValue(1);
const bindOpacity = modifier((element: HTMLElement) =>
  styleEffect(element, { opacity }),
);
const keyOf = (item: string) => item;

export const filmClip = Clip;

export class Stage extends CardDef {
  static displayName = 'Stage';
  @field title = contains(StringField);

  static isolated = class Isolated extends CardComponent<typeof Stage> {
    items = ['intro', 'outro'];

    <template>
      <h2 {{motion initial=(hash opacity=0) animate=(hash opacity=1)}}>
        {{@model.title}}
      </h2>
      <div {{bindOpacity}}></div>
      <Presence @items={{this.items}} @key={{keyOf}} as |item|>
        <p>{{item}}</p>
      </Presence>
      <Choreo as |c|>
        <c.Tween @of={{c.removed 'card'}} @opacity={{0}} @duration={{0.2}} />
      </Choreo>
    </template>
  };
}
