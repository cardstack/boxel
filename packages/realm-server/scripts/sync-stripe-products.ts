import '../setup-logger';
import { PgAdapter } from '@cardstack/postgres';

async function fetchStripeProducts() {
  const response = await fetch(
    'https://api.stripe.com/v1/products?active=true',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    },
  );
  return response.json();
}

async function main() {
  let pgAdapter = new PgAdapter();
  let products = await fetchStripeProducts();
  if (products.error) {
    throw new Error(products.error.message);
  }
  let planQuery = await pgAdapter.execute(`SELECT name FROM plans`);
  let planNames = planQuery.map((row) => row.name);

  let planStripeIds = products.data.reduce(
    (acc: Record<string, string>, product: any) => {
      acc[product.name] = product.id;
      return acc;
    },
    {},
  ) as Record<string, string>;

  let updateQueries = planNames.map((planName) => {
    let planStripeId = planStripeIds[planName as string];
    if (!planStripeId) {
      throw new Error(`Plan ${planName} not found in Stripe`);
    }
    return `UPDATE plans SET stripe_plan_id = '${planStripeId}' WHERE name = '${planName}';`;
  });

  await pgAdapter.execute(updateQueries.join('\n'));

  console.log('Plans were updated using the following queries:');
  console.log(updateQueries.join('\n'));
}

main();
