// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api'; // ¹ Proposal stays a single portable document CardDef
import StringField from 'https://cardstack.com/base/string';
import FactoryIcon from '@cardstack/boxel-icons/factory'; // ² CDN-verified 2026-07-21
import PublicationNav from './components/publication-nav'; // ¹⁴ Standalone publication navigation

interface StackLayer {
  number: string;
  label: string;
  title: string;
  disposition: string;
  items: string[];
  proof: string;
  tone: string;
}

interface ModelPlan {
  name: string;
  purpose: string;
  links: string;
  graduation: string;
}

interface ReusePlan {
  source: string;
  models: string;
  use: string;
  rule: string;
}

interface CommandPlan {
  order: string;
  name: string;
  input: string;
  output: string;
  responsibility: string;
}

interface ComponentPlan {
  need: string;
  candidate: string;
  surface: string;
  acceptance: string;
}

interface PhasePlan {
  order: string;
  phase: string;
  target: string;
  output: string;
  gate: string;
}

interface MetricPlan {
  dimension: string;
  target: string;
  measurement: string;
  failure: string;
}

const STACK_LAYERS: StackLayer[] = [ // ³ This is the bounded matrix slice the factory must traverse
  {
    number: '06',
    label: 'Product',
    title: 'Vendor Readiness Workspace',
    disposition: 'BUILD',
    items: ['Home dashboard', 'Case workspace', 'Command rail', 'Searchable run history'],
    proof: 'A user can take one vendor from intake through a signed-ready contract without leaving the app.',
    tone: 'solution',
  },
  {
    number: '05.5A',
    label: 'App-owned domain',
    title: 'Readiness orchestration',
    disposition: 'BUILD',
    items: ['Vendor Readiness Case', 'Evidence Request', 'Risk Assessment', 'Approval Decision'],
    proof: 'Only workflow-specific semantics are authored locally; each new type has a reason it cannot be reused unchanged.',
    tone: 'owned',
  },
  {
    number: '05.5K',
    label: 'Domain kits',
    title: 'Vendor + Legal models',
    disposition: 'IMPORT',
    items: ['Vendor', 'Vendor Profile', 'Contract', 'Clause', 'Legal Entity', 'Signatory'],
    proof: 'The app links directly to inspected catalog modules. No copied schema and no local compatibility wrapper.',
    tone: 'kit',
  },
  {
    number: '05',
    label: 'Common records',
    title: 'Operational spine',
    disposition: 'IMPORT',
    items: ['Company', 'Person', 'Task', 'Document', 'Note'],
    proof: 'Generic identity, assignment, documents, and notes remain shared records rather than app-owned variants.',
    tone: 'record',
  },
  {
    number: '04–02',
    label: 'Contracts',
    title: 'Shared fields and value semantics',
    disposition: 'IMPORT',
    items: ['Status', 'Owner', 'Address', 'Risk Rating', 'Effective Period', 'Signature Block'],
    proof: 'Known value shapes use existing FieldDefs and editors; the factory does not rebuild primitive or compound fields.',
    tone: 'field',
  },
  {
    number: '03',
    label: 'Presentation',
    title: 'Catalog components',
    disposition: 'DISCOVER',
    items: ['Guided Form', 'Kanban', 'Cards Grid', 'Table', 'Document Preview', 'Activity Feed', 'Audit Timeline'],
    proof: 'Every component choice records its catalog listing, preview evidence, module reference, and rejected alternatives.',
    tone: 'component',
  },
  {
    number: '01–03',
    label: 'Execution',
    title: 'Platform tools + app verbs',
    disposition: 'COMPOSE',
    items: ['Search Cards', 'Save Card', 'Run Command', 'Five typed app commands'],
    proof: 'Custom commands own business transitions; CRUD, search, persistence, lint, and indexing stay platform concerns.',
    tone: 'tool',
  },
];

const OWNED_MODELS: ModelPlan[] = [ // ⁴ These are intentionally local until repetition proves catalog value
  {
    name: 'VendorReadinessCase',
    purpose: 'The aggregate that owns stage, target company, vendor, owner, open evidence, assessment, decision, and contract readiness.',
    links: 'VendorProfile · Company · Person · EvidenceRequest[] · RiskAssessment · ApprovalDecision · Contract',
    graduation: 'Graduate only after three unrelated apps share the same lifecycle without app-specific fields.',
  },
  {
    name: 'EvidenceRequest',
    purpose: 'A typed request for a required document or assertion, including recipient, due date, status, and received evidence.',
    links: 'VendorReadinessCase · Person · Document[] · Task',
    graduation: 'Candidate for a compliance kit if the same request contract appears outside vendor onboarding.',
  },
  {
    name: 'RiskAssessment',
    purpose: 'The app-specific interpretation of evidence: factors, weighted score, findings, recommendation, and policy version.',
    links: 'VendorReadinessCase · EvidenceRequest[] · VendorProfile',
    graduation: 'Keep local while scoring policy remains the app’s differentiating logic; standardize only the exchange projection.',
  },
  {
    name: 'ApprovalDecision',
    purpose: 'An immutable decision record with conditions, rationale, authority, and the exact assessment it approved or rejected.',
    links: 'VendorReadinessCase · RiskAssessment · Signatory',
    graduation: 'The decision envelope may graduate; the vendor-readiness decision policy remains app-owned.',
  },
];

