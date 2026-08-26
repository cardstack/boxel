import { array } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { Choreo, motion, spring, to } from 'glimmer-motion';
import config from 'test-app/config/environment';

const notes = ['', 'Hold 1280°', 'Pass 04'] as const;
const labels = ['01  Title', '02  Split', '03  Bleed'] as const;

type Clip = 0 | 1 | 2;

/** Same springs as the Kiln gallery demo — the plate is a real box, the type projects. */
const plate = spring({ bounce: 0.1, visualDuration: 0.52 });
const type = { bounce: 0.14, visualDuration: 0.52 };
const radiusTween = { duration: 0.42, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * When each clip is showing, on a looping conductor clock.
 * The clock only *cuts* (assigns `clip`); Choreo `play()`s the Magic Move.
 */
const CYCLE = 13.2;
const CLIP_AT = [0, 2.4, 6.0, 10.2] as const;

function clipAt(time: number): Clip {
  const local = ((time % CYCLE) + CYCLE) % CYCLE;
  if (local < CLIP_AT[1]) {
    return 0;
  }
  if (local < CLIP_AT[2]) {
    return 1;
  }
  if (local < CLIP_AT[3]) {
    return 2;
  }
  return 0;
}

function radiusFor(clip: Clip) {
  return ['18px', '28px', '0px'][clip]!;
}

/**
 * A separate reel from `/_feature-reel`: three Kiln compositions as clips,
 * Magic-Moved. Same four identities (plate, title, kicker, note); only the
 * stylesheet says where they live. The conductor clock changes `clip` at
 * score thresholds and stops there — the flights ride WAAPI via `play()`.
 */
export class CrossingReel extends Component {
  @tracked clip: Clip = 0;
  private raf = 0;
  private started = 0;
  private autoplay = config.environment !== 'test';

  get note() {
    return notes[this.clip];
  }

  get label() {
    return labels[this.clip];
  }

  register = modifier((el: HTMLElement) => {
    el.closest<HTMLElement>('.app-shell')?.setAttribute(
      'data-layout-ignore',
      ''
    );
    Object.defineProperty(el, 'choreoCrossingReel', {
      configurable: true,
      value: this,
    });
    (
      window as Window & { __choreoCrossingReel?: CrossingReel }
    ).__choreoCrossingReel = this;
    if (this.autoplay) {
      this.started = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
    return () => {
      cancelAnimationFrame(this.raf);
      delete (window as Window & { __choreoCrossingReel?: CrossingReel })
        .__choreoCrossingReel;
      el.closest<HTMLElement>('.app-shell')?.removeAttribute(
        'data-layout-ignore'
      );
    };
  });

  /**
   * Discrete clip cuts only. Interpolating the picture is Choreo's run,
   * playing on the platform — not a still sampled every frame.
   */
  private tick = () => {
    if (this.isDestroying) {
      return;
    }
    const next = clipAt((performance.now() - this.started) / 1000);
    if (next !== this.clip) {
      this.clip = next;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Tests and capture step the clips; live autoplay does not use this. */
  go = (clip: Clip) => {
    this.autoplay = false;
    cancelAnimationFrame(this.raf);
    this.clip = clip;
  };

  <template>
    <div
      class="xreel-viewport"
      data-test-crossing-reel
      data-clip={{this.clip}}
      {{this.register}}
    >
      <p class="xreel-index">{{this.label}}</p>
      <Choreo class="xreel-stage" data-clip={{this.clip}} as |c|>
        {{! Every clip renders the same elements. data-clip on the region
            is the composition — the pass sees movers, not replacements,
            except the note, which is the one thing that comes and goes. }}
        <span
          class="xreel-plate"
          data-test-plate
          {{motion
            id="plate"
            role="plate"
            animate=(to borderRadius=(radiusFor this.clip))
            transition=radiusTween
          }}
        ></span>
        <b
          class="xreel-title"
          data-test-title
          {{motion id="title" role="type" layout=true transition=type}}
        >Kiln</b>
        <small
          class="xreel-kicker"
          {{motion id="kicker" role="type" layout=true transition=type}}
        >Night shift</small>
        {{#if this.note}}
          <em
            class="xreel-note"
            data-test-note
            {{motion id="note" role="note"}}
          >{{this.note}}</em>
        {{/if}}

        <c.Parallel>
          <c.Move @of={{c.moved "plate"}} @spring={{plate}} />
          <c.Tween @of={{c.removed "note"}} @opacity={{0}} @duration={{0.14}} />
          <c.Tween
            @of={{c.inserted "note"}}
            @opacity={{array 0 1}}
            @delay={{0.22}}
            @duration={{0.26}}
          />
        </c.Parallel>
      </Choreo>
    </div>
  </template>
}
