import { describe, expect, it } from 'vitest';
import {
  POLICY_AUDIT_CONFIRMATION_HEADER,
  POLICY_OPENS_SHARES_CODE,
  type PolicyShareAudit,
} from '@cardstack/runtime-common/policy-share-audit';
import {
  confirmPolicyAuditFor,
  describePolicyAudit,
  sendConfirmingPolicyAudit,
} from '../../src/lib/policy-audit.ts';

const POLICY = 'https://app.example.test/org/policies/team';

const audit: PolicyShareAudit = {
  confirmation: 'abc123',
  entries: [
    {
      realm: 'https://app.example.test/team/',
      policy: POLICY,
      share: 'share-1',
      label: 'Forecast key',
      owner: '@owner:example.test',
      keyAllowsAnonymous: true,
      operations: ['https://app.example.test/team/weather#Weather.forecast'],
    },
    {
      realm: 'https://app.example.test/team/',
      policy: POLICY,
      share: 'share-2',
      label: 'Alerts key',
      owner: '@other:example.test',
      keyAllowsAnonymous: false,
      operations: ['https://app.example.test/team/weather#Weather.alerts'],
    },
  ],
};

function refusal() {
  return new Response(
    JSON.stringify({
      errors: [
        { status: 409, meta: { code: POLICY_OPENS_SHARES_CODE, audit } },
      ],
    }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  );
}

describe('sendConfirmingPolicyAudit', () => {
  it('sends again with the confirmation once it is agreed to', async () => {
    let sent: Record<string, string>[] = [];
    let response = await sendConfirmingPolicyAudit(
      async (headers) => {
        sent.push(headers);
        return sent.length === 1
          ? refusal()
          : new Response(null, { status: 204 });
      },
      async (shown) => shown.confirmation === audit.confirmation,
    );
    expect(response.status).toBe(204);
    expect(sent).toEqual([
      {},
      { [POLICY_AUDIT_CONFIRMATION_HEADER]: 'abc123' },
    ]);
  });

  it('answers with the refusal when it is declined', async () => {
    let calls = 0;
    let response = await sendConfirmingPolicyAudit(
      async () => {
        calls++;
        return refusal();
      },
      async () => false,
    );
    expect(response.status).toBe(409);
    expect(calls).toBe(1);
  });

  it('leaves any other conflict alone', async () => {
    let asked = false;
    let response = await sendConfirmingPolicyAudit(
      async () =>
        new Response(JSON.stringify({ errors: [{ status: 409 }] }), {
          status: 409,
        }),
      async () => (asked = true),
    );
    expect(response.status).toBe(409);
    expect(asked).toBe(false);
  });
});

describe('confirmPolicyAuditFor', () => {
  it('lists both kinds of key before agreeing under --confirm-shared-keys', async () => {
    let printed: string[] = [];
    let confirmed = await confirmPolicyAuditFor({
      confirmed: true,
      print: (line) => printed.push(line),
    })(audit);
    expect(confirmed).toBe(true);
    let text = printed.join('\n');
    expect(text).toContain('They will start using:');
    expect(text).toContain('Forecast key');
    expect(text).toContain(
      'These keys will refuse them until their owners allow it:',
    );
    expect(text).toContain('Alerts key');
  });

  it('refuses without a terminal to ask', async () => {
    let printed: string[] = [];
    let confirmed = await confirmPolicyAuditFor({
      isTTY: false,
      print: (line) => printed.push(line),
    })(audit);
    expect(confirmed).toBe(false);
    expect(printed.at(-1)).toContain('--confirm-shared-keys');
  });

  it('asks a terminal', async () => {
    let yes = confirmPolicyAuditFor({
      isTTY: true,
      print: () => {},
      ask: async () => 'y',
    });
    let no = confirmPolicyAuditFor({
      isTTY: true,
      print: () => {},
      ask: async () => '',
    });
    expect(await yes(audit)).toBe(true);
    expect(await no(audit)).toBe(false);
  });

  it('names the workspace for a key whose details the saver can’t see', () => {
    let text = describePolicyAudit({
      ...audit,
      entries: [{ ...audit.entries[0], share: null, label: null, owner: null }],
    }).join('\n');
    expect(text).toContain('A key shared into https://app.example.test/team/');
    expect(text).not.toContain('@owner:example.test');
  });

  it('describes a list of one kind only', () => {
    let lines = describePolicyAudit({
      ...audit,
      entries: [audit.entries[0]],
    });
    expect(lines.join('\n')).not.toContain('refuse them');
  });
});
