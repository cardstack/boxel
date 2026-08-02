import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import {
  applyBxlMutationPlanToCard,
  BxlMutationError,
  mutationSchemaForCard,
  prepareBxlMutation,
  snapshotBxlCard,
  updateViaBxl,
  type BxlBoxelField,
} from '../../src/index.js';

type Shape = (new () => object) & {
  displayName?: string;
  fields?: Record<string, BxlBoxelField>;
};

class StringValue {}
class NumberValue {}
class BooleanValue {}

class LineItem {
  static displayName = 'Line Item';
  static fields: Record<string, BxlBoxelField> = {
    sku: { fieldType: 'contains', card: StringValue },
    quantity: { fieldType: 'contains', card: NumberValue },
    taxable: { fieldType: 'contains', card: BooleanValue },
  };
  sku = '';
  quantity = 0;
  taxable = false;
}

class Collaborator {
  static displayName = 'Collaborator';
  static fields: Record<string, BxlBoxelField> = {
    id: { fieldType: 'contains', card: StringValue },
    name: { fieldType: 'contains', card: StringValue },
  };
  id = '';
  name = '';
}

class Invoice {
  static displayName = 'Invoice';
  static fields: Record<string, BxlBoxelField> = {
    id: { fieldType: 'contains', card: StringValue },
    title: { fieldType: 'contains', card: StringValue },
    lineItems: { fieldType: 'containsMany', card: LineItem },
    collaborators: { fieldType: 'linksToMany', card: Collaborator },
    reviewer: { fieldType: 'linksTo', card: Collaborator },
    searchResults: {
      fieldType: 'linksToMany',
      card: Collaborator,
      queryDefinition: {},
    },
    total: {
      fieldType: 'contains',
      card: NumberValue,
      computeVia() { return 0; },
    },
  };

  id = 'card:invoice/42';
  title = 'Draft';
  lineItems: LineItem[] = [];
  collaborators: Collaborator[] = [];
  reviewer: Collaborator | null = null;
  searchResults: Collaborator[] = [];
  total = 0;
}

