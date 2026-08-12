// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api'; // ¹ Standalone brief can move into a factory realm without local module dependencies
import StringField from 'https://cardstack.com/base/string';
import CutRoomIcon from '@cardstack/boxel-icons/clapperboard'; // ² CDN-verified 2026-07-21
import PublicationNav from './components/publication-nav'; // ¹⁴ Standalone publication navigation

interface Concept {
  symbol: string;
  name: string;
}

interface ReuseCard extends Concept {
  source: string;
  use: string;
  proof: string;
}

interface BuildItem extends Concept {
  number: string;
  kind: string;
  purpose: string;
  dependsOn: string;
  acceptance: string;
}

interface FlowStep {
  number: string;
  regime: string;
  title: string;
  action: string;
  input: string;
  output: string;
  gate: string;
}

interface SurfaceProof {
  format: string;
  template: string;
  visual: string;
  judgment: string;
}

interface IssuePlan {
  id: string;
  title: string;
  scope: string;
  dependsOn: string;
  done: string;
}

interface Scenario {
  label: string;
  source: string;
  result: string;
  proves: string;
}

const REUSE_CARDS: ReuseCard[] = [ // ³ Exactly five userland CardDefs, counted only after live verification
  { symbol: 'Pe', name: 'Person', source: 'Common records', use: 'Creator, guest, editor, brand reviewer, and accountable approving actor.', proof: 'Real module renders and links without a CutRoom identity wrapper.' },
  { symbol: 'Pr', name: 'Project', source: 'Common records', use: 'The show, episode, or campaign context that owns the source and release objective.', proof: 'Can hold ownership, dates, participants, status, and related work through existing contracts.' },
  { symbol: 'Ta', name: 'Task', source: 'Common records', use: 'Corrections, claim research, caption review, sponsor notes, and publishing follow-up.', proof: 'Assignment, due date, status, and linked context work unchanged.' },
  { symbol: 'Ca', name: 'Campaign', source: 'Marketing kit', use: 'The destination campaign that groups platforms, audience, launch window, and approved assets.', proof: 'A loadable marketing-kit CardDef accepts CutRoom outputs by relationship.' },
  { symbol: 'Jo', name: 'Job', source: 'BSL run record', use: 'Typed execution receipt for extraction, AI ranking, generation, and finalization.', proof: 'Records command, inputs, outputs, actor, timing, status, model, and failure.' },
];

const BUILD_ITEMS: BuildItem[] = [ // ⁴ Five cards + two fields + three commands = ten authored or extended artifacts
  { number: '01', symbol: 'So', name: 'Source Episode', kind: 'CARD', purpose: 'Own one long-form source, editorial brief, transcript state, participants, campaign target, and derived candidates.', dependsOn: 'Project · Person · Campaign', acceptance: 'A user can understand the source, goal, status, and complete derived work from one card.' },
  { number: '02', symbol: 'Cc', name: 'Clip Candidate', kind: 'CARD', purpose: 'Represent an anchored source interval with transcript excerpt, hook, topic, score, crop guidance, and human trim.', dependsOn: 'Source Episode · Platform Format', acceptance: 'Every generated asset traces to exact source timecodes and retains the human edit delta.' },
  { number: '03', symbol: 'Ch', name: 'Claim Check', kind: 'CARD', purpose: 'Separate an AI-detected factual or sensitive claim from its evidence, reviewer verdict, and required correction.', dependsOn: 'Clip Candidate · Person · Task', acceptance: 'No model suggestion can masquerade as an approved factual judgment.' },
  { number: '04', symbol: 'Rg', name: 'Review Gate', kind: 'CARD', purpose: 'Record creator, editorial, and optional brand approval over a fixed candidate revision with rationale.', dependsOn: 'Clip Candidate · Claim Check[] · Person', acceptance: 'Approval names the revision, evidence, actor, role, time, and conditions.' },
  { number: '05', symbol: 'Pp', name: 'Publish Pack', kind: 'CARD', purpose: 'Bundle approved video variants, thumbnails, captions, alt text, credits, schedule notes, and lineage.', dependsOn: 'Clip Candidate[] · Review Gate[] · Campaign', acceptance: 'A publisher can ship the pack without reopening the editing workspace.' },
  { number: '06', symbol: 'Pf', name: 'Platform Format', kind: 'FIELD', purpose: 'Standardize destination, aspect ratio, duration range, title limit, caption style, and safe-area contract.', dependsOn: 'Existing enum, number, duration, and text primitives', acceptance: 'One value contract drives preview framing, validation, and export.' },
  { number: '07', symbol: 'Cs', name: 'Clip Status', kind: 'FIELD', purpose: 'Standardize extracted, proposed, editing, claim-review, approved, rejected, and published states.', dependsOn: 'Existing status/editor primitives', acceptance: 'Cards, filters, gates, and commands use one serialized state machine.' },
  { number: '08', symbol: 'Et', name: 'Extract Transcript', kind: 'COMMAND', purpose: 'Mechanically produce transcript segments, speakers, scenes, silence, audio peaks, and source anchors.', dependsOn: 'Source Episode · Clip Candidate · Job', acceptance: 'Re-runs are idempotent and observable facts contain no editorial inference.' },
  { number: '09', symbol: 'Rc', name: 'Rank Clips', kind: 'COMMAND', purpose: 'Use AI to propose hooks, rank candidate intervals, identify claims, and draft platform-specific copy.', dependsOn: 'Clip Candidate[] · Claim Check · Platform Format · Job', acceptance: 'Every suggestion retains model, prompt, evidence span, confidence, and review-required state.' },
  { number: '10', symbol: 'Fp', name: 'Finalize Pack', kind: 'COMMAND', purpose: 'Validate approvals and produce the governed Publish Pack plus immutable execution receipt.', dependsOn: 'Review Gate[] · Publish Pack · Job', acceptance: 'Unreviewed claims, stale revisions, or missing approvals fail closed with a precise reason.' },
];

