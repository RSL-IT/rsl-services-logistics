// app/routes/apps.logistics.purchase-orders.jsx
import { json } from "@remix-run/node";
import { logisticsDb } from "~/logistics-db.server";
import { prisma } from "~/db.server";
import { runAdminQuery } from "~/shopify-admin.server";
import { ensureLogisticsUserOrJson } from "~/logistics-auth.server";

function cleanStrOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function shopFromUrlString(urlStr) {
  try {
    const u = new URL(urlStr);
    const shop = u.searchParams.get("shop");
    return shop ? String(shop).trim() : null;
  } catch {
    return null;
  }
}

async function resolveShopForAdmin(request) {
  const shopFromQuery = shopFromUrlString(request.url);
  const shopFromHeader = request.headers.get("x-shopify-shop-domain");

  if (shopFromQuery) return shopFromQuery;
  if (shopFromHeader) return shopFromHeader;

  // Fallback: most recent offline session in the Session table
  const sess = await prisma.session.findFirst({
    where: { isOnline: false },
    orderBy: [{ expires: "desc" }],
  });

  return sess?.shop || null;
}

function resolveCompanyIDFromAny(payloadOrPo, fallback) {
  return cleanStrOrNull(
    payloadOrPo?.companyID ??
    payloadOrPo?.companyId ??
    payloadOrPo?.companyShortName ??
    payloadOrPo?.company ??
    fallback ??
    null,
  );
}

async function getCompanySummaryByShortName(tx, shortName) {
  if (!shortName) return null;
  return tx.tlkp_company.findUnique({
    where: { shortName },
    select: { shortName: true, displayName: true },
  });
}

function uniqStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr || []) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function extractSelectedProductIDs(purchaseOrder) {
  const raw = Array.isArray(purchaseOrder?.products) ? purchaseOrder.products : [];
  const ids = raw
    .map((p) =>
      cleanStrOrNull(
        p?.rslProductID ??
        p?.rslModelID ??
        p?.shortName ??
        p?.id ??
        null,
      ),
    )
    .filter(Boolean);

  return uniqStrings(ids);
}

function toUiNote(n) {
  const timestampIso = n.createdAt
    ? new Date(n.createdAt).toISOString()
    : new Date().toISOString();

  return {
    id: String(n.id),
    timestamp: timestampIso,
    content: n.content || "",
    eventType: n.eventType || null,
    pdfUrl: n.pdfUrl || null,
    pdfFileName: n.pdfFileName || null,
    user: n.tbl_logisticsUser?.displayName || null,
  };
}

function toUiPO(po, company) {
  const notes = Array.isArray(po.tbl_purchaseOrderNotes)
    ? po.tbl_purchaseOrderNotes.map(toUiNote)
    : [];

  const products = Array.isArray(po.tbljn_purchaseOrder_rslProduct)
    ? po.tbljn_purchaseOrder_rslProduct.map((l) => ({
      rslModelID: l.rslProductID,
      rslProductID: l.rslProductID,
      shortName: l.tlkp_rslProduct?.shortName || l.rslProductID,
      displayName: l.tlkp_rslProduct?.displayName || l.rslProductID,
      SKU: l.tlkp_rslProduct?.SKU || null,
      quantity: typeof l.quantity === "number" ? l.quantity : 0,
    }))
    : [];

  const lastUpdatedBy = notes.length > 0 && notes[0].user ? notes[0].user : null;

  return {
    id: po.id,
    shortName: po.shortName,
    purchaseOrderGID: po.purchaseOrderGID,
    purchaseOrderPdfUrl: po.purchaseOrderPdfUrl || null,
    createdAt: po.createdAt ? po.createdAt.toISOString() : null,
    updatedAt: po.updatedAt ? po.updatedAt.toISOString() : null,

    products,

    companyID: company?.shortName || null,
    companyName: company?.displayName || company?.shortName || null,

    lastUpdatedBy,
    notes,
  };
}

