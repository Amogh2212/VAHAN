/* Shared navigation and staged scope editor. No query runs on editor changes. */
(() => {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const header = document.querySelector('#systemHeader');
  const route = location.pathname === '/index.html' ? '/' : location.pathname;
  const link = (href, label) => `<a href="${href}"${route === href ? ' aria-current="page"' : ''}>${label}</a>`;
  if (header) {
    // Daily Trends and Local Insights remain implemented at their direct routes for a future RTO-product phase.
    // They are intentionally not exposed in the current navigation; do not classify them as dead code.
    header.innerHTML = `<a class="system-brand" href="/" aria-label="Vahan Analyst overview"><span class="system-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden="true"><path d="M6 6L11.5 6L15.5 19.5L13.5 25L9.5 25Z" fill="#182139"/><path d="M15 25L17.5 18.5L21.5 18.5L19 25Z" fill="#4f46b8"/><path d="M18.8 16.5L21.8 7.5L25.2 7.5L22.2 16.5Z" fill="#6f65ec"/><path d="M23 4.5L25.6 4.5C26.5 4.5 27 5.1 26.8 6L26.2 7.2L23.2 7.2Z" fill="#f27d52"/><path d="M16.5 16L18 11.5L19.5 16L18 15Z" fill="#f6bea5"/></svg></span>Vahan Analyst</a><button type="button" class="nav-toggle" aria-expanded="false" aria-controls="systemNav">Menu</button><nav id="systemNav" class="system-nav" aria-label="Main navigation">${link('/','Overview')}${link('/compare.html','Compare')}${link('/map.html','Map')}${link('/rto-reports.html','RTO reports')}${link('/reports/monthly-sales.html','Monthly sales')}<details class="system-account"><summary>Account ▾</summary><div class="system-menu">${link('/account.html','Account')}<a href="https://t.me/Vahan_bot" target="_blank" rel="noopener noreferrer">Telegram bot ↗</a>${link('/#queryInput','Ask Vahan')}</div></details></nav>`;
    const toggle = header.querySelector('.nav-toggle');
    toggle.addEventListener('click', () => toggle.setAttribute('aria-expanded', String(header.querySelector('nav').classList.toggle('is-open'))));
    header.querySelectorAll('details').forEach((menu) => menu.addEventListener('toggle', () => {
      if (menu.open) header.querySelectorAll('details').forEach((other) => { if (other !== menu) other.open = false; });
    }));
    document.addEventListener('click', (event) => { if (!header.contains(event.target)) header.querySelectorAll('details').forEach((m) => { m.open = false; }); });
    header.addEventListener('keydown', (event) => { if (event.key === 'Escape') { const menu = event.target.closest('details'); if (menu) { menu.open = false; menu.querySelector('summary').focus(); } else { toggle.setAttribute('aria-expanded','false'); header.querySelector('nav').classList.remove('is-open'); toggle.focus(); } } });
  }
  const fields = [
    ['selectedVehicleGroups','Vehicle group','vehicleGroups'],['selectedVehicleClasses','Vehicle classes','vehicleClasses'],['selectedVehicleCategories','Vehicle categories','vehicleCategories'],
    ['selectedFuelTypes','Fuel labels','fuelTypes'],['selectedNorms','Emission norms','norms'],
    ['excludedFuelTypes','Exclude fuel labels','fuelTypes'],['excludedVehicleClasses','Exclude vehicle classes','vehicleClasses'],['excludedVehicleCategories','Exclude categories','vehicleCategories'],['excludedNorms','Exclude norms','norms'],
  ];
  function editableScope(filters = {}) {
    const scope = Object.fromEntries(['state','rto','from','to','fuelSegment'].map((key) => [key, filters[key] ?? null]));
    for (const [key] of fields) scope[key] = [...(filters[key] ?? [])];
    if (!scope.selectedFuelTypes.length) scope.selectedFuelTypes = [...(filters.fuelFilters?.length ? filters.fuelFilters : filters.fuelType ? [filters.fuelType] : filters.fuelSegment === 'EV' ? ['ELECTRIC(BOV)','PURE EV'] : [])];
    if (scope.selectedFuelTypes.length) scope.fuelSegment = null;
    if (scope.selectedVehicleGroups.length) scope.selectedVehicleCategories = [];
    else if (!scope.selectedVehicleCategories.length) scope.selectedVehicleCategories = [...(filters.vehicleCategories ?? [])];
    if (!scope.selectedVehicleClasses.length) scope.selectedVehicleClasses = [...(filters.vehicleClasses ?? [])];
    if (!scope.selectedNorms.length) scope.selectedNorms = [...(filters.norms ?? [])];
    return scope;
  }
  function describeScope(filters = {}) {
    const scope = editableScope(filters);
    return [scope.fuelSegment === 'NON_EV' ? 'Non-EV fuels' : '', scope.state || 'All India', scope.rto && scope.rto !== 'ALL RTO' ? scope.rto : 'All RTOs', scope.from && scope.to ? `${scope.from} – ${scope.to}` : 'Choose months', ...fields.flatMap(([key,label]) => scope[key].length ? [`${label}: ${scope[key].join(', ')}`] : [])].filter(Boolean).join(' · ');
  }
  let metadataPromise;
  const json = async (url) => { const response = await fetch(url, {cache:'no-store'}); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load filter options. Close and reopen Filters to retry.'); return body; };
  const metadata = () => metadataPromise ??= json('/api/metadata/query-filters').catch((error) => { metadataPromise = null; throw error; });
  async function openFilters({filters = {}, onApply, title = 'Edit registration scope', section} = {}) {
    if (document.querySelector('.filter-sheet')) return;
    const opener = document.activeElement;
    const dialog = document.createElement('dialog'); dialog.className = 'filter-sheet'; dialog.setAttribute('aria-labelledby','filterTitle');
    dialog.innerHTML = `<form><header class="filter-header"><div><h2 id="filterTitle">${esc(title)}</h2><span class="panel-kicker">Changes apply together</span></div><button type="button" data-close aria-label="Close filters">✕</button></header><div class="filter-body"><p role="status">Loading filter options…</p></div><footer class="filter-footer"><button type="button" data-clear>Clear selections</button><div><button type="button" data-close>Cancel</button> <button type="submit" disabled>Apply filters</button></div></footer></form>`;
    document.body.append(dialog); dialog.showModal();
    dialog.addEventListener('close', () => { dialog.remove(); if (opener?.isConnected) opener.focus(); });
    dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
    let options, rtoRequest = 0;
    try { options = await metadata(); } catch (error) { dialog.querySelector('.filter-body').textContent = error.message; return; }
    if (!dialog.open) return;
    const scope = editableScope(filters);
    const month = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}).slice(0,7);
    scope.from ||= `${month.slice(0,4)}-01`; scope.to ||= month;
    const select = (name, label, values, all) => `<label>${label}<select name="${name}"><option value="">${all}</option>${[...new Set(values)].map((v) => `<option value="${esc(v)}"${scope[name] === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
    const multi = ([name,label,key]) => `<div class="filter-multi"><p class="filter-help" id="label-${name}">${label}</p><input class="filter-search" type="search" aria-label="Search ${label.toLowerCase()}" data-search="${name}" placeholder="Find ${label.toLowerCase()}"><div class="filter-options" role="group" aria-labelledby="label-${name}">${[...new Set([...options[key], ...scope[name]])].map((v) => `<label><input type="checkbox" name="${name}" value="${esc(v)}"${scope[name].includes(v)?' checked':''}>${esc(v)}</label>`).join('')}</div></div>`;
    dialog.querySelector('.filter-body').innerHTML = `<p class="filter-help">Leave selections empty for all values. Choose a broad vehicle group or exact classes and categories. Exclusions support one vehicle/category/norm dimension at a time.</p><p class="filter-error" role="alert" hidden></p><fieldset id="filter-geography"><legend>Geography & time</legend><div class="filter-fields">${select('state','State',options.states,'All India')}${select('rto','RTO',scope.rto ? [scope.rto] : [],'All RTOs')}<label>From month<input type="month" name="from" required max="${month}" value="${esc(scope.from)}"></label><label>To month<input type="month" name="to" required max="${month}" value="${esc(scope.to)}"></label></div><p class="filter-help" id="rtoNotice" role="status"></p></fieldset><fieldset id="filter-vehicle"><legend>Vehicle context</legend><div class="filter-fields">${fields.slice(0,3).map(multi).join('')}</div></fieldset><fieldset id="filter-fuel"><legend>Fuel & norms</legend><div class="filter-fields"><label>Fuel family<select name="fuelSegment"><option value="">All fuels / selected labels</option><option value="EV"${scope.fuelSegment === 'EV' ? ' selected' : ''}>Battery electric (BOV + Pure EV)</option><option value="NON_EV"${scope.fuelSegment === 'NON_EV' ? ' selected' : ''}>Non-EV fuels</option></select></label>${fields.slice(3,5).map(multi).join('')}</div></fieldset><fieldset><legend>Exclusions</legend><div class="filter-fields">${fields.slice(5).map(multi).join('')}</div></fieldset>`;
    const form = dialog.querySelector('form'), apply = form.querySelector('[type=submit]'), errorBox = form.querySelector('.filter-error');
    const showError = (message) => { errorBox.textContent = message; errorBox.hidden = !message; if (message) errorBox.scrollIntoView({block:'nearest'}); };
    const loadRtos = async (clear = false) => {
      const id = ++rtoRequest, rto = form.elements.rto, current = clear ? '' : rto.value;
      rto.disabled = true; apply.disabled = true;
      if (clear) form.querySelector('#rtoNotice').textContent = 'RTO selection cleared for the new state.';
      try {
        const result = await json(`/api/metadata/rtos?state=${encodeURIComponent(form.elements.state.value)}`);
        if (id !== rtoRequest || !dialog.open) return;
        rto.innerHTML = '<option value="">All RTOs</option>' + result.rtos.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        if (result.rtos.includes(current)) rto.value = current;
        else if (current && current !== 'ALL RTO') { const old = new Option(current,current,true,true); rto.add(old); }
        rto.disabled = false; apply.disabled = false;
      } catch (error) { if (id === rtoRequest) showError(error.message); }
    };
    form.elements.state.addEventListener('change', () => { showError(''); loadRtos(true); });
    form.querySelectorAll('[data-search]').forEach((search) => search.addEventListener('input', () => {
      search.nextElementSibling.querySelectorAll('label').forEach((label) => { label.hidden = !label.textContent.toLowerCase().includes(search.value.toLowerCase()); });
    }));
    form.querySelector('[data-clear]').addEventListener('click', () => { form.querySelectorAll('[type=checkbox]').forEach((c) => { c.checked = false; }); form.elements.state.value = ''; form.elements.fuelSegment.value = ''; showError(''); loadRtos(true); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (apply.disabled) return;
      const data = new FormData(form), draft = Object.fromEntries(['state','rto','from','to','fuelSegment'].map((k) => [k, data.get(k) || null]));
      for (const [key] of fields) draft[key] = data.getAll(key);
      if (draft.from > draft.to) { showError('The start month must be before or equal to the end month.'); return; }
      if (draft.selectedVehicleGroups.length && (draft.selectedVehicleClasses.length || draft.selectedVehicleCategories.length)) { showError('Choose a broad vehicle group or exact classes/categories, then apply again.'); return; }
      for (const [key] of fields.filter(([k]) => k.startsWith('excluded'))) if (draft[key].some((v) => draft[key.replace('excluded','selected')]?.includes(v))) { showError('The same value cannot be both included and excluded.'); return; }
      apply.disabled = true; apply.textContent = 'Applying…'; showError('');
      try { await onApply(draft); if (dialog.open) dialog.close(); } catch (error) { if (dialog.open) showError(error.message); } finally { apply.disabled = false; apply.textContent = 'Apply filters'; }
    });
    await loadRtos();
    if (section && dialog.open) dialog.querySelector(`#filter-${section}`)?.scrollIntoView({block:'start'});
  }
  window.VahanUI = { openFilters, editableScope, describeScope, escapeHtml:esc };
})();
