// app/routes/apps.logistics.purchase-orders.jsx
import { json } from "@remix-run/node";
import { logisticsDb } from "~/logistics-db.server";
import { prisma } from "~/db.server";
import { runAdminQuery } from "~/shopify-admin.server";

/**
 * Helpers
 */
function cleanStrOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function resolveCompanyID(purchaseOrder) {
  // UI has used companyID; some older code might send companyId.
  return cleanStrOrNull(
    purchaseOrder?.companyID ??
    purchaseOrder?.companyId ??
    purchaseOrder?.companyShortName ??
    purchaseOrder?.company ??
    null
  );
}

async function getCompanySummaryByShortName(tx, shortName) {
  if (!shortName) return null;
  const company = await tx.tlkp_company.findUnique({
    where: { shortName },
    select: { shortName: true, displayName: true },
  });
  return company || null;
}

function formatCompanyName(company) {
  if (!company) return null;
  return company.displayName
    ? `${company.displayName} (${company.shortName})`
    : company.shortName;
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

/**
 * Shopify Files upload (stagedUploadsCreate -> PUT to staged target -> fileCreate)
 *
 * IMPORTANT:
 * Shopify's stagedUploadsCreate defaults httpMethod to PUT.
 * For GCS staged targets, you must upload with PUT (not multipart POST), otherwise
 * you can get SignatureDoesNotMatch.
 */
async function uploadPdfToShopifyFiles({ shop, file }) {
  const filename = file.name || "purchase-order.pdf";
  const mimeType = file.type || "application/pdf";
  // Shopify expects fileSize to be encoded as a string (UnsignedInt64)
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

  // Explicitly request PUT (matches default, but makes intent unambiguous)
  const stagedResp = await runAdminQuery(shop, STAGED_UPLOAD, {
    input: [
      {
        filename,
        mimeType,
        resource: "FILE",
        httpMethod: "PUT",
        ...(fileSize ? { fileSize } : {}),
      },
    ],
  });

  const stagedErrs = stagedResp?.data?.stagedUploadsCreate?.userErrors || [];
  if (stagedErrs.length) {
    throw new Error(stagedErrs[0]?.message || "stagedUploadsCreate failed.");
  }

  const target = stagedResp?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (
    !target?.url ||
    !target?.resourceUrl ||
    !Array.isArray(target.parameters)
  ) {
    throw new Error("Missing staged upload target.");
  }

  // PUT the file to the staged target.
  // For PUT uploads, treat parameters as headers.
  const headers = new Headers();
  for (const p of target.parameters) {
    if (p?.name) headers.set(p.name, String(p.value ?? ""));
  }
  if (!headers.has("Content-Type") && mimeType) {
    headers.set("Content-Type", mimeType);
  }

  const uploadRes = await fetch(target.url, {
    method: "PUT",
    headers,
    body: file,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(`Staged upload failed: ${uploadRes.status} ${text}`.trim());
  }

  // Create the File in Shopify
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
  if (createErrs.length) {
    throw new Error(createErrs[0]?.message || "fileCreate failed.");
  }

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

    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const n = await runAdminQuery(shop, NODE_QUERY, { id: fileId });
      url = n?.data?.node?.url || null;
      if (url) break;
    }
  }

  if (!url) throw new Error("Upload completed but no CDN URL available yet.");
  return url;
}

/**
 * Loader
 * - intent=bootstrap: purchaseOrders + companies
 * - intent=details&purchaseOrderGID=... : purchaseOrder + notes
 */
