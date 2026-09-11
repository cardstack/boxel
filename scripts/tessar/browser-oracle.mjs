import { validateSummary } from './generate.mjs';

// The server can supply the entire dashboard as HTML before Ember starts.
// A DOM-only oracle therefore cannot establish client readiness or prove that
// hydration avoids input-graph requests. Require live realm subscriptions and
// removal of the server markup before starting a mutation or timing a read.
export async function waitForTessarInteractive(
  page,
  realmURL,
  timeout = 30000,
) {
  await page.waitForFunction(
    (realmURL) => {
      const messages = window._CARDSTACK_REALM_SUBSCRIBE;
      const start = document.getElementById('boxel-isolated-start');
      const end = document.getElementById('boxel-isolated-end');
      return (
        messages?.isTessarConnected === true &&
        messages.listenerCallbacks.get(realmURL)?.length > 0 &&
        (!start || !end || start.nextElementSibling === end)
      );
    },
    realmURL,
    { timeout },
  );
}

export async function readDisplay(page) {
  return page.evaluate(() => ({
    stats: Object.fromEntries(
      [...document.querySelectorAll('[data-tessar-stat]')].map((el) => [
        el.dataset.tessarStat,
        Number(el.textContent),
      ]),
    ),
    rows: [...document.querySelectorAll('[data-tessar-source]')].map((el) => ({
      sourceId: el.dataset.tessarSource,
      cells: [...el.querySelectorAll('td')].map((td) => td.textContent.trim()),
    })),
  }));
}

export function validateDisplay(actual, expected) {
  const { rows, ...stats } = expected;
  validateSummary(actual.stats, stats);
  const expectedRows = rows.map((row) => ({
    sourceId: row.sourceId,
    cells: [row.label, row.studentLabel, row.referenceLabel, row.status],
  }));
  if (JSON.stringify(actual.rows) !== JSON.stringify(expectedRows))
    throw new Error(
      'Tessar displayed row IDs, order or values differ from the oracle',
    );
}

export async function waitForDisplay(page, expected, timeout = 10000) {
  await page.waitForFunction(
    (expected) => {
      const stats = Object.fromEntries(
        [...document.querySelectorAll('[data-tessar-stat]')].map((el) => [
          el.dataset.tessarStat,
          Number(el.textContent),
        ]),
      );
      const { rows, ...expectedStats } = expected;
      const actualRows = [
        ...document.querySelectorAll('[data-tessar-source]'),
      ].map((el) => ({
        sourceId: el.dataset.tessarSource,
        cells: [...el.querySelectorAll('td')].map((td) =>
          td.textContent.trim(),
        ),
      }));
      return (
        Object.entries(expectedStats).every(
          ([key, value]) => stats[key] === value,
        ) &&
        JSON.stringify(actualRows) ===
          JSON.stringify(
            rows.map((row) => ({
              sourceId: row.sourceId,
              cells: [
                row.label,
                row.studentLabel,
                row.referenceLabel,
                row.status,
              ],
            })),
          )
      );
    },
    expected,
    { timeout },
  );
  validateDisplay(await readDisplay(page), expected);
}
