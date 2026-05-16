const CKAN_BASE_URL = "https://ckan.tdc.prod.datopian.com/en_GB/api/action";

const resources = {
  vehicleCategory: "6b236057-e718-4340-907c-d63c3145b706",
};

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(`CKAN API returned success=false: ${JSON.stringify(data.error)}`);
  }

  return data.result;
}

async function getSampleRows(resourceId, limit = 5) {
  const url = new URL(`${CKAN_BASE_URL}/datastore_search`);
  url.searchParams.set("resource_id", resourceId);
  url.searchParams.set("limit", String(limit));

  return fetchJson(url);
}

async function getFreshness(resourceId) {
  const sql = `SELECT MIN(date) as earliest_date, MAX(date) as latest_date, COUNT(*) as rows FROM "${resourceId}"`;
  const url = new URL(`${CKAN_BASE_URL}/datastore_search_sql`);
  url.searchParams.set("sql", sql);

  const result = await fetchJson(url);
  return result.records[0];
}

async function main() {
  const resourceId = resources.vehicleCategory;

  console.log("Vahan aggregate data source test");
  console.log("Source: Transport Data Commons CKAN datastore");
  console.log(`Resource ID: ${resourceId}`);
  console.log("");

  const freshness = await getFreshness(resourceId);
  console.log("Freshness:");
  console.table([freshness]);

  const sample = await getSampleRows(resourceId, 5);
  console.log("Fields:");
  console.table(sample.fields.map((field) => ({ id: field.id, type: field.type })));

  console.log("Sample aggregate rows:");
  console.table(sample.records);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
