// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api'; // ¹ Standalone proposal document with no local module dependencies
import StringField from 'https://cardstack.com/base/string';
import CommonplaceIcon from '@cardstack/boxel-icons/notebook'; // ² CDN-verified 2026-07-21
import PublicationNav from './components/publication-nav'; // ¹⁷ Standalone publication navigation

interface Concept {
  symbol: string;
  name: string;
}

interface EditorialTruth {
  number: string;
  title: string;
  copy: string;
}

interface Persona {
  name: string;
  role: string;
  pastes: string;
  issue: string;
  value: string;
}

interface ReuseItem extends Concept {
  kind: string;
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
  label: string;
  title: string;
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

const EDITORIAL_TRUTHS: EditorialTruth[] = [ // ³ The article compressed into three durable product claims
  { number: '01', title: 'Saving becomes composition.', copy: 'Bookmarks preserve an object while abandoning the thought that made it interesting. Commonplace turns a pile of chosen fragments into a bounded issue with sequence, rhythm, and a point of view.' },
  { number: '02', title: 'The information diet gains digestion.', copy: 'Feeds optimize the next encounter. Commonplace separates save, recover, interpret, arrange, review, and publish—transforming consumption into a small act of authorship.' },
  { number: '03', title: 'The machine proposes. The person means.', copy: 'Classification is visible and editable. The system may notice a pattern, recover a source, or draft connective writing; the person decides whether the pattern belongs and what it says.' },
];

const PERSONAS: Persona[] = [ // ⁴ People judge the product through recognizable use, not implementation vocabulary
  { name: 'Lena', role: 'Set designer', pastes: 'Menus, chairs, neighborhood flyers, a library essay, and screenshots about personal websites.', issue: 'Small Audiences, Real Rooms', value: 'A month of visual and civic fragments becomes a private argument about why intimate public life is returning.' },
  { name: 'Dev', role: 'Home cook and new parent', pastes: 'Recipe fragments, family texts, grocery labels, feeding advice, and photographs of improvised dinners.', issue: 'What We Actually Ate', value: 'Conflicting advice is sourced and separated from lived notes; the issue becomes a useful family record rather than another recipe backlog.' },
  { name: 'Mika', role: 'Music fan and student', pastes: 'Lyrics, show posters, social posts, record sleeves, venue listings, and half-remembered interview quotes.', issue: 'Rooms That Changed the Song', value: 'Lost context is recovered, related material is clustered, and the final zine reads like a mixtape with an evidence trail.' },
];

const REUSE_ITEMS: ReuseItem[] = [ // ⁵ Exactly five inspected userland artifacts; Crawl Source is provider-backed, not a platform primitive
  { symbol: 'Pe', name: 'Person', kind: 'CARD', source: 'Common records', use: 'Collector, collaborator, cited creator, editor, and approving publisher.', proof: 'A live CardDef links unchanged and retains portable identity.' },
  { symbol: 'Fi', name: 'File / Image', kind: 'CARD', source: 'Base realm', use: 'Original screenshots, pasted images, captured pages, PDFs, and generated issue assets.', proof: 'Bytes remain realm files; no media is serialized into string fields.' },
  { symbol: 'Ta', name: 'Tag', kind: 'CARD', source: 'Common records', use: 'Human vocabulary that survives AI reclassification and travels across issues.', proof: 'Existing schema, editor, and formats work without a Commonplace wrapper.' },
  { symbol: 'No', name: 'Note', kind: 'CARD', source: 'Common records', use: 'The collector’s reason for saving, editorial annotations, corrections, and private context.', proof: 'Notes remain shared records rather than app-owned commentary.' },
  { symbol: 'Cr', name: 'Crawl Source', kind: 'COMMAND', source: 'Catalog command', use: 'Typed provider-neutral retrieval that records frozen parameters and the returned evidence in a Crawl Job.', proof: 'Input type, output type, live command, provider configuration, and one completed run all verify.' },
];

const BUILD_ITEMS: BuildItem[] = [ // ⁶ Five cards + two fields + three commands = ten authored or extended artifacts
  { number: '01', symbol: 'Sf', name: 'Saved Fragment', kind: 'CARD', purpose: 'Preserve one pasted artifact, its normalized projection, collector note, privacy, and links to every later source or interpretation.', dependsOn: 'File / Image · Note · Person · Artifact Kind', acceptance: 'The exact original remains recoverable after any enrichment, edit, clustering, or publication.' },
  { number: '02', symbol: 'Sr', name: 'Source Record', kind: 'CARD', purpose: 'Represent one recovered or researched source with canonical identity, excerpt, retrieval evidence, confidence, and relationship to a fragment.', dependsOn: 'Crawl Source · Provenance · File / Image', acceptance: 'A reviewer can distinguish pasted content, retrieved fact, and absent information without reading a command log.' },
  { number: '03', symbol: 'Tc', name: 'Theme Cluster', kind: 'CARD', purpose: 'Hold a proposed relationship among fragments, its rationale, counter-signals, label history, and human disposition.', dependsOn: 'Saved Fragment[] · Tag · Person', acceptance: 'The user can accept, rename, split, merge, or reject the machine’s proposed pattern.' },
  { number: '04', symbol: 'Zi', name: 'Zine Issue', kind: 'CARD', purpose: 'Own an edition’s thesis, audience, selected clusters, page sequence, publication state, contributors, and approval.', dependsOn: 'Theme Cluster[] · Person · Note', acceptance: 'The edition has a deliberate boundary and can be finished, shared, reopened, or revised as a new edition.' },
  { number: '05', symbol: 'Zp', name: 'Zine Page', kind: 'CARD', purpose: 'Compose fragments, citations, captions, connective writing, and layout direction into one portable editorial page.', dependsOn: 'Zine Issue · Saved Fragment[] · Source Record[]', acceptance: 'Web, carousel, and print render from the same approved content without losing attribution.' },
  { number: '06', symbol: 'Ak', name: 'Artifact Kind', kind: 'FIELD', purpose: 'Standardize text, rich text, image, screenshot, URL, table, code, location, product, event, and mixed clipboard material.', dependsOn: 'Existing enum and file primitives', acceptance: 'Normalization, preview choice, extraction, and editing use one canonical serialized contract.' },
  { number: '07', symbol: 'Pv', name: 'Provenance', kind: 'FIELD', purpose: 'Carry source, method, actor, timestamp, confidence, content hash, and the boundary between extraction and inference.', dependsOn: 'Existing URL, date-time, number, and identity primitives', acceptance: 'Every enriched field and consequential sentence can explain where it came from.' },
  { number: '08', symbol: 'Np', name: 'Normalize Paste', kind: 'COMMAND', purpose: 'Turn clipboard text, HTML, images, URLs, and mixed selections into a Saved Fragment while retaining the untouched input.', dependsOn: 'Saved Fragment · Artifact Kind · File / Image', acceptance: 'Repeated pastes deduplicate safely, failures preserve the input, and no external research is required for intake.' },
  { number: '09', symbol: 'Ef', name: 'Enrich Fragment', kind: 'COMMAND', purpose: 'Compose Crawl Source with structured extraction and AI interpretation to propose cited metadata, context, relationships, and classifications.', dependsOn: 'Saved Fragment · Crawl Source · Source Record[] · Provenance', acceptance: 'Mechanical results, external evidence, AI proposals, and human acceptance never collapse into one truth state.' },
  { number: '10', symbol: 'Cz', name: 'Compile Zine', kind: 'COMMAND', purpose: 'Generate an issue draft from approved fragments and clusters, then render governed web, carousel, and print-ready outputs.', dependsOn: 'Zine Issue · Zine Page[] · Theme Cluster[] · Person', acceptance: 'Only approved material publishes; each output preserves sources, privacy policy, sequence, and edition identity.' },
];

const FLOW: FlowStep[] = [ // ⁷ The information diet becomes a legible sequence of truth regimes
  { number: '01', regime: 'HUMAN · INTAKE', title: 'Paste without organizing', action: 'Accept anything the clipboard can carry. Preserve the original and the user’s optional reason for saving before interpretation begins.', input: 'Clipboard artifact + Note', output: 'Saved Fragment', gate: 'Intake remains useful even when every network and AI service is unavailable.' },
  { number: '02', regime: 'MECHANICAL · COMMAND', title: 'Normalize the fragment', action: 'Detect artifact kind, store image bytes, parse available HTML, extract visible text, recover explicit URLs, and compute a content hash.', input: 'Raw paste', output: 'Normalized Saved Fragment', gate: 'Normalization reports observation, not meaning.' },
  { number: '03', regime: 'SERVICE · COMMAND', title: 'Recover the context', action: 'Invoke the reusable Crawl Source command only when a URL exists or research is requested. Freeze parameters before execution and attach the Crawl Job result.', input: 'Fragment + crawl policy', output: 'Crawl Job + Source Record[]', gate: 'Provider response, time, cost, errors, and content hash stay inspectable.' },
  { number: '04', regime: 'AI · COMMAND', title: 'Propose what it means', action: 'Fill out missing metadata, classify material, suggest relationships, identify disagreements, and draft a cluster rationale from cited evidence.', input: 'Fragment + Source Record[]', output: 'Enrichment proposal + Theme Cluster[]', gate: 'Every proposal is review-required; absent evidence remains absent.' },
  { number: '05', regime: 'HUMAN · WORKFLOW', title: 'Make the issue', action: 'Accept or reject enrichment, rename and rearrange clusters, select a boundary, write or revise connective text, and mark private material.', input: 'Fragments + clusters + people', output: 'Approved Zine Issue + Zine Page[]', gate: 'The person owns meaning, sequence, privacy, and the final editorial claim.' },
  { number: '06', regime: 'POLICY · COMMAND', title: 'Publish a finished edition', action: 'Validate approvals and attribution, compile the designed outputs, capture a fixed edition, and retain its full source and decision lineage.', input: 'Approved issue', output: 'Web zine + carousel + PDF', gate: 'Unapproved, private, unsupported, or stale material fails closed with a visible reason.' },
];

const SURFACES: SurfaceProof[] = [ // ⁸ Five templates make the final product visually demonstrable without media processing
  { label: 'INBOX', title: 'Paste desk', visual: 'Mixed fragments · original shape · intake state', judgment: 'Can I save first without deciding where anything belongs?' },
  { label: 'SOURCE', title: 'Fragment dossier', visual: 'Original · recovered context · citations · confidence', judgment: 'Can I see what was pasted, retrieved, and inferred?' },
  { label: 'BOARD', title: 'Theme table', visual: 'Clusters · counter-signals · human labels · movement', judgment: 'Does the proposed pattern actually mean something to me?' },
  { label: 'ISSUE', title: 'Editorial sequence', visual: 'Pages · pacing · captions · privacy · approval', judgment: 'Have these saves become an intentional publication?' },
  { label: 'EDITION', title: 'Personal zine', visual: 'Responsive web · social carousel · printable PDF', judgment: 'Is the result attractive, finite, attributable, and worth sharing?' },
];

const ISSUE_PLAN: IssuePlan[] = [ // ⁹ Dependency-ordered packets can compile into the software-factory backlog
  { id: 'CP-00', title: 'Freeze the editorial trial', scope: 'Lock the article thesis, 5/10 budget, vocabulary, privacy rules, three personas, and three fixture collections.', dependsOn: 'None', done: 'The control estimate and cultural product test are approved before discovery.' },
  { id: 'CP-01', title: 'Verify five reuse artifacts', scope: 'Inspect and run Person, File/Image, Tag, Note, and the typed Crawl Source command including one real Crawl Job.', dependsOn: 'CP-00', done: 'Five live CodeRefs pass or the proposal is amended before authoring.' },
  { id: 'CP-02', title: 'Build the value contracts', scope: 'Implement ArtifactKind and Provenance with editors, formats, serialization fixtures, and focused tests.', dependsOn: 'CP-01', done: 'Both fields drive visible behavior and distinguish extraction from inference.' },
  { id: 'CP-03', title: 'Build intake and evidence cards', scope: 'Implement SavedFragment and SourceRecord with raw preservation, FileDefs, crawl lineage, privacy, and realistic mixed inputs.', dependsOn: 'CP-01 · CP-02', done: 'A bad screenshot can be preserved, recovered, researched, and audited.' },
  { id: 'CP-04', title: 'Build editorial cards', scope: 'Implement ThemeCluster, ZineIssue, and ZinePage with revision, selection, ordering, and publication views.', dependsOn: 'CP-03', done: 'A person can turn fragments into a bounded edition without hidden state.' },
  { id: 'CP-05', title: 'Build normalization and enrichment', scope: 'Implement NormalizePaste and EnrichFragment with typed I/O, reuse of Crawl Source, citations, budgets, and failure states.', dependsOn: 'CP-03', done: 'Local intake is cheap; optional enrichment is source-grounded and inspectable.' },
  { id: 'CP-06', title: 'Build compilation and workspace', scope: 'Implement CompileZine and compose the paste desk, dossier, cluster board, issue editor, and edition surfaces from verified components.', dependsOn: 'CP-04 · CP-05', done: 'The complete workflow is traversable and renders one issue in all three outputs.' },
  { id: 'CP-07', title: 'Run acceptance and report', scope: 'Execute the three scenarios and capture reuse, time, requests, tokens, lint, modules, tests, renders, defects, and rework.', dependsOn: 'CP-06', done: 'A live personal zine and an independently auditable factory report are delivered.' },
];

const SCENARIOS: Scenario[] = [ // ¹⁰ Success, uncertain retrieval, and privacy boundaries are all observable
  { label: 'The lost post', source: 'A cropped camera-roll screenshot contains a quote but no author, date, platform chrome, or visible URL.', result: 'The original survives; OCR and research find candidate sources; the user approves the correct one before it enters the issue.', proves: 'Mechanical extraction, Crawl Source reuse, uncertainty, citations, and human authority compose.' },
  { label: 'The mixed month', source: 'Twenty-four pastes combine menus, chairs, essays, posters, places, messages, and photographs with three personal notes.', result: 'AI proposes four clusters; the user rejects one, merges two, renames the last, and publishes a seven-page issue.', proves: 'The product finds patterns without replacing the person’s point of view.' },
  { label: 'The private fragment', source: 'A family message informs the issue’s introduction but must never appear in shared output or external research.', result: 'The fragment remains local and private; its idea may guide the human editor, but Compile Zine excludes its content and citation.', proves: 'Privacy and editorial policy outrank automation and aesthetic completeness.' },
];

const CRAWL_INPUTS = ['subject card', 'target URL', 'operation', 'prompt / schema', 'formats', 'depth / limit', 'cost policy']; // ¹¹ Typed provider contract assumed as reusable catalog infrastructure
const CRAWL_OUTPUTS = ['frozen parameters', 'status + timing', 'clean content', 'structured result', 'source metadata', 'linked files', 'usage + errors'];

const SYSTEM_ASSUMPTIONS = [ // ¹² Platform services stay unboxed and outside the artifact budget
  'Clipboard access and paste events',
  'Card identity, read, write, save, indexing, and search',
  'FileDef storage for every binary artifact',
  'SendRequestViaProxy transport and provider credentials',
  'Approved LLM access and structured output',
  'Host publication and print-capable browser rendering',
];

export class CommonplaceProposal extends CardDef { // ¹³ Article-led, implementation-ready factory proposal
  static displayName = 'Commonplace Factory Proposal';
  static icon = CommonplaceIcon;
  static prefersWideFormat = true;

