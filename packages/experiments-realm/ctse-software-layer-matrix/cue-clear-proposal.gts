// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api'; // ¹ Trial 03 is standalone so it can move into a factory realm without Trial 01
import StringField from 'https://cardstack.com/base/string';
import CueIcon from '@cardstack/boxel-icons/list-music'; // ² CDN-verified 2026-07-21
import PublicationNav from './components/publication-nav'; // ¹⁵ Standalone publication navigation

interface ElementConcept {
  symbol: string;
  name: string;
}

interface ReuseCandidate extends ElementConcept {
  source: string;
  use: string;
  proof: string;
}

interface BuildArtifact extends ElementConcept {
  number: string;
  kind: string;
  responsibility: string;
  dependsOn: string;
  acceptance: string;
}

interface WorkflowStep {
  number: string;
  lane: string;
  title: string;
  action: string;
  input: string;
  output: string;
  gate: string;
}

interface SearchGate {
  number: string;
  action: string;
  evidence: string;
  failure: string;
}

interface IssuePlan {
  id: string;
  title: string;
  scope: string;
  dependsOn: string;
  done: string;
}

interface HandoffArtifact {
  artifact: string;
  file: string;
  contains: string;
}

interface Scenario {
  name: string;
  fixture: string;
  expected: string;
  proves: string;
}

const REUSE_CANDIDATES: ReuseCandidate[] = [ // ³ Exactly five userland CardDefs; each remains provisional until the proof gate passes
  { symbol: 'Pe', name: 'Person', source: 'Common records', use: 'Producer, performer, rights lead, approver, and accountable actor identity.', proof: 'Live CardDef loads, renders, and links without a local identity wrapper.' },
  { symbol: 'Ev', name: 'Event', source: 'Common records', use: 'The single live set or streamed performance being cleared.', proof: 'Can represent venue/channel, scheduled time, participants, and status through links or existing fields.' },
  { symbol: 'Co', name: 'Contract', source: 'Legal kit', use: 'License, appearance release, contributor agreement, or rights grant.', proof: 'Real legal-kit module loads and the agreement stays a linked card rather than copied text.' },
  { symbol: 'Ta', name: 'Task', source: 'Common records', use: 'Human follow-up for missing proof, disputed matches, and clearance conditions.', proof: 'Assignment, due date, state, and linked context work without a CueClear-specific task type.' },
  { symbol: 'Jo', name: 'Job', source: 'BSL run record', use: 'Auditable execution record for extraction, AI analysis, and finalization.', proof: 'The BSL Job contract can record command, inputs, outputs, status, actor, and timing.' },
];

const BUILD_ARTIFACTS: BuildArtifact[] = [ // ⁴ Five cards + two fields + three commands = the hard ten-artifact authoring budget
  { number: '01', symbol: 'Cc', name: 'Clearance Case', kind: 'CARD', responsibility: 'Own the clearance state for one performance and link every source, finding, decision, task, agreement, and final cue sheet.', dependsOn: 'Event · Person · Contract · Task', acceptance: 'One card explains whether the set may publish and why.' },
  { number: '02', symbol: 'Se', name: 'Setlist Entry', kind: 'CARD', responsibility: 'Represent one performed work, cover, sample, walk-on track, or spoken segment with source anchors and performer attribution.', dependsOn: 'Clearance Case · Person · Usage Scope', acceptance: 'Every extracted row can be corrected by a human without losing its original evidence.' },
  { number: '03', symbol: 'Rf', name: 'Rights Finding', kind: 'CARD', responsibility: 'Store an AI-assisted interpretation, evidence references, confidence, candidate owner, policy version, and review state.', dependsOn: 'Setlist Entry · Contract · Clearance Status', acceptance: 'The AI claim and the human verdict are separate, visible values.' },
  { number: '04', symbol: 'Ag', name: 'Approval Gate', kind: 'CARD', responsibility: 'Record named approval, conditional approval, or block with rationale and the exact findings reviewed.', dependsOn: 'Rights Finding[] · Person · Task', acceptance: 'Consequential state cannot advance without an accountable person and rationale.' },
  { number: '05', symbol: 'Cs', name: 'Cue Sheet', kind: 'CARD', responsibility: 'Publish the governed setlist, credits, usage, timing, rights notes, and approval receipt as the final product.', dependsOn: 'Setlist Entry[] · Rights Finding[] · Approval Gate', acceptance: 'A downstream producer can understand and exchange the approved record without opening the source folder.' },
  { number: '06', symbol: 'Us', name: 'Usage Scope', kind: 'FIELD', responsibility: 'Standardize how a work is used: full, excerpt, sample, walk-on, background, visual-only, or spoken.', dependsOn: 'Existing enum/editor primitives', acceptance: 'One serialized value drives editor, filtering, analysis prompts, and cue-sheet output.' },
  { number: '07', symbol: 'Cl', name: 'Clearance Status', kind: 'FIELD', responsibility: 'Standardize proposed, investigating, clear, conditional, blocked, and not-required states with a purpose-built editor.', dependsOn: 'Existing status/editor primitives', acceptance: 'The same value is used by findings, gates, filters, and finalization policy.' },
  { number: '08', symbol: 'Ex', name: 'Extract Setlist', kind: 'COMMAND', responsibility: 'Turn uploaded setlist material and deterministic media metadata into anchored Setlist Entry drafts.', dependsOn: 'Clearance Case · Setlist Entry · Job', acceptance: 'Re-running is idempotent and every entry points back to its source location.' },
  { number: '09', symbol: 'Ar', name: 'Analyze Rights', kind: 'COMMAND', responsibility: 'Use AI to classify usage, match likely works, compare agreements, and create reviewable Rights Findings.', dependsOn: 'Setlist Entry[] · Contract[] · Rights Finding · Job', acceptance: 'Every finding has evidence, confidence, model/prompt identity, and no authority to approve itself.' },
  { number: '10', symbol: 'Fc', name: 'Finalize Cue Sheet', kind: 'COMMAND', responsibility: 'Enforce approval policy and create the final Cue Sheet plus immutable run receipt.', dependsOn: 'Approval Gate · Cue Sheet · Job', acceptance: 'Any blocked or unreviewed consequential finding prevents publication with a precise explanation.' },
];

