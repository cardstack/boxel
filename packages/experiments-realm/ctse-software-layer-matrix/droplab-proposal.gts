// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api'; // ¹ DropLab is a portable proposal document CardDef
import StringField from 'https://cardstack.com/base/string';
import DiscIcon from '@cardstack/boxel-icons/disc-2'; // ² CDN-verified 2026-07-21

interface IntakePlan {
  format: string;
  examples: string;
  extraction: string;
  provenance: string;
}

interface StagePlan {
  number: string;
  owner: string;
  name: string;
  action: string;
  output: string;
  signal: string;
}

interface ModelPlan {
  code: string;
  name: string;
  status: string;
  purpose: string;
  links: string;
}

interface ConceptPlan { // ²⁹ Periodic-style symbols make reusable/buildable concepts distinct from prose
  symbol: string;
  name: string;
}

interface CommandPlan {
  number: string;
  name: string;
  inputs: ConceptPlan[];
  outputs: ConceptPlan[];
  rule: string;
  records: ConceptPlan[];
}

interface RolePlan {
  role: string;
  sees: string;
  decides: string;
}

interface SurfacePlan {
  surface: string;
  component: string;
  proof: string;
}

interface NounLayerPlan { // ¹³ Every noun receives an ownership and implementation disposition
  layer: string;
  disposition: string;
  family: string;
  concepts: ConceptPlan[];
  tone: string;
  source: string;
  proof: string;
}

interface VerbLayerPlan { // ¹⁴ Verbs are separated by execution owner rather than flattened into commands
  family: string;
  owner: string;
  concepts: ConceptPlan[];
  inputs: ConceptPlan[];
  outputs: ConceptPlan[];
  tone: string;
  implementation: string;
}

export const INTAKE: IntakePlan[] = [ // ³³ Shared with the Vendor-style structured proposal
  { format: 'AUDIO', examples: 'master.wav · sample.mp3 · voice-note.m4a', extraction: 'Duration · codec · channels · waveform · transcript · likely tempo', provenance: 'Hash + source file + extraction method + timestamp' },
  { format: 'VISUAL', examples: 'cover.psd · lookbook.jpg · teaser.mov', extraction: 'Dimensions · color profile · frames · OCR · visible marks · people', provenance: 'Every crop and derivative links back to the untouched source' },
  { format: 'RIGHTS', examples: 'split-sheet.pdf · license.docx · email.eml', extraction: 'Parties · shares · territories · dates · restrictions · signatures', provenance: 'Claim-level page or message anchor; extraction never becomes legal truth' },
  { format: 'COMMERCE', examples: 'sizes.csv · pricing.xlsx · sku-notes.md', extraction: 'Variants · quantities · price · currency · launch window · channel', provenance: 'Original cell/file coordinate preserved beside normalized values' },
];

export const STAGES: StagePlan[] = [ // ³⁴ Shared with the Vendor-style structured proposal
  { number: '01', owner: 'SYSTEM', name: 'INGEST', action: 'Read bytes and structure without editorial judgment.', output: 'CreativeAsset[] + Annotation[] + Anchor[]', signal: 'Mechanical' }, // ¹⁵ Reuse BSL evidence nouns
  { number: '02', owner: 'AI + POLICY', name: 'INTERPRET', action: 'Connect credits, agreements, samples, restrictions, and missing evidence.', output: 'CreditClaim[] + RightsFinding[]', signal: 'Explainable' },
  { number: '03', owner: 'AI + CREATIVE', name: 'GENERATE', action: 'Produce channel-ready copy, metadata, alt text, visual directions, and variants.', output: 'ContentVariant[]', signal: 'Draft' },
  { number: '04', owner: 'HUMANS', name: 'REVIEW', action: 'Resolve findings, edit creative, approve credits, and sign release gates.', output: 'ApprovalGate[] + Attribution[] + Job[]', signal: 'Accountable' }, // ¹⁶ Audit uses shared execution/provenance records
  { number: '05', owner: 'PLATFORM', name: 'PACKAGE', action: 'Freeze approved assets, manifests, contracts, channel payloads, and receipts.', output: 'ReleasePackage', signal: 'Immutable' },
];

export const MODELS: ModelPlan[] = [ // ³⁵ Shared with the Vendor-style structured proposal
  { code: 'Dr', name: 'Drop', status: 'NEW · APP', purpose: 'The release aggregate: concept, collaborators, schedule, channels, gates, and final package.', links: 'Person · Team · Campaign · Product · CreativeAsset[] · ReleasePackage' },
  { code: 'Ca', name: 'CreativeAsset', status: 'NEW · APP', purpose: 'A source or generated artifact with identity, lineage, rendition role, and review state.', links: 'FileDef · Person[] · Annotation[] · Attribution[] · ContentVariant[]' }, // ¹⁷ Provenance stays reusable
  { code: 'Cc', name: 'CreditClaim', status: 'NEW · APP', purpose: 'A proposed contribution and share, with evidence and an explicit verification state.', links: 'Person · CreativeAsset[] · Document[] · ApprovalGate' },
  { code: 'Rf', name: 'RightsFinding', status: 'NEW · APP', purpose: 'An explainable conflict, absence, restriction, or risk discovered across evidence.', links: 'CreativeAsset[] · Contract[] · Clause[] · CreditClaim[]' },
  { code: 'Cv', name: 'ContentVariant', status: 'NEW · APP', purpose: 'A generated or edited channel-specific expression with prompt, source, author, and status.', links: 'CreativeAsset[] · Campaign · Person · ApprovalGate' },
  { code: 'Ag', name: 'ApprovalGate', status: 'NEW · APP', purpose: 'A named human decision with authority, required inputs, outcome, rationale, and timestamp.', links: 'Role · Person · RightsFinding[] · ContentVariant[]' },
  { code: 'Rp', name: 'ReleasePackage', status: 'NEW · APP', purpose: 'The immutable, publish-ready bundle and manifest produced only after all required gates pass.', links: 'CreativeAsset[] · Contract[] · Campaign · Product[] · Job[] · Attribution[]' }, // ¹⁸ Package cites shared run records
];

