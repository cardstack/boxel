/**
 * Pre-grammar mutation language corpus.
 *
 * These cases deliberately do not run through the BXL compiler yet. They are
 * executable semantic fixtures: each accepted textual program and structured
 * operation program names the same normalized plan, and the plan must turn
 * `before` into `after`. The corpus is intended to settle the language's
 * aesthetics and semantics before its AST and grammar become compatibility
 * commitments.
 */

export type MutationJson =
  | null
  | boolean
  | number
  | string
  | MutationJson[]
  | { [key: string]: MutationJson };

export type MutationPath = Array<string | number>;

export type MutationFeature =
  | 'copy'
  | 'stable-position'
  | 'collection-semantics'
  | 'cardinality'
  | 'evaluation-order'
  | 'returning'
  | 'actor'
  | 'relationship'
  | 'write-set'
  | 'field-root'
  | 'null-vs-delete'
  | 'atomic'
  | 'streaming'
  | 'idempotency'
  | 'authorization';

export type MutationSchemaRef =
  | 'copy-card'
  | 'tag-list-field'
  | 'ordered-sections-field'
  | 'invoice-card'
  | 'workspace-card'
  | 'contest-card'
  | 'classroom-card'
  | 'zine-issue-card'
  | 'query-backed-directory-card'
  | 'reviewers-relationship-field'
  | 'scalar-field';

export interface MutationExecutionFixture {
  language: 'bxl-mutation/1';
  /** Mutation always observes the hydrated Card/Field model, never JSON:API. */
  model: 'loaded-card';
  programId: string;
  target: {
    kind: 'card' | 'field';
    id: string;
    path?: MutationPath;
  };
  delivery: 'complete' | 'streaming';
  transaction: 'atomic' | 'statement';
  syntax: 'readable' | 'jq';
  baseRevision?: string;
  schemaVersion?: string;
  actor?: string;
  returning?: Array<'old' | 'new' | 'changes' | 'affected' | 'paths'>;
}

export interface StructuredMutationOperation {
  id: string;
  op: string;
  [key: string]: unknown;
}

export type MutationPlanIntent =
  | {
      op: 'set';
      path: MutationPath;
      before?: MutationJson;
      after: MutationJson;
    }
  | { op: 'delete'; path: MutationPath; before: MutationJson }
  | {
      op: 'copy';
      from: MutationPath;
      path: MutationPath;
    }
  | {
      op: 'insert';
      collection: MutationPath;
      index: number;
      value: MutationJson;
    }
  | {
      op: 'move';
      from: MutationPath;
      toCollection: MutationPath;
      toIndex: number;
    }
  | {
      op: 'reorder';
      collection: MutationPath;
      key: MutationPath;
      order: Array<null | boolean | number | string>;
    }
  | {
      op: 'relate';
      field: MutationPath;
      cardId: string;
      index?: number;
    }
  | {
      op: 'unrelate';
      field: MutationPath;
      cardId: string;
    }
  | {
      op: 'move-relation';
      field: MutationPath;
      cardId: string;
      toIndex: number;
    };

export interface MutationPlanStatementFixture {
  canonical: string;
  affected: number;
  intents: MutationPlanIntent[];
}

interface MutationFixtureBase {
  id: string;
  group: string;
  name: string;
  intent: string;
  features: MutationFeature[];
  schema: MutationSchemaRef;
  execution: MutationExecutionFixture;
  before: MutationJson;
  /** Human-facing BXL readable spelling before schema-aware solidification. */
  readableSource?: string;
  /** Candidate BXL/jq surface syntax. Every statement is semicolon framed. */
  source: string;
  /** JSON-schema-friendly source encoding with equivalent semantics. */
  operations: StructuredMutationOperation[];
  /** Hydrated Card projections available to `card(id)` through the Card Store. */
  store?: Record<string, MutationJson>;
  /** Optional streaming chunks; concatenation must equal `source`. */
  chunks?: string[];
  notes?: string[];
}

export interface AcceptedMutationFixture extends MutationFixtureBase {
  outcome: 'accepted';
  readableSource: string;
  plan: MutationPlanStatementFixture[];
  after: MutationJson;
  expectedReturning?: MutationJson;
}

export interface RejectedMutationFixture extends MutationFixtureBase {
  outcome: 'rejected';
  error: {
    phase: 'parse' | 'plan' | 'validate' | 'authorize' | 'commit';
    code: string;
    statement: number;
  };
  committedStatements?: number;
}

export type BxlMutationExample =
  | AcceptedMutationFixture
  | RejectedMutationFixture;

export const mutationSchemaFixtures = {
  'copy-card': {
    root: 'card',
    fields: {
      billingAddress: { kind: 'compound', label: 'Billing Address' },
      shippingAddress: { kind: 'compound', label: 'Shipping Address', optional: true },
    },
  },
  'tag-list-field': {
    root: 'field',
    field: { kind: 'containsMany', item: 'string', loadedAs: 'string[]' },
  },
  'ordered-sections-field': {
    root: 'field',
    field: {
      kind: 'containsMany',
      loadedAs: 'SectionField[]',
      label: 'Section',
      itemFields: { id: { label: 'ID' }, title: { label: 'Title' } },
    },
  },
  'invoice-card': {
    root: 'card',
    fields: {
      title: { kind: 'string' },
      status: { kind: 'string' },
      note: { kind: 'string', optional: true, nullable: true },
      count: { kind: 'number' },
      quantity: { kind: 'number' },
      unitPrice: { kind: 'number', label: 'Unit Price' },
      subtotal: { kind: 'number' },
      shipping: { kind: 'number' },
      total: { kind: 'number' },
      lineItems: {
        kind: 'containsMany',
        loadedAs: 'LineItemField[]',
        label: 'Line Item',
        itemFields: {
          sku: { label: 'SKU' },
          quantity: { label: 'Quantity' },
          taxable: { label: 'Taxable' },
          discount: { label: 'Discount' },
        },
      },
    },
  },
  'reviewers-relationship-field': {
    root: 'field',
    field: {
      kind: 'linksToMany',
      loadedAs: 'CardDef[]',
      label: 'Reviewer',
    },
  },
  'workspace-card': {
    root: 'card',
    sourceEvidence: 'exports/Realm-Collaboration/workspace.gts and index.json',
    fields: {
      signage: { kind: 'string' },
      entryPoints: {
        kind: 'linksToMany',
        loadedAs: 'CardDef[]',
        label: 'Entry Point',
      },
    },
  },
  'contest-card': {
    root: 'card',
    sourceEvidence: 'exports/Realm-Collaboration/policy.gts and Contest/spring-2026.json',
    fields: {
      submissions: {
        kind: 'linksToMany',
        loadedAs: 'Submission[]',
      },
      winner: {
        kind: 'linksTo',
        loadedAs: 'Submission | undefined',
        label: 'Winner',
      },
    },
  },
  'classroom-card': {
    root: 'card',
    sourceEvidence: 'stack.cards/ctse/tribeca-lms/directory.gts and Classroom/classroom-6.json',
    fields: {
      name: { kind: 'string' },
      roomNumber: { kind: 'string' },
      leadTeacher: { kind: 'linksTo', loadedAs: 'StaffMember | undefined' },
      staff: { kind: 'linksToMany', loadedAs: 'StaffMember[]' },
      students: { kind: 'linksToMany', loadedAs: 'Student[]' },
      scheduleItems: {
        kind: 'containsMany',
        loadedAs: 'ScheduleItemField[]',
        label: 'Schedule Item',
        itemFields: { time: { label: 'Time' }, status: { label: 'Status' } },
      },
    },
  },
  'zine-issue-card': {
    root: 'card',
    sourceEvidence: 'stack.cards/ctse/commonplace-lab/zine-issue.gts and ZineIssue/issue-01.json',
    fields: {
      title: { kind: 'string' },
      fragments: {
        kind: 'linksToMany',
        loadedAs: 'SavedFragment[]',
        label: 'Fragment',
      },
      clusters: { kind: 'linksToMany', loadedAs: 'ThemeCluster[]' },
    },
  },
  'query-backed-directory-card': {
    root: 'card',
    sourceEvidence: 'query-backed linksToMany StudentDirectory pattern',
    fields: {
      students: {
        kind: 'linksToMany',
        loadedAs: 'Student[]',
        membership: 'query',
        writable: false,
      },
    },
  },
  'scalar-field': {
    root: 'field',
    field: { kind: 'number' },
  },
} as const;

