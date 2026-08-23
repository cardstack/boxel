import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  pack,
  publishToStore,
  readStoreMeta,
  unpack,
} from '@cardstack/deck/node';
import { PgAdapter } from '@cardstack/postgres';
import { param, query } from '@cardstack/runtime-common';

import { insertSourceRealmInRegistry } from '../lib/realm-registry-writes.ts';

const environment = process.env.BOXEL_ENVIRONMENT ?? 'deck-a3';
const serverOrigin =
  process.env.RELAY_REALM_SERVER_ORIGIN ??
  `https://realm-server.${environment}.localhost`;
const realmsRoot = resolve(
  process.env.RELAY_REALMS_ROOT ?? `realms/${environment}`,
);

type FixtureRealm = {
  owner: string;
  endpoint: string;
  title: string;
  packageName: string;
  version: string;
  description: string;
  exports: string;
  dependencies?: Record<string, string>;
  lock?: Record<string, string>;
  files: Record<string, string>;
};

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function workspaceCard(): string {
  return json({
    data: {
      type: 'card',
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/workspace',
          name: 'Workspace',
        },
      },
    },
  });
}

function realmConfig(title: string, monogram: string, backgroundURL: string) {
  return json({
    data: {
      type: 'card',
      attributes: {
        cardInfo: { name: title },
        iconURL: `https://boxel-images.boxel.ai/icons/Letter-${monogram.toLowerCase()}.png`,
        backgroundURL,
      },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/realm-config',
          name: 'RealmConfig',
        },
      },
    },
  });
}

function packageDocuments(realm: FixtureRealm) {
  return {
    'package.json': json({
      name: realm.packageName,
      version: realm.version,
      description: realm.description,
      type: 'module',
      exports: realm.exports,
      dependencies: realm.dependencies ?? {},
    }),
    'importmap.json': json({
      imports: realm.lock ?? {},
      scopes: {},
    }),
  };
}

const reliabilityIncident = `
import { CardDef, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class Incident extends CardDef {
  static displayName = 'Service Incident';

  @field incidentId = contains(StringField);
  @field route = contains(StringField);
  @field severity = contains(StringField);
  @field openedAt = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Incident) {
      return this.incidentId + ' · ' + this.route;
    },
  });
}
`.trimStart();

const northstarTheme = `
export const relayTheme = Object.freeze({
  name: 'Northstar Night Signal',
  version: '2.2.2',
  ink: '#101a2d',
  panel: '#17243b',
  accent: '#65f4c2',
  warning: '#ffb35c',
  danger: '#ff6b6b',
  mist: '#edf4f6',
});
`.trimStart();

const northstarComponents = `
import { Component } from '@cardstack/base/card-api';

interface StatusPillSignature {
  Args: { label: string; tone?: string };
}

export class StatusPill extends Component<StatusPillSignature> {
  <template>
    <span class='status-pill {{@tone}}'><span class='dot'></span>{{@label}}</span>
    <style scoped>
      .status-pill { display: inline-flex; align-items: center; gap: .42rem; padding: .38rem .7rem; border: 1px solid rgb(255 255 255 / 18%); border-radius: 999px; background: rgb(255 255 255 / 8%); color: #f7fbff; font-size: .72rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
      .dot { width: .48rem; height: .48rem; border-radius: 50%; background: var(--relay-accent, #65f4c2); box-shadow: 0 0 0 .2rem rgb(101 244 194 / 14%); }
      .critical .dot { background: var(--relay-danger, #ff6b6b); box-shadow: 0 0 0 .2rem rgb(255 107 107 / 14%); }
    </style>
  </template>
}

interface MetricTileSignature {
  Args: { label: string; value: string; detail?: string };
}

export class MetricTile extends Component<MetricTileSignature> {
  <template>
    <section class='metric'>
      <div class='label'>{{@label}}</div>
      <strong>{{@value}}</strong>
      {{#if @detail}}<div class='detail'>{{@detail}}</div>{{/if}}
    </section>
    <style scoped>
      .metric { min-height: 6.2rem; padding: 1rem; border: 1px solid rgb(16 26 45 / 10%); border-radius: .9rem; background: rgb(255 255 255 / 88%); box-shadow: 0 .5rem 1.5rem rgb(16 26 45 / 7%); }
      .label { margin-bottom: .65rem; color: #6d7888; font-size: .68rem; font-weight: 760; letter-spacing: .1em; text-transform: uppercase; }
      strong { display: block; color: #101a2d; font-size: 1.15rem; line-height: 1.2; }
      .detail { margin-top: .35rem; color: #728090; font-size: .74rem; }
    </style>
  </template>
}

interface SourceChipSignature {
  Args: { party: string; package: string; version: string };
}

export class SourceChip extends Component<SourceChipSignature> {
  <template>
    <span class='source-chip'>
      <span class='party'>{{@party}}</span>
      <span class='package'>{{@package}}</span>
      <strong>{{@version}}</strong>
    </span>
    <style scoped>
      .source-chip { display: inline-grid; grid-template-columns: auto auto auto; align-items: center; gap: .4rem; padding: .42rem .6rem; border: 1px solid #dfe7e9; border-radius: .55rem; background: #fff; color: #3a4656; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .66rem; }
      .party { color: #718091; }
      .package { color: #17243b; }
      strong { padding: .12rem .3rem; border-radius: .3rem; background: #edf4f6; color: #334356; }
    </style>
  </template>
}
`.trimStart();

