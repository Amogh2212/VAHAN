/* Shared-scale charts. Missing observations are deliberately never zero-filled. */
window.ComparisonChart = (() => {
  const number = new Intl.NumberFormat('en-IN');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  let saved = null;
  let mode = 'bar';
  const available = data => !['missing','fetch_failed'].includes(data.dataStatus) && !(data.dataStatus === 'refreshing' && !data.rows?.length);
  function observations(data) {
    return available(data) ? (data.trend ?? []).filter(item => /^\d{4}-(0[1-9]|1[0-2])$/.test(item.month) && Number.isFinite(item.count) && item.count >= 0) : [];
  }
  function model(left, right) {
    const trends = [observations(left), observations(right)];
    const years = trends.map((items, side) => [...new Set([...items.map(item => item.month.slice(0,4)), ...[ [left,right][side].filters?.from, [left,right][side].filters?.to ].filter(value => /^\d{4}-\d{2}$/.test(value ?? '')).map(value => value.slice(0,4))])]);
    const aligned = years.every(items => items.length === 1) && years[0][0] !== years[1][0];
    const maps = trends.map(items => new Map(items.map(item => [aligned ? item.month.slice(5) : item.month, item.count])));
    let keys;
    if (aligned) keys = months.map((_,index) => String(index+1).padStart(2,'0'));
    else {
      keys = [...new Set(trends.flatMap(items => items.map(item => item.month)))].sort();
      if (keys.length) {
        const start = Number(keys[0].slice(0,4))*12 + Number(keys[0].slice(5))-1;
        const end = Number(keys.at(-1).slice(0,4))*12 + Number(keys.at(-1).slice(5))-1;
        keys = Array.from({length:Math.min(600,end-start+1)},(_,i) => `${Math.floor((start+i)/12)}-${String((start+i)%12+1).padStart(2,'0')}`);
      }
    }
    return {aligned,years,maps,keys};
  }
  function clear() { saved = null; }
  function render(left, right, leftQuery, rightQuery) {
    saved = [left,right,leftQuery,rightQuery];
    const target = document.querySelector('#doubleBarChart');
    const {aligned,years,maps,keys} = model(left,right);
    if (!keys.length) { target.innerHTML = '<p class="compare-empty">No monthly comparison data is available for these queries.</p>'; return; }
    const labels = [leftQuery || 'Left query',rightQuery || 'Right query'];
    const max = Math.max(1,...maps.flatMap(map => [...map.values()]));
    const ceiling = Math.ceil(max / 4 / (10 ** Math.floor(Math.log10(max/4)))) * (10 ** Math.floor(Math.log10(max/4))) * 4;
    const width = Math.max(760,keys.length * 54 + 90), height = 330;
    const x0 = 70, y0 = 26, bottom = 270, step = (width-x0-20)/keys.length;
    const x = i => x0+step*(i+.5), y = value => bottom-value/ceiling*(bottom-y0);
    const monthLabel = key => aligned ? months[Number(key)-1] : `${months[Number(key.slice(5))-1]} ${key.slice(0,4)}`;
    const valueText = value => value === undefined ? 'Unavailable' : number.format(value);
    const rows = keys.map(key => {
      const a = maps[0].get(key), b = maps[1].get(key);
      const dates = aligned ? `A: ${years[0][0]}-${key}; B: ${years[1][0]}-${key}` : key;
      const gap = a === undefined || b === undefined ? 'Unavailable' : `${b-a>0?'+':''}${number.format(b-a)}`;
      return {key,a,b,gap,label:monthLabel(key),detail:`${dates} · A: ${valueText(a)} · B: ${valueText(b)} · Difference (B − A): ${gap}`};
    });
    let svg = Array.from({length:5},(_,i) => {
      const value=ceiling*i/4, pos=y(value);
      return `<line class="comparison-grid" x1="${x0}" x2="${width-20}" y1="${pos}" y2="${pos}"/><text class="comparison-axis" x="${x0-10}" y="${pos+4}" text-anchor="end">${number.format(value)}</text>`;
    }).join('');
    if (mode === 'line') maps.forEach((map,side) => {
      let segment=[];
      const flush=()=> { if(segment.length>1) svg+=`<polyline class="comparison-series ${side ? 'right':'left'}" points="${segment.join(' ')}"/>`; segment=[]; };
      keys.forEach((key,i) => { const value=map.get(key); if(value === undefined) flush(); else segment.push(`${x(i)},${y(value)}`); }); flush();
    });
    rows.forEach((row,i) => {
      svg += `<g tabindex="0" role="button" class="comparison-month" aria-label="${escape(row.detail)}" data-detail="${escape(row.detail)}"><title>${escape(row.detail)}</title><rect class="comparison-hit" x="${x0+step*i}" y="${y0}" width="${step}" height="${bottom-y0+40}"/>`;
      [row.a,row.b].forEach((value,side) => {
        if(value === undefined) return;
        const color=side?'right':'left';
        if(mode === 'bar') { const barWidth=Math.min(17,step*.28); svg+=`<rect class="comparison-mark ${color}" x="${x(i)+(side?2:-barWidth-2)}" y="${y(value)}" width="${barWidth}" height="${Math.max(value===0?1:0,bottom-y(value))}" rx="2"/>`; }
        else svg+=`<circle class="comparison-mark ${color}" cx="${x(i)}" cy="${y(value)}" r="4"/>`;
      });
      svg+=`<text class="comparison-axis" x="${x(i)}" y="${bottom+25}" text-anchor="middle">${escape(row.label)}</text></g>`;
    });
    target.innerHTML = `<div class="comparison-legend"><span><i class="legend-swatch left"></i><strong>A${aligned?` · ${years[0][0]}`:''}</strong> ${escape(labels[0])}</span><span><i class="legend-swatch right"></i><strong>B${aligned?` · ${years[1][0]}`:''}</strong> ${escape(labels[1])}</span></div><p class="comparison-note">${aligned?'Calendar months aligned across years.':'Months shown on their actual dates.'} Missing observations are gaps. Partial months remain subject to each query’s source warnings.</p><div class="comparison-plot-scroll"><svg class="comparison-plot" viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="group" aria-label="${mode === 'bar'?'Grouped bar':'Two-line'} chart of monthly registrations"><text class="comparison-axis" x="${x0}" y="14">Registrations</text>${svg}</svg></div><p class="comparison-detail" aria-live="polite">Hover, focus or tap a month to compare its values.</p><details class="comparison-data"><summary>View monthly values and differences</summary><div class="comparison-table-scroll"><table><caption>Monthly comparison${aligned?` · A ${years[0][0]}, B ${years[1][0]}`:''}</caption><thead><tr><th scope="col">Month</th><th scope="col">A</th><th scope="col">B</th><th scope="col">Difference (B − A)</th></tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${escape(row.label)}</th><td>${valueText(row.a)}</td><td>${valueText(row.b)}</td><td>${row.gap}</td></tr>`).join('')}</tbody></table></div></details>`;
    const detail=target.querySelector('.comparison-detail');
    target.querySelectorAll('.comparison-month').forEach(item => {
      const show=()=> {detail.textContent=item.dataset.detail;};
      ['mouseenter','focus','click'].forEach(event=>item.addEventListener(event,show));
      item.addEventListener('keydown',event=> {if(['Enter',' '].includes(event.key)){event.preventDefault();show();}});
    });
  }
  function setMode(next) {
    mode=next;
    for(const kind of ['bar','line']) {const button=document.querySelector(`#${kind}ChartMode`);button.classList.toggle('active',mode===kind);button.setAttribute('aria-pressed',String(mode===kind));}
    if(saved) render(...saved);
  }
  return {render,clear,setMode,model};
})();
