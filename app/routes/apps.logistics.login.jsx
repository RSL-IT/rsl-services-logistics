// app/routes/apps.logistics.login.jsx
import { json, redirect } from "@remix-run/node";
import bcrypt from "bcryptjs";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";
import { logisticsDb } from "~/logistics-db.server";
import { commitLogisticsUserSession } from "~/logistics-auth.server";
import { createLogisticsToken } from "~/utils/logistics-token.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  return redirect(`/apps/logistics/portal${url.search}`);
}

// API endpoint used by the Logistics UI login form.
// - Allows passwordless login for legacy users with password=NULL.
// - If a user has a password hash, requires a matching password.
// - On success, sets a cookie session so portal reloads won't "bounce" back to login.
export async function action({ request }) {
  const debug = { stage: "start", proxyVerified: false };

  // Best-effort proxy verification
  try {
    await verifyProxyIfPresent(request);
    debug.proxyVerified = true;
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      debug.proxyVerified = false;
      debug.proxySkipReason = "no_proxy_signature";
      console.warn("[logistics login] proxy verification skipped:", {
        status: err.status,
      });
    } else {
      console.error("[logistics login] proxy verification error:", err);
    }
  }

  try {
    debug.stage = "parse-body";
    const contentType = request.headers.get("content-type") || "";
    let payload;

    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      const formData = await request.formData();
      payload = Object.fromEntries(formData);
    }

    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const passwordPresent = password.trim().length > 0;

    if (!email) {
      return json({ ok: false, error: "Email is required." }, { status: 200 });
    }

    debug.stage = "lookup-user";
    const candidate = await logisticsDb.tbl_logisticsUser.findFirst({
      where: { email },
      select: {
        id: true,
        email: true,
        isActive: true,
        userType: true,
        companyID: true,
        password: true, // may be null
      },
    });

    console.info("[logistics login] candidate", {
      id: candidate?.id,
      email: candidate?.email,
      isActive: candidate?.isActive,
      userType: candidate?.userType,
    });

    if (!candidate || candidate.isActive === false) {
      return json({ ok: false, error: "Invalid credentials." }, { status: 401 });
    }

    const hasPasswordHash = Boolean(candidate.password && String(candidate.password).trim());

    // If user has a password set, require it and validate it.
    if (hasPasswordHash) {
      if (!passwordPresent) {
        return json({ ok: false, error: "Password is required for this account." }, { status: 401 });
      }

      debug.stage = "check-password";
      const ok = await bcrypt.compare(password, String(candidate.password));
      if (!ok) {
        return json({ ok: false, error: "Invalid credentials." }, { status: 401 });
      }
    } else {
      // Legacy account: password=NULL → allow login (but signal it so you can later enforce).
      debug.stage = "legacy-passwordless";
      debug.needsPasswordSetup = true;
    }

    const rawUserType = String(candidate.userType || "").trim().toLowerCase();
    const role = rawUserType.includes("supplier") ? "supplier" : "internal";
    const supplierId = role === "supplier" ? (candidate.companyID ?? null) : null;

    // Persist session cookie
    debug.stage = "commit-session";
    const setCookie = await commitLogisticsUserSession(request, candidate.id);

    console.info("[logistics login] success", {
      ok: true,
      email: candidate.email,
      role,
      supplierId,
      proxyVerified: debug.proxyVerified,
      proxySkipReason: debug.proxySkipReason,
      needsPasswordSetup: debug.needsPasswordSetup || false,
    });

    const url = new URL(request.url);
    const isProxyRequest =
      url.searchParams.has("signature") ||
      url.searchParams.has("path_prefix") ||
      url.searchParams.has("logged_in_customer_id") ||
      Boolean(request.headers.get("x-shopify-shop-domain")) ||
      request.headers.get("x-logistics-proxy") === "1" ||
      (request.headers.get("referer") || "").includes("/apps/logistics");
    const accept = request.headers.get("accept") || "";
    const wantsHtml = accept.includes("text/html");

    if (isProxyRequest) {
      const token = createLogisticsToken(candidate.id);
      const search = new URLSearchParams(url.search);
      search.set("logistics_token", token);

      const redirectPath = `/apps/logistics/portal?${search.toString()}`;
      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <meta http-equiv="refresh" content="0;url=${redirectPath}" />
    <title>Redirecting…</title>
  </head>
  <body>
    <script>window.location.assign(${JSON.stringify(redirectPath)});</script>
  </body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Set-Cookie": setCookie,
        },
      });
    }

    if (wantsHtml) {
      return redirect(`/apps/logistics/portal${url.search}`, {
        headers: { "Set-Cookie": setCookie },
      });
    }

    return json(
      {
        ok: true,
        email: candidate.email,
        role,
        supplierId,
        needsPasswordSetup: Boolean(debug.needsPasswordSetup),
      },
      {
        status: 200,
        headers: { "Set-Cookie": setCookie },
      },
    );
  } catch (err) {
    console.error("[logistics login] unexpected error:", err, debug);
    return json({ ok: false, error: "Server error during login." }, { status: 200 });
  }
}
