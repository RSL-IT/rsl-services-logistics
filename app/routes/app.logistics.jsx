import {
  Box,
  Card,
  Layout,
  Link,
  List,
  Page,
  Text,
  BlockStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function AdditionalPage() {
  return (
    <Page>
      <TitleBar title="RSL Services - Logistics" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd">
                Ths option will display the logistics tracking information for RSL
                <Link
                  url="https://shopify.dev/docs/apps/tools/app-bridge"
                  target="_blank"
                  removeUnderline
                >
                  App Bridge
                </Link>
                .
              </Text>
              <Text as="p" variant="bodyMd">
                To create your own page and have it show up in the app
                navigation, add a page inside <Code>app/routes</Code>, and a
                link to it in the <Code>&lt;NavMenu&gt;</Code> component found
                in <Code>app/routes/app.jsx</Code>.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Resources
              </Text>
              <List>
                <List.Item>
                  <Link
                    url="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav"
                    target="_blank"
                    removeUnderline
                  >
                    App nav best practices
                  </Link>
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Code({ children }) {
  return (
    <Box
      as="span"
      padding="025"
      paddingInlineStart="100"
      paddingInlineEnd="100"
      background="bg-surface-active"
      borderWidth="025"
      borderColor="border"
      borderRadius="100"
    >
      <code>{children}</code>
    </Box>
  );
}
