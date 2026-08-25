/**
 * The ten-scenario real-workspace mirror cohort (M-01…M-10).
 *
 * This is the *target* cohort for the execution runtime: the graph-heavy set
 * of real workspace scenarios that must pass without editing any card source.
 * It is deliberately small and deliberately not a sample of visual variety —
 * every scenario contributes a distinct boundary mechanism that the others do
 * not isolate.
 *
 * Three evidence bodies sit alongside each other and none replaces the others:
 *
 * - This cohort is the completion gate. Passing it is what "compatible with
 *   real workspaces" means.
 * - The 50-card wild corpus (`execution-runtime-wild-corpus.mjs`) is the
 *   breadth lane: rotating rounds that look for behaviors nobody predicted.
 * - The staging execution-runtime suite realm and the sandbox-compatibility
 *   corpus realm are exploratory oracles — an axis laboratory and a cumulative
 *   composition canary. They answer "does this mechanism work at all", which
 *   is a different question from "do real cards still render".
 *
 * Each scenario declares the planes it must produce evidence on. A scenario is
 * not satisfied by a card-shaped rectangle appearing: every declared plane
 * needs its own observation.
 *
 * | Plane       | What it asserts                                                  |
 * | ----------- | ---------------------------------------------------------------- |
 * | semantic    | field values, computed/BXL output, relationship and query results |
 * | visual      | authored content, formats, images, layout, theme, scoped CSS      |
 * | interaction | pointer, keyboard, focus, drag/drop, media, form entry            |
 * | persistence | a write reaches the realm, survives reload, and reconciles        |
 * | lifecycle   | cold load, remount, format switch, teardown, no retained runtime  |
 *
 * `subject` names the workspace realm and, where the scenario pins one card,
 * its path within that realm. Scenarios whose subject is a graph rather than a
 * single card name the realm and describe the graph; the concrete instance is
 * chosen at run time from that realm and recorded with the result.
 *
 * The cohort validates; it does not drive. A red scenario opens a conformance
 * test against the rendering protocol, and the fix lands against that test —
 * never as a scenario-specific exception in an adapter.
 */

const realmOrigin = 'https://realms-staging.stack.cards';
const account = 'ctse';

export const mirrorCohortPlanes = [
  'semantic',
  'visual',
  'interaction',
  'persistence',
  'lifecycle',
];

export const executionRuntimeMirrorCohort = [
  scenario(
    'M-01',
    'execution-runtime-suite',
    'Release/opening-night',
    'Capsule rendering through trusted Base layout by reference: title, theme, fields, and navigation all match Direct.',
    ['semantic', 'visual', 'lifecycle'],
  ),
  scenario(
    'M-02',
    'execution-runtime-suite',
    'Track/corridor-take-one',
    'An audio/browser dependency promotes only the renderer that needs it; the parent composition stays in its own tier and the media lifecycle survives the boundary.',
    ['semantic', 'visual', 'interaction', 'lifecycle'],
  ),
  scenario(
    'M-03',
    'sandbox-compatibility-corpus-20260803',
    'NestedFieldHost/sample',
    'The default edit template, its nested FieldDef controls, validation, save, and reload all match Direct.',
    ['semantic', 'interaction', 'persistence'],
  ),
  scenario(
    'M-04',
    'sandbox-compatibility-corpus-20260803',
    'MarkdownArticle/sample',
    'The trusted Rich Markdown portal, an editable body, Mermaid, and an authored card embed all survive alternating trusted/authored boundaries.',
    ['semantic', 'visual', 'interaction'],
  ),
  scenario(
    'M-05',
    'software-periodic-workspace',
    'InvoiceBillingForm/inv-2081',
    'Computed values, cardInfo, image/media projection, and default edit behavior hold across a large graph without a performance cliff.',
    ['semantic', 'visual', 'interaction', 'persistence'],
  ),
  scenario(
    'M-06',
    'middle-wolverine',
    'Airline/AirlineFlight/aa4500-ord-lhr',
    'Deep relationships, BXL/computed values, nested Base fields, and currency/configuration metadata project intact.',
    ['semantic', 'visual'],
  ),
  scenario(
    'M-07',
    'tier-maker',
    'TierList/national-fast-food-ranking',
    'Sandbox DOM, private image URLs, modifiers, allocated versus intrinsic layout, edit-return continuity, and persistence all hold together in one card.',
    ['visual', 'interaction', 'persistence', 'lifecycle'],
  ),
  scenario(
    'M-08',
    'color-tree-playground',
    undefined,
    'A root module that reads as Capsule-safe is promoted by its renderer dependency graph; themes/CSS variables and safe modifiers survive the promotion, and the route is format-dependent.',
    ['semantic', 'visual', 'lifecycle'],
  ),
  scenario(
    'M-09',
    'realm-collaboration',
    undefined,
    'Same-workspace and cross-workspace links, query values, the command/refusal boundary, and synchronization across multiple consumers of one card.',
    ['semantic', 'interaction', 'persistence', 'lifecycle'],
  ),
  scenario(
    'M-10',
    'sandbox-compatibility-corpus-20260803',
    undefined,
    'Search, room, and markdown surfaces each mount one Capsule card and one Sandbox card: no surface bypasses to Direct, the prerender placeholder stays cheap, and nested cards are routed by their own policy rather than their parent’s.',
    ['visual', 'lifecycle'],
  ),
];

