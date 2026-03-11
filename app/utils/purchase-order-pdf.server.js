import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

function parseObjects(pdfLatin1) {
  const objects = new Map();
  const re = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
  let m;
  while ((m = re.exec(pdfLatin1))) {
    objects.set(Number(m[1]), m[3]);
  }
  return objects;
}

function normalizeFontName(fontName) {
  const raw = String(fontName || "").trim().replace(/^\//, "");
  if (!raw) return "";
  const plusIdx = raw.indexOf("+");
  const cleaned = plusIdx >= 0 ? raw.slice(plusIdx + 1) : raw;
  return cleaned.trim().toLowerCase();
}

function decodeFlateStream(body) {
  const match = body.match(/stream[\r\n]([\s\S]*?)endstream/);
  if (!match) return null;
  let stream = Buffer.from(match[1], "latin1");
  if (/\/Filter\s*\/FlateDecode/.test(body)) {
    try {
      stream = zlib.inflateSync(stream);
    } catch {
      stream = zlib.inflateRawSync(stream);
    }
  }
  return stream;
}

function parseHexCodepoint(hex) {
  const cp = parseInt(hex, 16);
  if (!Number.isFinite(cp)) return "";
  return String.fromCodePoint(cp);
}

function parseCMap(cmapText) {
  const map = new Map();
  const lines = cmapText
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  let i = 0;
  while (i < lines.length) {
    let m = lines[i].match(/^(\d+)\s+beginbfchar$/);
    if (m) {
      const n = Number(m[1]);
      for (let j = 0; j < n && i + 1 < lines.length; j += 1) {
        i += 1;
        const mm = lines[i].match(/^<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>$/);
        if (mm) {
          map.set(mm[1].toUpperCase(), parseHexCodepoint(mm[2]));
        }
      }
      i += 1;
      continue;
    }

    m = lines[i].match(/^(\d+)\s+beginbfrange$/);
    if (m) {
      const n = Number(m[1]);
      for (let j = 0; j < n && i + 1 < lines.length; j += 1) {
        i += 1;
        const line = lines[i];

        let mm = line.match(/^<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>$/);
        if (mm) {
          const startHex = mm[1].toUpperCase();
          const endHex = mm[2].toUpperCase();
          const outStart = parseInt(mm[3], 16);
          const start = parseInt(startHex, 16);
          const end = parseInt(endHex, 16);
          for (let code = start; code <= end; code += 1) {
            const inHex = code.toString(16).toUpperCase().padStart(startHex.length, "0");
            const outHex = (outStart + (code - start)).toString(16).toUpperCase();
            map.set(inHex, parseHexCodepoint(outHex));
          }
          continue;
        }

        mm = line.match(/^<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+\[(.+)\]$/);
        if (mm) {
          const startHex = mm[1].toUpperCase();
          const start = parseInt(startHex, 16);
          const end = parseInt(mm[2], 16);
          const outList = [...mm[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1]);
          let idx = 0;
          for (let code = start; code <= end && idx < outList.length; code += 1, idx += 1) {
            const inHex = code.toString(16).toUpperCase().padStart(startHex.length, "0");
            map.set(inHex, parseHexCodepoint(outList[idx]));
          }
        }
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  return map;
}

function parseFontMapsForPage(objects, pageBody) {
  const section = pageBody.match(/\/Font\s*<<([\s\S]*?)>>/);
  if (!section) return {};

  const fontRefs = {};
  for (const m of section[1].matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
    fontRefs[m[1]] = Number(m[2]);
  }

  const out = {};
  for (const [fontTag, fontObjId] of Object.entries(fontRefs)) {
    const fontObj = objects.get(fontObjId);
    if (!fontObj) {
      out[fontTag] = new Map();
      continue;
    }
    const mTo = fontObj.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!mTo) {
      out[fontTag] = new Map();
      continue;
    }
    const cmapObj = objects.get(Number(mTo[1]));
    const cmapStream = cmapObj ? decodeFlateStream(cmapObj) : null;
    out[fontTag] = cmapStream ? parseCMap(cmapStream.toString("latin1")) : new Map();
  }

  return out;
}

function parseFontNamesForPage(objects, pageBody) {
  const section = pageBody.match(/\/Font\s*<<([\s\S]*?)>>/);
  if (!section) return {};

  const fontRefs = {};
  for (const m of section[1].matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
    fontRefs[m[1]] = Number(m[2]);
  }

  const out = {};
  for (const [fontTag, fontObjId] of Object.entries(fontRefs)) {
    const fontObj = objects.get(fontObjId);
    if (!fontObj) {
      out[fontTag] = "";
      continue;
    }
    const base = fontObj.match(/\/BaseFont\s*\/([^\s]+)/)?.[1] || "";
    out[fontTag] = normalizeFontName(base);
  }
  return out;
}

function parsePageSize(pageBody) {
  const m = pageBody.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
  if (!m) return { width: null, height: null };
  const x0 = Number(m[1]);
  const y0 = Number(m[2]);
  const x1 = Number(m[3]);
  const y1 = Number(m[4]);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return { width: null, height: null };
  return { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

function decodePdfHex(fontMaps, fontTag, hexText) {
  const map = fontMaps[fontTag] || new Map();
  let out = "";
  for (let i = 0; i < hexText.length; i += 4) {
    const code = hexText.slice(i, i + 4).toUpperCase();
    out += map.get(code) || "";
  }
  return out;
}

function parseTextBlocksFromContent(contentText, fontMaps, fontNames, pageNo, pageSize) {
  const lines = contentText.split(/\r?\n/);
  const blocks = [];

  let inBT = false;
  let currentFont = "";
  let currentX = 0;
  let currentY = 0;
  let currentText = "";

  const flush = () => {
    const text = currentText.trim();
    if (!text) return;
    blocks.push({
      page: pageNo,
      font: currentFont,
      fontName: normalizeFontName(fontNames?.[currentFont] || ""),
      x: currentX,
      y: currentY,
      pageWidth: pageSize?.width ?? null,
      pageHeight: pageSize?.height ?? null,
      text,
    });
    currentText = "";
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === "BT") {
      inBT = true;
      currentFont = "";
      currentX = 0;
      currentY = 0;
      currentText = "";
      continue;
    }
    if (line === "ET") {
      flush();
      inBT = false;
      continue;
    }
    if (!inBT) continue;

    let m = line.match(/^\/(F\d+)\s+[-\d.]+\s+Tf$/);
    if (m) {
      currentFont = m[1];
      continue;
    }

    m = line.match(/^[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm$/);
    if (m) {
      currentX = Number(m[1]);
      currentY = Number(m[2]);
      continue;
    }

    m = line.match(/^<([0-9A-Fa-f]+)>\s+Tj$/);
    if (m) {
      currentText += decodePdfHex(fontMaps, currentFont, m[1]);
      continue;
    }

    m = line.match(/^[-\d.]+\s+[-\d.]+\s+Td\s+<([0-9A-Fa-f]+)>\s+Tj$/);
    if (m) {
      currentText += decodePdfHex(fontMaps, currentFont, m[1]);
      continue;
    }
  }

  return blocks;
}

function near(a, b, tolerance = 3) {
  return Math.abs(a - b) <= tolerance;
}

function parseQuantity(text) {
  const cleaned = String(text || "").replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseMoney(text) {
  const cleaned = String(text || "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeTextForMatch(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function pickPrimaryPoPage(blocks) {
  const pageMap = new Map();
  for (const b of blocks || []) {
    if (!pageMap.has(b.page)) pageMap.set(b.page, []);
    pageMap.get(b.page).push(b);
  }

  let bestPage = null;
  let bestScore = -1;

  for (const [page, pageBlocks] of pageMap.entries()) {
    const texts = new Set(pageBlocks.map((b) => normalizeTextForMatch(b.text)));
    let score = 0;
    if (texts.has("PRODUCTS")) score += 4;
    if (texts.has("SUPPLIER SKU")) score += 3;
    if (texts.has("QTY")) score += 2;
    if (texts.has("COST")) score += 2;
    if (texts.has("REFERENCE NUMBER")) score += 1;
    if (texts.has("NOTES TO SUPPLIER")) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestPage = page;
    }
  }

  if (bestPage == null) return [];
  return pageMap.get(bestPage) || [];
}

function indexBlocksByText(blocks) {
  const out = new Map();
  for (const b of blocks || []) {
    const key = normalizeTextForMatch(b.text);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(b);
  }
  return out;
}

function pickNearestBlock(blocks, expected) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  if (!expected) return blocks[0];

  let best = blocks[0];
  let bestDist = Number.POSITIVE_INFINITY;
  const ex = Number(expected.x);
  const ew = Number(expected.pageWidth);
  const eh = Number(expected.pageHeight);
  const expectedFont = normalizeFontName(expected.fontName || "");

  for (const b of blocks) {
    const bx = Number(b?.x);
    const bw = Number(b?.pageWidth);
    const bh = Number(b?.pageHeight);

    const dxAbs = Math.abs(bx - ex);

    let dxNorm = dxAbs;
    if (
      Number.isFinite(ew) &&
      ew > 0 &&
      Number.isFinite(eh) &&
      eh > 0 &&
      Number.isFinite(bw) &&
      bw > 0 &&
      Number.isFinite(bh) &&
      bh > 0
    ) {
      dxNorm = Math.abs((bx / bw) - (ex / ew));
    }

    // Validation should tolerate large vertical shifts as line-item counts vary.
    // Prefer font match and horizontal placement over Y-axis distance.
    const actualFont = normalizeFontName(b?.fontName || "");
    const fontPenalty = expectedFont && actualFont !== expectedFont ? 1000 : 0;
    const dist = fontPenalty + dxNorm;
    if (dist < bestDist) {
      bestDist = dist;
      best = b;
    }
  }

  return best;
}

function placementMatches(templateAnchor, block) {
  const ex = Number(templateAnchor?.x);
  const bx = Number(block?.x);
  if (![ex, bx].every(Number.isFinite)) return false;

  const ew = Number(templateAnchor?.pageWidth);
  const eh = Number(templateAnchor?.pageHeight);
  const bw = Number(block?.pageWidth);
  const bh = Number(block?.pageHeight);

  const dxAbs = Math.abs(bx - ex);
  const axisLeeway = 500;

  // User-requested leniency: Y can drift heavily with long product tables.
  // Keep only X-axis placement validation.
  if (dxAbs > axisLeeway) return false;

  // Keep page metrics reads to avoid breaking future heuristics that may use them.
  if (Number.isFinite(ew) && ew > 0 && Number.isFinite(eh) && eh > 0 && Number.isFinite(bw) && bw > 0 && Number.isFinite(bh) && bh > 0) {
    return true;
  }

  return true;
}

function summarizeValidationIssues(issues) {
  const base = "That PDF does not seem to be a RSL Purchase Order.  Check it and try with a different document.  If you're sure it's correct, contact the IT administrator.";
  if (!Array.isArray(issues) || !issues.length) return base;
  const short = issues.slice(0, 3).map((i) => i.label).join(", ");
  if (issues.length === 1) return `${base} (${short}).`;
  return `${base} (${short}${issues.length > 3 ? ", ..." : ""}).`;
}

const TEMPLATE_VALIDATION_LABELS = [
  "SUPPLIER",
  "SHIP TO",
  "BILL TO",
  "PAYMENT TERMS",
  "SUPPLIER CURRENCY",
  "ESTIMATED ARRIVAL",
  "PRODUCTS",
  "SUPPLIER SKU",
  "QTY",
  "COST",
  "TAX",
  "TOTAL (USD)",
  "REFERENCE NUMBER",
  "NOTES TO SUPPLIER",
  "COST SUMMARY",
];

const TEMPLATE_ANCHOR_FALLBACK = [
  { label: "SUPPLIER", x: 9, y: 92, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "SHIP TO", x: 292.89063, y: 92, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "BILL TO", x: 568.4375, y: 92, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "PAYMENT TERMS", x: 9, y: 265, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "SUPPLIER CURRENCY", x: 292.89063, y: 265, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "ESTIMATED ARRIVAL", x: 568.4375, y: 265, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "PRODUCTS", x: 8, y: 346, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "SUPPLIER SKU", x: 241.78125, y: 346, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "QTY", x: 437.9375, y: 346, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "COST", x: 511.03125, y: 346, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "TAX", x: 598.26563, y: 346, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "TOTAL (USD)", x: 668.8125, y: 346, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "REFERENCE NUMBER", x: 10, y: 577, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "NOTES TO SUPPLIER", x: 10, y: 633, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
  { label: "COST SUMMARY", x: 427.5, y: 577, fontName: "notosans-bold", pageWidth: 595.92, pageHeight: 842.88 },
];

let templateAnchorPromise = null;
let didWarnTemplateFallback = false;

function getFallbackTemplateAnchors() {
  return TEMPLATE_ANCHOR_FALLBACK.map((a) => ({
    ...a,
    key: normalizeTextForMatch(a.label),
    fontName: normalizeFontName(a.fontName),
  }));
}

async function readValidationTemplatePdf() {
  const candidates = [
    path.join(process.cwd(), "app/assets/validation_PO.pdf"),
    path.join(process.cwd(), "build/assets/validation_PO.pdf"),
  ];

  for (const p of candidates) {
    try {
      return await fs.readFile(p);
    } catch {
      // keep trying fallbacks
    }
  }

  const fallbackPath = new URL("../assets/validation_PO.pdf", import.meta.url);
  return fs.readFile(fallbackPath);
}

async function loadTemplateAnchors() {
  try {
    const templateBuffer = await readValidationTemplatePdf();
    const templateBlocks = extractPurchaseOrderPdfTextBlocksFromBuffer(templateBuffer);
    const templatePageBlocks = pickPrimaryPoPage(templateBlocks);
    const byText = indexBlocksByText(templatePageBlocks);

    const anchors = [];
    for (const label of TEMPLATE_VALIDATION_LABELS) {
      const key = normalizeTextForMatch(label);
      const matches = byText.get(key) || [];
      const block = matches[0];
      if (!block) {
        throw new Error(`Validation template is missing anchor label: ${label}`);
      }
      anchors.push({
        label,
        key,
        x: block.x,
        y: block.y,
        fontName: normalizeFontName(block.fontName),
        pageWidth: block.pageWidth,
        pageHeight: block.pageHeight,
      });
    }
    return anchors;
  } catch (err) {
    if (!didWarnTemplateFallback) {
      didWarnTemplateFallback = true;
      const detail = err instanceof Error ? err.message : String(err);
      console.warn("[purchase-order-pdf] Using embedded template anchor fallback:", detail);
    }
    return getFallbackTemplateAnchors();
  }
}

async function getTemplateAnchors() {
  if (!templateAnchorPromise) {
    templateAnchorPromise = loadTemplateAnchors().catch((err) => {
      templateAnchorPromise = null;
      throw err;
    });
  }
  return templateAnchorPromise;
}

export async function validatePurchaseOrderPdfFormatFromPdfBuffer(pdfBuffer) {
  let templateAnchors;
  try {
    templateAnchors = await getTemplateAnchors();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      issues: [{ type: "template-load-failed", label: "validation template", detail: message }],
      message: "That PDF does not seem to be a RSL Purchase Order.  Check it and try with a different document.  If you're sure it's correct, contact the IT administrator.",
    };
  }

  let blocks;
  try {
    blocks = extractPurchaseOrderPdfTextBlocksFromBuffer(pdfBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      issues: [{ type: "parse-failed", label: "PDF parse", detail: message }],
      message: "That PDF does not seem to be a RSL Purchase Order.  Check it and try with a different document.  If you're sure it's correct, contact the IT administrator.",
    };
  }

  // Validate against all pages, not just a single inferred page.
  const byText = indexBlocksByText(blocks);
  const issues = [];

  for (const anchor of templateAnchors) {
    const candidates = byText.get(anchor.key) || [];
    if (!candidates.length) {
      issues.push({ type: "missing-text", label: anchor.label, detail: "Required label not found." });
      continue;
    }

    const best = pickNearestBlock(candidates, anchor);
    if (!best) {
      issues.push({ type: "missing-text", label: anchor.label, detail: "Required label not found." });
      continue;
    }

    const actualFont = normalizeFontName(best.fontName);
    if (!actualFont || actualFont !== anchor.fontName) {
      issues.push({
        type: "font-mismatch",
        label: anchor.label,
        detail: `Expected font ${anchor.fontName || "(none)"} but found ${actualFont || "(none)"}.`,
      });
      continue;
    }

    if (!placementMatches(anchor, best)) {
      issues.push({
        type: "placement-mismatch",
        label: anchor.label,
        detail: `Expected near (${anchor.x}, ${anchor.y}) but found (${best.x}, ${best.y}).`,
      });
    }
  }

  if (issues.length) {
    return {
      ok: false,
      issues,
      message: summarizeValidationIssues(issues),
    };
  }

  return {
    ok: true,
    checkedLabels: TEMPLATE_VALIDATION_LABELS.length,
  };
}

function collapseSpaces(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

const SHOPIFY_FOOTER_NOISE_RE = /\bPowered by Shopify\b/ig;

function stripShopifyFooterNoise(text) {
  const cleaned = String(text || "").replace(SHOPIFY_FOOTER_NOISE_RE, " ");
  return collapseSpaces(cleaned);
}

function dedupeLines(lines) {
  const seen = new Set();
  const out = [];
  for (const raw of lines || []) {
    const line = collapseSpaces(raw);
    if (!line) continue;
    const key = line.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function blocksToLines(blocks, tolerance = 2.5) {
  const sorted = [...(blocks || [])].sort((a, b) => {
    const ay = Number(a?.y) || 0;
    const by = Number(b?.y) || 0;
    if (Math.abs(ay - by) <= tolerance) {
      return (Number(a?.x) || 0) - (Number(b?.x) || 0);
    }
    return ay - by;
  });

  const rows = [];
  for (const b of sorted) {
    if (!b || !collapseSpaces(b.text)) continue;
    const y = Number(b.y);
    if (!Number.isFinite(y)) continue;

    let target = null;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (Math.abs(rows[i].y - y) <= tolerance) {
        target = rows[i];
        break;
      }
    }
    if (!target) {
      target = { y, parts: [] };
      rows.push(target);
    }
    target.parts.push(b);
  }

  return rows
    .sort((a, b) => a.y - b.y)
    .map((row) =>
      collapseSpaces(
        row.parts
          .sort((a, b) => (Number(a?.x) || 0) - (Number(b?.x) || 0))
          .map((x) => collapseSpaces(x?.text))
          .filter(Boolean)
          .join(" ")
      )
    )
    .filter(Boolean);
}

function extractFieldValueBelowLabel(blocks, label, maxYOffset = 80) {
  const byText = indexBlocksByText(blocks);
  const labelKey = normalizeTextForMatch(label);
  const labelBlock = (byText.get(labelKey) || [])[0] || null;
  if (!labelBlock) return null;

  const lx = Number(labelBlock.x);
  const ly = Number(labelBlock.y);
  if (!Number.isFinite(lx) || !Number.isFinite(ly)) return null;

  const candidates = (blocks || [])
    .filter((b) => {
      const bx = Number(b?.x);
      const by = Number(b?.y);
      if (!Number.isFinite(bx) || !Number.isFinite(by)) return false;
      if (normalizeTextForMatch(b?.text) === labelKey) return false;
      if (Math.abs(bx - lx) > 90) return false;
      if (by <= ly) return false;
      if (by > ly + maxYOffset) return false;
      return true;
    })
    .sort((a, b) => Number(a.y) - Number(b.y));

  if (!candidates.length) return null;
  return collapseSpaces(candidates[0].text) || null;
}

function extractSupplierLinesFromPage(poPageBlocks) {
  const byText = indexBlocksByText(poPageBlocks);
  const supplierHeader = (byText.get("SUPPLIER") || [])[0] || null;
  if (!supplierHeader) return [];

  const shipToHeader = (byText.get("SHIP TO") || [])[0] || null;
  const paymentTermsHeader = (byText.get("PAYMENT TERMS") || [])[0] || null;

  const left = Number.isFinite(Number(supplierHeader.x)) ? Number(supplierHeader.x) - 4 : 0;
  const right = shipToHeader && Number.isFinite(Number(shipToHeader.x))
    ? Number(shipToHeader.x) - 8
    : left + 290;
  const top = Number.isFinite(Number(supplierHeader.y)) ? Number(supplierHeader.y) + 8 : 0;
  const bottom = paymentTermsHeader && Number.isFinite(Number(paymentTermsHeader.y))
    ? Number(paymentTermsHeader.y) - 6
    : top + 190;

  const supplierAreaBlocks = (poPageBlocks || []).filter((b) => {
    const bx = Number(b?.x);
    const by = Number(b?.y);
    if (!Number.isFinite(bx) || !Number.isFinite(by)) return false;
    if (bx < left || bx > right) return false;
    if (by < top || by > bottom) return false;
    return true;
  });

  const lines = blocksToLines(supplierAreaBlocks)
    .map((line) => line.replace(/^SUPPLIER[:\s-]*/i, "").trim())
    .filter(Boolean);

  return dedupeLines(lines);
}

function extractSectionLinesFromPage(poPageBlocks, headerKey, rightBoundaryKey, bottomBoundaryKey) {
  const byText = indexBlocksByText(poPageBlocks);
  const header = (byText.get(normalizeTextForMatch(headerKey)) || [])[0] || null;
  if (!header) return [];

  const rightBoundary = rightBoundaryKey
    ? (byText.get(normalizeTextForMatch(rightBoundaryKey)) || [])[0] || null
    : null;
  const bottomBoundary = bottomBoundaryKey
    ? (byText.get(normalizeTextForMatch(bottomBoundaryKey)) || [])[0] || null
    : null;

  const left = Number.isFinite(Number(header.x)) ? Number(header.x) - 4 : 0;
  const right = rightBoundary && Number.isFinite(Number(rightBoundary.x))
    ? Number(rightBoundary.x) - 8
    : left + 290;
  const top = Number.isFinite(Number(header.y)) ? Number(header.y) + 8 : 0;
  const bottom = bottomBoundary && Number.isFinite(Number(bottomBoundary.y))
    ? Number(bottomBoundary.y) - 6
    : top + 190;

  const areaBlocks = (poPageBlocks || []).filter((b) => {
    const bx = Number(b?.x);
    const by = Number(b?.y);
    if (!Number.isFinite(bx) || !Number.isFinite(by)) return false;
    if (bx < left || bx > right) return false;
    if (by < top || by > bottom) return false;
    return true;
  });

  const lines = blocksToLines(areaBlocks)
    .map((line) => line.replace(new RegExp(`^${headerKey}[:\\s-]*`, "i"), "").trim())
    .filter(Boolean);

  return dedupeLines(lines);
}

function parseCityProvincePostal(line) {
  const s = collapseSpaces(line);
  if (!s) return { city: null, province: null, postalCode: null };

  let m = s.match(/^(.+?),\s*([A-Za-z]{2,3})\s+([A-Za-z0-9\- ]{3,})$/);
  if (m) {
    return {
      city: collapseSpaces(m[1]),
      province: collapseSpaces(m[2]),
      postalCode: collapseSpaces(m[3]),
    };
  }

  m = s.match(/^(.+?)\s+([A-Za-z]{2,3})\s+([A-Za-z0-9\- ]{3,})$/);
  if (m) {
    return {
      city: collapseSpaces(m[1]),
      province: collapseSpaces(m[2]),
      postalCode: collapseSpaces(m[3]),
    };
  }

  return { city: null, province: null, postalCode: null };
}

function buildSupplierDataFromLines(lines, supplierCurrency = null) {
  const deduped = dedupeLines(lines);
  if (!deduped.length) return null;

  const supplierName = deduped[0] || null;
  let email = null;
  let phone = null;
  const remaining = [];

  for (const rawLine of deduped.slice(1)) {
    let line = rawLine;

    const emailMatch = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch && !email) email = collapseSpaces(emailMatch[0]);
    line = line.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, "").trim();

    const phoneMatch = line.match(/(\+?\d[\d\s().-]{7,}\d)/);
    if (phoneMatch && !phone) phone = collapseSpaces(phoneMatch[1]);
    line = line.replace(/(\+?\d[\d\s().-]{7,}\d)/g, "").trim();

    if (line) remaining.push(line);
  }

  let country = null;
  if (remaining.length) {
    const tail = remaining[remaining.length - 1];
    if (/^[A-Za-z][A-Za-z\s]{2,}$/.test(tail) && !/\d/.test(tail)) {
      country = collapseSpaces(tail);
      remaining.pop();
    }
  }

  let city = null;
  let province = null;
  let postalCode = null;
  if (remaining.length) {
    const tail = remaining[remaining.length - 1];
    const parsed = parseCityProvincePostal(tail);
    if (parsed.city || parsed.province || parsed.postalCode) {
      city = parsed.city;
      province = parsed.province;
      postalCode = parsed.postalCode;
      remaining.pop();
    }
  }

  const address1 = remaining[0] || null;
  const address2 = remaining.length > 1 ? remaining.slice(1).join(", ") : null;

  return {
    name: supplierName,
    rawLines: deduped,
    address1,
    address2,
    city,
    province,
    postalCode,
    country,
    email,
    phone,
    supplierCurrency: collapseSpaces(supplierCurrency) || null,
  };
}

function parseDateCandidateToIso(text) {
  const s = collapseSpaces(text);
  if (!s) return null;

  const toNoonUtcIso = (year, monthIndex, day) => {
    const d = new Date(Date.UTC(year, monthIndex, day, 12, 0, 0, 0));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  let m = s.match(
    /^(Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+(\d{1,2}),\s+(\d{4})$/i
  );
  if (m) {
    const monthMap = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, sept: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11,
    };
    const monthKey = String(m[1] || "").toLowerCase();
    const monthIdx = monthMap[monthKey];
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (Number.isFinite(monthIdx) && Number.isFinite(day) && Number.isFinite(year)) {
      return toNoonUtcIso(year, monthIdx, day);
    }
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (Number.isFinite(month) && Number.isFinite(day) && Number.isFinite(year)) {
      return toNoonUtcIso(year, month - 1, day);
    }
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (Number.isFinite(month) && Number.isFinite(day) && Number.isFinite(year)) {
      return toNoonUtcIso(year, month - 1, day);
    }
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return toNoonUtcIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function extractTopRightPurchaseOrderMeta(poPageBlocks) {
  const topBlocks = (poPageBlocks || []).filter((b) => Number(b?.y) <= 90);
  if (!topBlocks.length) {
    return {
      purchaseOrderNumber: null,
      originalPoDate: null,
      originalPoDateText: null,
    };
  }

  const dateRegexes = [
    /\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b/i,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
    /\b\d{4}-\d{2}-\d{2}\b/,
  ];

  const dateCandidates = [];
  for (const b of topBlocks) {
    const text = collapseSpaces(b?.text);
    if (!text) continue;
    for (const re of dateRegexes) {
      const m = text.match(re);
      if (!m) continue;
      dateCandidates.push({
        block: b,
        value: collapseSpaces(m[0]),
      });
      break;
    }
  }

  let dateCandidate = null;
  if (dateCandidates.length) {
    dateCandidate = dateCandidates.sort((a, b) => {
      const ax = Number(a.block?.x) || 0;
      const bx = Number(b.block?.x) || 0;
      if (ax !== bx) return bx - ax;
      const ay = Number(a.block?.y) || 0;
      const by = Number(b.block?.y) || 0;
      return ay - by;
    })[0];
  }

  let purchaseOrderNumber = null;
  if (dateCandidate?.block) {
    const dx = Number(dateCandidate.block.x) || 0;
    const dy = Number(dateCandidate.block.y) || 0;
    const poCandidates = topBlocks
      .filter((b) => {
        const x = Number(b?.x);
        const y = Number(b?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        if (y > dy + 1) return false;
        if (x < dx - 220) return false;
        return true;
      })
      .map((b) => collapseSpaces(b?.text))
      .filter(Boolean);

    const poText =
      poCandidates.find((t) => /^#/.test(t)) ||
      poCandidates.find((t) => /PO/i.test(t)) ||
      poCandidates[0] ||
      null;

    if (poText) {
      purchaseOrderNumber = collapseSpaces(poText).replace(/^#+/, "").trim() || null;
    }
  }

  if (!purchaseOrderNumber) {
    const fallbackPo = topBlocks
      .map((b) => collapseSpaces(b?.text))
      .find((t) => /^#/.test(t) || /\bPO[\w-]*\b/i.test(t));
    if (fallbackPo) {
      purchaseOrderNumber = collapseSpaces(fallbackPo).replace(/^#+/, "").trim() || null;
    }
  }

  const originalPoDateText = dateCandidate?.value || null;
  const originalPoDate = originalPoDateText ? parseDateCandidateToIso(originalPoDateText) : null;

  return {
    purchaseOrderNumber,
    originalPoDate,
    originalPoDateText,
  };
}

function buildShipToDataFromLines(lines) {
  const rawLines = dedupeLines(lines);
  if (!rawLines.length) return null;

  return {
    rawLines,
    displayName: rawLines.join(", "),
  };
}

function normalizeColorToken(text) {
  const s = collapseSpaces(text).toLowerCase();
  if (!s) return null;
  if (/\bblack\b/.test(s)) return "Black";
  if (/\bwhite\b/.test(s)) return "White";
  return null;
}

function looksLikeSku(text) {
  const s = collapseSpaces(text).toUpperCase();
  if (!s) return false;
  // Typical vendor SKUs are compact and alphanumeric (optional hyphens), no spaces.
  return /^[A-Z0-9][A-Z0-9-]{5,}$/.test(s);
}

const PRODUCT_TITLE_LINE_BLOCKLIST = /^(FACTORY\s+NEW|WARRANTY|REPLACEMENT)$/i;

function normalizeColorLineToToken(text) {
  const s = collapseSpaces(text);
  if (!s) return null;
  // Keep color extraction tolerant for values like "Black (Matte) /" and "White / Factory New"
  const head = collapseSpaces(s.split("/")[0] || s);
  return normalizeColorToken(head);
}

function buildProductTitleAndSku(productLinesRaw) {
  const raw = Array.isArray(productLinesRaw) ? productLinesRaw.map((x) => collapseSpaces(x)).filter(Boolean) : [];
  if (!raw.length) return { title: "", sku: "", color: null };

  const normalized = raw
    .map((x) => stripShopifyFooterNoise(x))
    .filter((x) => x && !/^powered by shopify$/i.test(x));
  if (!normalized.length) return { title: "", sku: "", color: null };

  let sku = "";
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    if (looksLikeSku(normalized[i])) {
      sku = normalized[i];
      break;
    }
  }

  // Keep product description exactly from the PO row (all lines combined, no text cleanup beyond spacing).
  const title = stripShopifyFooterNoise(normalized.join(" "));

  return {
    title: title || (normalized[0] || ""),
    sku,
    color: null,
  };
}

function extractProductsFromBlocks(blocks) {
  const byText = (t) => blocks.find((b) => b.text.trim().toUpperCase() === t);
  const headerProducts = byText("PRODUCTS");
  const headerSupplierSku = byText("SUPPLIER SKU");
  const headerQty = byText("QTY");
  const headerCost = byText("COST");

  if (!headerProducts || !headerSupplierSku || !headerQty || !headerCost) {
    throw new Error("Could not find product table headers in PDF.");
  }

  const footer = blocks
    .filter((b) => b.y > headerProducts.y)
    .find((b) => /^(REFERENCE NUMBER|NOTES TO SUPPLIER)$/i.test(b.text.trim()));
  const footerY = footer ? footer.y : Number.POSITIVE_INFINITY;

  const tableBlocks = blocks.filter(
    (b) => b.y > headerProducts.y && b.y < footerY
  );

  const qtyByY = new Map();
  const costByY = new Map();
  for (const b of tableBlocks) {
    if (near(b.x, headerQty.x, 3)) qtyByY.set(b.y, b);
    if (near(b.x, headerCost.x, 3)) costByY.set(b.y, b);
  }

  const rowYs = [...qtyByY.keys()]
    .filter((y) => costByY.has(y))
    .sort((a, b) => a - b);

  const products = [];
  for (let i = 0; i < rowYs.length; i += 1) {
    const y = rowYs[i];
    const nextY = i + 1 < rowYs.length ? rowYs[i + 1] : footerY;
    const rowBottom = Number.isFinite(nextY) ? nextY : y + 120;

    const productLines = tableBlocks
      .filter(
        (b) =>
          b.x < headerSupplierSku.x &&
          b.y >= y &&
          b.y < rowBottom
      )
      .sort((a, b) => a.y - b.y)
      .map((b) => b.text.trim())
      .filter(Boolean);

    if (!productLines.length) continue;

    const parsed = buildProductTitleAndSku(productLines);
    const title = parsed.title;
    const sku = parsed.sku;

    const quantity = parseQuantity(qtyByY.get(y)?.text);
    const cost = parseMoney(costByY.get(y)?.text);

    products.push({
      title,
      sku,
      quantity,
      cost,
    });
  }

  return products;
}

export function extractPurchaseOrderProductsFromPdfBuffer(pdfBuffer) {
  const allBlocks = extractPurchaseOrderPdfTextBlocksFromBuffer(pdfBuffer);
  const pageMap = new Map();
  for (const block of allBlocks || []) {
    const page = Number(block?.page);
    if (!Number.isFinite(page)) continue;
    if (!pageMap.has(page)) pageMap.set(page, []);
    pageMap.get(page).push(block);
  }

  const pages = [...pageMap.keys()].sort((a, b) => a - b);
  const allProducts = [];

  for (const page of pages) {
    const pageBlocks = pageMap.get(page) || [];
    try {
      const pageProducts = extractProductsFromBlocks(pageBlocks);
      if (Array.isArray(pageProducts) && pageProducts.length) {
        allProducts.push(...pageProducts);
      }
    } catch {
      // Some pages may not contain product table headers. Ignore and continue.
    }
  }

  if (allProducts.length) return allProducts;
  return extractProductsFromBlocks(allBlocks);
}

export function extractPurchaseOrderSupplierFromPdfBuffer(pdfBuffer) {
  const allBlocks = extractPurchaseOrderPdfTextBlocksFromBuffer(pdfBuffer);
  const poPageBlocks = pickPrimaryPoPage(allBlocks);
  if (!poPageBlocks.length) return null;

  const supplierLines = extractSupplierLinesFromPage(poPageBlocks);
  const supplierCurrency = extractFieldValueBelowLabel(poPageBlocks, "SUPPLIER CURRENCY");
  return buildSupplierDataFromLines(supplierLines, supplierCurrency);
}

export function extractPurchaseOrderShipToFromPdfBuffer(pdfBuffer) {
  const allBlocks = extractPurchaseOrderPdfTextBlocksFromBuffer(pdfBuffer);
  const poPageBlocks = pickPrimaryPoPage(allBlocks);
  if (!poPageBlocks.length) return null;

  const shipToLines = extractSectionLinesFromPage(poPageBlocks, "SHIP TO", "BILL TO", "PAYMENT TERMS");
  return buildShipToDataFromLines(shipToLines);
}

export function extractPurchaseOrderHeaderMetaFromPdfBuffer(pdfBuffer) {
  const allBlocks = extractPurchaseOrderPdfTextBlocksFromBuffer(pdfBuffer);
  const poPageBlocks = pickPrimaryPoPage(allBlocks);
  if (!poPageBlocks.length) {
    return {
      purchaseOrderNumber: null,
      originalPoDate: null,
      originalPoDateText: null,
    };
  }
  return extractTopRightPurchaseOrderMeta(poPageBlocks);
}

export function extractPurchaseOrderPdfTextBlocksFromPdfBuffer(pdfBuffer) {
  return extractPurchaseOrderPdfTextBlocksFromBuffer(pdfBuffer);
}

function extractPurchaseOrderPdfTextBlocksFromBuffer(pdfBuffer) {
  const pdfLatin1 = pdfBuffer.toString("latin1");
  const objects = parseObjects(pdfLatin1);

  const pageEntries = [...objects.entries()].filter(([, body]) => /\/Type\s*\/Page\b/.test(body));
  if (!pageEntries.length) throw new Error("No /Page objects found.");

  const allBlocks = [];

  pageEntries.forEach(([pageId, pageBody], index) => {
    const fontMaps = parseFontMapsForPage(objects, pageBody);
    const fontNames = parseFontNamesForPage(objects, pageBody);
    const pageSize = parsePageSize(pageBody);

    const contentIds = [];
    const mSingle = pageBody.match(/\/Contents\s+(\d+)\s+0\s+R/);
    if (mSingle) contentIds.push(Number(mSingle[1]));

    const mArray = pageBody.match(/\/Contents\s*\[([^\]]+)\]/);
    if (mArray) {
      for (const m of mArray[1].matchAll(/(\d+)\s+0\s+R/g)) {
        contentIds.push(Number(m[1]));
      }
    }

    for (const cid of contentIds) {
      const contentObj = objects.get(cid);
      if (!contentObj) continue;
      const stream = decodeFlateStream(contentObj);
      if (!stream) continue;
      const contentText = stream.toString("latin1");
      allBlocks.push(...parseTextBlocksFromContent(contentText, fontMaps, fontNames, index + 1, pageSize));
    }
  });

  return allBlocks;
}

export async function extractPurchaseOrderProductsFromPdfFile(pdfPath) {
  const buf = await fs.readFile(pdfPath);
  return extractPurchaseOrderProductsFromPdfBuffer(buf);
}
