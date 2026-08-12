// The publish plan for the Atlas Slice, in the order it happened.
//
// See `docs/atlas-slice-version-scenarios.md`. Each entry is one PASS over a
// package: somebody sat down, improved the thing, and shipped. The version
// number records what that pass did to the contract — a patch or minor when a
// consumer can take it without reading, a major when they cannot — and the
// slice deliberately contains plenty of both, because a version system that
// has only ever seen compatible changes has not been tested.
//
// THE ORDER IS THE POINT. A pack sealed against `^2.0.0` carries whatever that
// range resolved to on the day it was sealed. Publishing these out of order
// would produce pins that are internally consistent and historically false,
// and every §3 prediction that depends on sealed history would be untestable.
//
// Sources live on disk under `versions/<publisher>-<key>/<version>/`, as real
// `.gts` files rather than strings in this module, so they can be linted,
// diffed and read like the code they are.

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSIONS = join(HERE, 'versions');

async function filesUnder(dir) {
  let out = {};
  async function walk(current) {
    for (let entry of await readdir(current, { withFileTypes: true })) {
      let full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out[relative(dir, full).split(sep).join('/')] = await readFile(
          full,
          'utf8',
        );
      }
    }
  }
  await walk(dir);
  return out;
}

// One pass over one package.
//
// `deps` are RANGES, which is the interesting half: they are sealed into exact
// pins at publish time against whatever the store held that day, and the range
// is kept beside the pin so a reader can see what the author would have
// accepted rather than only what they got.
function pass({ publisher, key, version, deps, changelog, overrideReason }) {
  return { publisher, key, version, deps, changelog, overrideReason };
}

// ─── The plan ───────────────────────────────────────────────────────────────
//
// Read top to bottom; that is the order it goes out. Majors are marked so the
// compatible/incompatible mix is visible at a glance rather than inferable
// from the numbers.

