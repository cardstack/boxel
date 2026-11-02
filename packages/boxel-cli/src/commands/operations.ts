import type { Command } from 'commander';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../lib/profile-manager.ts';
import { cliLog } from '../lib/cli-log.ts';
import { FG_RED, RESET } from '../lib/colors.ts';

// `boxel operations invoke`: one operation, invoked on a card or on a card
// type, through the realm's `_operations` endpoint, as a card in the browser
// invokes it. The CLI counts as interactive: it invokes with the profile's
// own session, never as a pipeline, so a `callApi` operation that sends a key
// is refused unless it was approved for interactive use, while a keyless one
// is sent and answers with what the vendor answered.

export interface InvokeOptions {
  params?: string;
  realm?: string;
  profileManager?: ProfileManager;
}

export interface InvokeResult {
  status: number;
  // The operation's answer: for a `callApi`, the vendor's `{status, headers,
  // body}`, or what its `output` mapping made of it.
  result?: unknown;
  // The realm's refusal, as it sent it.
  errors?: unknown[];
}

// A card is named by its URL; a card type by `<module>#<Class>`.
function targetOf(target: string): {
  href?: string;
  adoptsFrom?: { module: string; name: string };
  url: string;
} {
  let hash = target.lastIndexOf('#');
  if (hash > 0) {
    let module = target.slice(0, hash);
    let name = target.slice(hash + 1);
    if (!name) {
      throw new Error(`${target} names no class after its #`);
    }
    return { adoptsFrom: { module, name }, url: module };
  }
  return { href: target, url: target };
}

function paramsOf(value: string | undefined): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('--params is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--params is a JSON object of the operation’s params');
  }
  return parsed as Record<string, unknown>;
}

export async function invokeOperation(
  target: string,
  name: string,
  options: InvokeOptions = {},
): Promise<InvokeResult> {
  let pm = options.profileManager ?? getProfileManager();
  if (!pm.getActiveProfile()) {
    throw new Error(NO_ACTIVE_PROFILE_ERROR);
  }
  let params = paramsOf(options.params);
  let { href, adoptsFrom, url } = targetOf(target);
  let realm = options.realm ?? (await pm.realmUrlFor(url));
  if (!realm) {
    throw new Error(
      `${url} isn't in a realm this profile can reach. Name the realm with --realm`,
    );
  }
  let invocation = {
    op: 'invoke',
    'boxel:name': name,
    ...(href ? { href } : {}),
    data: adoptsFrom ? { ...params, meta: { adoptsFrom } } : params,
  };
  let response = await pm.authedRealmFetch(
    new URL('_operations', realm.endsWith('/') ? realm : `${realm}/`).href,
    {
      method: 'POST',
      headers: {
        Accept: SupportedMimeType.BoxelOperations,
        'Content-Type': SupportedMimeType.BoxelOperations,
      },
      body: JSON.stringify({ 'boxel:operations': [invocation] }),
    },
  );
  let text = await response.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    return {
      status: response.status,
      errors: Array.isArray(json?.errors) ? json.errors : [text.slice(0, 300)],
    };
  }
  return { status: response.status, result: json?.['atomic:results']?.[0] };
}

function describeErrors(errors: unknown[]): string {
  return errors
    .map((error: any) =>
      typeof error === 'string'
        ? error
        : [error?.code, error?.detail ?? error?.title]
            .filter(Boolean)
            .join(': '),
    )
    .join('; ');
}

export function registerOperationsCommand(program: Command): void {
  let operations = program
    .command('operations')
    .description("Invoke a card's operations");

  operations
    .command('invoke')
    .description(
      'Invoke an operation on a card, or on a card type, and print its answer. The CLI counts as interactive, so an operation that sends a key is refused unless it is approved for interactive use',
    )
    .argument(
      '<card-or-type-url>',
      'A card’s URL, or <module>#<Class> for a card type',
    )
    .argument('<name>', 'The operation')
    .option('--params <json>', 'The operation’s params, as a JSON object')
    .option(
      '--realm <url>',
      'The realm to invoke it in (default: the one the card or module is in)',
    )
    .option('--json', 'Output JSON')
    .action(
      async (
        target: string,
        name: string,
        options: { params?: string; realm?: string; json?: boolean },
      ) => {
        let result: InvokeResult;
        try {
          result = await invokeOperation(target, name, options);
        } catch (e: any) {
          console.error(`${FG_RED}Error:${RESET} ${e?.message ?? e}`);
          process.exitCode = 1;
          return;
        }
        if (options.json) {
          cliLog.output(JSON.stringify(result, null, 2));
        } else if (result.errors) {
          console.error(
            `${FG_RED}Refused (HTTP ${result.status}):${RESET} ${describeErrors(result.errors)}`,
          );
        } else {
          cliLog.output(JSON.stringify(result.result, null, 2));
        }
        if (result.errors) {
          process.exitCode = 1;
        }
      },
    );
}
