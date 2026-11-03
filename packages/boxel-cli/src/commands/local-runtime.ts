import type { Command } from 'commander';
import { BoxelRuntimeClient } from '../lib/boxel-runtime-client.ts';
import { cliLog } from '../lib/cli-log.ts';

export function registerLocalRuntimeCommands(program: Command): void {
  for (let operation of ['up', 'down', 'status', 'doctor'] as const) {
    program
      .command(operation)
      .description(
        `${operation === 'up' ? 'Start' : operation === 'down' ? 'Stop' : operation === 'status' ? 'Inspect' : 'Diagnose'} a stack managed by the native Boxel runtime`,
      )
      .argument('[stack]', 'Runtime stack name', 'default')
      .option(
        '--endpoint <url>',
        'Native runtime HTTP loopback origin (or BOXEL_RUNTIME_URL)',
      )
      .option('--json', 'Emit structured status as JSON')
      .action(
        async (
          stack: string,
          options: { endpoint?: string; json?: boolean },
        ) => {
          try {
            let client = new BoxelRuntimeClient(options.endpoint);
            if (operation === 'doctor') {
              let result = await client.doctor(stack);
              if (options.json) cliLog.output(JSON.stringify(result, null, 2));
              else
                for (let check of result.checks)
                  cliLog.output(
                    `${check.ok ? 'ok' : 'failed'} ${check.name}: ${check.detail}`,
                  );
              if (!result.ok) process.exitCode = 1;
            } else {
              let status = await client[operation](stack);
              if (options.json) cliLog.output(JSON.stringify(status, null, 2));
              else {
                cliLog.output(`${status.stack}: ${status.state}`);
                for (let service of Object.values(status.services))
                  cliLog.output(`  ${service.name}: ${service.state}`);
              }
            }
          } catch (error) {
            console.error(
              error instanceof Error
                ? error.message
                : 'Local runtime operation failed',
            );
            process.exitCode = 1;
          }
        },
      );
  }
}