const PASSES = [
  // ── cardstack/contracts ── layer 02, the platform vendor ──────────────────
  pass({
    publisher: 'cardstack',
    key: 'contracts',
    version: '0.1.0',
    changelog:
      'Pass 1. A number and a currency code, printed as written. Not a good ' +
      'money field, and the 0.1.0 says so: no grouping, no symbol, no idea ' +
      'that JPY has no minor units, one format, no accessible label. Every ' +
      'one of those is fixed by a later pass — publishing it is what makes ' +
      'the history real rather than a set of numbers applied afterwards.',
  }),
  pass({
    publisher: 'cardstack',
    key: 'contracts',
    version: '0.2.0',
    changelog:
      'Pass 2. Money is formatted with Intl.NumberFormat instead of printed ' +
      'raw, which in one call fixes the symbol, the position of the symbol ' +
      '(kr trails, $ leads), digit grouping, and the per-currency minor-unit ' +
      'count — 1200 USD becomes $1,200.00 and 1200 JPY becomes the correct ' +
      'Y1,200 with no decimals. Adds an accessible label spelling out the ' +
      'code, an empty state, currency normalisation, and PercentField for ' +
      'the tax and discount lines consumers were storing as bare numbers. ' +
      'INCOMPATIBLE: under 0.x a minor is the compatibility boundary, so ' +
      '^0.1.0 does not admit this — deliberately, because the money field ' +
      'now renders differently and that should be opted into.',
  }),
  pass({
    publisher: 'cardstack',
    key: 'contracts',
    version: '1.0.0',
    changelog:
      'Pass 3, and the release that earns a 1.0.0. Three things pass 2 got ' +
      'wrong, worst first. NO EDIT FORMAT: you could not author a money ' +
      'value at all, so this adds a real currency input — caret-safe (raw ' +
      'while focused, canonical on blur, which is the bug every first ' +
      'implementation ships), inputmode decimal for phone keypads, parsing ' +
      'generous enough for a pasted $1,234.56 or 1.234,56 or an accounting ' +
      '(400), arrow-key stepping, and a live preview so a misread value is ' +
      'never stored silently. NO THEME: pass 2 hardcoded hex and rem, so a ' +
      'money field ignored the theme of every card rendering it — everything ' +
      'is now a theme variable with each fallback stated once at the ' +
      'component root. ONE FORMAT: now five, and fitted carries real ' +
      'badge/strip/tile/card subformats through container queries with no ' +
      'chrome of its own, because the parent draws that. Also adds a ' +
      '`display` computed so consumers can put formatted money in a sentence ' +
      'without reaching into this field. COMPATIBLE with 0.2.0 in field ' +
      'shape; the bump to 1.0.0 buys the promise that it stays that way.',
  }),

  // ── openkit/controls ── layer 03, the third-party UI library ──────────────
  pass({
    publisher: 'openkit',
    key: 'controls',
    version: '0.1.0',
    changelog:
      'Pass 1: <Select>, hand-rolled. This is the component the whole ' +
      'versioning argument is about — a dropdown sits under every card in ' +
      'every realm — and it is also the one with the largest gap between ' +
      'looks easy and is correct. Full combobox ARIA with focus kept on the ' +
      'trigger and the current option named by aria-activedescendant (moving ' +
      'real focus into a popup fights the browser over Tab order and breaks ' +
      'on iOS). Complete keyboard: arrows with wrap and disabled-skipping, ' +
      'Home/End, Enter, Escape, Tab that closes WITHOUT committing, and ' +
      'typeahead that works closed as well as open, with repeat-letter ' +
      'cycling. Active and selected are tracked separately, because ' +
      'conflating them commits a value the user was only looking at. ' +
      'NARROW ON PURPOSE and said out loud in the header: no multiple ' +
      'selection, no search, no groups, no portal, and the highlight snaps ' +
      'rather than travels. Every one of those is additive, which is what ' +
      'will make them minor versions rather than majors.',
  }),
  pass({
    publisher: 'openkit',
    key: 'controls',
    version: '0.2.0',
    changelog:
      'Pass 2: search and groups — the two gaps that stop <Select> working AT ' +
      'SCALE, which is where a select actually fails, because nobody ' +
      'arrow-keys through two hundred currencies. Both are OPT-IN, so every ' +
      'existing caller renders exactly as before; that is what makes this a ' +
      'minor. The search is diacritic-insensitive (mexico finds Mexico), ' +
      'RANKED rather than merely filtered (a prefix hit outranks a mid-word ' +
      'hit, so "us" puts USD above Belarusian ruble), and it marks the ' +
      'matched run inside the label so the reader can see why a row survived ' +
      '— once rows are ranked, an unexplained ordering reads as randomness. ' +
      'Groups render under sticky headers in first-appearance order, and a ' +
      'header is never an option: the flat index the keyboard walks skips it ' +
      'entirely, which is why rows and sections are computed separately. ' +
      'Focus moves into the field when search is on, because you cannot type ' +
      'into something that is not focused — with a field present the INPUT is ' +
      'the combobox and the trigger steps down to a disclosure button. Escape ' +
      'clears the query before it closes the popup. STILL NOT DONE: multiple ' +
      'selection, and the portal — a short scroll container still clips the ' +
      'listbox, and that one cannot be fixed additively.',
  }),
  pass({
    publisher: 'openkit',
    key: 'controls',
    version: '1.0.0',
    changelog:
      'Pass 3, and the release that earns a 1.0.0. INCOMPATIBLE, for a real ' +
      'reason rather than a bookkeeping one. 0.2.0 shipped with one gap it ' +
      'could not close additively and said so: a short scroll container ' +
      'clips the listbox. That is every select in this system — a select in ' +
      'a card, in a stack item, in a scroll region — and no z-index fixes it, ' +
      'because z-index orders siblings and this is clipping, not ordering. ' +
      'The only fix is to stop being a descendant, so the listbox is now ' +
      'PORTALED to <body> and anchored back onto its trigger by ' +
      '@floating-ui/dom with flip, shift, size and autoUpdate — autoUpdate ' +
      'being the part that is easy to omit and impossible to live without, ' +
      'since without it the popup is correct exactly once and then floats ' +
      'away the first time anything scrolls. That breaks two contracts on ' +
      'purpose: consumer CSS that reached the popup as a descendant stops ' +
      'matching (for a component library the rendered tree IS public API), ' +
      'and the popup no longer inherits the cascade — which is why the token ' +
      'block is now declared on both roots, the honest price of the portal ' +
      'paid once and written down. Third break: @onChange widens to hand ' +
      'back an array under @multiple. Riding along, because a major is when ' +
      'you get to: MULTIPLE SELECTION with chips, a drawn checkbox rather ' +
      'than a real one (the row already carries aria-selected and a checkbox ' +
      'inside role=option announces the same state twice), backspace-removes-' +
      'last in the search field, and a popup that stays open while you pick. ' +
      'The highlight now TRAVELS: one absolutely-positioned box moved by ' +
      'custom properties, which encodes the fact a snap leaves the reader to ' +
      'reconstruct — that they moved by one row — and collapses to the end ' +
      'state under prefers-reduced-motion. NOTE ON THE STACK: openkit owns ' +
      'the API, the ARIA, the keyboard and the visual language; positioning ' +
      'is a proven engine, because a decade of collision edge cases is not ' +
      'worth rediscovering. ember-power-select was the other candidate and ' +
      'is NOT reachable from card code — the host shims an explicit ' +
      'allowlist (packages/host/app/lib/externals.ts) that carries ' +
      'ember-modifier, ember-animated, @floating-ui/dom and boxel-ui, but ' +
      'not power-select. floating-ui is what power-select would have wrapped ' +
      'anyway.',
  }),

  // ── iso/money-codes ── layer 04, the standards body ───────────────────────
  pass({
    publisher: 'iso',
    key: 'money-codes',
    version: '1.0.0',
    changelog:
      'Pass 1. The ISO 4217 register as DATA: codes, names, numeric codes, ' +
      'and minor units — including KWD at three and JPY at none, so anything ' +
      'that assumed two is wrong in both directions. A standards body ships ' +
      'data rather than behaviour, which changes what its versions MEAN: this ' +
      'package moves because the world changed, not because anyone ' +
      'refactored, so a consumer pinned here is pinned to a snapshot of ' +
      'reality. Marks unrecognised codes rather than rejecting them, ' +
      'deliberately — a register that refuses what it has not heard of turns ' +
      'every lag between the world and the list into a data-entry failure. ' +
      'Formatting stays in layer 02; asking a standards package to render ' +
      'money would invert the layering.',
  }),
  pass({
    publisher: 'iso',
    key: 'money-codes',
    version: '1.1.0',
    changelog:
      'Pass 2: the withdrawn register. 1.0.0 knew only what is current, which ' +
      'was a bug disguised as tidiness — an invoice raised in 2001 in ' +
      'Deutsche Mark is not invalid, it is HISTORY, and a list that has ' +
      'forgotten DEM renders it as "unrecognised" forever. Adds withdrawn ' +
      'codes with the date they stopped being current and their successor, ' +
      'so an old document reads correctly, a consumer can offer DEM→EUR ' +
      'without keeping its own migration table, and "withdrawn" becomes ' +
      'distinguishable from "never existed" — two states that want completely ' +
      'different remedies. Includes BYR→BYN, which redenominated to a ' +
      'DIFFERENT minor-unit count, the case that breaks anyone who assumed ' +
      'the exponent belongs to the country rather than the code. COMPATIBLE: ' +
      'currencies() still returns exactly the active list, in the same order. ' +
      'Quietly adding DEM to every currency picker in the world would have ' +
      'been a breaking change wearing a data change’s clothes, so new ' +
      'facts go through new functions.',
  }),

  // ── northwind/records ── layer 05, the record vendor ──────────────────────
  //
  // THE FIRST PASS IN THE SLICE WITH DEPENDENCIES. Everything above stands
  // alone; this names two upstream packages by RANGE and gets two exact PINS.
  // `iso/money-codes: ^1.0.0` is published AFTER 1.1.0 exists, so the seal
  // records 1.1.0 while the range still says the author would have taken
  // 1.0.0 — which is the whole point of keeping both.
  pass({
    publisher: 'northwind',
    key: 'records',
    version: '1.0.0',
    deps: {
      'cardstack/contracts': '^1.0.0',
      'iso/money-codes': '^1.0.0',
    },
    changelog:
      'Pass 1: Invoice and LineItem. A record vendor sells SHAPE — not ' +
      'formatting (layer 02), not controls (layer 03), not codes (layer 04) — ' +
      'the agreed answer to "what IS an invoice", so ten downstream systems ' +
      'stop each inventing their own nearly-compatible version. LineItem is a ' +
      'FieldDef and not a CardDef on purpose: a line has no independent ' +
      'existence, nobody links to line 3, and making it a card would buy an ' +
      'id nothing wants at the cost of a link traversal on every render. Tax ' +
      'is per LINE, because a rate is a property of what was sold — an ' +
      'invoice-level rate is the shortcut you undo the first time somebody ' +
      'sells a book and a laptop on one document. Totals are DERIVED, never ' +
      'stored: a stored total is a second source of truth that disagrees with ' +
      'its own lines the first time anyone edits through a path that forgot ' +
      'to recompute. Rounding asks the code list for the currency’s minor ' +
      'units rather than assuming two, and nudges by EPSILON because the ' +
      'Math.round(x*100)/100 everyone writes loses a cent on 1.005.',
  }),

  // ── ledgerworks/billing-kit ── layer 05.5, the vertical ISV ───────────────
  //
  // THE DEPENDENCY THAT IS DELIBERATELY BEHIND. `openkit/controls: ^0.2.0` is
  // published when 1.0.0 already exists, and under the 0.x rule the range
  // EXCLUDES it. So this pack seals against 0.2.0 while the realm resolves the
  // bare specifier to 1.0.0 — two majors of one component live on one page,
  // which is the single most important thing the slice has to demonstrate.
  pass({
    publisher: 'ledgerworks',
    key: 'billing-kit',
    version: '1.0.0',
    deps: {
      'northwind/records': '^1.0.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^0.2.0',
    },
    overrideReason:
      'Qualified against openkit/controls 0.2.0 for regulated customers. ' +
      'Not re-qualifying on somebody else’s release schedule; the upgrade is ' +
      'this vendor’s decision to make by republishing with a wider range.',
    changelog:
      'Pass 1: CollectionCase. An ISV invents neither record types nor ' +
      'controls — it takes a vendor’s records and a UI library’s components ' +
      'and sells the PROCESS that connects them, here the one that turns an ' +
      'invoice into money. Payment terms are DATA rather than free text, ' +
      'because "Net 30" typed by hand is a string no dunning schedule can ' +
      'compute from. The escalation ladder is a pure function of days ' +
      'overdue, so it is the same answer everywhere and nobody stores a stale ' +
      'copy. The invoice link is marked `searchable` — a collections queue ' +
      'exists to be filtered, and a filter across a non-searchable link does ' +
      'not return nothing, it ERRORS at query time. SEALED BEHIND ON PURPOSE: ' +
      'this pins openkit/controls@0.2.0 while 1.0.0 is already published, so ' +
      'its Select has no search and a clippable popup. That is not staleness, ' +
      'it is a seal — and it is what actually happens when an ISV ships to ' +
      'regulated customers and declines to re-qualify on someone else’s ' +
      'schedule. openkit shipping a major must not reach in and change this ' +
      'vendor’s collections screen.',
  }),

  // ── acme/rfq-to-payment ── layer 06, the customer ─────────────────────────
  //
  // The top of the stack, and the page where the central claim holds or does
  // not: TWO MAJORS of one component side by side, each behaving as its own
  // seal says. Acme takes ^1.0.0; the kit beneath it is sealed to 0.2.0.
  pass({
    publisher: 'acme',
    key: 'rfq-to-payment',
    version: '1.0.0',
    deps: {
      'ledgerworks/billing-kit': '^1.0.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^1.0.0',
    },
    changelog:
      'Pass 1: PaymentRun. The customer writes no fields, no controls, no ' +
      'record types and no process — they ASSEMBLE, which is what a customer ' +
      'should be doing and what every layer beneath exists to make possible. ' +
      'This card renders both majors of openkit/controls at once, in ' +
      'IDENTICAL overflow:hidden boxes so any difference on screen is the ' +
      'component and never the container: the left Select arrives through ' +
      'ledgerworks/billing-kit and resolves through THAT pack’s sealed scope ' +
      'to 0.2.0 (no search, clipped); the right is imported here at ^1.0.0 ' +
      '(search, groups, multiple, portaled, escapes). Same name, same ' +
      'publisher, one page, two behaviours, neither degraded. The property ' +
      'that matters is an ABSENCE: there is no argument on this card, no ' +
      'realm setting and no import that lets acme reach up and give the ' +
      'kit’s Select a search field. If that hatch existed the seal would be ' +
      'advisory. Also carries the resolved-stack footer, so the whole chain ' +
      'from layer 06 down to layer 02 is readable off the rendered card.',
  }),

  // ── the re-seal ───────────────────────────────────────────────────────────
  //
  // A minor from two layers down, and what it costs the top of the stack to
  // take it. This pair is §7's UPDATE button acted out: ledgerworks improves,
  // acme's RANGE already admits the improvement, and acme still does not get
  // it until acme republishes — because a seal does not drift.
  pass({
    publisher: 'ledgerworks',
    key: 'billing-kit',
    version: '1.1.0',
    deps: {
      'northwind/records': '^1.0.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^0.2.0',
    },
    overrideReason:
      'Still qualified against openkit/controls 0.2.0. The embedded format is ' +
      'ours; the Select underneath it is unchanged and stays sealed.',
    changelog:
      'Pass 2: an embedded format for CollectionCase. 1.0.0 shipped only ' +
      '`isolated`, so a case linked from another card rendered as a bare ' +
      'title chip — and linked-from-another-card is the position consumers ' +
      'actually put it in, which made it half a component. The embedded row ' +
      'shows the two facts an operator reads at a glance, the stage and the ' +
      'terms, and the terms are a real control rather than text because ' +
      'changing them is the action the row exists to support. It draws no ' +
      'border, radius or background: the PARENT draws the chrome around an ' +
      'embedded card and a second frame inside it reads as a mistake. ' +
      'COMPATIBLE, purely additive. Still sealed to openkit/controls@0.2.0, ' +
      'so the Select in that row is visibly the old major.',
  }),
  pass({
    publisher: 'acme',
    key: 'rfq-to-payment',
    version: '1.0.1',
    deps: {
      'ledgerworks/billing-kit': '^1.1.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^1.0.0',
    },
    changelog:
      'Pass 2, and NOTHING IN THE SOURCE CHANGED except the note explaining ' +
      'why this Version exists. ledgerworks shipped 1.1.0 and acme’s range ' +
      'admits it — but acme@1.0.0 is sealed against billing-kit@1.0.0 and ' +
      'always will be, because a seal does not drift. Picking up a compatible ' +
      'improvement from below therefore costs a republish here. That is the ' +
      'point rather than a defect: the customer decides when their app moves, ' +
      'and the act of deciding is a new Version with a new pin that anyone ' +
      'can read afterwards. §7’s UPDATE button, seen from the top of the ' +
      'stack — a minor two layers down did not reach in and change what acme ' +
      'ships.',
  }),
  pass({
    publisher: 'acme',
    key: 'rfq-to-payment',
    version: '1.0.2',
    deps: {
      'ledgerworks/billing-kit': '^1.1.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^1.0.0',
    },
    changelog:
      'Pass 3: two things 1.0.1 got wrong, both caught by looking at the ' +
      'rendered card. FORMAT: `<@fields.openCase />` renders a linked card ' +
      'FITTED, not embedded — so ledgerworks’ new embedded row never appeared ' +
      'and the case still showed as a bare title chip. The entire point of ' +
      're-sealing onto 1.1.0 was lost to a default. Asking for the format ' +
      'explicitly is the fix and it is the CALLER’s job: fitted is a card in ' +
      'a grid, embedded is a card in a sentence, and only the parent knows ' +
      'which it is building. THE FOOTER WAS LYING: the resolved stack was ' +
      'hardcoded text, so the moment 1.0.1 re-sealed onto billing-kit@1.1.0 ' +
      'the card kept cheerfully claiming 1.0.0. A hand-maintained copy of a ' +
      'fact the seal already holds is a second source of truth, and this one ' +
      'went stale on the very next release — about as fast as that mistake ' +
      'can be caught. Corrected, and the note stays in the source: the honest ' +
      'version of that footer is one that cannot go stale, which needs a way ' +
      'to read the pack manifest at render time. Owed, not done.',
  }),

  // ── the deliverable pass ──────────────────────────────────────────────────
  //
  // A COMPOSITION IS ONLY AS GOOD AS ITS WORST LAYER. Everything above was
  // correct and looked like a debug dump when assembled — because each package
  // had been judged on its own, and none of them had been judged in somebody
  // else's card. Bottom-up, so the pins resolve forward and acme's stack table
  // is true when it is written.
  pass({
    publisher: 'cardstack',
    key: 'contracts',
    version: '1.1.0',
    changelog:
      'Pass 4: shippable, not merely correct. Two things found only by looking ' +
      'at this field COMPOSED into someone else’s card. (1) THE VERSION STAMP ' +
      'WAS ALWAYS ON — "$0.00 cardstack/contracts 1.0.0" reads as debug output ' +
      'the moment it lands in a form row, which is where a money field spends ' +
      'its life; but deleting it throws away the one affordance that makes ' +
      'coexisting versions visible. It is now off by default and a PAGE opts ' +
      'in with `--boxel-provenance-display: inline`. A custom property rather ' +
      'than an argument, because provenance is a property of the page ("this ' +
      'page is about versions"), not of each field on it — an argument would ' +
      'have to be threaded through every caller in between, and the ones in ' +
      'between do not care. Declared FIRST in each style block so the fitted ' +
      'container queries can still hide it at badge size; a rule placed last ' +
      'would beat them and stamp a version string on a badge. (2) EMBEDDED ' +
      'DREW ITS OWN BOX — a border, radius and fill make a value look like a ' +
      'disabled input, and next to a real control it reads as a broken one. ' +
      'Embedded is a value IN A SENTENCE and the parent owns the chrome; the ' +
      'box moves to isolated, where this field is genuinely the subject. ' +
      'COMPATIBLE: presentation only.',
  }),
  pass({
    publisher: 'iso',
    key: 'money-codes',
    version: '1.2.0',
    changelog:
      'Pass 3: a code that composes. 1.1.0 rendered "USD US Dollar" as one ' +
      'inline run — right in prose, wrong everywhere else: in a totals block ' +
      'it competes with the number it annotates, and in a narrow slot the name ' +
      'overflows. A code list’s field spends its life INSIDE other people’s ' +
      'layouts, so it has to shrink gracefully rather than assume it is the ' +
      'subject. The code is the identifier and never yields; the name is a ' +
      'gloss and goes first, because losing it costs a reader nothing they ' +
      'cannot recover. Adds `atom` (the code alone) for dense tables. ' +
      'Withdrawn codes keep the strike, and the gloss now carries the date and ' +
      'successor so the strike does not have to be decoded. COMPATIBLE.',
  }),
  pass({
    publisher: 'northwind',
    key: 'records',
    version: '1.1.0',
    deps: {
      'cardstack/contracts': '^1.0.0',
      'iso/money-codes': '^1.0.0',
    },
    changelog:
      'Pass 2: an invoice that looks like an invoice. 1.0.0 had exactly one ' +
      'format and it was a definition list stacked on a bulleted list — a data ' +
      'dump wearing a card’s clothes — and it fell apart the moment anything ' +
      'linked to it, because a linked card renders FITTED and 1.0.0 had no ' +
      'fitted format, so it showed as a bare chip reading "Untitled Invoice". ' +
      'A record type must be presentable in every slot a consumer will put it ' +
      'in or the consumer rebuilds it. Adds FITTED with real ' +
      'badge/strip/tile/card subformats and no chrome of its own, EMBEDDED as ' +
      'a single line (number, total, historic flag), and rebuilds ISOLATED as ' +
      'a DOCUMENT: header block, a line-items table with aligned money ' +
      'columns, and a totals block reading bottom-right the way every invoice ' +
      'anyone has been handed does. TABULAR MONEY IS NOT DECORATION: one ' +
      'right-aligned decimal column is what lets a reader add the column up by ' +
      'eye and catch the line that is an order of magnitude out — a ' +
      'left-aligned money column silently removes that ability. COMPATIBLE.',
  }),
  pass({
    publisher: 'ledgerworks',
    key: 'billing-kit',
    version: '1.2.0',
    deps: {
      'northwind/records': '^1.0.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^0.2.0',
    },
    overrideReason:
      'Still qualified against openkit/controls 0.2.0. The row is ours; the ' +
      'Select underneath it is unchanged and stays sealed.',
    changelog:
      'Pass 3: the embedded row, properly. 1.1.0’s row was a stage pill and a ' +
      'control shoved together with a gap, which left the control at its ' +
      'natural width and a lake of empty space beside it in any parent wider ' +
      'than a phone. It read as unfinished because it was. A row is a LABELLED ' +
      'FIELD, not two things next to each other: fixed label column, control ' +
      'taking the rest, status hugging the end — the same shape as every form ' +
      'row in the isolated view, which is the point, since an embedded card ' +
      'should look like it came from the same kit as the card embedding it. ' +
      'Status tint is derived from the status colour with color-mix, so one ' +
      'declaration sets both the text and its wash. COMPATIBLE.',
  }),
  pass({
    publisher: 'acme',
    key: 'rfq-to-payment',
    version: '1.1.0',
    deps: {
      'ledgerworks/billing-kit': '^1.2.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^1.0.0',
    },
    changelog:
      'Pass 4: make it look like a product. Everything through 1.0.2 was ' +
      'correct and looked like console output — dashed borders, ' +
      'terminal-green monospace captions, a numbered list for the resolved ' +
      'stack, and comparison boxes wide enough to leave a lake of white beside ' +
      'a control at its natural width. A page whose entire job is to be LOOKED ' +
      'AT cannot be styled like a debug dump: if the reader has to work to see ' +
      'the difference, the demonstration has failed however right the ' +
      'machinery underneath is. DASHED BORDERS ARE A DEBUG AFFORDANCE — they ' +
      'say "placeholder"; the clipping viewport is now a real inset surface ' +
      'with a corner tag naming the constraint, which is the actual subject ' +
      'rather than a hint at it. MONOSPACE IS FOR CODE: versions and ' +
      'specifiers keep it because they are identifiers a reader may retype, ' +
      'prose captions do not. SIZED TO THE CONTENT, both halves identical — a ' +
      'comparison whose sides differ in width is not a comparison. THE STACK ' +
      'IS A TABLE, because it is tabular: layer, package, version, and why ' +
      'that version; a numbered list threw away three of those four. ' +
      'COMPATIBLE: presentation only.',
  }),
  pass({
    publisher: 'northwind',
    key: 'records',
    version: '1.1.1',
    deps: {
      'cardstack/contracts': '^1.0.0',
      'iso/money-codes': '^1.0.0',
    },
    changelog:
      'Patch: the columns were touching. 1.1.0 rendered "3$1,200.00$3,600.00" ' +
      '— three numbers with no gutter, which is worse than a list, because a ' +
      'list at least does not invite you to read two figures as one. A ' +
      'SPECIFICITY LOSS rather than a missing rule: the gutter lived on ' +
      '`.c-num` (0,1,0) and the cell padding on `.lines td` (0,1,1), so the ' +
      'padding won and zeroed it. Scoping to `.lines .c-num` (0,2,0) puts it ' +
      'back on top. Named in the source rather than silently fixed, because ' +
      'this is the failure mode of styling a table by element AND by column at ' +
      'once — and the symptom, numbers running together, is precisely what the ' +
      'table was introduced to prevent.',
  }),
  pass({
    publisher: 'acme',
    key: 'rfq-to-payment',
    version: '1.1.1',
    deps: {
      'ledgerworks/billing-kit': '^1.2.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^1.0.0',
    },
    changelog:
      'Patch: the viewports were too tall. 1.1.0 gave each one 6.5rem so a ' +
      'clipped popup had somewhere to be cut off — but AT REST that reads as ' +
      'an empty box, and a reader seeing dead space assumes something failed ' +
      'to load, which is the opposite of what a demonstration needs. 4.75rem ' +
      'still cuts the popup, which is far taller than that, while leaving the ' +
      'control looking placed rather than stranded: the constraint doing the ' +
      'same job with less of the page.',
  }),
  // ─── THE VISUAL PASS, AS VERSIONS ─────────────────────────────────────────
  //
  // Publishing rather than editing, because the earlier Versions are sealed and
  // an improvement pass IS a new release. The order matters: each seals against
  // whatever its ranges resolve to at ITS point in this list.
  pass({
    publisher: 'northwind',
    key: 'records',
    version: '1.2.0',
    deps: {
      'cardstack/contracts': '^1.0.0',
      'iso/money-codes': '^1.0.0',
    },
    changelog:
      'Minor: a record that says its own name. Every invoice reported itself ' +
      'as "Untitled Invoice" — in the tab title, the stack header, the ' +
      'workspace feed, and inside anything that LINKED to one, where the name ' +
      'is the entire visible content. The number was in the record the whole ' +
      'time; nothing was asking for it. `cardTitle` is overridden rather than ' +
      'copied into `cardInfo.name`, because a second copy of the number can ' +
      'drift from the field beside it. Adds `cardDescription` for list rows, ' +
      'and a status the document leads with — a plain getter and NOT a field, ' +
      "since an indexed value that depends on today's date is stale the " +
      'moment it is written.',
  }),
  pass({
    publisher: 'ledgerworks',
    key: 'billing-kit',
    version: '1.3.0',
    deps: {
      'northwind/records': '^1.2.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^0.2.0',
    },
    changelog:
      'Minor: a card that can be looked at, and named. Three gaps, all the ' +
      'same complaint — this card was unusable anywhere but the one screen it ' +
      'was written for. It had no title, so it read "Untitled Collection ' +
      'Case" wherever it was named; a case has no name of its own, so the ' +
      'title is computed across the link to its invoice. It had no fitted ' +
      'format, so a linked case fell back to a bare chip. And it did not ' +
      're-export the type it links to, which was a RUNTIME failure rather ' +
      'than a cosmetic one: a consumer resolving `northwind/records` through ' +
      'its own map got a different Version, and therefore a different class, ' +
      'and `linksTo` rejected it with "tried set Invoice as field invoice but ' +
      'it is not an instance of Invoice". Two versions of a component can ' +
      'coexist; two versions of a TYPE cannot.',
  }),
  pass({
    publisher: 'acme',
    key: 'rfq-to-payment',
    version: '1.2.0',
    deps: {
      'ledgerworks/billing-kit': '^1.3.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^1.0.0',
    },
    changelog:
      'Minor: the resolved-stack table stops being hand-written. 1.1.0 shipped ' +
      'it with a footnote admitting it would go stale, and it went stale one ' +
      'release later — 1.1.1 shipped still claiming 1.1.0. It now reads the ' +
      'SEALS: the card finds its own pack from `import.meta.url`, fetches the ' +
      'manifest served beside its modules, and walks its dependencies ' +
      'transitively. That turns the table from illustration into evidence, and ' +
      'it discovers the two live majors of openkit/controls rather than ' +
      'asserting them. Also adds `cardTitle` and atom/embedded/fitted formats.',
  }),

  // ─── BACKPORTS ONTO THE 1.0 MAINTENANCE LINE ──────────────────────────────
  //
  // Published AFTER the releases above and deliberately not on them, for the
  // consumers still qualified against 1.0 — `apps/legacy-collections/` in the
  // atlas realm. Every dependency is declared `~` rather than `^`: a
  // maintenance release that quietly drags its upstreams forward has not
  // maintained anything, it has shipped the new version under an old number.
  //
  // Both carry an override reason, because the structural pass compares against
  // the LATEST Version and will argue for a bump from there. A backport is
  // exactly the case where the author is right and the advice is not, so the
  // reason goes on the record instead of the gate being worked around.
  pass({
    publisher: 'northwind',
    key: 'records',
    version: '1.0.1',
    deps: {
      'cardstack/contracts': '~1.0.0',
      // `~1.1.0`, NOT `~1.0.0`, and the difference cost a runtime failure.
      //
      // 1.0.0 declared `^1.0.0` and sealed to iso@1.1.0, because 1.1.0 was
      // the answer on the day it was published. Writing `~1.0.0` here looked
      // like the more conservative choice and was actually a DOWNGRADE below
      // what this line has always shipped against — and iso@1.0.0 has no
      // `isActive`, which this module calls. It published happily and then
      // threw `isActive is not a function` at render.
      //
      // THE RULE: a backport reproduces the line's existing resolutions. It
      // does not re-derive them from a tighter range, because "tighter" is
      // measured from the bottom of the range and the line is sitting
      // somewhere above it.
      //
      // Worth naming because nothing caught it. The publish gate checks that
      // every range resolves to SOMETHING; it does not check that the
      // something still satisfies the imports the code actually makes. A
      // sealed pin can be internally consistent and still wrong.
      'iso/money-codes': '~1.1.0',
    },
    overrideReason:
      'Backport onto the 1.0 maintenance line, published after 1.2.0. The ' +
      'delta is measured against 1.2.0 because that is the latest, but this ' +
      'Version descends from 1.0.0 and carries one fix and no features.',
    changelog:
      'Patch, on the maintenance line: an invoice that says its own name. ' +
      'Adds `cardTitle` and nothing else. Still no fitted or embedded format ' +
      'on this line, so a linked invoice is still a chip and still visibly ' +
      'poorer than 1.2.0 — which is the point of having both apps in one ' +
      'realm. The difference is now DATED rather than BROKEN, and those read ' +
      'very differently to somebody being shown this.',
  }),
  pass({
    publisher: 'ledgerworks',
    key: 'billing-kit',
    version: '1.0.1',
    deps: {
      'northwind/records': '~1.0.0',
      'cardstack/contracts': '~1.0.0',
      'openkit/controls': '^0.2.0',
    },
    overrideReason:
      'Backport onto the 1.0 maintenance line, published after 1.3.0, for ' +
      'consumers still qualified against 1.0. Descends from 1.0.0.',
    changelog:
      'Patch, on the maintenance line: a case that says its own name, and a ' +
      're-export of the type it links to. The re-export is not cosmetic — ' +
      'without it a consumer resolves `northwind/records` through its own map ' +
      'and gets a different class, which `linksTo` refuses. `~1.0.0` on ' +
      "northwind resolves to that package's own 1.0.1 backport rather than " +
      'to its 1.2.0, which is what keeps this a maintenance release.',
  }),
  // ─── THE MAJOR, PUBLISHED TO BE SEARCHED ACROSS ───────────────────────────
  //
  // Every other Version in this plan is compatible with its predecessor. This
  // one breaks in all four ways a major can — a field kept, a field whose NAME
  // survived but whose shape did not, a rename two levels deep, and a field
  // added — so that "can search unify results across a major boundary" has an
  // answer with real rows behind it instead of an opinion.
  pass({
    publisher: 'northwind',
    key: 'records',
    version: '2.0.0',
    deps: {
      'cardstack/contracts': '^1.0.0',
      'iso/money-codes': '^1.0.0',
    },
    changelog:
      'MAJOR. The record shape moves. `invoiceNumber`, `issuedOn` and `dueOn` ' +
      'survive unchanged. `currency` keeps its NAME and loses its shape — it ' +
      'was a CurrencyCodeField addressed as `currency.code`, and is now the ' +
      'ISO string itself, so a 1.x filter addresses a path that no longer ' +
      "exists. `lines` is renamed `items`, and the line's `description` is " +
      'renamed `label`, so a rename lands at two levels at once. `billTo` is ' +
      'added with no 1.x equivalent, and tax moves from the line to the ' +
      'invoice. Each change is defensible on its own — 1.x stored a one-field ' +
      'object so the code list could hang validation off it, and a plain ISO ' +
      'string consulted at use time is a real simplification. That is what ' +
      'makes a major dangerous: it usually is legitimate.',
  }),
  // ─── THE HOUSE-STYLE PASS ─────────────────────────────────────────────────
  //
  // Seven Versions that change how things are DRAWN and nothing about what
  // they hold. They go out last, together, because a style is a system: a card
  // whose table rules are shadows sitting next to a select whose trigger is
  // still outlined looks like a mistake rather than a transition, and the only
  // way to avoid that half-state is to publish the layer in one pass.
  //
  // Every one of them is a MINOR. Not a patch, because a consumer with a
  // screenshot test will see it; not a major, because no field moves and no
  // export changes. That is the version number doing its actual job — telling
  // a reader how much of their own work this release can disturb.
  //
  // The older Versions all stay published and stay reachable, which is the
  // point: `showcase-1` puts four generations of the money field on one row,
  // and it can only do that if the earlier generations are still there to
  // render. A slice that quietly restyled its history would be claiming the
  // past looked like the present.
  pass({
    publisher: 'cardstack',
    key: 'contracts',
    version: '1.2.0',
    changelog:
      'Minor: the house style reaches the layer that draws money. Field ' +
      'shape is untouched from 1.1.0 — what changes is the EDGE of every ' +
      'control. An input was outlined with a 1px border; it is now a hairline ' +
      'shadow plus a soft inset. A border occupies layout and elevation ' +
      'occupies shadow, so a system using both has two ladders and no way to ' +
      'say which is nearer; using only shadow leaves one. The inset is what ' +
      'makes a field read as recessed — the affordance that says "type here" ' +
      'without a label saying it.',
  }),
  pass({
    publisher: 'iso',
    key: 'money-codes',
    version: '1.3.0',
    changelog:
      'Minor: the code becomes a pill. Same records, same minorUnits, same ' +
      'isActive, same successor chain — the list is untouched. A currency ' +
      'code is a machine value, something a reader may retype or paste into ' +
      'a query, and machine values in this system wear a mono, accent-tinted, ' +
      'ringed pill. The gloss beside it stays prose, so the boundary between ' +
      '"retype this" and "read this" is visible without being explained. ' +
      'Withdrawn codes keep the strike and LOSE the accent: still a machine ' +
      'value, no longer one to reach for.',
  }),
  pass({
    publisher: 'openkit',
    key: 'controls',
    version: '1.1.0',
    changelog:
      'Minor: the last border leaves the building. Behaviour is unchanged ' +
      'from 1.0.0 — still portalled to <body>, still anchored by floating-ui, ' +
      'still multiple selection with chips, still a travelling highlight. ' +
      'This finishes an argument 1.0.0 started and left half-done: the popup ' +
      'already drew its hairline as a shadow, with a comment saying why, ' +
      'while the trigger three hundred lines up still used a border. The ' +
      'control that OPENS a surface was outlined by a different mechanism ' +
      'than the surface itself. Trigger, checkbox and popup are now all ' +
      "shadow; the open trigger grows the system's 3px focus halo; the " +
      'selected checkbox gets the pressed-metal top edge that marks a ' +
      'primary control.',
  }),
  pass({
    publisher: 'northwind',
    key: 'records',
    version: '1.3.0',
    deps: {
      'cardstack/contracts': '^1.0.0',
      'iso/money-codes': '^1.0.0',
    },
    overrideReason:
      'Publishing onto the 1.x line after 2.0.0. The structural pass compares ' +
      'a claim against the latest Version, so it read this as 1.3.0-follows-' +
      '2.0.0 and refused — correctly, because that is not the claim being ' +
      'made. This descends from 1.2.0, and the 1.x line is still maintained ' +
      'because two of the three apps in this realm are pinned to it.',
    changelog:
      "Minor, on the 1.x line: 1.2.0's fields exactly — `lines`, " +
      '`currency.code`, no `billTo` — drawn in the house style. Table rules ' +
      'become inset shadows; the status becomes a ringed chip whose surface ' +
      'and ring are both derived from the one hue the status sets, rather ' +
      'than a wash of currentColor; the withdrawn-code notice stops being a ' +
      'hand-picked brown and derives from the warning hue. Published ' +
      'alongside 2.1.0 on purpose: the slice argues that a realm can hold ' +
      'several generations of one package at once, and that is easier to ' +
      'believe when the generations LOOK like generations.',
  }),
  pass({
    publisher: 'northwind',
    key: 'records',
    version: '2.1.0',
    deps: {
      'cardstack/contracts': '^1.0.0',
      'iso/money-codes': '^1.0.0',
    },
    changelog:
      'Minor on the 2.x line, the same pass as 1.3.0 applied to the broken ' +
      'shape: `items`, flat `currency`, `billTo`, all untouched. 2.0.0 stays ' +
      'published and stays reachable — a version query that spans the major ' +
      'boundary is still spanning the same boundary, and the shape break the ' +
      'query console demonstrates is exactly as awkward as it was.',
  }),
  pass({
    publisher: 'ledgerworks',
    key: 'billing-kit',
    version: '1.4.0',
    deps: {
      'northwind/records': '^1.2.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^0.2.0',
    },
    changelog:
      'Minor, and the structural one. The style pass is small: the case ' +
      "row's rule becomes an inset shadow, its label takes the mono eyebrow " +
      'voice, and the collection STAGE becomes a proper chip. What matters is ' +
      'the reseal — this kit re-exports the `Invoice` its own seal resolved, ' +
      'and that seal now lands on records 1.3.0 rather than 1.2.0. The apps ' +
      'take `Invoice` from the KIT and not from the vendor, precisely so that ' +
      'one class has one resolution, so a restyled 1.x invoice reaches a card ' +
      'only through here. The declared ranges are UNCHANGED: nothing was ' +
      'widened, `^1.2.0` always admitted 1.3.0. `openkit/controls` stays at ' +
      '`^0.2.0` and therefore stays on 0.2.0 — the kit has not re-qualified ' +
      'against the 1.x line, and a style release is not the moment to pretend ' +
      'otherwise. The payment run still shows two majors of that select side ' +
      'by side, one of them now restyled and one of them not, which is a ' +
      'sharper picture of the same fact.',
  }),
  pass({
    publisher: 'acme',
    key: 'rfq-to-payment',
    version: '1.3.0',
    deps: {
      'ledgerworks/billing-kit': '^1.3.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^1.0.0',
    },
    changelog:
      'Minor: the house style on the payment run. The resolved-stack table ' +
      "is this card's whole point — it reads its own pack manifest and " +
      'prints what it actually resolved to — so the table is what gets the ' +
      'pass: rules as inset shadows, headers in the mono eyebrow voice. The ' +
      'pins are not what this touches, so the demonstration underneath is ' +
      'intact: two majors of openkit/controls on one page, one clipped by its ' +
      'container and one escaping to <body>, neither degraded.',
  }),
  // ─── THE ORDERING MISTAKE, KEPT ───────────────────────────────────────────
  //
  // `northwind/records@1.3.0` sits above `ledgerworks/billing-kit@1.4.0` in
  // this file, and on the first run it FAILED there — publishing onto the 1.x
  // line after 2.0.0 needs an `overrideReason`, and it did not have one yet.
  // The kit published anyway, resolved `^1.2.0` against a store that still
  // ended at 1.2.0, and sealed exactly that. Every pin in it is correct and
  // the release is useless: the apps take their `Invoice` from the kit, so a
  // kit sealed against the unstyled invoice ships the unstyled invoice.
  //
  // The failure is left in place rather than tidied away, because it is the
  // clearest demonstration in the slice of what a seal actually means. A
  // Version records what its ranges resolved to ON THE DAY, and a day when a
  // dependency failed to publish is still a day. 1.4.0 cannot be amended; it
  // can only be superseded, which is what these two are.
  //
  // Also worth naming: the publish gate did not consider this an error at all.
  // Every range resolved to something, the pins are internally consistent, and
  // the resulting package is wrong for a reason no range check can see.
  pass({
    publisher: 'ledgerworks',
    key: 'billing-kit',
    version: '1.5.0',
    deps: {
      'northwind/records': '^1.2.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^0.2.0',
    },
    changelog:
      'Minor: identical source to 1.4.0, resealed. The ONLY difference is ' +
      'the pin — `^1.2.0` now resolves to records 1.3.0, where an hour ago ' +
      'it resolved to 1.2.0, because 1.3.0 exists now and did not then. ' +
      'Nothing in the range changed and nothing in the code changed. This is ' +
      'the version number earning its keep: the kit re-exports the `Invoice` ' +
      'class it sealed, so which Version it sealed is a fact about the type ' +
      'every consuming app gets, not an implementation detail.',
  }),
  pass({
    publisher: 'acme',
    key: 'rfq-to-payment',
    version: '1.4.0',
    deps: {
      'ledgerworks/billing-kit': '^1.3.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^1.0.0',
    },
    changelog:
      'Minor: identical source to 1.3.0, resealed onto billing-kit 1.5.0 and ' +
      "therefore onto the restyled 1.x invoice. The run's own resolved-stack " +
      'table is the honest record of this — it prints what this pack actually ' +
      'sealed, so the difference between 1.3.0 and 1.4.0 is legible in the ' +
      'card itself rather than only in a changelog.',
  }),
  // ─── THE STAMP THAT LIED ──────────────────────────────────────────────────
  //
  // 1.2.0 was authored by copying 1.1.0's tree and restyling it. Everything
  // followed except four string literals: the money field prints its own
  // provenance — `$1,200.00  cardstack/contracts 1.1.0` — and that version is
  // TEXT IN THE SOURCE, not something read from the manifest. So 1.2.0 shipped
  // announcing itself as 1.1.0, on the one card in the realm that turns
  // provenance stamps on.
  //
  // This is the second time this exact mistake has been published here; the
  // first was acme's resolved-stack table, and the note above it says it was
  // caught fast. It was caught fast again, and it will happen a third time,
  // because the failure is structural: a version number duplicated into source
  // is a fact stored twice, and copies drift. The durable fix is to read it
  // from the pack manifest the way the payment run reads its dependency table.
  // Until then, this patch.
  pass({
    publisher: 'cardstack',
    key: 'contracts',
    version: '1.2.1',
    changelog:
      'Patch: the version stamp says 1.2.1. It said 1.1.0, because 1.2.0 was ' +
      "authored from 1.1.0's tree and the stamp is a string literal rather " +
      'than something read from the manifest. No other change — same fields, ' +
      'same formats, same edges. A patch precisely because nothing a consumer ' +
      "depends on moved: what moved is the field's account of itself, which " +
      'was wrong.',
  }),
  // Third time. See the note above 1.2.1: the same failure, in the same shape,
  // in a different package — a version number written into a template as text.
  // The payment run's own resolved-stack table, four inches below the wrong
  // label, printed 1.1.0 correctly the whole time, because THAT table reads the
  // pack manifest. One card, both mechanisms, and only the authored one was
  // wrong. That is the argument for deriving it, made better by an accident
  // than it could be made by an essay.
  pass({
    publisher: 'acme',
    key: 'rfq-to-payment',
    version: '1.4.1',
    deps: {
      'ledgerworks/billing-kit': '^1.3.0',
      'cardstack/contracts': '^1.0.0',
      'openkit/controls': '^1.0.0',
    },
    changelog:
      'Patch: the pill over the right-hand select says controls@1.1.0, which ' +
      'is what it has been rendering since 1.4.0 sealed it. It said 1.0.0 — ' +
      'authored text, copied forward from the Version before. Nothing else ' +
      'changed.',
  }),
];

export const PLAN = await Promise.all(
  PASSES.map(async (step) => {
    let dir = join(VERSIONS, `${step.publisher}-${step.key}`, step.version);
    try {
      await stat(dir);
    } catch {
      throw new Error(
        `plan names ${step.publisher}/${step.key}@${step.version} but ` +
          `${relative(HERE, dir)} does not exist`,
      );
    }
    return { ...step, files: await filesUnder(dir) };
  }),
);