const countryCodes = `
const countries: Record<string, { name: string; region: string }> = {
  MY: { name: 'Malaysia', region: 'Southeast Asia' },
  JP: { name: 'Japan', region: 'East Asia' },
  SG: { name: 'Singapore', region: 'Southeast Asia' },
};

export function countryName(code: string): string {
  return countries[code]?.name ?? code;
}

export function countryRegion(code: string): string {
  return countries[code]?.region ?? 'Unknown region';
}
`.trimStart();

const industryCodes = `
const industries: Record<string, string> = {
  '481000': 'Air Transportation',
  '488510': 'Freight Transportation Arrangement',
  '541614': 'Process and Logistics Consulting',
};

export function industryName(code: string): string {
  return industries[code] ?? code;
}
`.trimStart();

const carrierCodes = `
const carriers: Record<string, { name: string; alliance: string }> = {
  MX: { name: 'Meridian Express', alliance: 'Independent' },
  NH: { name: 'North Harbor Air', alliance: 'Relay Network' },
  SL: { name: 'Straits Logistics', alliance: 'Relay Network' },
};

export function carrierName(code: string): string {
  return carriers[code]?.name ?? code;
}

export function carrierAlliance(code: string): string {
  return carriers[code]?.alliance ?? 'Unclassified';
}
`.trimStart();

const routeMap = `
import { Component } from '@cardstack/base/card-api';

interface RouteMapSignature {
  Args: { origin: string; destination: string; status: string };
}

export class RouteMap extends Component<RouteMapSignature> {
  <template>
    <section class='route-map' aria-label='Recovery route'>
      <div class='map-grid'></div>
      <div class='route-line'></div>
      <div class='node origin'><span></span><strong>{{@origin}}</strong></div>
      <div class='node destination'><span></span><strong>{{@destination}}</strong></div>
      <div class='reroute'>KUL <span>→</span> SIN <span>→</span> NRT</div>
      <div class='status'>{{@status}}</div>
    </section>
    <style scoped>
      .route-map { position: relative; min-height: 11rem; overflow: hidden; border: 1px solid rgb(101 244 194 / 20%); border-radius: 1rem; background: radial-gradient(circle at 74% 30%, rgb(101 244 194 / 15%), transparent 30%), #111d31; color: #fff; }
      .map-grid { position: absolute; inset: 0; opacity: .2; background-image: linear-gradient(rgb(255 255 255 / 12%) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 12%) 1px, transparent 1px); background-size: 2rem 2rem; transform: perspective(18rem) rotateX(58deg) scale(1.4); }
      .route-line { position: absolute; top: 51%; left: 18%; width: 63%; border-top: 2px dashed #65f4c2; transform: rotate(-8deg); transform-origin: left; }
      .node { position: absolute; z-index: 2; display: grid; justify-items: center; gap: .35rem; font-size: .72rem; letter-spacing: .08em; }
      .node span { width: .9rem; height: .9rem; border: .2rem solid #65f4c2; border-radius: 50%; background: #111d31; box-shadow: 0 0 0 .35rem rgb(101 244 194 / 12%); }
      .origin { left: 14%; top: 54%; } .destination { right: 14%; top: 31%; }
      .reroute { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); color: #bdcad8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .72rem; }
      .reroute span { color: #65f4c2; }
      .status { position: absolute; right: .8rem; bottom: .7rem; color: #7f92a7; font-size: .65rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    </style>
  </template>
}
`.trimStart();

