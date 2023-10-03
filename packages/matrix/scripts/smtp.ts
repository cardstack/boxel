import { smtpStart, smtpStop } from '../docker/smtp4dev';

const [command] = process.argv.slice(2);
(async () => {
  if (command === 'start') {
    await smtpStart();
  } else if (command === 'stop') {
    await smtpStop();
    console.log(`stopped container 'boxel-smtp'`);
  } else {
    console.error(
      `Unknown command "${command}", available commands are "start" and "stop"`,
    );
    process.exit(1);
  }
})().catch((e) => console.error(`unexpected error`, e));
