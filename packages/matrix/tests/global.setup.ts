import { smtpStart, smtpStop } from '../docker/smtp4dev';

export default async function setup() {
  await smtpStart();
  console.log('First time setup complete');

  return async () => {
    await smtpStop();
  };
}