const triageSkill = `
export const skillVersion = '1.3.1';
export const skillRRI = '@ops-skills/incident-triage@1.3.1/';

export function triageIncident(input: { severity: string; route: string }) {
  return {
    confidence: '94%',
    recommendation:
      input.severity === 'critical'
        ? 'Protect the NRT connection and transfer priority freight through SIN.'
        : 'Monitor the route and preserve the current recovery window.',
    rationale:
      'Weather exposure, connection risk, and service-level breach window.',
  };
}
`.trimStart();

const triageSkillMarkdown = `# Incident Triage\n\nAssess carrier disruptions against route exposure, service-level windows, country constraints, and available recovery capacity.\n\n## Output\n\nReturn a recommended recovery action, rationale, confidence, and the exact package versions consulted.\n`;

function relayCardSource() {
  return `
import { htmlSafe } from '@ember/template';
import { Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

import { Incident } from '@reliability/service-levels';
import { MetricTile, SourceChip, StatusPill } from '@northstar/operations-ui';
import { relayTheme } from '@northstar/operations-theme';
import { countryName, countryRegion } from '@global-standards/country-codes';
import { industryName } from '@industry-data/industry-codes';
import { carrierAlliance, carrierName } from '@transit/carrier-codes';
import { RouteMap } from '@atlas/route-map';
import { skillRRI, skillVersion, triageIncident } from '@ops-skills/incident-triage';

export class RelayIncident extends Incident {
  static displayName = 'Relay Incident';

  @field carrierCode = contains(StringField);
  @field originCountryCode = contains(StringField);
  @field destinationCountryCode = contains(StringField);
  @field industryCode = contains(StringField);
  @field owner = contains(StringField);
  @field recoveryStatus = contains(StringField);
  @field recoveryAction = contains(StringField);
  @field reviewBranch = contains(StringField);
  @field reviewNumber = contains(StringField);
  @field checkpoint = contains(StringField);
  @field triageSkill = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    get themeStyle() {
      return htmlSafe(
        '--relay-ink: ' + relayTheme.ink + ';' +
        '--relay-panel: ' + relayTheme.panel + ';' +
        '--relay-accent: ' + relayTheme.accent + ';' +
        '--relay-warning: ' + relayTheme.warning + ';' +
        '--relay-danger: ' + relayTheme.danger + ';' +
        '--relay-mist: ' + relayTheme.mist + ';'
      );
    }

    get carrier() { return carrierName(this.args.model.carrierCode); }
    get alliance() { return carrierAlliance(this.args.model.carrierCode); }
    get origin() { return countryName(this.args.model.originCountryCode); }
    get originRegion() { return countryRegion(this.args.model.originCountryCode); }
    get destination() { return countryName(this.args.model.destinationCountryCode); }
    get industry() { return industryName(this.args.model.industryCode); }
    get triage() {
      return triageIncident({
        severity: this.args.model.severity,
        route: this.args.model.route,
      });
    }
    get skillLabel() { return skillRRI; }
    get skillVersion() { return skillVersion; }
    get themeLabel() { return relayTheme.name + ' · ' + relayTheme.version; }

    <template>
      <article class='relay' style={{this.themeStyle}}>
        <header class='hero'>
          <div>
            <div class='product-mark'><span>R</span> Relay <small>global disruption desk</small></div>
            <div class='eyebrow'>Active disruption · {{@model.openedAt}}</div>
            <h1>{{@model.incidentId}}</h1>
            <p>{{this.carrier}} · {{@model.route}}</p>
          </div>
          <div class='hero-status'>
            <StatusPill @label={{@model.severity}} @tone='critical' />
            <StatusPill @label={{@model.recoveryStatus}} />
          </div>
        </header>

        <main>
          <section class='metrics'>
            <MetricTile @label='Carrier' @value={{this.carrier}} @detail={{this.alliance}} />
            <MetricTile @label='Origin' @value={{this.origin}} @detail={{this.originRegion}} />
            <MetricTile @label='Destination' @value={{this.destination}} @detail='Northeast Asia' />
            <MetricTile @label='Industry' @value={{this.industry}} @detail={{@model.industryCode}} />
          </section>

          <section class='work-grid'>
            <div class='route-panel'>
              <div class='section-heading'><div><span>01</span><h2>Recovery route</h2></div><strong>LIVE OPTIONS</strong></div>
              <RouteMap @origin={{@model.originCountryCode}} @destination={{@model.destinationCountryCode}} @status='Atlas route-map · 5.3.3' />
            </div>

            <aside class='triage-panel'>
              <div class='section-heading'><div><span>02</span><h2>Agent triage</h2></div><strong>{{this.triage.confidence}}</strong></div>
              <p class='recommendation'>{{this.triage.recommendation}}</p>
              <p class='rationale'>{{this.triage.rationale}}</p>
              <div class='skill'>
                <span>Versioned skill</span>
                <strong>{{this.skillLabel}}</strong>
              </div>
              <button type='button'>Apply recovery plan</button>
            </aside>
          </section>

          <section class='review-panel'>
            <div class='review-copy'>
              <div class='section-heading'><div><span>03</span><h2>Review #{{@model.reviewNumber}}</h2></div><strong>READY</strong></div>
              <h3>Protect NRT connection through SIN</h3>
              <p>{{@model.reviewBranch}} <span>→</span> main</p>
            </div>
            <div class='review-facts'>
              <div><span>Checkpoint</span><strong>{{@model.checkpoint}}</strong></div>
              <div><span>Owner</span><strong>{{@model.owner}}</strong></div>
              <div><span>Change</span><strong>7 packages · 18 cards</strong></div>
            </div>
            <button type='button' class='review-button'>Open exact Review</button>
          </section>

          <section class='packages'>
            <div class='package-heading'>
              <div><span>Exact composition</span><strong>@acme/relay@2.4.3</strong></div>
              <small>{{this.themeLabel}}</small>
            </div>
            <div class='package-list'>
              <SourceChip @party='Reliability Labs' @package='service-levels' @version='4.1.4' />
              <SourceChip @party='Northstar' @package='operations-ui' @version='3.4.2' />
              <SourceChip @party='Global Standards' @package='country-codes' @version='2026.8.1' />
              <SourceChip @party='Industry Data' @package='industry-codes' @version='4.2.1' />
              <SourceChip @party='Transit' @package='carrier-codes' @version='1.5.1' />
              <SourceChip @party='Atlas' @package='route-map' @version='5.3.3' />
              <SourceChip @party='Ops Skills' @package='incident-triage' @version={{this.skillVersion}} />
            </div>
          </section>
        </main>
      </article>

      <style scoped>
        .relay { min-height: 100%; overflow: hidden; border-radius: 1rem; background: var(--relay-mist); color: var(--relay-ink); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        .hero { display: flex; justify-content: space-between; gap: 2rem; padding: 2rem 2.25rem 2.2rem; background: radial-gradient(circle at 82% 14%, rgb(101 244 194 / 16%), transparent 30%), linear-gradient(135deg, var(--relay-ink), var(--relay-panel)); color: #fff; }
        .product-mark { display: flex; align-items: center; gap: .55rem; margin-bottom: 1.5rem; font-size: .95rem; font-weight: 800; letter-spacing: .04em; }
        .product-mark > span { display: grid; place-items: center; width: 1.7rem; height: 1.7rem; border: 1px solid rgb(101 244 194 / 45%); border-radius: .5rem; background: rgb(101 244 194 / 12%); color: var(--relay-accent); }
        .product-mark small { color: #8fa0b5; font-size: .66rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
        .eyebrow { color: var(--relay-accent); font-size: .68rem; font-weight: 760; letter-spacing: .13em; text-transform: uppercase; }
        h1 { margin: .45rem 0 .2rem; font-size: clamp(2rem, 5vw, 3.8rem); letter-spacing: -.05em; line-height: .95; }
        .hero p { margin: .65rem 0 0; color: #bbc8d7; font-size: 1rem; }
        .hero-status { display: flex; align-items: flex-start; gap: .55rem; flex-wrap: wrap; justify-content: flex-end; }
        main { display: grid; gap: 1.15rem; padding: 1.25rem; }
        .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; }
        .work-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(18rem, .75fr); gap: .9rem; }
        .route-panel, .triage-panel, .review-panel, .packages { border: 1px solid #dce6e8; border-radius: 1rem; background: #fff; box-shadow: 0 .6rem 2rem rgb(16 26 45 / 6%); }
        .route-panel, .triage-panel { padding: 1rem; }
        .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .85rem; }
        .section-heading > div { display: flex; align-items: center; gap: .5rem; }
        .section-heading span { color: #9aa7b4; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .66rem; }
        .section-heading h2 { margin: 0; font-size: .86rem; }
        .section-heading > strong { color: #4d6571; font-size: .62rem; letter-spacing: .1em; }
        .triage-panel { display: flex; flex-direction: column; background: var(--relay-ink); color: #fff; }
        .triage-panel .section-heading h2 { color: #fff; }
        .triage-panel .section-heading > strong { color: var(--relay-accent); }
        .recommendation { margin: .3rem 0 .65rem; font-size: 1.02rem; font-weight: 720; line-height: 1.42; }
        .rationale { margin: 0; color: #93a5b9; font-size: .73rem; line-height: 1.55; }
        .skill { display: grid; gap: .22rem; margin-top: auto; padding-top: 1.3rem; color: #8294a9; font-size: .62rem; }
        .skill strong { overflow: hidden; color: var(--relay-accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .66rem; text-overflow: ellipsis; white-space: nowrap; }
        .triage-panel button, .review-button { margin-top: .8rem; padding: .72rem .9rem; border: 0; border-radius: .65rem; background: var(--relay-accent); color: var(--relay-ink); font: inherit; font-size: .74rem; font-weight: 800; }
        .review-panel { display: grid; grid-template-columns: 1.2fr 1fr auto; align-items: center; gap: 1rem; padding: 1rem; }
        .review-copy .section-heading { justify-content: flex-start; margin-bottom: .45rem; }
        .review-copy h3 { margin: 0 0 .35rem; font-size: .95rem; }
        .review-copy p { margin: 0; color: #6f7d8d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .68rem; }
        .review-copy p span { color: #3aa783; }
        .review-facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: .55rem; }
        .review-facts div { display: grid; gap: .25rem; padding-left: .65rem; border-left: 1px solid #dce6e8; }
        .review-facts span { color: #8a98a7; font-size: .6rem; text-transform: uppercase; }
        .review-facts strong { font-size: .7rem; }
        .review-button { margin: 0; white-space: nowrap; }
        .packages { padding: 1rem; }
        .package-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .75rem; }
        .package-heading > div { display: flex; align-items: baseline; gap: .6rem; }
        .package-heading span { color: #7f8d9c; font-size: .65rem; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
        .package-heading strong { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .75rem; }
        .package-heading small { color: #82909e; font-size: .65rem; }
        .package-list { display: flex; flex-wrap: wrap; gap: .45rem; }
        @media (max-width: 860px) { .metrics { grid-template-columns: repeat(2, 1fr); } .work-grid { grid-template-columns: 1fr; } .review-panel { grid-template-columns: 1fr; } .review-facts { order: 2; } .review-button { justify-self: start; } }
        @media (max-width: 560px) { .hero { flex-direction: column; padding: 1.4rem; } .hero-status { justify-content: flex-start; } main { padding: .75rem; } .metrics { grid-template-columns: 1fr; } .review-facts { grid-template-columns: 1fr; } }
      </style>
    </template>
  };

  static embedded = this.isolated;
}
`.trimStart();
}

