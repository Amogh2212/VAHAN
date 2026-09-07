import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import {createFixtureServer, fixture} from './fixtures/e-dashboard.mjs';
import {buildMonthlySalesReport,renderMonthlySalesReportHtml} from '../lib/monthly-sales-report.mjs';
import {renderRtoReportHtml} from '../lib/rto-reports.mjs';

const server=createFixtureServer();
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const out='output/playwright/e-redesign'; await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
const screenshot = (page,options) => process.env.E_UI_SCREENSHOTS === '0' ? Promise.resolve() : page.screenshot(options);
const monthly=buildMonthlySalesReport({rows:fixture.rows.map(r=>({...r,vehicle_category_filter:'ALL'})),month:'2024-12',expectedStates:['Maharashtra'],sourceLabel:'Isolated design fixture'});
try{
  const page=await browser.newPage({viewport:{width:1536,height:1024}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator('#queryInput').fill('Two wheeler registrations in Maharashtra in 2024');
  await page.getByRole('button',{name:'Run query',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#total').textContent==='20,51,429');
  assert.equal(await page.locator('.monthly-summary tbody tr:visible').count(),3);
  await page.getByRole('button',{name:'View all months',exact:true}).click();
  assert.equal(await page.locator('.monthly-summary tbody tr:visible').count(),12);
  await page.getByRole('button',{name:'Show fewer months',exact:true}).click();
  await page.getByRole('button',{name:'Show fuel mix for Nov 2024',exact:true}).press('Enter');
  assert.match(await page.locator('#fuelMixSelection').innerText(),/Nov 2024/);
  await page.getByRole('button',{name:'All months',exact:true}).click();
  await screenshot(page,{path:`${out}/overview-desktop.png`,fullPage:true});
  const initialRequests=(await (await fetch(`${base}/__requests`)).json()).length;
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByRole('combobox',{name:'State',exact:true}).selectOption('Uttar Pradesh');
  await page.getByRole('combobox',{name:'RTO',exact:true}).selectOption('NOIDA - UP16');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal((await (await fetch(`${base}/__requests`)).json()).length,initialRequests);
  assert.match(await page.locator('#scopeSummary').innerText(),/Maharashtra/);
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByRole('combobox',{name:'State',exact:true}).selectOption('Uttar Pradesh');
  await page.getByRole('combobox',{name:'RTO',exact:true}).selectOption('NOIDA - UP16');
  await page.getByRole('combobox',{name:'State',exact:true}).selectOption('Maharashtra');
  await page.waitForFunction(()=>!document.querySelector('[name=rto]').disabled);
  assert.equal(await page.locator('[name=rto]').inputValue(),'');
  await page.getByRole('button',{name:'Clear selections',exact:true}).click();
  await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  await page.locator('dialog').waitFor({state:'detached'});
  const submitted=(await (await fetch(`${base}/__requests`)).json()).at(-1);
  assert.deepEqual(submitted.filters.selectedVehicleCategories,[]);assert.equal(submitted.filters.rto,null);
  assert.ok(!('query' in submitted));
  // A failed replacement preserves the previous answer and its export scope.
  const heading=await page.locator('#answerHeading').innerText();
  await page.locator('#queryInput').fill('failed fixture');await page.getByRole('button',{name:'Run query',exact:true}).click();
  await page.getByText('Fixture: source unavailable. Try again later.',{exact:true}).waitFor();
  assert.equal(await page.locator('#answerHeading').innerText(),heading);
  assert.equal(await page.locator('#downloadCsvBtn').isEnabled(),true);
  await page.locator('#queryInput').fill('missing fixture');await page.getByRole('button',{name:'Run query',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#sourceStatusPill').textContent==='Missing');
  assert.match(await page.locator('#total').innerText(),/—|--/);assert.equal(await page.locator('#downloadCsvBtn').isEnabled(),false);
  await page.locator('#queryInput').fill('Two wheeler registrations in Maharashtra in 2024');await page.getByRole('button',{name:'Run query',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#total').textContent==='20,51,429');
  await page.getByRole('button',{name:'Export current answer',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Download CSV',exact:true}).click();
  const download=await downloadPromise;await download.saveAs(`${out}/dashboard.csv`);
  assert.match(await fs.readFile(`${out}/dashboard.csv`,'utf8'),/2051429/);
  await page.getByRole('button',{name:'Export current answer',exact:true}).press('Escape');
  assert.equal(await page.getByRole('menuitem',{name:'Download CSV',exact:true}).isVisible(),false);
  for(const width of [1536,1024,390]){
    await page.setViewportSize({width,height:width===390?844:1024});
    await page.waitForTimeout(150);
    const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    results.push({route:'overview',width,...dimensions});
    if(width===390){
      await screenshot(page,{path:`${out}/overview-mobile.png`,fullPage:true});
      await page.getByRole('button',{name:'Filters',exact:true}).click();
      await page.getByRole('button',{name:'Apply filters',exact:true}).waitFor();
      await screenshot(page,{path:`${out}/filters-mobile.png`,fullPage:true});
      await page.getByRole('button',{name:'Cancel',exact:true}).press('Escape');
      assert.equal(await page.locator('#openFilters').evaluate(el=>el===document.activeElement),true);
    }
  }
  for(const route of ['compare.html','map.html','rto-trends.html','rto-reports.html','rto-insights.html','account.html','reports/monthly-sales.html']){
    await page.setViewportSize({width:1536,height:1024});await page.goto(`${base}/${route}`,{waitUntil:'networkidle'});
    if(route === 'compare.html'){
      assert.ok(await page.locator('#leftTrend .bar-fill').first().evaluate(el=>el.getBoundingClientRect().width > 0));
      await page.getByRole('button',{name:'Edit left filters',exact:true}).click();
      await page.getByRole('button',{name:'Clear selections',exact:true}).click();
      await page.getByRole('combobox',{name:'Fuel family',exact:true}).selectOption('NON_EV');
      await page.getByRole('button',{name:'Apply filters',exact:true}).click();
      await page.locator('dialog').waitFor({state:'detached'});
      assert.match(await page.locator('#leftQueryLabel').innerText(),/Non-EV/);
      const requests=(await (await fetch(`${base}/__requests`)).json()).slice(-2);
      assert.equal(requests[0].filters.fuelSegment,'NON_EV');
      await page.getByRole('button',{name:'Edit left filters',exact:true}).click();
      assert.equal(await page.getByRole('combobox',{name:'Fuel family',exact:true}).inputValue(),'NON_EV');
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
    }
    if(route === 'rto-trends.html'){
      const lookup=page.getByRole('combobox',{name:'Search official RTO',exact:true});
      await lookup.fill('Noida');
      await page.getByRole('option',{name:/NOIDA/}).waitFor();
      await lookup.press('ArrowDown');await lookup.press('Enter');
      await page.getByRole('heading',{name:'NOIDA - UP16 daily trend',exact:true}).waitFor();
      await page.waitForTimeout(250);
      assert.equal(await lookup.getAttribute('aria-expanded'),'false');
      assert.equal(await page.getByRole('button',{name:'Sign in to pin',exact:true}).isVisible(),true);
    }
    for(const width of [1536,1024,390]){
      await page.setViewportSize({width,height:width===390?844:1024});
    await page.waitForTimeout(150);
      results.push({route,width,...await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}))});
      if(width!==1024)await screenshot(page,{path:`${out}/${route.replaceAll('/','-').replace('.html','')}-${width}.png`,fullPage:true});
    }
  }
  await page.route('**/api/me',route=>route.fulfill({json:{authenticated:true,user:{id:1,name:'Design reviewer',email:'review@example.test',role:'user'},csrfToken:'fixture'}}));
  await page.route('**/api/reports/monthly-sales?*',route=>route.fulfill({json:monthly}));
  await page.setViewportSize({width:1536,height:1024});await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('.monthly-report-oem-group tbody tr').first().locator('td').nth(1).innerText(),'—');
  await screenshot(page,{path:`${out}/monthly-report-populated.png`,fullPage:true});
  results.push({route:'monthly-populated',width:1536,...await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}))});
  await page.setViewportSize({width:390,height:844});
  results.push({route:'monthly-populated',width:390,...await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}))});
  await screenshot(page,{path:`${out}/monthly-populated-mobile.png`,fullPage:true});
  const overflows=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).filter(el=>!el.closest('.monthly-report-line-wrap,.monthly-report-trend-table-wrap,.monthly-report-table-wrap')).slice(0,20).map(el=>({tag:el.tagName,cls:el.className,width:el.getBoundingClientRect().width})));
  if(results.at(-1).document>390) console.log({overflows});
  await page.setContent(renderMonthlySalesReportHtml(monthly),{waitUntil:'load'});
  assert.equal(await page.locator('.report-oem-group tbody tr').first().locator('td').nth(1).innerText(),'—');
  await page.pdf({path:`${out}/monthly-report.pdf`,format:'A4',printBackground:true});
  await screenshot(page,{path:`${out}/monthly-print.png`,fullPage:true});
  const reportHtml=renderRtoReportHtml({rto:{name:'Noida RTO — design fixture',state:'Uttar Pradesh',cohortRank:1},cadence:'daily',status:'ready_with_warnings',period:{label:'31 December 2024'},summary:'Isolated design fixture. Values demonstrate layout only.',generatedAt:'2024-12-31T12:00:00Z',metrics:{period:{ev:27,ice:150,evShare:27/177*100}},quality:{warnings:['Sample data for print review.']},trend:[{date:'2024-12-29',ev:20,ice:120},{date:'2024-12-30',ev:22,ice:140},{date:'2024-12-31',ev:27,ice:150}],categories:[],oems:[]});
  await page.setContent(reportHtml,{waitUntil:'load'});
  await page.pdf({path:`${out}/rto-report.pdf`,format:'A4',printBackground:true});
  await fs.writeFile(`${out}/checks.json`,JSON.stringify({results,errors},null,2));
  assert.deepEqual(errors,[]);
  assert.deepEqual(results.filter(r=>r.document>r.viewport+1),[], 'No route should overflow the page horizontally.');
  console.log('E UI checks passed: eight routes at three widths, staged filters, month selection, missing/error states, exports and report rendering.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
