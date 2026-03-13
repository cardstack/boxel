import { expect, test } from './fixtures';

test('renders a local card instance through the cached realm server', async ({
  authedPage,
  cardURL,
}) => {
  await authedPage.goto(cardURL('person-1'), {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    authedPage.getByRole('heading', { name: 'Mango' }),
  ).toBeVisible();
  await expect(authedPage.getByText('Mango').first()).toBeVisible();
});

test('opens another local card instance in the shared browser context', async ({
  authedPage,
  cardURL,
}) => {
  await authedPage.goto(cardURL('person-2'), {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    authedPage.getByRole('heading', { name: 'Papaya' }),
  ).toBeVisible();
});

test('allows one test to mutate data inside its fresh realm runtime', async ({
  authedPage,
  realm,
  cardURL,
}) => {
  let response = await fetch(cardURL('person-1'), {
    method: 'PATCH',
    headers: {
      Accept: 'application/vnd.card+json',
      'Content-Type': 'application/vnd.card+json',
      ...realm.authorizationHeaders(),
    },
    body: JSON.stringify({
      data: {
        type: 'card',
        attributes: {
          firstName: 'Dragonfruit',
        },
        meta: {
          adoptsFrom: {
            module: './person.gts',
            name: 'Person',
          },
        },
      },
    }),
  });

  expect(response.ok).toBeTruthy();

  await authedPage.goto(cardURL('person-1'), {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    authedPage.getByRole('heading', { name: 'Dragonfruit' }),
  ).toBeVisible();
});

test('restores the cached template data for the next test run', async ({
  authedPage,
  realm,
  cardURL,
}) => {
  let response = await fetch(cardURL('person-1'), {
    headers: {
      Accept: 'application/vnd.card+json',
      ...realm.authorizationHeaders(),
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
    },
  });
  let json = await response.json();

  expect(json.data.attributes.firstName).toBe('Mango');

  await authedPage.goto(cardURL('person-1'), {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    authedPage.getByRole('heading', { name: 'Mango' }),
  ).toBeVisible();
});
