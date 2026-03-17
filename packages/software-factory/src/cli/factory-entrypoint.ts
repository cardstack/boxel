import {
  FactoryEntrypointUsageError,
  buildFactoryEntrypointSummary,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  wantsFactoryEntrypointHelp,
} from '../factory-entrypoint';

try {
  if (wantsFactoryEntrypointHelp(process.argv.slice(2))) {
    console.log(getFactoryEntrypointUsage());
    process.exit(0);
  }

  let options = parseFactoryEntrypointArgs(process.argv.slice(2));
  let summary = buildFactoryEntrypointSummary(options);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (error instanceof FactoryEntrypointUsageError) {
    console.error(error.message);
    console.error('');
    console.error(getFactoryEntrypointUsage());
  } else {
    console.error(error);
  }
  process.exit(1);
}