const FLOW: FlowStep[] = [ // ⁵ The workflow makes fact, AI suggestion, generation, human authority, and policy visibly distinct
  { number: '01', regime: 'INTAKE · SYSTEM', title: 'Frame one source', action: 'Attach the master video, creative brief, guest roster, campaign, and platform targets. Upload, storage, search, and save remain assumed services.', input: 'Project + source files + Person[]', output: 'Source Episode', gate: 'Creator confirms the source and brief are the trial’s complete truth set.' },
  { number: '02', regime: 'MECHANICAL · COMMAND', title: 'Index the timeline', action: 'Extract exact transcript, speakers, scene changes, duration, silence, peaks, and timecodes without deciding what is interesting.', input: 'Source Episode media', output: 'Anchored segments + Job', gate: 'Every observation can be reproduced from the source.' },
  { number: '03', regime: 'AI · COMMAND', title: 'Propose the cuts', action: 'Rank hooks, suggest intervals, identify claims, and draft titles, captions, alt text, and crop guidance for each platform.', input: 'Segments + Platform Format[]', output: 'Clip Candidate[] + Claim Check[] + Job', gate: 'Evidence, confidence, model, and prompt remain visible beside every proposal.' },
  { number: '04', regime: 'HUMAN · WORKFLOW', title: 'Edit and approve', action: 'Editor adjusts boundaries and copy; creator verifies intent; reviewer resolves claims; optional brand reviewer checks sponsor obligations.', input: 'Candidates + checks + Person[]', output: 'Review Gate[] + Task[]', gate: 'Approval applies to a fixed revision and cannot be inherited by later edits.' },
  { number: '05', regime: 'POLICY · COMMAND', title: 'Ship the pack', action: 'Validate the required gates, create every approved variant, and publish one handoff with complete source and decision lineage.', input: 'Approved candidates + Campaign', output: 'Publish Pack + Job', gate: 'Stale, rejected, or unresolved work never enters the final package.' },
];

const SURFACE_PROOFS: SurfaceProof[] = [ // ⁶ The demo earns social appeal through real template variety rather than decorative mockups
  { format: '16:9', template: 'Source monitor', visual: 'Video frame · waveform · transcript · timecode', judgment: 'Does the extracted timeline match the original recording?' },
  { format: '9:16', template: 'Vertical clip', visual: 'Safe area · captions · face crop · hook', judgment: 'Does the proposed cut work as a short without changing meaning?' },
  { format: '1:1', template: 'Campaign tile', visual: 'Thumbnail · title · guest · release signal', judgment: 'Would this read clearly in a social feed?' },
  { format: 'DOC', template: 'Claim review', visual: 'Quote · evidence span · confidence · verdict', judgment: 'Can a reviewer see exactly why the AI raised the issue?' },
  { format: 'PACK', template: 'Release handoff', visual: 'Assets · captions · credits · approvals · receipt', judgment: 'Can another person publish without hidden context?' },
];

const ISSUE_PLAN: IssuePlan[] = [ // ⁷ Each row compiles directly into one dependency-ordered factory issue
  { id: 'CR-00', title: 'Freeze brief and fixtures', scope: 'Lock the 5/10 budget, roles, vocabulary, source episode, platform targets, and three expected outcomes.', dependsOn: 'None', done: 'The control estimate and fixture truth are reviewable before discovery.' },
  { id: 'CR-01', title: 'Verify five reuse cards', scope: 'Search, inspect, module-load, preview, and spike Person, Project, Task, Campaign, and Job.', dependsOn: 'CR-00', done: 'Five live CodeRefs pass or the proposal is amended before implementation.' },
  { id: 'CR-02', title: 'Build the two fields', scope: 'Implement PlatformFormat and ClipStatus with editors, formats, fixtures, and focused behavioral tests.', dependsOn: 'CR-01', done: 'Both contracts serialize canonically and drive visible UI behavior.' },
  { id: 'CR-03', title: 'Build source and candidate cards', scope: 'Implement SourceEpisode, ClipCandidate, and ClaimCheck with source anchors and realistic linked data.', dependsOn: 'CR-01 · CR-02', done: 'Fact, AI interpretation, and human correction remain separate.' },
  { id: 'CR-04', title: 'Build approval and output cards', scope: 'Implement ReviewGate and PublishPack with fixed-revision approval and complete handoff views.', dependsOn: 'CR-03', done: 'The final product reads independently and every consequential output is attributable.' },
  { id: 'CR-05', title: 'Build extraction and ranking', scope: 'Implement ExtractTranscript and RankClips with typed I/O, Job receipts, idempotency, evidence, and failure states.', dependsOn: 'CR-03', done: 'Both commands execute against the fixture and never collapse observations into approvals.' },
  { id: 'CR-06', title: 'Build finalization and workspace', scope: 'Implement FinalizePack and compose monitor, transcript, board, review, and handoff from verified catalog surfaces.', dependsOn: 'CR-04 · CR-05', done: 'The entire workflow is traversable and stale revisions fail closed.' },
  { id: 'CR-07', title: 'Run acceptance and report', scope: 'Execute scenarios and capture reuse, time, tokens, lint, modules, tests, renders, defects, and rework.', dependsOn: 'CR-06', done: 'A live product and an independently auditable factory report are delivered.' },
];

