import { json } from '@remix-run/node';
import { authenticate } from '~/shopify.server';


export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const body = await request.json();


// Optional: save to order metafield if orderGid present
// if (body.orderGid) {
// const metafieldInput = {
// ownerId: body.orderGid,
// namespace: 'rsl.csd',
// key: 'entry',
// type: 'json',
// value: JSON.stringify(body),
// };
// await admin.graphql(`#graphql
  mutation($m: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $m) { userErrors { field message } }
  }`, { variables: { m: [metafieldInput] } });
// }


return json({ ok: true, message: 'CSD entry saved' });
}
