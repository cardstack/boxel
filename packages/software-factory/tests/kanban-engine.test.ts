import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { module, test } from 'qunit';
import ts from 'typescript';

type Option = {
  value: string;
  label: string;
  color?: string;
};

type TestModel = {
  id?: string | null;
  groupBy?: string | null;
  hideEmptyColumns?: boolean | null;
  issues?: Record<string, unknown>[];
  issuePriorityOptions?: Option[];
  issueStatusOptions?: Option[];
  issueTypeOptions?: Option[];
  statusColumnConfig?: Array<Record<string, unknown>>;
  priorityColumnConfig?: Array<Record<string, unknown>>;
  typeColumnConfig?: Array<Record<string, unknown>>;
};

type LoadedControllerModule = {
  ProjectKanbanController: new (
    getModel: () => TestModel | undefined,
    getRealmURL: () => URL | undefined,
    issueCodeRef: { module: string; name: string },
    createCard?: (
      codeRef: { module: string; name: string },
      codeRefURL: URL,
      input: unknown,
    ) => Promise<unknown>,
  ) => {
    dragManager: {
      callbacks: {
        onChange?: (placements: unknown[]) => void;
      };
    };
    kanbanColumns: Array<Record<string, unknown>>;
    kanbanPlacements: Array<Record<string, unknown>>;
    addCardToColumn: (columnKey: string | null | undefined) => Promise<void>;
    setColumnColor: (
      key: string | null | undefined,
      color: string | null | undefined,
    ) => void;
    setColumnWipLimit: (key: string | null | undefined, raw: number) => void;
    setColumnCollapsed: (
      key: string | null | undefined,
      collapsed: boolean,
    ) => void;
    moveColDown: (key: string | null | undefined) => void;
  };
};

const ISSUE_CODE_REF = {
  module: 'https://realms.example.test/software-factory/darkfactory',
  name: 'Issue',
} as const;

const issueStatusOptions: Option[] = [
  { value: 'backlog', label: 'Backlog', color: '#2b4fff' },
  { value: 'in_progress', label: 'In Progress', color: '#f9cd4a' },
  { value: 'blocked', label: 'Blocked', color: '#db1731' },
  { value: 'review', label: 'In Review', color: '#285028' },
  { value: 'done', label: 'Done', color: '#7a2cf4' },
];

const issuePriorityOptions: Option[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const issueTypeOptions: Option[] = [
  { value: 'bootstrap', label: 'Bootstrap' },
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'task', label: 'Task' },
  { value: 'research', label: 'Research' },
  { value: 'infrastructure', label: 'Infrastructure' },
];

const defaultColumns = [
  {
    value: 'status',
    label: 'Status',
    fieldName: 'status',
    orderField: 'statusBoardOrder',
    options: issueStatusOptions,
  },
  {
    value: 'priority',
    label: 'Priority',
    fieldName: 'priority',
    orderField: 'priorityBoardOrder',
    options: issuePriorityOptions,
  },
  {
    value: 'issueType',
    label: 'Type',
    fieldName: 'issueType',
    orderField: 'issueTypeBoardOrder',
    options: issueTypeOptions,
  },
];

function readSource(...segments: string[]): string {
  return readFileSync(resolve(__dirname, '..', ...segments), 'utf8');
}

function loadControllerModule(): LoadedControllerModule {
  const source = readSource('realm', 'project-kanban-controller.ts');
  const strippedSource = source
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\n/g, '')
    .replace(
      'export class ProjectKanbanController',
      'class ProjectKanbanController',
    )
    .concat('\nmodule.exports = { ProjectKanbanController };');

  const compiled = ts.transpileModule(strippedSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  class FakeKanbanDragManager {
    callbacks: Record<string, unknown>;

    constructor(callbacks: Record<string, unknown>) {
      this.callbacks = callbacks;
    }
  }

  class FakeKanbanColumnField {
    [key: string]: unknown;

    constructor(initialState: Record<string, unknown>) {
      Object.assign(this, initialState);
    }
  }

  const sandbox = {
    module: { exports: {} },
    exports: {},
    KanbanDragManager: FakeKanbanDragManager,
    KanbanColumnField: FakeKanbanColumnField,
    defaultColumns,
    URL,
    Promise,
  };

  vm.runInNewContext(compiled, sandbox);
  return sandbox.module.exports as LoadedControllerModule;
}

function makeModel(overrides: Partial<TestModel> = {}): TestModel {
  return {
    id: 'https://realms.example.test/projects/demo',
    groupBy: 'status',
    hideEmptyColumns: false,
    issues: [],
    issuePriorityOptions: [],
    issueStatusOptions: [],
    issueTypeOptions: [],
    statusColumnConfig: [],
    priorityColumnConfig: [],
    typeColumnConfig: [],
    ...overrides,
  };
}

