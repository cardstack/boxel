/**
 * Runnable examples distilled from the realm-collaboration gateway POCs.
 *
 * The source realm contains 88 static declarations: 53 `jq`-tagged and 35
 * plain template programs. This committed corpus
 * keeps representative expressions self-contained so CI does not depend on a
 * sibling checkout while preserving the production envelope and raw-jq mode.
 * Use `npm run audit:realm-bxl -- <realm-path>` to compile every declaration
 * in a live realm checkout.
 */

import type {
  BxlAttachment,
  BxlProfile,
  ReadableSchema,
} from '../src/index.js';

export type RealmCollaborationStage =
  | 'admission'
  | 'rejection-reason'
  | 'state-transition'
  | 'event-projection'
  | 'clock-transition'
  | 'decision-test';

export interface RealmCollaborationExample {
  id: string;
  useCase: string;
  stage: RealmCollaborationStage;
  sourceRef: string;
  /** Omitted for direct prepare/evaluate call sites that do not assert a profile. */
  profile?: BxlProfile;
  attachment?: BxlAttachment;
  readableSyntax?: boolean;
  schema?: ReadableSchema;
  feature: string;
  expression: string;
  input: unknown;
  expected: unknown;
}

const streamHarness = 'POCs/stream-policy-harness/stream-policy-harness.gts';
const ledgerLab = 'POCs/ledger-lab/ledger-lab-gateway.gts';
const liveAuctionLab = 'POCs/live-auction-lab';
const matrixBot = 'POCs/matrix-bot-architecture';

const policyRuleSchema: ReadableSchema = {
  fields: [
    {
      key: 'seat',
      label: 'Seat',
      kind: 'object',
      fields: [{ key: 'status', label: 'Status' }],
    },
  ],
};

const transcriptSchema: ReadableSchema = {
  fields: [
    {
      key: 'attachments',
      label: 'Attachment',
      kind: 'array',
      item: {
        fields: [
          { key: 'type', label: 'Type' },
          {
            key: 'card',
            label: 'Card',
            kind: 'object',
            fields: [{ key: 'status', label: 'Status' }],
          },
        ],
      },
    },
  ],
};

const cells = [
  { cell: 0, mark: 'X' },
  { cell: 1, mark: 'X' },
  { cell: 2, mark: '' },
  { cell: 3, mark: 'O' },
  { cell: 4, mark: 'O' },
  { cell: 5, mark: '' },
  { cell: 6, mark: '' },
  { cell: 7, mark: '' },
  { cell: 8, mark: '' },
];

const questions = [
  {
    questionId: 'q-1',
    prompt: 'Which language powers BXL?',
    choiceA: 'jq',
    choiceB: 'SQL',
    choiceC: 'CSS',
    correctChoice: 'A',
  },
  {
    questionId: 'q-2',
    prompt: 'Who supplies the trusted clock?',
    choiceA: 'The expression',
    choiceB: 'The gateway',
    choiceC: 'The browser',
    correctChoice: 'B',
  },
];

const oldOverlay = Array.from({ length: 12 }, (_, index) => ({
  eventId: `old-${index}`,
  kind: 'chat',
}));

export const realmCollaborationInventory = {
  staticDeclarations: 88,
  taggedDeclarations: 53,
  plainTemplateDeclarations: 35,
  bySource: {
    'collaboration-by-example.gts': 2,
    [streamHarness]: 27,
    [ledgerLab]: 24,
    [`${liveAuctionLab}/agent-activity-plan.mjs`]: 7,
    [`${liveAuctionLab}/auction-bid-segment.gts`]: 7,
    [`${liveAuctionLab}/auction-stream-plan.mjs`]: 7,
    [`${liveAuctionLab}/crypto-ticker-plan.mjs`]: 7,
    [`${liveAuctionLab}/spatial-presence-plan.mjs`]: 7,
  },
  byProfile: {
    policy: 15,
    derive: 73,
  },
} as const;

