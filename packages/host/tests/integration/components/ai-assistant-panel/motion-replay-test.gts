import {
  waitFor,
  click,
  fillIn,
  settled,
  waitUntil,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import {
  orphanCount,
  setupChoreo,
  strandedTransforms,
} from '@cardstack/choreo/test-support';
import { getService } from '@universal-ember/test-support';

import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import {
  ASSISTANT_MOTION,
  setMotionInTests,
} from '@cardstack/host/components/ai-assistant/motion/tokens';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupOperatorModeStateCleanup,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../../../helpers';
import { createRoomReplay } from '../../../helpers/ai-room-replay';
import { setupStageViewport } from '../../../helpers/choreo-gallery-stage';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';
import { TranscriptMotionProbe } from '../../../helpers/transcript-motion-probe';

import type { RoomReplayFixture } from '../../../helpers/ai-room-replay';

// Every recorded room under tests/fixtures/ai-room-replay. `local/` is
// gitignored: rooms exported from real sessions go there, run here on the
// machine that has them, and never reach the repository. Vite compiles this
// module as ES, where `import.meta.glob` is defined; the package type-checks
// under `nodenext` as CommonJS, which rejects the syntax.
// @ts-expect-error TS1470, as above
const FIXTURES = import.meta.glob<RoomReplayFixture>(
  '../../../fixtures/ai-room-replay/**/*.json',
  { eager: true, import: 'default' },
) as Record<string, RoomReplayFixture>;

// For watching a replay rather than checking it, on the test page:
//   ?filter=motion replay&replaySpeed=0.25&replayHold&replayTrace
// `replaySpeed` plays the recording slower (or faster), `replayHold` keeps
// the panel up once it ends (`resumeReplay()` in the console lets the test
// finish), and `replayTrace` logs every frame the probe saw.
const params = new URLSearchParams(window.location.search);
const SPEED = Number(params.get('replaySpeed') ?? 1) || 1;
const HOLD = params.has('replayHold');
const TRACE = params.has('replayTrace');

const TRANSCRIPT = '[data-test-transcript-motion]';
const VIEWPORT = '[data-test-pretui-stick-to-bottom-viewport]';
const USER = '@testuser:localhost';

module('Integration | ai-assistant-panel | motion replay', function (hooks) {
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupChoreo(hooks);
  // the panel at the size it has beside a desktop workspace, unscaled
  setupStageViewport(hooks, { width: 1440, height: 860 });

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
    setMotionInTests(ASSISTANT_MOTION, true);
  });
  hooks.afterEach(function () {
    setMotionInTests(ASSISTANT_MOTION, false);
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: USER,
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');
    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'realm.json': realmConfigCardJSON({ name: 'Test Workspace' }),
        },
      });
    });
  });

  async function renderAiAssistantPanel() {
    operatorModeStateService.restore({ stacks: [[]] });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-open-ai-assistant]');
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-settled]');
    let roomId = document
      .querySelector('[data-test-room]')
      ?.getAttribute('data-test-room');
    if (!roomId) {
      throw new Error('Expected a room ID');
    }
    return roomId;
  }

  // The reader at the end, following, as they are while a turn they just
  // asked for plays out. History lands with the transcript at its top, so
  // scrolling down to the end is the reader reaching it.
  async function followTheEnd() {
    let viewport = document.querySelector<HTMLElement>(VIEWPORT)!;
    await waitUntil(
      () => {
        if (viewport.dataset.following !== 'true') {
          viewport.scrollTop = viewport.scrollHeight;
        }
        return viewport.dataset.following === 'true';
      },
      { timeoutMessage: 'the transcript never started following its end' },
    );
  }

  // the reader's prompt, sent as they sent it: from the composer
  async function sendPrompt(body: string) {
    await fillIn('[data-test-message-field]', body);
    await click('[data-test-send-message-btn]');
  }

  for (let [path, fixture] of Object.entries(FIXTURES)) {
    let name = path.replace(/^.*ai-room-replay\//, '').replace(/\.json$/, '');

    test(`${name}: ${fixture.description}`, async function (assert) {
      assert.timeout(180_000);
      // the session as the reader found it, read to the end, opened before
      // the turn: its history lands before the transcript's motion wakes,
      // so none of it animates, and with nothing unread the room has no
      // first unread message to take them to
      let roomId = mockMatrixUtils.createAndJoinRoom({
        sender: USER,
        name: `replay ${name}`,
      });
      let probe = new TranscriptMotionProbe();
      let replay = createRoomReplay(fixture, {
        roomId,
        mockMatrixUtils,
        userId: USER,
        speed: SPEED,
        onEvent: (label) => probe.mark(label),
        sendPrompt,
      });
      await replay.history();
      let opened = await renderAiAssistantPanel();
      assert.strictEqual(
        opened,
        roomId,
        'the panel opens the replayed session',
      );
      await settled();
      await waitFor(`${TRANSCRIPT}[data-test-transcript-motion="awake"]`, {
        timeout: 10_000,
      });
      await followTheEnd();

      probe.begin();
      await replay.play();
      await settled();
      await animationsSettled({ timeout: 10_000 });
      probe.end();

      let report = probe.report(fixture.limits);
      if (TRACE) {
        console.log(`motion replay ${name}\n${probe.fullTrace()}`);
      }
      // a replay the regions slept through checks nothing
      assert.true(
        report.frames.some((frame) => frame.messages.some((m) => m.ty !== 0)),
        `the transcript's motion played (${report.frames.length} frames)`,
      );
      let issues = (kind: string) =>
        report.issues.filter((issue) => issue.kind === kind);
      let explain = (kind: string) =>
        issues(kind)
          .slice(0, 6)
          .map((issue) => `f${issue.frame}: ${issue.detail}`)
          .join('\n') + `\n\n${report.trace}`;

      assert.strictEqual(
        issues('scaled').length,
        0,
        `no message or tool row is ever scaled\n${explain('scaled')}`,
      );
      assert.strictEqual(
        issues('overlap').length,
        0,
        `no message paints over the next\n${explain('overlap')}`,
      );
      assert.strictEqual(
        issues('jump').length,
        0,
        `no message on screen jumps in one frame (largest step ${report.largestStep}px)\n${explain('jump')}`,
      );
      assert.strictEqual(
        issues('cancelled-glide').length,
        0,
        `no move is cancelled out by the scroll\n${explain('cancelled-glide')}`,
      );
      let transcript = document.querySelector<HTMLElement>(TRANSCRIPT)!;
      assert.strictEqual(
        orphanCount(transcript),
        0,
        'every leaver has left the orphan layer',
      );
      assert.deepEqual(
        strandedTransforms(transcript),
        [],
        'nothing is left wearing a transform',
      );

      if (HOLD) {
        // the panel stays up for a look; `resumeReplay()` ends the test
        assert.timeout(24 * 60 * 60 * 1000);
        await new Promise<void>((resolve) => {
          (globalThis as { resumeReplay?: () => void }).resumeReplay = resolve;
        });
      }
    });
  }
});
