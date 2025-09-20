// app/routes/apps.csd-entry.save.js
import { json } from "@remix-run/node";
import { prisma } from "../db.server";            // ⬅ adjust path if needed
import { authenticate } from "../shopify.server"; // ⬅ adjust path if needed

export async function action({ request }) {
  await authenticate.admin(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ---- Extract fields from the payload coming from the Block ----
  const {
    id, // optional: if present, we update that CsdEntry
    // Hidden/contextual UI fields:
    orderGid,
    orderName,
    originalOrderNumber,

    // Display fields:
    dateOfReturnRequest,
    customerName,
    primaryReason,            // <-- Select: lookup ID as a string
    item,
    replacementOrderNumber,
    returnType,               // <-- Select: lookup ID as a string
    troubleshootingCategory,  // <-- Select (category list); NOTE: we don't have a dedicated DB column
    troubleshootingNotes,     // <-- Free-text notes
    customerServiceStatus,
    rslCsd,
    returnItemRequired,
    repairDeptDesignation,
  } = body || {};

  // ---- Validate referenced lookup IDs if provided ----
  if (returnType) {
    const exists = await prisma.tblkp_CsdReturnType.findUnique({
      where: { id: Number(returnType) },
      select: { id: true },
    });
    if (!exists) {
      return json({ error: "Invalid return type" }, { status: 400 });
    }
  }

  if (primaryReason) {
    const exists = await prisma.tblkp_CsdPrimaryCustomerReportedReasonForReturnWarranty.findUnique({
      where: { id: Number(primaryReason) },
      select: { id: true },
    });
    if (!exists) {
      return json({ error: "Invalid primary reason" }, { status: 400 });
    }
  }

  if (troubleshootingCategory) {
    const exists = await prisma.tblkp_CsdTroubleshootingNotes.findUnique({
      where: { id: Number(troubleshootingCategory) },
      select: { id: true },
    });
    if (!exists) {
      return json({ error: "Invalid troubleshooting category" }, { status: 400 });
    }
  }

  // ---- Build the Prisma data payload ----
  // NOTE: Your schema requires serviceNumber (DateTime). We'll set it on create (now).
  const csdData = {
    // Required on create:
    // serviceNumber: new Date(), // set below in create branch

    dateOfReturnRequest: dateOfReturnRequest ? new Date(dateOfReturnRequest) : null,
    originalOrder: originalOrderNumber ?? null,
    customerName: customerName ?? null,
    primaryCustomerReportedReasonForReturnWarranty: primaryReason ? String(primaryReason) : null, // store ID as string
    item: item ?? null,
    replacementOrder: replacementOrderNumber ?? null,
    returnType: returnType ? String(returnType) : null, // store ID as string
    troubleshootingNotes: troubleshootingNotes ?? null, // keep the free-text notes in the notes column
    customerServiceStatus: customerServiceStatus ?? null,
    rslCsd: rslCsd ?? null,
    returnItemRequired: typeof returnItemRequired === "boolean" ? returnItemRequired : null,
    repairDeptDesignation: repairDeptDesignation ?? null,

    // Timestamps
    updatedAt: new Date(),
  };

  try {
    let record;
    if (id) {
      // ---- Update existing entry ----
      record = await prisma.csdEntry.update({
        where: { id: Number(id) },
        data: csdData,
      });
    } else {
      // ---- Create new entry ----
      record = await prisma.csdEntry.create({
        data: {
          serviceNumber: new Date(), // required DateTime
          ...csdData,
        },
      });
    }

    return json({
      message: "CSD entry saved",
      id: record.id,
      // Echo a few helpful bits back:
      saved: {
        returnType: record.returnType,
        primaryReason: record.primaryCustomerReportedReasonForReturnWarranty,
        troubleshootingNotes: record.troubleshootingNotes,
      },
    });
  } catch (e) {
    console.error("CSD save error:", e);
    return json({ error: "Failed to save CSD entry" }, { status: 500 });
  }
}
