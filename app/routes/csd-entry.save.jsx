import { json } from '@remix-run/node';
import { authenticate } from '~/shopify.server';

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const body = await request.json();

  // Optional: save to an order metafield if orderGid provided
  if (body.orderGid) {
    const metafieldInput = {
      ownerId: body.orderGid,
      namespace: 'rsl.csd',
      key: 'entry',
      type: 'json',
      value: JSON.stringify(body),
    };
    const mutation = `#graphql
      mutation MetafieldsSet($m: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $m) { userErrors { field message } }
      }
    `;
    const resp = await admin.graphql(mutation, { variables: { m: [metafieldInput] } });
    const result = await resp.json();
    const errs = result?.data?.metafieldsSet?.userErrors;
    if (errs?.length) {
      return json({ ok: false, message: 'Failed to save metafield', errors: errs }, { status: 400 });
    }
  }

  return json({ ok: true, message: 'CSD entry saved' });
}