function makeController(
  model: TestModel,
  createCard?: (
    codeRef: { module: string; name: string },
    codeRefURL: URL,
    input: unknown,
  ) => Promise<unknown>,
) {
  const { ProjectKanbanController } = loadControllerModule();
  return new ProjectKanbanController(
    () => model,
    () => new URL('https://realms.example.test/user/demo/'),
    ISSUE_CODE_REF,
    createCard,
  );
}

module('kanban-engine > ProjectKanbanController', function () {
  test('issue creation defaults include the grouped field, project relationship, and darkfactory code ref', async function (assert) {
    let captured:
      | {
          codeRef: { module: string; name: string };
          codeRefURL: URL;
          input: any;
        }
      | undefined;
    let model = makeModel({ groupBy: 'priority' });
    let controller = makeController(
      model,
      async (codeRef, codeRefURL, input) => {
        captured = { codeRef, codeRefURL, input };
        return undefined;
      },
    );

    await controller.addCardToColumn('critical');

    assert.deepEqual(
      captured?.codeRef,
      ISSUE_CODE_REF,
      'createCard receives the issue code ref',
    );
    assert.strictEqual(
      captured?.codeRefURL.href,
      ISSUE_CODE_REF.module,
      'createCard receives the issue module URL',
    );
    assert.strictEqual(
      captured?.input.doc.data.attributes.priority,
      'critical',
      'new issue is initialized with the current group-by field',
    );
    assert.strictEqual(
      captured?.input.doc.data.relationships.project.links.self,
      model.id,
      'new issue is linked to the current project',
    );
    assert.deepEqual(
      captured?.input.doc.data.meta.adoptsFrom,
      ISSUE_CODE_REF,
      'new issue document adopts from the Issue card',
    );
  });

  test('board config changes persist in the model and are reflected by a new controller instance', function (assert) {
    let model = makeModel();
    let controller = makeController(model);

    controller.setColumnColor('backlog', '#123456');
    controller.setColumnWipLimit('backlog', 3);
    controller.setColumnCollapsed('backlog', true);
    controller.moveColDown('backlog');

    assert.strictEqual(
      model.statusColumnConfig?.length,
      2,
      'status column config stores the moved column and its neighbor',
    );

    let nextController = makeController(model);
    let backlogColumn = nextController.kanbanColumns.find(
      (column) => column.key === 'backlog',
    );
    let inProgressColumn = nextController.kanbanColumns.find(
      (column) => column.key === 'in_progress',
    );

    assert.strictEqual(
      backlogColumn?.color,
      '#123456',
      'persisted column color is reused',
    );
    assert.strictEqual(
      backlogColumn?.wipLimit,
      3,
      'persisted WIP limit is reused',
    );
    assert.true(
      Boolean(backlogColumn?.collapsed),
      'persisted collapsed state is reused',
    );
    assert.true(
      (backlogColumn?.sortOrder as number) >
        (inProgressColumn?.sortOrder as number),
      'persisted sort order changes survive a fresh controller instance',
    );
  });

  test('custom status options drive column labels, colors, placements, and drag updates', async function (assert) {
    let issue = { status: 'working' };
    let model = makeModel({
      issueStatusOptions: [
        { value: 'triage', label: 'Triage', color: '#111111' },
        { value: 'working', label: 'Working', color: '#222222' },
      ],
      issues: [issue],
    });
    let controller = makeController(model);

    let columns = controller.kanbanColumns;
    assert.deepEqual(
      columns.map((column) => ({
        key: column.key,
        label: column.label,
        color: column.color,
      })),
      [
        { key: 'triage', label: 'Triage', color: '#111111' },
        { key: 'working', label: 'Working', color: '#222222' },
      ],
      'custom status options replace the default columns',
    );

    let placements = controller.kanbanPlacements;
    assert.strictEqual(
      placements[0]?.column,
      1,
      'issue is placed in its custom status column',
    );

    await Promise.resolve();
    assert.strictEqual(
      issue.statusBoardOrder,
      1,
      'missing board order is initialized for custom columns',
    );

    controller.dragManager.callbacks.onChange?.([
      { index: 0, column: 0, sortOrder: 4 },
    ]);

    assert.strictEqual(issue.status, 'triage', 'drag updates the issue status');
    assert.strictEqual(
      issue.statusBoardOrder,
      4,
      'drag updates the issue board order',
    );
  });
});
