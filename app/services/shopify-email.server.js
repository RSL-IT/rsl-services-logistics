// app/services/shopify-email.server.js
import { runAdminQuery } from "../shopify-admin.server.js";

/**
 * Find or create a customer, and optionally opt them into marketing.
 * Returns { id }
 */
async function ensureCustomer(shop, { email, firstName, lastName, marketingOptIn }) {
  // 1) Look up by email
  const findQuery = `#graphql
    query findCustomer($q: String!) {
      customers(first: 1, query: $q) {
        edges { node { id email tags } }
      }
    }`;
  const findRes = await runAdminQuery(shop, findQuery, { q: `email:${email}` });
  const edges = findRes?.body?.data?.customers?.edges ?? [];
  let id = edges[0]?.node?.id;

  // 2) Create if missing
  if (!id) {
    const createMutation = `#graphql
      mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer { id email }
          userErrors { field message }
        }
      }`;
    const input = {
      email,
      firstName: firstName || null,
      lastName: lastName || null,
    };
    const createRes = await runAdminQuery(shop, createMutation, { input });
    id = createRes?.body?.data?.customerCreate?.customer?.id;
    if (!id) {
      const errMsg =
        createRes?.body?.data?.customerCreate?.userErrors?.map(e => e.message).join(", ") ||
        "customerCreate failed";
      throw new Error(errMsg);
    }
  }

  // 3) (Optional) marketing consent; non-fatal if it fails
  if (marketingOptIn) {
    try {
      const consentMutation = `#graphql
        mutation customerEmailMarketingConsentUpdate($input: CustomerEmailMarketingConsentUpdateInput!) {
          customerEmailMarketingConsentUpdate(input: $input) {
            customer { id }
            userErrors { field message }
          }
        }`;
      await runAdminQuery(shop, consentMutation, {
        input: {
          customerId: id,
          email,
          marketingState: "SUBSCRIBED",        // request single opt-in
          marketingOptInLevel: "SINGLE_OPT_IN",
          consentUpdatedAt: new Date().toISOString(),
        },
      });
    } catch (e) {
      // Don't block Powerbuy on consent mutation issues
      console.warn("Marketing consent update failed:", e?.message || e);
    }
  }

  return { id };
}

/** Set a JSON metafield on the customer */
async function setCustomerMetafield(shop, customerId, namespace, key, valueObj) {
  const mutation = `#graphql
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace }
        userErrors { field message }
      }
    }`;
  const variables = {
    metafields: [
      {
        ownerId: customerId,
        namespace,
        key,
        type: "json",
        value: JSON.stringify(valueObj),
      },
    ],
  };
  return runAdminQuery(shop, mutation, variables);
}

/** Add Shopify tags to a node (customer) */
async function addTags(shop, id, tags) {
  const mutation = `#graphql
    mutation tagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }`;
  return runAdminQuery(shop, mutation, { id, tags });
}

/**
 * Queue the confirmation email via Shopify Flow:
 * - store confirm payload in a customer metafield
 * - add tag `rsl_powerbuy_confirm_pending` (Flow A trigger)
 */
export async function queuePowerbuyConfirmationEmail({
                                                       shop,
                                                       email,
                                                       firstName,
                                                       lastName,
                                                       confirmUrl,
                                                       powerbuyId,
                                                       offerTitle,
                                                       marketingOptIn,
                                                     }) {
  const { id } = await ensureCustomer(shop, {
    email,
    firstName,
    lastName,
    marketingOptIn: !!marketingOptIn,
  });

  await setCustomerMetafield(shop, id, "rsl_powerbuy", "confirm_payload", {
    confirmUrl,
    powerbuyId,
    offerTitle,
    sentAt: new Date().toISOString(),
  });

  await addTags(shop, id, ["rsl_powerbuy_confirm_pending"]);
}

/**
 * Queue the acceptance email via Shopify Flow:
 * - store discount payload in a customer metafield
 * - add tag `rsl_powerbuy_send_code` (Flow B trigger)
 */
export async function queuePowerbuyAcceptanceEmail({
                                                     shop,
                                                     email,
                                                     firstName,
                                                     lastName,
                                                     discountCode,
                                                     startsAtISO,
                                                     endsAtISO,
                                                     uses,
                                                     productId,
                                                     shortDescription,
                                                     longDescription,
                                                     contactEmail,
                                                   }) {
  const { id } = await ensureCustomer(shop, {
    email,
    firstName,
    lastName,
    marketingOptIn: false,
  });

  await setCustomerMetafield(shop, id, "rsl_powerbuy", "code_payload", {
    discountCode,
    productId,
    startsAt: startsAtISO || null,
    endsAt: endsAtISO || null,
    uses: typeof uses === "number" ? uses : null,
    shortDescription: shortDescription || "",
    longDescription: longDescription || "",
    contactEmail: contactEmail || "",
    sentAt: new Date().toISOString(),
  });

  await addTags(shop, id, ["rsl_powerbuy_send_code"]);
}