async function selectFullPO(tx, purchaseOrderGID) {
  return tx.tbl_purchaseOrder.findUnique({
    where: { purchaseOrderGID },
    select: {
      id: true,
      shortName: true,
      purchaseOrderGID: true,
      purchaseOrderPdfUrl: true,
      createdAt: true,
      updatedAt: true,
      tbljn_purchaseOrder_rslProduct: {
        select: {
          rslProductID: true,
          quantity: true,
          tlkp_rslProduct: { select: { shortName: true, displayName: true, SKU: true } },
        },
      },
      tbljn_purchaseOrder_company: {
        take: 1,
        select: { tlkp_company: { select: { shortName: true, displayName: true } } },
      },
      tbl_purchaseOrderNotes: {
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          createdAt: true,
          content: true,
          pdfUrl: true,
          pdfFileName: true,
          eventType: true,
          tbl_logisticsUser: { select: { displayName: true } },
        },
      },
    },
  });
}

/**
 * Shopify staged upload + fileCreate
 *
 * Shopify returns GCS v4 signed URLs. The `parameters` array contains metadata
 * like content_type and acl that were used to generate the signature, but these
 * are NOT form fields to POST. Instead, we must PUT the raw file body directly.
 *
 * The signature only covers the `host` header (X-Goog-SignedHeaders=host),
 * so we must NOT add any other headers like Content-Type.
 */
async function uploadPdfToShopifyFiles({ shop, file }) {
  const filename = file.name || "purchase-order.pdf";
  const mimeType = file.type || "application/pdf";
  const fileSize = typeof file.size === "number" ? String(file.size) : undefined;

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
        resource: "FILE",
        ...(fileSize ? { fileSize } : {}),
      },
    ],
  });

  const stagedErrs = stagedResp?.data?.stagedUploadsCreate?.userErrors || [];
  if (stagedErrs.length) throw new Error(stagedErrs[0]?.message || "stagedUploadsCreate failed.");

  const target = stagedResp?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error("Missing staged upload target.");

  // --- Upload to staged target ---
  const buf = Buffer.from(await file.arrayBuffer());

  const uploadRes = await fetch(String(target.url), {
    method: "PUT",
    body: buf,
    // NO headers - signature only covers 'host' header which is added automatically
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(`Staged upload failed: ${uploadRes.status} ${text}`.trim());
  }

  // --- Create Shopify file record pointing at staged resourceUrl ---
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
    files: [{ originalSource: target.resourceUrl, contentType: "FILE" }],
  });

  const createErrs = createResp?.data?.fileCreate?.userErrors || [];
  if (createErrs.length) throw new Error(createErrs[0]?.message || "fileCreate failed.");

  const created = createResp?.data?.fileCreate?.files?.[0];
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

    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 450));
      const n = await runAdminQuery(shop, NODE_QUERY, { id: fileId });
      url = n?.data?.node?.url || null;
      if (url) break;
    }
  }

  if (!url) throw new Error("Upload completed but no CDN URL available yet.");
  return url;
}

// -------------------- LOADER --------------------
export async function loader({ request }) {
  const userOrRes = await ensureLogisticsUserOrJson(request);
  if (userOrRes instanceof Response) return userOrRes;

  const url = new URL(request.url);
  const intent = String(url.searchParams.get("intent") || "").trim();

  // default to list
  if (!intent || intent === "list") {
    const rows = await logisticsDb.tbl_purchaseOrder.findMany({
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        shortName: true,
        purchaseOrderGID: true,
        purchaseOrderPdfUrl: true,
        createdAt: true,
        updatedAt: true,
        tbljn_purchaseOrder_rslProduct: {
          select: {
            rslProductID: true,
            quantity: true,
            tlkp_rslProduct: { select: { shortName: true, displayName: true, SKU: true } },
          },
        },
        tbljn_purchaseOrder_company: {
          take: 1,
          select: { tlkp_company: { select: { shortName: true, displayName: true } } },
        },
        tbl_purchaseOrderNotes: {
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            createdAt: true,
            content: true,
            pdfUrl: true,
            pdfFileName: true,
            eventType: true,
            tbl_logisticsUser: { select: { displayName: true } },
          },
        },
      },
    });

    const purchaseOrders = rows.map((po) => {
      const company = po.tbljn_purchaseOrder_company?.[0]?.tlkp_company || null;
      return toUiPO(po, company);
    });

    return json({ ok: true, purchaseOrders });
  }

  return json({ ok: false, error: `Unknown loader intent: ${intent}` }, { status: 400 });
}