const REUSE_PLANS: ReusePlan[] = [ // ⁵ Direct module reuse is a hard requirement, not an optimization left for later
  {
    source: 'Vendor kit',
    models: 'Vendor · Vendor Profile',
    use: 'Identity, commercial profile, contacts, status, and portable vendor data.',
    rule: 'Import and link. Never copy fields into VendorReadinessCase.',
  },
  {
    source: 'Legal kit',
    models: 'Contract · Clause · Legal Entity · Signatory',
    use: 'Contract output, approved language, party identity, and signature authority.',
    rule: 'Use the verified CardDefs directly; local code may only bind them into the workflow.',
  },
  {
    source: 'Common records',
    models: 'Company · Person · Task · Document · Note',
    use: 'Organization context, assignees, follow-up work, evidence files, and commentary.',
    rule: 'Prefer stable shared models even when a one-off local record would be quicker to sketch.',
  },
  {
    source: 'Base + standards',
    models: 'Status · Owner · Address · dates · risk values · signature values',
    use: 'Canonical serialization, editors, validation, and portable exchange semantics.',
    rule: 'A new FieldDef requires a documented failed search and an explicit semantic gap.',
  },
];

const COMMANDS: CommandPlan[] = [ // ⁶ Typed verbs prove that reused and local models compose behaviorally
  {
    order: '01',
    name: 'StartVendorReadiness',
    input: 'VendorProfile + Company + Person',
    output: 'VendorReadinessCase',
    responsibility: 'Create the case, establish ownership, and materialize the evidence checklist from policy.',
  },
  {
    order: '02',
    name: 'RequestEvidence',
    input: 'VendorReadinessCase + Person + requirement',
    output: 'EvidenceRequest + Task',
    responsibility: 'Create a traceable request and a shared operational follow-up without inventing a local task type.',
  },
  {
    order: '03',
    name: 'EvaluateVendorRisk',
    input: 'VendorReadinessCase + EvidenceRequest[]',
    output: 'RiskAssessment',
    responsibility: 'Apply the app-owned scoring policy, preserve inputs, and explain every finding.',
  },
  {
    order: '04',
    name: 'DecideVendor',
    input: 'RiskAssessment + Signatory',
    output: 'ApprovalDecision',
    responsibility: 'Accept, conditionally accept, or reject. A decision cannot silently mutate its source assessment.',
  },
  {
    order: '05',
    name: 'PrepareVendorContract',
    input: 'ApprovalDecision + LegalEntity[] + Clause[]',
    output: 'Contract',
    responsibility: 'Produce a legal-kit Contract only when the decision is eligible; rejected cases create no contract.',
  },
];

const COMPONENTS: ComponentPlan[] = [ // ⁷ The factory searches, previews, records, then imports these surfaces
  { need: 'Intake', candidate: 'Guided Form', surface: 'Vendor and contact intake', acceptance: 'Supports typed field slots and conditional sections.' },
  { need: 'Flow', candidate: 'Kanban', surface: 'Readiness stage board', acceptance: 'Accepts fitted case cards and preserves card identity during movement.' },
  { need: 'Portfolio', candidate: 'Cards Grid', surface: 'All vendor cases', acceptance: 'Uses realm-scoped search and opens a case through viewCard.' },
  { need: 'Analysis', candidate: 'Table', surface: 'Risk factors and evidence coverage', acceptance: 'Columns can render canonical field components without flattening values.' },
  { need: 'Evidence', candidate: 'Document Preview', surface: 'Received files and contract output', acceptance: 'Renders linked FileDefs; no bytes or external URLs live in card JSON.' },
  { need: 'Coordination', candidate: 'Activity Feed', surface: 'Requests, notes, decisions, and command events', acceptance: 'Mixed typed entries render through their own formats.' },
  { need: 'Assurance', candidate: 'Audit Timeline', surface: 'Immutable decision trail', acceptance: 'Shows actor, timestamp, source, command, and output reference.' },
];