const SCENARIOS: Scenario[] = [ // ⁸ Success, business block, and corrected AI interpretation are all observable
  { label: 'Clean interview', source: '48-minute creator interview with one guest, strong source audio, and no sponsor restrictions.', result: 'Twelve candidates proposed; six approved; a complete multi-platform pack finalizes.', proves: 'Happy path, module reuse, extraction, AI generation, approval, and final product compose.' },
  { label: 'Unsupported claim', source: 'A compelling segment includes a numerical claim not supported by the episode notes.', result: 'Claim Check creates a Task; finalization blocks until corrected or evidenced.', proves: 'Human business policy outranks engagement score and generated copy.' },
  { label: 'Context collapse', source: 'AI selects a provocative quote whose surrounding sentence reverses its apparent meaning.', result: 'Editor extends the cut, records the correction, and approves the new revision only.', proves: 'The human edit improves the product while original model output and source lineage survive.' },
];

const SYSTEM_ASSUMPTIONS = [ // ⁹ Platform services stay prose, never artifact tiles or reuse counts
  'File upload and FileDef storage',
  'Card read, write, identity, indexing, and save',
  'Realm search and catalog discovery',
  'Command transport, authentication, and authorization context',
  'Approved transcription and LLM proxy access',
  'Existing catalog presentation components verified during CR-06',
];

export class CutRoomProposal extends CardDef { // ¹⁰ A visually specific but implementation-ready factory brief
  static displayName = 'CutRoom Factory Proposal';
  static icon = CutRoomIcon;
  static prefersWideFormat = true;