// -------------------- ACTION --------------------
export async function action({ request }) {
  const userOrRes = await ensureLogisticsUserOrJson(request);
  if (userOrRes instanceof Response) return userOrRes;
  const user = userOrRes;

  try {
    const contentType = request.headers.get("content-type") || "";

    // ----- MULTIPART: create / update with optional pdf + note -----
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const intent = cleanStrOrNull(formData.get("intent"));

      if (intent !== "create" && intent !== "update") {
        return json({ ok: false, error: "Unknown multipart intent." }, { status: 400 });
      }

      const purchaseOrderRaw = cleanStrOrNull(formData.get("purchaseOrder"));
      let purchaseOrder = {};
      try {
        purchaseOrder = purchaseOrderRaw ? JSON.parse(purchaseOrderRaw) : {};
      } catch {
        return json({ ok: false, error: "Invalid purchaseOrder payload." }, { status: 400 });
      }

      const fdCompanyID = cleanStrOrNull(formData.get("companyID"));
      const companyID = resolveCompanyIDFromAny(purchaseOrder, fdCompanyID);

      const note = cleanStrOrNull(formData.get("note"));
      const pdf = formData.get("pdf");

      const hasPdf = pdf && typeof pdf === "object" && typeof pdf.arrayBuffer === "function";
      const pdfFile = hasPdf ? pdf : null;

      // PDF validation if present
      if (pdfFile) {
        const name = String(pdfFile.name || "");
        const type = String(pdfFile.type || "");
        const looksPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
        if (!looksPdf) return json({ ok: false, error: "Only PDF uploads are supported." }, { status: 400 });

        const maxBytes = 20 * 1024 * 1024;
        if (typeof pdfFile.size === "number" && pdfFile.size > maxBytes) {
          return json({ ok: false, error: "PDF is too large (max 20MB)." }, { status: 400 });
        }
      }

      const shortName = cleanStrOrNull(purchaseOrder?.shortName);
      const purchaseOrderGID = cleanStrOrNull(purchaseOrder?.purchaseOrderGID);
      const selectedProductIDs = extractSelectedProductIDs(purchaseOrder);

      if (intent === "create") {
        if (!shortName || !purchaseOrderGID) {
          return json({ ok: false, error: "shortName and purchaseOrderGID are required." }, { status: 400 });
        }
        if (!companyID) {
          return json({ ok: false, error: "companyID is required." }, { status: 400 });
        }
        if (selectedProductIDs.length === 0) {
          return json({ ok: false, error: "At least one product must be selected." }, { status: 400 });
        }

        const shop = pdfFile ? await resolveShopForAdmin(request) : null;
        if (pdfFile && !shop) {
          return json(
            {
              ok: false,
              error:
                "Missing shop context for Shopify Admin API. Include ?shop=... on the request (or ensure an offline session exists).",
            },
            { status: 400 },
          );
        }

        const created = await logisticsDb.$transaction(async (tx) => {
          const company = await getCompanySummaryByShortName(tx, companyID);
          if (!company) throw new Error(`Unknown companyID: ${companyID}`);

          // Validate products exist (avoid FK errors and give a clean message)
          const existingProducts = await tx.tlkp_rslProduct.findMany({
            where: { shortName: { in: selectedProductIDs } },
            select: { shortName: true },
          });
          const existingSet = new Set(existingProducts.map((x) => x.shortName));
          const missing = selectedProductIDs.filter((id) => !existingSet.has(id));
          if (missing.length) throw new Error(`Unknown product shortName: ${missing.join(", ")}`);

          let pdfUrl = null;
          if (pdfFile) pdfUrl = await uploadPdfToShopifyFiles({ shop, file: pdfFile });

          const po = await tx.tbl_purchaseOrder.create({
            data: { shortName, purchaseOrderGID, purchaseOrderPdfUrl: pdfUrl },
            select: {
              id: true,
              shortName: true,
              purchaseOrderGID: true,
              purchaseOrderPdfUrl: true,
              createdAt: true,
              updatedAt: true,
            },
          });

          await tx.tbljn_purchaseOrder_company.create({
            data: { purchaseOrderGID: po.purchaseOrderGID, companyID: company.shortName },
          });

          await tx.tbljn_purchaseOrder_rslProduct.createMany({
            data: selectedProductIDs.map((rslProductID) => ({
              purchaseOrderGID: po.purchaseOrderGID,
              rslProductID,
              quantity: 0,
            })),
          });

          // Always create a "PO Created" note
          const parts = [];
          if (pdfUrl) parts.push("PDF uploaded");
          if (note) parts.push(note);
          const content = parts.join(" - ");

          await tx.tbl_purchaseOrderNotes.create({
            data: {
              purchaseOrderGID: po.purchaseOrderGID,
              userId: Number(user.id),
              content,
              pdfUrl: pdfUrl || null,
              pdfFileName: pdfUrl ? String(pdfFile.name || "purchase-order.pdf") : null,
              eventType: "PO Created",
            },
          });

          const full = await selectFullPO(tx, po.purchaseOrderGID);
          const co = full?.tbljn_purchaseOrder_company?.[0]?.tlkp_company || company;
          return toUiPO(full, co);
        });

        return json({ ok: true, purchaseOrder: created });
      }

      // intent === "update"
      if (!purchaseOrderGID) {
        return json({ ok: false, error: "purchaseOrderGID is required for update." }, { status: 400 });
      }

      if (pdfFile && !note) {
        return json({ ok: false, error: "Note is required when uploading a new PDF." }, { status: 400 });
      }

      const shop = pdfFile ? await resolveShopForAdmin(request) : null;
      if (pdfFile && !shop) {
        return json(
          {
            ok: false,
            error:
              "Missing shop context for Shopify Admin API. Include ?shop=... on the request (or ensure an offline session exists).",
          },
          { status: 400 },
        );
      }

      const updated = await logisticsDb.$transaction(async (tx) => {
        const existing = await tx.tbl_purchaseOrder.findUnique({
          where: { purchaseOrderGID },
          select: {
            id: true,
            shortName: true,
            purchaseOrderGID: true,
            purchaseOrderPdfUrl: true,
            createdAt: true,
            updatedAt: true,
            tbljn_purchaseOrder_company: {
              take: 1,
              select: { tlkp_company: { select: { shortName: true, displayName: true } } },
            },
            tbljn_purchaseOrder_rslProduct: {
              select: { rslProductID: true },
            },
          },
        });
        if (!existing) throw new Error("Purchase order not found.");

        const linkedCompany = existing.tbljn_purchaseOrder_company?.[0]?.tlkp_company || null;

        const beforeSet = new Set((existing.tbljn_purchaseOrder_rslProduct || []).map((x) => x.rslProductID));
        const afterSet = new Set(selectedProductIDs);

        const toRemove = [];
        for (const id of beforeSet) if (!afterSet.has(id)) toRemove.push(id);

        const toAdd = [];
        for (const id of afterSet) if (!beforeSet.has(id)) toAdd.push(id);

        // Validate new products exist before attempting insert
        if (toAdd.length) {
          const existingProducts = await tx.tlkp_rslProduct.findMany({
            where: { shortName: { in: toAdd } },
            select: { shortName: true },
          });
          const okSet = new Set(existingProducts.map((x) => x.shortName));
          const missing = toAdd.filter((id) => !okSet.has(id));
          if (missing.length) throw new Error(`Unknown product shortName: ${missing.join(", ")}`);
        }

        const productsChanged = toAdd.length > 0 || toRemove.length > 0;

        let newPdfUrl = null;
        if (pdfFile) newPdfUrl = await uploadPdfToShopifyFiles({ shop, file: pdfFile });

        const po = await tx.tbl_purchaseOrder.update({
          where: { purchaseOrderGID },
          data: {
            ...(shortName ? { shortName } : {}),
            ...(newPdfUrl ? { purchaseOrderPdfUrl: newPdfUrl } : {}),
          },
          select: {
            id: true,
            shortName: true,
            purchaseOrderGID: true,
            purchaseOrderPdfUrl: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        // Backfill / reset company link if missing
        if ((!linkedCompany && companyID) || (linkedCompany && companyID && linkedCompany.shortName !== companyID)) {
          const company = await getCompanySummaryByShortName(tx, companyID);
          if (company) {
            await tx.tbljn_purchaseOrder_company.deleteMany({ where: { purchaseOrderGID } });
            await tx.tbljn_purchaseOrder_company.create({
              data: { purchaseOrderGID, companyID: company.shortName },
            });
          }
        }

        // Sync join table for products
        if (toRemove.length) {
          await tx.tbljn_purchaseOrder_rslProduct.deleteMany({
            where: { purchaseOrderGID, rslProductID: { in: toRemove } },
          });
        }
        if (toAdd.length) {
          await tx.tbljn_purchaseOrder_rslProduct.createMany({
            data: toAdd.map((rslProductID) => ({
              purchaseOrderGID,
              rslProductID,
              quantity: 0,
            })),
            skipDuplicates: true,
          });
        }
        if (selectedProductIDs.length === 0 && beforeSet.size > 0) {
          await tx.tbljn_purchaseOrder_rslProduct.deleteMany({ where: { purchaseOrderGID } });
        }

        // Decide if we need to create a note entry
        const didAnyUpdate = Boolean(note) || Boolean(newPdfUrl) || productsChanged;
        if (!didAnyUpdate) {
          throw new Error("Nothing to update.");
        }

        const noteContent = note || (productsChanged ? "Products updated." : newPdfUrl ? "PDF uploaded." : "");
        if (noteContent) {
          await tx.tbl_purchaseOrderNotes.create({
            data: {
              purchaseOrderGID,
              userId: Number(user.id),
              content: noteContent,
              pdfUrl: newPdfUrl || null,
              pdfFileName: newPdfUrl ? String(pdfFile.name || "purchase-order.pdf") : null,
              eventType: newPdfUrl ? "PDF_UPDATE" : "NOTE",
            },
          });
        }

        const full = await selectFullPO(tx, purchaseOrderGID);
        const co = full?.tbljn_purchaseOrder_company?.[0]?.tlkp_company || linkedCompany;
        return toUiPO(full, co);
      });

      return json({ ok: true, purchaseOrder: updated });
    }

    // ----- JSON: delete -----
    const payload = await request.json().catch(() => null);
    const intent = cleanStrOrNull(payload?.intent);

    if (!intent) return json({ ok: false, error: "Missing intent." }, { status: 400 });

    if (intent === "delete") {
      const purchaseOrderGID =
        cleanStrOrNull(payload?.purchaseOrderGID) || cleanStrOrNull(payload?.purchaseOrder?.purchaseOrderGID);

      if (!purchaseOrderGID) {
        return json({ ok: false, error: "purchaseOrderGID is required for delete." }, { status: 400 });
      }

      await logisticsDb.$transaction(async (tx) => {
        await tx.tbljn_shipment_purchaseOrder.deleteMany({ where: { purchaseOrderGID } });
        await tx.tbljn_purchaseOrder_company.deleteMany({ where: { purchaseOrderGID } });
        await tx.tbljn_purchaseOrder_rslProduct.deleteMany({ where: { purchaseOrderGID } });
        await tx.tbl_purchaseOrderNotes.deleteMany({ where: { purchaseOrderGID } });
        await tx.tbl_purchaseOrder.delete({ where: { purchaseOrderGID } });
      });

      return json({ ok: true, deletedPurchaseOrderGID: purchaseOrderGID });
    }

    return json({ ok: false, error: `Unknown intent: ${intent}` }, { status: 400 });
  } catch (e) {
    console.error("[purchase-orders action] error:", e);

    const errorMessage = e?.message || "";

    if (errorMessage.includes("Unique constraint") && errorMessage.includes("purchaseOrderGID")) {
      return json(
        {
          ok: false,
          error:
            "Whoops. Looks like you are trying to use a duplicate Shopify Purchase Order ID. Check your URL for the PO and try again.",
        },
        { status: 400 },
      );
    }

    return json({ ok: false, error: errorMessage || "Server error." }, { status: 500 });
  }
}
