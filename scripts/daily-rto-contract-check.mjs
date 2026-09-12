import assert from 'node:assert/strict';
import { unavailableDailyRegistrationReport } from '../lib/rto-daily-registration-contract.mjs';
import { quarantineUnverifiedRtoReport,renderRtoReportCsv,renderRtoReportHtml } from '../lib/rto-reports.mjs';
import {validateStockJobPersistence,buildRankedStockSnapshotRows} from '../lib/rto-daily-snapshots.mjs';
import {loadRtoReportWithOptionalFactorContext} from '../lib/rto-report-context.mjs';
import {withStockEvidence} from './fixtures/rto-stock-evidence.mjs';

let checks=0;
const check=(name,fn)=>{fn();checks++;console.log(`PASS ${name}`);};
function saved(date='2026-09-11',delta=0){return {cadence:'daily',periodEnd:date,periodEv:delta,periodIce:delta,mtdEv:123,evShare:55,cohortRank:12,explanations:[{body:'False registration explanation'}],payload:{cadence:'daily',rto:{name:'QA RTO',state:'QA',cohortRank:12},period:{end:date,label:date},source:{validationContract:'public-stock-v2',registrationFlowAvailable:false},quality:{currentCoverage:true},metrics:{period:{ev:delta,ice:delta},previousPeriod:{total:999},stock:{ev:123}},categories:[{vehicleCategory:'2W',period:{ev:delta}}],oems:[{oem:'QA',period:{ev:delta}}],trend:[{date,ev:123}],explanations:[{body:'False registration explanation'}]}};}
for(const delta of [-4,0,50])check(`stock delta ${delta} cannot become registrations`,()=>{
 const q=quarantineUnverifiedRtoReport(saved('2026-09-11',delta));
 for(const key of ['periodEv','periodIce','mtdEv','mtdIce','evShare','cohortRank','previousRank'])assert.equal(q[key],null,key);
 for(const key of ['previousDayRegistrations','evRegistrations','iceRegistrations','evShare','rank'])assert.equal(q.dailyRegistration[key].value,null,key);
 assert.equal(q.payload.oems.length,0);assert.equal(q.payload.trend.length,0);assert.equal(q.payload.metrics.previousPeriod.total,null);
 assert.equal(q.payload.explanations.length,0);
});
check('idempotent quarantine',()=>{const once=unavailableDailyRegistrationReport(saved());assert.deepEqual(unavailableDailyRegistrationReport(once),once);});
for(const [date,previous] of [['2026-10-01','2026-09-30'],['2027-01-01','2026-12-31']])check(`calendar boundary ${date}`,()=>assert.equal(unavailableDailyRegistrationReport(saved(date)).dailyRegistration.previousDayRegistrations.date,previous));
check('authoritative daily cadence beats conflicting payload',()=>{const r=saved();r.payload.cadence='weekly';assert.equal(quarantineUnverifiedRtoReport(r).periodEv,null);});
check('weekly stock report unchanged',()=>{const r=saved();r.cadence=r.payload.cadence='weekly';assert.equal(unavailableDailyRegistrationReport(r),r);});
check('legacy saved exports suppress stock numbers',()=>{const r=saved();const csv=renderRtoReportCsv(r),html=renderRtoReportHtml(r);assert.match(csv,/unavailable/);assert.match(html,/Daily registrations unavailable/);assert.doesNotMatch(csv,/999|123|False registration/);assert.doesNotMatch(html,/999|123|False registration/);});
let contextLoaded=false;
const context=await loadRtoReportWithOptionalFactorContext({reportId:1,factorAgentEnabled:true,loadReport:async()=>quarantineUnverifiedRtoReport(saved()),loadApprovedExplanations:async()=>{contextLoaded=true;return [{body:'False'}];}});
check('factor context withheld',()=>{assert.equal(contextLoaded,false);assert.deepEqual(context.explanations,[]);});
const job={id:1,runId:2,state:'QA',rto:'QA RTO',snapshotDate:'2026-09-11',targetMonth:'2026-09'};
const now=new Date('2026-09-11T10:00:00Z');
const reports=['EV','ICE'].flatMap(fuelGroup=>['2W','3W','4W'].map(vehicleCategory=>withStockEvidence({status:'success',state:job.state,rto:job.rto,fuelGroup,vehicleCategory,filtersConfirmed:true,reportTotal:10,rows:[{maker:'QA Maker',vehicle_count:10,rank:1}],scrapedAt:now.toISOString()})));
const rows=reports.flatMap(r=>buildRankedStockSnapshotRows({...job,sourceRows:r.rows,fuelGroup:r.fuelGroup,vehicleCategory:r.vehicleCategory,metadata:{scrapeRunId:job.runId,scrapedAt:r.scrapedAt,source:r.source}}));
check('matching source persistence accepted',()=>validateStockJobPersistence({job,reports,rows,now}));
for(const [name,alter] of [
 ['wrong OEM total',r=>r[0].vehicleCount++],['duplicate OEM',r=>r.push({...r[0]})],['foreign source',r=>r[0].source='foreign-source'],['mixed date',r=>r[0].snapshotDate='2026-09-10'],['mismatched observation timestamp',r=>r[0].scrapedAt='2026-09-11T09:00:00Z']
])check(`reject ${name}`,()=>{const changed=structuredClone(rows);alter(changed);assert.throws(()=>validateStockJobPersistence({job,reports,rows:changed,now}));});
check('reject historical stock backfill',()=>assert.throws(()=>validateStockJobPersistence({job,reports,rows,now:new Date('2026-09-12T10:00:00Z')})));
check('reject IST midnight crossing',()=>{const changed=structuredClone(reports);changed[0].scrapedAt='2026-09-10T18:29:59Z';assert.throws(()=>validateStockJobPersistence({job,reports:changed,rows,now}));});
console.log(`Daily RTO contract: ${checks} focused checks passed.`);
