import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {query,closePool} from '../lib/db.mjs';
import {upsertRtoDailyConfigs,ensureRtoDailyCycle,claimRtoDailyJob,completeRtoDailyJob,failRtoDailyJob,finalizeRtoDailyCycle,buildRankedStockSnapshotRows,snapshotDateKey} from '../lib/rto-daily-snapshots.mjs';
import {getRtoReportReadiness,reconcileRtoReportsForRun,listRtoReportBatches,listRtoReportsForBatch,getRtoReport,getRtoReportBatch,renderRtoReportCsv,renderRtoReportHtml,renderRtoReportBatchCsv} from '../lib/rto-reports.mjs';
import {withStockEvidence} from './fixtures/rto-stock-evidence.mjs';

// A disposable schema on localhost is mandatory. Never use production fixtures.
const url=new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Only local PostgreSQL is permitted');
const schema=`daily_contract_qa_${process.pid}_${Date.now()}`;
assert.match(schema,/^daily_contract_qa_[0-9_]+$/);
const admin=new pg.Client({connectionString:url.toString(),ssl:false});
await admin.connect();
let created=false,checks=0;
const checked=name=>{checks++;console.log(`PASS ${name}`);};
const state='__DAILY_CONTRACT_QA__';
const day=snapshotDateKey(),month=day.slice(0,7);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function sourceRows(job,replacement=false){
 const now=new Date().toISOString();
 const reports=['EV','ICE'].flatMap(fuelGroup=>['2W','3W','4W'].map(vehicleCategory=>{
  const rows=Array.from({length:5},(_,i)=>({maker:`${replacement&&i===4?'Replacement':'Maker'} ${i+1}`,vehicle_count:50-i*5,rank:i+1}));
  const r=withStockEvidence({status:'success',state:job.state,rto:job.rto,fuelGroup,vehicleCategory,filtersConfirmed:true,reportTotal:250+Number(job.configId),explicitZero:false,rows,attempts:1,scrapedAt:now});
  r.evidence.validation.verifiedAt=now;
  r.evidence.validation.responseHash=hash([job.rto,fuelGroup,vehicleCategory,rows]);
  return r;
 }));
 const rows=reports.flatMap(r=>buildRankedStockSnapshotRows({...job,sourceRows:r.rows,fuelGroup:r.fuelGroup,vehicleCategory:r.vehicleCategory,metadata:{scrapeRunId:job.runId,scrapedAt:r.scrapedAt,source:r.source}}));
 return {reports,rows};
}
try{
 await admin.query(`create schema ${schema}`);created=true;
 url.searchParams.set('options',`-c search_path=${schema}`);
 process.env.DATABASE_URL=url.toString();process.env.PGSSL='false';
 await query(await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 assert.equal((await query('select current_schema() as schema')).rows[0].schema,schema);
 checked('isolated local schema with production schema applied');
 await upsertRtoDailyConfigs(Array.from({length:100},(_,i)=>({state,rto:`QA RTO ${String(i+1).padStart(3,'0')}`,enabled:true,priority:i+1})));
 const run=await ensureRtoDailyCycle({snapshotDate:day,targetMonth:month,state,workerCount:2});
 const cohort=(await query('select count(*)::int as n from rto_daily_run_cohort_members where run_id=$1',[run.id])).rows[0].n;
 assert.equal(cohort,100);checked('frozen intended cohort of 100');
 const [left,right]=await Promise.all([claimRtoDailyJob({runId:run.id,workerId:'qa-left'}),claimRtoDailyJob({runId:run.id,workerId:'qa-right'})]);
 assert.notEqual(left.id,right.id);checked('concurrent claims never duplicate a job');
 for(const job of [left,right])await completeRtoDailyJob({job,workerId:job.workerId,...sourceRows(job)});
 for(let i=2;i<99;i++){
  const job=await claimRtoDailyJob({runId:run.id,workerId:'qa-fill'});
  await completeRtoDailyJob({job,workerId:job.workerId,...sourceRows(job)});
 }
 assert.equal((await getRtoReportReadiness({runId:run.id})).eligible,false);checked('99-RTO coverage rejected');
 const final=await claimRtoDailyJob({runId:run.id,workerId:'qa-final'});
 const bad=sourceRows(final);bad.rows[0].vehicleCount++;
 await assert.rejects(()=>completeRtoDailyJob({job:final,workerId:final.workerId,...bad}),/reconcile/);
 assert.equal((await query('select count(*)::int as n from rto_daily_scrape_reports where job_id=$1',[final.id])).rows[0].n,0);
 checked('OEM mismatch rejected atomically without headline writes');
 await completeRtoDailyJob({job:final,workerId:final.workerId,...sourceRows(final)});
 await finalizeRtoDailyCycle(run.id);
 let readiness=await getRtoReportReadiness({runId:run.id});
 assert.equal(readiness.eligible,true);assert.equal(readiness.completeRtos,100);assert.equal(readiness.dailyRegistrationEligible,false);assert.equal(readiness.dailyRegistrationCoverage,0);
 checked('100 successful stock RTOs remain zero registration coverage');
 // Deliberate local same-day rerun exercises persisted maker replacement and retry history.
 await query("update rto_daily_jobs set status='queued',worker_id=null,completed_at=null,next_attempt_at=now() where id=$1",[left.id]);
 const retry1=await claimRtoDailyJob({runId:run.id,workerId:'qa-retry1'});
 await failRtoDailyJob({jobId:retry1.id,workerId:retry1.workerId,error:'QA temporary upstream failure',maxAttempts:5});
 await query('update rto_daily_jobs set next_attempt_at=now() where id=$1',[retry1.id]);
 const retry2=await claimRtoDailyJob({runId:run.id,workerId:'qa-retry2'});
 await assert.rejects(()=>completeRtoDailyJob({job:retry1,workerId:retry1.workerId,...sourceRows(retry1)}),/no longer owns/);
 await completeRtoDailyJob({job:retry2,workerId:retry2.workerId,...sourceRows(retry2,true)});
 const retryStored=(await query('select metadata from rto_daily_jobs where id=$1',[retry2.id])).rows[0];
 assert.equal(retryStored.metadata.attemptErrors.length,1);
 assert.equal((await query("select count(*)::int as n from rto_daily_snapshots where rto=$1 and oem='Maker 5'",[left.rto])).rows[0].n,0);
 assert.equal((await query('select count(*)::int as n from rto_daily_snapshots where rto=$1',[left.rto])).rows[0].n,30);
 assert.equal((await query('select count(*)::int as n from rto_daily_snapshots')).rows[0].n,3000);
 checked('retry retains failure history, rejects stale owner and replaces only current OEM members');
 const invariant=(await query(`select count(*)::int as headlines,count(distinct state||'|'||rto)::int as scopes,
 count(*) filter(where snapshot_date<>$1::date)::int as mixed_dates,
 count(*) filter(where source_row_count<>(select count(*) from rto_daily_snapshots s where s.report_id=h.id))::int as oem_mismatches
 from rto_daily_scrape_reports h`,[day])).rows[0];
 assert.deepEqual(invariant,{headlines:600,scopes:100,mixed_dates:0,oem_mismatches:0});
 assert.equal((await query('select count(*)::int as n from (select state,rto,fuel_group,vehicle_category,oem,count(*) from rto_daily_snapshots group by 1,2,3,4,5 having count(*)>1) x')).rows[0].n,0);
 checked('600 exact headline parents, 3000 OEMs, no duplicate or mixed-date rows');
 const rawBefore=hash((await query('select * from rto_daily_scrape_reports order by id')).rows);
 const first=await reconcileRtoReportsForRun({runId:run.id});
 const batch=first.batches.find(b=>b.batch.cadence==='daily').batch;
 assert.equal(batch.reportCount,100);
 const generated=(await query('select period_ev,period_ice,cohort_rank,ev_share,payload from rto_reports where batch_id=$1',[batch.id])).rows;
 assert.equal(generated.length,100);
 assert.ok(generated.every(r=>r.period_ev===null&&r.period_ice===null&&r.cohort_rank===null&&r.ev_share===null&&r.payload.dailyRegistration.baselineEligible===false));
 checked('generated Daily reports quarantine all 100 stock records');
 const second=await reconcileRtoReportsForRun({runId:run.id});
 assert.ok(second.batches.every(b=>!b.generated&&b.reason==='unchanged'));
 assert.deepEqual(second.batches.map(b=>b.batch.revision),first.batches.map(b=>b.batch.revision));
 assert.equal(hash((await query('select * from rto_daily_scrape_reports order by id')).rows),rawBefore);
 checked('second regeneration is unchanged and raw collection evidence is preserved');
 const summaries=await listRtoReportsForBatch(batch.id,{limit:100});
 const reportId=summaries[0].id;
 // Mimic old saved payload, including a corrupted conflicting cadence/date.
 await query(`update rto_reports set status='ready',period_ev=123,period_ice=456,cohort_rank=12,ev_share=55,
 payload=jsonb_set(jsonb_set(payload,'{cadence}','"weekly"'),'{period,end}','"2020-01-01"') where id=$1`,[reportId]);
 const listed=await listRtoReportsForBatch(batch.id,{status:'needs_review',limit:100});
 assert.equal(listed.length,100);
 const selected=listed.find(r=>r.id===reportId);assert.equal(selected.periodEv,null);assert.equal(selected.periodEnd,day);assert.equal(selected.cadence,'daily');
 assert.equal((await listRtoReportsForBatch(batch.id,{status:'ready'})).length,0);
 assert.equal((await listRtoReportsForBatch(batch.id,{status:'ready_with_warnings'})).length,0);
 const detail=await getRtoReport(reportId);assert.equal(detail.periodEv,null);assert.equal(detail.dailyRegistration.date,day);assert.equal(detail.cohortRank,null);
 assert.equal((await getRtoReportBatch(batch.id)).status,'needs_review');
 assert.equal((await listRtoReportBatches({cadence:'daily',status:'ready'})).length,0);
 assert.equal((await listRtoReportBatches({cadence:'daily',status:'needs_review'})).length,1);
 checked('saved legacy values and contradictory payload cannot bypass API readers/status filters');
 const csv=renderRtoReportCsv(detail),html=renderRtoReportHtml(detail),allCsv=await renderRtoReportBatchCsv(batch.id);
 assert.match(csv,/unavailable/);assert.match(html,/Daily registrations unavailable/);assert.match(allCsv.content,/unavailable/);
 assert.doesNotMatch(csv,/,123,|,456,|,55,/);assert.doesNotMatch(html,/>123<|>456<|>55</);
 assert.equal(allCsv.content.trim().split('\n').length,501);
 checked('report CSV/HTML and 100-RTO batch CSV expose unavailable values only');
 console.log(`Daily RTO isolated integration: ${checks} checks passed; schema ${schema}.`);
}finally{
 await closePool();
 if(created)await admin.query(`drop schema ${schema} cascade`);
 await admin.end();
}
