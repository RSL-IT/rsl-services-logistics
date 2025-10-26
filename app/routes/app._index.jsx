// app/routes/app._index.jsx
import { Page, Layout, Card, Text, Box } from "@shopify/polaris";
import { addDocumentResponseHeaders, getShopify } from "~/shopify.server";

export const headers = addDocumentResponseHeaders;
export const meta = () => [{ title: "RSL Services" }];

export const loader = async (args) => {
  await getShopify().authenticate.public.appRoute(args);
  return null; // or json({})
};

export default function AppIndex() {
  return (
    <Page title="RSL Services App">
      <Layout>
        <Layout.Section>
          <Card>
            <div style={{ padding: 16 }}>
              <Text as="h1" variant="headingLg">
                RSL Services Application
              </Text>

              <div style={{ marginTop: 8 }}>
                <Text variant="bodyMd" as="p">
                  This application adds needed functionality to support the RSL workflow.
                </Text>
              </div>

              <div style={{ marginTop: 16 }}>
                <Text as="h3" variant="headingMd">
                  Services Offered (or in Development)
                </Text>
              </div>

              <div style={{ marginTop: 8 }}>
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  <li>
                    <strong>Return Handling (DEV)</strong> - Ability to process the items after
                    they've been evaluated.
                  </li>
                  <li>
                    <strong>In-process(DEV)</strong> - Track Return orders and mark when evaluated
                    - probably will be rolled into Return Handling.
                  </li>
                  <li>
                    <strong>Serial Numbers (DEV)</strong> - Feature to make serial numbers more
                    accessible.
                  </li>
                </ul>
              </div>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
