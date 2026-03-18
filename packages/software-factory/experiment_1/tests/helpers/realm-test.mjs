import { seedBoxelLocalStorage } from './boxel-auth.mjs';

function requiredEnv(name) {
  let value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function getRealmTestConfig() {
  return {
    sourceRealmPath: requiredEnv('BOXEL_SOURCE_REALM_PATH'),
    sourceRealmUrl: requiredEnv('BOXEL_SOURCE_REALM_URL'),
    testRealmPath: requiredEnv('BOXEL_TEST_REALM_PATH'),
    testRealmUrl: requiredEnv('BOXEL_TEST_REALM_URL'),
  };
}

export async function seedRealmTestAuth(page, extraRealmUrls = []) {
  let config = getRealmTestConfig();
  await seedBoxelLocalStorage(page, unique([config.sourceRealmUrl, config.testRealmUrl, ...extraRealmUrls]));
}

export function realmCardUrl(cardPath, realmUrl = getRealmTestConfig().testRealmUrl) {
  return new URL(cardPath, realmUrl).href;
}