const PHASES: PhasePlan[] = [ // ⁸ Time bands are hypotheses to record against actual factory telemetry
  { order: '0', phase: 'Freeze the control estimate', target: '15 min', output: 'Greenfield file/module/token estimate', gate: 'Recorded before catalog search so hindsight cannot lower the baseline.' },
  { order: '1', phase: 'Discover and preview reuse', target: '30–45 min', output: 'Reuse manifest with candidate and chosen module refs', gate: 'No new model, field, or component code until the manifest is reviewed.' },
  { order: '2', phase: 'Bind reused modules', target: '20–30 min', output: 'Compile-ready imports and relationship plan', gate: 'Every reused type loads by absolute CodeRef and is represented by a sample instance.' },
  { order: '3', phase: 'Build app-owned models', target: '60–90 min', output: 'Four CardDefs + realistic sample data', gate: 'Each local field documents why it belongs here rather than on a reused model.' },
  { order: '4', phase: 'Build typed verbs', target: '60–90 min', output: 'Five Commands + input/output cards + tests', gate: 'Happy, blocked, and rejected transitions are executable.' },
  { order: '5', phase: 'Compose the Layer 06 app', target: '60–90 min', output: 'Home dashboard + case workspace', gate: 'Catalog components are imported, not visually approximated.' },
  { order: '6', phase: 'Validate and report', target: '45–60 min', output: 'Run record, reuse ledger, results report, live demo', gate: 'Lint, module load, instances, command behavior, three scenarios, and isolated render pass.' },
];

const METRICS: MetricPlan[] = [ // ⁹ Fast, better, and cheaper are falsifiable rather than marketing claims
  {
    dimension: 'FAST',
    target: '≤ 6 hours elapsed; ≤ 45 minutes discovery',
    measurement: 'Factory event timestamps by phase, excluding explicitly recorded indexing wait.',
    failure: 'Stop line at 8 hours or discovery above 25% of the run.',
  },
  {
    dimension: 'REUSE',
    target: '≥ 60% of named concepts resolved by module reuse',
    measurement: 'Reused CardDefs, FieldDefs, components, and platform tools ÷ all named build concepts.',
    failure: 'Any copied catalog schema or locally rebuilt discoverable component.',
  },
  {
    dimension: 'CHEAPER',
    target: '≤ 60% of the frozen greenfield token estimate',
    measurement: 'Input + output tokens split into discovery, unique implementation, validation, and rework.',
    failure: 'Reuse search consumes more tokens than the implementation it avoided.',
  },
  {
    dimension: 'BETTER',
    target: 'Zero duplicate contracts; five typed commands; three passing scenarios',
    measurement: 'Architecture audit, source provenance, command tests, module-load checks, and render smoke tests.',
    failure: 'Untyped state mutation, broken provenance, or workflow logic embedded in presentation components.',
  },
  {
    dimension: 'MAINTAINABLE',
    target: 'Catalog upgrades remain isolated to module bindings',
    measurement: 'Swap one compatible catalog module version and rerun the app without changing app-owned schemas.',
    failure: 'A reusable-model change forces duplicate-field edits across the app.',
  },
];

export class FactoryRunProposal extends CardDef { // ¹⁰ A live proposal card, not the application it proposes
  static displayName = 'Software Factory Run Proposal';
  static icon = FactoryIcon;
  static prefersWideFormat = true;