const relayIncident = json({
  data: {
    type: 'card',
    attributes: {
      incidentId: 'RLY-4821',
      route: 'KUL → NRT',
      severity: 'critical',
      openedAt: '22 Aug · 13:40 UTC',
      carrierCode: 'MX',
      originCountryCode: 'MY',
      destinationCountryCode: 'JP',
      industryCode: '481000',
      owner: 'Kim Park · Acme Operations',
      recoveryStatus: 'plan ready',
      recoveryAction: 'Protect the NRT connection through SIN.',
      reviewBranch: 'kim/route-recovery',
      reviewNumber: '17',
      checkpoint: 'ckpt_7fa3c1',
      triageSkill: '@ops-skills/incident-triage@1.3.1/',
    },
    meta: {
      adoptsFrom: {
        module: '@acme/relay/relay',
        name: 'RelayIncident',
      },
    },
  },
});

const fixtureRealms: FixtureRealm[] = [
  {
    owner: 'reliability',
    endpoint: 'service-levels',
    title: 'Reliability Labs · Service Levels',
    packageName: '@reliability/service-levels',
    version: '4.1.4',
    description: 'Shared service-incident model and SLA policy.',
    exports: './incident.gts',
    lock: { '@cardstack/base': '@cardstack/base@1.18.0/card-api' },
    files: { 'incident.gts': reliabilityIncident },
  },
  {
    owner: 'northstar',
    endpoint: 'operations-theme',
    title: 'Northstar · Operations Theme',
    packageName: '@northstar/operations-theme',
    version: '2.2.2',
    description: 'Night Signal visual language for operations products.',
    exports: './theme.ts',
    files: { 'theme.ts': northstarTheme },
  },
  {
    owner: 'northstar',
    endpoint: 'operations-ui',
    title: 'Northstar · Operations UI',
    packageName: '@northstar/operations-ui',
    version: '3.4.2',
    description:
      'Reusable operational status, metric, and provenance components.',
    exports: './components.gts',
    dependencies: {
      '@northstar/operations-theme': '^2.2.0',
      '@cardstack/base': '^1.18.0',
    },
    lock: {
      '@northstar/operations-theme':
        '@northstar/operations-theme@2.2.2/theme.ts',
      '@cardstack/base': '@cardstack/base@1.18.0/card-api',
    },
    files: { 'components.gts': northstarComponents },
  },
  {
    owner: 'global-standards',
    endpoint: 'country-codes',
    title: 'Global Standards · Country Codes',
    packageName: '@global-standards/country-codes',
    version: '2026.8.1',
    description: 'Versioned country names and operating regions.',
    exports: './country-codes.ts',
    files: { 'country-codes.ts': countryCodes },
  },
  {
    owner: 'industry-data',
    endpoint: 'industry-codes',
    title: 'Industry Data · Classification Codes',
    packageName: '@industry-data/industry-codes',
    version: '4.2.1',
    description: 'Versioned industry classification lookup.',
    exports: './industry-codes.ts',
    files: { 'industry-codes.ts': industryCodes },
  },
  {
    owner: 'transit',
    endpoint: 'carrier-codes',
    title: 'Transit Standards · Carrier Codes',
    packageName: '@transit/carrier-codes',
    version: '1.5.1',
    description: 'Carrier identity and alliance lookup.',
    exports: './carrier-codes.ts',
    files: { 'carrier-codes.ts': carrierCodes },
  },
  {
    owner: 'atlas',
    endpoint: 'route-map',
    title: 'Atlas · Route Map',
    packageName: '@atlas/route-map',
    version: '5.3.3',
    description: 'Reusable disruption and recovery route visualization.',
    exports: './route-map.gts',
    dependencies: { '@cardstack/base': '^1.18.0' },
    lock: { '@cardstack/base': '@cardstack/base@1.18.0/card-api' },
    files: { 'route-map.gts': routeMap },
  },
  {
    owner: 'ops-skills',
    endpoint: 'incident-triage',
    title: 'Operations Skills · Incident Triage',
    packageName: '@ops-skills/incident-triage',
    version: '1.3.1',
    description: 'Reproducible carrier-disruption triage skill.',
    exports: './triage.ts',
    files: { 'triage.ts': triageSkill, 'SKILL.md': triageSkillMarkdown },
  },
  {
    owner: 'acme',
    endpoint: 'relay',
    title: 'Relay · Global Disruption Desk',
    packageName: '@acme/relay',
    version: '2.4.3',
    description: 'A multi-party carrier disruption workspace.',
    exports: './relay.gts',
    dependencies: {
      '@reliability/service-levels': '~4.1.0',
      '@northstar/operations-ui': '^3.4.0',
      '@northstar/operations-theme': '^2.2.0',
      '@global-standards/country-codes': '^2026.8.0',
      '@industry-data/industry-codes': '^4.2.0',
      '@transit/carrier-codes': '^1.5.0',
      '@atlas/route-map': '^5.3.0',
      '@ops-skills/incident-triage': '^1.3.0',
      '@cardstack/base': '^1.18.0',
    },
    lock: {
      '@reliability/service-levels':
        '@reliability/service-levels@4.1.4/incident.gts',
      '@northstar/operations-ui':
        '@northstar/operations-ui@3.4.2/components.gts',
      '@northstar/operations-theme':
        '@northstar/operations-theme@2.2.2/theme.ts',
      '@global-standards/country-codes':
        '@global-standards/country-codes@2026.8.1/country-codes.ts',
      '@industry-data/industry-codes':
        '@industry-data/industry-codes@4.2.1/industry-codes.ts',
      '@transit/carrier-codes': '@transit/carrier-codes@1.5.1/carrier-codes.ts',
      '@atlas/route-map': '@atlas/route-map@5.3.3/route-map.gts',
      '@ops-skills/incident-triage':
        '@ops-skills/incident-triage@1.3.1/triage.ts',
      '@cardstack/base': '@cardstack/base@1.18.0/card-api',
    },
    files: { 'relay.gts': relayCardSource(), 'incident.json': relayIncident },
  },
];

