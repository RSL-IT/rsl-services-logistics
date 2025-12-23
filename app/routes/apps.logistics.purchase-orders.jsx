// app/routes/apps.logistics.purchase-orders.jsx
import { json } from "@remix-run/node";
import { logisticsDb } from "~/logistics-db.server";
import { prisma } from "~/db.server";
import { runAdminQuery } from "~/shopify-admin.server";

function cleanStrOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function shopFromUrlString(urlString) {
  if (!urlString) return null;
  try {
    const u = new URL(urlString);
    return u.searchParams.get("shop");
  } catch {
    return null;
  }
}

async function resolveShopForAdmin(request) {
  const url = new URL(request.url);

  // Prefer explicit query param on THIS request
  const shopFromQuery = url.searchParams.get("shop");
  if (shopFromQuery) return shopFromQuery;

  // Sometimes people pass it via header
  const shopFromHeader = request.headers.get("x-shopify-shop-domain");
  if (shopFromHeader) return shopFromHeader;

  // If the page URL has ?shop=... but your fetch() didn’t include it,
  // we can often recover it from the referer.
  const refShop = shopFromUrlString(request.headers.get("referer"));
  if (refShop) return refShop;

  // Fallback: most recent offline session in the Session table
  const sess = await prisma.session.findFirst({
    where: { isOnline: false },
    orderBy: [{ expires: "desc" }],
  });

  return sess?.shop || null;
}

function formatGraphQLErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  return errors
    .map((e) => (e?.message ? String(e.message) : JSON.stringify(e)))
    .join("; ");
}

async function uploadPdfToShopifyFiles({ shop, file }) {
  const filename = file.name || "purchase-order.pdf";
  const mimeType = file.type || "application/pdf";
  const fileSize =
    typeof file.size === "number" && Number.isFinite(file.size)
      ? Math.trunc(file.size)
      : null;

  const STAGED_UPLOAD = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `;

  const stagedResp = await runAdminQuery(shop, STAGED_UPLOAD, {
    input: [
      {
        filename,
        mimeType,
        httpMethod: "POST",
        // UnsignedInt64 must be encoded as a STRING in GraphQL variables
        fileSize: String(file.size ?? 0),
        resource: "FILE",
      },
    ],
  });


  // IMPORTANT: surface top-level GraphQL errors (not userErrors)
  const gqlErrMsg = formatGraphQLErrors(stagedResp?.errors);
  if (gqlErrMsg) {
    throw new Error(`stagedUploadsCreate GraphQL error: ${gqlErrMsg}`);
  }

  const stagedCreate = stagedResp?.data?.stagedUploadsCreate;
  if (!stagedCreate) {
    throw new Error(
      "stagedUploadsCreate returned no data. (Most likely missing scopes like write_files, or an Admin API error.)"
    );
  }

  const stagedErrs = stagedCreate?.userErrors || [];
  if (stagedErrs.length) {
    throw new Error(stagedErrs[0]?.message || "stagedUploadsCreate failed.");
  }

  const target = stagedCreate?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl || !Array.isArray(target.parameters)) {
    throw new Error(
      "Missing staged upload target. (Shopify did not return stagedTargets. This is commonly caused by missing write_files scope or an API error.)"
    );
  }

  // POST file to staged target
  const fd = new FormData();
  for (const p of target.parameters) {
    fd.append(p.name, p.value);
  }
  fd.append("file", file);

  const uploadRes = await fetch(target.url, { method: "POST", body: fd });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(`Staged upload failed: ${uploadRes.status} ${text}`.trim());
  }

  const FILE_CREATE = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          ... on GenericFile { id url }
        }
        userErrors { field message }
      }
    }
  `;

  const createResp = await runAdminQuery(shop, FILE_CREATE, {
    files: [
      {
        originalSource: target.resourceUrl,
        contentType: "FILE",
      },
    ],
  });

  const createErrMsg = formatGraphQLErrors(createResp?.errors);
  if (createErrMsg) {
    throw new Error(`fileCreate GraphQL error: ${createErrMsg}`);
  }

  const createNode = createResp?.data?.fileCreate;
  if (!createNode) {
    throw new Error("fileCreate returned no data.");
  }

  const createErrs = createNode?.userErrors || [];
  if (createErrs.length) {
    throw new Error(createErrs[0]?.message || "fileCreate failed.");
  }

  const created = createNode?.files?.[0];
  const fileId = created?.id || null;
  let url = created?.url || null;

  // Sometimes url can lag briefly; do a short poll if needed
  if (fileId && !url) {
    const NODE_QUERY = `
      query node($id: ID!) {
        node(id: $id) {
          ... on GenericFile { url }
        }
      }
    `;

    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const n = await runAdminQuery(shop, NODE_QUERY, { id: fileId });

      const nErrMsg = formatGraphQLErrors(n?.errors);
      if (nErrMsg) {
        throw new Error(`GenericFile url poll GraphQL error: ${nErrMsg}`);
      }

      url = n?.data?.node?.url || null;
      if (url) break;
    }
  }

  if (!url) throw new Error("Upload completed but no CDN URL available yet.");
  return url;
}

