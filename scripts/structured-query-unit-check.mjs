import assert from 'node:assert/strict';
process.env.DATABASE_URL = '';
process.env.VAHAN_DISABLE_LIVE_REFRESH = '1';
process.env.NODE_ENV = 'test';
process.env.AI_QUERY_PROVIDER = 'none';
const {normalizeStructuredDashboardFilters: normalize, queryData, interpretDashboardQuery} = await import('../server.mjs');
const {canonicalRefreshKey} = await import('../lib/query-refresh-audit.mjs');
const base = {state:'Maharashtra',from:'2024-01',to:'2024-12'};
const invalid = [null, [], {...base,from:'2024-13'}, {...base,to:'2023-12'}, {...base,selectedFuelTypes:'PETROL'}, {...base,selectedFuelTypes:['made-up fuel']}, {...base,selectedFuelTypes:['PETROL'],excludedFuelTypes:['PETROL']}, {...base,selectedVehicleGroups:['TWO WHEELER'],selectedVehicleCategories:['LIGHT MOTOR VEHICLE']}, {...base,unknown:true}, {...base,state:'not a state'}, {...base,excludedNorms:['BHARAT STAGE VI'],excludedVehicleCategories:['LIGHT MOTOR VEHICLE']}];
for (const input of invalid) assert.throws(() => normalize(input), (e) => e.statusCode === 400, JSON.stringify(input));
for (const [question, filters] of [
  ['petrol registrations in Maharashtra in 2024', {...base,selectedFuelTypes:['PETROL']}],
  ['two wheeler registrations in Maharashtra in 2024', {...base,selectedVehicleGroups:['TWO WHEELER']}],
  ['pure ev registrations in Maharashtra in 2024', {...base,selectedFuelTypes:['PURE EV']}],
  ['electric(bov) registrations in Maharashtra in 2024', {...base,selectedFuelTypes:['ELECTRIC(BOV)']}],
  ['CNG ONLY registrations in Maharashtra in 2024', {...base,selectedFuelTypes:['CNG ONLY']}],
  ['strong hybrid registrations in Maharashtra in 2024', {...base,selectedFuelTypes:['STRONG HYBRID EV']}],
  ['plug in hybrid registrations in Maharashtra in 2024', {...base,selectedFuelTypes:['PLUG-IN HYBRID EV']}],
  ['non ev registrations in Maharashtra in 2024', {...base,fuelSegment:'NON_EV'}],
  ['EV registrations in Maharashtra in 2024', {...base,fuelSegment:'EV'}],
]) {
  const fromText = interpretDashboardQuery(question).filters;
  const fromEditor = normalize(filters);
  assert.equal(canonicalRefreshKey(fromEditor),canonicalRefreshKey(fromText), question);
}
const cleared = normalize(base);
assert.equal(normalize({...base,fuelSegment:'NON_EV'}).fuelSegment,'NON_EV');
assert.equal(normalize({...base,fuelSegment:'EV'}).fuelSegment,'EV');
for (const fuelSegment of ['wrong', 1, [], {}]) assert.throws(() => normalize({...base,fuelSegment}), e => e.statusCode === 400);
assert.throws(() => normalize({...base,fuelSegment:'EV',selectedFuelTypes:['PETROL']}), e => e.statusCode === 400);
assert.throws(() => normalize({...base,fuelSegment:'NON_EV',selectedFuelTypes:['PURE EV']}), e => e.statusCode === 400);
assert.throws(() => normalize({...base,rto:{code:'MH12'}}), e => e.statusCode === 400);
assert.deepEqual(cleared.vehicleClasses,[]);
assert.deepEqual(cleared.selectedFuelTypes,[]);
assert.equal(cleared.fuelSegment,null);
assert.notEqual(canonicalRefreshKey(normalize({...base,excludedFuelTypes:['PETROL']})),canonicalRefreshKey(cleared));
await assert.rejects(queryData({query:'petrol in 2024',filters:base}), e => e.statusCode === 400);
await assert.rejects(queryData({filters:{...base,selectedNorms:['unknown']}}), e => e.statusCode === 400);
const structured = await queryData({filters:{...base,selectedFuelTypes:['PETROL']}});
const natural = await queryData({query:'petrol registrations in Maharashtra in 2024'});
assert.equal(structured.summary.total,natural.summary.total);
assert.deepEqual(structured.trend,natural.trend);
assert.equal(structured.liveRefresh?.status,natural.liveRefresh?.status);
console.log('Structured filters: validation, clearing, query parity, exact refresh keys and offline retrieval passed.');