class GuardedCard {
  static fields: Record<string, BxlBoxelField> = {
    title: { fieldType: 'contains', card: StringValue },
    locked: { fieldType: 'contains', card: StringValue },
  };
  title = 'Before';
  #locked = 'safe';
  get locked() { return this.#locked; }
  set locked(value: string) {
    if (value === 'boom') throw new Error('locked setter rejected value');
    this.#locked = value;
  }
}

const getFields = (value: unknown): Record<string, BxlBoxelField> => {
  const shape = (typeof value === 'function' ? value : value?.constructor) as Shape | undefined;
  return shape?.fields ?? {};
};

function item(sku: string, quantity: number, taxable = true): LineItem {
  const value = new LineItem();
  value.sku = sku;
  value.quantity = quantity;
  value.taxable = taxable;
  return value;
}

function collaborator(id: string, name: string): Collaborator {
  const value = new Collaborator();
  value.id = id;
  value.name = name;
  return value;
}

function invoiceFixture() {
  const invoice = new Invoice();
  invoice.lineItems = [item('COPY-03', 1), item('PAPER-01', 4, false)];
  invoice.collaborators = [collaborator('card:ada', 'Ada'), collaborator('card:grace', 'Grace')];
  invoice.reviewer = invoice.collaborators[0]!;
  return invoice;
}

let pass = 0;
function check(name: string, callback: () => void) {
  try {
    callback();
    pass++;
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

check('derives readable schema from CardDef/FieldDef metadata', () => {
  const card = invoiceFixture();
  const schema = mutationSchemaForCard(card, { getFields });
  const lineItems = schema.fields.find((field) => field.key === 'lineItems');
  strictEqual(lineItems?.label, 'Line Item');
  strictEqual(lineItems?.fieldType, 'containsMany');
  strictEqual(lineItems?.item?.fields.find((field) => field.key === 'quantity')?.writable, true);
  strictEqual(schema.fields.find((field) => field.key === 'id')?.writable, false);
  strictEqual(schema.fields.find((field) => field.key === 'searchResults')?.writable, false);
  strictEqual(schema.fields.some((field) => field.key === 'total'), false);
});

check('snapshots the loaded model and represents relationships only by Card ID', () => {
  const snapshot = snapshotBxlCard(invoiceFixture(), { getFields });
  deepStrictEqual(snapshot, {
    id: 'card:invoice/42',
    title: 'Draft',
    lineItems: [
      { sku: 'COPY-03', quantity: 1, taxable: true },
      { sku: 'PAPER-01', quantity: 4, taxable: false },
    ],
    collaborators: [{ id: 'card:ada' }, { id: 'card:grace' }],
    reviewer: { id: 'card:ada' },
    searchResults: [],
  });
});

check('updates one nested field without replacing contained identity', () => {
  const card = invoiceFixture();
  const first = card.lineItems[0];
  const second = card.lineItems[1];
  const update = updateViaBxl('"Line Item"[SKU = "COPY-03"].Quantity += 1;', { getFields });
  const plan = update.call(card, { programId: 'tool-call-1' });
  strictEqual(card.lineItems[0], first);
  strictEqual(card.lineItems[1], second);
  strictEqual(card.lineItems[0]?.quantity, 2);
  strictEqual(card.lineItems[1]?.quantity, 4);
  strictEqual(plan.affected, 1);
  deepStrictEqual(plan.paths, [['lineItems', 0, 'quantity']]);
});

check('runs a complete multi-statement program against sequential state', () => {
  const card = invoiceFixture();
  const update = updateViaBxl(
    'Title = "Final"; "Line Item"[SKU = "COPY-03"].Quantity += 2;',
    { getFields },
  );
  const plan = update.call(card, { programId: 'tool-call-2' });
  strictEqual(card.title, 'Final');
  strictEqual(card.lineItems[0]?.quantity, 3);
  strictEqual(plan.statements.length, 2);
});

check('materializes inserted contained objects with the natural Field class', () => {
  const card = invoiceFixture();
  const update = updateViaBxl(
    'insert_item_after({ sku: "INK-02", quantity: 2, taxable: true }, "Line Item"[SKU = "COPY-03"]);',
    { getFields },
  );
  update.call(card, { programId: 'tool-call-3' });
  strictEqual(card.lineItems.length, 3);
  ok(card.lineItems[1] instanceof LineItem);
  strictEqual(card.lineItems[1]?.sku, 'INK-02');
  strictEqual(card.lineItems[1]?.quantity, 2);
});

check('moves contained items without losing object identity', () => {
  const card = invoiceFixture();
  const copy = card.lineItems[0]!;
  const paper = card.lineItems[1]!;
  const update = updateViaBxl(
    'move_item_before("Line Item"[SKU = "PAPER-01"], "Line Item"[SKU = "COPY-03"]);',
    { getFields },
  );
  update.call(card, { programId: 'tool-call-4' });
  deepStrictEqual(card.lineItems, [paper, copy]);
});

check('resolves and inserts relationship Cards through the Card own store', () => {
  const card = invoiceFixture();
  const lin = collaborator('card:lin', 'Lin');
  const store = { getCard(id: string) { return id === lin.id ? lin : undefined; } };
  const update = updateViaBxl('append(Collaborators, card("card:lin"));', {
    getFields,
    getStore() { return store; },
  });
  const plan = update.call(card, { programId: 'tool-call-5' });
  strictEqual(card.collaborators.at(-1), lin);
  deepStrictEqual(plan.intents.at(-1), {
    op: 'relate',
    field: ['collaborators'],
    cardId: 'card:lin',
    index: 2,
  });
});

check('unrelates and reorders relationships as live Card objects', () => {
  const card = invoiceFixture();
  const ada = card.collaborators[0]!;
  const grace = card.collaborators[1]!;
  updateViaBxl(
    'move_item_before(Collaborators[ID = "card:grace"], Collaborators[ID = "card:ada"]);',
    { getFields },
  ).call(card, { programId: 'tool-call-6' });
  deepStrictEqual(card.collaborators, [grace, ada]);
  updateViaBxl('del(Collaborators[ID = "card:ada"]);', { getFields }).call(card, {
    programId: 'tool-call-7',
  });
  deepStrictEqual(card.collaborators, [grace]);
});

check('planner failures leave the live card untouched', () => {
  const card = invoiceFixture();
  const before = snapshotBxlCard(card, { getFields });
  throws(
    () => updateViaBxl('"Line Item"[Quantity >= 1].Quantity += 1;', { getFields }).call(card),
    (error) => error instanceof BxlMutationError && error.code === 'target-ambiguous',
  );
  deepStrictEqual(snapshotBxlCard(card, { getFields }), before);
});

check('authorization failures leave the live card untouched', () => {
  const card = invoiceFixture();
  throws(
    () => updateViaBxl('Title = "Denied";', { getFields }).call(card, {
      authorize() { return false; },
    }),
    (error) => error instanceof BxlMutationError && error.code === 'authorization-denied',
  );
  strictEqual(card.title, 'Draft');
});

check('low-level plan application rejects a Card changed since planning', () => {
  const card = invoiceFixture();
  const snapshot = snapshotBxlCard(card, { getFields });
  const plan = prepareBxlMutation('Title = "Planned";', {
    targetKind: 'card',
    schema: mutationSchemaForCard(card, { getFields }),
  }).plan(snapshot, {
    programId: 'detached-plan',
    targetId: card.id,
  });
  card.title = 'Changed elsewhere';
  throws(
    () => applyBxlMutationPlanToCard(card, plan, { getFields }),
    (error) => error instanceof BxlMutationError && error.code === 'plan-snapshot-mismatch',
  );
  strictEqual(card.title, 'Changed elsewhere');
});

check('commit setter failures roll back earlier writes', () => {
  const card = new GuardedCard();
  const update = updateViaBxl('Title = "Changed"; Locked = "boom";', { getFields });
  throws(
    () => update.call(card, { programId: 'tool-call-rollback' }),
    (error) => error instanceof BxlMutationError && error.code === 'commit-failed',
  );
  strictEqual(card.title, 'Before');
  strictEqual(card.locked, 'safe');
});

check('query-backed relationship fields remain read-only', () => {
  const card = invoiceFixture();
  throws(
    () => updateViaBxl('append("Search Results", card("card:ada"));', { getFields }).call(card),
    (error) => error instanceof BxlMutationError && error.code === 'field-read-only',
  );
});

console.log(`BXL Boxel updateViaBxl adapter: ${pass}/${pass} cases passed`);
