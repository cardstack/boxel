import type { Command } from 'commander';
import {
  getProfileManager,
  type ProfileManager,
} from '../lib/profile-manager.ts';
import { FG_GREEN, FG_RED, FG_CYAN, DIM, RESET } from '../lib/colors.ts';
import { cliLog } from '../lib/cli-log.ts';

export interface RunCommandResult {
  status: 'ready' | 'error' | 'unusable';
  result?: string | null;
  error?: string | null;
}

export interface RunCommandOptions {
  input?: Record<string, unknown>;
  json?: boolean;
  profileManager?: ProfileManager;
}

interface RunCommandCliOptions {
  realm: string;
  input?: string;
  json?: boolean;
}

export async function runCommand(
  commandSpecifier: string,
  realmUrl: string,
  options?: RunCommandOptions,
): Promise<RunCommandResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(
      'No active profile. Run `boxel profile add` to create one.',
    );
  }

  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
  let url = `${realmServerUrl}/_run-command`;

  let body = {
    data: {
      type: 'run-command',
      attributes: {
        realmURL: realmUrl,
        command: commandSpecifier,
        commandInput: options?.input ?? null,
      },
    },
  };

  let response: Response;
  try {
    response = await pm.authedRealmServerFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      status: 'error',
      error: `run-command fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    let text = await response.text().catch(() => '(no body)');
    return {
      status: 'error',
      error: `run-command HTTP ${response.status}: ${text}`,
    };
  }

  let json: {
    data?: {
      attributes?: {
        status?: string;
        cardResultString?: string | null;
        error?: string | null;
      };
    };
  };

  try {
    json = await response.json();
  } catch {
    return {
      status: 'error',
      error: `run-command response was not valid JSON (HTTP ${response.status})`,
    };
  }

  let attrs = json.data?.attributes;
  return {
    status: (attrs?.status as RunCommandResult['status']) ?? 'error',
    result: attrs?.cardResultString ?? null,
    error: attrs?.error ?? null,
  };
}

export function registerRunCommand(program: Command): void {
  program
    .command('run-command')
    .description(
      'Execute a host command on the realm server via the prerenderer',
    )
    .argument(
      '<command-specifier>',
      'Command module path (e.g. @cardstack/boxel-host/commands/get-card-type-schema/default)',
    )
    .requiredOption(
      '--realm <realm-url>',
      'The realm URL context for the command',
    )
    .option('--input <json>', 'JSON string of command input')
    .option('--json', 'Output raw JSON response')
    .action(async (commandSpecifier: string, opts: RunCommandCliOptions) => {
      let input: Record<string, unknown> | undefined;
      if (opts.input) {
        try {
          let parsed = JSON.parse(opts.input);
          if (
            typeof parsed !== 'object' ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            console.error(
              `${FG_RED}Error:${RESET} --input must be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
            );
            process.exit(1);
          }
          input = parsed;
        } catch {
          console.error(
            `${FG_RED}Error:${RESET} --input is not valid JSON: ${opts.input}`,
          );
          process.exit(1);
        }
      }

      let result: RunCommandResult;
      try {
        result = await runCommand(commandSpecifier, opts.realm, { input });
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
      } else {
        console.log(
          `${DIM}Status:${RESET} ${statusColor(result.status)}${result.status}${RESET}`,
        );
        if (result.result) {
          console.log(`${DIM}Result:${RESET}`);
          try {
            cliLog.output(JSON.stringify(JSON.parse(result.result), null, 2));
          } catch {
            cliLog.output(result.result);
          }
        }
        if (result.error) {
          console.error(`${FG_RED}Error:${RESET} ${result.error}`);
        }
      }

      if (result.status === 'error' || result.status === 'unusable') {
        process.exit(1);
      }
    });
}

function statusColor(status: string): string {
  switch (status) {
    case 'ready':
      return FG_GREEN;
    case 'error':
      return FG_RED;
    default:
      return FG_CYAN;
  }
}
