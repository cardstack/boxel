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