export const NOUN_LAYERS: NounLayerPlan[] = [ // ³⁶ Shared with the Vendor-style structured proposal
  { layer: '06', disposition: 'COMPOSE', family: 'Product', tone: 'compose', concepts: [{ symbol: 'Dl', name: 'DropLab' }, { symbol: 'Id', name: 'Intake Deck' }, { symbol: 'Aw', name: 'Asset Wall' }, { symbol: 'Rm', name: 'Rights Map' }, { symbol: 'Vs', name: 'Variant Studio' }, { symbol: 'Rb', name: 'Release Board' }, { symbol: 'Pf', name: 'Provenance Feed' }], source: 'This app', proof: 'Product surfaces compose typed cards and commands; they do not become data models.' },
  { layer: '05.5A', disposition: 'BUILD', family: 'App-owned domain', tone: 'build', concepts: [{ symbol: 'Dr', name: 'Drop' }, { symbol: 'Ca', name: 'Creative Asset' }, { symbol: 'Cc', name: 'Credit Claim' }, { symbol: 'Rf', name: 'Rights Finding' }, { symbol: 'Cv', name: 'Content Variant' }, { symbol: 'Ag', name: 'Approval Gate' }, { symbol: 'Rp', name: 'Release Package' }], source: 'DropLab realm', proof: 'Each noun expresses release-specific semantics and has a documented graduation rule.' },
  { layer: '05.5K', disposition: 'IMPORT', family: 'Domain kits', tone: 'reuse', concepts: [{ symbol: 'Co', name: 'Contract' }, { symbol: 'Cl', name: 'Clause' }, { symbol: 'Si', name: 'Signatory' }, { symbol: 'Li', name: 'License' }, { symbol: 'Cm', name: 'Campaign' }, { symbol: 'Pd', name: 'Product' }, { symbol: 'Pr', name: 'Price' }, { symbol: 'Ch', name: 'Channel' }], source: 'Legal · Commerce · Marketing kits', proof: 'Load verified CodeRefs; no copied schema and no compatibility wrapper unless a real gap is recorded.' },
  { layer: '05', disposition: 'IMPORT', family: 'Common records', tone: 'reuse', concepts: [{ symbol: 'Pe', name: 'Person' }, { symbol: 'Tm', name: 'Team' }, { symbol: 'Ro', name: 'Role' }, { symbol: 'Ta', name: 'Task' }, { symbol: 'Ev', name: 'Event' }, { symbol: 'Ac', name: 'Activity' }, { symbol: 'No', name: 'Note' }, { symbol: 'Do', name: 'Document' }, { symbol: 'Fi', name: 'File' }], source: 'Catalog operational models', proof: 'Identity, assignment, collaboration, and evidence remain exchangeable across apps.' },
  { layer: '04–02', disposition: 'IMPORT', family: 'Fields + values', tone: 'reuse', concepts: [{ symbol: 'St', name: 'Status' }, { symbol: 'Dt', name: 'DateTime' }, { symbol: 'Du', name: 'Duration' }, { symbol: 'Cu', name: 'Currency' }, { symbol: 'Pc', name: 'Percent' }, { symbol: 'Ur', name: 'URL' }, { symbol: 'En', name: 'Enum' }, { symbol: 'At', name: 'Attribution' }, { symbol: 'Ep', name: 'Effective Period' }, { symbol: 'Sb', name: 'Signature Block' }], source: 'Base realm + catalog FieldDefs', proof: 'Known value semantics use existing editors, serializers, and validation.' },
  { layer: 'BSL / 01', disposition: 'VERIFY', family: 'Execution + trust', tone: 'verify', concepts: [{ symbol: 'Ar', name: 'Actor' }, { symbol: 'An', name: 'Annotation' }, { symbol: 'Ak', name: 'Anchor' }, { symbol: 'Jb', name: 'Job' }, { symbol: 'Pk', name: 'Packet' }, { symbol: 'Po', name: 'Policy' }, { symbol: 'At', name: 'Attribution' }], source: 'BSL and platform capabilities', proof: 'Search first. If a noun is only proposed, graduate it in BSL—not privately inside DropLab.' },
  { layer: '03', disposition: 'DISCOVER', family: 'Presentation', tone: 'discover', concepts: [{ symbol: 'Fd', name: 'File Drop' }, { symbol: 'Gf', name: 'Guided Form' }, { symbol: 'Mg', name: 'Media Gallery' }, { symbol: 'Pv', name: 'Preview' }, { symbol: 'Gr', name: 'Graph' }, { symbol: 'Tb', name: 'Table' }, { symbol: 'Kb', name: 'Kanban' }, { symbol: 'Tl', name: 'Timeline' }, { symbol: 'Af', name: 'Activity Feed' }], source: 'Catalog components', proof: 'Preview and compatibility-test the component before authoring a replacement.' },
  { layer: 'Ø', disposition: 'DO NOT CREATE', family: 'Aliases', tone: 'avoid', concepts: [{ symbol: 'Ai', name: 'Artist' }, { symbol: 'Tr', name: 'Track' }, { symbol: 'Cp', name: 'Caption' }, { symbol: 'Ga', name: 'Garment' }, { symbol: 'Rv', name: 'Reviewer' }, { symbol: 'Ae', name: 'Audit Event' }, { symbol: 'Ef', name: 'Extraction Fact' }], source: 'Compose existing nouns', proof: 'Use Person + Role, CreativeAsset roles, ContentVariant kinds, Product, Activity, Annotation, Job, and Attribution.' },
];

export const VERB_LAYERS: VerbLayerPlan[] = [ // ³⁷ Shared with the Vendor-style structured proposal
  { family: 'PLATFORM OPERATIONS', owner: 'Realm server + host', tone: 'platform', concepts: [{ symbol: 'Se', name: 'Search' }, { symbol: 'Qu', name: 'Query' }, { symbol: 'Re', name: 'Read' }, { symbol: 'Cr', name: 'Create' }, { symbol: 'Sa', name: 'Save' }, { symbol: 'Up', name: 'Update' }, { symbol: 'Rc', name: 'Run Command' }], inputs: [{ symbol: 'Rf', name: 'Code Ref' }, { symbol: 'Qu', name: 'Query' }, { symbol: 'Cd', name: 'Card' }, { symbol: 'Ci', name: 'Command Input' }], outputs: [{ symbol: 'Cd', name: 'Cards' }, { symbol: 'Sr', name: 'Search Results' }, { symbol: 'Rs', name: 'Command Result' }], implementation: 'Reuse directly. These are framework operations, not DropLab commands.' },
  { family: 'MECHANICAL TOOLS', owner: 'Deterministic extractor', tone: 'mechanical', concepts: [{ symbol: 'Ha', name: 'Hash' }, { symbol: 'Im', name: 'Inspect Metadata' }, { symbol: 'Oc', name: 'OCR' }, { symbol: 'Tr', name: 'Transcribe' }, { symbol: 'Pd', name: 'Parse Document' }, { symbol: 'Rs', name: 'Read Sheet' }], inputs: [{ symbol: 'Fi', name: 'File' }, { symbol: 'Ev', name: 'Extractor Version' }], outputs: [{ symbol: 'An', name: 'Annotation' }, { symbol: 'Ak', name: 'Anchor' }], implementation: 'Discover existing tools; wrap only missing adapters. No LLM interpretation in this layer.' },
  { family: 'AI CAPABILITIES', owner: 'Model through proxy', tone: 'ai', concepts: [{ symbol: 'Cf', name: 'Classify' }, { symbol: 'Ip', name: 'Interpret' }, { symbol: 'Cp', name: 'Compare' }, { symbol: 'Gn', name: 'Generate' }, { symbol: 'Sm', name: 'Summarize' }], inputs: [{ symbol: 'Pk', name: 'Packet' }, { symbol: 'Po', name: 'Policy' }, { symbol: 'Pm', name: 'Prompt' }], outputs: [{ symbol: 'Dc', name: 'Draft Card' }, { symbol: 'Cf', name: 'Confidence' }, { symbol: 'Ci', name: 'Citation' }], implementation: 'Invoke through typed app commands; AI never persists or approves directly.' },
  { family: 'HUMAN DECISIONS', owner: 'Named Actor with Role', tone: 'human', concepts: [{ symbol: 'Ed', name: 'Edit' }, { symbol: 'Cc', name: 'Confirm Credit' }, { symbol: 'Rc', name: 'Request Change' }, { symbol: 'Ap', name: 'Approve' }, { symbol: 'Rj', name: 'Reject' }, { symbol: 'Rs', name: 'Resolve' }, { symbol: 'Wv', name: 'Waive' }], inputs: [{ symbol: 'Df', name: 'Draft / Finding' }, { symbol: 'Ev', name: 'Evidence' }, { symbol: 'Au', name: 'Authority' }], outputs: [{ symbol: 'Ag', name: 'Approval Gate' }, { symbol: 'An', name: 'Annotation' }, { symbol: 'At', name: 'Attribution' }], implementation: 'Consequential decisions require identity, rationale, timestamp, and append-only history.' },
  { family: 'APP COMMANDS', owner: 'DropLab policy', tone: 'app', concepts: [{ symbol: 'St', name: 'Start' }, { symbol: 'Rg', name: 'Register' }, { symbol: 'Ex', name: 'Extract' }, { symbol: 'An', name: 'Analyze' }, { symbol: 'Gn', name: 'Generate' }, { symbol: 'Rt', name: 'Route' }, { symbol: 'Rs', name: 'Resolve' }, { symbol: 'Pb', name: 'Publish' }], inputs: [{ symbol: 'An', name: 'App Noun' }, { symbol: 'Rn', name: 'Reused Noun' }], outputs: [{ symbol: 'An', name: 'App Noun' }, { symbol: 'Jb', name: 'Job' }, { symbol: 'Pk', name: 'Packet' }, { symbol: 'At', name: 'Attribution' }], implementation: 'Eight typed commands below orchestrate other layers without absorbing their schemas.' },
];

