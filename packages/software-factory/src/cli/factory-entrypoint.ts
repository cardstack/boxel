import {
  FactoryEntrypointUsageError,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  runFactoryEntrypoint,
  wantsFactoryEntrypointHelp,
} from '../factory-entrypoint';
import { FactoryBriefError } from '../factory-brief';

async function main(): Promise<void> {
  try {
    if (wantsFactoryEntrypointHelp(process.argv.slice(2))) {
      console.log(getFactoryEntrypointUsage());
      return;
    }

    let options = parseFactoryEntrypointArgs(process.argv.slice(2));
    let summary = await runFactoryEntrypoint(options);
    let output = JSON.stringify(summary, null, 2) + '\n';
    if (!process.stdout.write(output)) {
      process.stdout.once('drain', () => process.exit(0));
    } else {
      process.exit(0);
    }
  } catch (error) {
    if (error instanceof FactoryEntrypointUsageError) {
      console.error(error.message);
      console.error('');
      console.error(getFactoryEntrypointUsage());
    } else if (error instanceof FactoryBriefError) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exit(1);
  }
}

void main();