const WORKFLOW: WorkflowStep[] = [ // ⁵ Mechanical, AI, and human authority remain explicit lanes
  { number: '01', lane: 'INTAKE · SYSTEM', title: 'Open one clearance case', action: 'Attach the performance, source setlist, reference media, and available agreements. Realm upload, persistence, and search are assumed platform services.', input: 'Event + files + Contract[]', output: 'Clearance Case', gate: 'A human confirms this is the complete source set for the trial.' },
  { number: '02', lane: 'MECHANICAL · COMMAND', title: 'Extract what is observable', action: 'Parse rows, durations, filenames, timecodes, and exact text. Create anchored drafts without inferring ownership or permission.', input: 'Clearance Case sources', output: 'Setlist Entry[] + Job', gate: 'Every draft has a source anchor and deterministic extraction method.' },
  { number: '03', lane: 'AI · COMMAND', title: 'Interpret the rights situation', action: 'Classify usage, suggest work matches, compare known agreements, and explain gaps. The model proposes findings; it does not clear the set.', input: 'Entries + Contract[]', output: 'Rights Finding[] + Job', gate: 'Low-confidence and unsupported claims are visibly review-required.' },
  { number: '04', lane: 'HUMAN · BUSINESS PROCESS', title: 'Resolve, assign, and decide', action: 'The rights lead corrects findings, creates follow-up Tasks, and records clear, conditional, or blocked decisions. The producer sees the current go/no-go state.', input: 'Findings + Person[]', output: 'Approval Gate + Task[]', gate: 'Every consequential decision names its actor, evidence, and rationale.' },
  { number: '05', lane: 'POLICY · COMMAND', title: 'Publish a governed cue sheet', action: 'Finalization checks the gate, emits the approved sheet, and preserves the exact inputs and decision receipt used to produce it.', input: 'Case + Approval Gate', output: 'Cue Sheet + Job', gate: 'No blocked or unresolved consequential item crosses the boundary.' },
];

const SEARCH_GATES: SearchGate[] = [ // ⁶ This is the discovery discipline the factory performs before authoring app code
  { number: '1', action: 'Search by intent and type', evidence: 'Candidate URL, CardDef CodeRef, source realm, version or last-modified signal.', failure: 'No plausible module found after documented query variants.' },
  { number: '2', action: 'Inspect the real schema', evidence: 'Fields, relationships, formats, computed values, and sample instance noted in the reuse manifest.', failure: 'The name overlaps but the semantics or identity boundary do not.' },
  { number: '3', action: 'Load and preview', evidence: 'Module schema reports ready; isolated, embedded, and fitted formats render with realistic data.', failure: 'Import, module evaluation, instance loading, or required format fails.' },
  { number: '4', action: 'Test the composition seam', evidence: 'A minimal target-realm spike links the candidate to CueClear data without copied schema.', failure: 'The app requires a compatibility wrapper that owns more than binding logic.' },
  { number: '5', action: 'Record the disposition', evidence: 'REUSE, EXTEND, or BUILD decision with rejected alternatives and upgrade boundary.', failure: 'No artifact may be counted as reuse without a loadable CodeRef and preview proof.' },
];

const ISSUE_PLAN: IssuePlan[] = [ // ⁷ One row can become one factory issue with explicit dependencies and a finish gate
  { id: 'CC-00', title: 'Freeze brief and fixtures', scope: 'Lock the 5/10 budget, roles, vocabulary, three sample cases, and control estimate.', dependsOn: 'None', done: 'Brief, fixtures, non-goals, and expected outputs are reviewable.' },
  { id: 'CC-01', title: 'Verify the five reuse cards', scope: 'Execute the search gate for Person, Event, Contract, Task, and Job; publish the reuse manifest.', dependsOn: 'CC-00', done: 'Five live CodeRefs pass—or the brief is amended before implementation.' },
  { id: 'CC-02', title: 'Build the two shared fields', scope: 'Implement UsageScope and ClearanceStatus with editors, display formats, samples, and focused tests.', dependsOn: 'CC-01', done: 'Both values serialize canonically and render in all required formats.' },
  { id: 'CC-03', title: 'Build the case and evidence cards', scope: 'Implement ClearanceCase, SetlistEntry, and RightsFinding with realistic linked sample data.', dependsOn: 'CC-01 · CC-02', done: 'The three cards preserve source fact, AI interpretation, and human correction separately.' },
  { id: 'CC-04', title: 'Build approval and output cards', scope: 'Implement ApprovalGate and CueSheet plus clear, conditional, and blocked sample states.', dependsOn: 'CC-03', done: 'The final product can be read independently and the gate is attributable.' },
  { id: 'CC-05', title: 'Build extraction and analysis commands', scope: 'Implement ExtractSetlist and AnalyzeRights with typed inputs/outputs, Job receipts, idempotency, and failure paths.', dependsOn: 'CC-03', done: 'Both commands execute against fixtures and preserve evidence and model metadata.' },
  { id: 'CC-06', title: 'Build finalization and workflow surface', scope: 'Implement FinalizeCueSheet and compose the app from discovered catalog presentation components.', dependsOn: 'CC-04 · CC-05', done: 'A user can traverse intake, review, decision, and final product without hidden state transitions.' },
  { id: 'CC-07', title: 'Run acceptance and factory report', scope: 'Execute all scenarios; capture lint, module, test, render, reuse, time, and token evidence.', dependsOn: 'CC-06', done: 'The live app and handoff packet make the factory result independently auditable.' },
];

