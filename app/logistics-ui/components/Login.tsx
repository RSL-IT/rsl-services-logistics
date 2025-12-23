// app/logistics-ui/components/Login.tsx
import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Card, TextField, Button, Text, Banner, BlockStack } from "@shopify/polaris";
import type { LoginProps } from "./types";

export function Login({ onLogin, users, initialError }: LoginProps) {
  const fetcher = useFetcher<any>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Put focus into the first field on initial render.
  useEffect(() => {
    const t = setTimeout(() => {
      const input = document.querySelector('input[name="email"]') as HTMLInputElement | null;
      input?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const errorMessage =
    initialError ||
    (fetcher.data && fetcher.data.ok === false && fetcher.data.error) ||
    null;

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok !== true) return;

    const activeRole = fetcher.data.role; // "internal" | "supplier"
    const supplierId = (fetcher.data.supplierId ?? null) as string | null;

    const matchedUser =
      users.find(
        (u) => String(u.email).toLowerCase() === String(fetcher.data.email).toLowerCase()
      ) || null;

    if (!matchedUser) {
      console.warn("[logistics login] user not found in initialUsers:", fetcher.data.email);
      return;
    }

    onLogin(activeRole, matchedUser, supplierId);
  }, [fetcher.data, onLogin, users]);

  return (
    <div style={{ maxWidth: 460, margin: "48px auto" }}>
      <Card padding="600">
        <BlockStack gap="400">
          <Text variant="headingLg" as="h1">
            RSL Logistics Portal
          </Text>

          {errorMessage ? (
            <Banner tone="critical">
              <p>{errorMessage}</p>
            </Banner>
          ) : null}

          <fetcher.Form method="post" action="/apps/logistics/login">
            <BlockStack gap="300">
              <TextField
                label="Email"
                name="email"
                value={email}
                onChange={setEmail}
                autoComplete="username"
              />

              <TextField
                label="Password"
                name="password"
                value={password}
                onChange={setPassword}
                type="password"
                autoComplete="current-password"
              />

              <Button submit variant="primary" loading={fetcher.state !== "idle"}>
                Sign in
              </Button>
            </BlockStack>
          </fetcher.Form>

          <Text as="p" tone="subdued">
            If your account does not yet have a password set, you can sign in and set it later.
          </Text>
        </BlockStack>
      </Card>
    </div>
  );
}

export default Login;
