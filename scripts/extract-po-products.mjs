#!/usr/bin/env node
import { extractPurchaseOrderProductsFromPdfFile } from "../app/utils/purchase-order-pdf.server.js";

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: node scripts/extract-po-products.mjs /absolute/path/to/file.pdf");
    process.exit(1);
  }

  const products = await extractPurchaseOrderProductsFromPdfFile(pdfPath);
  console.log(JSON.stringify(products, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