  @field experimentLabel = contains(StringField);
  @field headline = contains(StringField);
  @field subhead = contains(StringField);
  @field appName = contains(StringField);
  @field sourceTitle = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: CutRoomProposal) {
      return this.cardInfo?.name?.trim()?.length
        ? this.cardInfo.name
        : (this.headline ?? `Untitled ${this.constructor.displayName}`);
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: CutRoomProposal) {
      return this.cardInfo?.summary?.trim()?.length
        ? this.cardInfo.summary
        : this.subhead;
    },
  });

  static isolated = class Isolated extends Component<typeof CutRoomProposal> { // ¹¹ Editorial factory brief with a monitor-and-timeline signature
    reuseCards = REUSE_CARDS;
    buildItems = BUILD_ITEMS;
    flow = FLOW;
    surfaceProofs = SURFACE_PROOFS;
    issuePlan = ISSUE_PLAN;
    scenarios = SCENARIOS;
    systemAssumptions = SYSTEM_ASSUMPTIONS;

    <template>
      <PublicationNav @active='cutroom' /> {{! ¹⁵ Host route, deliberately not viewCard }}
      <article class='proposal'>
        <div class='hero'>
          <div class='hero-copy'><p class='eyebrow'>{{@model.experimentLabel}} · Factory Trial 03</p><h1>{{@model.headline}}</h1><p class='dek'>{{@model.subhead}}</p></div>
          <div class='monitor'>
            <div class='monitor-top'><span>MASTER / 01</span><strong>00:48:12:09</strong></div>
            <div class='screen'><span>OFFLINE / SUMMER</span><h2>{{@model.sourceTitle}}</h2><p>“The best part happened after we stopped trying to make it perfect.”</p><div class='caption'>Ari Chen · creator / host</div></div>
            <div class='timeline'><div class='playhead'></div><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
            <div class='monitor-foot'><span>48:12 SOURCE</span><span>12 CANDIDATES</span><span>3 FORMATS</span></div>
          </div>
        </div>

        <section class='score-ribbon' aria-label='CutRoom build budget'><div><strong>1</strong><span>source episode</span></div><div><strong>5</strong><span>reused cards</span></div><div><strong>5</strong><span>new cards</span></div><div><strong>2</strong><span>new fields</span></div><div><strong>3</strong><span>new commands</span></div><div><strong>1</strong><span>publish pack</span></div></section>

        <section class='thesis section-pad'><div class='section-label'><span>00</span><p>Trial thesis</p></div><div class='thesis-copy'><h2>One source. Full factory depth.</h2><p>CutRoom is narrow enough to judge by watching the original and the output. It still traverses file ingestion, deterministic extraction, AI interpretation and generation, human editing, multi-role approval, typed commands, reusable domain records, and a governed final product.</p></div><div class='hard-rule'><strong>THE LINE</strong><p>Transcript fact ≠ AI-selected hook ≠ generated caption ≠ human-approved clip. The schema, workspace, commands, and audit must keep all four visible.</p></div></section>

        <section class='surfaces section-pad'>
          <div class='section-head'><div class='section-label'><span>01</span><p>Visual proof</p></div><div><h2>The demo should explain itself in one screenshot.</h2><p>A real source monitor anchors a family of visibly different card and file templates. Each surface carries a judgment the viewer can make without knowing a specialist domain.</p></div></div>
          <div class='surface-strip'>{{#each this.surfaceProofs as |surface|}}<article><span>{{surface.format}}</span><div class='surface-frame frame-{{surface.format}}'><strong>{{surface.template}}</strong><small>{{surface.visual}}</small></div><p>{{surface.judgment}}</p></article>{{/each}}</div>
        </section>

        <section class='budget section-pad'>
          <div class='section-head'><div class='section-label'><span>02</span><p>Artifact budget</p></div><div><h2>Five verified. Ten authored.</h2><p>Only concrete userland CardDefs, FieldDefs, and Commands appear as element tiles. System features remain unboxed assumptions.</p></div></div>
          <div class='budget-row reuse'><div class='budget-label'><span>REUSE · 05</span><h3>Real modules or they do not count.</h3></div><div class='elements'>{{#each this.reuseCards as |item|}}<article><div><strong>{{item.symbol}}</strong><span>CARD</span></div><h3>{{item.name}}</h3><p>{{item.use}}</p><small>{{item.source}} · {{item.proof}}</small></article>{{/each}}</div></div>
          <div class='budget-row build'><div class='budget-label'><span>BUILD / EXTEND · 10</span><h3>The complete local budget.</h3></div><div class='elements build-elements'>{{#each this.buildItems as |item|}}<article><div><strong>{{item.symbol}}</strong><span>{{item.kind}} · {{item.number}}</span></div><h3>{{item.name}}</h3><p>{{item.purpose}}</p><small>Depends on {{item.dependsOn}}</small></article>{{/each}}</div></div>
          <div class='assumptions'><strong>UNBOXED · UNCOUNTED SYSTEM ASSUMPTIONS</strong><p>{{#each this.systemAssumptions as |item index|}}{{#if index}} · {{/if}}{{item}}{{/each}}</p></div>
        </section>

        <section class='workflow section-pad'>
          <div class='section-head'><div class='section-label'><span>03</span><p>Truth regimes</p></div><div><h2>Observe. Propose. Edit. Approve. Ship.</h2><p>The workflow is a readable business process, not a hidden automation chain. Each transition has typed inputs, outputs, authority, and a visible gate.</p></div></div>
          <div class='flow-list'>{{#each this.flow as |step|}}<article><strong>{{step.number}}</strong><div class='flow-name'><span>{{step.regime}}</span><h3>{{step.title}}</h3></div><p>{{step.action}}</p><div class='io'><span>IN</span><b>{{step.input}}</b><span>OUT</span><b>{{step.output}}</b></div><small>{{step.gate}}</small></article>{{/each}}</div>
        </section>

        <section class='requirements section-pad'>
          <div class='section-head'><div class='section-label'><span>04</span><p>Requirements</p></div><div><h2>Ten artifacts. Ten finish lines.</h2><p>These rows compile directly to REQ-CR-001 through REQ-CR-010. The factory may reorganize implementation, but it may not erase an acceptance obligation.</p></div></div>
          <div class='requirement-list'>{{#each this.buildItems as |item|}}<article><div class='req-id'><span>REQ-CR-0{{item.number}}</span><strong>{{item.kind}}</strong></div><div><h3>{{item.name}}</h3><p>{{item.purpose}}</p></div><div><span>DEPENDENCIES</span><p>{{item.dependsOn}}</p></div><div><span>ACCEPTANCE</span><p>{{item.acceptance}}</p></div></article>{{/each}}</div>
        </section>

        <section class='discovery section-pad'>
          <div class='section-head'><div class='section-label'><span>05</span><p>Search-first gate</p></div><div><h2>Prove reuse before authoring.</h2><p>For each of the five candidates: search by intent and type → inspect schema → load module → preview three formats → spike one real relationship → record REUSE, EXTEND, or BUILD.</p></div></div>
          <div class='manifest'><span>MANIFEST FIELDS</span><strong>Candidate · live CodeRef · source realm · version signal · sample instance · format previews · compatibility note · rejected alternatives · upgrade boundary</strong></div>
          <div class='stop-line'><strong>STOP THE RUN</strong><p>If fewer than five candidates verify, amend the budget before coding. A copied schema, invented replacement, or name-only match is not reuse.</p></div>
        </section>

        <section class='issues section-pad'>
          <div class='section-head'><div class='section-label'><span>06</span><p>Issue compiler</p></div><div><h2>Eight dependency-ordered work packets.</h2><p>Each row is already shaped like an agent issue: bounded scope, explicit prerequisites, and a testable done condition.</p></div></div>
          <div class='issue-list'>{{#each this.issuePlan as |issue|}}<article><strong>{{issue.id}}</strong><div><h3>{{issue.title}}</h3><p>{{issue.scope}}</p></div><div><span>DEPENDS</span><p>{{issue.dependsOn}}</p></div><div><span>DONE</span><p>{{issue.done}}</p></div></article>{{/each}}</div>
          <div class='packet'><span>AGENT HANDOFF PACKET</span><div><strong>Wiki brief</strong><strong>10 requirements</strong><strong>Reuse manifest</strong><strong>Build skill</strong><strong>8 issues</strong><strong>Fixture pack</strong><strong>Run report</strong></div><p>Generate these artifacts from the approved proposal before starting CR-02. CR-01 is discovery, not implementation.</p></div>
        </section>

        <section class='acceptance section-pad'>
          <div class='section-label'><span>07</span><p>Acceptance cut</p></div>
          <div class='acceptance-main'><h2>The viewer should see why it passed—or why it stopped.</h2><div class='scenario-grid'>{{#each this.scenarios as |scenario|}}<article><span>{{scenario.label}}</span><p>{{scenario.source}}</p><strong>{{scenario.result}}</strong><small>{{scenario.proves}}</small></article>{{/each}}</div><div class='pass-grid'><div><span>REUSE</span><strong>5 live CardDefs by module reference; zero copied schemas.</strong></div><div><span>BUILD</span><strong>Exactly 5 cards, 2 fields, and 3 commands.</strong></div><div><span>AUTHORITY</span><strong>Source fact, AI proposal, human edit, and approval remain distinct.</strong></div><div><span>QUALITY</span><strong>Lint, modules, tests, fixtures, renders, and all three scenarios pass.</strong></div><div><span>FACTORY DATA</span><strong>Time, tokens, reuse decisions, defects, and rework are recorded.</strong></div><div><span>FINAL PRODUCT</span><strong>A six-clip pack is attractive, publishable, and fully traceable.</strong></div></div></div>
        </section>

        <div class='proposal-footer'><strong>Factory Trial 03 · CutRoom</strong><span>Keep the hook. Keep the context.</span><b>00:48:12:09</b></div>
      </article>

      <style scoped>
        .proposal { min-width: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
        .hero { display: grid; grid-template-columns: minmax(0, 0.92fr) minmax(28rem, 1.08fr); gap: clamp(2rem, 5vw, 6rem); min-height: 42rem; padding: clamp(2.5rem, 6vw, 6rem); background: var(--cutroom-ink); color: var(--cutroom-paper); }
        .hero-copy { min-width: 0; align-self: center; }
        .eyebrow, .section-label p, .monitor, .budget-label > span, .elements article > div span, .flow-name span, .io span, .req-id span, .requirement-list article > div > span, .issue-list span, .surface-strip > article > span, .scenario-grid span, .pass-grid span, .proposal-footer { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.12em; }
        .eyebrow { margin: 0 0 1.5rem; color: var(--primary); font-size: 0.66rem; font-weight: 700; }
        .hero h1 { max-width: 9ch; margin: 0; font-family: var(--font-serif); font-size: clamp(4.5rem, 8.5vw, 9rem); font-weight: 400; letter-spacing: -0.07em; line-height: 0.82; }
        .dek { max-width: 36rem; margin: 2rem 0 0; color: var(--cutroom-screen); font-family: var(--font-serif); font-size: clamp(1.05rem, 1.5vw, 1.35rem); line-height: 1.55; }
        .monitor { align-self: center; min-width: 0; display: grid; grid-template-rows: auto minmax(20rem, 1fr) auto auto; border: 1px solid var(--cutroom-rule-dark); background: var(--cutroom-panel); }
        .monitor-top, .monitor-foot { display: flex; justify-content: space-between; gap: 1rem; padding: 0.8rem 1rem; color: var(--cutroom-screen); font-size: 0.52rem; }
        .monitor-top strong { color: var(--primary); font-weight: 500; }
        .screen { display: grid; align-content: end; gap: 0.7rem; padding: clamp(2rem, 5vw, 5rem); border-top: 1px solid var(--cutroom-rule-dark); border-bottom: 1px solid var(--cutroom-rule-dark); background: var(--cutroom-panel-soft); }
        .screen > span { color: var(--primary); font-size: 0.52rem; }
        .screen h2 { max-width: 10ch; margin: 0; color: var(--cutroom-paper); font-family: var(--font-serif); font-size: clamp(2.4rem, 5vw, 5.5rem); font-weight: 400; letter-spacing: -0.055em; line-height: 0.88; }
        .screen p { max-width: 30rem; margin: 0; color: var(--cutroom-screen); font-family: var(--font-serif); font-size: 1rem; font-style: italic; line-height: 1.45; }
        .caption { justify-self: start; padding: 0.32rem 0.5rem; background: var(--cutroom-paper); color: var(--cutroom-ink); font-size: 0.48rem; }
        .timeline { position: relative; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 2px; height: 4rem; padding: 0.6rem 1rem; background: var(--cutroom-ink); }
        .timeline span { align-self: end; height: 35%; background: var(--cutroom-rule-dark); }
        .timeline span:nth-of-type(2n) { height: 70%; } .timeline span:nth-of-type(3n) { height: 48%; } .timeline span:nth-of-type(5n) { background: var(--primary); }
        .playhead { position: absolute; z-index: 1; top: 0; bottom: 0; left: 58%; width: 1px; background: var(--primary); }
        .score-ribbon { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border-bottom: 1px solid var(--border); background: var(--card); }
        .score-ribbon > div { display: grid; gap: 0.2rem; padding: 1rem clamp(0.7rem, 1.8vw, 1.4rem); }
        .score-ribbon > div + div { border-left: 1px solid var(--border); }
        .score-ribbon strong { color: var(--primary); font: 400 clamp(1.6rem, 2.7vw, 2.5rem) var(--font-serif); }
        .score-ribbon span { color: var(--muted-foreground); font: 600 0.52rem var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
        .section-pad { padding: clamp(2.5rem, 5vw, 5rem); }
        .section-label { display: grid; align-content: start; gap: 0.55rem; }
        .section-label > span { color: var(--primary); font: 400 2.7rem/0.8 var(--font-serif); }
        .section-label p { margin: 0; color: var(--muted-foreground); font-size: 0.54rem; font-weight: 700; }
        .section-head { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem); margin-bottom: clamp(2rem, 4vw, 3.5rem); }
        .section-head h2, .thesis h2, .acceptance h2 { max-width: 18ch; margin: 0; font: 400 clamp(2.2rem, 4.6vw, 4.8rem)/0.96 var(--font-serif); letter-spacing: -0.05em; }
        .section-head > div > p { max-width: 52rem; margin: 1rem 0 0; color: var(--muted-foreground); line-height: 1.55; }
        .thesis { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr) minmax(16rem, 0.42fr); gap: clamp(2rem, 5vw, 6rem); border-bottom: 1px solid var(--border); background: var(--card); }
        .thesis-copy p { max-width: 50rem; margin: 1.4rem 0 0; color: var(--muted-foreground); font: 400 1.06rem/1.65 var(--font-serif); }
        .hard-rule, .stop-line { align-self: end; border-top: 1px solid var(--foreground); padding-top: 1rem; }
        .hard-rule strong, .stop-line strong, .assumptions strong { color: var(--primary); font: 700 0.56rem var(--font-mono); letter-spacing: 0.12em; }
        .hard-rule p, .stop-line p, .assumptions p { margin: 0.7rem 0 0; font-size: 0.72rem; line-height: 1.6; }
        .surfaces, .requirements, .issues { background: var(--card); }
        .surface-strip { display: grid; grid-template-columns: 1.2fr 0.7fr 0.75fr 1fr 1.1fr; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .surface-strip > article { min-width: 0; display: grid; grid-template-rows: auto minmax(12rem, 1fr) auto; gap: 0.8rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .surface-strip > article > span { color: var(--primary); font-size: 0.5rem; font-weight: 700; }
        .surface-frame { min-width: 0; display: grid; align-content: end; gap: 0.4rem; padding: 0.8rem; background: var(--cutroom-panel); color: var(--cutroom-paper); }
        .surface-frame strong { font: 400 1rem var(--font-serif); } .surface-frame small { color: var(--cutroom-screen); font: 500 0.48rem/1.4 var(--font-mono); text-transform: uppercase; }
        .surface-strip p { margin: 0; color: var(--muted-foreground); font-size: 0.62rem; line-height: 1.48; }
        .budget-row { display: grid; grid-template-columns: minmax(11rem, 0.25fr) minmax(0, 1fr); border-top: 1px solid var(--border); }
        .budget-row + .budget-row { margin-top: 2rem; }
        .budget-label { padding: 1.1rem 1.3rem 1.1rem 0; }
        .budget-label > span { color: var(--primary); font-size: 0.5rem; font-weight: 700; }
        .budget-label h3 { margin: 0.7rem 0 0; font: 400 1.35rem/1.1 var(--font-serif); }
        .elements { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-left: 1px solid var(--border); }
        .elements article { min-width: 0; min-height: 14rem; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 0.75rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--card); }
        .build .elements article { background: color-mix(in srgb, var(--primary) 7%, var(--card)); }
        .elements article > div { display: flex; justify-content: space-between; gap: 0.5rem; align-items: start; }
        .elements article > div strong { color: var(--foreground); font: 400 2.15rem/1 var(--font-serif); letter-spacing: -0.05em; }
        .build .elements article > div strong { color: var(--primary); }
        .elements article > div span { color: var(--muted-foreground); font-size: 0.4rem; font-weight: 700; text-align: right; }
        .elements h3 { margin: 0; font: 500 0.95rem var(--font-serif); }
        .elements p { margin: 0; font-size: 0.62rem; line-height: 1.48; }
        .elements small { border-top: 1px solid var(--border); padding-top: 0.55rem; color: var(--muted-foreground); font-size: 0.51rem; line-height: 1.42; }
        .assumptions { margin-top: 2rem; border-top: 1px solid var(--border); padding-top: 1rem; }
        .workflow, .discovery, .acceptance { border-top: 1px solid var(--border); }
        .flow-list, .requirement-list, .issue-list { display: grid; border-top: 1px solid var(--border); }
        .flow-list > article { display: grid; grid-template-columns: 3.4rem minmax(12rem, 0.72fr) minmax(18rem, 1.18fr) minmax(12rem, 0.72fr) minmax(14rem, 0.86fr); border-bottom: 1px solid var(--border); }
        .flow-list > article > *, .requirement-list > article > *, .issue-list > article > * { min-width: 0; padding: 0.9rem 1rem; }
        .flow-list > article > * + *, .requirement-list > article > * + *, .issue-list > article > * + * { border-left: 1px solid var(--border); }
        .flow-list > article > strong { color: var(--primary); font: 400 1.5rem var(--font-serif); text-align: center; }
        .flow-name span, .io span { color: var(--primary); font-size: 0.46rem; font-weight: 700; }
        .flow-name h3, .requirement-list h3, .issue-list h3 { margin: 0.35rem 0 0; font: 500 0.95rem var(--font-serif); }
        .flow-list > article > p, .requirement-list p, .issue-list p { margin: 0; color: var(--muted-foreground); font-size: 0.62rem; line-height: 1.48; }
        .io { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.3rem 0.55rem; align-content: center; }
        .io b { font-size: 0.58rem; line-height: 1.4; }
        .flow-list > article > small { color: var(--muted-foreground); font: 600 0.51rem/1.44 var(--font-mono); }
        .requirement-list > article, .issue-list > article { display: grid; grid-template-columns: minmax(6rem, 0.3fr) minmax(14rem, 0.9fr) minmax(11rem, 0.62fr) minmax(17rem, 1fr); border-bottom: 1px solid var(--border); }
        .req-id { display: grid; align-content: start; gap: 0.35rem; }
        .req-id span, .requirement-list article > div > span, .issue-list span { color: var(--primary); font: 700 0.45rem var(--font-mono); letter-spacing: 0.09em; }
        .req-id strong { font: 400 0.95rem var(--font-serif); }
        .requirement-list p, .issue-list p { margin-top: 0.32rem; }
        .discovery { background: var(--cutroom-ink); color: var(--cutroom-paper); }
        .discovery .section-head > div > p, .discovery .section-label p { color: var(--cutroom-screen); }
        .manifest { display: grid; grid-template-columns: 10rem minmax(0, 1fr); gap: 1rem; border-top: 1px solid var(--cutroom-rule-dark); border-bottom: 1px solid var(--cutroom-rule-dark); padding: 1.2rem 0; }
        .manifest span { color: var(--primary); font: 700 0.5rem var(--font-mono); letter-spacing: 0.1em; }
        .manifest strong { color: var(--cutroom-screen); font: 500 0.72rem/1.55 var(--font-mono); }
        .discovery .stop-line { margin-top: 2rem; border-color: var(--cutroom-rule-dark); }
        .discovery .stop-line p { color: var(--cutroom-screen); }
        .issue-list > article > strong { color: var(--primary); font: 400 1.15rem var(--font-serif); }
        .packet { display: grid; grid-template-columns: 10rem minmax(0, 1fr); gap: 1rem 2rem; margin-top: 2rem; border-top: 1px solid var(--foreground); padding-top: 1rem; }
        .packet > span { color: var(--primary); font: 700 0.5rem var(--font-mono); letter-spacing: 0.1em; }
        .packet > div { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .packet > div strong { border: 1px solid var(--border); padding: 0.4rem 0.55rem; font-size: 0.58rem; }
        .packet p { grid-column: 2; margin: 0; color: var(--muted-foreground); font-size: 0.65rem; }
        .acceptance { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem); }
        .scenario-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 2.5rem; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .scenario-grid article { min-width: 0; min-height: 14rem; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 0.75rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .scenario-grid span, .pass-grid span { color: var(--primary); font-size: 0.48rem; font-weight: 700; }
        .scenario-grid p { margin: 0; color: var(--muted-foreground); font-size: 0.65rem; line-height: 1.5; }
        .scenario-grid strong { font: 500 0.86rem/1.45 var(--font-serif); }
        .scenario-grid small { border-top: 1px solid var(--border); padding-top: 0.55rem; color: var(--muted-foreground); font-size: 0.54rem; line-height: 1.42; }
        .pass-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 2rem; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .pass-grid > div { display: grid; gap: 0.7rem; min-height: 7rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .pass-grid strong { font: 500 0.82rem/1.5 var(--font-serif); }
        .proposal-footer { display: grid; grid-template-columns: 1fr auto auto; gap: 2rem; padding: 1.2rem clamp(1rem, 3vw, 2.5rem); background: var(--cutroom-ink); color: var(--cutroom-screen); font-size: 0.54rem; }
        .proposal-footer strong, .proposal-footer b { color: var(--primary); }
        @media (max-width: 72rem) { .hero { grid-template-columns: 1fr; } .surface-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); } .elements { grid-template-columns: repeat(3, minmax(0, 1fr)); } .flow-list > article { grid-template-columns: 3.4rem minmax(12rem, 0.65fr) minmax(0, 1fr); } .flow-list .io, .flow-list article > small { grid-column: 2 / -1; border-top: 1px solid var(--border); } }
        @media (max-width: 54rem) { .thesis, .section-head, .acceptance, .budget-row { grid-template-columns: 1fr; } .score-ribbon, .surface-strip, .elements, .scenario-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .budget-label { padding-right: 0; } .requirement-list > article, .issue-list > article { grid-template-columns: 7rem minmax(0, 1fr); } .requirement-list article > :nth-child(n + 3), .issue-list article > :nth-child(n + 3) { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } }
        @media (max-width: 38rem) { .hero { min-height: auto; } .monitor { grid-template-rows: auto minmax(15rem, 1fr) auto auto; } .score-ribbon, .surface-strip, .elements, .scenario-grid, .pass-grid { grid-template-columns: 1fr; } .score-ribbon > div + div { border-left: 0; border-top: 1px solid var(--border); } .flow-list > article { grid-template-columns: 3.4rem minmax(0, 1fr); } .flow-list > article > p, .flow-list .io, .flow-list article > small { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } .manifest, .packet { grid-template-columns: 1fr; } .packet p { grid-column: 1; } .proposal-footer { grid-template-columns: 1fr; } }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof CutRoomProposal> { // ¹² Compressed editorial brief for document flow
    <template><article class='embedded'><span>{{@model.experimentLabel}} · Factory Trial 03</span><h2>{{@model.appName}}</h2><p>{{@model.subhead}}</p><div><strong>5</strong><small>reuse cards</small><strong>10</strong><small>build items</small><strong>3</strong><small>commands</small><strong>1</strong><small>publish pack</small></div></article><style scoped>.embedded { display: grid; gap: 0.75rem; padding: 1.2rem; background: var(--card); color: var(--foreground); } .embedded > span { color: var(--primary); font: 700 0.54rem var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; } h2 { margin: 0; font: 400 1.9rem var(--font-serif); letter-spacing: -0.04em; } p { max-width: 48rem; margin: 0; color: var(--muted-foreground); font: 400 1rem/1.5 var(--font-serif); } .embedded > div { display: grid; grid-template-columns: repeat(4, auto minmax(0, 1fr)); align-items: baseline; gap: 0.3rem 0.55rem; border-top: 1px solid var(--border); padding-top: 0.75rem; } .embedded > div strong { color: var(--primary); font: 400 1.2rem var(--font-serif); } .embedded > div small { color: var(--muted-foreground); font: 600 0.48rem var(--font-mono); text-transform: uppercase; } @media (max-width: 36rem) { .embedded > div { grid-template-columns: repeat(2, auto minmax(0, 1fr)); } }</style></template>
  };

  static fitted = class Fitted extends Component<typeof CutRoomProposal> { // ¹³ CQ monitor ticket for all parent-owned envelopes
    <template><article class='fit'><div class='fit-top'><span>{{@model.experimentLabel}}</span><strong>03</strong></div><div class='fit-screen'><p>00:48:12:09</p><h2>{{@model.appName}}</h2><small>{{@model.sourceTitle}}</small></div><div class='fit-track'><i></i><i></i><i></i><i></i><i></i><i></i></div><div class='fit-metrics'><span><strong>5</strong> reuse</span><span><strong>10</strong> build</span><span><strong>3</strong> commands</span></div></article><style scoped>.fit { --type-ratio: 1.28; --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb)); --type-base: clamp(9px, calc(4px + 2cqi + 0.8cqb - 0.45 * var(--ar)), 18px); --label: max(7px, calc(var(--type-base) / pow(var(--type-ratio), 1.5))); --body: max(9px, calc(var(--type-base) / var(--type-ratio))); --title: max(12px, calc(var(--type-base) * pow(var(--type-ratio), 1.5))); width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto auto; gap: clamp(4px, 2cqi, 12px); padding: clamp(7px, 4cqi, 20px); overflow: hidden; background: var(--cutroom-panel); color: var(--cutroom-paper); } .fit-top, .fit-screen, .fit-track, .fit-metrics { min-width: 0; min-height: 0; overflow: hidden; } .fit-top { display: flex; justify-content: space-between; gap: 0.5rem; } .fit-top span, .fit-screen p { color: var(--primary); font: 700 var(--label) var(--font-mono); letter-spacing: 0.09em; text-transform: uppercase; } .fit-top strong { color: var(--primary); font: 400 var(--title) var(--font-serif); } .fit-screen { display: grid; align-content: center; gap: clamp(3px, 1cqb, 8px); } .fit-screen p, .fit-screen h2 { margin: 0; } .fit-screen h2 { display: -webkit-box; overflow: hidden; font: 400 var(--title)/0.95 var(--font-serif); letter-spacing: -0.04em; -webkit-box-orient: vertical; -webkit-line-clamp: 2; } .fit-screen small { display: -webkit-box; overflow: hidden; color: var(--cutroom-screen); font-size: var(--body); -webkit-box-orient: vertical; -webkit-line-clamp: 2; } .fit-track { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 2px; height: clamp(8px, 4cqb, 24px); } .fit-track i { background: var(--cutroom-rule-dark); } .fit-track i:nth-child(4) { background: var(--primary); } .fit-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--cutroom-rule-dark); } .fit-metrics span { padding-top: 0.45rem; color: var(--cutroom-screen); font: 600 var(--label) var(--font-mono); text-transform: uppercase; } .fit-metrics strong { color: var(--primary); font: 400 var(--body) var(--font-serif); } @container fitted-card (height <= 80px) { .fit { grid-template-rows: minmax(0, 1fr); } .fit-top, .fit-track, .fit-metrics, .fit-screen p, .fit-screen small { display: none; } } @container fitted-card (80px < height <= 130px) { .fit { grid-template-rows: auto minmax(0, 1fr) auto; } .fit-metrics, .fit-screen small { display: none; } } @container fitted-card (width <= 170px) { .fit-metrics span:nth-child(n + 2), .fit-screen small { display: none; } .fit-metrics { grid-template-columns: 1fr; } }</style></template>
  };
}
