import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import process from "node:process";

const PACKAGE_ID = "vahan-vehicle-registrations-india";
const CKAN_PACKAGE_URL = `https://ckan.tdc.prod.datopian.com/en_GB/api/3/action/package_show?id=${PACKAGE_ID}`;
const DEFAULT_OUTPUT_DIR = "data/tdc-history";

const DEFAULT_RESOURCES = new Set([
  "vahan-vehicle-registrations-by-fuel-type.csv",
  "vahan-vehicle-registrations-by-maker.csv",
  "vahan-vehicle-registrations-by-vehicle-category.csv",
  "India_Vahan_registrations_by_vehicle_category_and_fuel_FY2011-FY2025_TDC_formatted.csv",
]);

function parseArgs(argv) {
  const args = {
    outputDir: DEFAULT_OUTPUT_DIR,
    all: false,
    list: false,
    include: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--all") {
      args.all = true;
    } else if (token === "--list") {
      args.list = true;
    } else if (token === "--output-dir") {
      args.outputDir = argv[index + 1];
      index += 1;
    } else if (token === "--include") {
      args.include = argv[index + 1].split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function safeFileName(name) {
  return name.replace(/[<>:"/\\|?*]+/g, "_");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${response.statusText}`);
  }

  const payload = await response.json();
  if (!payload.success) {
    throw new Error(`CKAN returned success=false: ${JSON.stringify(payload.error)}`);
  }

  return payload.result;
}

function selectResources(resources, args) {
  if (args.all) return resources.filter((resource) => resource.format?.toUpperCase() === "CSV");
  if (args.include.length) {
    const needles = args.include.map((item) => item.toLowerCase());
    return resources.filter((resource) =>
      needles.some((needle) => resource.name.toLowerCase().includes(needle)),
    );
  }

  return resources.filter((resource) => DEFAULT_RESOURCES.has(resource.name));
}

async function downloadResource(resource, outputDir) {
  const fileName = safeFileName(resource.name);
  const target = path.join(outputDir, fileName);
  const response = await fetch(resource.url);

  if (!response.ok) {
    throw new Error(`Download failed for ${resource.name}: ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target));

  return {
    id: resource.id,
    name: resource.name,
    format: resource.format,
    size: resource.size ?? null,
    url: resource.url,
    local_path: target,
  };
}

async function writeManualTemplate(outputDir) {
  const templatePath = path.join(outputDir, "manual_vahan_2025_2026_template.csv");
  const csv = [
    "year,month,state,maker,fuel_type,vehicle_count,source_url,collected_at,notes",
    "2025,6,Maharashtra,TATA MOTORS LTD,ELECTRIC,,https://analytics.parivahan.gov.in/,2026-05-14,Fill vehicle_count manually from VAHAN dashboard",
  ].join("\n");

  await fsp.writeFile(templatePath, `${csv}\n`);
  return templatePath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fsp.mkdir(args.outputDir, { recursive: true });

  const pkg = await fetchJson(CKAN_PACKAGE_URL);
  const resources = pkg.resources ?? [];

  await fsp.writeFile(
    path.join(args.outputDir, "tdc-package-metadata.json"),
    JSON.stringify(
      {
        title: pkg.title,
        source_url: pkg.url,
        temporal_coverage_start: pkg.temporal_coverage_start,
        temporal_coverage_end: pkg.temporal_coverage_end,
        metadata_modified: pkg.metadata_modified,
        resources: resources.map((resource) => ({
          id: resource.id,
          name: resource.name,
          format: resource.format,
          size: resource.size ?? null,
          url: resource.url,
        })),
      },
      null,
      2,
    ),
  );

  if (args.list) {
    console.table(
      resources.map((resource) => ({
        name: resource.name,
        format: resource.format,
        size_mb: resource.size ? (resource.size / 1024 / 1024).toFixed(1) : "",
      })),
    );
    return;
  }

  const selected = selectResources(resources, args);
  const downloads = [];

  for (const resource of selected) {
    console.log(`Downloading ${resource.name}`);
    downloads.push(await downloadResource(resource, args.outputDir));
  }

  const templatePath = await writeManualTemplate(args.outputDir);

  await fsp.writeFile(
    path.join(args.outputDir, "download-manifest.json"),
    JSON.stringify(
      {
        downloaded_at: new Date().toISOString(),
        package: {
          title: pkg.title,
          url: "https://ckan.transport-data.org/dataset/vahan-vehicle-registrations-india",
          temporal_coverage_start: pkg.temporal_coverage_start,
          temporal_coverage_end: pkg.temporal_coverage_end,
        },
        downloads,
        manual_template: templatePath,
      },
      null,
      2,
    ),
  );

  console.log(`Downloaded ${downloads.length} historical files to ${args.outputDir}`);
  console.log(`Manual VAHAN template: ${templatePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