export const realmCollaborationExamples: RealmCollaborationExample[] = [
  {
    id: 'auction-window-admission',
    useCase: 'Auction bid admission',
    stage: 'admission',
    sourceRef: 'collaboration-by-example.gts',
    profile: 'policy',
    attachment: 'writeAccess',
    feature: 'A pure Boolean gate over state, trusted time facts, and input.',
    expression: `
      .state.status == "running"
        and (.derived.beforeOpen | not)
        and (.derived.afterClose | not)
        and (.input.amount >= (.state.currentBid + .state.minIncrement))
    `,
    input: {
      state: { status: 'running', currentBid: 100, minIncrement: 10 },
      derived: { beforeOpen: false, afterClose: false },
      input: { amount: 115 },
    },
    expected: true,
  },
  {
    id: 'ticket-seat-admission',
    useCase: 'Movie-ticket seat reservation',
    stage: 'admission',
    sourceRef: streamHarness,
    profile: 'policy',
    attachment: 'writeAccess',
    feature: 'Root capture inside any() keeps command input visible in item scope.',
    expression: `
      . as $root
      | (.state.status == "selling")
        and any(
          .state.seats[];
          (.seatId == $root.input.seatId)
            and (.status == "available")
        )
    `,
    input: {
      state: {
        status: 'selling',
        seats: [
          { seatId: 'A1', status: 'sold' },
          { seatId: 'A2', status: 'available' },
        ],
      },
      input: { seatId: 'A2' },
    },
    expected: true,
  },
  {
    id: 'ticket-seat-rewrite',
    useCase: 'Movie-ticket seat reservation',
    stage: 'state-transition',
    sourceRef: streamHarness,
    profile: 'derive',
    attachment: 'formula',
    feature: 'Immutable array rewrite with map(), item scope, and root capture.',
    expression: `
      . as $root
      | {
          status: .state.status,
          filmTitle: .state.filmTitle,
          showtime: .state.showtime,
          soldCount: (.state.soldCount + 1),
          availableCount: (.state.availableCount - 1),
          lastSeatId: .input.seatId,
          lastBuyerId: .input.buyerId,
          seats: (
            .state.seats
            | map(
                if .seatId == $root.input.seatId then
                  . + { status: "sold", buyerId: $root.input.buyerId }
                else . end
              )
          ),
          updatedAt: .request.receivedAt
        }
    `,
    input: {
      state: {
        status: 'selling',
        filmTitle: 'Root Capture',
        showtime: '2026-07-27T20:00:00Z',
        soldCount: 1,
        availableCount: 1,
        seats: [
          { seatId: 'A1', status: 'sold', buyerId: 'buyer-1' },
          { seatId: 'A2', status: 'available', buyerId: null },
        ],
      },
      input: { seatId: 'A2', buyerId: 'buyer-2' },
      request: { receivedAt: '2026-07-27T19:00:00Z' },
    },
    expected: {
      status: 'selling',
      filmTitle: 'Root Capture',
      showtime: '2026-07-27T20:00:00Z',
      soldCount: 2,
      availableCount: 0,
      lastSeatId: 'A2',
      lastBuyerId: 'buyer-2',
      seats: [
        { seatId: 'A1', status: 'sold', buyerId: 'buyer-1' },
        { seatId: 'A2', status: 'sold', buyerId: 'buyer-2' },
      ],
      updatedAt: '2026-07-27T19:00:00Z',
    },
  },
  {
    id: 'audience-bounded-overlay',
    useCase: 'Live audience overlay',
    stage: 'state-transition',
    sourceRef: streamHarness,
    profile: 'derive',
    attachment: 'formula',
    feature: 'Prepend a projection and retain only the newest 12 entries.',
    expression: `
      [{
        eventId: .eventIdentity,
        kind: .input.kind,
        audienceId: .input.audienceId,
        text: .input.text,
        amount: .input.amount,
        receivedAt: .request.receivedAt
      }] + .state.overlay | .[:12]
    `,
    input: {
      eventIdentity: 'event-new',
      input: { kind: 'chat', audienceId: 'audience-7', text: 'hello', amount: null },
      request: { receivedAt: '2026-07-27T19:01:00Z' },
      state: { overlay: oldOverlay },
    },
    expected: [
      {
        eventId: 'event-new',
        kind: 'chat',
        audienceId: 'audience-7',
        text: 'hello',
        amount: null,
        receivedAt: '2026-07-27T19:01:00Z',
      },
      ...oldOverlay.slice(0, 11),
    ],
  },
  {
    id: 'turn-game-winning-move',
    useCase: 'Turn-based game',
    stage: 'state-transition',
    sourceRef: streamHarness,
    profile: 'derive',
    attachment: 'formula',
    feature: 'Nested map/any/all scopes plus indexed win-line evaluation.',
    expression: `
      . as $root
      | (.state.cells | map(
          if .cell == $root.input.cell then
            . + { mark: $root.player.mark }
          else . end
        )) as $cells
      | [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]] as $lines
      | (any(
          $lines[];
          . as $line
          | all(
              $line[];
              . as $slot
              | $cells[$slot].mark == $root.player.mark
            )
        )) as $won
      | ((($root.state.moveCount + 1) == 9) and ($won | not)) as $draw
      | {
          status: (if $won or $draw then "round-complete" else "playing" end),
          currentPlayerId: (
            if $won or $draw then $root.state.currentPlayerId
            elif $root.player.mark == "X" then "player-o"
            else "player-x" end
          ),
          currentMark: (
            if $won or $draw then $root.player.mark
            elif $root.player.mark == "X" then "O"
            else "X" end
          ),
          moveCount: ($root.state.moveCount + 1),
          scoreX: ($root.state.scoreX + (if $won and $root.player.mark == "X" then 1 else 0 end)),
          scoreO: ($root.state.scoreO + (if $won and $root.player.mark == "O" then 1 else 0 end)),
          drawCount: ($root.state.drawCount + (if $draw then 1 else 0 end)),
          winnerMark: (if $won then $root.player.mark else "" end),
          cells: $cells,
          updatedAt: $root.request.receivedAt
        }
    `,
    input: {
      state: {
        status: 'playing',
        currentPlayerId: 'player-x',
        moveCount: 4,
        scoreX: 2,
        scoreO: 1,
        drawCount: 0,
        cells,
      },
      input: { cell: 2, playerId: 'player-x' },
      player: { mark: 'X' },
      request: { receivedAt: '2026-07-27T19:02:00Z' },
    },
    expected: {
      status: 'round-complete',
      currentPlayerId: 'player-x',
      currentMark: 'X',
      moveCount: 5,
      scoreX: 3,
      scoreO: 1,
      drawCount: 0,
      winnerMark: 'X',
      cells: cells.map((cell) =>
        cell.cell === 2 ? { ...cell, mark: 'X' } : cell,
      ),
      updatedAt: '2026-07-27T19:02:00Z',
    },
  },
  {
    id: 'trivia-duplicate-rejection',
    useCase: 'Timed trivia answers',
    stage: 'rejection-reason',
    sourceRef: streamHarness,
    profile: 'derive',
    attachment: 'formula',
    feature: 'Ordered diagnostic after time-window and duplicate checks.',
    expression: `
      . as $root
      | if .state.status != "running" then "quiz-stopped"
        elif .input.questionId != .state.questionId then "stale-question"
        elif .request.receivedAtMs < .state.opensAtMs then "before-question"
        elif .request.receivedAtMs >= .state.closesAtMs then "question-closed"
        elif (.state.answeredPlayerIds | index($root.input.playerId)) != null then
          "already-answered"
        else "choice-not-allowed" end
    `,
    input: {
      state: {
        status: 'running',
        questionId: 'q-1',
        opensAtMs: 1000,
        closesAtMs: 2000,
        answeredPlayerIds: ['player-1'],
      },
      input: { questionId: 'q-1', playerId: 'player-1', choice: 'B' },
      request: { receivedAtMs: 1500 },
    },
    expected: 'already-answered',
  },
  {
    id: 'trivia-clock-advance',
    useCase: 'Timed trivia clock',
    stage: 'clock-transition',
    sourceRef: streamHarness,
    profile: 'derive',
    attachment: 'formula',
    feature: 'Modulo wraparound and indexed selection from gateway-supplied time.',
    expression: `
      ((.state.questionIndex + 1) % (.state.questions | length)) as $next
      | .state.questions[$next] as $q
      | {
          status: .state.status,
          questionIndex: $next,
          questionId: $q.questionId,
          prompt: $q.prompt,
          choiceA: $q.choiceA,
          choiceB: $q.choiceB,
          choiceC: $q.choiceC,
          correctChoice: $q.correctChoice,
          opensAt: .request.receivedAt,
          closesAt: .request.closesAt,
          answerCount: 0,
          choiceACount: 0,
          choiceBCount: 0,
          choiceCCount: 0,
          correctCount: 0,
          answeredPlayerIds: [],
          questions: .state.questions,
          updatedAt: .request.receivedAt
        }
    `,
    input: {
      state: { status: 'running', questionIndex: 1, questions },
      request: {
        receivedAt: '2026-07-27T19:03:00Z',
        closesAt: '2026-07-27T19:03:10Z',
      },
    },
    expected: {
      status: 'running',
      questionIndex: 0,
      questionId: 'q-1',
      prompt: 'Which language powers BXL?',
      choiceA: 'jq',
      choiceB: 'SQL',
      choiceC: 'CSS',
      correctChoice: 'A',
      opensAt: '2026-07-27T19:03:00Z',
      closesAt: '2026-07-27T19:03:10Z',
      answerCount: 0,
      choiceACount: 0,
      choiceBCount: 0,
      choiceCCount: 0,
      correctCount: 0,
      answeredPlayerIds: [],
      questions,
      updatedAt: '2026-07-27T19:03:00Z',
    },
  },
  {
    id: 'live-auction-daemon-admission',
    useCase: 'Live auction daemon plan',
    stage: 'admission',
    sourceRef: `${liveAuctionLab}/auction-stream-plan.mjs`,
    profile: 'policy',
    attachment: 'writeAccess',
    feature: 'A plain template declaration checks normalized time, bidder readiness, budget, and increment.',
    expression: `
      (.targetUpcomingRound == false)
      and (.state.status == "running")
      and (.state.opensAtMs != null)
      and (.state.effectiveCloseMs != null)
      and (.request.receivedAtMs >= .state.opensAtMs)
      and (.request.receivedAtMs < .state.effectiveCloseMs)
      and (.bidder.agentStatus == "ready")
      and (.input.amount <= .bidder.maxBudget)
      and (.input.amount >= (.state.currentBid + .state.minIncrement))
    `,
    input: {
      targetUpcomingRound: false,
      state: {
        status: 'running',
        opensAtMs: 1000,
        effectiveCloseMs: 2000,
        currentBid: 100,
        minIncrement: 10,
      },
      request: { receivedAtMs: 1500 },
      bidder: { agentStatus: 'ready', maxBudget: 200 },
      input: { amount: 125 },
    },
    expected: true,
  },
  {
    id: 'agent-activity-allowlist',
    useCase: 'Agent activity ledger',
    stage: 'admission',
    sourceRef: ledgerLab,
    profile: 'policy',
    attachment: 'writeAccess',
    feature: 'Corrected root-captured allowlist membership, null fallback, and nullable range validation.',
    expression: `
      . as $root
      | $root.config.enabled
        and ($root.state.status == "running")
        and $root.derived.actorEnabled
        and ((($root.input.summary // "") | length) > 0)
        and ([$root.input.kind] | inside($root.config.allowedKinds))
        and (
          ($root.input.progress == null)
            or (($root.input.progress >= $root.config.progressMin)
              and ($root.input.progress <= $root.config.progressMax))
        )
    `,
    input: {
      config: {
        enabled: true,
        allowedKinds: ['run-started', 'progress', 'completed', 'failed'],
        progressMin: 0,
        progressMax: 100,
      },
      state: { status: 'running' },
      derived: { actorEnabled: true },
      input: { kind: 'thinking', summary: 'private chain of thought', progress: null },
    },
    expected: false,
  },
  {
    id: 'spatial-position-rejection',
    useCase: 'Spatial presence',
    stage: 'rejection-reason',
    sourceRef: ledgerLab,
    profile: 'derive',
    attachment: 'formula',
    feature: 'A stable reason plus the corrected root-captured allowlist lookup.',
    expression: `
      . as $root
      | if ($root.config.enabled | not) then "profile-disabled"
      elif ($root.state.status != "running") then "session-closed"
      elif ($root.derived.actorEnabled | not) then "actor-disabled"
      elif ([$root.input.kind] | inside($root.config.allowedKinds) | not) then "action-kind-not-allowed"
      elif ($root.input.kind == "move") then "position-out-of-bounds"
      else "message-required" end
    `,
    input: {
      config: { enabled: true, allowedKinds: ['move', 'chat'] },
      state: { status: 'running' },
      derived: { actorEnabled: true },
      input: { kind: 'move', x: 101, y: 50 },
    },
    expected: 'position-out-of-bounds',
  },
  {
    id: 'market-tick-state',
    useCase: 'Treasury market ticks',
    stage: 'state-transition',
    sourceRef: ledgerLab,
    profile: 'derive',
    attachment: 'formula',
    feature: 'Merge a validated tick into the projection without changing holdings.',
    expression: `
      .state + {
        tickCount: (.state.tickCount + 1),
        latestAsset: .input.asset,
        latestPrice: .input.price,
        portfolioValue: .derived.revaluedPortfolio,
        updatedAt: .request.receivedAt
      }
    `,
    input: {
      state: {
        status: 'running',
        tickCount: 7,
        rejectionCount: 1,
        latestAsset: 'ETH',
        latestPrice: 3200,
        portfolioValue: 50000,
        holdings: [{ asset: 'BTC', quantity: 1 }],
        updatedAt: '2026-07-27T18:00:00Z',
      },
      input: { asset: 'BTC', price: 70000 },
      derived: { revaluedPortfolio: 70000 },
      request: { receivedAt: '2026-07-27T19:04:00Z' },
    },
    expected: {
      status: 'running',
      tickCount: 8,
      rejectionCount: 1,
      latestAsset: 'BTC',
      latestPrice: 70000,
      portfolioValue: 70000,
      holdings: [{ asset: 'BTC', quantity: 1 }],
      updatedAt: '2026-07-27T19:04:00Z',
    },
  },
  {
    id: 'auction-rejected-ledger-entry',
    useCase: 'Auction attempt ledger',
    stage: 'event-projection',
    sourceRef: ledgerLab,
    profile: 'derive',
    attachment: 'formula',
    feature: 'Rejected attempts are projected as durable records, not discarded.',
    expression: `
      {
        bidSeq: .attemptSequence,
        bidderId: .derived.bidderId,
        bidderName: .derived.bidderName,
        amount: .input.amount,
        placedAt: .request.receivedAt,
        decision: "rejected",
        reason: .decision.reason,
        boundaryAt: .derived.boundaryAt,
        offsetMs: .derived.offsetMs
      }
    `,
    input: {
      attemptSequence: 42,
      derived: {
        bidderId: 'bidder-9',
        bidderName: 'Priya',
        boundaryAt: '2026-07-27T19:05:00Z',
        offsetMs: 12,
      },
      input: { amount: 125 },
      request: { receivedAt: '2026-07-27T19:05:00.012Z' },
      decision: { reason: 'after-close' },
    },
    expected: {
      bidSeq: 42,
      bidderId: 'bidder-9',
      bidderName: 'Priya',
      amount: 125,
      placedAt: '2026-07-27T19:05:00.012Z',
      decision: 'rejected',
      reason: 'after-close',
      boundaryAt: '2026-07-27T19:05:00Z',
      offsetMs: 12,
    },
  },
  {
    id: 'decision-table-facts',
    useCase: 'Matrix-bot decision table',
    stage: 'decision-test',
    sourceRef: `${matrixBot}/box-office/decision-table-test.gts`,
    feature: 'Direct prepareBxlSafe() derives inspectable facts before table matching.',
    expression: `
      . as $test
      | ((.command.seatId | type) == "string"
          and (.command.seatId | length) > 0
          and (.command.maxPriceCents | type) == "number"
          and .command.maxPriceCents >= 0
          and .command.quantity == 1) as $schemaOK
      | ($schemaOK and .saleStatus == "selling") as $saleReady
      | ([.seats[] | select(.seatId == $test.command.seatId)][0]) as $seat
      | ($saleReady and $seat != null) as $seatKnown
      | ($seatKnown and $seat.status == "open") as $seatOpen
      | ($seatOpen and $seat.priceCents <= .command.maxPriceCents) as $withinLimit
      | {
          schemaOK: $schemaOK,
          saleReady: $saleReady,
          seatKnown: $seatKnown,
          seatOpen: $seatOpen,
          withinLimit: $withinLimit
        }
    `,
    input: {
      saleStatus: 'selling',
      command: { seatId: 'D3', maxPriceCents: 6800, quantity: 1 },
      seats: [
        { seatId: 'D2', priceCents: 6800, status: 'sold' },
        { seatId: 'D3', priceCents: 6800, status: 'open' },
      ],
    },
    expected: {
      schemaOK: true,
      saleReady: true,
      seatKnown: true,
      seatOpen: true,
      withinLimit: true,
    },
  },
  {
    id: 'decision-table-generated-program',
    useCase: 'Matrix-bot decision table',
    stage: 'decision-test',
    sourceRef: `${matrixBot}/box-office/decision-table-test.gts`,
    feature: 'A generated def applies editable true/false/any cells to derived facts.',
    expression: `
      def _bxl_skill_expectation_matches($input):
        ($input.expected as $expected
         | $input.actual as $actual
         | (if $expected == "any" then true
            elif $expected == "true" then $actual == true
            else $actual == false end));
      . as $input
      | [
          .rules[]
          | select(.enabled == true)
          | . as $rule
          | select(
              _bxl_skill_expectation_matches({ expected: $rule.saleReady, actual: $input.facts.saleReady })
              and _bxl_skill_expectation_matches({ expected: $rule.seatOpen, actual: $input.facts.seatOpen })
            )
        ]
    `,
    input: {
      facts: { saleReady: true, seatOpen: true },
      rules: [
        { ruleId: 'reject-closed', saleReady: 'false', seatOpen: 'any', enabled: true },
        { ruleId: 'grant-open', saleReady: 'true', seatOpen: 'true', enabled: true },
      ],
    },
    expected: [
      { ruleId: 'grant-open', saleReady: 'true', seatOpen: 'true', enabled: true },
    ],
  },
  {
    id: 'readable-policy-rule',
    useCase: 'Matrix-bot policy ladder',
    stage: 'admission',
    sourceRef: `${matrixBot}/PolicyRule/r2-grant-asked-seat.json`,
    profile: 'policy',
    attachment: 'writeAccess',
    readableSyntax: true,
    schema: policyRuleSchema,
    feature: 'Card-authored readable condition text evaluates against a schema projection.',
    expression: 'Seat.Status = "open"',
    input: { seat: { status: 'open' } },
    expected: true,
  },
  {
    id: 'readable-workflow-gate',
    useCase: 'Matrix-bot workflow gate',
    stage: 'admission',
    sourceRef: `${matrixBot}/BoxOfficeWorkflow/theo-happy-path.json`,
    profile: 'policy',
    attachment: 'writeAccess',
    readableSyntax: true,
    schema: transcriptSchema,
    feature: 'A persisted readable gate completes only when a matching attachment exists.',
    expression: 'present(Attachment[Type = "ticket-request"])',
    input: {
      attachments: [
        { type: 'decision', card: { status: 'grant' } },
        { type: 'ticket-request', card: { status: 'submitted' } },
      ],
    },
    expected: true,
  },
  {
    id: 'decision-table-expectation',
    useCase: 'Matrix-bot decision table',
    stage: 'decision-test',
    sourceRef: `${matrixBot}/DecisionTableTest/bxl-skill.json`,
    profile: 'derive',
    attachment: 'formula',
    feature: 'A tri-state expected value checks recorded policy decisions; the prefix models skill-supplied variables.',
    expression: `
      .expected as $expected
      | .actual as $actual
      |
      if $expected == "any" then true
      elif $expected == "true" then $actual == true
      else $actual == false end
    `,
    input: { expected: 'true', actual: true },
    expected: true,
  },
  {
    id: 'decision-trace-seat-price',
    useCase: 'Matrix-bot stored decision trace',
    stage: 'decision-test',
    sourceRef: `${matrixBot}/StyledDecisionTest/box-office-sale.json`,
    profile: 'derive',
    attachment: 'formula',
    feature: 'A recorded condition from the decision audit trail remains executable.',
    expression: `
      .schemaValid
        and .saleStatus == "selling"
        and .seat.status == "open"
        and .seat.priceCents <= .command.maxPriceCents
    `,
    input: {
      schemaValid: true,
      saleStatus: 'selling',
      seat: { status: 'open', priceCents: 2500 },
      command: { maxPriceCents: 3000 },
    },
    expected: true,
  },
];
