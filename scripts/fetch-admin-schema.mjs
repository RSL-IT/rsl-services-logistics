import fs from "node:fs/promises";

const shop = process.env.SHOPIFY_SHOP;           // e.g. my-store.myshopify.com
const token = process.env.SHOPIFY_ADMIN_TOKEN;   // Admin API access token
const version = process.env.SHOPIFY_API_VERSION || "2025-01";

if (!shop || !token) {
  console.error("Set SHOPIFY_SHOP and SHOPIFY_ADMIN_TOKEN in your env.");
  process.exit(1);
}

const url = `https://${shop}/admin/api/${version}/graphql.json`;
const introspection = {
  query: `
    query IntrospectionQuery {
      __schema { types { kind name } }  # short probe; server ignores size
    }
  `
};

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token
  },
  body: JSON.stringify({ query: /* GraphQL */ `
    query {
      __schema {
        queryType { name }
        mutationType { name }
        types {
          kind
          name
          fields { name }
        }
      }
    }
  ` })
});

if (!res.ok) {
  console.error("Failed to fetch schema:", res.status, await res.text());
  process.exit(1);
}

const json = await res.json();
await fs.mkdir("schema", { recursive: true });
await fs.writeFile(`schema/admin-${version}.json`, JSON.stringify(json.data, null, 2));
console.log(`Saved schema/admin-${version}.json`);
