import {
  buildBrowserAuth,
  buildBrowserSession,
  getAccessibleRealmTokens,
  matrixLogin,
} from '../../scripts/lib/boxel.mjs';

export async function boxelBrowserState(realmUrls) {
  let matrixAuth = await matrixLogin();
  let realmTokens = await getAccessibleRealmTokens(matrixAuth);

  return {
    auth: buildBrowserAuth(matrixAuth),
    boxelSession: buildBrowserSession(realmTokens, realmUrls),
  };
}

export async function seedBoxelLocalStorage(page, realmUrls) {
  let state = await boxelBrowserState(realmUrls);
  await page.addInitScript((payload) => {
    window.localStorage.setItem('auth', JSON.stringify(payload.auth));
    window.localStorage.setItem('boxel-session', JSON.stringify(payload.boxelSession));
  }, state);
}
