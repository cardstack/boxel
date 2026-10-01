import Component from '@glimmer/component';

import { Choreo } from '../choreo.gts';
import motion from '../motion.ts';
import type { FilmHandle } from './types.ts';

export interface GateSignature {
  Args: {
    film: FilmHandle;
  };
  Blocks: {
    default: [FilmHandle];
  };
}

/**
 * THE GATE — the front door. The film is narrated, so the door asks; and
 * the click that answers is the same gesture autoplay policy wants. The
 * scene stands behind it, already seated on the opening frame and
 * turning. What the door SAYS is the film's: the block is the front
 * matter, set in the title package (`cf-matter`, `cf-mg-*`), and the
 * shell here is the museum frame and the wash the type stands on.
 */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Gate extends Component<GateSignature> {
  <template>
    <div class='cf-gate'>
      {{! the museum frame: a hairline border drawn just inside the screen,
      the way a plate is matted }}
      <i class='cf-gate-frame' aria-hidden='true'></i>
      {{yield @film}}
    </div>
  </template>
}

export interface EndCardSignature {
  Args: {
    film: FilmHandle;
  };
  Blocks: {
    default: [FilmHandle];
  };
}

/**
 * THE END CARD. It arrives a moment after the last line has settled, over
 * the held final frame — the film does not loop past its own ending;
 * watching again is the viewer's choice. Back matter is the same package
 * as the front, run in reverse order of importance.
 */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class EndCard extends Component<EndCardSignature> {
  <template>
    <Choreo class='cf-end' as |m|>
      <div class='cf-end-in cf-matter' {{motion id='end' role='card'}}>
        {{yield @film}}
      </div>
      <m.Tween
        @of={{m.inserted 'card'}}
        @delay={{0.7}}
        @opacity={{array 0 1}}
        @y={{array 18 0}}
        @duration={{0.9}}
        @ease={{array 0.22 1 0.36 1}}
      />
      <m.Tween
        @of={{m.removed 'card'}}
        @opacity={{array 1 0}}
        @duration={{0.2}}
        @ease='easeIn'
      />
    </Choreo>
  </template>
}

function array<T>(...items: T[]): T[] {
  return items;
}
