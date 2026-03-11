// app/routes/app._index.jsx
import { Page, Layout, Card, Text } from "@shopify/polaris";
import { redirect } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
export const meta = () => [{ title: "RSL Services" }];

function shouldReturnAuthBootstrapResponse(response) {
  if (!(response instanceof Response)) return false;
  return response.status >= 300 || response.status < 200;
}

export const loader = async ({ request }) => {
  let authResult;
  try {
    authResult = await authenticate.admin(request);
  } catch (err) {
    if (shouldReturnAuthBootstrapResponse(err)) return err;
    throw err;
  }
  if (shouldReturnAuthBootstrapResponse(authResult)) return authResult;

  const url = new URL(request.url);
  const params = new URLSearchParams(url.searchParams);
  const query = params.toString();
  const target = query ? `/apps/logistics/portal?${query}` : "/apps/logistics/portal";
  try {
    return authResult.redirect(target);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
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
                  <li>
                    <strong>Logistics (DEV)</strong> - Logistics features to track.
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