function execution(
  id: string,
  target: MutationExecutionFixture['target'],
  overrides: Partial<MutationExecutionFixture> = {},
): MutationExecutionFixture {
  return {
    language: 'bxl-mutation/1',
    model: 'loaded-card',
    programId: `fixture:${id}`,
    target,
    delivery: 'complete',
    transaction: 'atomic',
    syntax: 'readable',
    ...overrides,
  };
}

const cardTarget = { kind: 'card' as const, id: 'card:invoice-1' };
const sectionsTarget = { kind: 'field' as const, id: 'field:sections' };
const tagsTarget = { kind: 'field' as const, id: 'field:tags' };
const reviewersTarget = { kind: 'field' as const, id: 'field:reviewers' };
const scalarTarget = { kind: 'field' as const, id: 'field:score' };

export const bxlMutationExamples: BxlMutationExample[] = [
  {
    id: 'copy-compound-field',
    group: '01 copy',
    name: 'copy a compound value without reprinting it',
    intent: 'Copy billingAddress into shippingAddress as an independent value.',
    features: ['copy', 'write-set'],
    schema: 'copy-card',
    execution: execution('copy-compound-field', cardTarget),
    before: {
      billingAddress: { city: 'Boston', country: 'US' },
      shippingAddress: null,
    },
    readableSource: 'copy_to("Billing Address", "Shipping Address");',
    source: 'copy_to(.billingAddress; .shippingAddress);',
    operations: [
      {
        id: 'copy-address',
        op: 'copy',
        from: { path: ['billingAddress'] },
        target: { path: ['shippingAddress'] },
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'copy_to(.billingAddress;.shippingAddress)',
        affected: 1,
        intents: [
          {
            op: 'copy',
            from: ['billingAddress'],
            path: ['shippingAddress'],
          },
        ],
      },
    ],
    after: {
      billingAddress: { city: 'Boston', country: 'US' },
      shippingAddress: { city: 'Boston', country: 'US' },
    },
    notes: ['Copy is deep by value; it never creates an alias between fields.'],
  },
  {
    id: 'append-contained-value',
    group: '02 containsMany collections',
    name: 'append a value to a containsMany field',
    intent: 'Add urgent to the ordered tags Field without inventing set semantics.',
    features: ['field-root', 'collection-semantics'],
    schema: 'tag-list-field',
    execution: execution('append-contained-value', tagsTarget),
    before: ['customer', 'legal'],
    readableSource: 'append(., "urgent");',
    source: 'append(.; "urgent");',
    operations: [{ id: 'append-urgent', op: 'insert', into: { path: [] }, position: { at: 'end' }, value: 'urgent' }],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'append(.;"urgent")',
        affected: 1,
        intents: [{ op: 'insert', collection: [], index: 2, value: 'urgent' }],
      },
    ],
    after: ['customer', 'legal', 'urgent'],
    notes: ['containsMany is ordered and permits repeated values; BXL preserves that behavior.'],
  },
  {
    id: 'delete-contained-value',
    group: '02 containsMany collections',
    name: 'delete one selected containsMany value',
    intent: 'Remove one obsolete tag using ordinary loaded-array selection.',
    features: ['field-root', 'collection-semantics', 'cardinality'],
    schema: 'tag-list-field',
    execution: execution('delete-contained-value', tagsTarget),
    before: ['customer', 'obsolete', 'urgent'],
    readableSource: 'del(.[] | select(. = "obsolete"));',
    source: 'del(.[] | select(. == "obsolete"));',
    operations: [
      {
        id: 'delete-obsolete',
        op: 'delete',
        target: { collection: [], where: [{ path: [], equals: 'obsolete' }] },
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'del(.[]|select(.=="obsolete"))',
        affected: 1,
        intents: [{ op: 'delete', path: [1], before: 'obsolete' }],
      },
    ],
    after: ['customer', 'urgent'],
    notes: ['Exact-one cardinality rejects ambiguous duplicate matches; delete_all makes bulk removal explicit.'],
  },
  {
    id: 'insert-after-stable-anchor',
    group: '03 stable positioning',
    name: 'insert after an identity-selected item',
    intent: 'Insert the details section after overview without using an index.',
    features: ['stable-position', 'collection-semantics', 'write-set'],
    schema: 'ordered-sections-field',
    execution: execution('insert-after-stable-anchor', sectionsTarget),
    before: [
      { id: 'overview', title: 'Overview' },
      { id: 'summary', title: 'Summary' },
    ],
    readableSource: 'insert_after(Section[ID = "overview"], {id: "details", title: "Details"});',
    source: 'insert_after(.[] | select(.id == "overview"); {id: "details", title: "Details"});',
    operations: [
      {
        id: 'insert-details',
        op: 'insert',
        into: { path: [] },
        position: { after: { collection: [], where: [{ path: ['id'], equals: 'overview' }] } },
        value: { id: 'details', title: 'Details' },
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'insert_after(.[]|select(.id=="overview");{id:"details",title:"Details"})',
        affected: 1,
        intents: [
          {
            op: 'insert',
            collection: [],
            index: 1,
            value: { id: 'details', title: 'Details' },
          },
        ],
      },
    ],
    after: [
      { id: 'overview', title: 'Overview' },
      { id: 'details', title: 'Details' },
      { id: 'summary', title: 'Summary' },
    ],
  },
  {
    id: 'move-before-stable-anchor',
    group: '03 stable positioning',
    name: 'move an item before a stable anchor',
    intent: 'Move summary before round-one while retaining move intent.',
    features: ['stable-position', 'collection-semantics', 'write-set'],
    schema: 'ordered-sections-field',
    execution: execution('move-before-stable-anchor', sectionsTarget),
    before: [
      { id: 'overview', title: 'Overview' },
      { id: 'round-one', title: 'Round One' },
      { id: 'summary', title: 'Summary' },
    ],
    readableSource: 'move_item_before(Section[ID = "summary"], Section[ID = "round-one"]);',
    source: 'move_item_before(.[] | select(.id == "summary"); .[] | select(.id == "round-one"));',
    operations: [
      {
        id: 'move-summary',
        op: 'move',
        target: { collection: [], where: [{ path: ['id'], equals: 'summary' }] },
        into: { path: [] },
        position: { before: { collection: [], where: [{ path: ['id'], equals: 'round-one' }] } },
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'move_item_before(.[]|select(.id=="summary");.[]|select(.id=="round-one"))',
        affected: 1,
        intents: [{ op: 'move', from: [2], toCollection: [], toIndex: 1 }],
      },
    ],
    after: [
      { id: 'overview', title: 'Overview' },
      { id: 'summary', title: 'Summary' },
      { id: 'round-one', title: 'Round One' },
    ],
  },
  {
    id: 'exact-reorder',
    group: '03 stable positioning',
    name: 'apply an exact identity permutation',
    intent: 'Rearrange all sections without inserting, deleting, or replacing them.',
    features: ['stable-position', 'collection-semantics', 'atomic'],
    schema: 'ordered-sections-field',
    execution: execution('exact-reorder', sectionsTarget),
    before: [
      { id: 'overview', title: 'Overview' },
      { id: 'round-one', title: 'Round One' },
      { id: 'summary', title: 'Summary' },
    ],
    readableSource: 'reorder_by(Section, ID, ["summary", "overview", "round-one"]);',
    source: 'reorder_by(.; .id; ["summary", "overview", "round-one"]);',
    operations: [
      {
        id: 'reorder-sections',
        op: 'reorder',
        target: { path: [] },
        key: ['id'],
        order: ['summary', 'overview', 'round-one'],
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'reorder_by(.;.id;["summary","overview","round-one"])',
        affected: 3,
        intents: [
          {
            op: 'reorder',
            collection: [],
            key: ['id'],
            order: ['summary', 'overview', 'round-one'],
          },
        ],
      },
    ],
    after: [
      { id: 'summary', title: 'Summary' },
      { id: 'overview', title: 'Overview' },
      { id: 'round-one', title: 'Round One' },
    ],
  },
  {
    id: 'exact-one-selected-update',
    group: '04 cardinality',
    name: 'jq update assignment requires exactly one selected field',
    intent: 'Increment the quantity of COPY-03 and no other line item.',
    features: ['cardinality', 'write-set'],
    schema: 'invoice-card',
    execution: execution('exact-one-selected-update', cardTarget),
    before: {
      lineItems: [
        { sku: 'PAPER-01', quantity: 2 },
        { sku: 'COPY-03', quantity: 3 },
      ],
    },
    readableSource: '"Line Item"[SKU = "COPY-03"].Quantity += 1;',
    source: '(.lineItems[] | select(.sku == "COPY-03") | .quantity) |= . + 1;',
    operations: [
      {
        id: 'increment-copy-03',
        op: 'update',
        target: {
          collection: ['lineItems'],
          where: [{ path: ['sku'], equals: 'COPY-03' }],
          relativePath: ['quantity'],
        },
        expression: '. + 1',
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: '(.lineItems[]|select(.sku=="COPY-03")|.quantity)|=.+1',
        affected: 1,
        intents: [{ op: 'set', path: ['lineItems', 1, 'quantity'], before: 3, after: 4 }],
      },
    ],
    after: {
      lineItems: [
        { sku: 'PAPER-01', quantity: 2 },
        { sku: 'COPY-03', quantity: 4 },
      ],
    },
  },
  {
    id: 'explicit-bulk-update',
    group: '04 cardinality',
    name: 'bulk intent is explicit at the statement boundary',
    intent: 'Increase the discount of every taxable line item.',
    features: ['cardinality', 'write-set'],
    schema: 'invoice-card',
    execution: execution('explicit-bulk-update', cardTarget),
    before: {
      lineItems: [
        { sku: 'PAPER-01', taxable: true, discount: 0 },
        { sku: 'SERVICE-01', taxable: false, discount: 0 },
        { sku: 'COPY-03', taxable: true, discount: 0.1 },
      ],
    },
    readableSource: 'update_all("Line Item"[* Taxable].Discount, . + 0.05);',
    source: 'update_all(.lineItems[] | select(.taxable) | .discount; . + 0.05);',
    operations: [
      {
        id: 'discount-taxable',
        op: 'update-all',
        target: {
          collection: ['lineItems'],
          where: [{ path: ['taxable'], equals: true }],
          relativePath: ['discount'],
        },
        expression: '. + 0.05',
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'update_all(.lineItems[]|select(.taxable)|.discount;.+0.05)',
        affected: 2,
        intents: [
          { op: 'set', path: ['lineItems', 0, 'discount'], before: 0, after: 0.05 },
          { op: 'set', path: ['lineItems', 2, 'discount'], before: 0.1, after: 0.15 },
        ],
      },
    ],
    after: {
      lineItems: [
        { sku: 'PAPER-01', taxable: true, discount: 0.05 },
        { sku: 'SERVICE-01', taxable: false, discount: 0 },
        { sku: 'COPY-03', taxable: true, discount: 0.15 },
      ],
    },
  },
  {
    id: 'sequential-statement-evaluation',
    group: '05 evaluation order',
    name: 'later statements observe earlier statement output',
    intent: 'Recalculate subtotal and then calculate total from the new subtotal.',
    features: ['evaluation-order', 'atomic'],
    schema: 'invoice-card',
    execution: execution('sequential-statement-evaluation', cardTarget),
    before: { quantity: 3, unitPrice: 20, subtotal: 50, shipping: 5, total: 55 },
    readableSource: 'Subtotal = (Quantity * "Unit Price");\nTotal = (Subtotal + Shipping);',
    source: '.subtotal = (.quantity * .unitPrice);\n.total = (.subtotal + .shipping);',
    operations: [
      {
        id: 'calculate-subtotal',
        op: 'set',
        target: { path: ['subtotal'] },
        expression: '.quantity * .unitPrice',
      },
      {
        id: 'calculate-total',
        op: 'set',
        target: { path: ['total'] },
        expression: '.subtotal + .shipping',
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: '.subtotal=(.quantity*.unitPrice)',
        affected: 1,
        intents: [{ op: 'set', path: ['subtotal'], before: 50, after: 60 }],
      },
      {
        canonical: '.total=(.subtotal+.shipping)',
        affected: 1,
        intents: [{ op: 'set', path: ['total'], before: 55, after: 65 }],
      },
    ],
    after: { quantity: 3, unitPrice: 20, subtotal: 60, shipping: 5, total: 65 },
  },
  {
    id: 'assert-then-update',
    group: '05 evaluation order',
    name: 'assertion is a no-write precondition',
    intent: 'Publish only if the card is still a draft.',
    features: ['evaluation-order', 'atomic'],
    schema: 'invoice-card',
    execution: execution('assert-then-update', cardTarget),
    before: { status: 'draft' },
    readableSource: 'assert(Status = "draft", "must still be a draft");\nStatus = "published";',
    source: 'assert(.status == "draft"; "must still be a draft");\n.status = "published";',
    operations: [
      { id: 'still-draft', op: 'assert', expression: '.status == "draft"', message: 'must still be a draft' },
      { id: 'publish', op: 'set', target: { path: ['status'] }, value: 'published' },
    ],
    outcome: 'accepted',
    plan: [
      { canonical: 'assert(.status=="draft";"must still be a draft")', affected: 0, intents: [] },
      {
        canonical: '.status="published"',
        affected: 1,
        intents: [{ op: 'set', path: ['status'], before: 'draft', after: 'published' }],
      },
    ],
    after: { status: 'published' },
  },
  {
    id: 'returning-projection',
    group: '06 returning',
    name: 'returning is selected by the execution envelope',
    intent: 'Return old/new values, affected count, paths, and changes after a terse edit.',
    features: ['returning', 'write-set'],
    schema: 'invoice-card',
    execution: execution('returning-projection', cardTarget, {
      returning: ['old', 'new', 'changes', 'affected', 'paths'],
    }),
    before: { title: 'Draft' },
    readableSource: 'Title = "Final";',
    source: '.title = "Final";',
    operations: [{ id: 'rename', op: 'set', target: { path: ['title'] }, value: 'Final' }],
    outcome: 'accepted',
    plan: [
      {
        canonical: '.title="Final"',
        affected: 1,
        intents: [{ op: 'set', path: ['title'], before: 'Draft', after: 'Final' }],
      },
    ],
    after: { title: 'Final' },
    expectedReturning: {
      old: { title: 'Draft' },
      new: { title: 'Final' },
      affected: 1,
      paths: [['title']],
      changes: [{ op: 'set', path: ['title'], before: 'Draft', after: 'Final' }],
    },
    notes: ['Keeping returning in the envelope avoids adding a non-mutating statement form.'],
  },
  {
    id: 'actor-revision-and-idempotency',
    group: '07 execution envelope',
    name: 'actor, revision, and program identity accompany the mutation',
    intent: 'Attribute and compare-and-swap a status transition without changing statement syntax.',
    features: ['actor', 'idempotency', 'write-set'],
    schema: 'invoice-card',
    execution: execution('actor-revision-and-idempotency', cardTarget, {
      actor: 'assistant:thread-42',
      baseRevision: 'rev-7',
      schemaVersion: 'invoice/3',
    }),
    before: { status: 'draft' },
    readableSource: 'Status = "review";',
    source: '.status = "review";',
    operations: [{ id: 'request-review', op: 'set', target: { path: ['status'] }, value: 'review' }],
    outcome: 'accepted',
    plan: [
      {
        canonical: '.status="review"',
        affected: 1,
        intents: [{ op: 'set', path: ['status'], before: 'draft', after: 'review' }],
      },
    ],
    after: { status: 'review' },
  },
  {
    id: 'relate-card',
    group: '08 relationships',
    name: 'append a loaded Card to linksToMany',
    intent: 'Resolve Grace through the Card Store and append her to the loaded reviewers field.',
    features: ['relationship', 'write-set'],
    schema: 'reviewers-relationship-field',
    execution: execution('relate-card', reviewersTarget),
    before: [{ id: 'card:ada', cardTitle: 'Ada' }],
    readableSource: 'append(., card("card:grace"));',
    source: 'append(.; card("card:grace"));',
    operations: [{ id: 'relate-grace', op: 'relate', target: { path: [] }, cardId: 'card:grace' }],
    store: {
      'card:grace': { id: 'card:grace', cardTitle: 'Grace' },
    },
    outcome: 'accepted',
    plan: [
      {
        canonical: 'append(.;card("card:grace"))',
        affected: 1,
        intents: [{ op: 'relate', field: [], cardId: 'card:grace', index: 1 }],
      },
    ],
    after: [
      { id: 'card:ada', cardTitle: 'Ada' },
      { id: 'card:grace', cardTitle: 'Grace' },
    ],
    notes: [
      'The textual form treats linksToMany as its loaded array value.',
      'Schema-directed lowering turns append into a relate intent instead of a JSON array insert.',
    ],
  },
  {
    id: 'unrelate-card',
    group: '08 relationships',
    name: 'remove a relationship edge by identity',
    intent: 'Remove Ada from reviewers without deleting or rewriting Ada.',
    features: ['relationship', 'write-set'],
    schema: 'reviewers-relationship-field',
    execution: execution('unrelate-card', reviewersTarget),
    before: [
      { id: 'card:ada', cardTitle: 'Ada' },
      { id: 'card:grace', cardTitle: 'Grace' },
    ],
    readableSource: 'del(Reviewer[ID = "card:ada"]);',
    source: 'del(.[] | select(.id == "card:ada"));',
    operations: [{ id: 'unrelate-ada', op: 'unrelate', target: { path: [] }, cardId: 'card:ada' }],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'del(.[]|select(.id=="card:ada"))',
        affected: 1,
        intents: [{ op: 'unrelate', field: [], cardId: 'card:ada' }],
      },
    ],
    after: [{ id: 'card:grace', cardTitle: 'Grace' }],
    notes: ['Schema-directed lowering turns deletion of a linked item into unrelate.'],
  },
  {
    id: 'move-relationship',
    group: '08 relationships',
    name: 'reorder an edge without rewriting relationship values',
    intent: 'Move Grace before Ada in an ordered relationship field.',
    features: ['relationship', 'stable-position', 'write-set'],
    schema: 'reviewers-relationship-field',
    execution: execution('move-relationship', reviewersTarget),
    before: [{ id: 'card:ada' }, { id: 'card:grace' }, { id: 'card:lin' }],
    readableSource: 'move_item_before(Reviewer[ID = "card:grace"], Reviewer[ID = "card:ada"]);',
    source: 'move_item_before(.[] | select(.id == "card:grace"); .[] | select(.id == "card:ada"));',
    operations: [
      {
        id: 'prioritize-grace',
        op: 'move-relation',
        target: { path: [] },
        cardId: 'card:grace',
        position: { before: { collection: [], where: [{ path: ['id'], equals: 'card:ada' }] } },
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'move_item_before(.[]|select(.id=="card:grace");.[]|select(.id=="card:ada"))',
        affected: 1,
        intents: [{ op: 'move-relation', field: [], cardId: 'card:grace', toIndex: 0 }],
      },
    ],
    after: [{ id: 'card:grace' }, { id: 'card:ada' }, { id: 'card:lin' }],
    notes: ['The same move syntax works for containsMany and linksToMany; the plan intent differs.'],
  },
  {
    id: 'workspace-append-entry-point',
    group: '08 relationships',
    name: 'append a real Workspace entry point through the Card Store',
    intent: 'Pin the collaboration stage Card without authoring entryPoints.N JSON:API keys.',
    features: ['relationship', 'collection-semantics', 'write-set'],
    schema: 'workspace-card',
    execution: execution('workspace-append-entry-point', { kind: 'card', id: 'card:workspace' }),
    before: {
      signage: 'REALM COLLABORATION',
      entryPoints: [
        { id: 'card:architecture', cardTitle: 'Consistency Architecture' },
        { id: 'card:attendance', cardTitle: 'Staff Attendance' },
      ],
    },
    readableSource: 'append("Entry Point", card("card:collab-stage"));',
    source: 'append(.entryPoints; card("card:collab-stage"));',
    operations: [
      {
        id: 'pin-collab-stage',
        op: 'relate',
        target: { path: ['entryPoints'] },
        cardId: 'card:collab-stage',
        position: { at: 'end' },
      },
    ],
    store: {
      'card:collab-stage': { id: 'card:collab-stage', cardTitle: 'Collaboration Stage' },
    },
    outcome: 'accepted',
    plan: [
      {
        canonical: 'append(.entryPoints;card("card:collab-stage"))',
        affected: 1,
        intents: [
          { op: 'relate', field: ['entryPoints'], cardId: 'card:collab-stage', index: 2 },
        ],
      },
    ],
    after: {
      signage: 'REALM COLLABORATION',
      entryPoints: [
        { id: 'card:architecture', cardTitle: 'Consistency Architecture' },
        { id: 'card:attendance', cardTitle: 'Staff Attendance' },
        { id: 'card:collab-stage', cardTitle: 'Collaboration Stage' },
      ],
    },
    notes: [
      'Based on the Workspace CardDef assigning a new CardDef[] to entryPoints.',
      'The persistence adapter alone serializes the result as entryPoints.0, entryPoints.1, and entryPoints.2.',
    ],
  },
  {
    id: 'contest-set-singular-link',
    group: '08 relationships',
    name: 'assign a loaded Card to linksTo',
    intent: 'Select the winning Submission through the Card Store.',
    features: ['relationship', 'write-set'],
    schema: 'contest-card',
    execution: execution('contest-set-singular-link', { kind: 'card', id: 'card:contest/spring-2026' }),
    before: {
      submissions: [{ id: 'card:submission/tidal', cardTitle: 'Tidal' }],
    },
    readableSource: 'Winner = card("card:submission/tidal");',
    source: '.winner = card("card:submission/tidal");',
    operations: [
      {
        id: 'select-winner',
        op: 'relate',
        target: { path: ['winner'] },
        cardId: 'card:submission/tidal',
      },
    ],
    store: {
      'card:submission/tidal': { id: 'card:submission/tidal', cardTitle: 'Tidal' },
    },
    outcome: 'accepted',
    plan: [
      {
        canonical: '.winner=card("card:submission/tidal")',
        affected: 1,
        intents: [{ op: 'relate', field: ['winner'], cardId: 'card:submission/tidal' }],
      },
    ],
    after: {
      submissions: [{ id: 'card:submission/tidal', cardTitle: 'Tidal' }],
      winner: { id: 'card:submission/tidal', cardTitle: 'Tidal' },
    },
    notes: ['The raw instance uses winner.links.self; the mutation surface sees winner as a loaded Submission.'],
  },
  {
    id: 'classroom-update-contained-schedule',
    group: '08 real Card shapes',
    name: 'edit containsMany beside loaded relationships',
    intent: 'Mark the current classroom schedule item done without touching staff or students.',
    features: ['cardinality', 'write-set'],
    schema: 'classroom-card',
    execution: execution('classroom-update-contained-schedule', { kind: 'card', id: 'card:classroom-6' }),
    before: {
      name: 'Classroom 6',
      staff: [{ id: 'card:staff/dana', cardTitle: 'Dana Rivers' }],
      students: [{ id: 'card:student/jamie', cardTitle: 'Jamie Chen' }],
      scheduleItems: [
        { time: '12:00 PM', activity: 'Lunch', status: 'done' },
        { time: '1:00 PM', activity: 'OT push-in', status: 'current' },
      ],
    },
    readableSource: '"Schedule Item"[Time = "1:00 PM"].Status = "done";',
    source: '(.scheduleItems[] | select(.time == "1:00 PM") | .status) = "done";',
    operations: [
      {
        id: 'complete-current-schedule-item',
        op: 'set',
        target: {
          collection: ['scheduleItems'],
          where: [{ path: ['time'], equals: '1:00 PM' }],
          relativePath: ['status'],
        },
        value: 'done',
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: '(.scheduleItems[]|select(.time=="1:00 PM")|.status)="done"',
        affected: 1,
        intents: [
          { op: 'set', path: ['scheduleItems', 1, 'status'], before: 'current', after: 'done' },
        ],
      },
    ],
    after: {
      name: 'Classroom 6',
      staff: [{ id: 'card:staff/dana', cardTitle: 'Dana Rivers' }],
      students: [{ id: 'card:student/jamie', cardTitle: 'Jamie Chen' }],
      scheduleItems: [
        { time: '12:00 PM', activity: 'Lunch', status: 'done' },
        { time: '1:00 PM', activity: 'OT push-in', status: 'done' },
      ],
    },
    notes: ['Schema-directed lowering keeps this a contained leaf set, unlike linksToMany edits.'],
  },
  {
    id: 'zine-reorder-linked-fragments',
    group: '08 real Card shapes',
    name: 'reorder real linksToMany cards with ordinary move syntax',
    intent: 'Lead the issue with the personal-web fragment while preserving loaded fragment Cards.',
    features: ['relationship', 'stable-position', 'write-set'],
    schema: 'zine-issue-card',
    execution: execution('zine-reorder-linked-fragments', { kind: 'card', id: 'card:zine/issue-01' }),
    before: {
      title: 'Small Audiences, Real Rooms',
      fragments: [
        { id: 'card:fragment/opposite-viral', cardTitle: 'The Opposite of Going Viral' },
        { id: 'card:fragment/supper', cardTitle: 'Supper as a Small Public' },
        { id: 'card:fragment/personal-web', cardTitle: 'The Personal Web' },
      ],
    },
    readableSource: 'move_item_before("Fragment"[ID = "card:fragment/personal-web"], "Fragment"[ID = "card:fragment/opposite-viral"]);',
    source: 'move_item_before(.fragments[] | select(.id == "card:fragment/personal-web"); .fragments[] | select(.id == "card:fragment/opposite-viral"));',
    operations: [
      {
        id: 'lead-with-personal-web',
        op: 'move-relation',
        target: { path: ['fragments'] },
        cardId: 'card:fragment/personal-web',
        position: {
          before: {
            collection: ['fragments'],
            where: [{ path: ['id'], equals: 'card:fragment/opposite-viral' }],
          },
        },
      },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'move_item_before(.fragments[]|select(.id=="card:fragment/personal-web");.fragments[]|select(.id=="card:fragment/opposite-viral"))',
        affected: 1,
        intents: [
          {
            op: 'move-relation',
            field: ['fragments'],
            cardId: 'card:fragment/personal-web',
            toIndex: 0,
          },
        ],
      },
    ],
    after: {
      title: 'Small Audiences, Real Rooms',
      fragments: [
        { id: 'card:fragment/personal-web', cardTitle: 'The Personal Web' },
        { id: 'card:fragment/opposite-viral', cardTitle: 'The Opposite of Going Viral' },
        { id: 'card:fragment/supper', cardTitle: 'Supper as a Small Public' },
      ],
    },
  },
  {
    id: 'authorization-write-set',
    group: '09 normalized write set',
    name: 'authorization receives concrete leaf intents',
    intent: 'Change two fields while exposing their old and new values to policy.',
    features: ['write-set', 'authorization', 'atomic'],
    schema: 'invoice-card',
    execution: execution('authorization-write-set', cardTarget, { actor: 'user:ada' }),
    before: { status: 'draft', title: 'Quarterly report' },
    readableSource: 'Status = "review";\nTitle = (Title + " — reviewed");',
    source: '.status = "review";\n.title = (.title + " — reviewed");',
    operations: [
      { id: 'status-review', op: 'set', target: { path: ['status'] }, value: 'review' },
      { id: 'mark-title', op: 'set', target: { path: ['title'] }, expression: '.title + " — reviewed"' },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: '.status="review"',
        affected: 1,
        intents: [{ op: 'set', path: ['status'], before: 'draft', after: 'review' }],
      },
      {
        canonical: '.title=(.title+" — reviewed")',
        affected: 1,
        intents: [
          {
            op: 'set',
            path: ['title'],
            before: 'Quarterly report',
            after: 'Quarterly report — reviewed',
          },
        ],
      },
    ],
    after: { status: 'review', title: 'Quarterly report — reviewed' },
  },
  {
    id: 'streaming-statement-commits',
    group: '10 delivery and transactions',
    name: 'complete statements commit progressively',
    intent: 'Apply two independently framed edits in one undo session.',
    features: ['streaming', 'evaluation-order', 'write-set'],
    schema: 'invoice-card',
    execution: execution('streaming-statement-commits', cardTarget, {
      delivery: 'streaming',
      transaction: 'statement',
      baseRevision: 'rev-1',
    }),
    before: { status: 'draft', count: 1 },
    readableSource: 'Status = "review";\nCount += 1;',
    source: '.status = "review";\n.count |= . + 1;',
    chunks: ['.status = "rev', 'iew";\n.count ', '|= . + ', '1;'],
    operations: [
      { id: 'review', op: 'set', target: { path: ['status'] }, value: 'review' },
      { id: 'increment', op: 'update', target: { path: ['count'] }, expression: '. + 1' },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: '.status="review"',
        affected: 1,
        intents: [{ op: 'set', path: ['status'], before: 'draft', after: 'review' }],
      },
      {
        canonical: '.count|=.+1',
        affected: 1,
        intents: [{ op: 'set', path: ['count'], before: 1, after: 2 }],
      },
    ],
    after: { status: 'review', count: 2 },
  },
  {
    id: 'streaming-atomic-semicolon-string',
    group: '10 delivery and transactions',
    name: 'semicolon inside a string does not frame a statement',
    intent: 'Buffer two streamed statements and commit them atomically.',
    features: ['streaming', 'atomic'],
    schema: 'invoice-card',
    execution: execution('streaming-atomic-semicolon-string', cardTarget, {
      delivery: 'streaming',
      transaction: 'atomic',
    }),
    before: { note: null, status: 'draft' },
    readableSource: 'Note = "keep; this semicolon";\nStatus = "ready";',
    source: '.note = "keep; this semicolon";\n.status = "ready";',
    chunks: ['.note = "keep;', ' this semi', 'colon";\n.status = ', '"ready";'],
    operations: [
      { id: 'note', op: 'set', target: { path: ['note'] }, value: 'keep; this semicolon' },
      { id: 'ready', op: 'set', target: { path: ['status'] }, value: 'ready' },
    ],
    outcome: 'accepted',
    plan: [
      {
        canonical: '.note="keep; this semicolon"',
        affected: 1,
        intents: [{ op: 'set', path: ['note'], before: null, after: 'keep; this semicolon' }],
      },
      {
        canonical: '.status="ready"',
        affected: 1,
        intents: [{ op: 'set', path: ['status'], before: 'draft', after: 'ready' }],
      },
    ],
    after: { note: 'keep; this semicolon', status: 'ready' },
  },
  {
    id: 'field-root-update',
    group: '11 arbitrary roots',
    name: 'a scalar Field root can be updated',
    intent: 'Increment a scalar Field without knowing its containing Card path.',
    features: ['field-root', 'write-set'],
    schema: 'scalar-field',
    execution: execution('field-root-update', scalarTarget),
    before: 41,
    readableSource: '. += 1;',
    source: '. |= . + 1;',
    operations: [{ id: 'increment-score', op: 'update', target: { path: [] }, expression: '. + 1' }],
    outcome: 'accepted',
    plan: [
      {
        canonical: '.|=.+1',
        affected: 1,
        intents: [{ op: 'set', path: [], before: 41, after: 42 }],
      },
    ],
    after: 42,
  },
  {
    id: 'assign-null',
    group: '11 arbitrary roots',
    name: 'null assignment preserves the member',
    intent: 'Set note to JSON null rather than deleting it.',
    features: ['null-vs-delete', 'write-set'],
    schema: 'invoice-card',
    execution: execution('assign-null', cardTarget),
    before: { note: 'temporary' },
    readableSource: 'Note = null;',
    source: '.note = null;',
    operations: [{ id: 'null-note', op: 'set', target: { path: ['note'] }, value: null }],
    outcome: 'accepted',
    plan: [
      {
        canonical: '.note=null',
        affected: 1,
        intents: [{ op: 'set', path: ['note'], before: 'temporary', after: null }],
      },
    ],
    after: { note: null },
  },
  {
    id: 'delete-member',
    group: '11 arbitrary roots',
    name: 'delete removes the member',
    intent: 'Remove the optional note member entirely.',
    features: ['null-vs-delete', 'write-set'],
    schema: 'invoice-card',
    execution: execution('delete-member', cardTarget),
    before: { title: 'Draft', note: null },
    readableSource: 'del(Note);',
    source: 'del(.note);',
    operations: [{ id: 'delete-note', op: 'delete', target: { path: ['note'] } }],
    outcome: 'accepted',
    plan: [
      {
        canonical: 'del(.note)',
        affected: 1,
        intents: [{ op: 'delete', path: ['note'], before: null }],
      },
    ],
    after: { title: 'Draft' },
  },

  // Rejected fixtures make dangerous or ambiguous near-misses part of the
  // language design. They are as important as the accepted aesthetic cases.
  {
    id: 'reject-card-root-replacement',
    group: '12 rejected roots',
    name: 'a Card root cannot be replaced',
    intent: 'Prevent a terse mutation from becoming whole-Card overwrite.',
    features: ['write-set'],
    schema: 'invoice-card',
    execution: execution('reject-card-root-replacement', cardTarget),
    before: { title: 'Draft', status: 'draft' },
    source: '. = {title: "Final"};',
    operations: [{ id: 'replace-card', op: 'set', target: { path: [] }, value: { title: 'Final' } }],
    outcome: 'rejected',
    error: { phase: 'plan', code: 'card-root-write', statement: 1 },
  },
  {
    id: 'reject-ambiguous-single-target',
    group: '13 rejected cardinality',
    name: 'ordinary assignment cannot update multiple matches',
    intent: 'Require bulk intent to be visible in source.',
    features: ['cardinality'],
    schema: 'invoice-card',
    execution: execution('reject-ambiguous-single-target', cardTarget),
    before: {
      lineItems: [
        { sku: 'A', taxable: true, discount: 0 },
        { sku: 'B', taxable: true, discount: 0 },
      ],
    },
    source: '(.lineItems[] | select(.taxable) | .discount) = 0.05;',
    operations: [
      {
        id: 'implicit-bulk',
        op: 'set',
        target: {
          collection: ['lineItems'],
          where: [{ path: ['taxable'], equals: true }],
          relativePath: ['discount'],
        },
        value: 0.05,
      },
    ],
    outcome: 'rejected',
    error: { phase: 'plan', code: 'target-ambiguous', statement: 1 },
  },
  {
    id: 'reject-empty-bulk-target',
    group: '13 rejected cardinality',
    name: 'explicit bulk update still requires at least one match',
    intent: 'Expose stale selectors instead of silently succeeding.',
    features: ['cardinality'],
    schema: 'invoice-card',
    execution: execution('reject-empty-bulk-target', cardTarget),
    before: { lineItems: [{ sku: 'A', taxable: false, discount: 0 }] },
    source: 'update_all(.lineItems[] | select(.taxable) | .discount; . + 0.05);',
    operations: [
      {
        id: 'discount-taxable',
        op: 'update-all',
        target: {
          collection: ['lineItems'],
          where: [{ path: ['taxable'], equals: true }],
          relativePath: ['discount'],
        },
        expression: '. + 0.05',
      },
    ],
    outcome: 'rejected',
    error: { phase: 'plan', code: 'bulk-target-empty', statement: 1 },
  },
  {
    id: 'reject-streaming-numeric-position',
    group: '14 rejected positions',
    name: 'streaming statement commits cannot address ordinary ordered items by index',
    intent: 'Prevent a concurrent insert from retargeting a generated edit.',
    features: ['streaming', 'stable-position', 'collection-semantics'],
    schema: 'ordered-sections-field',
    execution: execution('reject-streaming-numeric-position', sectionsTarget, {
      delivery: 'streaming',
      transaction: 'statement',
    }),
    before: [{ id: 'a' }, { id: 'b' }],
    source: '.[1].title = "Changed";',
    chunks: ['.[1].title = ', '"Changed";'],
    operations: [{ id: 'index-write', op: 'set', target: { path: [1, 'title'] }, value: 'Changed' }],
    outcome: 'rejected',
    error: { phase: 'validate', code: 'position-unstable', statement: 1 },
  },
  {
    id: 'reject-source-is-anchor',
    group: '14 rejected positions',
    name: 'an item cannot be moved relative to itself',
    intent: 'Reject a structurally meaningless move.',
    features: ['stable-position'],
    schema: 'ordered-sections-field',
    execution: execution('reject-source-is-anchor', sectionsTarget),
    before: [{ id: 'a' }, { id: 'b' }],
    source: 'move_item_before(.[] | select(.id == "a"); .[] | select(.id == "a"));',
    operations: [
      {
        id: 'self-move',
        op: 'move',
        target: { collection: [], where: [{ path: ['id'], equals: 'a' }] },
        into: { path: [] },
        position: { before: { collection: [], where: [{ path: ['id'], equals: 'a' }] } },
      },
    ],
    outcome: 'rejected',
    error: { phase: 'plan', code: 'source-is-anchor', statement: 1 },
  },
  {
    id: 'reject-non-permutation-reorder',
    group: '14 rejected positions',
    name: 'reorder cannot omit or invent identities',
    intent: 'Ensure reorder changes order only.',
    features: ['stable-position', 'collection-semantics'],
    schema: 'ordered-sections-field',
    execution: execution('reject-non-permutation-reorder', sectionsTarget),
    before: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    source: 'reorder_by(.; .id; ["c", "a", "new"]);',
    operations: [
      { id: 'bad-order', op: 'reorder', target: { path: [] }, key: ['id'], order: ['c', 'a', 'new'] },
    ],
    outcome: 'rejected',
    error: { phase: 'plan', code: 'order-not-permutation', statement: 1 },
  },
  {
    id: 'reject-related-card-traversal',
    group: '15 rejected relationships',
    name: 'a relationship cannot be traversed for mutation',
    intent: 'Require a separate target and authorization decision for the related Card.',
    features: ['relationship', 'authorization'],
    schema: 'reviewers-relationship-field',
    execution: execution('reject-related-card-traversal', reviewersTarget),
    before: [{ id: 'card:ada' }],
    source: '(.[] | select(.id == "card:ada") | .name) = "Ada Lovelace";',
    operations: [
      {
        id: 'mutate-related-card',
        op: 'set',
        target: {
          collection: [],
          where: [{ path: ['id'], equals: 'card:ada' }],
          relativePath: ['name'],
        },
        value: 'Ada Lovelace',
      },
    ],
    outcome: 'rejected',
    error: { phase: 'validate', code: 'relationship-traversal', statement: 1 },
  },
  {
    id: 'reject-jsonapi-relationship-path',
    group: '15 rejected relationships',
    name: 'raw JSON:API relationship storage is not part of the mutation root',
    intent: 'Prevent authors from manufacturing entryPoints.N relationship records.',
    features: ['relationship', 'write-set'],
    schema: 'workspace-card',
    execution: execution('reject-jsonapi-relationship-path', { kind: 'card', id: 'card:workspace' }),
    before: {
      entryPoints: [{ id: 'card:architecture', cardTitle: 'Consistency Architecture' }],
    },
    source: '.relationships["entryPoints.1"].links.self = "./POCs/collab-stage/CollabPad/demo";',
    operations: [
      {
        id: 'raw-jsonapi-link',
        op: 'set',
        target: { path: ['relationships', 'entryPoints.1', 'links', 'self'] },
        value: './POCs/collab-stage/CollabPad/demo',
      },
    ],
    outcome: 'rejected',
    error: { phase: 'plan', code: 'storage-projection-forbidden', statement: 1 },
    notes: [
      'The loaded Workspace has entryPoints: CardDef[] and no writable relationships object.',
      'Only the persistence adapter knows the indexed JSON:API representation.',
    ],
  },
  {
    id: 'reject-query-backed-links-to-many',
    group: '15 rejected relationships',
    name: 'query-backed linksToMany membership is read-only',
    intent: 'Reject writes to relationship membership derived from a schema query.',
    features: ['relationship', 'collection-semantics'],
    schema: 'query-backed-directory-card',
    execution: execution('reject-query-backed-links-to-many', { kind: 'card', id: 'card:student-directory' }),
    before: {
      students: [
        { id: 'card:student/ava', firstName: 'Ava', lastName: 'Thompson' },
        { id: 'card:student/maya', firstName: 'Maya', lastName: 'Rodriguez' },
      ],
    },
    source: 'append(.students; card("card:student/leo"));',
    operations: [
      {
        id: 'append-derived-student',
        op: 'relate',
        target: { path: ['students'] },
        cardId: 'card:student/leo',
        position: { at: 'end' },
      },
    ],
    store: {
      'card:student/leo': { id: 'card:student/leo', firstName: 'Leo', lastName: 'Park' },
    },
    outcome: 'rejected',
    error: { phase: 'validate', code: 'field-read-only', statement: 1 },
    notes: ['Change the fields used by the query or its source cards instead of assigning membership.'],
  },
  {
    id: 'reject-revision-conflict',
    group: '16 rejected execution',
    name: 'revision drift rejects the complete plan',
    intent: 'Never re-resolve a selector against a newer snapshot implicitly.',
    features: ['actor', 'atomic'],
    schema: 'invoice-card',
    execution: execution('reject-revision-conflict', cardTarget, {
      actor: 'assistant:thread-42',
      baseRevision: 'rev-stale',
    }),
    before: { status: 'draft' },
    source: '.status = "review";',
    operations: [{ id: 'review', op: 'set', target: { path: ['status'] }, value: 'review' }],
    outcome: 'rejected',
    error: { phase: 'commit', code: 'revision-conflict', statement: 1 },
    committedStatements: 0,
  },
  {
    id: 'reject-authorization-write',
    group: '16 rejected execution',
    name: 'authorization evaluates the complete concrete write set',
    intent: 'Commit nothing when one leaf intent is denied.',
    features: ['authorization', 'write-set', 'atomic'],
    schema: 'invoice-card',
    execution: execution('reject-authorization-write', cardTarget, { actor: 'user:viewer' }),
    before: { title: 'Draft', status: 'draft' },
    source: '.title = "Final";\n.status = "published";',
    operations: [
      { id: 'rename', op: 'set', target: { path: ['title'] }, value: 'Final' },
      { id: 'publish', op: 'set', target: { path: ['status'] }, value: 'published' },
    ],
    outcome: 'rejected',
    error: { phase: 'authorize', code: 'authorization-denied', statement: 2 },
    committedStatements: 0,
  },
  {
    id: 'reject-incomplete-stream',
    group: '17 rejected streaming',
    name: 'end of stream with a partial statement is an error',
    intent: 'Never evaluate an unterminated streamed edit.',
    features: ['streaming'],
    schema: 'invoice-card',
    execution: execution('reject-incomplete-stream', cardTarget, {
      delivery: 'streaming',
      transaction: 'atomic',
    }),
    before: { title: 'Draft' },
    source: '.title = "Final"',
    chunks: ['.title = ', '"Final"'],
    operations: [],
    outcome: 'rejected',
    error: { phase: 'parse', code: 'stream-incomplete', statement: 1 },
    committedStatements: 0,
  },
  {
    id: 'reject-duplicate-operation-id',
    group: '17 rejected streaming',
    name: 'structured operation identities are unique within a program',
    intent: 'Make retries and replay unambiguous.',
    features: ['streaming', 'idempotency'],
    schema: 'invoice-card',
    execution: execution('reject-duplicate-operation-id', cardTarget, {
      delivery: 'streaming',
      transaction: 'atomic',
    }),
    before: { title: 'Draft', status: 'draft' },
    source: '.title = "Final";\n.status = "review";',
    operations: [
      { id: 'change', op: 'set', target: { path: ['title'] }, value: 'Final' },
      { id: 'change', op: 'set', target: { path: ['status'] }, value: 'review' },
    ],
    outcome: 'rejected',
    error: { phase: 'parse', code: 'duplicate-operation-id', statement: 2 },
    committedStatements: 0,
  },
];

const requiredFeatures: MutationFeature[] = [
  'copy',
  'stable-position',
  'collection-semantics',
  'cardinality',
  'evaluation-order',
  'returning',
  'actor',
  'relationship',
  'write-set',
];

if (new Set(bxlMutationExamples.map((fixture) => fixture.id)).size !== bxlMutationExamples.length) {
  throw new Error('BXL mutation fixture IDs must be unique');
}

const coveredFeatures = new Set(bxlMutationExamples.flatMap((fixture) => fixture.features));
for (const feature of requiredFeatures) {
  if (!coveredFeatures.has(feature)) {
    throw new Error(`BXL mutation fixture corpus does not cover ${feature}`);
  }
}

if (!bxlMutationExamples.some((fixture) => fixture.outcome === 'accepted')) {
  throw new Error('BXL mutation fixture corpus must contain accepted cases');
}

if (!bxlMutationExamples.some((fixture) => fixture.outcome === 'rejected')) {
  throw new Error('BXL mutation fixture corpus must contain rejected cases');
}