  @field experimentLabel = contains(StringField);
  @field headline = contains(StringField);
  @field subhead = contains(StringField);
  @field appName = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: FactoryRunProposal) {
      return this.cardInfo?.name?.trim()?.length
        ? this.cardInfo.name
        : (this.headline ?? `Untitled ${this.constructor.displayName}`);
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: FactoryRunProposal) {
      return this.cardInfo?.summary?.trim()?.length
        ? this.cardInfo.summary
        : this.subhead;
    },
  });

  static isolated = class Isolated extends Component<typeof FactoryRunProposal> { // ¹¹ The full document is an experiment brief and scorecard template
    stackLayers = STACK_LAYERS;
    ownedModels = OWNED_MODELS;
    reusePlans = REUSE_PLANS;
    commands = COMMANDS;
    components = COMPONENTS;
    phases = PHASES;
    metrics = METRICS;

    <template>
      <PublicationNav @active='vendor' /> {{! ¹⁵ Host route, deliberately not viewCard }}
      <article class='proposal'>
        <div class='hero'>
          <div class='hero-copy'>
            <p class='eyebrow'>{{@model.experimentLabel}} · Layer 06 target</p>
            <h1>{{@model.headline}}</h1>
            <p class='dek'>{{@model.subhead}}</p>
          </div>
          <div class='hero-brief'>
            <span>Proposed build</span>
            <strong>{{@model.appName}}</strong>
            <p>One bounded workflow where reused nouns, app-owned judgment, typed verbs, and catalog presentation must work together.</p>
          </div>
        </div>

        <section class='score-ribbon' aria-label='Experiment shape'>
          <div><strong>1</strong><span>complete app</span></div>
          <div><strong>4</strong><span>owned models</span></div>
          <div><strong>15+</strong><span>reused contracts</span></div>
          <div><strong>5</strong><span>typed verbs</span></div>
          <div><strong>7</strong><span>catalog surfaces</span></div>
          <div><strong>≤6h</strong><span>target elapsed</span></div>
        </section>

        <section class='thesis section-pad'>
          <div class='section-label'><span>00</span><p>Experiment thesis</p></div>
          <div class='thesis-copy'>
            <h2>Build the thin layer of judgment. Reuse everything beneath it.</h2>
            <p>The trial asks whether a software factory can deliver a credible application by spending its implementation budget on the workflow that is actually specific: readiness policy, evidence interpretation, and approval. Identity, legal records, common operations, values, editors, layouts, search, and persistence should arrive as mature modules.</p>
          </div>
          <div class='hypothesis'>
            <span>Testable hypothesis</span>
            <p>If the catalog is searchable and modules are architected for composition, at least 60% of named build concepts should be reused and total tokens should remain below 60% of a frozen greenfield estimate—without reducing the quality gate.</p>
          </div>
        </section>

        <section class='matrix-slice'>
          <div class='section-head section-pad'>
            <div class='section-label'><span>01</span><p>Matrix slice</p></div>
            <div><h2>The smallest build that exercises the whole system</h2><p>Each row has a disposition and a proof obligation. “Reuse” only counts when a real module is loaded and rendered.</p></div>
          </div>
          <div class='stack-table'>
            {{#each this.stackLayers as |layer|}}
              <div class='stack-row tone-{{layer.tone}}'>
                <div class='stack-number'><strong>{{layer.number}}</strong><span>{{layer.label}}</span></div>
                <div class='stack-title'><span>{{layer.disposition}}</span><h3>{{layer.title}}</h3></div>
                <div class='stack-items'>{{#each layer.items as |item|}}<span>{{item}}</span>{{/each}}</div>
                <p class='stack-proof'>{{layer.proof}}</p>
              </div>
            {{/each}}
          </div>
        </section>

        <section class='owned-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>02</span><p>Owned semantics</p></div>
            <div><h2>Four new models, all subordinate to the app’s policy</h2><p>These types begin locally. Their exchange projections may graduate later; premature standardization would erase the experiment’s special sauce.</p></div>
          </div>
          <div class='model-grid'>
            {{#each this.ownedModels as |model|}}
              <article class='model-card'>
                <span>NEW · APP-OWNED</span>
                <h3>{{model.name}}</h3>
                <p>{{model.purpose}}</p>
                <dl><div><dt>Links</dt><dd>{{model.links}}</dd></div><div><dt>Graduation rule</dt><dd>{{model.graduation}}</dd></div></dl>
              </article>
            {{/each}}
          </div>
        </section>

        <section class='reuse-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>03</span><p>Reuse contract</p></div>
            <div><h2>Import the nouns. Do not remake them.</h2><p>The factory records a source listing, exact module reference, preview result, and compatibility decision for every reused family.</p></div>
          </div>
          <div class='reuse-table'>
            <div class='reuse-head'><span>Source</span><span>Models</span><span>Use in app</span><span>Guardrail</span></div>
            {{#each this.reusePlans as |reuse|}}
              <div class='reuse-row'><strong>{{reuse.source}}</strong><p>{{reuse.models}}</p><p>{{reuse.use}}</p><p>{{reuse.rule}}</p></div>
            {{/each}}
          </div>
        </section>

        <section class='command-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>04</span><p>Typed verbs</p></div>
            <div><h2>Five transitions make the workflow real</h2><p>Commands own state change. Presentation components receive cards and invoke verbs; they do not embed business policy.</p></div>
          </div>
          <div class='command-flow'>
            {{#each this.commands as |command|}}
              <article class='command-card'>
                <div class='command-index'>{{command.order}}</div>
                <div class='command-name'><span>COMMAND</span><h3>{{command.name}}</h3><p>{{command.responsibility}}</p></div>
                <div class='io'><div><span>IN</span><strong>{{command.input}}</strong></div><b>→</b><div><span>OUT</span><strong>{{command.output}}</strong></div></div>
              </article>
            {{/each}}
          </div>
        </section>

        <section class='component-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>05</span><p>Component discovery</p></div>
            <div><h2>Search → preview → select → import</h2><p>A component is not “found” because its name appears in the matrix. It must load from the catalog and satisfy the acceptance test in the target composition.</p></div>
          </div>
          <div class='component-grid'>
            {{#each this.components as |surface|}}
              <article class='component-card'>
                <div><span>{{surface.need}}</span><strong>{{surface.candidate}}</strong></div>
                <p>{{surface.surface}}</p>
                <small>{{surface.acceptance}}</small>
              </article>
            {{/each}}
          </div>
          <div class='no-rebuild-rule'><strong>NO-REBUILD RULE</strong><p>The factory may author a replacement only after a catalog search, preview, and compatibility note show that no candidate meets the need. “Faster to code it” is not an accepted reason.</p></div>
        </section>

        <section class='run-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>06</span><p>Run protocol</p></div>
            <div><h2>A six-hour target with an eight-hour stop line</h2><p>Phase timestamps, token use, search attempts, rejected candidates, module references, and rework are captured as factory events.</p></div>
          </div>
          <div class='phase-list'>
            {{#each this.phases as |phase|}}
              <article class='phase-row'><strong>{{phase.order}}</strong><div><span>{{phase.target}}</span><h3>{{phase.phase}}</h3></div><p>{{phase.output}}</p><small>{{phase.gate}}</small></article>
            {{/each}}
          </div>
        </section>

        <section class='metrics-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>07</span><p>Scorecard</p></div>
            <div><h2>What success must prove</h2><p>The run can fail. That is useful: the failure location tells us whether catalog search, module contracts, components, commands, or factory orchestration needs work.</p></div>
          </div>
          <div class='metric-grid'>
            {{#each this.metrics as |metric|}}
              <article class='metric-card'><span>{{metric.dimension}}</span><strong>{{metric.target}}</strong><p>{{metric.measurement}}</p><small>FAIL IF · {{metric.failure}}</small></article>
            {{/each}}
          </div>
        </section>

        <section class='acceptance section-pad'>
          <div class='section-label'><span>08</span><p>Final product</p></div>
          <div class='acceptance-main'>
            <h2>The post-build artifact is an application and an evidence packet.</h2>
            <div class='acceptance-grid'>
              <div><span>LIVE APP</span><strong>Home dashboard, case board, intake, evidence viewer, risk table, decision trail, and command rail.</strong></div>
              <div><span>SCENARIOS</span><strong>Ready vendor reaches Contract; missing evidence blocks evaluation; rejected assessment creates no Contract.</strong></div>
              <div><span>REUSE MANIFEST</span><strong>Listing URL, CodeRef, version, preview evidence, decision, and upgrade boundary for every imported artifact.</strong></div>
              <div><span>RUN RECORD</span><strong>Actual phase time, tokens, cost, search attempts, files authored, modules reused, defects, and rework.</strong></div>
              <div><span>QUALITY PROOF</span><strong>Local and remote lint, module-load probes, indexed instances, command tests, render smoke, and PDF-ready handoff.</strong></div>
              <div><span>RETROSPECTIVE</span><strong>Which local models should graduate, which catalog components failed, and where factory instructions wasted time.</strong></div>
            </div>
          </div>
        </section>

        <div class='proposal-footer'>
          <strong>Factory Trial 01 · Vendor Readiness</strong>
          <span>Spend tokens on the business distinction—not on rebuilding the substrate.</span>
        </div>
      </article>

      <style scoped>
        .proposal { min-width: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
        .hero { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(17rem, 0.55fr); gap: clamp(2rem, 6vw, 7rem); padding: clamp(2.5rem, 6vw, 6rem); background: var(--foreground); color: var(--background); }
        .hero-copy { min-width: 0; }
        .eyebrow, .section-label p, .hero-brief > span, .stack-title > span, .model-card > span, .command-name > span, .io span, .component-card span, .reuse-head, .metric-card > span, .acceptance-grid span, .proposal-footer { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.13em; }
        .eyebrow { margin: 0 0 1.4rem; color: var(--primary); font-size: 0.68rem; font-weight: 700; }
        .hero h1 { max-width: 12ch; margin: 0; font-family: var(--font-serif); font-size: clamp(3.2rem, 7.4vw, 8rem); font-weight: 400; letter-spacing: -0.065em; line-height: 0.87; }
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
        .section-label span { color: var(--primary); font-family: var(--font-serif); font-size: 2.5rem; line-height: 0.8; }
        .section-label p { margin: 0; color: var(--muted-foreground); font-size: 0.56rem; font-weight: 700; }
        .section-head { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem); margin-bottom: clamp(2rem, 4vw, 3.5rem); }
        .section-head h2, .thesis h2, .acceptance h2 { max-width: 17ch; margin: 0; font-family: var(--font-serif); font-size: clamp(2rem, 4.4vw, 4.5rem); font-weight: 400; letter-spacing: -0.045em; line-height: 0.98; }
        .section-head > div > p { max-width: 50rem; margin: 0.9rem 0 0; color: var(--muted-foreground); line-height: 1.55; }
        .thesis { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr) minmax(16rem, 0.42fr); gap: clamp(2rem, 5vw, 6rem); border-bottom: 1px solid var(--border); background: var(--card); }
        .thesis-copy p { max-width: 52rem; margin: 1.5rem 0 0; color: var(--muted-foreground); font-family: var(--font-serif); font-size: 1.05rem; line-height: 1.65; }
        .hypothesis { align-self: end; border-top: 0.28rem solid var(--primary); padding-top: 1rem; }
        .hypothesis span { color: var(--primary); font: 700 0.58rem var(--font-mono); letter-spacing: 0.12em; text-transform: uppercase; }
        .hypothesis p { margin: 0.7rem 0 0; font-size: 0.82rem; line-height: 1.6; }
        .matrix-slice { border-bottom: 1px solid var(--border); }
        .stack-table { border-top: 1px solid var(--border); }
        .stack-row { --row-accent: var(--family-bsl); display: grid; grid-template-columns: minmax(8rem, 0.45fr) minmax(13rem, 0.75fr) minmax(16rem, 1.15fr) minmax(18rem, 1.35fr); border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--row-accent) 7%, var(--card)); }
        .stack-row > * { min-width: 0; padding: 1.25rem clamp(1rem, 2vw, 1.6rem); }
        .stack-row > * + * { border-left: 1px solid var(--border); }
        .tone-solution { --row-accent: var(--family-intelligence); }
        .tone-owned { --row-accent: var(--family-actions); }
        .tone-kit { --row-accent: var(--family-bsl); }
        .tone-record { --row-accent: var(--family-interfaces); }
        .tone-field { --row-accent: var(--family-properties); }
        .tone-component { --row-accent: var(--family-objects); }
        .tone-tool { --row-accent: var(--family-rules); }
        .stack-number { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.8rem; align-items: center; border-left: 0.5rem solid var(--row-accent); }
        .stack-number strong { color: var(--row-accent); font-family: var(--font-serif); font-size: 2rem; font-weight: 400; }
        .stack-number span { font: 600 0.58rem var(--font-mono); text-transform: uppercase; }
        .stack-title > span { color: var(--row-accent); font-size: 0.5rem; font-weight: 700; }
        .stack-title h3 { margin: 0.35rem 0 0; font-family: var(--font-serif); font-size: 1.15rem; font-weight: 500; }
        .stack-items { display: flex; flex-wrap: wrap; gap: 0.35rem; align-content: center; }
        .stack-items span { border: 1px solid var(--border); padding: 0.28rem 0.42rem; background: var(--card); font-size: 0.58rem; font-weight: 600; }
        .stack-proof { margin: 0; color: var(--muted-foreground); font-size: 0.72rem; line-height: 1.5; }
        .owned-section, .component-section, .metrics-section { background: var(--card); }
        .model-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .model-card { min-width: 0; padding: clamp(1.3rem, 3vw, 2.2rem); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .model-card > span { color: var(--family-actions); font-size: 0.53rem; font-weight: 700; }
        .model-card h3 { margin: 1rem 0 0.65rem; font-family: var(--font-serif); font-size: clamp(1.4rem, 2.2vw, 2rem); font-weight: 500; }
        .model-card > p { max-width: 46rem; margin: 0; color: var(--muted-foreground); line-height: 1.6; }
        .model-card dl { display: grid; gap: 0.8rem; margin: 1.3rem 0 0; }
        .model-card dl > div { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: 1rem; border-top: 1px solid var(--border); padding-top: 0.7rem; }
        .model-card dt { color: var(--muted-foreground); font: 600 0.53rem var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
        .model-card dd { margin: 0; font-size: 0.7rem; line-height: 1.5; }
        .reuse-section, .command-section, .run-section { border-top: 1px solid var(--border); }
        .reuse-table { border: 1px solid var(--border); }
        .reuse-head, .reuse-row { display: grid; grid-template-columns: 0.55fr 0.9fr 1.25fr 1.35fr; }
        .reuse-head { background: var(--foreground); color: var(--background); font-size: 0.52rem; }
        .reuse-head span, .reuse-row > * { min-width: 0; padding: 0.85rem 1rem; }
        .reuse-row + .reuse-row { border-top: 1px solid var(--border); }
        .reuse-row > * + * { border-left: 1px solid var(--border); }
        .reuse-row strong { color: var(--family-bsl); font-size: 0.72rem; }
        .reuse-row p { margin: 0; color: var(--muted-foreground); font-size: 0.67rem; line-height: 1.5; }
        .command-flow { display: grid; border-top: 1px solid var(--border); }
        .command-card { display: grid; grid-template-columns: 4.5rem minmax(14rem, 0.9fr) minmax(19rem, 1.1fr); border-bottom: 1px solid var(--border); background: var(--card); }
        .command-card > * { min-width: 0; padding: 1.2rem; }
        .command-card > * + * { border-left: 1px solid var(--border); }
        .command-index { display: grid; place-items: center; color: var(--family-actions); font-family: var(--font-serif); font-size: 1.7rem; }
        .command-name > span, .io span { color: var(--family-actions); font-size: 0.5rem; font-weight: 700; }
        .command-name h3 { margin: 0.3rem 0; font-family: var(--font-serif); font-size: 1.15rem; font-weight: 500; }
        .command-name p { margin: 0; color: var(--muted-foreground); font-size: 0.66rem; line-height: 1.45; }
        .io { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 1rem; align-items: center; }
        .io > div { display: grid; gap: 0.35rem; }
        .io strong { font-size: 0.66rem; line-height: 1.4; }
        .io b { color: var(--family-actions); font-size: 1.3rem; }
        .component-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .component-card { min-width: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 1rem; padding: 1.2rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .component-card > div { display: grid; gap: 0.3rem; }
        .component-card span { color: var(--family-objects); font-size: 0.5rem; font-weight: 700; }
        .component-card strong { font-family: var(--font-serif); font-size: 1.15rem; font-weight: 500; }
        .component-card p { margin: 0; font-size: 0.7rem; font-weight: 700; }
        .component-card small { color: var(--muted-foreground); font-size: 0.62rem; line-height: 1.5; }
        .no-rebuild-rule { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 1rem; margin-top: 1.5rem; border-top: 0.3rem solid var(--family-intelligence); padding-top: 1rem; }
        .no-rebuild-rule strong { color: var(--family-intelligence); font: 700 0.58rem var(--font-mono); letter-spacing: 0.1em; }
        .no-rebuild-rule p { max-width: 65rem; margin: 0; font-size: 0.72rem; line-height: 1.5; }
        .phase-list { display: grid; border-top: 1px solid var(--border); }
        .phase-row { display: grid; grid-template-columns: 3.5rem minmax(12rem, 0.8fr) minmax(14rem, 1fr) minmax(18rem, 1.3fr); align-items: center; border-bottom: 1px solid var(--border); }
        .phase-row > * { min-width: 0; padding: 0.9rem 1rem; }
        .phase-row > * + * { border-left: 1px solid var(--border); }
        .phase-row > strong { color: var(--primary); font-family: var(--font-serif); font-size: 1.3rem; font-weight: 400; text-align: center; }
        .phase-row div span { color: var(--primary); font: 600 0.5rem var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
        .phase-row h3 { margin: 0.25rem 0 0; font-family: var(--font-serif); font-size: 0.95rem; font-weight: 500; }
        .phase-row p { margin: 0; font-size: 0.68rem; font-weight: 600; line-height: 1.4; }
        .phase-row small { color: var(--muted-foreground); font-size: 0.61rem; line-height: 1.45; }
        .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 0.7rem; }
        .metric-card { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 0.8rem; border-top: 0.3rem solid var(--primary); padding: 1.2rem; background: var(--muted); }
        .metric-card > span { color: var(--primary); font-size: 0.52rem; font-weight: 700; }
        .metric-card > strong { font-family: var(--font-serif); font-size: 1.3rem; font-weight: 500; line-height: 1.15; }
        .metric-card p { margin: 0; color: var(--muted-foreground); font-size: 0.68rem; line-height: 1.5; }
        .metric-card small { border-top: 1px solid var(--border); padding-top: 0.7rem; font: 600 0.53rem var(--font-mono); line-height: 1.45; }
        .acceptance { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem); border-top: 1px solid var(--border); }
        .acceptance-main h2 { max-width: 19ch; }
        .acceptance-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 2.5rem; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .acceptance-grid > div { display: grid; gap: 0.7rem; min-height: 8rem; padding: 1.2rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .acceptance-grid span { color: var(--primary); font-size: 0.5rem; font-weight: 700; }
        .acceptance-grid strong { font-family: var(--font-serif); font-size: 0.9rem; font-weight: 500; line-height: 1.5; }
        .proposal-footer { display: flex; justify-content: space-between; gap: 2rem; padding: 1.3rem clamp(1rem, 3vw, 2.5rem); background: var(--foreground); color: var(--muted); font-size: 0.56rem; line-height: 1.5; }
        .proposal-footer strong { color: var(--primary); }
        @media (max-width: 70rem) {
          .stack-row { grid-template-columns: minmax(7rem, 0.35fr) minmax(12rem, 0.65fr) minmax(0, 1fr); }
          .stack-proof { grid-column: 2 / -1; border-left: 1px solid var(--border); border-top: 1px solid var(--border); }
          .reuse-head, .reuse-row { grid-template-columns: 0.55fr 0.9fr 1.2fr; }
          .reuse-head > :last-child, .reuse-row > :last-child { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); }
        }
        @media (max-width: 52rem) {
          .hero, .thesis, .section-head, .acceptance { grid-template-columns: 1fr; }
          .score-ribbon { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .score-ribbon > div:nth-child(4) { border-left: 0; border-top: 1px solid var(--border); }
          .score-ribbon > div:nth-child(5), .score-ribbon > div:nth-child(6) { border-top: 1px solid var(--border); }
          .model-grid, .acceptance-grid { grid-template-columns: 1fr; }
          .stack-row { grid-template-columns: 6rem minmax(0, 1fr); }
          .stack-items, .stack-proof { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); }
          .command-card { grid-template-columns: 3.5rem minmax(0, 1fr); }
          .io { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); }
          .phase-row { grid-template-columns: 3.5rem minmax(0, 1fr); }
          .phase-row > p, .phase-row > small { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); }
          .reuse-head { display: none; }
          .reuse-row { grid-template-columns: 1fr; }
          .reuse-row > * + * { border-left: 0; border-top: 1px solid var(--border); }
          .reuse-row > :last-child { grid-column: auto; }
        }
        @media (max-width: 34rem) {
          .score-ribbon { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .score-ribbon > div:nth-child(odd) { border-left: 0; }
          .score-ribbon > div:nth-child(n + 3) { border-top: 1px solid var(--border); }
          .io { grid-template-columns: 1fr; }
          .io b { transform: rotate(90deg); justify-self: start; }
          .proposal-footer, .no-rebuild-rule { grid-template-columns: 1fr; flex-direction: column; }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof FactoryRunProposal> { // ¹² Compact brief keeps the experiment legible in a document flow
    <template>
      <article class='embedded'>
        <span>{{@model.experimentLabel}} · Software factory experiment</span>
        <h2>{{@model.appName}}</h2>
        <p>{{@model.subhead}}</p>
        <div><strong>4</strong><small>owned models</small><strong>15+</strong><small>reused contracts</small><strong>5</strong><small>typed verbs</small><strong>≤6h</strong><small>target</small></div>
      </article>
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

  static fitted = class Fitted extends Component<typeof FactoryRunProposal> { // ¹³ Special CQ trial ticket presents scope and target without media
    <template>
      <article class='fit'>
        <div class='fit-header'><span>{{@model.experimentLabel}}</span><strong>06</strong></div>
        <div class='fit-body'><p>Software factory run</p><h2>{{@model.appName}}</h2><small>{{@model.subhead}}</small></div>
        <div class='fit-metrics'><span><strong>4</strong> owned</span><span><strong>15+</strong> reused</span><span><strong>5</strong> verbs</span></div>
        <div class='fit-footer'><span>Target</span><strong>≤ 6 hours</strong></div>
      </article>
      <style scoped>
        .fit { --type-ratio: 1.28; --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb)); --type-base: clamp(9px, calc(4px + 2cqi + 0.8cqb - 0.45 * var(--ar)), 18px); --label: max(7px, calc(var(--type-base) / pow(var(--type-ratio), 1.5))); --body: max(9px, calc(var(--type-base) / var(--type-ratio))); --title: max(12px, calc(var(--type-base) * pow(var(--type-ratio), 1.5))); width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto auto; gap: clamp(4px, 2cqi, 12px); padding: clamp(7px, 4cqi, 20px); overflow: hidden; background: var(--foreground); color: var(--background); font-family: var(--font-sans); }
        .fit-header, .fit-body, .fit-metrics, .fit-footer { min-width: 0; min-height: 0; overflow: hidden; }
        .fit-header { display: flex; justify-content: space-between; gap: 0.5rem; align-items: start; }
        .fit-header span { color: var(--primary); font: 700 var(--label) var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        .fit-header strong { color: var(--primary); font-family: var(--font-serif); font-size: var(--title); font-weight: 400; line-height: 0.8; }
        .fit-body { display: grid; align-content: center; gap: clamp(3px, 1cqb, 8px); }
        .fit-body p { margin: 0; color: var(--muted); font: 700 var(--label) var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        .fit-body h2 { display: -webkit-box; margin: 0; overflow: hidden; color: var(--background); font-family: var(--font-serif); font-size: var(--title); font-weight: 400; letter-spacing: -0.035em; line-height: 1; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
        .fit-body small { display: -webkit-box; margin: 0; overflow: hidden; color: var(--muted); font-family: var(--font-serif); font-size: var(--body); line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
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
