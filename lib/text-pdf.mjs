const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const PAGE_MARGIN = 48;
const BODY_TOP = 774;
const LINE_HEIGHT = 13;
const LINES_PER_PAGE = 54;

export function renderHtmlTextPdf(html) {
  const title = asciiText(extractTitle(html) || "RTO report");
  const lines = htmlToLines(html).flatMap((line) => wrapLine(line, 88));
  const pages = chunk(lines.length ? lines : ["No report content available."], LINES_PER_PAGE);
  return buildPdf(title, pages);
}

function buildPdf(title, pages) {
  const objects = [null, "", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageIds = [];
  for (let index = 0; index < pages.length; index += 1) {
    const stream = pageStream(title, pages[index], index + 1, pages.length);
    const streamId = objects.length;
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const pageId = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [0];
  let offset = chunks[0].length;
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = offset;
    const object = Buffer.from(`${id} 0 obj\n${objects[id]}\nendobj\n`, "latin1");
    chunks.push(object);
    offset += object.length;
  }
  const xrefOffset = offset;
  const xref = [`xref\n0 ${objects.length}\n`, "0000000000 65535 f \n"];
  for (let id = 1; id < objects.length; id += 1) xref.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(Buffer.from(xref.join(""), "latin1"));
  return Buffer.concat(chunks);
}

function pageStream(title, lines, page, totalPages) {
  const body = lines.map((line) => `(${pdfText(line)}) Tj\nT*`).join("\n");
  return `BT\n/F1 16 Tf\n1 0 0 1 ${PAGE_MARGIN} 808 Tm\n(${pdfText(title)}) Tj\nET\n`
    + `BT\n/F1 10 Tf\n1 0 0 1 ${PAGE_MARGIN} ${BODY_TOP} Tm\n${LINE_HEIGHT} TL\n${body}\nET\n`
    + `BT\n/F1 9 Tf\n1 0 0 1 ${PAGE_MARGIN} 28 Tm\n(Page ${page} of ${totalPages}) Tj\nET`;
}

function htmlToLines(html) {
  const text = String(html ?? "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/td>/gi, " | ")
    .replace(/<\/(?:p|h1|h2|h3|h4|tr|li|section|article|div|table|thead|tbody)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(text).split(/\r?\n/).map((line) => asciiText(line).replace(/\s+/g, " ").trim()).filter(Boolean);
}

function extractTitle(html) {
  return decodeHtml(String(html ?? "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ").trim();
}

function decodeHtml(value) {
  return String(value).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&nbsp;", " ").replaceAll("&amp;", "&").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

function asciiText(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E]/g, "?");
}

function pdfText(value) {
  return asciiText(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function wrapLine(line, width) {
  if (line.length <= width) return [line];
  const words = line.split(/\s+/);
  const result = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else { result.push(current); current = word; }
  }
  if (current) result.push(current);
  return result;
}

function chunk(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}
