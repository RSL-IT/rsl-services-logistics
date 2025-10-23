// app/routes/auth.login/route.jsx
import { json, redirect } from "@remix-run/node";
import { useState } from "react";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { shopify } from "../../shopify.server.js";


export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

function normalizeShop(input) {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!s.endsWith(".myshopify.com")) {
    // allow bare prefix like "rsldev" and expand it
    s = `${s}.myshopify.com`;
  }
  return s;
}

// If a "shop" query param exists, kick off OAuth immediately.
// Otherwise, render the login form.
export const loader = async (args) => {
  const url = new URL(args.request.url);
  const rawShop =
    url.searchParams.get("shop") || process.env.SHOPIFY_STORE_DOMAIN || "";
  const shop = normalizeShop(rawShop);

  if (shop) {
    // Begin OAuth → redirects to Shopify authorize
    return shopify.auth.begin({
      ...args,
      params: { shop }, // ensure normalized domain
    });
  }

  return json({ polarisTranslations, errors: {} });
};

// On POST, validate the submitted shop and bounce to the loader with ?shop=...
export const action = async ({ request }) => {
  const form = await request.formData();
  const submitted = form.get("shop");
  const shop = normalizeShop(typeof submitted === "string" ? submitted : "");

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return json(
      { polarisTranslations, errors: { shop: "Enter a valid .myshopify.com domain" } },
      { status: 400 }
    );
  }

  // Redirect to GET /auth/login?shop=..., which triggers loader → shopify.auth.begin
  return redirect(`/auth/login?shop=${encodeURIComponent(shop)}`);
};

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const errors = (actionData && actionData.errors) || (loaderData && loaderData.errors) || {};

  return (
    <PolarisAppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com or just the prefix, e.g. 'rsldev'"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={errors.shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
