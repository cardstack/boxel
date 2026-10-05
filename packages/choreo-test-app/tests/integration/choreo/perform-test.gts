/**
 * `<c.Perform>` — the semantic command fold, promoted into core
 * (docs/choreo-composition.md §C4; the compositor host's cue fold is the
 * proof that opened this gate).
 *
 * The law under every case: the set of commands at or before the clock IS
 * the commanded state. Forward playback dispatches each once as the clock
 * crosses it; a seek that lands past a command includes it; a seek that
 * lands before a command the host already holds resets the host and
 * replays the remaining prefix, in order. Repeated seeks are idempotent.
 * Commands are idempotent statements of state by contract — that is what
 * makes a replay a re-derivation, not a glitch.
 */
import { render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import {
  Choreo,
  type ChoreoContext,
  motion,
  type PerformCommand,
} from 'glimmer-motion';
import { setupChoreo } from 'glimmer-motion/choreo/test-support';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

let ctx: ChoreoContext | undefined;
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

/**
 * Three commands on a half-second clock: `lamp.on` at 0, `mode.set` (with
 * a payload) at 0.2, `lamp.off` at 0.4. The log records every dispatch
 * and every reset, in the order the host saw them.
 */
class PerformApp extends Component<{
  Args: { seize?: (self: PerformApp) => void };
}> {
  log: string[] = [];
  payloads: unknown[] = [];
  @tracked take = 0;
  constructor(owner: unknown, args: { seize?: (self: PerformApp) => void }) {
    super(owner as never, args as never);
    args.seize?.(this);
  }
  dispatch = (command: PerformCommand) => {
    this.log.push(
      `${command.action}@${command.time}` +
        (command.target ? `>${command.target}` : '')
    );
    this.payloads.push(command.payload);
  };
  reset = () => {
    this.log.push('reset');
  };
  <template>
    <Choreo
      class="stage"
      style="position:relative;width:300px;height:200px"
      @onPerform={{this.dispatch}}
      @onPerformReset={{this.reset}}
      as |c|
    >
      {{grab c}}
      <div
        data-take={{this.take}}
        style="position:absolute;top:20px;left:20px;width:40px;height:20px;background:#0af"
        {{motion id="subject" role="subject"}}
      ></div>
      <c.Sequence>
        <c.Perform @action="lamp.on" @target="lamp" />
        <c.Wait @duration={{0.2}} />
        <c.Perform @action="mode.set" @payload={{2}} />
        <c.Wait @duration={{0.2}} />
        <c.Perform @action="lamp.off" @target="lamp" />
        <c.Wait @duration={{0.1}} />
      </c.Sequence>
    </Choreo>
  </template>
}

async function mount() {
  let app: PerformApp | undefined;
  const seize = (self: PerformApp) => (app = self);
  await render(<template><PerformApp @seize={{seize}} /></template>);
  await animationsSettled();
  return app!;
}

/** one command parked behind a gate at 0.2 — the click-to-continue case */
class GatedApp extends Component<{
  Args: { seize?: (self: GatedApp) => void };
}> {
  log: string[] = [];
  @tracked take = 0;
  constructor(owner: unknown, args: { seize?: (self: GatedApp) => void }) {
    super(owner as never, args as never);
    args.seize?.(this);
  }
  dispatch = (command: PerformCommand) => {
    this.log.push(command.action);
  };
  <template>
    <Choreo
      class="stage"
      style="position:relative;width:300px;height:200px"
      @onPerform={{this.dispatch}}
      as |c|
    >
      {{grab c}}
      <div
        data-take={{this.take}}
        style="position:absolute;top:20px;left:20px;width:40px;height:20px;background:#0af"
        {{motion id="subject" role="subject"}}
      ></div>
      <c.Sequence>
        <c.Perform @action="early.on" />
        <c.Wait @duration={{0.2}} />
        <c.Gate />
        <c.Perform @action="late.on" />
        <c.Wait @duration={{0.1}} />
      </c.Sequence>
    </Choreo>
  </template>
}

module('Integration | choreo | perform', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('forward playback dispatches each command once, in order, with its payload', async function (assert) {
    const app = await mount();
    app.take = 1;
    await animationsSettled();
    await frames(2);
    assert.deepEqual(
      app.log,
      ['lamp.on@0>lamp', 'mode.set@0.2', 'lamp.off@0.4>lamp'],
      'three commands, three dispatches, timeline order'
    );
    assert.strictEqual(
      app.payloads[1],
      2,
      'the payload rides the command to the host'
    );
  });

  test('a direct seek includes the whole prefix, and repeating it adds nothing', async function (assert) {
    const app = await mount();
    app.take = 1;
    await frames(1);
    const run = ctx!.run!;
    run.pause();
    run.time = 0.45;
    await frames(2);
    assert.deepEqual(
      app.log,
      ['lamp.on@0>lamp', 'mode.set@0.2', 'lamp.off@0.4>lamp'],
      'a seek past every command dispatches the full prefix in order'
    );
    run.time = 0.45;
    await frames(2);
    assert.deepEqual(
      app.log,
      ['lamp.on@0>lamp', 'mode.set@0.2', 'lamp.off@0.4>lamp'],
      'the same seek again is idempotent'
    );
  });

  test('a backward seek resets the host and replays the remaining prefix', async function (assert) {
    const app = await mount();
    app.take = 1;
    await frames(1);
    const run = ctx!.run!;
    run.pause();
    run.time = 0.45;
    await frames(2);
    app.log.length = 0;

    run.time = 0.3;
    await frames(2);
    assert.deepEqual(
      app.log,
      ['reset', 'lamp.on@0>lamp', 'mode.set@0.2'],
      'stepping back before lamp.off resets and replays the two before it'
    );

    app.log.length = 0;
    run.time = 0.1;
    await frames(2);
    assert.deepEqual(
      app.log,
      ['reset', 'lamp.on@0>lamp'],
      'stepping back again folds down to the first command alone'
    );
  });

  test('a command behind an unopened gate waits for advance', async function (assert) {
    let app: GatedApp | undefined;
    const seize = (self: GatedApp) => (app = self);
    await render(<template><GatedApp @seize={{seize}} /></template>);
    await animationsSettled();
    app!.take = 1;
    await frames(1);
    const run = ctx!.run!;
    run.pause();
    // seeking across the unopened gate parks AT the gate — the command
    // beyond it is not part of any state the clock has reached
    run.time = 0.3;
    await frames(2);
    assert.deepEqual(
      app!.log,
      ['early.on'],
      'the parked clock holds only the prefix before the gate'
    );
    ctx!.advance();
    await animationsSettled();
    await frames(2);
    assert.deepEqual(
      app!.log,
      ['early.on', 'late.on'],
      'advancing through the gate dispatches what waited behind it'
    );
  });
});
