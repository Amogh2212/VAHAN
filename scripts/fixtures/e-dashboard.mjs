// Isolated UI review: static assets and labelled fixtures only. No app server or database.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('public');
const counts=[173348,148091,152806,173552,160256,135274,140476,137112,138070,259252,268441,164751];
const fuelNames=['PETROL','ELECTRIC(BOV)','PURE EV','PETROL(E20)','CNG ONLY','ETHANOL(E100)'];
const fuels=[1774110,128983,81190,59072,8022,52];
let remaining=[...fuels],remainingTotal=2051429;
const rows=counts.flatMap((total,i)=>{
  let available=total;
  const values=remaining.map((count,j)=>j===5 ? available : Math.min(available,Math.floor(count*total/remainingTotal)));
  // Use a proportional allocation that preserves both monthly and annual margins.
  available=total;
  for(let j=0;j<5;j++){values[j]=Math.min(available,remaining[j],Math.floor(remaining[j]*total/remainingTotal));available-=values[j];}
  values[5]=Math.min(available,remaining[5]);available-=values[5];
  for(let j=0;available && j<6;j++){const n=Math.min(available,remaining[j]-values[j]);values[j]+=n;available-=n;}
  remainingTotal-=total;remaining=remaining.map((n,j)=>n-values[j]);
  return values.map((count,j)=>({year:2024,month:i+1,state:'Maharashtra',rto:'All Vahan4 Running Office',fuel_type:fuelNames[j],fuel_segment:j===1||j===2?'EV':'ICE',vehicle_count:count,fuel_filter:'ALL',vehicle_category_filter:'TWO WHEELER(NT)',norms_filter:'ALL',vehicle_class_filter:'ALL',scraped_at:'2024-12-31T00:00:00Z',source_url:'https://vahan.parivahan.gov.in/'}));
});
export const fixture={filters:{state:'Maharashtra',rto:'All Vahan4 Running Office',from:'2024-01',to:'2024-12',selectedVehicleGroups:[],selectedVehicleCategories:['TWO WHEELER(NT)','TWO WHEELER(T)']},dataStatus:'complete',summary:{total:2051429,monthlyAverage:2051429/12,peakMonth:'2024-11',peakMonthCount:268441},rows,trend:counts.map((count,i)=>({month:`2024-${String(i+1).padStart(2,'0')}`,count})),fuelBreakdown:fuelNames.map((fuelType,i)=>({fuelType,count:fuels[i]})),freshness:{source:'Design review fixture · historical screenshot, not live data',latestMonth:'2024-12'},warnings:[],scraper:{autoTriggered:false,failedRuns:[]},persistenceStatus:'fixture',liveRefresh:null};
export const metadata={states:['Maharashtra','Uttar Pradesh','Delhi'],fuelTypes:fuelNames,vehicleGroups:['TWO WHEELER','THREE WHEELER'],vehicleCategories:['TWO WHEELER(NT)','TWO WHEELER(T)','LIGHT MOTOR VEHICLE','LIGHT PASSENGER VEHICLE'],vehicleClasses:['MOTOR CAR','MOTOR CYCLE/SCOOTER'],norms:['BHARAT STAGE VI']};
export function createFixtureServer() {
let requests=[];
return http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let data,status=200;
 if(url.pathname==='/api/query'){
   let text='';for await(const part of req)text+=part;const body=JSON.parse(text);requests.push(body);
   data=structuredClone(fixture);
   if(body.filters){data.filters={...body.filters,aiProvider:'Filter editor'};data.warnings=['Fixture preview: chart values illustrate layout and do not change with selected scope.'];}
   if(body.query?.includes('missing')){data.dataStatus='missing';data.rows=[];data.trend=[];data.fuelBreakdown=[];data.summary={total:0,monthlyAverage:0};}
   if(body.query?.includes('failed')){status=503;data={error:'Fixture: source unavailable. Try again later.'};}
   if(body.query?.includes('slow'))await new Promise(r=>setTimeout(r,1400));
 }else if(url.pathname==='/api/metadata/query-filters') data=metadata;
 else if(url.pathname==='/api/metadata/rtos')data={rtos:url.searchParams.get('state')==='Uttar Pradesh'?['NOIDA - UP16']:['PUNE - MH12','MUMBAI CENTRAL - MH01']};
 else if(url.pathname==='/api/me')data={user:null};
 else if(url.pathname==='/api/rto-daily/coverage')data={enabled:true,cycle:null,summary:{},cohortSize:100};
 else if(url.pathname==='/api/rto-daily/search')data={matches:[{state:'Uttar Pradesh',rto:'NOIDA - UP16'}]};
 else if(url.pathname==='/api/rto-daily/status')data={state:'Uttar Pradesh',rto:'NOIDA - UP16',status:{lastSnapshotDate:'2024-12-31',pinned:false,job:null}};
 else if(url.pathname==='/api/rto-daily/trend')data={rows:[{snapshotDate:'2024-12-29',targetMonth:'2024-12',vehicleCount:150,dailyDelta:null,qualityStatus:'verified fixture'},{snapshotDate:'2024-12-30',targetMonth:'2024-12',vehicleCount:162,dailyDelta:12,qualityStatus:'verified fixture'},{snapshotDate:'2024-12-31',targetMonth:'2024-12',vehicleCount:177,dailyDelta:15,qualityStatus:'verified fixture'}]};
 else if(url.pathname==='/api/rto-reports/readiness')data={ready:false,expectedRtos:100,completedRtos:0,reasons:['Fixture: no completed collection cycle.']};
 else if(url.pathname==='/api/rto-reports/batches')data={batches:[]};
 else if(url.pathname==='/api/rto-insights/coverage')data={summary:{},warnings:[],sources:[]};
 else if(url.pathname==='/api/rto-insights/summary')data={rows:[],summary:{},warnings:[]};
 else if(url.pathname.startsWith('/api/map'))data={states:[],summary:{total:0,ev:0,evShare:0},filters:{from:'2024-01',to:'2024-12'},freshness:fixture.freshness,coverage:{availableStates:0,totalStates:36,rowCount:0,latestMonth:null},warnings:[]};
 else if(url.pathname==='/__requests')data=requests;
 else if(url.pathname.startsWith('/api/')){status=503;data={error:'Fixture: no saved data for this view.'};}
 if(data!==undefined){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));return;}
 const filename=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
 if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{const content=await fs.readFile(filename);res.writeHead(200,{'content-type':({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.html':'text/html'})[path.extname(filename)]||'application/octet-stream','cache-control':'no-store'});res.end(content);}catch{res.writeHead(404).end();}
});
}