export const COMMANDS: CommandPlan[] = [ // ³⁸ Shared with the Vendor-style structured proposal
  { number: '01', name: 'StartDrop', inputs: [{ symbol: 'Pe', name: 'Person' }, { symbol: 'Tm', name: 'Team' }, { symbol: 'Cm', name: 'Campaign' }, { symbol: 'Pd', name: 'Product' }], outputs: [{ symbol: 'Dr', name: 'Drop' }], rule: 'Create the release aggregate and ownership context; do not duplicate the imported people or campaign.', records: [{ symbol: 'Jb', name: 'Job' }, { symbol: 'Pk', name: 'Packet' }, { symbol: 'At', name: 'Attribution' }] },
  { number: '02', name: 'RegisterSourceFiles', inputs: [{ symbol: 'Dr', name: 'Drop' }, { symbol: 'Fi', name: 'File' }], outputs: [{ symbol: 'Ca', name: 'Creative Asset' }], rule: 'Never overwrite source bytes; each asset retains its FileDef identity and content hash.', records: [{ symbol: 'Jb', name: 'Job' }, { symbol: 'Pk', name: 'Packet' }, { symbol: 'At', name: 'Attribution' }] },
  { number: '03', name: 'ExtractSourceFacts', inputs: [{ symbol: 'Ca', name: 'Creative Asset' }, { symbol: 'Po', name: 'Extractor Policy' }], outputs: [{ symbol: 'An', name: 'Annotation' }, { symbol: 'Ak', name: 'Anchor' }], rule: 'Mechanical output names source coordinates and extractor version; it makes no rights judgment.', records: [{ symbol: 'Jb', name: 'Job' }, { symbol: 'Pk', name: 'Packet' }, { symbol: 'At', name: 'Attribution' }] },
  { number: '04', name: 'AnalyzeRightsAndCredits', inputs: [{ symbol: 'Dr', name: 'Drop' }, { symbol: 'Ca', name: 'Creative Asset' }, { symbol: 'An', name: 'Annotation' }, { symbol: 'Co', name: 'Contract' }, { symbol: 'Cl', name: 'Clause' }], outputs: [{ symbol: 'Cc', name: 'Credit Claim' }, { symbol: 'Rf', name: 'Rights Finding' }], rule: 'AI findings are proposals with evidence and confidence, never silent facts.', records: [{ symbol: 'Jb', name: 'Job' }, { symbol: 'Pk', name: 'Packet' }, { symbol: 'At', name: 'Attribution' }] },
  { number: '05', name: 'GenerateLaunchVariants', inputs: [{ symbol: 'Dr', name: 'Drop' }, { symbol: 'Ca', name: 'Creative Asset' }, { symbol: 'Cm', name: 'Campaign' }, { symbol: 'Ch', name: 'Channel' }], outputs: [{ symbol: 'Cv', name: 'Content Variant' }], rule: 'Generated outputs retain prompt, model, source set, policy version, and editor history.', records: [{ symbol: 'Jb', name: 'Job' }, { symbol: 'Pk', name: 'Packet' }, { symbol: 'At', name: 'Attribution' }] },
  { number: '06', name: 'RouteForApproval', inputs: [{ symbol: 'Dr', name: 'Drop' }, { symbol: 'Cv', name: 'Content Variant' }, { symbol: 'Rf', name: 'Rights Finding' }, { symbol: 'Ro', name: 'Role' }], outputs: [{ symbol: 'Ag', name: 'Approval Gate' }, { symbol: 'Ta', name: 'Task' }], rule: 'Authority derives from reused Role; assignments use shared Task rather than a local clone.', records: [{ symbol: 'Jb', name: 'Job' }, { symbol: 'Pk', name: 'Packet' }, { symbol: 'At', name: 'Attribution' }] },
  { number: '07', name: 'ResolveFinding', inputs: [{ symbol: 'Rf', name: 'Rights Finding' }, { symbol: 'Do', name: 'Document' }, { symbol: 'Pe', name: 'Person' }, { symbol: 'Dc', name: 'Decision' }], outputs: [{ symbol: 'Rf', name: 'Rights Finding' }, { symbol: 'An', name: 'Annotation' }], rule: 'Resolution appends; it cannot erase the original finding, evidence, or rejected alternatives.', records: [{ symbol: 'Jb', name: 'Job' }, { symbol: 'Pk', name: 'Packet' }, { symbol: 'At', name: 'Attribution' }] },
  { number: '08', name: 'PublishReleasePackage', inputs: [{ symbol: 'Dr', name: 'Drop' }, { symbol: 'Ag', name: 'Approval Gate' }, { symbol: 'Cv', name: 'Content Variant' }], outputs: [{ symbol: 'Rp', name: 'Release Package' }], rule: 'Fail closed when a required gate, credit, rendition, contract, or source link is unresolved.', records: [{ symbol: 'Jb', name: 'Job' }, { symbol: 'Pk', name: 'Packet' }, { symbol: 'At', name: 'Attribution' }] },
];

export const ROLES: RolePlan[] = [ // ³⁹ Shared with the Vendor-style structured proposal
  { role: 'ARTIST', sees: 'Creative direction · credits · final variants', decides: 'Identity, intent, attribution, release consent' },
  { role: 'PRODUCER', sees: 'Masters · samples · technical metadata', decides: 'Audio provenance, contributor accuracy, master readiness' },
  { role: 'DESIGNER', sees: 'Visual assets · crops · channel constraints', decides: 'Visual system, renditions, accessibility description' },
  { role: 'MANAGER', sees: 'Schedule · dependencies · campaign package', decides: 'Scope, channel mix, operational release readiness' },
  { role: 'RIGHTS REVIEWER', sees: 'Claims · contracts · findings · evidence', decides: 'Clearance, conditions, unresolved risk, sign-off' },
  { role: 'PUBLISHER', sees: 'Only approved package candidates', decides: 'Final validation, package freeze, distribution receipt' },
];

export const SURFACES: SurfacePlan[] = [ // ⁴⁰ Shared with the Vendor-style structured proposal
  { surface: 'INTAKE DECK', component: 'File drop + guided form', proof: 'Mixed files preserve identity and show extraction progress by source.' },
  { surface: 'ASSET WALL', component: 'Media gallery + preview', proof: 'Audio, image, video, document, and generated variants keep their own renderers.' },
  { surface: 'RIGHTS MAP', component: 'Relationship graph + evidence drawer', proof: 'A finding can be traced to people, assets, clauses, and source anchors.' },
  { surface: 'VARIANT STUDIO', component: 'Comparison grid + editor', proof: 'Prompt, source set, channel constraints, edits, and approval state remain visible.' },
  { surface: 'RELEASE BOARD', component: 'Kanban + timeline', proof: 'Cards move by command, not by presentation-only status mutation.' },
  { surface: 'PROVENANCE FEED', component: 'Audit timeline + activity feed', proof: 'System, AI, and human events are distinguishable and append-only.' },
];