async function writeRealm(realm: FixtureRealm) {
  let realmDir = join(realmsRoot, realm.owner, realm.endpoint);
  let packageFiles = { ...packageDocuments(realm), ...realm.files };
  let sourceFiles = {
    'realm.json': realmConfig(
      realm.title,
      realm.title[0],
      realm.owner === 'acme'
        ? 'https://boxel-images.boxel.ai/background-images/4k-dark-cubes.jpg'
        : 'https://boxel-images.boxel.ai/background-images/4k-silver-fur.jpg',
    ),
    'index.json': workspaceCard(),
    ...packageFiles,
  };
  for (let [path, contents] of Object.entries(sourceFiles)) {
    let target = join(realmDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }

  let bytes = pack(
    Object.entries(packageFiles).map(([path, contents]) => ({
      path,
      bytes: Buffer.from(contents),
    })),
  );
  let desiredTreeHash = unpack(bytes).treeHash;
  let storeDir = join(realmDir, '.deck', 'store');
  let existing = (await readStoreMeta(storeDir, realm.packageName.slice(1)))
    ?.versions[realm.version];
  if (existing && existing.treeHash !== desiredTreeHash) {
    throw new Error(
      `${realm.packageName}@${realm.version} is already sealed with different bytes; bump its fixture version`,
    );
  }
  let published =
    existing ??
    (await publishToStore(
      storeDir,
      realm.packageName.slice(1),
      realm.version,
      bytes,
      { tag: 'latest' },
    ));
  return { realm, realmDir, treeHash: published.treeHash };
}

async function registerRealms(realms: FixtureRealm[]) {
  let db = new PgAdapter({ autoMigrate: false });
  try {
    for (let realm of realms) {
      let url = `${serverOrigin}/${realm.owner}/${realm.endpoint}/`;
      let ownerUserId = `@${realm.owner}:localhost`;
      await query(db, [
        `UPDATE realm_user_permissions SET realm_owner = false WHERE realm_url =`,
        param(url),
        ` AND realm_owner = true AND username <>`,
        param(ownerUserId),
      ]);
      await query(db, [
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES (`,
        param(url),
        `, `,
        param(ownerUserId),
        `, true, true, true) ON CONFLICT (realm_url, username) DO UPDATE SET read = true, write = true, realm_owner = true`,
      ]);
      await query(db, [
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES (`,
        param(url),
        `, '*', true, false, false) ON CONFLICT (realm_url, username) DO UPDATE SET read = true, write = false, realm_owner = false`,
      ]);
      await insertSourceRealmInRegistry(db, {
        url,
        diskId: `${realm.owner}/${realm.endpoint}`,
        ownerUsername: realm.owner,
      });
    }
  } finally {
    await db.close();
  }
}

let results = [];
for (let realm of fixtureRealms) {
  results.push(await writeRealm(realm));
}
await registerRealms(fixtureRealms);

console.log(
  JSON.stringify(
    {
      product: 'Relay — global disruption desk',
      selectedCard: `${serverOrigin}/acme/relay/incident`,
      exactProduct: '@acme/relay@2.4.3/',
      realms: results.map(({ realm, treeHash }) => ({
        party: realm.title.split(' · ')[0],
        package: `${realm.packageName}@${realm.version}`,
        realm: `${serverOrigin}/${realm.owner}/${realm.endpoint}/`,
        treeHash,
      })),
    },
    null,
    2,
  ),
);
