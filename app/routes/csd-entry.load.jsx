import { json as remixJson } from '@remix-run/node';
import { authenticate as shopifyAuthenticate } from '~/shopify.server';


export async function action({ request }) {
  const { admin } = await shopifyAuthenticate.admin(request);
  const { orderGid } = await request.json();
  if (!orderGid) return remixJson({ ok: false, error: 'Missing orderGid' }, { status: 400 });


  const query = `#graphql
query CsdEntryLoad($id: ID!) {
order(id: $id) { id name customer { displayName firstName lastName } }
}`;
  const response = await admin.graphql(query, { variables: { id: orderGid } });
  const result = await response.json();
  const order = result?.data?.order;
  return remixJson({
    ok: true,
    orderNumber: order?.name || null,
    customerName: order?.customer?.displayName || (order?.customer?.firstName && order?.customer?.lastName ? `${order.customer.firstName} ${order.customer.lastName}` : null),
  });
}