export async function loader({ request }) {
  try {
    const url = new URL(request.url);
    const intent = String(url.searchParams.get("intent") || "bootstrap").trim();

    if (intent === "details") {
      const purchaseOrderGID = cleanStrOrNull(
        url.searchParams.get("purchaseOrderGID")
      );
      if (!purchaseOrderGID) {
        return json({ success: false, error: "Missing purchaseOrderGID." });
      }

      const po = await logisticsDb.tbl_purchaseOrder.findUnique({
        where: { purchaseOrderGID },
        select: {
          id: true,
          shortName: true,
          purchaseOrderGID: true,
          purchaseOrderPdfUrl: true,
          createdAt: true,
          updatedAt: true,
          companyLinks: {
            take: 1,
            include: { company: { select: { shortName: true, displayName: true } } },
          },
          notes: {
            orderBy: [{ createdAt: "desc" }],
            select: {
              id: true,
              createdAt: true,
              content: true,
              pdfUrl: true,
              pdfFileName: true,
              eventType: true,
              logisticsUser: { select: { id: true, displayName: true, email: true } },
            },
          },
        },
      });

      if (!po) {
        return json({ success: false, error: "Purchase Order not found." });
      }

      const company = po.companyLinks?.[0]?.company || null;

      return json({
        success: true,
        purchaseOrder: {
          id: po.id,
          shortName: po.shortName,
          purchaseOrderGID: po.purchaseOrderGID,
          purchaseOrderPdfUrl: po.purchaseOrderPdfUrl || null,
          createdAt: po.createdAt,
          updatedAt: po.updatedAt,
          companyID: company?.shortName ?? null,
          companyName: company ? formatCompanyName(company) : null,
        },
        notes: po.notes.map((n) => ({
          id: n.id,
          createdAt: n.createdAt,
          content: n.content,
          pdfUrl: n.pdfUrl || null,
          pdfFileName: n.pdfFileName || null,
          eventType: n.eventType || null,
          user: n.logisticsUser
            ? {
              id: n.logisticsUser.id,
              displayName: n.logisticsUser.displayName,
              email: n.logisticsUser.email,
            }
            : null,
        })),
      });
    }

    // bootstrap
    const [companies, purchaseOrders] = await Promise.all([
      logisticsDb.tlkp_company.findMany({
        orderBy: [{ shortName: "asc" }],
        select: { shortName: true, displayName: true },
      }),
      logisticsDb.tbl_purchaseOrder.findMany({
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          shortName: true,
          purchaseOrderGID: true,
          purchaseOrderPdfUrl: true,
          createdAt: true,
          updatedAt: true,
          companyLinks: {
            take: 1,
            include: { company: { select: { shortName: true, displayName: true } } },
          },
        },
      }),
    ]);

    const uiPurchaseOrders = purchaseOrders.map((po) => {
      const company = po.companyLinks?.[0]?.company || null;
      return {
        id: po.id,
        shortName: po.shortName,
        purchaseOrderGID: po.purchaseOrderGID,
        purchaseOrderPdfUrl: po.purchaseOrderPdfUrl || null,
        createdAt: po.createdAt,
        updatedAt: po.updatedAt,
        companyID: company?.shortName ?? null,
        companyName: company ? formatCompanyName(company) : null,
      };
    });

    return json({
      success: true,
      companies,
      purchaseOrders: uiPurchaseOrders,
    });
  } catch (e) {
    return json({ success: false, error: e?.message || "Server error." });
  }
}

