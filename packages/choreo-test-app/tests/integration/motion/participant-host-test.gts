/**
 * The participant-host extension point (glimmer-motion/participant), driven by
 * a host that is not a <Choreo>: a plain object registered on an ancestor
 * element rendered with `data-motion-host`.
 */
import { hash } from '@ember/helper';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import {
  defineParticipantArg,
  type MotionParticipant,
  type ParticipantHost,
  setParticipantHost,
} from 'glimmer-motion/participant';
import { setupMotion } from 'glimmer-motion/test-support';
import { visualElementStore } from 'motion-dom';
import { module, test } from 'qunit';

import { nextFrame } from '../../helpers/motion';

declare module 'glimmer-motion/participant' {
  interface ParticipantArgs {
    testTag?: string;
  }
}

class RecordingHost implements ParticipantHost {
  log: string[] = [];
  joined: MotionParticipant[] = [];
  claiming = false;

  register(participant: MotionParticipant) {
    this.log.push(`register ${participant.id ?? participant.role}`);
    this.joined.push(participant);
    return () => {
      this.log.push(`leave ${participant.id ?? participant.role}`);
    };
  }

  claim(participant: MotionParticipant) {
    this.log.push(`claim ${participant.id ?? participant.role}`);
    return this.claiming;
  }
}

const hostedBy = modifier((el: Element, [host]: [ParticipantHost]) => {
  setParticipantHost(el, host);
  return () => setParticipantHost(el, undefined);
});

class State {
  @tracked show = true;
  @tracked tag: string | undefined = 'first';
}

module('Integration | motion | participant host', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('an element with an id or a role joins the nearest host on mount', async function (assert) {
    const host = new RecordingHost();
    await render(
      <template>
        <div data-motion-host {{hostedBy host}}>
          <div id="a" {{motion id="a" animate=(hash opacity=1)}}></div>
          <div id="b" {{motion role="tile" animate=(hash opacity=1)}}></div>
          <div id="plain" {{motion animate=(hash opacity=1)}}></div>
        </div>
      </template>
    );
    await nextFrame();

    assert.deepEqual(host.log, ['register a', 'register tile']);
    const [a] = host.joined;
    assert.strictEqual(
      a!.element,
      find('#a'),
      'the participant is the element'
    );
    assert.strictEqual(
      a!.visualElement?.current,
      find('#a'),
      'its VisualElement is mounted on it'
    );
    assert.true(a!.isPresent);
    assert.strictEqual(typeof a!.layoutKey, 'string');
  });

  test('an unclaimed participant unmounts on teardown', async function (assert) {
    const host = new RecordingHost();
    const state = new State();
    await render(
      <template>
        <div data-motion-host {{hostedBy host}}>
          {{#if state.show}}
            <div {{motion id="a" animate=(hash opacity=1)}}></div>
          {{/if}}
        </div>
      </template>
    );
    await nextFrame();
    const [a] = host.joined;
    const ve = a!.visualElement!;

    state.show = false;
    await settled();

    assert.deepEqual(host.log, ['register a', 'leave a', 'claim a']);
    assert.strictEqual(ve.current, null, 'unmounted at teardown');
  });

  test('a claimed participant stays mounted until the host releases it', async function (assert) {
    const host = new RecordingHost();
    host.claiming = true;
    const state = new State();
    await render(
      <template>
        <div data-motion-host {{hostedBy host}}>
          {{#if state.show}}
            <div id="a" {{motion id="a" animate=(hash opacity=1)}}></div>
          {{/if}}
        </div>
      </template>
    );
    await nextFrame();
    const [a] = host.joined;
    const element = find('#a');
    const ve = a!.visualElement!;

    state.show = false;
    await settled();

    assert.deepEqual(host.log, ['register a', 'leave a', 'claim a']);
    assert.strictEqual(ve.current, element, 'the unmount is deferred');

    a!.release();
    assert.strictEqual(ve.current, null, 'release() unmounts it');
    assert.strictEqual(a!.visualElement, undefined);
  });

  test('the nearest marked ancestor decides, and one with no host installed hosts nothing', async function (assert) {
    const outer = new RecordingHost();
    const inner = new RecordingHost();
    await render(
      <template>
        <div data-motion-host {{hostedBy outer}}>
          <div {{motion id="outer" animate=(hash opacity=1)}}></div>
          <div data-motion-host {{hostedBy inner}}>
            <div {{motion id="inner" animate=(hash opacity=1)}}></div>
          </div>
          <div data-motion-host>
            <div {{motion id="unhosted" animate=(hash opacity=1)}}></div>
          </div>
        </div>
      </template>
    );
    await nextFrame();

    assert.deepEqual(outer.log, ['register outer']);
    assert.deepEqual(inner.log, ['register inner']);
  });

  test('a defined participant arg is applied on every pass and kept from the engine', async function (assert) {
    const seen: (string | undefined)[] = [];
    const undefine = defineParticipantArg('testTag', (el, value) => {
      seen.push(value);
      if (value) {
        el.setAttribute('data-test-tag', value);
      } else {
        el.removeAttribute('data-test-tag');
      }
    });
    try {
      const state = new State();
      await render(
        <template>
          <div
            id="m"
            {{motion testTag=state.tag animate=(hash opacity=1)}}
          ></div>
        </template>
      );
      await nextFrame();
      const el = find('#m')!;
      assert.strictEqual(el.getAttribute('data-test-tag'), 'first');

      state.tag = undefined;
      await settled();
      assert.false(el.hasAttribute('data-test-tag'), 'an absent arg clears');
      assert.deepEqual(seen, ['first', undefined]);

      const props = visualElementStore.get(el)!.getProps() as Record<
        string,
        unknown
      >;
      assert.false('testTag' in props, 'the engine never sees it');
    } finally {
      undefine();
    }
  });
});
