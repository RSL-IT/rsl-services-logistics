// app/logistics-ui/components/Login.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Button,
  BlockStack,
  InlineStack,
  Box,
  Banner,
  Icon,
} from "@shopify/polaris";
import { EmailIcon, LockIcon } from "@shopify/polaris-icons";
import type { LoginProps, User, Role } from "./types";

export function Login({ onLogin, users, initialError }: LoginProps) {
  const fetcher = useFetcher<any>();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const loading = fetcher.state === "submitting";

  // Prevent success handler running twice (can happen with re-renders)
  const handledSuccessRef = useRef(false);

  // Build action URL that preserves any proxy/shop query params
  // (important if verifyProxyIfPresent relies on them)
  const [actionUrl, setActionUrl] = useState("/apps/logistics/login");
  useEffect(() => {
    if (typeof window === "undefined") return;
    setActionUrl(`/apps/logistics/login${window.location.search || ""}`);
  }, []);

  // Autofocus the email field on mount
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const t = window.setTimeout(() => {
      const el = document.querySelector('input[name="email"]') as HTMLInputElement | null;
      el?.focus?.();
    }, 0);

    return () => window.clearTimeout(t);
  }, []);

  // Handle successful login response (NO hard-refresh)
  useEffect(() => {
    const data = fetcher.data as
      | {
      ok?: boolean;
      email?: string;
      role?: Role | string;
      supplierId?: string | null;
    }
      | undefined;

    if (!data?.ok || !data.email || !data.role) return;
    if (handledSuccessRef.current) return;
    handledSuccessRef.current = true;

    const matchEmail = data.email.toLowerCase();
    const user = users.find((u: User) => u.email && u.email.toLowerCase() === matchEmail);
    if (!user) {
      // If the server returned a user email not in users[], we can't map it
      // Reset so user can try again.
      handledSuccessRef.current = false;
      return;
    }

    onLogin(data.role as Role, user, data.supplierId ?? null);

    // Optional: clear password after success (component should unmount immediately anyway)
    setPassword("");
  }, [fetcher.data, onLogin, users]);

  const data = fetcher.data as { ok?: boolean; error?: string } | undefined;
  const errorMessage: string | null =
    (data && data.ok === false && data.error) || initialError || null;

  return (
    <Page>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h1" variant="headingLg">
              RSL Logistics Portal
            </Text>

            <Text as="p" variant="bodyMd">
              Sign in with your logistics credentials to manage shipments, users, and suppliers.
            </Text>

            {errorMessage && (
              <Banner tone="critical" title="Unable to sign in">
                <p>{errorMessage}</p>
              </Banner>
            )}

            <Card>
              <Box padding="400">
                <fetcher.Form method="post" action={actionUrl}>
                  <BlockStack gap="400">
                    <TextField
                      label="Email or username"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={setEmail}
                      prefix={<Icon source={EmailIcon} tone="subdued" />}
                    />

                    <TextField
                      label="Password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={setPassword}
                      prefix={<Icon source={LockIcon} tone="subdued" />}
                    />

                    <InlineStack align="start">
                      <Button submit variant="primary" loading={loading} disabled={loading}>
                        Sign in
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </fetcher.Form>
              </Box>
            </Card>

            <Text as="p" variant="bodySm" tone="subdued">
              Having trouble? Contact RSL IT for access to the logistics portal.
            </Text>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export default Login;