export async function action({ request }) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // --- Upload PDF intent (multipart) ---
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const intent = String(formData.get("intent") || "").trim();

      if (intent === "upload_pdf") {
        const shop = await resolveShopForAdmin(request);
        if (!shop) {
          return json({
            success: false,
            error:
              "Missing shop context for Shopify Admin API. Include ?shop=... on the upload request (or ensure an offline session exists).",
          });
        }

        const pdf = formData.get("pdf");
        if (!pdf || typeof pdf !== "object" || typeof pdf.arrayBuffer !== "function") {
          return json({ success: false, error: "Missing PDF file upload." });
        }

        // Basic validation (PDF-ish)
        const name = String(pdf.name || "");
        const type = String(pdf.type || "");
        const looksPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
        if (!looksPdf) {
          return json({ success: false, error: "Only PDF uploads are supported." });
        }

        // Optional: size guard (20MB)
        const maxBytes = 20 * 1024 * 1024;
        if (typeof pdf.size === "number" && pdf.size > maxBytes) {
          return json({ success: false, error: "PDF is too large (max 20MB)." });
        }

        const pdfUrl = await uploadPdfToShopifyFiles({ shop, file: pdf });
        return json({ success: true, pdfUrl });
      }

      return json({ success: false, error: "Unknown multipart intent." });
    }

    // --- JSON intents (create/update/delete) ---
    const payload = await request.json().catch(() => null);
    const intent = String(payload?.intent || "").trim();
    const purchaseOrder = payload?.purchaseOrder || {};

    if (!intent) return json({ success: false, error: "Missing intent." });

    if (intent === "create") {
      const shortName = cleanStrOrNull(purchaseOrder.shortName);
      const purchaseOrderGID = cleanStrOrNull(purchaseOrder.purchaseOrderGID);
      const purchaseOrderPdfUrl = cleanStrOrNull(purchaseOrder.purchaseOrderPdfUrl);

      if (!shortName || !purchaseOrderGID) {
        return json({ success: false, error: "shortName and purchaseOrderGID are required." });
      }

      const created = await logisticsDb.tbl_purchaseOrder.create({
        data: { shortName, purchaseOrderGID, purchaseOrderPdfUrl },
        select: { id: true, shortName: true, purchaseOrderGID: true, purchaseOrderPdfUrl: true },
      });

      return json({ success: true, purchaseOrder: created });
    }

    if (intent === "update") {
      const purchaseOrderGID = cleanStrOrNull(purchaseOrder.purchaseOrderGID);
      if (!purchaseOrderGID) {
        return json({ success: false, error: "purchaseOrderGID is required for update." });
      }

      const shortName = cleanStrOrNull(purchaseOrder.shortName);
      const purchaseOrderPdfUrl = cleanStrOrNull(purchaseOrder.purchaseOrderPdfUrl);

      const updated = await logisticsDb.tbl_purchaseOrder.update({
        where: { purchaseOrderGID },
        data: {
          ...(shortName ? { shortName } : {}),
          purchaseOrderPdfUrl,
        },
        select: { id: true, shortName: true, purchaseOrderGID: true, purchaseOrderPdfUrl: true },
      });

      return json({ success: true, purchaseOrder: updated });
    }

    if (intent === "delete") {
      const purchaseOrderGID = cleanStrOrNull(purchaseOrder.purchaseOrderGID);
      if (!purchaseOrderGID) {
        return json({ success: false, error: "purchaseOrderGID is required for delete." });
      }

      await logisticsDb.tbl_purchaseOrder.delete({ where: { purchaseOrderGID } });
      return json({ success: true, deletedPurchaseOrderGID: purchaseOrderGID });
    }

    return json({ success: false, error: `Unknown intent: ${intent}` });
  } catch (e) {
    return json({ success: false, error: e?.message || "Server error." });
  }
}