validateMirrorCohort(executionRuntimeMirrorCohort);

function scenario(id, realm, cardPath, requiredProof, planes) {
  let realmUrl = `${realmOrigin}/${account}/${realm}/`;

  return {
    id,
    planes,
    realm,
    realmUrl,
    requiredProof,
    subjectUrl: cardPath ? `${realmUrl}${cardPath}` : undefined,
  };
}

export function validateMirrorCohort(scenarios) {
  if (scenarios.length !== 10) {
    throw new Error(
      `The mirror cohort must contain exactly ten scenarios; found ${scenarios.length}`,
    );
  }

  let ids = new Set();
  let planes = new Set(mirrorCohortPlanes);

  for (let [index, entry] of scenarios.entries()) {
    let expectedId = `M-${String(index + 1).padStart(2, '0')}`;
    if (entry.id !== expectedId) {
      throw new Error(
        `Mirror cohort scenarios are numbered in order; expected ${expectedId} at position ${index} but found ${entry.id}`,
      );
    }
    if (ids.has(entry.id)) {
      throw new Error(`Mirror scenario id must be unique: ${entry.id}`);
    }
    if (!entry.realm || !entry.requiredProof) {
      throw new Error(
        `Mirror scenario ${entry.id} must name its realm and its required proof`,
      );
    }
    if (!entry.realmUrl.startsWith(`${realmOrigin}/${account}/`)) {
      throw new Error(
        `Mirror scenario ${entry.id} must resolve inside the staging account: ${entry.realmUrl}`,
      );
    }
    if (entry.subjectUrl && !entry.subjectUrl.startsWith(entry.realmUrl)) {
      throw new Error(
        `Mirror scenario ${entry.id} pins a card outside its own realm: ${entry.subjectUrl}`,
      );
    }
    if (!entry.planes?.length) {
      throw new Error(
        `Mirror scenario ${entry.id} must declare at least one evidence plane`,
      );
    }
    for (let plane of entry.planes) {
      if (!planes.has(plane)) {
        throw new Error(
          `Mirror scenario ${entry.id} declares an unknown evidence plane: ${plane}`,
        );
      }
    }
    if (new Set(entry.planes).size !== entry.planes.length) {
      throw new Error(
        `Mirror scenario ${entry.id} repeats an evidence plane: ${entry.planes.join(', ')}`,
      );
    }

    ids.add(entry.id);
  }

  let covered = new Set(scenarios.flatMap((entry) => entry.planes));
  let uncovered = mirrorCohortPlanes.filter((plane) => !covered.has(plane));
  if (uncovered.length) {
    throw new Error(
      `The mirror cohort leaves an evidence plane unproven: ${uncovered.join(', ')}`,
    );
  }
}