function parsePurchaseOrderJsonFromForm(formData) {
  const raw = formData.get("purchaseOrder");
  if (!raw) return {};
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/**
 * Action
 * Supports:
 * - multipart/form-data: intent=create|update|add_note (+ optional pdf File)
 * - JSON: intent=delete (kept for simplicity)
 */
export async function action({ request }) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // --- Multipart intents (create/update/add_note) ---
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const intent = String(formData.get("intent") || "").trim();

      // Back-compat (if anything still calls upload_pdf)
      if (intent === "upload_pdf") {
        const shop = await resolveShopForAdmin(request);
        if (!shop) {
          return json({
            success: false,
            error:
              "Missing shop context for Shopify Admin API. Include ?shop=... on the request (or ensure an offline session exists).",
          });
        }

        const pdf = formData.get("pdf");
        if (!pdf || typeof pdf !== "object" || typeof pdf.arrayBuffer !== "function") {
          return json({ success: false, error: "Missing PDF file upload." });
        }

        const name = String(pdf.name || "");
        const type = String(pdf.type || "");
        const looksPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
        if (!looksPdf) {
          return json({ success: false, error: "Only PDF uploads are supported." });
        }

        const maxBytes = 20 * 1024 * 1024;
        if (typeof pdf.size === "number" && pdf.size > maxBytes) {
          return json({ success: false, error: "PDF is too large (max 20MB)." });
        }

        const pdfUrl = await uploadPdfToShopifyFiles({ shop, file: pdf });
        return json({ success: true, pdfUrl });
      }

      if (intent !== "create" && intent !== "update" && intent !== "add_note") {
        return json({ success: false, error: "Unknown multipart intent." });
      }

      const purchaseOrder = parsePurchaseOrderJsonFromForm(formData);
      const note = cleanStrOrNull(formData.get("note"));
      const pdf = formData.get("pdf");

      const hasPdf = !!pdf && typeof pdf === "object" && typeof pdf.arrayBuffer === "function";

      // For UPDATE: note is required (whether PDF is included or not)
      if (intent === "update" && !note) {
        return json({
          success: false,
          error: "Note is required when updating a purchase order.",
        });
      }

      // For ADD_NOTE: content required
      if (intent === "add_note" && !note) {
        return json({
          success: false,
          error: "Note is required.",
        });
      }

      // If a PDF is present, we need shop context.
      let pdfUrl = null;
      let pdfFileName = null;
      if (hasPdf) {
        const shop = await resolveShopForAdmin(request);
        if (!shop) {
          return json({
            success: false,
            error:
              "Missing shop context for Shopify Admin API. Include ?shop=... on the request (or ensure an offline session exists).",
          });
        }

        // Basic validation (PDF-ish)
        const name = String(pdf.name || "");
        const type = String(pdf.type || "");
        const looksPdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
        if (!looksPdf) {
          return json({ success: false, error: "Only PDF uploads are supported." });
        }

        const maxBytes = 20 * 1024 * 1024;
        if (typeof pdf.size === "number" && pdf.size > maxBytes) {
          return json({ success: false, error: "PDF is too large (max 20MB)." });
        }

        pdfFileName = cleanStrOrNull(pdf.name);
        pdfUrl = await uploadPdfToShopifyFiles({ shop, file: pdf });
      }

      // --- create ---
      if (intent === "create") {
        const shortName = cleanStrOrNull(purchaseOrder.shortName);
        const purchaseOrderGID = cleanStrOrNull(purchaseOrder.purchaseOrderGID);
        const companyID = resolveCompanyID(purchaseOrder);

        if (!shortName || !purchaseOrderGID) {
          return json({
            success: false,
            error: "shortName and purchaseOrderGID are required.",
          });
        }
        if (!companyID) {
          return json({
            success: false,
            error: "companyID is required.",
          });
        }

        const created = await logisticsDb.$transaction(async (tx) => {
          const company = await getCompanySummaryByShortName(tx, companyID);
          if (!company) throw new Error(`Unknown companyID: ${companyID}`);

          const po = await tx.tbl_purchaseOrder.create({
            data: {
              shortName,
              purchaseOrderGID,
              purchaseOrderPdfUrl: pdfUrl || null,
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

          // Store the company link (one company per PO)
          await tx.tbljn_purchaseOrder_company.create({
            data: {
              purchaseOrderGID: po.purchaseOrderGID,
              companyID: company.shortName,
            },
          });

          // Optional note on create. If PDF uploaded but no note, store a default note to log the event.
          const noteContent =
            note || (pdfUrl ? "Initial PDF uploaded." : null);

          if (noteContent) {
            await tx.tbl_purchaseOrderNotes.create({
              data: {
                purchaseOrderGID: po.purchaseOrderGID,
                userId: null,
                content: noteContent,
                pdfUrl: pdfUrl || null,
                pdfFileName: pdfFileName || null,
                eventType: pdfUrl ? "PDF_UPDATE" : "NOTE",
              },
            });
          }

          return {
            ...po,
            companyID: company.shortName,
            companyName: formatCompanyName(company),
          };
        });

        return json({ success: true, purchaseOrder: created });
      }

      // --- update ---
      if (intent === "update") {
        const purchaseOrderGID = cleanStrOrNull(purchaseOrder.purchaseOrderGID);
        if (!purchaseOrderGID) {
          return json({
            success: false,
            error: "purchaseOrderGID is required for update.",
          });
        }

        const shortName = cleanStrOrNull(purchaseOrder.shortName);
        const companyID = resolveCompanyID(purchaseOrder);

        const updated = await logisticsDb.$transaction(async (tx) => {
          // read existing (needed to bump updatedAt if no real field changes)
          const existing = await tx.tbl_purchaseOrder.findUnique({
            where: { purchaseOrderGID },
            select: {
              shortName: true,
              purchaseOrderPdfUrl: true,
            },
          });
          if (!existing) throw new Error("Purchase Order not found.");

          const nextShortName = shortName || existing.shortName;

          const po = await tx.tbl_purchaseOrder.update({
            where: { purchaseOrderGID },
            data: {
              // Always include shortName (even if unchanged) so updatedAt bumps
              shortName: nextShortName,
              ...(pdfUrl ? { purchaseOrderPdfUrl: pdfUrl } : {}),
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

          // Company link: keep existing unless companyID provided (or backfill if missing)
          let company = null;

          if (companyID) {
            company = await getCompanySummaryByShortName(tx, companyID);
            if (!company) throw new Error(`Unknown companyID: ${companyID}`);

            await tx.tbljn_purchaseOrder_company.deleteMany({ where: { purchaseOrderGID } });
            await tx.tbljn_purchaseOrder_company.create({
              data: {
                purchaseOrderGID,
                companyID: company.shortName,
              },
            });
          } else {
            const link = await tx.tbljn_purchaseOrder_company.findFirst({
              where: { purchaseOrderGID },
              select: { companyID: true },
            });
            if (link?.companyID) company = await getCompanySummaryByShortName(tx, link.companyID);
          }

          // Create a history note for the update (note required on update)
          await tx.tbl_purchaseOrderNotes.create({
            data: {
              purchaseOrderGID,
              userId: null,
              content: note, // required, already validated
              pdfUrl: pdfUrl || null,
              pdfFileName: pdfFileName || null,
              eventType: pdfUrl ? "PDF_UPDATE" : "NOTE",
            },
          });

          return {
            ...po,
            companyID: company?.shortName ?? null,
            companyName: company ? formatCompanyName(company) : null,
          };
        });

        return json({ success: true, purchaseOrder: updated });
      }

      // --- add_note (note-only, optional PDF) ---
      if (intent === "add_note") {
        const purchaseOrderGID = cleanStrOrNull(purchaseOrder.purchaseOrderGID);
        if (!purchaseOrderGID) {
          return json({
            success: false,
            error: "purchaseOrderGID is required for add_note.",
          });
        }

        const result = await logisticsDb.$transaction(async (tx) => {
          const existing = await tx.tbl_purchaseOrder.findUnique({
            where: { purchaseOrderGID },
            select: { shortName: true },
          });
          if (!existing) throw new Error("Purchase Order not found.");

          // bump updatedAt
          await tx.tbl_purchaseOrder.update({
            where: { purchaseOrderGID },
            data: { shortName: existing.shortName },
          });

          await tx.tbl_purchaseOrderNotes.create({
            data: {
              purchaseOrderGID,
              userId: null,
              content: note, // required
              pdfUrl: pdfUrl || null,
              pdfFileName: pdfFileName || null,
              eventType: pdfUrl ? "PDF_UPDATE" : "NOTE",
            },
          });

          return true;
        });

        return json({ success: true, added: result });
      }

      return json({ success: false, error: "Unhandled multipart intent." });
    }

    // --- JSON intents ---
    const payload = await request.json().catch(() => null);
    const intent = String(payload?.intent || "").trim();
    const purchaseOrder = payload?.purchaseOrder || {};

    if (!intent) return json({ success: false, error: "Missing intent." });

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
