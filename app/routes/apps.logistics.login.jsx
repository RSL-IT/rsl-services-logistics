// app/routes/apps.logistics.login.jsx
import { json } from "@remix-run/node";
import bcrypt from "bcryptjs";
import { verifyProxyIfPresent } from "~/utils/app-proxy-verify.server";
import { logisticsDb } from "~/logistics-db.server";

function mapUserTypeToRole(userType) {
  const raw = String(userType || "").trim().toLowerCase();
  return raw.includes("supplier") ? "supplier" : "internal";
}

// This route is used as an API endpoint by the LogisticsApp login UI.
// It supports both JSON (fetch) and form-encoded posts.
export async function action({ request }) {
  // 1) Best-effort app proxy verification
  let proxyVerified = false;
  let proxySkipReason = "none";

  try {
    await verifyProxyIfPresent(request);
    proxyVerified = true;
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      proxyVerified = false;
      proxySkipReason = "no_proxy_signature";
    } else {
      console.info("[logistics login] proxy verification error", err);
      proxySkipReason = "verify_exception";
    }
  }

  // 2) Parse body
  const contentType = request.headers.get("content-type") || "";
  let email = "";
  let password = "";

  try {
    if (contentType.includes("application/json")) {
      const body = await request.json();
      email = (body.email || "").toString().trim().toLowerCase();
      password = (body.password || "").toString();
    } else {
      const formData = await request.formData();
      email = ((formData.get("email") ?? "") + "").trim().toLowerCase();
      password = ((formData.get("password") ?? "") + "").toString();
    }
  } catch (err) {
    console.error("[logistics login] body parse error", err, { contentType });
    return json(
      {
        ok: false,
        stage: "invalid_body",
        proxyVerified,
        proxySkipReason,
        emailPresent: !!email,
        passwordPresent: !!password,
      },
      { status: 400 },
    );
  }

  if (!email || !password) {
    return json(
      {
        ok: false,
        stage: "missing_fields",
        proxyVerified,
        proxySkipReason,
        emailPresent: !!email,
        passwordPresent: !!password,
      },
      { status: 400 },
    );
  }

  // 3) Look up user
  const candidate = await logisticsDb.tbl_logisticsUser.findFirst({
    where: { email },
    select: {
      id: true,
      email: true,
      password: true,
      isActive: true,
      userType: true,
      companyID: true,
    },
  });

  console.info(
    "[logistics login] candidate",
    candidate
      ? {
        id: candidate.id,
        email: candidate.email,
        isActive: candidate.isActive,
        userType: candidate.userType,
      }
      : null,
  );

  if (!candidate || candidate.isActive === false || !candidate.password) {
    return json(
      {
        ok: false,
        stage: "invalid_creds",
        proxyVerified,
        proxySkipReason,
      },
      { status: 401 },
    );
  }

  // 4) Check password
  const pwdOk = await bcrypt.compare(password, candidate.password);
  if (!pwdOk) {
    return json(
      {
        ok: false,
        stage: "invalid_creds",
        proxyVerified,
        proxySkipReason,
      },
      { status: 401 },
    );
  }

  // 5) Map DB userType -> role
  const role = mapUserTypeToRole(candidate.userType);

  const responseBody = {
    ok: true,
    stage: "success",
    proxyVerified,
    proxySkipReason,
    email: candidate.email,
    role,
    supplierId: role === "supplier" ? candidate.companyID : null,
  };

  console.info("[logistics login] success", responseBody);
  return json(responseBody);
}

export function loader() {
  return json({ ok: true });
}
