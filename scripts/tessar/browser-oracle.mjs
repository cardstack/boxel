import { validateSummary } from './generate.mjs';

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