const HANDOFF: HandoffArtifact[] = [ // ⁸ The proposal has an explicit compilation target for the agentic build system
  { artifact: 'Wiki brief', file: 'Wiki/cueclear-factory-trial', contains: 'Goal, users, workflow, 5/10 budget, non-goals, assumptions, and decision boundaries.' },
  { artifact: 'Requirements', file: 'requirements/cueclear.md', contains: 'REQ-CC-001…010 mapped one-to-one to the ten build artifacts and their acceptance statements.' },
  { artifact: 'Reuse manifest', file: 'reuse/cueclear.json', contains: 'Five candidates, live CodeRefs, preview evidence, disposition, rejected alternatives, and upgrade boundary.' },
  { artifact: 'Build skill', file: 'skills/build-cueclear/SKILL.md', contains: 'Search-first order, vocabulary locks, AI/human authority rules, verification loop, and stop conditions.' },
  { artifact: 'Issue set', file: 'Issues/CC-00…CC-07', contains: 'Eight dependency-ordered work packets copied from the issue plan on this page.' },
  { artifact: 'Fixture pack', file: 'fixtures/cueclear/', contains: 'Clean set, blocked sample, uncertain match, agreements, source anchors, and expected outputs.' },
  { artifact: 'Run report', file: 'Reports/cueclear-factory-run', contains: 'Actual time, tokens, reuse rate, authored files, tests, defects, rework, and graduation candidates.' },
];

const SCENARIOS: Scenario[] = [ // ⁹ Three tests cover success, policy block, and corrected AI interpretation
  { name: 'Clear set', fixture: 'Four original songs with valid performer releases and one known license.', expected: 'All findings reviewed; Finalize Cue Sheet succeeds.', proves: 'Happy path, reused records, AI assistance, approval, and governed output compose.' },
  { name: 'Blocked sample', fixture: 'One track contains an uncleared sample and no supporting Contract.', expected: 'A Task is assigned; approval is blocked; no Cue Sheet is finalized.', proves: 'Business policy outranks generation and failure is explicit rather than partial.' },
  { name: 'Uncertain cover', fixture: 'AI suggests the wrong work for a cover with low confidence.', expected: 'Rights lead corrects the match, records rationale, approves, and finalizes.', proves: 'Human correction changes the product while the original model output and audit trail survive.' },
];

const SYSTEM_ASSUMPTIONS = [ // ¹⁰ These are deliberately prose, not counted element tiles
  'Realm upload and FileDef storage',
  'Card read, write, save, indexing, and identity',
  'Realm search endpoint and catalog discovery access',
  'Command transport, authentication, and authorization context',
  'Approved LLM proxy and model availability',
  'Existing catalog presentation components discovered during CC-06',
];

export class CueClearProposal extends CardDef { // ¹¹ A narrow but matrix-deep factory trial
  static displayName = 'CueClear Factory Proposal';
  static icon = CueIcon;
  static prefersWideFormat = true;