  @field experimentLabel = contains(StringField);
  @field headline = contains(StringField);
  @field subhead = contains(StringField);
  @field appName = contains(StringField);
  @field issueTitle = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: CommonplaceProposal) {
      return this.cardInfo?.name?.trim()?.length
        ? this.cardInfo.name
        : (this.headline ?? `Untitled ${this.constructor.displayName}`);
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: CommonplaceProposal) {
      return this.cardInfo?.summary?.trim()?.length
        ? this.cardInfo.summary
        : this.subhead;
    },
  });

  static isolated = class Isolated extends Component<typeof CommonplaceProposal> { // ¹⁴ Independent magazine × paste-up desk
    editorialTruths = EDITORIAL_TRUTHS;
    personas = PERSONAS;
    reuseItems = REUSE_ITEMS;
    buildItems = BUILD_ITEMS;
    flow = FLOW;
    surfaces = SURFACES;
    issuePlan = ISSUE_PLAN;
    scenarios = SCENARIOS;
    crawlInputs = CRAWL_INPUTS;
    crawlOutputs = CRAWL_OUTPUTS;
    systemAssumptions = SYSTEM_ASSUMPTIONS;

    <template>
      <PublicationNav @active='commonplace' /> {{! ¹⁸ Host route, deliberately not viewCard }}
      <article class='proposal'>
        <div class='hero'>
          <div class='hero-copy'><p class='eyebrow'>{{@model.experimentLabel}} · Factory Trial 04</p><h1>{{@model.headline}}</h1><p class='dek'>{{@model.subhead}}</p><div class='byline'><span>PRODUCT PROPOSAL</span><strong>Commonplace</strong><small>Paste anything. Discover the issue hiding inside it.</small></div></div>
          <div class='pasteboard' aria-label='Example Commonplace paste desk'>
            <div class='board-label'><span>PASTE DESK / 27 SAVES</span><strong>ISSUE 01</strong></div>
            <article class='scrap scrap-quote'><span>TEXT · RECOVERED</span><p>“Maybe the opposite of going viral is knowing who the room is for.”</p><small>source attached · confidence 0.98</small></article>
            <article class='scrap scrap-menu'><span>IMAGE · OCR</span><strong>SUPPER / 7 PM</strong><p>beans · bitter leaves · warm bread</p><small>camera roll · 14 Jun</small></article>
            <article class='scrap scrap-post'><span>POST · RESEARCHED</span><p>Personal websites are becoming rooms again, not résumés.</p><small>original found · author verified</small></article>
            <article class='scrap scrap-note'><span>MY NOTE</span><p>small audiences<br />real rooms</p><small>keep private</small></article>
            <div class='issue-slip'><span>EMERGING ISSUE</span><h2>{{@model.issueTitle}}</h2><p>11 fragments · 3 sources · 1 private note</p></div>
          </div>
        </div>

        <section class='score-ribbon' aria-label='Commonplace build budget'><div><strong>∞</strong><span>pasteable inputs</span></div><div><strong>5</strong><span>reused artifacts</span></div><div><strong>5</strong><span>new cards</span></div><div><strong>2</strong><span>new fields</span></div><div><strong>3</strong><span>new commands</span></div><div><strong>3</strong><span>finished formats</span></div></section>

        <section class='story section-pad'>
          <div class='section-label'><span>00</span><p>The product story</p></div>
          <div class='story-lead'><p class='kicker'>AFTER THE AGE OF SAVING</p><h2>The things you keep are trying to tell you something.</h2><p>Today’s internet is remarkably good at helping us encounter things and remarkably bad at helping us understand why we kept them. A bookmark answers where. A feed answers what next. Commonplace asks what pattern is forming in the things you chose to save.</p><blockquote>It gives the reader somewhere to go when they are done being recommended to.</blockquote></div>
          <div class='truth-list'>{{#each this.editorialTruths as |truth|}}<article><span>{{truth.number}}</span><div><h3>{{truth.title}}</h3><p>{{truth.copy}}</p></div></article>{{/each}}</div>
        </section>

        <section class='people section-pad'>
          <div class='section-head'><div class='section-label'><span>01</span><p>How people use it</p></div><div><h2>Not a smarter backlog. A practice of making meaning.</h2><p>Each example begins with ordinary saving behavior and ends with a finite editorial object. The product must remain valuable to someone who never publishes publicly.</p></div></div>
          <div class='persona-list'>{{#each this.personas as |person|}}<article><div class='person-id'><strong>{{person.name}}</strong><span>{{person.role}}</span></div><div><span>PASTES</span><p>{{person.pastes}}</p></div><div><span>MAKES</span><h3>{{person.issue}}</h3></div><div><span>WHY IT MATTERS</span><p>{{person.value}}</p></div></article>{{/each}}</div>
        </section>

        <section class='surfaces section-pad'>
          <div class='section-head'><div class='section-label'><span>02</span><p>Visual proof</p></div><div><h2>From fragment to finished edition.</h2><p>The demo earns visual range through real content templates rather than expensive media generation or video processing.</p></div></div>
          <div class='surface-strip'>{{#each this.surfaces as |surface|}}<article><span>{{surface.label}}</span><div><strong>{{surface.title}}</strong><small>{{surface.visual}}</small></div><p>{{surface.judgment}}</p></article>{{/each}}</div>
        </section>

        <section class='budget section-pad'>
          <div class='section-head'><div class='section-label'><span>03</span><p>Artifact budget</p></div><div><h2>Five verified. Ten authored.</h2><p>Only concrete userland CardDefs, FieldDefs, and Commands become element tiles. Platform CRUD, search, proxy transport, and hosting remain uncounted system capabilities.</p></div></div>
          <div class='budget-row reuse'><div class='budget-label'><span>REUSE · 05</span><h3>Real modules or they do not count.</h3></div><div class='elements'>{{#each this.reuseItems as |item|}}<article><div><strong>{{item.symbol}}</strong><span>{{item.kind}}</span></div><h3>{{item.name}}</h3><p>{{item.use}}</p><small>{{item.source}} · {{item.proof}}</small></article>{{/each}}</div></div>
          <div class='budget-row build'><div class='budget-label'><span>BUILD / EXTEND · 10</span><h3>The complete app-owned budget.</h3></div><div class='elements'>{{#each this.buildItems as |item|}}<article><div><strong>{{item.symbol}}</strong><span>{{item.kind}} · {{item.number}}</span></div><h3>{{item.name}}</h3><p>{{item.purpose}}</p><small>Depends on {{item.dependsOn}}</small></article>{{/each}}</div></div>
          <div class='assumptions'><strong>UNBOXED · UNCOUNTED SYSTEM ASSUMPTIONS</strong><p>{{#each this.systemAssumptions as |item index|}}{{#if index}} · {{/if}}{{item}}{{/each}}</p></div>
        </section>

        <section class='workflow section-pad'>
          <div class='section-head'><div class='section-label'><span>04</span><p>Information digestion</p></div><div><h2>Save. Recover. Interpret. Arrange. Finish.</h2><p>The workflow keeps original artifact, mechanical observation, external evidence, AI interpretation, human meaning, and publication policy visibly distinct.</p></div></div>
          <div class='flow-list'>{{#each this.flow as |step|}}<article><strong>{{step.number}}</strong><div class='flow-name'><span>{{step.regime}}</span><h3>{{step.title}}</h3></div><p>{{step.action}}</p><div class='io'><span>IN</span><b>{{step.input}}</b><span>OUT</span><b>{{step.output}}</b></div><small>{{step.gate}}</small></article>{{/each}}</div>
        </section>

        <section class='crawl section-pad'>
          <div class='section-head'><div class='section-label'><span>05</span><p>Provider-backed command</p></div><div><h2>Crawling is a typed catalog capability.</h2><p>Like image generation over OpenRouter, Crawl Source is not an official domain command baked into Boxel. It is a reusable userland command built over authenticated proxy transport with stable input and output CardDefs.</p></div></div>
          <div class='command-contract'><div class='command-box'><span>CATALOG COMMAND</span><strong>Cr</strong><h3>Crawl Source</h3><p>Provider-neutral retrieval with a durable run record.</p></div><div class='contract-arrow'><span>USES</span><strong>→</strong><p>SendRequestViaProxy<br />Firecrawl today<br />another provider later</p></div><div class='typed-side'><span>TYPED INPUT</span>{{#each this.crawlInputs as |item|}}<b>{{item}}</b>{{/each}}</div><div class='typed-side'><span>TYPED OUTPUT</span>{{#each this.crawlOutputs as |item|}}<b>{{item}}</b>{{/each}}</div></div>
          <div class='truth-chain'><div><span>01</span><strong>ORIGINAL</strong><p>What the person pasted.</p></div><div><span>02</span><strong>OBSERVATION</strong><p>What normalization extracted.</p></div><div><span>03</span><strong>EVIDENCE</strong><p>What Crawl Source returned.</p></div><div><span>04</span><strong>PROPOSAL</strong><p>What AI inferred.</p></div><div><span>05</span><strong>MEANING</strong><p>What the person approved.</p></div></div>
        </section>

        <section class='requirements section-pad'>
          <div class='section-head'><div class='section-label'><span>06</span><p>Requirements</p></div><div><h2>Ten artifacts. Ten finish lines.</h2><p>The factory may reorganize implementation, but it may not erase an acceptance obligation or merge truth regimes for convenience.</p></div></div>
          <div class='requirement-list'>{{#each this.buildItems as |item|}}<article><div class='req-id'><span>REQ-CP-0{{item.number}}</span><strong>{{item.kind}}</strong></div><div><h3>{{item.name}}</h3><p>{{item.purpose}}</p></div><div><span>DEPENDENCIES</span><p>{{item.dependsOn}}</p></div><div><span>ACCEPTANCE</span><p>{{item.acceptance}}</p></div></article>{{/each}}</div>
        </section>

        <section class='discovery section-pad'>
          <div class='section-head'><div class='section-label'><span>07</span><p>Search-first gate</p></div><div><h2>Prove the reusable layer before authoring.</h2><p>For each candidate: search by intent and type → inspect schema → load module → preview formats → run or link it with fixture data → record REUSE, EXTEND, or BUILD.</p></div></div>
          <div class='manifest'><span>CRAWL SOURCE PROOF</span><strong>Live command · input CodeRef · output CodeRef · provider configuration · frozen parameters · completed Crawl Job · result files · failure behavior · cost receipt</strong></div>
          <div class='stop-line'><strong>STOP THE RUN</strong><p>If the typed Crawl Source command cannot complete one fixture run, amend the reuse budget before building Enrich Fragment. A generic HTTP tool alone is not the promised reusable command.</p></div>
        </section>

        <section class='issues section-pad'>
          <div class='section-head'><div class='section-label'><span>08</span><p>Issue compiler</p></div><div><h2>Eight dependency-ordered work packets.</h2><p>Each row is already shaped for an agentic build: bounded scope, explicit prerequisites, and a testable done condition.</p></div></div>
          <div class='issue-list'>{{#each this.issuePlan as |issue|}}<article><strong>{{issue.id}}</strong><div><h3>{{issue.title}}</h3><p>{{issue.scope}}</p></div><div><span>DEPENDS</span><p>{{issue.dependsOn}}</p></div><div><span>DONE</span><p>{{issue.done}}</p></div></article>{{/each}}</div>
          <div class='packet'><span>AGENT HANDOFF PACKET</span><div><strong>Product article</strong><strong>Wiki brief</strong><strong>10 requirements</strong><strong>Reuse manifest</strong><strong>Build skill</strong><strong>8 issues</strong><strong>Fixture pack</strong><strong>Run report</strong></div><p>Generate these artifacts from the approved proposal before starting CP-02. CP-01 is discovery, not implementation.</p></div>
        </section>

        <section class='acceptance section-pad'>
          <div class='section-label'><span>09</span><p>Acceptance edition</p></div>
          <div class='acceptance-main'><h2>The result should feel authored, not summarized.</h2><div class='scenario-grid'>{{#each this.scenarios as |scenario|}}<article><span>{{scenario.label}}</span><p>{{scenario.source}}</p><strong>{{scenario.result}}</strong><small>{{scenario.proves}}</small></article>{{/each}}</div><div class='pass-grid'><div><span>REUSE</span><strong>Five live userland artifacts by module reference, including one completed Crawl Source run.</strong></div><div><span>BUILD</span><strong>Exactly five cards, two fields, and three app commands.</strong></div><div><span>TRUTH</span><strong>Original, observation, evidence, proposal, and approved meaning remain distinct.</strong></div><div><span>ECONOMY</span><strong>Local intake is free of external calls; research obeys explicit request and cost budgets.</strong></div><div><span>QUALITY</span><strong>Lint, modules, tests, fixtures, renders, privacy, and all three scenarios pass.</strong></div><div><span>FINAL PRODUCT</span><strong>One seven-page issue renders as an attractive web zine, carousel, and printable PDF.</strong></div></div></div>
        </section>

        <div class='proposal-footer'><strong>Factory Trial 04 · Commonplace</strong><span>Paste anything. Discover the issue hiding inside it.</span><b>ISSUE 01</b></div>
      </article>

      <style scoped>
        .proposal { min-width: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
        .hero { display: grid; grid-template-columns: minmax(0, 0.92fr) minmax(31rem, 1.08fr); gap: clamp(2rem, 5vw, 6rem); min-height: 47rem; padding: clamp(2.5rem, 6vw, 6rem); background: var(--common-ink); color: var(--common-paper); overflow: hidden; }
        .hero-copy { min-width: 0; align-self: center; }
        .eyebrow, .section-label p, .board-label, .scrap span, .scrap small, .issue-slip span, .byline, .budget-label > span, .elements article > div span, .flow-name span, .io span, .req-id span, .requirement-list article > div > span, .issue-list span, .surface-strip > article > span, .scenario-grid span, .pass-grid span, .command-contract span, .truth-chain span, .proposal-footer { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.11em; }
        .eyebrow { margin: 0 0 1.5rem; color: var(--primary); font-size: 0.66rem; font-weight: 700; }
        .hero h1 { max-width: 8ch; margin: 0; font-family: var(--font-serif); font-size: clamp(4.8rem, 9vw, 9.6rem); font-weight: 400; letter-spacing: -0.075em; line-height: 0.8; }
        .dek { max-width: 38rem; margin: 2rem 0 0; color: var(--common-paper-soft); font-family: var(--font-serif); font-size: clamp(1.05rem, 1.5vw, 1.35rem); line-height: 1.55; }
        .byline { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.8rem; margin-top: 3rem; border-top: 1px solid var(--common-rule-dark); padding-top: 1rem; font-size: 0.52rem; }
        .byline span { color: var(--primary); } .byline strong { color: var(--common-paper); } .byline small { grid-column: 2; color: var(--common-paper-soft); font: 400 0.72rem/1.4 var(--font-serif); text-transform: none; letter-spacing: 0; }
        .pasteboard { position: relative; align-self: center; min-width: 0; min-height: 38rem; border: 1px solid var(--common-rule-dark); background: var(--common-board); }
        .board-label { position: absolute; inset: 0 0 auto; z-index: 5; display: flex; justify-content: space-between; padding: 0.8rem 1rem; color: var(--common-paper-soft); font-size: 0.5rem; }
        .board-label strong { color: var(--primary); }
        .scrap { position: absolute; display: grid; gap: 0.6rem; border: 1px solid var(--common-ink); padding: 1rem; background: var(--common-sheet); color: var(--common-ink); box-shadow: 0.45rem 0.45rem 0 var(--common-shadow); }
        .scrap span { color: var(--primary); font-size: 0.45rem; font-weight: 700; }
        .scrap p, .scrap strong { margin: 0; font-family: var(--font-serif); }
        .scrap small { border-top: 1px solid var(--border); padding-top: 0.5rem; color: var(--muted-foreground); font-size: 0.4rem; }
        .scrap-quote { top: 4.2rem; left: 6%; width: 48%; transform: rotate(-2deg); } .scrap-quote p { font-size: 1.45rem; line-height: 1.12; }
        .scrap-menu { top: 5.4rem; right: 5%; width: 34%; transform: rotate(2.5deg); background: var(--common-paper); } .scrap-menu strong { font-size: 1.35rem; }
        .scrap-post { top: 18.5rem; left: 13%; width: 45%; transform: rotate(1deg); } .scrap-post p { font-size: 1.08rem; line-height: 1.25; }
        .scrap-note { top: 20rem; right: 6%; width: 29%; transform: rotate(-3.5deg); background: var(--primary); color: var(--primary-foreground); } .scrap-note span, .scrap-note small { color: var(--primary-foreground); } .scrap-note small { border-color: var(--primary-foreground); } .scrap-note p { font-size: 1.25rem; font-style: italic; }
        .issue-slip { position: absolute; z-index: 4; right: 10%; bottom: 2rem; width: 69%; border-left: 0.45rem solid var(--primary); padding: 1.1rem 1.2rem; background: var(--common-ink); color: var(--common-paper); }
        .issue-slip span { color: var(--primary); font-size: 0.46rem; font-weight: 700; } .issue-slip h2 { margin: 0.35rem 0 0; font: 400 2rem/1 var(--font-serif); letter-spacing: -0.04em; } .issue-slip p { margin: 0.5rem 0 0; color: var(--common-paper-soft); font-size: 0.62rem; }
        .score-ribbon { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border-bottom: 1px solid var(--border); background: var(--card); }
        .score-ribbon > div { display: grid; gap: 0.2rem; padding: 1rem clamp(0.7rem, 1.8vw, 1.4rem); } .score-ribbon > div + div { border-left: 1px solid var(--border); }
        .score-ribbon strong { color: var(--primary); font: 400 clamp(1.6rem, 2.7vw, 2.5rem) var(--font-serif); } .score-ribbon span { color: var(--muted-foreground); font: 600 0.52rem var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
        .section-pad { padding: clamp(2.5rem, 5vw, 5rem); }
        .section-label { display: grid; align-content: start; gap: 0.55rem; } .section-label > span { color: var(--primary); font: 400 2.7rem/0.8 var(--font-serif); } .section-label p { margin: 0; color: var(--muted-foreground); font-size: 0.54rem; font-weight: 700; }
        .section-head { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem); margin-bottom: clamp(2rem, 4vw, 3.5rem); }
        .section-head h2, .story h2, .acceptance h2 { max-width: 19ch; margin: 0; font: 400 clamp(2.3rem, 4.8vw, 5rem)/0.94 var(--font-serif); letter-spacing: -0.055em; }
        .section-head > div > p { max-width: 54rem; margin: 1rem 0 0; color: var(--muted-foreground); line-height: 1.58; }
        .story { display: grid; grid-template-columns: minmax(8rem, 0.25fr) minmax(20rem, 0.8fr) minmax(24rem, 1fr); gap: clamp(2rem, 5vw, 6rem); border-bottom: 1px solid var(--border); background: var(--card); }
        .kicker { margin: 0 0 1rem; color: var(--primary); font: 700 0.56rem var(--font-mono); letter-spacing: 0.12em; }
        .story-lead > p:not(.kicker) { max-width: 43rem; color: var(--muted-foreground); font: 400 1.04rem/1.65 var(--font-serif); }
        blockquote { margin: 2rem 0 0; border-top: 1px solid var(--foreground); border-bottom: 1px solid var(--foreground); padding: 1.2rem 0; font: italic 400 clamp(1.35rem, 2.2vw, 2rem)/1.2 var(--font-serif); }
        .truth-list { display: grid; border-top: 1px solid var(--border); } .truth-list article { display: grid; grid-template-columns: 2.6rem minmax(0, 1fr); gap: 1rem; padding: 1rem 0; border-bottom: 1px solid var(--border); }
        .truth-list article > span { color: var(--primary); font: 400 1.2rem var(--font-serif); } .truth-list h3 { margin: 0; font: 500 1rem var(--font-serif); } .truth-list p { margin: 0.45rem 0 0; color: var(--muted-foreground); font-size: 0.68rem; line-height: 1.55; }
        .people, .requirements, .issues { background: var(--card); }
        .persona-list, .flow-list, .requirement-list, .issue-list { display: grid; border-top: 1px solid var(--border); }
        .persona-list article { display: grid; grid-template-columns: minmax(9rem, 0.42fr) minmax(16rem, 1fr) minmax(12rem, 0.62fr) minmax(18rem, 1.1fr); border-bottom: 1px solid var(--border); }
        .persona-list article > *, .flow-list article > *, .requirement-list article > *, .issue-list article > * { min-width: 0; padding: 0.9rem 1rem; } .persona-list article > * + *, .flow-list article > * + *, .requirement-list article > * + *, .issue-list article > * + * { border-left: 1px solid var(--border); }
        .person-id { display: grid; align-content: start; gap: 0.25rem; } .person-id strong { color: var(--primary); font: 400 1.35rem var(--font-serif); } .persona-list span { color: var(--primary); font: 700 0.46rem var(--font-mono); letter-spacing: 0.09em; }
        .persona-list p { margin: 0.4rem 0 0; color: var(--muted-foreground); font-size: 0.65rem; line-height: 1.5; } .persona-list h3 { margin: 0.4rem 0 0; font: 500 1rem/1.3 var(--font-serif); }
        .surface-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .surface-strip article { min-width: 0; display: grid; grid-template-rows: auto minmax(10rem, 1fr) auto; gap: 0.8rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .surface-strip > article > span { color: var(--primary); font-size: 0.5rem; font-weight: 700; } .surface-strip article > div { display: grid; align-content: end; gap: 0.35rem; padding: 0.8rem; background: var(--common-ink); color: var(--common-paper); }
        .surface-strip strong { font: 400 1rem var(--font-serif); } .surface-strip small { color: var(--common-paper-soft); font: 500 0.48rem/1.4 var(--font-mono); text-transform: uppercase; } .surface-strip p { margin: 0; color: var(--muted-foreground); font-size: 0.62rem; line-height: 1.48; }
        .budget-row { display: grid; grid-template-columns: minmax(11rem, 0.25fr) minmax(0, 1fr); border-top: 1px solid var(--border); } .budget-row + .budget-row { margin-top: 2rem; }
        .budget-label { padding: 1.1rem 1.3rem 1.1rem 0; } .budget-label > span { color: var(--primary); font-size: 0.5rem; font-weight: 700; } .budget-label h3 { margin: 0.7rem 0 0; font: 400 1.35rem/1.1 var(--font-serif); }
        .elements { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-left: 1px solid var(--border); }
        .elements article { min-width: 0; min-height: 14rem; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 0.75rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--card); }
        .build .elements article { background: var(--common-blue-wash); } .elements article > div { display: flex; justify-content: space-between; gap: 0.5rem; align-items: start; } .elements article > div strong { font: 400 2.15rem/1 var(--font-serif); letter-spacing: -0.05em; } .build .elements article > div strong { color: var(--primary); }
        .elements article > div span { color: var(--muted-foreground); font-size: 0.4rem; font-weight: 700; text-align: right; } .elements h3 { margin: 0; font: 500 0.95rem var(--font-serif); } .elements p { margin: 0; font-size: 0.62rem; line-height: 1.48; } .elements small { border-top: 1px solid var(--border); padding-top: 0.55rem; color: var(--muted-foreground); font-size: 0.51rem; line-height: 1.42; }
        .assumptions { margin-top: 2rem; border-top: 1px solid var(--border); padding-top: 1rem; } .assumptions strong, .stop-line strong { color: var(--primary); font: 700 0.56rem var(--font-mono); letter-spacing: 0.12em; } .assumptions p, .stop-line p { margin: 0.7rem 0 0; font-size: 0.72rem; line-height: 1.6; }
        .workflow, .crawl, .discovery, .acceptance { border-top: 1px solid var(--border); }
        .flow-list article { display: grid; grid-template-columns: 3.4rem minmax(12rem, 0.72fr) minmax(18rem, 1.18fr) minmax(12rem, 0.72fr) minmax(14rem, 0.86fr); border-bottom: 1px solid var(--border); }
        .flow-list article > strong { color: var(--primary); font: 400 1.5rem var(--font-serif); text-align: center; } .flow-name span, .io span { color: var(--primary); font-size: 0.46rem; font-weight: 700; } .flow-name h3, .requirement-list h3, .issue-list h3 { margin: 0.35rem 0 0; font: 500 0.95rem var(--font-serif); }
        .flow-list article > p, .requirement-list p, .issue-list p { margin: 0; color: var(--muted-foreground); font-size: 0.62rem; line-height: 1.48; } .io { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.3rem 0.55rem; align-content: center; } .io b { font-size: 0.58rem; line-height: 1.4; } .flow-list article > small { color: var(--muted-foreground); font: 600 0.51rem/1.44 var(--font-mono); }
        .crawl { background: var(--common-ink); color: var(--common-paper); } .crawl .section-head > div > p, .crawl .section-label p { color: var(--common-paper-soft); }
        .command-contract { display: grid; grid-template-columns: 0.78fr 0.6fr 1fr 1fr; border-top: 1px solid var(--common-rule-dark); border-left: 1px solid var(--common-rule-dark); }
        .command-contract > div { min-width: 0; padding: 1.2rem; border-right: 1px solid var(--common-rule-dark); border-bottom: 1px solid var(--common-rule-dark); } .command-contract span { color: var(--primary); font-size: 0.48rem; font-weight: 700; }
        .command-box strong { display: block; margin-top: 1rem; color: var(--primary); font: 400 4rem/0.8 var(--font-serif); } .command-box h3 { margin: 0.7rem 0 0; font: 400 1.35rem var(--font-serif); } .command-box p, .contract-arrow p { color: var(--common-paper-soft); font-size: 0.65rem; line-height: 1.5; }
        .contract-arrow strong { display: block; margin-top: 1rem; color: var(--primary); font: 400 3rem var(--font-serif); } .typed-side { display: grid; align-content: start; gap: 0.45rem; } .typed-side b { border-top: 1px solid var(--common-rule-dark); padding-top: 0.45rem; color: var(--common-paper-soft); font: 500 0.58rem var(--font-mono); }
        .truth-chain { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin-top: 2rem; border-top: 1px solid var(--common-rule-dark); border-left: 1px solid var(--common-rule-dark); } .truth-chain > div { min-width: 0; padding: 1rem; border-right: 1px solid var(--common-rule-dark); border-bottom: 1px solid var(--common-rule-dark); } .truth-chain span { color: var(--primary); font-size: 0.46rem; } .truth-chain strong { display: block; margin-top: 1.2rem; font: 500 0.7rem var(--font-mono); } .truth-chain p { margin: 0.4rem 0 0; color: var(--common-paper-soft); font-size: 0.58rem; }
        .requirement-list article, .issue-list article { display: grid; grid-template-columns: minmax(6rem, 0.3fr) minmax(14rem, 0.9fr) minmax(11rem, 0.62fr) minmax(17rem, 1fr); border-bottom: 1px solid var(--border); }
        .req-id { display: grid; align-content: start; gap: 0.35rem; } .req-id span, .requirement-list article > div > span, .issue-list span { color: var(--primary); font: 700 0.45rem var(--font-mono); letter-spacing: 0.09em; } .req-id strong { font: 400 0.95rem var(--font-serif); } .requirement-list p, .issue-list p { margin-top: 0.32rem; }
        .discovery { background: var(--common-blue-wash); } .manifest { display: grid; grid-template-columns: 11rem minmax(0, 1fr); gap: 1rem; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 1.2rem 0; } .manifest span { color: var(--primary); font: 700 0.5rem var(--font-mono); letter-spacing: 0.1em; } .manifest strong { font: 500 0.72rem/1.55 var(--font-mono); } .stop-line { margin-top: 2rem; border-top: 1px solid var(--foreground); padding-top: 1rem; }
        .issue-list article > strong { color: var(--primary); font: 400 1.15rem var(--font-serif); } .packet { display: grid; grid-template-columns: 11rem minmax(0, 1fr); gap: 1rem 2rem; margin-top: 2rem; border-top: 1px solid var(--foreground); padding-top: 1rem; } .packet > span { color: var(--primary); font: 700 0.5rem var(--font-mono); letter-spacing: 0.1em; } .packet > div { display: flex; flex-wrap: wrap; gap: 0.35rem; } .packet > div strong { border: 1px solid var(--border); padding: 0.4rem 0.55rem; font-size: 0.58rem; } .packet p { grid-column: 2; margin: 0; color: var(--muted-foreground); font-size: 0.65rem; }
        .acceptance { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem); }
        .scenario-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 2.5rem; border-top: 1px solid var(--border); border-left: 1px solid var(--border); } .scenario-grid article { min-width: 0; min-height: 15rem; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 0.75rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .scenario-grid span, .pass-grid span { color: var(--primary); font-size: 0.48rem; font-weight: 700; } .scenario-grid p { margin: 0; color: var(--muted-foreground); font-size: 0.65rem; line-height: 1.5; } .scenario-grid strong { font: 500 0.86rem/1.45 var(--font-serif); } .scenario-grid small { border-top: 1px solid var(--border); padding-top: 0.55rem; color: var(--muted-foreground); font-size: 0.54rem; line-height: 1.42; }
        .pass-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 2rem; border-top: 1px solid var(--border); border-left: 1px solid var(--border); } .pass-grid > div { display: grid; gap: 0.7rem; min-height: 7rem; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); } .pass-grid strong { font: 500 0.82rem/1.5 var(--font-serif); }
        .proposal-footer { display: grid; grid-template-columns: 1fr auto auto; gap: 2rem; padding: 1.2rem clamp(1rem, 3vw, 2.5rem); background: var(--common-ink); color: var(--common-paper-soft); font-size: 0.54rem; } .proposal-footer strong, .proposal-footer b { color: var(--primary); }
        @media (max-width: 74rem) { .hero { grid-template-columns: 1fr; } .story { grid-template-columns: minmax(8rem, 0.25fr) minmax(0, 1fr); } .truth-list { grid-column: 2; } .elements, .surface-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); } .flow-list article { grid-template-columns: 3.4rem minmax(12rem, 0.65fr) minmax(0, 1fr); } .flow-list .io, .flow-list article > small { grid-column: 2 / -1; border-top: 1px solid var(--border); } .command-contract { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 56rem) { .story, .section-head, .acceptance, .budget-row { grid-template-columns: 1fr; } .truth-list { grid-column: 1; } .score-ribbon, .elements, .surface-strip, .scenario-grid, .truth-chain { grid-template-columns: repeat(2, minmax(0, 1fr)); } .budget-label { padding-right: 0; } .persona-list article, .requirement-list article, .issue-list article { grid-template-columns: 7rem minmax(0, 1fr); } .persona-list article > :nth-child(n + 3), .requirement-list article > :nth-child(n + 3), .issue-list article > :nth-child(n + 3) { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } }
        @media (max-width: 39rem) { .hero { min-height: auto; } .pasteboard { min-height: 35rem; } .score-ribbon, .elements, .surface-strip, .scenario-grid, .pass-grid, .truth-chain, .command-contract { grid-template-columns: 1fr; } .score-ribbon > div + div { border-left: 0; border-top: 1px solid var(--border); } .scrap-quote { width: 69%; } .scrap-menu { top: 12.5rem; width: 47%; } .scrap-post { top: 22rem; left: 4%; width: 60%; } .scrap-note { top: 24rem; width: 34%; } .issue-slip { width: 82%; } .flow-list article { grid-template-columns: 3.4rem minmax(0, 1fr); } .flow-list article > p, .flow-list .io, .flow-list article > small { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } .manifest, .packet { grid-template-columns: 1fr; } .packet p { grid-column: 1; } .proposal-footer { grid-template-columns: 1fr; } }
        @page { size: A4 landscape; margin: 9mm; } /* ¹⁹ Commonplace prints as a landscape editorial edition */
        @media print { /* ²⁰ Print owns pagination and must not inherit narrow-screen collapse */
          .proposal { width: 100%; min-width: 0; overflow: visible; font-size: 8.2pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .proposal, .proposal * { box-sizing: border-box; }
          .hero { height: 163mm; min-height: 0; grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr); gap: 9mm; padding: 10mm; overflow: hidden; break-inside: avoid; }
          .hero-copy { align-self: center; }
          .eyebrow { margin-bottom: 4mm; font-size: 5pt; }
          .hero h1 { max-width: 9ch; font-size: 18mm; line-height: 0.81; letter-spacing: -0.065em; }
          .dek { max-width: 85mm; margin-top: 5mm; font-size: 8.7pt; line-height: 1.42; }
          .byline { gap: 1mm 3mm; margin-top: 6mm; padding-top: 3mm; font-size: 4.4pt; }
          .byline small { font-size: 5.8pt; }
          .pasteboard { min-height: 0; height: 143mm; }
          .board-label { padding: 3mm; font-size: 4.3pt; }
          .scrap { gap: 2mm; padding: 3mm; box-shadow: 2mm 2mm 0 var(--common-shadow); }
          .scrap span { font-size: 3.8pt; }
          .scrap small { padding-top: 1.5mm; font-size: 3.5pt; }
          .scrap-quote { top: 16mm; } .scrap-quote p { font-size: 10.5pt; }
          .scrap-menu { top: 20mm; } .scrap-menu strong { font-size: 10pt; }
          .scrap-post { top: 66mm; } .scrap-post p { font-size: 8pt; }
          .scrap-note { top: 71mm; } .scrap-note p { font-size: 9pt; }
          .issue-slip { bottom: 8mm; border-left-width: 2mm; padding: 3mm 4mm; }
          .issue-slip span { font-size: 3.8pt; } .issue-slip h2 { margin-top: 1.5mm; font-size: 15pt; } .issue-slip p { margin-top: 1.5mm; font-size: 5.2pt; }
          .score-ribbon { height: 20mm; grid-template-columns: repeat(6, minmax(0, 1fr)); break-after: page; }
          .score-ribbon > div { gap: 0.5mm; align-content: center; padding: 2mm 4mm; }
          .score-ribbon strong { font-size: 14pt; } .score-ribbon span { font-size: 4.3pt; }
          .section-pad { padding: 8mm 10mm; }
          .story, .people, .surfaces, .budget, .workflow, .crawl, .requirements, .discovery, .issues, .acceptance { min-height: 185mm; break-before: page; break-inside: avoid-page; }
          .section-label { gap: 2mm; } .section-label > span { font-size: 20pt; } .section-label p { font-size: 4.4pt; }
          .section-head { grid-template-columns: 28mm minmax(0, 1fr); gap: 9mm; margin-bottom: 7mm; break-after: avoid; }
          .section-head h2, .story h2, .acceptance h2 { max-width: 23ch; font-size: 25pt; line-height: 0.94; }
          .section-head > div > p { max-width: 180mm; margin-top: 3mm; font-size: 7.2pt; line-height: 1.42; }
          .story { grid-template-columns: 28mm minmax(0, 0.8fr) minmax(0, 1fr); gap: 9mm; }
          .story-lead > p:not(.kicker) { font-size: 8pt; line-height: 1.5; }
          blockquote { margin-top: 5mm; padding: 4mm 0; font-size: 12pt; }
          .truth-list { grid-column: auto; }
          .truth-list article { grid-template-columns: 8mm minmax(0, 1fr); gap: 3mm; padding: 3mm 0; }
          .truth-list article > span { font-size: 9pt; } .truth-list h3 { font-size: 7.5pt; } .truth-list p { margin-top: 1mm; font-size: 5.5pt; line-height: 1.4; }
          .persona-list article { grid-template-columns: 29mm minmax(0, 0.9fr) minmax(0, 0.75fr) minmax(0, 1.15fr); }
          .persona-list article > *, .flow-list article > *, .requirement-list article > *, .issue-list article > * { padding: 2.7mm 3mm; }
          .persona-list article > :nth-child(n + 3), .requirement-list article > :nth-child(n + 3), .issue-list article > :nth-child(n + 3) { grid-column: auto; border-top: 0; border-left: 1px solid var(--border); }
          .person-id strong { font-size: 10pt; } .persona-list span { font-size: 3.8pt; } .persona-list h3 { margin-top: 1mm; font-size: 7.5pt; } .persona-list p { margin-top: 1mm; font-size: 5.2pt; line-height: 1.4; }
          .surface-strip { grid-template-columns: repeat(5, minmax(0, 1fr)); }
          .surface-strip article { grid-template-rows: auto minmax(38mm, 1fr) auto; gap: 2.5mm; padding: 3mm; }
          .surface-strip > article > span { font-size: 4pt; } .surface-strip article > div { gap: 1mm; padding: 3mm; } .surface-strip strong { font-size: 8pt; } .surface-strip small { font-size: 4pt; } .surface-strip p { font-size: 5pt; line-height: 1.4; }
          .budget-row { grid-template-columns: 28mm minmax(0, 1fr); }
          .budget-row + .budget-row { margin-top: 5mm; }
          .budget-label { padding: 3mm 4mm 3mm 0; } .budget-label > span { font-size: 4pt; } .budget-label h3 { margin-top: 2mm; font-size: 9pt; }
          .elements { grid-template-columns: repeat(5, minmax(0, 1fr)); }
          .elements article { min-height: 36mm; gap: 1.8mm; padding: 2.7mm; }
          .elements article > div strong { font-size: 15pt; } .elements article > div span { font-size: 3.3pt; } .elements h3 { font-size: 7pt; } .elements p { font-size: 4.7pt; line-height: 1.36; } .elements small { padding-top: 1.5mm; font-size: 4.1pt; line-height: 1.3; }
          .assumptions { margin-top: 4mm; padding-top: 3mm; } .assumptions strong, .stop-line strong { font-size: 4.5pt; } .assumptions p, .stop-line p { margin-top: 2mm; font-size: 5.5pt; line-height: 1.42; }
          .flow-list article { grid-template-columns: 10mm minmax(0, 0.72fr) minmax(0, 1.18fr) minmax(0, 0.72fr) minmax(0, 0.86fr); }
          .flow-list .io, .flow-list article > small { grid-column: auto; border-top: 0; }
          .flow-list article > strong { font-size: 11pt; } .flow-name span, .io span { font-size: 3.8pt; } .flow-name h3, .requirement-list h3, .issue-list h3 { margin-top: 1mm; font-size: 7pt; } .flow-list article > p, .requirement-list p, .issue-list p { font-size: 4.8pt; line-height: 1.38; } .io b { font-size: 4.5pt; } .flow-list article > small { font-size: 4.1pt; }
          .command-contract { grid-template-columns: 0.78fr 0.6fr 1fr 1fr; }
          .command-contract > div { padding: 4mm; } .command-contract span { font-size: 4pt; } .command-box strong { margin-top: 3mm; font-size: 27pt; } .command-box h3 { margin-top: 2mm; font-size: 10pt; } .command-box p, .contract-arrow p { font-size: 5pt; } .contract-arrow strong { margin-top: 3mm; font-size: 20pt; } .typed-side { gap: 1.5mm; } .typed-side b { padding-top: 1.5mm; font-size: 4.5pt; }
          .truth-chain { grid-template-columns: repeat(5, minmax(0, 1fr)); margin-top: 5mm; }
          .truth-chain > div { padding: 3mm; } .truth-chain span { font-size: 3.8pt; } .truth-chain strong { margin-top: 3mm; font-size: 5pt; } .truth-chain p { margin-top: 1mm; font-size: 4.5pt; }
          .requirement-list article, .issue-list article { grid-template-columns: 21mm minmax(0, 0.9fr) minmax(0, 0.62fr) minmax(0, 1fr); }
          .req-id span, .requirement-list article > div > span, .issue-list span { font-size: 3.6pt; } .req-id strong { font-size: 6.5pt; } .requirement-list p, .issue-list p { margin-top: 1mm; }
          .manifest { grid-template-columns: 31mm minmax(0, 1fr); gap: 3mm; padding: 4mm 0; } .manifest span { font-size: 4pt; } .manifest strong { font-size: 5.5pt; }
          .stop-line { margin-top: 5mm; padding-top: 3mm; }
          .packet { grid-template-columns: 31mm minmax(0, 1fr); gap: 3mm 6mm; margin-top: 5mm; padding-top: 3mm; } .packet > span { font-size: 4pt; } .packet > div { gap: 1mm; } .packet > div strong { padding: 1.5mm 2mm; font-size: 4.5pt; } .packet p { grid-column: 2; font-size: 5pt; }
          .acceptance { grid-template-columns: 28mm minmax(0, 1fr); gap: 9mm; }
          .acceptance { min-height: 168mm; break-after: avoid; } /* ²² Reserve the final baseline for the edition footer */
          .scenario-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 6mm; }
          .scenario-grid article { min-height: 43mm; gap: 2mm; padding: 3mm; } .scenario-grid span, .pass-grid span { font-size: 4pt; } .scenario-grid p { font-size: 5pt; } .scenario-grid strong { font-size: 6.5pt; } .scenario-grid small { padding-top: 1.5mm; font-size: 4.3pt; }
          .pass-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 5mm; }
          .pass-grid > div { min-height: 19mm; gap: 2mm; padding: 3mm; } .pass-grid strong { font-size: 6pt; line-height: 1.4; }
          .proposal-footer { grid-template-columns: 1fr auto auto; gap: 6mm; padding: 4mm 8mm; font-size: 4.5pt; break-before: avoid; break-inside: avoid; }
          .truth-list article, .persona-list article, .surface-strip article, .elements article, .flow-list article, .command-contract, .truth-chain, .requirement-list article, .issue-list article, .scenario-grid article, .pass-grid > div, .manifest, .stop-line, .packet { break-inside: avoid; }
        }
      </style>
      <style>/* ²¹ Host wrappers must release their viewport clipping during multi-page print */
        @media print { html, body, .host-mode-content, .host-mode-card, .field-component-card, .boxel-card-container, .current-card { display: block !important; height: auto !important; max-height: none !important; overflow: visible !important; } }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof CommonplaceProposal> { // ¹⁵ Editorial précis for document flow
    <template><article class='embedded'><span>{{@model.experimentLabel}} · Factory Trial 04</span><h2>{{@model.appName}}</h2><p>{{@model.subhead}}</p><blockquote>It gives the reader somewhere to go when they are done being recommended to.</blockquote><div><strong>5</strong><small>reuse</small><strong>10</strong><small>build</small><strong>3</strong><small>commands</small><strong>3</strong><small>formats</small></div></article><style scoped>.embedded { display: grid; gap: 0.75rem; padding: 1.2rem; background: var(--card); color: var(--foreground); } .embedded > span { color: var(--primary); font: 700 0.54rem var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; } h2 { margin: 0; font: 400 1.9rem var(--font-serif); letter-spacing: -0.04em; } p { max-width: 48rem; margin: 0; color: var(--muted-foreground); font: 400 1rem/1.5 var(--font-serif); } blockquote { margin: 0; border-left: 3px solid var(--primary); padding-left: 0.8rem; font: italic 400 0.9rem/1.45 var(--font-serif); } .embedded > div { display: grid; grid-template-columns: repeat(4, auto minmax(0, 1fr)); align-items: baseline; gap: 0.3rem 0.55rem; border-top: 1px solid var(--border); padding-top: 0.75rem; } .embedded > div strong { color: var(--primary); font: 400 1.2rem var(--font-serif); } .embedded > div small { color: var(--muted-foreground); font: 600 0.48rem var(--font-mono); text-transform: uppercase; } @media (max-width: 36rem) { .embedded > div { grid-template-columns: repeat(2, auto minmax(0, 1fr)); } }</style></template>
  };

  static fitted = class Fitted extends Component<typeof CommonplaceProposal> { // ¹⁶ CQ paste ticket for all parent-owned envelopes
    <template><article class='fit'><div class='fit-top'><span>{{@model.experimentLabel}}</span><strong>04</strong></div><div class='fit-sheet'><span>PERSONAL ZINE FACTORY</span><h2>{{@model.appName}}</h2><p>{{@model.issueTitle}}</p></div><div class='fit-note'>Paste anything.<br />Find the issue.</div><div class='fit-metrics'><span><strong>5</strong> reuse</span><span><strong>10</strong> build</span><span><strong>3</strong> outputs</span></div></article><style scoped>.fit { --type-ratio: 1.28; --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb)); --type-base: clamp(9px, calc(4px + 2cqi + 0.8cqb - 0.45 * var(--ar)), 18px); --label: max(7px, calc(var(--type-base) / pow(var(--type-ratio), 1.5))); --body: max(9px, calc(var(--type-base) / var(--type-ratio))); --title: max(12px, calc(var(--type-base) * pow(var(--type-ratio), 1.5))); width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto auto; gap: clamp(4px, 2cqi, 12px); padding: clamp(7px, 4cqi, 20px); overflow: hidden; background: var(--common-ink); color: var(--common-paper); } .fit-top, .fit-sheet, .fit-note, .fit-metrics { min-width: 0; min-height: 0; overflow: hidden; } .fit-top { display: flex; justify-content: space-between; gap: 0.5rem; } .fit-top span, .fit-sheet > span { color: var(--primary); font: 700 var(--label) var(--font-mono); letter-spacing: 0.09em; text-transform: uppercase; } .fit-top strong { color: var(--primary); font: 400 var(--title) var(--font-serif); } .fit-sheet { display: grid; align-content: center; gap: clamp(3px, 1cqb, 8px); border-left: clamp(2px, 1cqi, 6px) solid var(--primary); padding-left: clamp(5px, 2cqi, 14px); } .fit-sheet h2, .fit-sheet p { margin: 0; } .fit-sheet h2 { display: -webkit-box; overflow: hidden; font: 400 var(--title)/0.95 var(--font-serif); letter-spacing: -0.04em; -webkit-box-orient: vertical; -webkit-line-clamp: 2; } .fit-sheet p { display: -webkit-box; overflow: hidden; color: var(--common-paper-soft); font: italic 400 var(--body) var(--font-serif); -webkit-box-orient: vertical; -webkit-line-clamp: 2; } .fit-note { justify-self: end; padding: 0.5rem; background: var(--primary); color: var(--primary-foreground); font: 600 var(--label)/1.35 var(--font-mono); text-transform: uppercase; transform: rotate(-2deg); } .fit-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--common-rule-dark); } .fit-metrics span { padding-top: 0.45rem; color: var(--common-paper-soft); font: 600 var(--label) var(--font-mono); text-transform: uppercase; } .fit-metrics strong { color: var(--primary); font: 400 var(--body) var(--font-serif); } @container fitted-card (height <= 80px) { .fit { grid-template-rows: minmax(0, 1fr); } .fit-top, .fit-note, .fit-metrics, .fit-sheet > span, .fit-sheet p { display: none; } } @container fitted-card (80px < height <= 130px) { .fit { grid-template-rows: auto minmax(0, 1fr) auto; } .fit-note, .fit-metrics, .fit-sheet p { display: none; } } @container fitted-card (width <= 170px) { .fit-metrics span:nth-child(n + 2), .fit-sheet p { display: none; } .fit-metrics { grid-template-columns: 1fr; } }</style></template>
  };
}
