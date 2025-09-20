import { json as remixJson } from '@remix-run/node';
import { authenticate as shopifyAuthenticate } from '../shopify.server';

export async function action({ request }) {
  const { admin } = await shopifyAuthenticate.admin(request);
  const { orderGid, orderName } = await request.json();

  let order = null;
  if (orderGid) {
    const byIdQ = `#graphql
      query ById($id: ID!) { order(id: $id) { id name customer { displayName firstName lastName } } }
    `;
    const resp = await admin.graphql(byIdQ, { variables: { id: orderGid } });
    const json = await resp.json();
    order = json?.data?.order;
  } else if (orderName) {
    const byNameQ = `#graphql
      query ByName($q: String!) {
        orders(first: 1, query: $q) { edges { node { id name customer { displayName firstName lastName } } } }
      }
    `;
    const resp = await admin.graphql(byNameQ, { variables: { q: `name:${orderName}` } });
    const json = await resp.json();
    order = json?.data?.orders?.edges?.[0]?.node;
  }

  if (!order) return remixJson({ ok: false, error: 'Order not found' }, { status: 404 });

  const customerName =
    order.customer?.displayName ||
    (order.customer?.firstName && order.customer?.lastName
      ? `${order.customer.firstName} ${order.customer.lastName}`
      : null);

  return remixJson({ ok: true, orderGid: order.id, orderNumber: order.name, customerName });
}
