// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { Component } from 'https://cardstack.com/base/card-api'; // ¹ Structured presentation reuses the complete DropLab schema
import {
  COMMANDS,
  DropLabProposal,
  INTAKE,
  MODELS,
  NOUN_LAYERS,
  ROLES,
  STAGES,
  SURFACES,
  VERB_LAYERS,
} from './droplab-proposal'; // ² Content remains single-sourced in the original proposal module
import PublicationNav from './components/publication-nav'; // ⁷ Standalone publication navigation

export class StructuredDropLabProposal extends DropLabProposal { // ³ Vendor Readiness structure with DropLab content
  static displayName = 'Structured DropLab Factory Proposal';

  static isolated = class Isolated extends Component<typeof StructuredDropLabProposal> { // ⁴ A restrained brief replaces the poster-like long page
    intake = INTAKE;
    stages = STAGES;
    models = MODELS;
    nounLayers = NOUN_LAYERS;
    verbLayers = VERB_LAYERS;
    commands = COMMANDS;
    roles = ROLES;
    surfaces = SURFACES;

    <template>
      <PublicationNav @active='droplab' /> {{! ⁸ Host route, deliberately not viewCard }}
      <article class='proposal'>
        <div class='hero'>
          <div class='hero-copy'>
            <p class='eyebrow'>{{@model.label}} · Factory Trial 02</p>
            <h1>{{@model.title}}</h1>
            <p class='dek'>{{@model.subtitle}}</p>
          </div>
          <div class='hero-brief'>
            <span>Proposed release</span>
            <strong>{{@model.dropName}}</strong>
            <p>One culturally current workflow where mixed media, AI interpretation, generation, human approval, and provenance must remain visibly distinct.</p>
          </div>
        </div>

        <section class='score-ribbon' aria-label='Experiment shape'>
          <div><strong>4</strong><span>input families</span></div>
          <div><strong>7</strong><span>owned models</span></div>
          <div><strong>25+</strong><span>reused contracts</span></div>
          <div><strong>8</strong><span>typed verbs</span></div>
          <div><strong>6</strong><span>human roles</span></div>
          <div><strong>1</strong><span>release package</span></div>
        </section>

        <section class='thesis section-pad'>
          <div class='section-label'><span>00</span><p>Experiment thesis</p></div>
          <div class='thesis-copy'>
            <h2>Build the release judgment. Reuse the substrate.</h2>
            <p>DropLab turns a chaotic shared folder into a credited, cleared, channel-ready release. The factory should spend its custom-build budget on release semantics and orchestration—not on rebuilding people, contracts, files, tasks, fields, extraction tools, or catalog presentation.</p>
          </div>
          <div class='hypothesis'>
            <span>Non-negotiable boundary</span>
            <p>Mechanical fact ≠ AI interpretation ≠ generated draft ≠ human approval. The schema, commands, interface, and audit history must preserve those four truth regimes.</p>
          </div>
        </section>

        <section class='truth-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>01</span><p>Evidence → release</p></div>
            <div><h2>Start with the mess. End with a governed package.</h2><p>Four input families move through five explicit regimes. Every output retains its source, method, policy, and accountable actor.</p></div>
          </div>
          <div class='intake-grid'>
            {{#each this.intake as |item|}}
              <article><span>{{item.format}}</span><h3>{{item.examples}}</h3><p>{{item.extraction}}</p><small>{{item.provenance}}</small></article>
            {{/each}}
          </div>
          <div class='stage-list'>
            {{#each this.stages as |stage|}}
              <article class='stage-row'>
                <strong>{{stage.number}}</strong>
                <div><span>{{stage.owner}}</span><h3>{{stage.name}}</h3></div>
                <p>{{stage.action}}</p>
                <div class='stage-output'><span>OUTPUT</span><strong>{{stage.output}}</strong></div>
                <small>{{stage.signal}}</small>
              </article>
            {{/each}}
          </div>
        </section>

        <section class='noun-section'>
          <div class='section-head section-pad'>
            <div class='section-label'><span>02</span><p>Noun architecture</p></div>
            <div><h2>Own seven nouns. Import the rest.</h2><p>Every reusable or buildable concept is boxed. Explanations remain prose, so implementation units cannot be mistaken for commentary.</p></div>
          </div>
          <div class='stack-table'>
            {{#each this.nounLayers as |group|}}
              <article class='stack-row'>
                <div class='stack-number'><strong>{{group.layer}}</strong><span>{{group.disposition}}</span></div>
                <div class='stack-title'><span>{{group.family}}</span><h3>{{group.source}}</h3></div>
                <div class='concept-list tone-{{group.tone}}'>
                  {{#each group.concepts as |concept|}}<span class='concept-tile'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}
                </div>
                <p class='stack-proof'>{{group.proof}}</p>
              </article>
            {{/each}}
          </div>
        </section>

        <section class='owned-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>03</span><p>Owned semantics</p></div>
            <div><h2>Seven local models carry the app’s distinction.</h2><p>These types own release-specific meaning. Their reusable dependencies remain linked, and graduation happens only after unrelated applications prove stable shared semantics.</p></div>
          </div>
          <div class='model-grid'>
            {{#each this.models as |model|}}
              <article class='model-card'>
                <div class='model-mark'><strong>{{model.code}}</strong><span>{{model.status}}</span></div>
                <h3>{{model.name}}</h3>
                <p>{{model.purpose}}</p>
                <dl><div><dt>Links</dt><dd>{{model.links}}</dd></div></dl>
              </article>
            {{/each}}
          </div>
          <div class='graduation-rule'><strong>GRADUATION RULE</strong><p>An app noun moves into a domain kit only after three unrelated applications reuse the same semantics without DropLab-specific fields.</p></div>
        </section>

        <section class='verb-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>04</span><p>Verb architecture</p></div>
            <div><h2>Not every verb is an app command.</h2><p>Platform operations, deterministic tools, AI capabilities, human decisions, and DropLab commands have different owners and authority boundaries.</p></div>
          </div>
          <div class='verb-table'>
            {{#each this.verbLayers as |group|}}
              <article class='verb-row'>
                <div class='verb-owner'><span>{{group.family}}</span><strong>{{group.owner}}</strong></div>
                <div class='concept-list tone-{{group.tone}}'>{{#each group.concepts as |concept|}}<span class='concept-tile'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div>
                <div class='verb-io'>
                  <div><b>IN</b><div class='mini-concepts'>{{#each group.inputs as |concept|}}<span class='mini-concept'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div>
                  <div><b>OUT</b><div class='mini-concepts'>{{#each group.outputs as |concept|}}<span class='mini-concept'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div>
                </div>
                <p>{{group.implementation}}</p>
              </article>
            {{/each}}
          </div>

          <h3 class='subsection-title'>The eight DropLab commands</h3>
          <div class='command-flow'>
            {{#each this.commands as |command|}}
              <article class='command-card'>
                <div class='command-index'>{{command.number}}</div>
                <div class='command-name'><span>COMMAND</span><h3>{{command.name}}</h3><p>{{command.rule}}</p></div>
                <div class='command-io'>
                  <div><span>IN</span><div class='mini-concepts'>{{#each command.inputs as |concept|}}<span class='mini-concept'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div>
                  <b>→</b>
                  <div><span>OUT</span><div class='mini-concepts'>{{#each command.outputs as |concept|}}<span class='mini-concept'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div>
                  <div class='run-record'><span>RUN RECORD</span><div class='mini-concepts'>{{#each command.records as |concept|}}<span class='mini-concept'><strong>{{concept.symbol}}</strong><small>{{concept.name}}</small></span>{{/each}}</div></div>
                </div>
              </article>
            {{/each}}
          </div>
        </section>

        <section class='role-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>05</span><p>Multi-user workflow</p></div>
            <div><h2>Different eyes. Explicit authority.</h2><p>AI may prepare and recommend. Named people with reusable roles make consequential decisions, state what they saw, and leave append-only rationale.</p></div>
          </div>
          <div class='role-grid'>
            {{#each this.roles as |person|}}
              <article><span>{{person.role}}</span><p>{{person.sees}}</p><strong>{{person.decides}}</strong></article>
            {{/each}}
          </div>
          <div class='audit-line'><span>SOURCE</span><b>→</b><span>EXTRACTION</span><b>→</b><span>MODEL + PROMPT</span><b>→</b><span>DRAFT</span><b>→</b><span>HUMAN EDIT</span><b>→</b><span>APPROVAL</span><b>→</b><span>RECEIPT</span></div>
        </section>

        <section class='component-section section-pad'>
          <div class='section-head'>
            <div class='section-label'><span>06</span><p>Component discovery</p></div>
            <div><h2>Search → preview → select → import.</h2><p>A surface is reusable only when the real catalog module loads, accepts the required typed cards, and works in the target composition.</p></div>
          </div>
          <div class='component-grid'>
            {{#each this.surfaces as |surface|}}
              <article><div><span>{{surface.surface}}</span><strong>{{surface.component}}</strong></div><p>{{surface.proof}}</p></article>
            {{/each}}
          </div>
          <div class='no-rebuild-rule'><strong>NO-REBUILD RULE</strong><p>Author a replacement only after catalog search, preview, and compatibility evidence show that no candidate meets the need. “Faster to code it” is not an accepted reason.</p></div>
        </section>

        <section class='acceptance section-pad'>
          <div class='section-label'><span>07</span><p>Final product</p></div>
          <div class='acceptance-main'>
            <h2>The output is a working release studio and its evidence packet.</h2>
            <div class='acceptance-grid'>
              <div><span>LIVE DROP</span><strong>Intake deck, asset wall, rights map, variant studio, release board, provenance feed, and package view.</strong></div>
              <div><span>THREE SCENARIOS</span><strong>Clear release publishes; uncleared sample blocks; generated caption is edited and approved with lineage intact.</strong></div>
              <div><span>REUSE MANIFEST</span><strong>Listing, CodeRef, version, preview evidence, compatibility decision, and upgrade boundary for every imported artifact.</strong></div>
              <div><span>RUN RECORD</span><strong>Actual discovery time, build time, tokens, modules reused, local code, rework, defects, and maintenance estimate.</strong></div>
              <div><span>QUALITY PROOF</span><strong>Local and remote lint, module-load probes, indexed instances, command tests, render smoke, and PDF-ready handoff.</strong></div>
              <div><span>PASS TARGET</span><strong>≤ 8 hours · ≥ 55% module reuse · ≤ 65% greenfield tokens · 100% consequential AI outputs reviewable.</strong></div>
            </div>
          </div>
        </section>

        <div class='proposal-footer'><strong>Factory Trial 02 · DropLab</strong><span>Build the unique judgment. Sample the mature substrate.</span></div>
      </article>

      <style scoped>
        .proposal { min-width: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
        .hero { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(17rem, 0.55fr); gap: clamp(2rem, 6vw, 7rem); padding: clamp(2.5rem, 6vw, 6rem); background: var(--foreground); color: var(--background); }
        .hero-copy { min-width: 0; }
        .eyebrow, .section-label p, .hero-brief > span, .stack-number span, .stack-title > span, .intake-grid > article > span, .stage-row span, .model-mark span, .verb-owner span, .command-name > span, .command-io span, .role-grid span, .component-grid span, .acceptance-grid span, .proposal-footer { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.12em; }
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
        .section-label span { color: var(--primary); font-family: var(--font-serif); font-size: 2.5rem; line-height: 0.8; }
        .section-label p { margin: 0; color: var(--muted-foreground); font-size: 0.56rem; font-weight: 700; }
        .section-head { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem); margin-bottom: clamp(2rem, 4vw, 3.5rem); }
        .section-head h2, .thesis h2, .acceptance h2 { max-width: 17ch; margin: 0; font-family: var(--font-serif); font-size: clamp(2rem, 4.4vw, 4.5rem); font-weight: 400; letter-spacing: -0.045em; line-height: 0.98; }
        .section-head > div > p { max-width: 52rem; margin: 0.9rem 0 0; color: var(--muted-foreground); line-height: 1.55; }
        .thesis { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr) minmax(16rem, 0.42fr); gap: clamp(2rem, 5vw, 6rem); border-bottom: 1px solid var(--border); background: var(--card); }
        .thesis-copy p { max-width: 52rem; margin: 1.5rem 0 0; color: var(--muted-foreground); font-family: var(--font-serif); font-size: 1.05rem; line-height: 1.65; }
        .hypothesis { align-self: end; border-top: 0.28rem solid var(--primary); padding-top: 1rem; }
        .hypothesis span { color: var(--primary); font: 700 0.58rem var(--font-mono); letter-spacing: 0.12em; text-transform: uppercase; }
        .hypothesis p { margin: 0.7rem 0 0; font-size: 0.82rem; line-height: 1.6; }
        .truth-section, .owned-section, .role-section, .component-section { background: var(--card); }
        .intake-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .intake-grid article { min-width: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 0.9rem; padding: 1.1rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .intake-grid article > span { color: var(--family-intelligence); font-size: 0.5rem; font-weight: 700; }
        .intake-grid h3 { margin: 0; font-family: var(--font-serif); font-size: 1.05rem; font-weight: 500; line-height: 1.25; }
        .intake-grid p { margin: 0; color: var(--muted-foreground); font-size: 0.66rem; line-height: 1.5; }
        .intake-grid small { border-top: 1px solid var(--border); padding-top: 0.7rem; font-size: 0.58rem; line-height: 1.45; }
        .stage-list { display: grid; margin-top: 1.5rem; border-top: 1px solid var(--border); }
        .stage-row { display: grid; grid-template-columns: 4rem minmax(10rem, 0.65fr) minmax(16rem, 1.1fr) minmax(15rem, 0.9fr) 6rem; align-items: center; border-bottom: 1px solid var(--border); }
        .stage-row > * { min-width: 0; padding: 0.9rem 1rem; }
        .stage-row > * + * { border-left: 1px solid var(--border); }
        .stage-row > strong { color: var(--family-intelligence); font-family: var(--font-serif); font-size: 1.5rem; font-weight: 400; text-align: center; }
        .stage-row span { color: var(--family-intelligence); font-size: 0.48rem; font-weight: 700; }
        .stage-row h3 { margin: 0.25rem 0 0; font-family: var(--font-serif); font-size: 1rem; font-weight: 500; }
        .stage-row > p { margin: 0; color: var(--muted-foreground); font-size: 0.67rem; line-height: 1.45; }
        .stage-output { display: grid; gap: 0.35rem; }
        .stage-output strong { font-size: 0.64rem; line-height: 1.4; }
        .stage-row > small { color: var(--muted-foreground); font: 600 0.5rem var(--font-mono); text-transform: uppercase; text-align: center; }
        .noun-section { border-bottom: 1px solid var(--border); }
        .stack-table { border-top: 1px solid var(--border); }
        .stack-row { display: grid; grid-template-columns: minmax(8rem, 0.38fr) minmax(11rem, 0.58fr) minmax(22rem, 1.35fr) minmax(18rem, 1fr); border-bottom: 1px solid var(--border); }
        .stack-row > * { min-width: 0; padding: 1rem clamp(0.8rem, 1.6vw, 1.3rem); }
        .stack-row > * + * { border-left: 1px solid var(--border); }
        .stack-number { display: grid; gap: 0.45rem; align-content: start; border-left: 0.45rem solid var(--primary); }
        .stack-number strong { color: var(--primary); font-family: var(--font-serif); font-size: 1.7rem; font-weight: 400; }
        .stack-number span { font-size: 0.48rem; font-weight: 700; }
        .stack-title > span { color: var(--primary); font-size: 0.49rem; font-weight: 700; }
        .stack-title h3 { margin: 0.35rem 0 0; font-family: var(--font-serif); font-size: 1rem; font-weight: 500; }
        .stack-proof { margin: 0; color: var(--muted-foreground); font-size: 0.68rem; line-height: 1.5; }
        .concept-list { --concept-accent: var(--family-bsl); display: flex; flex-wrap: wrap; gap: 0.36rem; align-content: start; }
        .concept-tile { box-sizing: border-box; width: 4.15rem; min-height: 4.15rem; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 0.3rem; padding: 0.38rem; border: 1px solid var(--concept-accent); background: var(--card); color: var(--foreground); text-transform: none; }
        .concept-tile > strong { color: inherit; font-family: var(--font-serif); font-size: 1.35rem; font-weight: 400; letter-spacing: -0.04em; line-height: 1; text-transform: none; }
        .concept-tile > small { align-self: end; color: inherit; font: 700 0.4rem/1.15 var(--font-mono); text-transform: none; }
        .tone-compose { --concept-accent: var(--family-intelligence); } .tone-build { --concept-accent: var(--family-actions); } .tone-reuse { --concept-accent: var(--family-bsl); } .tone-verify { --concept-accent: var(--family-rules); } .tone-discover { --concept-accent: var(--family-objects); } .tone-avoid { --concept-accent: var(--muted-foreground); opacity: 0.58; }
        .tone-build .concept-tile, .tone-ai .concept-tile { background: var(--family-actions); color: var(--background); }
        .tone-compose .concept-tile, .tone-platform .concept-tile { box-shadow: inset 0 0.2rem var(--family-intelligence); }
        .tone-verify .concept-tile, .tone-mechanical .concept-tile { box-shadow: inset 0 0.2rem var(--family-rules); }
        .tone-discover .concept-tile, .tone-human .concept-tile { box-shadow: inset 0 0.2rem var(--family-objects); }
        .tone-app .concept-tile { background: var(--foreground); color: var(--background); }
        .owned-section { border-top: 1px solid var(--border); }
        .model-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .model-card { min-width: 0; padding: clamp(1.3rem, 3vw, 2.2rem); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .model-card:last-child { grid-column: 1 / -1; }
        .model-mark { display: flex; justify-content: space-between; gap: 1rem; }
        .model-mark strong { color: var(--family-actions); font-family: var(--font-serif); font-size: 1.6rem; font-weight: 400; }
        .model-mark span { color: var(--family-actions); font-size: 0.5rem; font-weight: 700; }
        .model-card h3 { margin: 0.8rem 0 0.6rem; font-family: var(--font-serif); font-size: clamp(1.4rem, 2.2vw, 2rem); font-weight: 500; }
        .model-card > p { margin: 0; color: var(--muted-foreground); line-height: 1.6; }
        .model-card dl { margin: 1.2rem 0 0; }
        .model-card dl > div { display: grid; grid-template-columns: 5rem minmax(0, 1fr); gap: 1rem; border-top: 1px solid var(--border); padding-top: 0.7rem; }
        .model-card dt { color: var(--muted-foreground); font: 600 0.52rem var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
        .model-card dd { margin: 0; font-size: 0.68rem; line-height: 1.5; }
        .graduation-rule, .no-rebuild-rule { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 1rem; margin-top: 1.5rem; border-top: 0.3rem solid var(--primary); padding-top: 1rem; }
        .graduation-rule strong, .no-rebuild-rule strong { color: var(--primary); font: 700 0.56rem var(--font-mono); letter-spacing: 0.1em; }
        .graduation-rule p, .no-rebuild-rule p { max-width: 65rem; margin: 0; font-size: 0.72rem; line-height: 1.5; }
        .verb-section { border-top: 1px solid var(--border); }
        .verb-table { border-top: 1px solid var(--border); }
        .verb-row { display: grid; grid-template-columns: minmax(10rem, 0.55fr) minmax(19rem, 1.15fr) minmax(18rem, 1fr) minmax(16rem, 0.9fr); border-bottom: 1px solid var(--border); }
        .verb-row > * { min-width: 0; padding: 1rem; }
        .verb-row > * + * { border-left: 1px solid var(--border); }
        .verb-owner { display: grid; align-content: start; gap: 0.4rem; }
        .verb-owner span { color: var(--primary); font-size: 0.49rem; font-weight: 700; }
        .verb-owner strong { font-family: var(--font-serif); font-size: 1rem; font-weight: 500; }
        .verb-io { display: grid; gap: 0.8rem; }
        .verb-io > div { display: grid; gap: 0.35rem; }
        .verb-io b { color: var(--primary); font: 700 0.47rem var(--font-mono); letter-spacing: 0.08em; }
        .verb-row > p { margin: 0; color: var(--muted-foreground); font-size: 0.66rem; line-height: 1.5; }
        .mini-concepts { display: flex; flex-wrap: wrap; gap: 0.28rem; }
        .mini-concept { box-sizing: border-box; min-width: 3.1rem; min-height: 2.75rem; display: grid; grid-template-rows: auto 1fr; gap: 0.15rem; padding: 0.28rem; border: 1px solid var(--border); background: var(--card); text-transform: none; }
        .mini-concept > strong { color: var(--family-actions); font: 400 0.9rem var(--font-serif); line-height: 1; text-transform: none; }
        .mini-concept > small { color: var(--muted-foreground); font: 700 0.36rem/1.1 var(--font-mono); text-transform: none; }
        .subsection-title { margin: 2.5rem 0 1rem; font-family: var(--font-serif); font-size: 1.8rem; font-weight: 400; }
        .command-flow { display: grid; border-top: 1px solid var(--border); }
        .command-card { display: grid; grid-template-columns: 4.5rem minmax(15rem, 0.75fr) minmax(26rem, 1.25fr); border-bottom: 1px solid var(--border); background: var(--card); }
        .command-card > * { min-width: 0; padding: 1.1rem; }
        .command-card > * + * { border-left: 1px solid var(--border); }
        .command-index { display: grid; place-items: center; color: var(--family-actions); font-family: var(--font-serif); font-size: 1.7rem; }
        .command-name > span, .command-io span { color: var(--family-actions); font-size: 0.49rem; font-weight: 700; }
        .command-name h3 { margin: 0.3rem 0; font-family: var(--font-serif); font-size: 1.15rem; font-weight: 500; }
        .command-name p { margin: 0; color: var(--muted-foreground); font-size: 0.65rem; line-height: 1.45; }
        .command-io { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 0.75fr); gap: 0.7rem; align-items: center; }
        .command-io > div { display: grid; gap: 0.35rem; }
        .command-io > b { color: var(--family-actions); font-size: 1.25rem; }
        .run-record { grid-column: 1 / -1; border-top: 1px solid var(--border); padding-top: 0.65rem; }
        .role-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .role-grid article { min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 1rem; min-height: 10rem; padding: 1.2rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .role-grid span { color: var(--family-actions); font-size: 0.51rem; font-weight: 700; }
        .role-grid p { margin: 0; color: var(--muted-foreground); font-size: 0.68rem; }
        .role-grid strong { font-family: var(--font-serif); font-size: 1rem; font-weight: 500; line-height: 1.4; }
        .audit-line { display: flex; flex-wrap: wrap; gap: 0.55rem; align-items: center; margin-top: 1.5rem; font: 700 0.5rem var(--font-mono); letter-spacing: 0.07em; }
        .audit-line span { border: 1px solid var(--border); padding: 0.5rem 0.65rem; background: var(--background); }
        .audit-line b { color: var(--primary); }
        .component-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .component-grid article { min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 1rem; min-height: 9rem; padding: 1.2rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .component-grid article > div { display: grid; gap: 0.3rem; }
        .component-grid span { color: var(--family-objects); font-size: 0.5rem; font-weight: 700; }
        .component-grid strong { font-family: var(--font-serif); font-size: 1.15rem; font-weight: 500; }
        .component-grid p { margin: 0; color: var(--muted-foreground); font-size: 0.64rem; line-height: 1.5; }
        .acceptance { display: grid; grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem); border-top: 1px solid var(--border); }
        .acceptance-main h2 { max-width: 19ch; }
        .acceptance-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 2.5rem; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .acceptance-grid > div { display: grid; gap: 0.7rem; min-height: 8rem; padding: 1.2rem; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .acceptance-grid span { color: var(--primary); font-size: 0.5rem; font-weight: 700; }
        .acceptance-grid strong { font-family: var(--font-serif); font-size: 0.9rem; font-weight: 500; line-height: 1.5; }
        .proposal-footer { display: flex; justify-content: space-between; gap: 2rem; padding: 1.3rem clamp(1rem, 3vw, 2.5rem); background: var(--foreground); color: var(--muted); font-size: 0.56rem; line-height: 1.5; }
        .proposal-footer strong { color: var(--primary); }
        @media (max-width: 72rem) { .stack-row { grid-template-columns: 7rem minmax(10rem, 0.45fr) minmax(0, 1fr); } .stack-proof { grid-column: 2 / -1; border-left: 1px solid var(--border); border-top: 1px solid var(--border); } .verb-row { grid-template-columns: minmax(10rem, 0.5fr) minmax(0, 1fr); } .verb-io, .verb-row > p { border-top: 1px solid var(--border); } }
        @media (max-width: 56rem) { .hero, .thesis, .section-head, .acceptance { grid-template-columns: 1fr; } .score-ribbon { grid-template-columns: repeat(3, minmax(0, 1fr)); } .score-ribbon > div:nth-child(4) { border-left: 0; border-top: 1px solid var(--border); } .score-ribbon > div:nth-child(5), .score-ribbon > div:nth-child(6) { border-top: 1px solid var(--border); } .intake-grid, .model-grid, .role-grid, .component-grid, .acceptance-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .model-card:last-child { grid-column: auto; } .stage-row { grid-template-columns: 4rem minmax(0, 1fr); } .stage-row > p, .stage-output, .stage-row > small { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } .command-card { grid-template-columns: 3.5rem minmax(0, 1fr); } .command-io { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } }
        @media (max-width: 40rem) { .score-ribbon { grid-template-columns: repeat(2, minmax(0, 1fr)); } .score-ribbon > div:nth-child(odd) { border-left: 0; } .score-ribbon > div:nth-child(n + 3) { border-top: 1px solid var(--border); } .intake-grid, .model-grid, .role-grid, .component-grid, .acceptance-grid { grid-template-columns: 1fr; } .stack-row { grid-template-columns: 5.5rem minmax(0, 1fr); } .stack-row > .concept-list, .stack-proof { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); } .verb-row { grid-template-columns: 1fr; } .verb-row > * + * { border-left: 0; border-top: 1px solid var(--border); } .command-io { grid-template-columns: 1fr; } .command-io > b { transform: rotate(90deg); justify-self: start; } .graduation-rule, .no-rebuild-rule { grid-template-columns: 1fr; } .proposal-footer { flex-direction: column; } }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof StructuredDropLabProposal> { // ⁵ Compact format inherits the restrained brief language
    <template>
      <article class='embedded'><span>{{@model.label}} · Factory Trial 02</span><h2>{{@model.title}}</h2><p>{{@model.subtitle}}</p><div><strong>7</strong><small>owned models</small><strong>8</strong><small>typed verbs</small><strong>6</strong><small>roles</small><strong>1</strong><small>package</small></div></article>
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

  static fitted = class Fitted extends Component<typeof StructuredDropLabProposal> { // ⁶ CQ trial ticket mirrors the Vendor Readiness format
    <template>
      <article class='fit'><div class='fit-header'><span>{{@model.label}}</span><strong>02</strong></div><div class='fit-body'><p>Software factory run</p><h2>{{@model.title}}</h2><small>{{@model.dropName}}</small></div><div class='fit-metrics'><span><strong>7</strong> owned</span><span><strong>8</strong> verbs</span><span><strong>6</strong> roles</span></div><div class='fit-footer'><span>Output</span><strong>Release Package</strong></div></article>
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
