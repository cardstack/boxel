import { describe, it, expect, vi } from 'vitest';
import {
  getToolDefinitions,
  requireStringArg,
  type BoxelToolConfig,
} from '../../src/lib/tool-definitions';
import type { BoxelCLIClient } from '../../src/lib/boxel-cli-client';

const TEST_CONFIG: BoxelToolConfig = {
  targetRealmUrl: 'https://realms.example.test/user/target/',
  realmServerUrl: 'https://realms.example.test/',
};

function createMockClient(): BoxelCLIClient {
  return {
    read: vi.fn().mockResolvedValue({ ok: true, document: { data: {} } }),
    write: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
    readTranspiled: vi
      .fn()
      .mockResolvedValue({ ok: true, content: 'compiled' }),
    search: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    runCommand: vi.fn().mockResolvedValue({ status: 'ready', result: null }),
    listFiles: vi.fn().mockResolvedValue({ filenames: ['a.gts', 'b.json'] }),
    lint: vi.fn().mockResolvedValue({ fixed: false, output: '', messages: [] }),
    waitForReady: vi.fn().mockResolvedValue({ ready: true }),
    cancelAllIndexingJobs: vi.fn().mockResolvedValue({ ok: true }),
    createRealm: vi.fn().mockResolvedValue({
      realmUrl: 'https://realms.example.test/user/new/',
      created: true,
    }),
    sync: vi.fn().mockResolvedValue({ pushedFiles: [], pulledFiles: [] }),
    push: vi.fn().mockResolvedValue({ files: [] }),
    pull: vi.fn().mockResolvedValue({ files: [] }),
    getActiveProfile: vi.fn().mockReturnValue(null),
  } as unknown as BoxelCLIClient;
}