export class DropLabProposal extends CardDef { // ⁹ One live proposal card for the replacement factory run
  static displayName = 'DropLab Factory Proposal';
  static icon = DiscIcon;
  static prefersWideFormat = true;

  @field label = contains(StringField);
  @field title = contains(StringField);
  @field subtitle = contains(StringField);
  @field dropName = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: DropLabProposal) {
      return this.cardInfo?.name?.trim()?.length
        ? this.cardInfo.name
        : (this.title ?? `Untitled ${this.constructor.displayName}`);
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: DropLabProposal) {
      return this.cardInfo?.summary?.trim()?.length ? this.cardInfo.summary : this.subtitle;
    },
  });

  static isolated = class Isolated extends Component<typeof DropLabProposal> { // ¹⁰ Editorial proposal separates the four truth regimes visually
    intake = INTAKE;
    stages = STAGES;
    models = MODELS;
    nounLayers = NOUN_LAYERS; // ²² Expose the two architectural ledgers to the proposal surface
    verbLayers = VERB_LAYERS;
    commands = COMMANDS;
    roles = ROLES;
    surfaces = SURFACES;

    <template>
      <article class='drop-proposal'>
        <section class='hero'>
          <div class='hero-top'><span>{{@model.label}}</span><span>SOFTWARE FACTORY RUN · 02</span></div>
          <div class='hero-grid'>
            <div class='hero-title'><p>UPLOAD THE MESS.</p><h1>{{@model.title}}</h1><p class='subtitle'>{{@model.subtitle}}</p></div>
            <div class='hero-art' aria-label='Drop signal artwork'>
              <div class='disc'><span>DL</span><i></i></div>
              <div class='signal'><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b></div>
              <div class='drop-stamp'><span>TEST RELEASE</span><strong>{{@model.dropName}}</strong><small>MUSIC × FASHION × FILM</small></div>
            </div>
          </div>
          <div class='hero-stats'><span><strong>4</strong> input families</span><span><strong>7</strong> app nouns</span><span><strong>8</strong> typed commands</span><span><strong>6</strong> human roles</span><span><strong>1</strong> audited package</span></div> {{! ²³ Corrected scope counts }}
        </section>

        <section class='thesis pad'>
          <div class='kicker'>00 · THE RUN</div>
          <div><h2>A release studio that knows where everything came from.</h2><p>DropLab turns a chaotic shared folder into a credited, cleared, channel-ready release. The system extracts what it can prove, asks AI to interpret what needs judgment, generates what does not yet exist, and routes every consequential decision to a named human.</p></div>
          <div class='rule-card'><span>THE NON-NEGOTIABLE</span><strong>Mechanical fact ≠ AI interpretation ≠ generated draft ≠ human approval.</strong><p>The interface, schema, commands, and audit history must preserve those boundaries.</p></div>
        </section>

        <section class='intake pad'>
          <div class='section-title'><span>01</span><div><p>INPUT REALITY</p><h2>One drop folder. Four kinds of evidence.</h2></div></div>
          <div class='intake-grid'>{{#each this.intake as |item|}}<article><span>{{item.format}}</span><h3>{{item.examples}}</h3><p>{{item.extraction}}</p><small>{{item.provenance}}</small></article>{{/each}}</div>
        </section>

        <section class='pipeline'>
          <div class='section-title pad'><span>02</span><div><p>TRUTH PIPELINE</p><h2>Five regimes, no magic blur.</h2></div></div>
          <div class='stage-list'>{{#each this.stages as |stage|}}<article class='stage stage-{{stage.number}}'><div class='stage-num'>{{stage.number}}</div><div><span>{{stage.owner}}</span><h3>{{stage.name}}</h3></div><p>{{stage.action}}</p><strong>{{stage.output}}</strong><small>{{stage.signal}}</small></article>{{/each}}</div>
        </section>

        <section class='models pad'>
          <div class='section-title'><span>03</span><div><p>NOUN ARCHITECTURE</p><h2>Own seven nouns. Import the rest.</h2></div></div> {{! ²⁴ One-by-one noun classification }}
          <p class='section-copy'>Every noun has a layer, source, and disposition. “Reuse” counts only after its module loads; “verify” means the concept belongs in BSL or the platform but still needs a real implementation check.</p>
          <div class='noun-ledger'>
            <div class='noun-head'><span>Layer</span><span>Disposition</span><span>Family + nouns</span><span>Source</span><span>Proof obligation</span></div>
            {{#each this.nounLayers as |group|}}
              <article class='noun-row'><strong>{{group.layer}}</strong><b>{{group.disposition}}</b><div><span>{{group.family}}</span><div class='concept-list tone-{{group.tone}}'>{{#each group.concepts as |concept|}}<span class='concept-tile'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div><small>{{group.source}}</small><p>{{group.proof}}</p></article> {{! ³⁰ Concepts are tiles; all explanatory copy remains prose }}
            {{/each}}
          </div>
          <h3 class='subsection-title'>The seven app-owned CardDefs</h3>
          <div class='model-grid'>{{#each this.models as |model|}}<article><div class='model-code'>{{model.code}}</div><div><span>{{model.status}}</span><h3>{{model.name}}</h3><p>{{model.purpose}}</p><small>{{model.links}}</small></div></article>{{/each}}</div>
          <div class='reuse-strip'><span>GRADUATION RULE</span><strong>An app noun moves into a domain kit only after three unrelated applications reuse the same semantics without DropLab-specific fields.</strong></div>
        </section>

        <section class='commands pad'>
          <div class='section-title'><span>04</span><div><p>VERB ARCHITECTURE</p><h2>Not every verb is an app command.</h2></div></div> {{! ²⁵ Platform, tool, AI, human, and app verbs stay separate }}
          <div class='verb-layer-grid'>{{#each this.verbLayers as |group|}}<article><div><span>{{group.family}}</span><strong>{{group.owner}}</strong></div><div class='concept-list tone-{{group.tone}}'>{{#each group.concepts as |concept|}}<span class='concept-tile'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div><div class='io-block'><b>IN</b><div class='mini-concepts'>{{#each group.inputs as |concept|}}<span class='mini-concept'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div><div class='io-block'><b>OUT</b><div class='mini-concepts'>{{#each group.outputs as |concept|}}<span class='mini-concept'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div><small>{{group.implementation}}</small></article>{{/each}}</div> {{! ³¹ Verbs and their typed boundaries use the same element grammar }}
          <h3 class='subsection-title command-title'>The eight DropLab commands</h3>
          <div class='command-list'>{{#each this.commands as |command|}}<article><span>{{command.number}}</span><div><h3>{{command.name}}</h3><div class='command-io'><div><b>IN</b><div class='mini-concepts'>{{#each command.inputs as |concept|}}<span class='mini-concept'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div><i>→</i><div><b>OUT</b><div class='mini-concepts'>{{#each command.outputs as |concept|}}<span class='mini-concept'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div></div><div class='run-record'><b>RUN RECORD</b><div class='mini-concepts'>{{#each command.records as |concept|}}<span class='mini-concept'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div></div><small>{{command.rule}}</small></article>{{/each}}</div> {{! ³² Command IO names become scan-friendly typed concept boxes }}
        </section>

        <section class='collab pad'>
          <div class='section-title'><span>05</span><div><p>MULTI-USER WORKFLOW</p><h2>Different eyes. Explicit authority.</h2></div></div>
          <div class='role-grid'>{{#each this.roles as |person|}}<article><span>{{person.role}}</span><p>{{person.sees}}</p><strong>{{person.decides}}</strong></article>{{/each}}</div>
          <div class='audit-line'><span>SOURCE</span><b>→</b><span>EXTRACTION</span><b>→</b><span>MODEL + PROMPT</span><b>→</b><span>DRAFT</span><b>→</b><span>HUMAN EDIT</span><b>→</b><span>APPROVAL</span><b>→</b><span>RECEIPT</span></div>
        </section>

        <section class='surfaces pad'>
          <div class='section-title'><span>06</span><div><p>CATALOG DISCOVERY</p><h2>Search the layer before drawing the screen.</h2></div></div>
          <div class='surface-grid'>{{#each this.surfaces as |surface|}}<article><span>{{surface.surface}}</span><h3>{{surface.component}}</h3><p>{{surface.proof}}</p></article>{{/each}}</div>
        </section>

        <section class='acceptance pad'>
          <div class='section-title'><span>07</span><div><p>FINAL PRODUCT</p><h2>What the factory must leave behind.</h2></div></div>
          <div class='acceptance-grid'>
            <article><span>LIVE DROP</span><strong>Intake deck, asset wall, rights map, variant studio, release board, provenance feed, and package view.</strong></article>
            <article><span>THREE SCENARIOS</span><strong>Clear release publishes; uncleared sample blocks; generated caption is edited and approved with lineage intact.</strong></article>
            <article><span>REUSE LEDGER</span><strong>Listing, module ref, preview, compatibility decision, version, and upgrade boundary for every imported concept.</strong></article>
            <article><span>FACTORY TELEMETRY</span><strong>Discovery time, build time, tokens, modules reused, local code, rework, defects, and post-build maintenance estimate.</strong></article>
          </div>
          <div class='scoreline'><span>PASS TARGET</span><strong>≤ 8 hours · ≥ 55% module reuse · ≤ 65% greenfield tokens · 100% consequential AI outputs reviewable</strong></div>
        </section>

        <div class='endmark'><strong>DROP / LAB</strong><span>Build the unique judgment. Sample the mature substrate.</span></div>
      </article>

      <style scoped>
        .drop-proposal { min-width: 0; overflow: hidden; background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
        .hero { background: var(--drop-paper); color: var(--drop-ink); }
        .hero-top, .hero-stats, .kicker, .section-title p, .rule-card span, .intake-grid span, .noun-ledger span, .model-grid span, .reuse-strip span, .verb-layer-grid span, .role-grid span, .surface-grid span, .acceptance-grid span, .scoreline span, .endmark { font-family: var(--font-mono); letter-spacing: 0.11em; text-transform: uppercase; } /* ²⁶ Ledger labels share the evidence voice */
        .hero-top { display: flex; justify-content: space-between; gap: 1rem; padding: 1rem clamp(1.2rem, 4vw, 4rem); border-bottom: 1px solid var(--drop-ink); font-size: 0.58rem; font-weight: 700; }
        .hero-grid { display: grid; grid-template-columns: minmax(0, 1.18fr) minmax(22rem, 0.82fr); min-height: 34rem; }
        .hero-title { display: grid; align-content: end; gap: 1.2rem; min-width: 0; padding: clamp(2rem, 6vw, 6rem); border-right: 1px solid var(--drop-ink); }
        .hero-title > p:first-child { margin: 0; color: var(--drop-violet); font: 700 0.68rem var(--font-mono); letter-spacing: 0.16em; }
        .hero h1 { max-width: 8ch; margin: 0; font-family: var(--font-serif); font-size: clamp(5rem, 11vw, 12rem); font-weight: 400; letter-spacing: -0.07em; line-height: 0.7; }
        .subtitle { max-width: 50rem; margin: 0; font-size: clamp(1rem, 1.5vw, 1.35rem); font-weight: 500; line-height: 1.45; }
        .hero-art { position: relative; min-width: 0; overflow: hidden; background: var(--drop-violet); }
        .disc { position: absolute; width: min(30rem, 72%); aspect-ratio: 1; top: 7%; right: -8%; display: grid; place-items: center; border-radius: 50%; background: var(--drop-ink); color: var(--drop-acid); font: 700 clamp(2rem, 5vw, 5rem) var(--font-mono); }
        .disc::before, .disc::after { content: ''; position: absolute; border: 1px solid var(--drop-paper); border-radius: 50%; inset: 18%; opacity: 0.35; }
        .disc::after { inset: 35%; background: var(--drop-coral); opacity: 1; }
        .disc span { position: relative; z-index: 1; }
        .disc i { position: absolute; z-index: 2; width: 6%; aspect-ratio: 1; border-radius: 50%; background: var(--drop-ink); }
        .signal { position: absolute; inset: auto 5% 5% 5%; height: 25%; display: flex; align-items: end; gap: 2%; }
        .signal b { flex: 1; background: var(--drop-acid); }
        .signal b:nth-child(1), .signal b:nth-child(9) { height: 22%; } .signal b:nth-child(2), .signal b:nth-child(8) { height: 42%; } .signal b:nth-child(3), .signal b:nth-child(7) { height: 76%; } .signal b:nth-child(4), .signal b:nth-child(6) { height: 55%; } .signal b:nth-child(5) { height: 100%; }
        .drop-stamp { position: absolute; top: 7%; left: 6%; display: grid; gap: 0.35rem; max-width: 14rem; padding: 1rem; transform: rotate(-4deg); background: var(--drop-acid); color: var(--drop-ink); }
        .drop-stamp span, .drop-stamp small { font: 700 0.52rem var(--font-mono); letter-spacing: 0.1em; }
        .drop-stamp strong { font-family: var(--font-serif); font-size: 1.7rem; line-height: 0.9; }
        .hero-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-top: 1px solid var(--drop-ink); }
        .hero-stats span { display: grid; gap: 0.3rem; padding: 1rem clamp(0.7rem, 2vw, 1.5rem); font-size: 0.5rem; }
        .hero-stats span + span { border-left: 1px solid var(--drop-ink); }
        .hero-stats strong { color: var(--drop-violet); font-family: var(--font-serif); font-size: 2rem; font-weight: 400; }
        .pad { padding: clamp(2.5rem, 6vw, 6rem); }
        .thesis { display: grid; grid-template-columns: 0.28fr minmax(0, 1fr) minmax(16rem, 0.48fr); gap: clamp(2rem, 5vw, 6rem); border-bottom: 1px solid var(--border); }
        .kicker { color: var(--drop-acid); font-size: 0.58rem; font-weight: 700; }
        .thesis h2, .section-title h2 { margin: 0; font-family: var(--font-serif); font-size: clamp(2.5rem, 5.2vw, 5.8rem); font-weight: 400; letter-spacing: -0.05em; line-height: 0.9; }
        .thesis > div > p { max-width: 50rem; color: var(--muted-foreground); font-size: 1rem; line-height: 1.7; }
        .rule-card { align-self: end; display: grid; gap: 0.8rem; border-top: 0.35rem solid var(--drop-coral); padding-top: 1rem; }
        .rule-card span { color: var(--drop-coral); font-size: 0.52rem; font-weight: 700; }
        .rule-card strong { font-family: var(--font-serif); font-size: 1.35rem; font-weight: 400; line-height: 1.2; }
        .rule-card p { margin: 0; color: var(--muted-foreground); font-size: 0.72rem; line-height: 1.5; }
        .section-title { display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: 1.5rem; align-items: start; margin-bottom: clamp(2rem, 5vw, 4rem); }
        .section-title > span { color: var(--drop-acid); font-family: var(--font-serif); font-size: 3.5rem; line-height: 0.8; }
        .section-title p { margin: 0 0 0.7rem; color: var(--muted-foreground); font-size: 0.54rem; font-weight: 700; }
        .section-title h2 { max-width: 15ch; font-size: clamp(2rem, 4vw, 4.5rem); }
        .intake { background: var(--card); }
        .intake-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .intake-grid article { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 1rem; min-width: 0; padding: 1.4rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .intake-grid span { color: var(--drop-cyan); font-size: 0.52rem; font-weight: 700; }
        .intake-grid h3 { margin: 0; font-family: var(--font-serif); font-size: 1.35rem; font-weight: 400; line-height: 1.1; }
        .intake-grid p { margin: 0; color: var(--muted-foreground); font-size: 0.72rem; line-height: 1.55; }
        .intake-grid small { border-top: 1px solid var(--border); padding-top: 0.8rem; color: var(--foreground); font: 500 0.58rem/1.5 var(--font-mono); }
        .pipeline { border-bottom: 1px solid var(--border); }
        .stage-list { border-top: 1px solid var(--border); }
        .stage { --stage-color: var(--drop-acid); display: grid; grid-template-columns: 5rem minmax(10rem, 0.65fr) minmax(17rem, 1.2fr) minmax(15rem, 1fr) 7rem; align-items: center; background: color-mix(in srgb, var(--stage-color) 7%, var(--background)); }
        .stage + .stage { border-top: 1px solid var(--border); }
        .stage > * { min-width: 0; padding: 1.1rem; }
        .stage > * + * { border-left: 1px solid var(--border); }
        .stage-02 { --stage-color: var(--drop-cyan); } .stage-03 { --stage-color: var(--drop-violet); } .stage-04 { --stage-color: var(--drop-coral); } .stage-05 { --stage-color: var(--drop-acid); }
        .stage-num { color: var(--stage-color); font-family: var(--font-serif); font-size: 2rem; text-align: center; }
        .stage span, .stage small { color: var(--stage-color); font: 700 0.5rem var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        .stage h3 { margin: 0.25rem 0 0; font-family: var(--font-serif); font-size: 1.4rem; font-weight: 400; }
        .stage p { margin: 0; color: var(--muted-foreground); font-size: 0.72rem; line-height: 1.5; }
        .stage > strong { font-size: 0.68rem; line-height: 1.45; }
        .stage > small { text-align: center; }
        .models { background: var(--drop-paper); color: var(--drop-ink); }
        .models .section-title p { color: var(--drop-violet); }
        .section-copy { max-width: 64rem; margin: -2rem 0 2.5rem 7.5rem; font-size: 0.9rem; line-height: 1.65; }
        .noun-ledger { border: 1px solid var(--drop-ink); }
        .noun-head, .noun-row { display: grid; grid-template-columns: 5rem 7.5rem minmax(18rem, 1.3fr) minmax(11rem, 0.7fr) minmax(16rem, 1fr); }
        .noun-head { background: var(--drop-ink); color: var(--drop-paper); font: 700 0.5rem var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
        .noun-head > *, .noun-row > * { min-width: 0; padding: 0.8rem; }
        .noun-row + .noun-row { border-top: 1px solid var(--drop-ink); }
        .noun-row > * + * { border-left: 1px solid var(--drop-ink); }
        .noun-row > strong { color: var(--drop-violet); font-family: var(--font-serif); font-size: 1.25rem; font-weight: 400; }
        .noun-row > b { align-self: stretch; display: grid; align-items: center; font: 700 0.52rem var(--font-mono); }
        .noun-row div span { color: var(--drop-violet); font-size: 0.5rem; font-weight: 700; }
        .noun-row p, .noun-row small { margin: 0.35rem 0 0; font-size: 0.62rem; line-height: 1.5; }
        .noun-row > p, .noun-row > small { margin: 0; }
        .concept-list { --concept-accent: var(--drop-ink); display: flex; flex-wrap: wrap; gap: 0.42rem; margin-top: 0.7rem; }
        .concept-tile { box-sizing: border-box; width: 4.5rem; min-height: 4.5rem; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 0.35rem; padding: 0.42rem; border: 1px solid var(--concept-accent); background: var(--drop-paper); color: var(--drop-ink); }
        .concept-tile > strong { align-self: start; color: inherit; font-family: var(--font-serif); font-size: 1.55rem; font-weight: 400; letter-spacing: -0.04em; line-height: 1; text-transform: none; }
        .concept-tile > small { align-self: end; margin: 0; border: 0; padding: 0; color: inherit; font: 700 0.43rem/1.18 var(--font-mono); letter-spacing: 0.02em; text-transform: none; }
        .tone-compose .concept-tile { --concept-accent: var(--drop-acid); background: var(--drop-acid); }
        .tone-build .concept-tile { --concept-accent: var(--drop-violet); background: var(--drop-violet); color: var(--drop-paper); }
        .tone-reuse .concept-tile { --concept-accent: var(--drop-ink); background: transparent; }
        .tone-verify .concept-tile { --concept-accent: var(--drop-cyan); box-shadow: inset 0 0.25rem var(--drop-cyan); }
        .tone-discover .concept-tile { --concept-accent: var(--drop-coral); box-shadow: inset 0 0.25rem var(--drop-coral); }
        .tone-avoid .concept-tile { --concept-accent: var(--muted-foreground); opacity: 0.58; }
        .tone-avoid .concept-tile > small { text-decoration: line-through; }
        .subsection-title { margin: 2.5rem 0 1rem; font-family: var(--font-serif); font-size: 1.8rem; font-weight: 400; }
        .model-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--drop-ink); border-left: 1px solid var(--drop-ink); }
        .model-grid article { display: grid; grid-template-columns: 5rem minmax(0, 1fr); border-right: 1px solid var(--drop-ink); border-bottom: 1px solid var(--drop-ink); }
        .model-grid article:last-child { grid-column: 1 / -1; }
        .model-code { display: grid; place-items: center; border-right: 1px solid var(--drop-ink); color: var(--drop-violet); font-family: var(--font-serif); font-size: 2.2rem; }
        .model-grid article > div:last-child { display: grid; gap: 0.6rem; padding: 1.2rem; }
        .model-grid span { color: var(--drop-violet); font-size: 0.5rem; font-weight: 700; }
        .model-grid h3 { margin: 0; font-family: var(--font-serif); font-size: 1.55rem; font-weight: 400; }
        .model-grid p { margin: 0; font-size: 0.73rem; line-height: 1.5; }
        .model-grid small { font: 500 0.56rem/1.5 var(--font-mono); }
        .reuse-strip { display: grid; grid-template-columns: 12rem minmax(0, 1fr); gap: 1rem; margin-top: 1.5rem; border-top: 0.4rem solid var(--drop-violet); padding-top: 1rem; }
        .reuse-strip span { color: var(--drop-violet); font-size: 0.53rem; font-weight: 700; }
        .reuse-strip strong { font-family: var(--font-serif); font-size: 1.15rem; font-weight: 400; line-height: 1.5; }
        .commands { background: var(--card); }
        .verb-layer-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .verb-layer-grid article { display: grid; grid-template-rows: auto auto auto auto minmax(0, 1fr); gap: 0.8rem; min-width: 0; padding: 1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .verb-layer-grid article > div { display: grid; gap: 0.35rem; }
        .verb-layer-grid span { color: var(--drop-cyan); font-size: 0.48rem; font-weight: 700; }
        .verb-layer-grid strong { font: 600 0.55rem var(--font-mono); }
        .verb-layer-grid .concept-list { display: flex; gap: 0.35rem; margin-top: 0; }
        .verb-layer-grid .concept-tile { width: 4rem; min-height: 4rem; background: var(--background); color: var(--foreground); }
        .verb-layer-grid .concept-tile > strong { color: inherit; font-family: var(--font-serif); font-size: 1.35rem; font-weight: 400; }
        .verb-layer-grid .concept-tile > small { color: inherit; font: 700 0.39rem/1.15 var(--font-mono); }
        .verb-layer-grid .tone-platform .concept-tile { --concept-accent: var(--drop-cyan); box-shadow: inset 0 0.22rem var(--drop-cyan); }
        .verb-layer-grid .tone-mechanical .concept-tile { --concept-accent: var(--drop-acid); box-shadow: inset 0 0.22rem var(--drop-acid); }
        .verb-layer-grid .tone-ai .concept-tile { --concept-accent: var(--drop-violet); background: var(--drop-violet); color: var(--drop-paper); }
        .verb-layer-grid .tone-human .concept-tile { --concept-accent: var(--drop-coral); box-shadow: inset 0 0.22rem var(--drop-coral); }
        .verb-layer-grid .tone-app .concept-tile { --concept-accent: var(--drop-paper); background: var(--drop-paper); color: var(--drop-ink); }
        .io-block { align-content: start; }
        .io-block > b, .run-record > b, .command-io > div > b { color: var(--drop-acid); font: 700 0.47rem var(--font-mono); letter-spacing: 0.08em; }
        .mini-concepts { display: flex; flex-wrap: wrap; gap: 0.3rem; }
        .mini-concept { box-sizing: border-box; min-width: 3.2rem; min-height: 2.85rem; display: grid; grid-template-rows: auto 1fr; gap: 0.18rem; padding: 0.3rem; border: 1px solid var(--border); background: var(--background); color: var(--foreground); }
        .mini-concept > strong { color: var(--drop-cyan); font: 400 0.92rem var(--font-serif); line-height: 1; text-transform: none; }
        .mini-concept > small { margin: 0; border: 0; padding: 0; color: var(--muted-foreground); font: 700 0.37rem/1.1 var(--font-mono); letter-spacing: 0.02em; text-transform: none; }
        .verb-layer-grid article > small { border-top: 1px solid var(--border); padding-top: 0.7rem; color: var(--muted-foreground); font-size: 0.58rem; line-height: 1.5; }
        .command-title { color: var(--foreground); }
        .command-list { border-top: 1px solid var(--border); }
        .command-list article { display: grid; grid-template-columns: 4rem minmax(28rem, 1.35fr) minmax(18rem, 0.85fr); align-items: center; border-bottom: 1px solid var(--border); }
        .command-list article > * { min-width: 0; padding: 1.1rem; }
        .command-list article > * + * { border-left: 1px solid var(--border); }
        .command-list > article > span { color: var(--drop-violet); font-family: var(--font-serif); font-size: 1.6rem; text-align: center; }
        .command-list h3 { margin: 0 0 0.35rem; font-family: var(--font-serif); font-size: 1.2rem; font-weight: 400; }
        .command-list b { color: var(--drop-acid); }
        .command-list small { color: var(--muted-foreground); font-size: 0.65rem; line-height: 1.5; }
        .command-io { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 0.65fr); gap: 0.6rem; align-items: center; }
        .command-io > div { display: grid; gap: 0.35rem; }
        .command-io > i { color: var(--drop-acid); font: normal 1.2rem var(--font-serif); }
        .run-record { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.55rem; align-items: start; margin-top: 0.65rem; border-top: 1px solid var(--border); padding-top: 0.65rem; }
        .command-list .mini-concept { background: var(--card); }
        .command-list .mini-concept > strong { color: var(--drop-cyan); font: 400 0.92rem var(--font-serif); }
        .command-list .mini-concept > small { margin: 0; border: 0; padding: 0; color: var(--muted-foreground); font: 700 0.37rem/1.1 var(--font-mono); }
        .collab { background: var(--drop-violet); color: var(--drop-paper); }
        .collab .section-title > span, .collab .section-title p { color: var(--drop-acid); }
        .role-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--drop-paper); border-left: 1px solid var(--drop-paper); }
        .role-grid article { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 1rem; min-height: 11rem; padding: 1.2rem; border-right: 1px solid var(--drop-paper); border-bottom: 1px solid var(--drop-paper); }
        .role-grid span { color: var(--drop-acid); font-size: 0.53rem; font-weight: 700; }
        .role-grid p { margin: 0; opacity: 0.72; font-size: 0.7rem; }
        .role-grid strong { font-family: var(--font-serif); font-size: 1rem; font-weight: 400; line-height: 1.4; }
        .audit-line { display: flex; flex-wrap: wrap; gap: 0.7rem; align-items: center; margin-top: 2rem; font: 700 0.52rem var(--font-mono); letter-spacing: 0.08em; }
        .audit-line span { padding: 0.55rem 0.7rem; background: var(--drop-paper); color: var(--drop-ink); }
        .audit-line b { color: var(--drop-acid); }
        .surfaces { background: var(--background); }
        .surface-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .surface-grid article { min-height: 10rem; padding: 1.2rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .surface-grid span { color: var(--drop-cyan); font-size: 0.52rem; font-weight: 700; }
        .surface-grid h3 { margin: 1rem 0 0.6rem; font-family: var(--font-serif); font-size: 1.25rem; font-weight: 400; }
        .surface-grid p { margin: 0; color: var(--muted-foreground); font-size: 0.68rem; line-height: 1.5; }
        .acceptance { background: var(--drop-paper); color: var(--drop-ink); }
        .acceptance .section-title p { color: var(--drop-coral); }
        .acceptance-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--drop-ink); border-left: 1px solid var(--drop-ink); }
        .acceptance-grid article { display: grid; gap: 0.8rem; min-height: 9rem; padding: 1.3rem; border-right: 1px solid var(--drop-ink); border-bottom: 1px solid var(--drop-ink); }
        .acceptance-grid span { color: var(--drop-coral); font-size: 0.52rem; font-weight: 700; }
        .acceptance-grid strong { font-family: var(--font-serif); font-size: 1rem; font-weight: 400; line-height: 1.45; }
        .scoreline { display: grid; grid-template-columns: 10rem minmax(0, 1fr); gap: 1rem; margin-top: 1.5rem; border-top: 0.4rem solid var(--drop-coral); padding-top: 1rem; }
        .scoreline span { color: var(--drop-coral); font-size: 0.53rem; font-weight: 700; }
        .scoreline strong { font-family: var(--font-serif); font-size: 1.2rem; font-weight: 400; }
        .endmark { display: flex; justify-content: space-between; gap: 2rem; padding: 1.2rem clamp(1.2rem, 4vw, 4rem); background: var(--drop-acid); color: var(--drop-ink); font-size: 0.58rem; }
        @media (max-width: 72rem) { .noun-head, .noun-row { grid-template-columns: 4rem 6rem minmax(15rem, 1fr) minmax(12rem, 0.8fr); } .noun-head > :last-child, .noun-row > :last-child { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--drop-ink); } .verb-layer-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 64rem) { .hero-grid { grid-template-columns: 1fr; } .hero-title { border-right: 0; border-bottom: 1px solid var(--drop-ink); } .hero-art { min-height: 26rem; } .thesis { grid-template-columns: 0.25fr minmax(0, 1fr); } .rule-card { grid-column: 2; } .intake-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .stage { grid-template-columns: 4rem minmax(10rem, 0.7fr) minmax(0, 1fr); } .stage > strong, .stage > small { grid-column: 2 / -1; border-top: 1px solid var(--border); } .command-list article { grid-template-columns: 4rem minmax(0, 1fr); } .command-list > article > small { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } .role-grid, .surface-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 42rem) { .hero-top, .endmark { flex-direction: column; } .hero-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .hero-stats span:nth-child(odd) { border-left: 0; } .hero-stats span:nth-child(n + 3) { border-top: 1px solid var(--drop-ink); } .thesis, .section-title { grid-template-columns: 1fr; } .rule-card { grid-column: auto; } .intake-grid, .model-grid, .verb-layer-grid, .role-grid, .surface-grid, .acceptance-grid { grid-template-columns: 1fr; } .model-grid article:last-child { grid-column: auto; } .section-copy { margin: -1rem 0 2rem; } .noun-head { display: none; } .noun-row { grid-template-columns: 4rem minmax(0, 1fr); } .noun-row > div, .noun-row > small, .noun-row > p { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--drop-ink); } .noun-row > :last-child { grid-column: 1 / -1; } .stage { grid-template-columns: 4rem minmax(0, 1fr); } .stage > p, .stage > strong, .stage > small { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } .command-list article { grid-template-columns: 3.5rem minmax(0, 1fr); } .command-io { grid-template-columns: 1fr; } .command-io > i { transform: rotate(90deg); } .run-record { grid-template-columns: 1fr; } .reuse-strip, .scoreline { grid-template-columns: 1fr; } }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof DropLabProposal> { // ¹¹ Embedded behaves like a compact release brief
    <template>
      <article class='embedded'><span>{{@model.label}}</span><div><p>SOFTWARE FACTORY PROPOSAL</p><h2>{{@model.title}}</h2><small>{{@model.subtitle}}</small></div><strong>{{@model.dropName}}</strong><footer><span>7 APP NOUNS</span><span>8 COMMANDS</span><span>6 ROLES</span></footer></article> {{! ²⁷ Corrected noun/verb counts }}
      <style scoped>
        .embedded { display: grid; grid-template-columns: 0.35fr minmax(0, 1fr) 0.5fr; min-width: 0; background: var(--drop-paper); color: var(--drop-ink); font-family: var(--font-sans); }
        .embedded > * { min-width: 0; padding: 1rem; }
        .embedded > * + * { border-left: 1px solid var(--drop-ink); }
        .embedded > span, p, footer { font: 700 0.52rem var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        .embedded > span { color: var(--drop-violet); }
        p { margin: 0; color: var(--drop-violet); }
        h2 { margin: 0.4rem 0; font-family: var(--font-serif); font-size: 2rem; font-weight: 400; letter-spacing: -0.04em; }
        small { color: var(--muted-foreground); line-height: 1.4; }
        .embedded > strong { align-self: stretch; display: grid; place-items: center; background: var(--drop-violet); color: var(--drop-paper); font-family: var(--font-serif); font-size: 1.4rem; font-weight: 400; text-align: center; }
        footer { grid-column: 1 / -1; display: flex; gap: 1.2rem; border-top: 1px solid var(--drop-ink); border-left: 0; background: var(--drop-acid); }
        @media (max-width: 36rem) { .embedded { grid-template-columns: 1fr; } .embedded > * + * { border-left: 0; border-top: 1px solid var(--drop-ink); } footer { grid-column: auto; flex-wrap: wrap; } }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof DropLabProposal> { // ¹² CQ release tile preserves the poster identity at small sizes
    <template>
      <article class='fit'><div class='fit-top'><span>{{@model.label}}</span><strong>DL</strong></div><div class='fit-disc'><i></i></div><div class='fit-copy'><p>FACTORY RUN 02</p><h2>{{@model.title}}</h2><small>{{@model.dropName}}</small></div><div class='fit-bottom'><span>7 APP NOUNS</span><span>8 COMMANDS</span><span>6 ROLES</span></div></article> {{! ²⁸ Corrected fitted scope }}
      <style scoped>
        .fit { --ratio: 1.28; --delta: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb)); --base: clamp(9px, calc(4px + 2cqi + 0.8cqb - 0.4 * var(--delta)), 18px); --label: max(7px, calc(var(--base) / pow(var(--ratio), 1.6))); --body: max(9px, calc(var(--base) / var(--ratio))); --title: max(13px, calc(var(--base) * pow(var(--ratio), 1.7))); position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; gap: clamp(4px, 1.5cqi, 12px); padding: clamp(7px, 3.5cqi, 20px); overflow: hidden; background: var(--drop-violet); color: var(--drop-paper); font-family: var(--font-sans); }
        .fit-top, .fit-copy, .fit-bottom { position: relative; z-index: 2; min-width: 0; min-height: 0; overflow: hidden; }
        .fit-top { display: flex; justify-content: space-between; gap: 0.5rem; color: var(--drop-acid); font: 700 var(--label) var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        .fit-top strong { font-size: var(--body); }
        .fit-disc { position: absolute; z-index: 1; width: min(55cqi, 55cqb); aspect-ratio: 1; right: -8%; top: 9%; border-radius: 50%; background: var(--drop-ink); }
        .fit-disc::before { content: ''; position: absolute; inset: 22%; border: 1px solid var(--drop-paper); border-radius: 50%; opacity: 0.45; }
        .fit-disc i { position: absolute; inset: 40%; border-radius: 50%; background: var(--drop-coral); }
        .fit-copy { align-self: end; display: grid; gap: clamp(2px, 0.8cqb, 7px); max-width: 78%; }
        .fit-copy p { margin: 0; color: var(--drop-acid); font: 700 var(--label) var(--font-mono); letter-spacing: 0.1em; }
        .fit-copy h2 { display: -webkit-box; margin: 0; overflow: hidden; font-family: var(--font-serif); font-size: var(--title); font-weight: 400; letter-spacing: -0.04em; line-height: 0.9; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
        .fit-copy small { overflow: hidden; font: 600 var(--label) var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
        .fit-bottom { display: flex; gap: clamp(5px, 2cqi, 14px); border-top: 1px solid var(--drop-paper); padding-top: clamp(3px, 1cqb, 8px); font: 700 var(--label) var(--font-mono); }
        @container fitted-card (height <= 80px) { .fit { grid-template-rows: minmax(0, 1fr); } .fit-top, .fit-disc, .fit-bottom, .fit-copy p, .fit-copy small { display: none; } .fit-copy { align-self: center; max-width: 100%; } .fit-copy h2 { -webkit-line-clamp: 2; } }
        @container fitted-card (80px < height <= 135px) { .fit { grid-template-rows: auto minmax(0, 1fr); } .fit-bottom, .fit-copy small { display: none; } }
        @container fitted-card (width <= 170px) { .fit-bottom span:nth-child(n + 2), .fit-copy small { display: none; } .fit-copy { max-width: 100%; } .fit-disc { opacity: 0.55; } }
      </style>
    </template>
  };
}
