import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {metadata} from './fixtures/e-dashboard.mjs';
const {chromium}=await import(process.env.COMPARISON_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.COMPARISON_PLAYWRIGHT_MODULE).href : 'playwright');

// Isolated fixture server: this suite cannot contact VAHAN or the production API.
const root=path.resolve('public'), out=path.resolve('output/playwright/comparison-qa');
const requests=[], checks=[], errors=[];
const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
function payload(query='',filters=null){
  const right=/2026|right|Delhi/i.test(query),year=right?2026:2025;
  let trend=[0,100,200,300].map((count,i)=>({month:`${year}-${String(i+1).padStart(2,'0')}`,count:right?count*2:count}));
  if(/gap/i.test(query))trend=trend.filter((_,i)=>i!==1);
  if(/zero/i.test(query))trend=trend.map(item=>({...item,count:0}));
  if(/invalid/i.test(query))trend=[{month:`${year}-01`,count:null},{month:`${year}-02`,count:'bad'},{month:`${year}-03`,count:0}];
  const missing=/missing/i.test(query); if(missing)trend=[];
  const total=trend.reduce((sum,item)=>sum+(typeof item.count==='number'?item.count:0),0);
  return {filters:filters??{state:right?'Delhi':'Maharashtra',from:`${year}-01`,to:`${year}-04`},dataStatus:missing?'missing':/partial|gap/i.test(query)?'partial':/pending/i.test(query)?'refreshing':'complete',summary:{total,monthlyAverage:total/4,peakMonth:trend.at(-1)?.month},trend,rows:trend.map(item=>({year,month:Number(item.month.slice(-2)),vehicle_count:item.count})),fuelBreakdown:[{fuelType:'PETROL',count:total}],warnings:[],scraper:{failedRuns:[]},liveRefresh:/pending/i.test(query)?{status:'pending',jobId:/failure/i.test(query)?'failure':'success',requiredMonths:[`${year}-04`]}:null};
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  const json=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
  if(url.pathname==='/api/query'){
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
    if(/slow/.test(body.query??''))await delay(650);
    if(/error/.test(body.query??''))return json({error:'Fixture source failed <unsafe>'},503);
    return json(payload(body.query??body.filters?.state,body.filters));
  }
  if(url.pathname.startsWith('/api/query-refresh/')){
    if(url.pathname.endsWith('/failure'))return json({error:'Fixture refresh failed'},503);
    await delay(250);const body=payload('refreshed 2025');body.summary.total=999;body.trend[3].count=699;return json(body);
  }
  if(url.pathname==='/api/metadata/query-filters')return json(metadata);
  if(url.pathname==='/api/metadata/rtos')return json({rtos:['PUNE - MH12','NOIDA - UP16']});
  if(url.pathname==='/api/me')return json({user:null});
  if(url.pathname.startsWith('/api/'))return json({error:'Unexpected fixture endpoint'},404);
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/compare.html':url.pathname));
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{const data=await fs.readFile(file);res.writeHead(200,{'content-type':{'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.ttf':'font/ttf'}[path.extname(file)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404).end();}
});
await fs.mkdir(out,{recursive:true});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.COMPARISON_BROWSER_CHANNEL?{channel:process.env.COMPARISON_BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
const ready=()=>page.waitForFunction(()=>!document.querySelector('#compareBtn').disabled);
async function compare(left,right){await page.locator('#leftQuery').fill(left);await page.locator('#rightQuery').fill(right);await page.locator('#compareBtn').click();await ready();}
async function check(name,fn){try{await fn();checks.push({name,status:'PASS'});}catch(error){checks.push({name,status:'FAIL',error:error.message});}}
try{
  await page.goto(`${base}/compare.html`,{waitUntil:'networkidle'});await ready();
  await check('Form submission, totals, delta and grouped month alignment',async()=>{
    await compare('left 2025','right 2026');assert.equal(await page.locator('#leftTotal').innerText(),'600');assert.equal(await page.locator('#rightTotal').innerText(),'1,200');assert.match(await page.locator('#deltaSummary').innerText(),/600/);
    assert.equal(await page.locator('#barChartMode').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#doubleBarChart svg').count(),1);
    assert.ok(await page.locator('#doubleBarChart svg text').allTextContents().then(texts=>texts.some(text=>/Jan/.test(text))));
    assert.match(await page.locator('.comparison-note').innerText(),/Calendar months aligned across years/);
    assert.equal(await page.locator('.comparison-month').count(),12);
    await page.locator('.comparison-month').nth(1).focus();await page.keyboard.press('Enter');assert.match(await page.locator('.comparison-detail').innerText(),/A: 100 · B: 200 · Difference \(B − A\): \+100/);
  });
  await check('Line toggle is keyboard operable, retained and does not issue requests',async()=>{
    const count=requests.length;await page.locator('#lineChartMode').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#lineChartMode').getAttribute('aria-pressed'),'true');assert.equal(requests.length,count);
    assert.equal(await page.locator('#doubleBarChart svg polyline').count(),2);await page.screenshot({path:path.join(out,'line-desktop.png'),fullPage:true});
    await compare('left 2025','right 2026');assert.equal(await page.locator('#lineChartMode').getAttribute('aria-pressed'),'true');
  });
  await check('Swap exchanges scopes, values, queries and gap direction',async()=>{
    await page.locator('#swapQueries').click();await ready();assert.equal(await page.locator('#leftQuery').inputValue(),'right 2026');assert.equal(await page.locator('#leftTotal').innerText(),'1,200');assert.match(await page.locator('#deltaSummary').innerText(),/-600|−600/);
  });
  await check('True zero remains available; missing evidence is unavailable',async()=>{
    await compare('zero 2025','right 2026');assert.equal(await page.locator('#leftTotal').innerText(),'0');assert.match(await page.locator('#deltaSummary').innerText(),/n\/a|unavailable/i);
    await compare('missing 2025','right 2026');assert.match(await page.locator('#leftTotal').innerText(),/—/);assert.match(await page.locator('#deltaSummary').innerText(),/available|unavailable/i);
  });
  await check('Missing middle month breaks line; partial scope is labelled',async()=>{
    await compare('gap 2025','right 2026');assert.equal((await page.locator('#leftStatus').innerText()).toLowerCase(),'partial');assert.match(await page.locator('#chartPanel').innerText(),/partial|missing|unavailable/i);assert.equal(await page.locator('polyline.left').count(),1);assert.equal(await page.locator('circle.left').count(),3);await page.locator('.comparison-month').nth(1).focus();assert.match(await page.locator('.comparison-detail').innerText(),/A: Unavailable/);
  });
  await check('Date models retain same-year dates, multiple years, gaps and invalid values',async()=>{
    const model=await page.evaluate(()=>{
      const scope=(from,to,trend)=>({dataStatus:'complete',rows:[{}],filters:{from,to},trend});
      const simple=ComparisonChart.model(scope('2025-01','2025-01',[{month:'2025-01',count:0}]),scope('2025-02','2025-02',[{month:'2025-02',count:2}]));
      const multiple=ComparisonChart.model(scope('2024-12','2025-02',[{month:'2024-12',count:1},{month:'2025-02',count:2}]),scope('2026-01','2026-01',[{month:'2026-01',count:3}]));
      const invalid=ComparisonChart.model(scope('2025-01','2025-04',[{month:'2025-01',count:null},{month:'2025-02',count:'2'},{month:'2025-03',count:-1},{month:'2025-04',count:0}]),scope('2025-04','2025-04',[{month:'2025-04',count:2}]));
      return {simple:{aligned:simple.aligned,keys:simple.keys},multiple:{aligned:multiple.aligned,keys:multiple.keys},invalid:[...invalid.maps[0]]};
    });assert.deepEqual(model.simple,{aligned:false,keys:['2025-01','2025-02']});assert.equal(model.multiple.aligned,false);assert.equal(model.multiple.keys.length,14);assert.deepEqual(model.invalid,[['2025-04',0]]);
  });
  await check('Single observations render visible points, with invalid numbers omitted',async()=>{
    await page.evaluate(()=>{
      const data={dataStatus:'complete',rows:[{}],filters:{from:'2025-01',to:'2025-01'},trend:[{month:'2025-01',count:0},{month:'2025-02',count:null}]};
      ComparisonChart.setMode('line');ComparisonChart.render(data,{...data,trend:[{month:'2025-01',count:5}]},'A single','B single');
    });assert.equal(await page.locator('.comparison-mark').count(),2);assert.equal(await page.locator('.comparison-series').count(),0);assert.doesNotMatch(await page.locator('#doubleBarChart').innerHTML(),/NaN|Infinity/);await page.locator('.comparison-month').focus();assert.match(await page.locator('.comparison-detail').innerText(),/A: 0 · B: 5/);
  });
  await check('HTTP errors are escaped and Compare recovers',async()=>{
    await compare('error 2025','right 2026');assert.match(await page.locator('#deltaSummary').innerText(),/Fixture source failed <unsafe>/);assert.equal(await page.locator('unsafe').count(),0);await page.locator('#barChartMode').click();assert.equal(await page.locator('#doubleBarChart svg').count(),0);await page.locator('#lineChartMode').click();await compare('left 2025','right 2026');assert.equal(await page.locator('#leftTotal').innerText(),'600');
  });
  await check('Modes preserve edited queries and unlock abandoned loading runs',async()=>{
    await page.locator('#leftQuery').fill('slow left 2025');await page.locator('#compareBtn').click();await page.locator('#barChartMode').click();assert.equal(await page.locator('#doubleBarChart svg').count(),0);await page.locator('#locationMode').click();assert.equal(await page.locator('#locationMode').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#leftQuery').inputValue(),'slow left 2025');assert.equal(await page.locator('#compareBtn').isEnabled(),true);await delay(750);assert.match(await page.locator('#leftTotal').innerText(),/-|—/);await page.locator('#monthMode').click();
  });
  await check('Successful refresh retains cached values then atomically replaces',async()=>{
    await compare('pending left 2025','right 2026');assert.equal(await page.locator('#leftTotal').innerText(),'600');await page.waitForFunction(()=>document.querySelector('#leftTotal').textContent==='999');assert.notEqual(await page.locator('#leftStatus').innerText(),'Refreshing');
  });
  await check('Refresh failure preserves values and labels stale evidence',async()=>{
    await compare('pending failure 2025','right 2026');await page.waitForFunction(()=>document.querySelector('#leftStatus').textContent==='Stale',null,{timeout:8000});assert.equal(await page.locator('#leftTotal').innerText(),'600');assert.match(await page.locator('#leftWarnings').innerText(),/fail|saved/i);
  });
  await check('Old refresh cannot overwrite a new submitted comparison',async()=>{
    await compare('pending left 2025','right 2026');await compare('zero 2025','right 2026');await delay(3100);assert.equal(await page.locator('#leftTotal').innerText(),'0');assert.equal(await page.locator('#leftQueryLabel').innerText(),'zero 2025');
  });
  await check('Filter editor cancel makes no request; apply sends structured scope',async()=>{
    await compare('left 2025','right 2026');let count=requests.length;await page.getByRole('button',{name:'Edit left filters',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(requests.length,count);
    await page.getByRole('button',{name:'Edit left filters',exact:true}).click();await page.getByRole('combobox',{name:'State',exact:true}).selectOption('Delhi');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});assert.ok(requests.slice(count).some(body=>body.filters?.state==='Delhi'));
    await page.getByRole('button',{name:'Edit left filters',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'State',exact:true}).inputValue(),'Delhi');await page.getByRole('button',{name:'Cancel',exact:true}).click();
    count=requests.length;await page.locator('#swapQueries').click();await ready();assert.equal(requests.slice(count).at(-1).filters.state,'Delhi');
    await page.getByRole('button',{name:'Edit right filters',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'State',exact:true}).inputValue(),'Delhi');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  });
  await check('Desktop/tablet/mobile overflow, colored result series and screenshots',async()=>{
    await compare('left 2025','right 2026');await page.locator('#barChartMode').click();
    assert.notEqual(await page.locator('#leftTrend .bar-fill').first().evaluate(el=>getComputedStyle(el).backgroundColor),await page.locator('#rightTrend .bar-fill').first().evaluate(el=>getComputedStyle(el).backgroundColor));
    for(const width of [1440,1024,390,320]){await page.setViewportSize({width,height:900});await delay(80);const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1,`Overflow at ${width}: ${size.scroll}`);await page.screenshot({path:path.join(out,`bars-${width}.png`),fullPage:true});}
  });
  await check('No browser runtime errors',async()=>assert.deepEqual(errors,[]));
}finally{
  await fs.writeFile(path.join(out,'assessment.json'),JSON.stringify({status:checks.every(c=>c.status==='PASS')?'PASS':'FAIL',checks,requests:requests.length,errors},null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify(checks,null,2));
if(checks.some(check=>check.status==='FAIL'))process.exitCode=1;
