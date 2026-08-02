import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import {
  executeRealmScript,
  parseNotebookInputRefs,
  registerRealmScriptCommand,
} from '../../src/commands/realm/script.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';

describe('Realm Notebook CLI inputs', () => {
  it('parses cell and immutable execution references', () => {
    let executionId = 'a'.repeat(64);
    expect(
      parseNotebookInputRefs([
        'candidates=cell:search#/result/value/candidates',
        `matches=exec:${executionId}#/result/value`,
      ]),
    ).toEqual({
      candidates: {
        cellId: 'search',
        pointer: '/result/value/candidates',
      },
      matches: { executionId, pointer: '/result/value' },
    });
  });

  it('rejects ambiguous or malformed references', () => {
    expect(() => parseNotebookInputRefs(['missing-equals'])).toThrow(
      /expected name=/,
    );
    expect(() =>
      parseNotebookInputRefs(['value=cell:search#not-a-pointer']),
    ).toThrow(/must start with/);
  });

  it('registers notebook lifecycle flags for agent use', () => {
    let program = new Command().exitOverride();
    let realm = program.command('realm');
    registerRealmScriptCommand(realm);
    let script = realm.commands.find((command) => command.name() === 'script');
    if (!script) throw new Error('script command was not registered');
    let names = script.options.map((option) => option.long);

    expect(names).toContain('--session');
    expect(names).toContain('--cell');
    expect(names).toContain('--persistence');
    expect(names).toContain('--ttl-ms');
    expect(names).toContain('--input-ref');
    expect(names).toContain('--saved');
    expect(names).toContain('--rerun');
    expect(names).toContain('--no-activity');
  });
});

describe('executeRealmScript', () => {
  it('sends a notebook cell through the same Realm endpoint used by Matrix', async () => {
    let request: { input: string | URL | Request; init?: RequestInit } | null =
      null;
    let authenticator: RealmAuthenticator = {
      async authedRealmFetch(input, init) {
        request = { input, init };
        return new Response(
          JSON.stringify({
            ok: true,
            value: ['module.gts'],
            notebook: { reused: false },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    };
    let result = await executeRealmScript(
      'https://example.test/workspace/',
      'return realm.input;',
      {
        mode: 'preview',
        authenticator,
        notebook: {
          sessionId: '!room:example.test',
          cellId: 'grep',
          persistence: 'ephemeral',
          inputs: { candidates: { cellId: 'search' } },
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(String(request!.input)).toBe(
      'https://example.test/workspace/_realm-program',
    );
    expect(request!.init?.method).toBe('QUERY');
    expect(JSON.parse(String(request!.init?.body))).toEqual({
      code: 'return realm.input;',
      mode: 'preview',
      notebook: {
        sessionId: '!room:example.test',
        cellId: 'grep',
        persistence: 'ephemeral',
        inputs: { candidates: { cellId: 'search' } },
      },
    });
  });

  it('can invoke saved cell source without resending its code', async () => {
    let body: unknown;
    let authenticator: RealmAuthenticator = {
      async authedRealmFetch(_input, init) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, value: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    };

    await executeRealmScript('https://example.test/workspace/', undefined, {
      authenticator,
      notebook: {
        sessionId: 'research',
        cellId: 'search',
        runSaved: true,
        force: true,
      },
    });

    expect(body).toEqual({
      mode: 'preview',
      notebook: {
        sessionId: 'research',
        cellId: 'search',
        runSaved: true,
        force: true,
      },
    });
  });

  it('consumes live activity while preserving the final JSON result', async () => {
    let requestHeaders: HeadersInit | undefined;
    let activity: unknown[] = [];
    let encoder = new TextEncoder();
    let authenticator: RealmAuthenticator = {
      async authedRealmFetch(_input, init) {
        requestHeaders = init?.headers;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  '{"type":"activity","activity":{"sequence":1,"timestamp":1,"source":"runtime","status":"running","phase":"search",',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  '"message":"Searching readable realms"}}\n{"type":"result","result":{"ok":true,"value":42}}\n',
                ),
              );
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson' },
          },
        );
      },
    };

    let result = await executeRealmScript(
      'https://example.test/workspace/',
      'return 42;',
      {
        authenticator,
        onActivity(event) {
          activity.push(event);
        },
      },
    );

    expect(
      new Headers(requestHeaders).get('X-Boxel-Realm-Program-Stream'),
    ).toBe('activity-v1');
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      phase: 'search',
      message: 'Searching readable realms',
    });
    expect(result).toEqual({
      ok: true,
      output: { ok: true, value: 42 },
    });
  });
});