describe('getToolDefinitions', () => {
  it('returns expected tool names', () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let names = tools.map((t) => t.name);

    expect(names).toContain('realm_read_file');
    expect(names).toContain('realm_write_file');
    expect(names).toContain('realm_delete_file');
    expect(names).toContain('realm_search');
    expect(names).toContain('create_realm');
    expect(names).toContain('realm_sync');
    expect(names).toContain('realm_push');
    expect(names).toContain('realm_pull');
    expect(names).toContain('read_transpiled');
    expect(names).toContain('run_command');
    expect(names).toContain('realm_list_files');
    expect(names).toContain('realm_lint_file');
    expect(names).toContain('realm_wait_for_ready');
    expect(names).toContain('realm_cancel_indexing');
    expect(tools.length).toBe(14);
  });

  it('realm_sync.execute calls client.sync with options mapped from prefer', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_sync')!;

    await tool.execute({
      'realm-url': 'https://realms.example.test/user/scratch/',
      'local-dir': './workspace',
      prefer: 'local',
      delete: true,
    });

    expect(client.sync).toHaveBeenCalledWith(
      'https://realms.example.test/user/scratch/',
      './workspace',
      {
        preferLocal: true,
        preferRemote: false,
        preferNewest: false,
        delete: true,
        dryRun: undefined,
      },
    );
  });

  it('realm_push.execute calls client.push with delete/force/dry-run', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_push')!;

    await tool.execute({
      'realm-url': 'https://realms.example.test/user/scratch/',
      'local-dir': './workspace',
      delete: true,
      force: true,
      'dry-run': false,
    });

    expect(client.push).toHaveBeenCalledWith(
      'https://realms.example.test/user/scratch/',
      './workspace',
      { delete: true, dryRun: false, force: true },
    );
  });

  it('realm_pull.execute calls client.pull with delete option', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_pull')!;

    await tool.execute({
      'realm-url': 'https://realms.example.test/user/scratch/',
      'local-dir': './workspace',
      delete: true,
    });

    expect(client.pull).toHaveBeenCalledWith(
      'https://realms.example.test/user/scratch/',
      './workspace',
      { delete: true },
    );
  });

  it('each tool has name, description, parameters, and execute', () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);

    for (let tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.parameters).toBe('object');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('realm_write_file.execute calls client.write with the supplied realm-url', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_write_file')!;

    let scratchRealmUrl = 'https://realms.example.test/user/scratch/';
    await tool.execute({
      'realm-url': scratchRealmUrl,
      path: 'card.gts',
      content: 'export class A {}',
    });

    expect(client.write).toHaveBeenCalledWith(
      scratchRealmUrl,
      'card.gts',
      'export class A {}',
    );
  });

  it('realm_read_file.execute calls client.read with the supplied realm-url', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_read_file')!;

    let scratchRealmUrl = 'https://realms.example.test/user/scratch/';
    await tool.execute({ 'realm-url': scratchRealmUrl, path: 'Card/1.json' });

    expect(client.read).toHaveBeenCalledWith(scratchRealmUrl, 'Card/1.json');
  });

  it('realm_delete_file.execute calls client.delete with the supplied realm-url', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_delete_file')!;

    let scratchRealmUrl = 'https://realms.example.test/user/scratch/';
    await tool.execute({ 'realm-url': scratchRealmUrl, path: 'old.json' });

    expect(client.delete).toHaveBeenCalledWith(scratchRealmUrl, 'old.json');
  });

  it('realm_search.execute calls client.search and shapes response', async () => {
    let client = createMockClient();
    (client.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [{ id: '1' }],
    });

    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_search')!;

    let scratchRealmUrl = 'https://realms.example.test/user/scratch/';
    let result = await tool.execute({
      'realm-url': scratchRealmUrl,
      query: { filter: { type: { name: 'Card' } } },
    });

    expect(client.search).toHaveBeenCalledWith(scratchRealmUrl, {
      filter: { type: { name: 'Card' } },
    });
    expect(result).toEqual({ data: [{ id: '1' }] });
  });

  it('realm_search.execute returns error on failure', async () => {
    let client = createMockClient();
    (client.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: 'Not found',
    });

    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_search')!;

    let result = await tool.execute({
      'realm-url': 'https://realms.example.test/user/scratch/',
      query: {},
    });

    expect(result).toEqual({ error: 'Not found' });
  });

  it('realm_read_file.execute throws when realm-url is missing', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_read_file')!;

    await expect(tool.execute({ path: 'Card/1.json' })).rejects.toThrow(
      'requires a non-empty string "realm-url"',
    );
    expect(client.read).not.toHaveBeenCalled();
  });

  it('run_command.execute passes realmServerUrl and targetRealmUrl', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'run_command')!;

    await tool.execute({
      command: '@cardstack/boxel-host/commands/get-card-type-schema/default',
      commandInput: { cardURL: 'http://example.test/Card' },
    });

    expect(client.runCommand).toHaveBeenCalledWith(
      TEST_CONFIG.realmServerUrl,
      TEST_CONFIG.targetRealmUrl,
      '@cardstack/boxel-host/commands/get-card-type-schema/default',
      { cardURL: 'http://example.test/Card' },
    );
  });

  it('realm_list_files.execute calls client.listFiles', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_list_files')!;

    let result = await tool.execute({});

    expect(client.listFiles).toHaveBeenCalledWith(TEST_CONFIG.targetRealmUrl);
    expect(result).toEqual({ filenames: ['a.gts', 'b.json'] });
  });

  it('realm_lint_file.execute calls client.lint with source and filename', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_lint_file')!;

    await tool.execute({ source: 'let x = 1;', filename: 'test.gts' });

    expect(client.lint).toHaveBeenCalledWith(
      TEST_CONFIG.targetRealmUrl,
      'let x = 1;',
      'test.gts',
    );
  });

  it('realm_wait_for_ready.execute calls client.waitForReady', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_wait_for_ready')!;

    let result = await tool.execute({ timeoutMs: 5000 });

    expect(client.waitForReady).toHaveBeenCalledWith(
      TEST_CONFIG.targetRealmUrl,
      5000,
    );
    expect(result).toEqual({ ready: true });
  });

  it('realm_cancel_indexing.execute calls client.cancelAllIndexingJobs', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'realm_cancel_indexing')!;

    let result = await tool.execute({});

    expect(client.cancelAllIndexingJobs).toHaveBeenCalledWith(
      TEST_CONFIG.targetRealmUrl,
    );
    expect(result).toEqual({ ok: true });
  });

  it('create_realm.execute maps endpoint/name to realmName/displayName', async () => {
    let client = createMockClient();
    (client.getActiveProfile as ReturnType<typeof vi.fn>).mockReturnValue({
      matrixId: '@test:realms.example.test',
      realmServerUrl: TEST_CONFIG.realmServerUrl,
    });

    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'create_realm')!;

    await tool.execute({
      'realm-server-url': TEST_CONFIG.realmServerUrl,
      endpoint: 'user/widgets',
      name: 'Widgets',
      iconURL: 'https://icons.test/w.png',
      backgroundURL: 'https://bgs.test/w.jpg',
    });

    expect(client.createRealm).toHaveBeenCalledWith({
      realmName: 'user/widgets',
      displayName: 'Widgets',
      iconURL: 'https://icons.test/w.png',
      backgroundURL: 'https://bgs.test/w.jpg',
    });
  });

  it('create_realm.execute rejects mismatched realm-server-url against active profile', async () => {
    let client = createMockClient();
    (client.getActiveProfile as ReturnType<typeof vi.fn>).mockReturnValue({
      matrixId: '@test:realms.example.test',
      realmServerUrl: 'https://prod.example.test/',
    });

    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'create_realm')!;

    let result = (await tool.execute({
      'realm-server-url': 'https://staging.example.test/',
      endpoint: 'user/widgets',
      name: 'Widgets',
    })) as { error?: string };

    expect(result.error).toMatch(/cannot target/);
    expect(client.createRealm).not.toHaveBeenCalled();
  });

  it('create_realm.execute throws when realm-server-url is missing', async () => {
    let client = createMockClient();
    let tools = getToolDefinitions(client, TEST_CONFIG);
    let tool = tools.find((t) => t.name === 'create_realm')!;

    await expect(
      tool.execute({ endpoint: 'user/x', name: 'X' }),
    ).rejects.toThrow('requires a non-empty string "realm-server-url"');
    expect(client.createRealm).not.toHaveBeenCalled();
  });
});

describe('requireStringArg', () => {
  it('returns trimmed value for valid string', () => {
    let result = requireStringArg({ path: 'hello.gts' }, 'path', 'test_tool');
    expect(result).toBe('hello.gts');
  });

  it('throws for missing arg', () => {
    expect(() => requireStringArg({}, 'path', 'test_tool')).toThrow(
      'requires a non-empty string "path"',
    );
  });

  it('throws for empty string', () => {
    expect(() => requireStringArg({ path: '' }, 'path', 'test_tool')).toThrow(
      'requires a non-empty string "path"',
    );
  });

  it('throws for non-string value', () => {
    expect(() => requireStringArg({ path: 42 }, 'path', 'test_tool')).toThrow(
      'requires a non-empty string "path"',
    );
  });

  it('throws for undefined', () => {
    expect(() =>
      requireStringArg({ path: undefined }, 'path', 'test_tool'),
    ).toThrow('requires a non-empty string "path"');
  });
});