  @field experimentLabel = contains(StringField);
  @field headline = contains(StringField);
  @field subhead = contains(StringField);
  @field appName = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: CueClearProposal) {
      return this.cardInfo?.name?.trim()?.length
        ? this.cardInfo.name
        : (this.headline ?? `Untitled ${this.constructor.displayName}`);
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: CueClearProposal) {
      return this.cardInfo?.summary?.trim()?.length
        ? this.cardInfo.summary
        : this.subhead;
    },
  });

  static isolated = class Isolated extends Component<typeof CueClearProposal> { // ¹² Vendor Readiness structure, reduced to an agent-ready build contract
    reuseCandidates = REUSE_CANDIDATES;
    buildArtifacts = BUILD_ARTIFACTS;
    workflow = WORKFLOW;
    searchGates = SEARCH_GATES;
    issuePlan = ISSUE_PLAN;
    handoff = HANDOFF;
    scenarios = SCENARIOS;
    systemAssumptions = SYSTEM_ASSUMPTIONS;

    <template>
      <PublicationNav @active='cueclear' /> {{! ¹⁶ Host route, deliberately not viewCard }}
      <article class='proposal'>
        <div class='hero'>
          <div>
            <p class='eyebrow'>{{@model.experimentLabel}} · Factory Trial 03</p>
            <h1>{{@model.headline}}</h1>
            <p class='dek'>{{@model.subhead}}</p>
          </div>
          <div class='hero-brief'>
            <span>Proposed build</span>
            <strong>{{@model.appName}}</strong>
            <p>Clear one live set. Prove the whole factory: mechanical extraction, AI interpretation, human business process, typed commands, reuse, and an auditable final product.</p>
          </div>
        </div>

        <section class='score-ribbon' aria-label='Trial budget'>
          <div><strong>1</strong><span>narrow app</span></div>
          <div><strong>5</strong><span>reused cards</span></div>
          <div><strong>5</strong><span>new cards</span></div>
          <div><strong>2</strong><span>new fields</span></div>
          <div><strong>3</strong><span>new commands</span></div>
          <div><strong>3</strong><span>acceptance cases</span></div>
        </section>

        <section class='thesis section-pad'>
          <div class='section-label'><span>00</span><p>Trial shape</p></div>
          <div class='thesis-copy'><h2>Thin scope. Full-depth traversal.</h2><p>CueClear is intentionally one workflow for one live set. It is large enough to exercise reusable records, new domain semantics, field contracts, mechanical extraction, AI interpretation, human approval, typed commands, and audit—but too small to hide factory problems inside product sprawl.</p></div>
          <div class='rule'><strong>HARD BUDGET</strong><p>Reuse exactly five userland CardDefs. Build or extend exactly ten userland artifacts. Realm-server capabilities are assumed and never counted as reusable concepts.</p></div>
        </section>

        <section class='budget section-pad'>
          <div class='section-head'><div class='section-label'><span>01</span><p>Artifact budget</p></div><div><h2>Five in. Ten made.</h2><p>Only cards, fields, and commands appear as element tiles. A tile is a concrete module obligation, not a feature slogan.</p></div></div>
          <div class='budget-block reuse'>
            <div class='budget-title'><span>REUSE · 05</span><h3>Provisional until verified</h3><p>Each candidate must resolve to a real, loadable module before the run begins.</p></div>
            <div class='element-grid'>
              {{#each this.reuseCandidates as |item|}}
                <article class='element-card'><div class='element-mark'><strong>{{item.symbol}}</strong><span>CARD</span></div><h3>{{item.name}}</h3><p>{{item.use}}</p><small>{{item.source}} · {{item.proof}}</small></article>
              {{/each}}
            </div>
          </div>
          <div class='budget-block build'>
            <div class='budget-title'><span>BUILD / EXTEND · 10</span><h3>The complete local authoring budget</h3><p>Five domain cards, two reusable value fields, and three typed business commands.</p></div>
            <div class='element-grid build-grid'>
              {{#each this.buildArtifacts as |item|}}
                <article class='element-card'><div class='element-mark'><strong>{{item.symbol}}</strong><span>{{item.kind}} · {{item.number}}</span></div><h3>{{item.name}}</h3><p>{{item.responsibility}}</p><small>Depends on {{item.dependsOn}}</small></article>
              {{/each}}
            </div>
          </div>
          <div class='assumptions'><strong>ASSUMED SYSTEM CAPABILITIES — UNBOXED · UNCOUNTED</strong><p>{{#each this.systemAssumptions as |item index|}}{{#if index}} · {{/if}}{{item}}{{/each}}</p></div>
        </section>

        <section class='workflow section-pad'>
          <div class='section-head'><div class='section-label'><span>02</span><p>End-to-end flow</p></div><div><h2>Fact → interpretation → decision → product.</h2><p>The workflow preserves authority boundaries. A deterministic observation cannot silently become an AI claim; an AI claim cannot silently become a business decision.</p></div></div>
          <div class='workflow-list'>
            {{#each this.workflow as |step|}}
              <article class='workflow-row'><strong>{{step.number}}</strong><div class='workflow-name'><span>{{step.lane}}</span><h3>{{step.title}}</h3></div><p>{{step.action}}</p><div class='io'><span>IN</span><b>{{step.input}}</b><span>OUT</span><b>{{step.output}}</b></div><small>{{step.gate}}</small></article>
            {{/each}}
          </div>
        </section>

        <section class='search section-pad'>
          <div class='section-head'><div class='section-label'><span>03</span><p>Reuse gate</p></div><div><h2>Search before the factory writes.</h2><p>The five-card budget is a hypothesis until discovery produces module evidence. If a candidate fails, amend the brief first; do not quietly fabricate a local substitute mid-run.</p></div></div>
          <div class='search-table'>
            {{#each this.searchGates as |gate|}}
              <article><strong>{{gate.number}}</strong><h3>{{gate.action}}</h3><p>{{gate.evidence}}</p><small>FAIL WHEN · {{gate.failure}}</small></article>
            {{/each}}
          </div>
          <div class='manifest-rule'><strong>REUSE MANIFEST CONTRACT</strong><p>Candidate name · live CardDef CodeRef · realm · version signal · sample instance · three-format preview · compatibility note · decision · rejected alternatives · upgrade boundary.</p></div>
        </section>

        <section class='requirements section-pad'>
          <div class='section-head'><div class='section-label'><span>04</span><p>Requirements</p></div><div><h2>Ten artifacts. Ten acceptance contracts.</h2><p>These rows map directly to REQ-CC-001 through REQ-CC-010. The factory may split implementation work, but it may not blur or drop an obligation.</p></div></div>
          <div class='requirement-list'>
            {{#each this.buildArtifacts as |item|}}
              <article><div class='req-id'><span>REQ-CC-0{{item.number}}</span><strong>{{item.kind}}</strong></div><div><h3>{{item.name}}</h3><p>{{item.responsibility}}</p></div><div><span>DEPENDENCIES</span><p>{{item.dependsOn}}</p></div><div><span>ACCEPTANCE</span><p>{{item.acceptance}}</p></div></article>
            {{/each}}
          </div>
        </section>

        <section class='issues section-pad'>
          <div class='section-head'><div class='section-label'><span>05</span><p>Issue compiler</p></div><div><h2>Eight dependency-ordered work packets.</h2><p>An agent can convert each row into an issue without reinterpreting scope, prerequisites, or done conditions.</p></div></div>
          <div class='issue-list'>
            {{#each this.issuePlan as |issue|}}
              <article><strong>{{issue.id}}</strong><div><h3>{{issue.title}}</h3><p>{{issue.scope}}</p></div><div><span>DEPENDS</span><p>{{issue.dependsOn}}</p></div><div><span>DONE</span><p>{{issue.done}}</p></div></article>
            {{/each}}
          </div>
        </section>

        <section class='handoff section-pad'>
          <div class='section-head'><div class='section-label'><span>06</span><p>Agent handoff</p></div><div><h2>Compile the proposal into factory inputs.</h2><p>Before implementation, generate this packet from the approved brief. It turns narrative into search instructions, requirements, skills, issues, fixtures, and a measurable run.</p></div></div>
          <div class='handoff-grid'>
            {{#each this.handoff as |item|}}
              <article><span>{{item.artifact}}</span><strong>{{item.file}}</strong><p>{{item.contains}}</p></article>
            {{/each}}
          </div>
          <div class='authority-rule'><strong>STOP CONDITIONS</strong><p>Stop and revise the brief if fewer than five reuse candidates verify, the 10-artifact budget must grow, AI output cannot retain evidence and model identity, or finalization cannot fail closed.</p></div>
        </section>

        <section class='acceptance section-pad'>
          <div class='section-label'><span>07</span><p>Factory acceptance</p></div>
          <div class='acceptance-main'>
            <h2>Pass only when the product and the evidence agree.</h2>
            <div class='scenario-grid'>
              {{#each this.scenarios as |scenario|}}
                <article><span>{{scenario.name}}</span><p>{{scenario.fixture}}</p><strong>{{scenario.expected}}</strong><small>{{scenario.proves}}</small></article>
              {{/each}}
            </div>
            <div class='pass-grid'>
              <div><span>REUSE</span><strong>5 live userland CardDefs imported by module reference; zero copied schemas.</strong></div>
              <div><span>BUILD</span><strong>Exactly 10 authored or extended artifacts: 5 cards, 2 fields, 3 commands.</strong></div>
              <div><span>AUTHORITY</span><strong>Mechanical fact, AI suggestion, human decision, and policy finalization remain distinguishable.</strong></div>
              <div><span>QUALITY</span><strong>Lint, module-load, sample instances, command tests, render smoke, and three scenarios pass.</strong></div>
              <div><span>FACTORY DATA</span><strong>Discovery time, implementation time, tokens, rework, defects, and reuse decisions are recorded.</strong></div>
              <div><span>PRODUCT</span><strong>A rights lead can publish or block one real-feeling set and explain every consequential result.</strong></div>
            </div>
          </div>
        </section>

        <div class='proposal-footer'><strong>Factory Trial 03 · CueClear</strong><span>Narrow product. Full-stack proof. Honest reuse.</span></div>
      </article>

      <style scoped>
        .proposal { min-width: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
        .hero { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(17rem, 0.55fr); gap: clamp(2rem, 6vw, 7rem); padding: clamp(2.5rem, 6vw, 6rem); background: var(--foreground); color: var(--background); }
        .hero > div { min-width: 0; }
        .eyebrow, .section-label p, .hero-brief > span, .budget-title > span, .element-mark span, .workflow-name span, .io span, .req-id span, .requirement-list article > div > span, .issue-list span, .handoff-grid span, .scenario-grid span, .pass-grid span, .proposal-footer { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.12em; }
        .eyebrow { margin: 0 0 1.4rem; color: var(--primary); font-size: 0.68rem; font-weight: 700; }
        .hero h1 { max-width: 11ch; margin: 0; font-family: var(--font-serif); font-size: clamp(4rem, 8vw, 8.5rem); font-weight: 400; letter-spacing: -0.065em; line-height: 0.84; }
        .dek { max-width: 54rem; margin: 2rem 0 0; color: var(--muted); font-family: var(--font-serif); font-size: clamp(1.05rem, 1.7vw, 1.45rem); line-height: 1.5; }
        .hero-brief { align-self: end; display: grid; gap: 0.8rem; border-top: 1px solid var(--muted-foreground); padding-top: 1.2rem; }
        .hero-brief > span { color: var(--primary); font-size: 0.58rem; }
        .hero-brief strong { font-family: var(--font-serif); font-size: clamp(1.7rem, 2.8vw, 2.6rem); font-weight: 400; line-height: 1; }
        .hero-brief p { margin: 0; color: var(--muted); font-size: 0.82rem; line-height: 1.55; }
        .score-ribbon { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border-bottom: 1px solid var(--border); background: var(--card); }
        .score-ribbon > div { display: grid; gap: 0.2rem; padding: 1rem clamp(0.7rem, 1.8vw, 1.4rem); }
        .score-ribbon > div + div { border-left: 1px solid var(--border); }
        .score-ribbon strong { color: var(--primary); font-family: var(--font-serif); font-size: clamp(1.5rem, 2.5vw, 2.3rem); font-weight: 400; }
        .score-ribbon span { color: var(--muted-foreground); font: 600 0.56rem var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
        .section-pad { padding: clamp(2rem, 5vw, 5rem); }
        .section-label { display: grid; align-content: start; gap: 0.55rem; }
        .section-label > span { color: var(--primary); font-family: var(--font-serif); font-size: 2.5rem; line-height: 0.8; }
        .section-label p { margin: 0; color: var(--muted-foreground); font-size: 0.56rem; font-weight: 700; }
        .section-head { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem); margin-bottom: clamp(2rem, 4vw, 3.5rem); }
        .section-head h2, .thesis h2, .acceptance h2 { max-width: 18ch; margin: 0; font-family: var(--font-serif); font-size: clamp(2rem, 4.4vw, 4.5rem); font-weight: 400; letter-spacing: -0.045em; line-height: 0.98; }
        .section-head > div > p { max-width: 52rem; margin: 0.9rem 0 0; color: var(--muted-foreground); line-height: 1.55; }
        .thesis { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr) minmax(16rem, 0.42fr); gap: clamp(2rem, 5vw, 6rem); border-bottom: 1px solid var(--border); background: var(--card); }
        .thesis-copy p { max-width: 52rem; margin: 1.4rem 0 0; color: var(--muted-foreground); font-family: var(--font-serif); font-size: 1.05rem; line-height: 1.65; }
        .rule, .authority-rule, .manifest-rule { align-self: end; border-top: 0.28rem solid var(--primary); padding-top: 1rem; }
        .rule strong, .authority-rule strong, .manifest-rule strong, .assumptions strong { color: var(--primary); font: 700 0.58rem var(--font-mono); letter-spacing: 0.12em; }
        .rule p, .authority-rule p, .manifest-rule p, .assumptions p { margin: 0.7rem 0 0; font-size: 0.75rem; line-height: 1.6; }
        .budget, .requirements, .handoff { background: var(--card); }
        .budget-block { display: grid; grid-template-columns: minmax(12rem, 0.27fr) minmax(0, 1fr); border-top: 1px solid var(--border); }
        .budget-block + .budget-block { margin-top: 2rem; }
        .budget-title { padding: 1.2rem 1.5rem 1.2rem 0; }
        .budget-title > span { color: var(--primary); font-size: 0.52rem; font-weight: 700; }
        .budget-title h3 { margin: 0.75rem 0 0; font-family: var(--font-serif); font-size: 1.4rem; font-weight: 400; }
        .budget-title p { margin: 0.7rem 0 0; color: var(--muted-foreground); font-size: 0.68rem; line-height: 1.5; }
        .element-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-left: 1px solid var(--border); }
        .build-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        .element-card { min-width: 0; min-height: 14rem; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 0.8rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--family-bsl) 7%, var(--background)); }
        .build .element-card { background: color-mix(in srgb, var(--family-actions) 9%, var(--background)); }
        .element-mark { display: flex; justify-content: space-between; gap: 0.5rem; align-items: start; }
        .element-mark strong { color: var(--family-bsl); font-family: var(--font-serif); font-size: 2.2rem; font-weight: 400; letter-spacing: -0.05em; line-height: 1; }
        .build .element-mark strong { color: var(--family-actions); }
        .element-mark span { color: var(--muted-foreground); font-size: 0.43rem; font-weight: 700; text-align: right; }
        .element-card h3 { margin: 0; font-family: var(--font-serif); font-size: 1rem; font-weight: 500; }
        .element-card p { margin: 0; color: var(--foreground); font-size: 0.66rem; line-height: 1.48; }
        .element-card small { border-top: 1px solid var(--border); padding-top: 0.6rem; color: var(--muted-foreground); font-size: 0.54rem; line-height: 1.45; }
        .assumptions { margin-top: 2rem; border-top: 1px solid var(--border); padding-top: 1rem; }
        .workflow, .issues, .acceptance { border-top: 1px solid var(--border); }
        .workflow-list, .requirement-list, .issue-list { display: grid; border-top: 1px solid var(--border); }
        .workflow-row { display: grid; grid-template-columns: 3.5rem minmax(12rem, 0.75fr) minmax(18rem, 1.2fr) minmax(12rem, 0.8fr) minmax(14rem, 0.9fr); border-bottom: 1px solid var(--border); }
        .workflow-row > * { min-width: 0; padding: 1rem; }
        .workflow-row > * + * { border-left: 1px solid var(--border); }
        .workflow-row > strong { color: var(--primary); font: 400 1.5rem var(--font-serif); text-align: center; }
        .workflow-name span, .io span { color: var(--family-actions); font-size: 0.48rem; font-weight: 700; }
        .workflow-name h3 { margin: 0.35rem 0 0; font-family: var(--font-serif); font-size: 1rem; font-weight: 500; }
        .workflow-row > p { margin: 0; color: var(--muted-foreground); font-size: 0.67rem; line-height: 1.5; }
        .io { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem 0.6rem; align-content: center; }
        .io b { font-size: 0.62rem; line-height: 1.4; }
        .workflow-row > small { color: var(--muted-foreground); font: 600 0.54rem/1.45 var(--font-mono); }
        .search { background: var(--foreground); color: var(--background); }
        .search .section-head > div > p, .search .section-label p { color: var(--muted); }
        .search-table { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-top: 1px solid var(--muted-foreground); border-left: 1px solid var(--muted-foreground); }
        .search-table article { min-width: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 0.8rem; padding: 1.1rem; border-right: 1px solid var(--muted-foreground); border-bottom: 1px solid var(--muted-foreground); }
        .search-table article > strong { color: var(--primary); font: 400 1.6rem var(--font-serif); }
        .search-table h3 { margin: 0; font-family: var(--font-serif); font-size: 1rem; font-weight: 500; }
        .search-table p { margin: 0; color: var(--muted); font-size: 0.65rem; line-height: 1.5; }
        .search-table small { border-top: 1px solid var(--muted-foreground); padding-top: 0.6rem; color: var(--primary); font: 600 0.5rem/1.45 var(--font-mono); }
        .manifest-rule { margin-top: 1.5rem; }
        .manifest-rule p { color: var(--muted); }
        .requirement-list article, .issue-list article { display: grid; grid-template-columns: minmax(6rem, 0.32fr) minmax(14rem, 0.9fr) minmax(11rem, 0.65fr) minmax(17rem, 1fr); border-bottom: 1px solid var(--border); }
        .requirement-list article > *, .issue-list article > * { min-width: 0; padding: 0.9rem 1rem; }
        .requirement-list article > * + *, .issue-list article > * + * { border-left: 1px solid var(--border); }
        .req-id { display: grid; align-content: start; gap: 0.4rem; }
        .req-id span, .requirement-list article > div > span, .issue-list span { color: var(--family-actions); font-size: 0.48rem; font-weight: 700; }
        .req-id strong { font: 400 1rem var(--font-serif); }
        .requirement-list h3, .issue-list h3 { margin: 0; font-family: var(--font-serif); font-size: 1rem; font-weight: 500; }
        .requirement-list p, .issue-list p { margin: 0.35rem 0 0; color: var(--muted-foreground); font-size: 0.63rem; line-height: 1.48; }
        .issue-list article > strong { color: var(--primary); font: 400 1.2rem var(--font-serif); }
        .handoff-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .handoff-grid article { min-width: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 0.75rem; min-height: 9rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .handoff-grid span { color: var(--family-objects); font-size: 0.48rem; font-weight: 700; }
        .handoff-grid strong { overflow-wrap: anywhere; font-family: var(--font-serif); font-size: 0.95rem; font-weight: 500; }
        .handoff-grid p { margin: 0; color: var(--muted-foreground); font-size: 0.63rem; line-height: 1.5; }
        .authority-rule { margin-top: 1.5rem; }
        .acceptance { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem); }
        .scenario-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 2.5rem; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .scenario-grid article { min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 0.8rem; min-height: 14rem; padding: 1.1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .scenario-grid span, .pass-grid span { color: var(--primary); font-size: 0.5rem; font-weight: 700; }
        .scenario-grid p { margin: 0; color: var(--muted-foreground); font-size: 0.68rem; line-height: 1.5; }
        .scenario-grid strong { font-family: var(--font-serif); font-size: 0.9rem; font-weight: 500; line-height: 1.45; }
        .scenario-grid small { border-top: 1px solid var(--border); padding-top: 0.6rem; color: var(--muted-foreground); font-size: 0.57rem; line-height: 1.45; }
        .pass-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 2rem; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .pass-grid > div { display: grid; gap: 0.7rem; min-height: 7rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .pass-grid strong { font-family: var(--font-serif); font-size: 0.85rem; font-weight: 500; line-height: 1.5; }
        .proposal-footer { display: flex; justify-content: space-between; gap: 2rem; padding: 1.3rem clamp(1rem, 3vw, 2.5rem); background: var(--foreground); color: var(--muted); font-size: 0.56rem; line-height: 1.5; }
        .proposal-footer strong { color: var(--primary); }
        @media (max-width: 72rem) { .element-grid, .build-grid, .search-table { grid-template-columns: repeat(3, minmax(0, 1fr)); } .workflow-row { grid-template-columns: 3.5rem minmax(12rem, 0.65fr) minmax(0, 1fr); } .workflow-row .io, .workflow-row > small { grid-column: 2 / -1; border-top: 1px solid var(--border); } }
        @media (max-width: 54rem) { .hero, .thesis, .section-head, .acceptance, .budget-block { grid-template-columns: 1fr; } .score-ribbon, .element-grid, .build-grid, .search-table, .scenario-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .score-ribbon > div:nth-child(4) { border-left: 1px solid var(--border); } .budget-title { padding-right: 0; } .requirement-list article, .issue-list article { grid-template-columns: 7rem minmax(0, 1fr); } .requirement-list article > :nth-child(n + 3), .issue-list article > :nth-child(n + 3) { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } }
        @media (max-width: 38rem) { .score-ribbon, .element-grid, .build-grid, .search-table, .scenario-grid, .pass-grid { grid-template-columns: 1fr; } .score-ribbon > div + div { border-left: 0; border-top: 1px solid var(--border); } .workflow-row { grid-template-columns: 3.5rem minmax(0, 1fr); } .workflow-row > p, .workflow-row .io, .workflow-row > small { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } .proposal-footer { flex-direction: column; } }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof CueClearProposal> { // ¹³ Compact brief preserves the exact artifact budget
    <template>
      <article class='embedded'><span>{{@model.experimentLabel}} · Factory Trial 03</span><h2>{{@model.appName}}</h2><p>{{@model.subhead}}</p><div><strong>5</strong><small>reuse cards</small><strong>10</strong><small>build items</small><strong>3</strong><small>commands</small><strong>3</strong><small>scenarios</small></div></article>
      <style scoped>
        .embedded { display: grid; gap: 0.75rem; padding: 1.2rem; background: var(--card); color: var(--foreground); font-family: var(--font-sans); }
        .embedded > span { color: var(--primary); font: 700 0.56rem var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        h2 { margin: 0; font-family: var(--font-serif); font-size: 1.8rem; font-weight: 400; letter-spacing: -0.03em; }
        p { max-width: 48rem; margin: 0; color: var(--muted-foreground); font-family: var(--font-serif); line-height: 1.5; }
        .embedded > div { display: grid; grid-template-columns: repeat(4, auto minmax(0, 1fr)); align-items: baseline; gap: 0.3rem 0.55rem; border-top: 1px solid var(--border); padding-top: 0.75rem; }
        .embedded > div strong { color: var(--primary); font-family: var(--font-serif); font-size: 1.2rem; font-weight: 400; }
        .embedded > div small { color: var(--muted-foreground); font: 600 0.5rem var(--font-mono); text-transform: uppercase; }
        @media (max-width: 36rem) { .embedded > div { grid-template-columns: repeat(2, auto minmax(0, 1fr)); } }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof CueClearProposal> { // ¹⁴ Container-query trial ticket works across parent-owned card sizes
    <template>
      <article class='fit'><div class='fit-header'><span>{{@model.experimentLabel}}</span><strong>03</strong></div><div class='fit-body'><p>Software factory trial</p><h2>{{@model.appName}}</h2><small>{{@model.subhead}}</small></div><div class='fit-metrics'><span><strong>5</strong> reuse</span><span><strong>10</strong> build</span><span><strong>3</strong> commands</span></div><div class='fit-footer'><span>Output</span><strong>Governed Cue Sheet</strong></div></article>
      <style scoped>
        .fit { --type-ratio: 1.28; --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb)); --type-base: clamp(9px, calc(4px + 2cqi + 0.8cqb - 0.45 * var(--ar)), 18px); --label: max(7px, calc(var(--type-base) / pow(var(--type-ratio), 1.5))); --body: max(9px, calc(var(--type-base) / var(--type-ratio))); --title: max(12px, calc(var(--type-base) * pow(var(--type-ratio), 1.5))); width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto auto; gap: clamp(4px, 2cqi, 12px); padding: clamp(7px, 4cqi, 20px); overflow: hidden; background: var(--foreground); color: var(--background); font-family: var(--font-sans); }
        .fit-header, .fit-body, .fit-metrics, .fit-footer { min-width: 0; min-height: 0; overflow: hidden; }
        .fit-header { display: flex; justify-content: space-between; gap: 0.5rem; align-items: start; }
        .fit-header span { color: var(--primary); font: 700 var(--label) var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        .fit-header strong { color: var(--primary); font-family: var(--font-serif); font-size: var(--title); font-weight: 400; line-height: 0.8; }
        .fit-body { display: grid; align-content: center; gap: clamp(3px, 1cqb, 8px); }
        .fit-body p { margin: 0; color: var(--muted); font: 700 var(--label) var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        .fit-body h2 { display: -webkit-box; margin: 0; overflow: hidden; color: var(--background); font-family: var(--font-serif); font-size: var(--title); font-weight: 400; letter-spacing: -0.035em; line-height: 1; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
        .fit-body small { display: -webkit-box; overflow: hidden; color: var(--muted); font-size: var(--body); -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
        .fit-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--muted-foreground); border-bottom: 1px solid var(--muted-foreground); }
        .fit-metrics span { display: grid; gap: 0.1rem; padding: clamp(3px, 1.2cqi, 8px); color: var(--muted); font: 600 var(--label) var(--font-mono); text-transform: uppercase; }
        .fit-metrics span + span { border-left: 1px solid var(--muted-foreground); }
        .fit-metrics strong { color: var(--primary); font-family: var(--font-serif); font-size: var(--body); font-weight: 400; }
        .fit-footer { display: flex; justify-content: space-between; gap: 0.5rem; color: var(--muted); font: 600 var(--label) var(--font-mono); text-transform: uppercase; }
        .fit-footer strong { color: var(--primary); }
        @container fitted-card (height <= 80px) { .fit { grid-template-rows: minmax(0, 1fr); } .fit-header, .fit-metrics, .fit-footer, .fit-body small, .fit-body p { display: none; } .fit-body { align-content: center; } .fit-body h2 { -webkit-line-clamp: 2; } }
        @container fitted-card (80px < height <= 130px) { .fit { grid-template-rows: auto minmax(0, 1fr) auto; } .fit-metrics, .fit-body small { display: none; } }
        @container fitted-card (width <= 170px) { .fit-metrics span:nth-child(2), .fit-metrics span:nth-child(3), .fit-body small { display: none; } .fit-metrics { grid-template-columns: 1fr; } }
      </style>
    </template>
  };
}
