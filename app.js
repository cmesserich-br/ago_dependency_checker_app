(function(){
  const byId = (id)=>document.getElementById(id);
  const REST_PATH = "/sharing/rest";
  const isItemId = (s)=>/^[a-z0-9]{32}$/i.test(s||"");
  const DEBUG = new URLSearchParams(location.search).has('debug');
  const log = (...args)=>{ if(DEBUG) console.log('[depcheck]', ...args); };

  let cy = null;

  /* THEME */
  const THEME_KEY = 'depcheck_theme';
  const themeSel = byId('theme');
  function getSystemDark(){ return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
  function applyTheme(v){
    const root = document.documentElement;
    const val = v || localStorage.getItem(THEME_KEY) || 'auto';
    if(val==='auto'){ root.setAttribute('data-theme', getSystemDark() ? 'dark' : 'light'); }
    else { root.setAttribute('data-theme', val); }
    themeSel.value = val;
    applyGraphTheme();
  }
  themeSel.addEventListener('change', ()=>{ localStorage.setItem(THEME_KEY, themeSel.value); applyTheme(themeSel.value); });
  if(window.matchMedia){
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{
      if(localStorage.getItem(THEME_KEY)==='auto') applyTheme('auto');
    });
  }
  applyTheme('auto');

  function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function applyGraphTheme(){
    if(!cy || typeof cy.style !== 'function') return;
    const edge   = cssVar('--graph-edge');
    const border = cssVar('--graph-border');
    const label  = cssVar('--graph-label');
    cy.style()
      .selector('node').style({ 'border-color': border, 'color': label })
      .selector('edge').style({ 'line-color': edge, 'target-arrow-color': edge })
      .update();
  }

  /* AUTH */
  const auth = { token:null, expires:null };
  const authParams = ()=> auth.token ? { token: auth.token } : {};
  function setToken(token, expiresMs){
    auth.token = token || null;
    auth.expires = expiresMs || null;
    byId('token').value = token || '';
    byId('authStatus').textContent = token ? `Token set${expiresMs?` • expires soon`:''}` : 'Not signed in';
    hideAlert();
  }
  const ensurePortal = (b)=> (b?b:"https://www.arcgis.com").replace(/\/$/,"");

  /* ALERTS */
  function showAlert(msg, isError=false){
    const el = byId('alert');
    el.className = 'alert show' + (isError ? ' error' : '');
    el.innerHTML = msg || '';
    if(msg) el.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
  function hideAlert(){ const el = byId('alert'); el.className = 'alert'; el.innerHTML=''; }

  /* URL HELPERS */
  function normalizePortalFromHost(host){
    const h = (host||'').toLowerCase();
    if(/(^|\.)experience\.arcgis\.com$/.test(h)) return 'https://www.arcgis.com';
    if(/(^|\.)storymaps\.arcgis\.com$/.test(h))  return 'https://www.arcgis.com';
    return `https://${host}`;
  }
  function extractFromUrl(input){
    let itemId=null, portal=null;
    try{
      if(isItemId(input)) return { itemId: input, portal: null };
      const u = new URL(input.trim());
      const host = u.host.toLowerCase();
      portal = normalizePortalFromHost(host);
      const id = u.searchParams.get('id');
      if(id && isItemId(id)) return { itemId:id, portal };
      const parts = u.pathname.split('/').filter(Boolean);
      const storiesIdx = parts.indexOf('stories');
      if(storiesIdx>=0 && isItemId(parts[storiesIdx+1])) return { itemId: parts[storiesIdx+1], portal };
      const expIdx = parts.indexOf('experience');
      if(expIdx>=0 && isItemId(parts[expIdx+1])) return { itemId: parts[expIdx+1], portal };
      const dashIdx = parts.indexOf('dashboards');
      if(dashIdx>=0 && isItemId(parts[dashIdx+1])) return { itemId: parts[dashIdx+1], portal };
      const wabIdx = parts.indexOf('webappviewer');
      if(wabIdx>=0 && id && isItemId(id)) return { itemId:id, portal };
      return { itemId:null, portal };
    }catch{ return { itemId:null, portal:null }; }
  }

  async function jsonFetch(url, params={}){
    const qs = new URLSearchParams({ f:'json', ...params, ...authParams() });
    const full = `${url}?${qs}`;
    const r = await fetch(full);
    const ct = r.headers.get('content-type') || '';
    let data=null, text=null;
    try{ if(ct.includes('application/json')) data = await r.json(); else text = await r.text(); }catch{}
    const code = data?.error?.code;
    if(!r.ok || code===498 || code===499){
      const msg = data?.error?.message || `${r.status} ${r.statusText}`;
      const err = new Error(msg);
      err.authNeeded = (r.status===403 || code===498 || code===499 || /token required|not authorized|forbidden/i.test(err.message||''));      
      err.details = { status:r.status, code, url:full, body:text||data };
      throw err;
    }
    if(data?.error){
      const err = new Error(data.error.message || 'REST error');
      err.authNeeded = /token|authorized/i.test(err.message||'');
      err.details = { url:full, code:data.error.code, body:data };
      throw err;
    }
    if(!data){ const err = new Error('Unexpected non-JSON response'); err.details = { url:full, body:text }; throw err; }
    return data;
  }

  /* DEP PARSERS */
  const uniqArr = (arr)=>[...new Set(arr)];
  function depsFromWebMapData(j){
    const ids=[], urls=[];
    (j.operationalLayers||[]).forEach(ly=>{
      if(ly.itemId) ids.push(ly.itemId);
      if(ly.url) urls.push(ly.url);
      (ly.layers||[]).forEach(sl=>{ if(sl.itemId) ids.push(sl.itemId); });
      (ly.tables||[]).forEach(tb=>{ if(tb.itemId) ids.push(tb.itemId); });
    });
    return { itemIds: uniqArr(ids), urls: uniqArr(urls) };
  }
  function deepScan(obj, keys){
    const out=[], look = keys.map(k=>k.toLowerCase());
    (function walk(o){
      if(!o || typeof o!=='object') return;
      for(const k in o){
        const v=o[k];
        if(look.includes(k.toLowerCase())) out.push(v);
        if(v && typeof v==='object') walk(v);
      }
    })(obj);
    return out;
  }
  const depsFromDashboardData = (j)=>({ itemIds: uniqArr(deepScan(j,['itemId']).filter(s=>typeof s==='string')), urls: [] });
  function depsFromStoryData(raw, rootId){
    let j = raw; if(typeof j==='string'){ try{ j=JSON.parse(j); }catch{} }
    const ids=[], urls=[];
    const pushId=(val)=>{ if(typeof val==='string' && isItemId(val) && val!==rootId) ids.push(val); };
    const pushMaybeObjId=(val)=>{ if(val && typeof val==='object' && isItemId(val.id) && val.id!==rootId) ids.push(val.id); };
    deepScan(j, ['itemId','mapId','webmap','webscene']).forEach(v=>{ if(typeof v==='string') pushId(v); else pushMaybeObjId(v); });
    deepScan(j, ['url','href','serviceUrl','portalUrl']).forEach(v=>{
      if(typeof v==='string' && /^https?:\/\//.test(v)){ urls.push(v); const m=maybeExtractFromHref(v); if(m) pushId(m); }
    });
    const ds = j?.dataSources || j?.story?.dataSources;
    if(ds && typeof ds==='object'){
      Object.values(ds).forEach(d=>{
        if(d?.itemId) pushId(d.itemId);
        if(d?.webmap)  pushId(d.webmap);
        if(d?.webscene) pushId(d.webscene);
        if(d?.url){ urls.push(d.url); const m=maybeExtractFromHref(d.url); if(m) pushId(m); }
      });
    }
    return { itemIds: uniqArr(ids), urls: uniqArr(urls) };
  }
  function depsFromExpBuilderData(raw){
    let j = raw; if(typeof j==='string'){ try{ j=JSON.parse(j); }catch{} }
    const ids=[], urls=[];
    const ds = j?.dataSources || j?.appConfig?.dataSources || j?.config?.dataSources;
    if(ds && typeof ds==='object'){
      Object.values(ds).forEach(d=>{
        if(d?.itemId) ids.push(d.itemId);
        if(d?.sourceMapId) ids.push(d.sourceMapId);
        if(d?.url) urls.push(d.url);
        if(d?.type && /web_?map|web_?scene/i.test(String(d.type))){ if(d?.itemId) ids.push(d.itemId); }
      });
    }
    const mv = j?.appConfig?.mapViews;
    if(Array.isArray(mv)) mv.forEach(m=>{ if(m?.mapId) ids.push(m.mapId); });
    deepScan(j, ['itemId','mapId']).forEach(v=>{ if(typeof v==='string' && isItemId(v)) ids.push(v); else if(v && typeof v==='object' && isItemId(v.id)) ids.push(v.id); });
    deepScan(j, ['webmap','webscene']).forEach(v=>{ if(typeof v==='string' && isItemId(v)) ids.push(v); else if(v && typeof v==='object' && isItemId(v.id)) ids.push(v.id); });
    deepScan(j, ['url','serviceUrl','portalUrl']).forEach(v=>{ if(typeof v==='string' && /^https?:\/\//.test(v)) urls.push(v); });
    return { itemIds: uniqArr(ids), urls: uniqArr(urls) };
  }
  function maybeExtractFromHref(href){
    try{
      const u = new URL(href);
      const q = u.searchParams;
      const candidates = ['id','webmap','webscene','appid','storyid'];
      for(const k of candidates){
        const v = q.get(k); if(v && isItemId(v)) return v;
      }
      const parts = u.pathname.split('/').filter(Boolean);
      const patSegs = ['experience','dashboards','stories'];
      for(let i=0;i<parts.length-1;i++){
        if(patSegs.includes(parts[i]) && isItemId(parts[i+1])) return parts[i+1];
      }
    }catch{}
    return null;
  }

  /* TYPE / COLORS */
  function typeGroup(t=''){
    const x = t.toLowerCase();
    if(x.includes('story')) return 'StoryMap';
    if(x.includes('experience')) return 'Experience';
    if(x.includes('dashboard')) return 'Dashboard';
    if(x.includes('web map')) return 'Web Map';
    if(x.includes('web mapping application')) return 'Web App';
    if(x.includes('scene')) return 'Scene';
    if(x.includes('feature')) return 'Feature';
    if(t==='URL') return 'URL';
    return 'Other';
  }
  function colorForType(t){
    const g = typeGroup(t);
    if(g==='StoryMap') return '#ffb876';
    if(g==='Experience' || g==='Dashboard' || g==='Web App') return '#8a7ff0';
    if(g==='Web Map') return '#6aa2ff';
    if(g==='Feature' || g==='Scene') return '#2ec27e';
    if(g==='URL') return '#c0c7d1';
    return '#c0c7d1';
  }

  // --- Raw JSON renderer (fix for "renderRaw is not defined") ---
function renderRaw(obj) {
  const el = document.getElementById('raw');
  if (!el) return;
  try {
    el.textContent = JSON.stringify(obj ?? {}, null, 2);
  } catch {
    el.textContent = String(obj ?? '—');
  }
}


  /* STATE */
  let gState = { portal:'https://www.arcgis.com', deps:null, metasById:{}, typeFilter:null, hideUrls:false };

  /* ANALYZE */
  async function analyze(){
    hideAlert();
    const input = byId('url').value.trim();
    if(!input){ showAlert('Paste an item URL or 32-char item ID.', true); return; }

    const extr = extractFromUrl(input);
    let itemId = extr.itemId;
    if(extr.portal && (!byId('portalAuth').value || byId('portalAuth').value.trim()==='')){
      byId('portalAuth').value = extr.portal;
    }
    const portal = ensurePortal(byId('portalAuth').value.trim() || extr.portal || 'https://www.arcgis.com');
    byId('portalHostHint').textContent = portal.replace(/^https?:\/\//,'');
    if(!itemId){ showAlert("Couldn't determine an item ID from that input.", true); return; }
    gState.portal = portal;

    const itemUrl = `${portal}${REST_PATH}/content/items/${itemId}`;
    const dataUrl = `${itemUrl}/data`;

    setBusy(true);
    try{
      const item = await jsonFetch(itemUrl);
      const typeKw = (item.typeKeywords||[]).join(' ').toLowerCase();
      const type = (item.type||'').toLowerCase();
      const isExperience = type.includes('experience') || /experience/.test(typeKw) || item.type === 'Web Experience';
      const isStory      = item.type === 'StoryMap' || type.includes('story');

      const deps = {
        root:{
          id:itemId, title:item.title, type:item.type, owner:item.owner,
          access:item.access, created:item.created, modified:item.modified,
          typeKeywords:item.typeKeywords||[], serviceUrl:item.url||null
        },
        portal, discovered:[], edges:[], urls:[]
      };

      let data=null;
      try{ data = await jsonFetch(dataUrl); }
      catch(e){ if(e.authNeeded){ suggestAuth('This item appears to be private.'); return; } throw e; }

      let found = { itemIds:[], urls:[] };
      if(type.includes('web map'))                    found = depsFromWebMapData(data||{});
      else if(type.includes('dashboard'))            found = depsFromDashboardData(data||{});
      else if(isExperience)                           found = depsFromExpBuilderData(data||{});
      else if(isStory)                                found = depsFromStoryData(data||{}, itemId);
      else if(type.includes('web mapping application')){
        const wmId = data?.map?.itemId || null;
        if(wmId){
          deps.edges.push([itemId, wmId]);
          const wmData = await jsonFetch(`${portal}${REST_PATH}/content/items/${wmId}/data`);
          const inner = depsFromWebMapData(wmData||{});
          found = { itemIds: uniqArr([wmId, ...inner.itemIds]), urls: inner.urls };
          inner.itemIds.forEach(cid=>deps.edges.push([wmId, cid]));
          inner.urls.forEach(u=>deps.urls.push(u));
        }
      }
      if(!type.includes('web mapping application')) found.itemIds.forEach(cid=>deps.edges.push([itemId, cid]));
      deps.urls.push(...found.urls);

      const metas=[];
      for(const id of uniqArr(found.itemIds)){
        try{
          const it = await jsonFetch(`${portal}${REST_PATH}/content/items/${id}`);
          metas.push({
            id, title:it.title, type:it.type, owner:it.owner,
            access:it.access, created:it.created, modified:it.modified,
            typeKeywords:it.typeKeywords||[], serviceUrl:it.url||null
          });
        }catch(err){
          if(err.authNeeded){ suggestAuth('Some dependent items are private.'); return; }
          metas.push({ id, title:'(inaccessible)', type:'Unknown', owner:'—', access:'', created:'', modified:'', typeKeywords:[], serviceUrl:null });
        }
      }
      deps.discovered = metas;
      gState.metasById = Object.fromEntries(metas.map(m=>[m.id, m]));

      /* Dive into child Web Maps for deeper layer edges */
      const webMapIds = metas.filter(m=>(m.type||'').toLowerCase().includes('web map')).map(m=>m.id);
      for(const wmId of webMapIds){
        try{
          const wmData = await jsonFetch(`${portal}${REST_PATH}/content/items/${wmId}/data`);
          const inner = depsFromWebMapData(wmData||{});
          inner.itemIds.forEach(cid=>{ deps.edges.push([wmId, cid]); });
          deps.urls.push(...inner.urls);
          for(const cid of inner.itemIds){
            if(!deps.discovered.find(d=>d.id===cid)){
              try{
                const it = await jsonFetch(`${portal}${REST_PATH}/content/items/${cid}`);
                const meta = {
                  id:cid, title:it.title, type:it.type, owner:it.owner,
                  access:it.access, created:it.created, modified:it.modified,
                  typeKeywords:it.typeKeywords||[], serviceUrl:it.url||null
                };
                deps.discovered.push(meta);
                gState.metasById[cid] = meta;
              }catch(err){
                if(err.authNeeded){ suggestAuth('Some dependent layers are private.'); return; }
                const meta = { id:cid, title:'(inaccessible)', type:'Unknown', owner:'—', access:'', created:'', modified:'', typeKeywords:[], serviceUrl:null };
                deps.discovered.push(meta);
                gState.metasById[cid] = meta;
              }
            }
          }
        }catch(err){
          if(err.authNeeded){ suggestAuth('This web map is private.'); return; }
        }
      }

      gState.deps = deps;
      renderSummary(deps.root);
      renderItemsList(deps, portal);    // initial full list
      renderRaw(deps);
      renderGraph(deps);                 // centers on load
      buildLegend();
      applyFilters();                    // keep in sync with any existing query
    }catch(e){
      if(e.authNeeded){ suggestAuth('Authentication required.'); }
      else { showAlert(`Error: ${esc(e.message||e)}`, true); }
    }finally{ setBusy(false); }
  }

  function suggestAuth(reason){
    const det = document.querySelector('details.auth');
    det.open = true;
    const extra = location.origin.includes('localhost') ? ' If token fails, try <b>Use requestip</b>.' : '';
    byId('authBlurb').innerHTML = `Token is stored only in this page session.${extra}`;
    showAlert(`${reason}`, true);
    byId('token').focus();
  }

  /* UI HELPERS */
  function setBusy(b){ byId('go').disabled=b; }
  function renderSummary(s){
    byId('summary').innerHTML = `<div class="k">Title</div><div>${esc(s.title||'—')}</div>
      <div class="k">Type</div><div>${esc(s.type||'—')}</div>
      <div class="k">Owner</div><div>${esc(s.owner||'—')}</div>
      <div class="k">Item ID</div><div class="mini">${s.id||'—'}</div>`;
  }

  function renderItemsList(deps, portal){
    // base render (unfiltered)
    renderItemsListFiltered({ all:true }, deps, portal);
  }

  function renderItemsListFiltered(filter, deps=gState.deps, portal=gState.portal){
    const items = deps.discovered || [];
    let filteredItems = items;
    let filteredUrls = deps.urls || [];

    if(!filter.all){
      if(filter.ids){ filteredItems = items.filter(m => filter.ids.has(m.id)); }
      if(filter.urls){ filteredUrls = (deps.urls||[]).filter(u => filter.urls.has(u)); }
    }

    const list = filteredItems.map(m=>{
      const href = `${portal}/home/item.html?id=${m.id}`;
      return `<div class="row-item">
        <div style="min-width:0">
          <div style="font-weight:600">${esc(m.title||'(no title)')}</div>
          <div class="mini">${esc(m.type||'Unknown')} • ${m.id}</div>
        </div>
        <a target="_blank" href="${href}" title="Open in ArcGIS">Open ▸</a>
      </div>`;
    }).join('');

    const urlList = filteredUrls.length ? `
      <div style="margin-top:8px">
        <div class="mini" style="margin-bottom:4px">Service URLs (no itemId):</div>
        <div class="mini">${filteredUrls.map(u=>esc(u)).join('<br>')}</div>
      </div>` : '';

    byId('items').innerHTML = (list || '<div class="mini">No items matched.</div>') + urlList;
  }

  /* GRAPH */
  function renderGraph(deps){
    const nodes=[], edges=[];
    nodes.push({ data:{ id:deps.root.id, label:`${deps.root.title||'Root'}\n(${deps.root.type||'Unknown'})`, type:deps.root.type||'Unknown', itemId:deps.root.id } });
    deps.discovered.forEach(d=>{
      nodes.push({ data:{ id:d.id, label:`${d.title||'(no title)'}\n(${d.type||'Unknown'})`, type:d.type||'Unknown', itemId:d.id } });
    });
    (deps.urls||[]).forEach((u,i)=>{
      const id=`url_${i}`;
      const short=u.replace(/^https?:\/\//,'').replace(/\?.*$/,'').slice(0,64);
      nodes.push({ data:{ id, label:`${short}\n(URL)`, type:'URL', url:u } });
      edges.push({ data:{ id:`e_root_url_${i}`, source:deps.root.id, target:id } });
    });
    deps.edges.forEach(([s,t],i)=> edges.push({ data:{ id:`e${i}`, source:s, target:t } }));

    byId('counts').textContent = `Nodes: ${nodes.length} • Edges: ${edges.length}`;

    const elements = { nodes, edges };
    const layoutCfg = { name:'dagre', rankDir:'LR', ranker:'network-simplex', nodeSep:44, rankSep:120, edgeSep:22, fit:false, padding:8 };

    if(!cy){
      cy = window.cy = cytoscape({
        container: byId('cy'),
        elements,
        style: [
          { selector:'node', style:{
            'shape':'round-rectangle',
            'background-color': e=> colorForType(e.data('type')),
            'label': 'data(label)',
            'color': cssVar('--graph-label'),
            'font-size': 12,
            'min-zoomed-font-size': 6,
            'text-wrap':'wrap',
            'text-max-width': 280,
            'text-valign':'center',
            'text-halign':'center',
            'border-color': cssVar('--graph-border'),
            'border-width': 2,
            'padding': 12,
            'width':'label',
            'height':'label'
          }},
          { selector:'edge', style:{
            'curve-style':'bezier',
            'target-arrow-shape':'triangle',
            'target-arrow-color': cssVar('--graph-edge'),
            'line-color': cssVar('--graph-edge'),
            'width':1.4,
            'arrow-scale':1.0,
            'opacity':0.9
          }},
          { selector:':selected', style:{ 'border-color': '#0a7aff', 'border-width': 3 } },
          { selector:'.dim', style:{ 'opacity': 0.18 } },
          { selector:'.hidden', style:{ 'display': 'none' } },
          { selector:'.hiddenEdge', style:{ 'display': 'none' } },
          { selector:'.match', style:{ 'border-color':'#22c55e', 'border-width': 3 } },
          { selector:'edge.match-edge', style:{ 'line-color':'#22c55e', 'target-arrow-color':'#22c55e', 'width':2 } }
        ],
        layout: layoutCfg,
        wheelSensitivity: 0.25,
        boxSelectionEnabled: true
      });
      cy.on('tap','node', onNodeTap);
    } else {
      cy.elements().remove();
      cy.add(elements);
      cy.layout(layoutCfg).run();
    }
    applyGraphTheme();

    // Center the content on load and after updates
    if(cy.nodes().length){ cy.fit(cy.nodes(), 40); }

    if(gState.hideUrls) hideUrlNodes(true);
  }

  /* Focus utilities */
  const focusState = { enabled:false, nodeId:null };
  function focusOnNode(node){
    if(!cy) return;
    focusState.nodeId = node.id();
    const sub = node.union(node.successors()).union(node.predecessors());
    const non = cy.elements().difference(sub);
    non.nodes().addClass('dim'); non.edges().addClass('hiddenEdge');
    sub.nodes().removeClass('dim'); sub.edges().removeClass('hiddenEdge');
    sub.layout({ name:'dagre', rankDir:'LR', ranker:'network-simplex', nodeSep:48, rankSep:140, edgeSep:24, fit:false, padding:8 }).run();
    cy.fit(sub.nodes(), 50);
  }
  function clearFocus(){
    if(!cy) return;
    focusState.nodeId = null;
    cy.elements().removeClass('dim hiddenEdge');
    cy.layout({ name:'dagre', rankDir:'LR', ranker:'network-simplex', nodeSep:44, rankSep:120, edgeSep:22, fit:false, padding:8 }).run();
    applyFilters();
    cy.fit(cy.nodes(), 40);
  }

  function onNodeTap(evt){
    const el = evt.target;
    cy.elements().removeClass('dim');
    cy.elements().difference(el.outgoers().union(el.incomers()).union(el)).addClass('dim');

    const data = el.data();
    if(data.type==='URL'){
      renderSummary({ title:data.label.replace(/\n\(URL\)$/,''), type:'URL', owner:'—', id:'—' });
    } else {
      const meta = gState.metasById[data.itemId] || (data.itemId===gState.deps?.root?.id?gState.deps.root:null) || { id:data.itemId, title:'(unknown)', type:'Unknown', owner:'—' };
      renderSummary(meta);
    }

    if(focusState.enabled) focusOnNode(el);
  }

  function clearSelection(){
    if(!cy) return;
    cy.$(':selected').unselect();
    cy.elements().removeClass('dim match match-edge');
  }

  function resetApp(){
    byId('url').value = '';
    byId('summary').innerHTML = '';
    byId('items').innerHTML = '';
    byId('raw').textContent = '—';
    byId('counts').textContent = 'Nodes: 0 • Edges: 0';
    byId('search').value='';
    gState.typeFilter = null;
    gState.hideUrls = false;
    if(cy){ cy.elements().remove(); }
    byId('legend').innerHTML='';
    hideAlert();
    clearFocus();
  }

  /* Wire controls */
  byId('go').addEventListener('click', analyze);
  byId('resetApp').addEventListener('click', resetApp);
  byId('clearSel').addEventListener('click', clearSelection);
  byId('fit').addEventListener('click', ()=>{ if(cy) cy.fit(undefined, 12); });

  /* Focus actions */
  const focusBtn = byId('focusMode');
  focusBtn.addEventListener('click', ()=>{
    focusState.enabled = !focusState.enabled;
    focusBtn.textContent = `Focus mode: ${focusState.enabled ? 'On' : 'Off'}`;
    focusBtn.classList.toggle('toggle-on', focusState.enabled);
    if(!focusState.enabled) clearFocus();
  });
  byId('reflowSel').addEventListener('click', ()=>{
    if(!cy) return;
    const sel = cy.$(':selected').length ? cy.$(':selected')[0] : (focusState.nodeId ? cy.$id(focusState.nodeId) : null);
    if(sel && sel.isNode()){ focusOnNode(sel); }
  });
  byId('clearFocus').addEventListener('click', clearFocus);

  /* Legend filter */
  function buildLegend(){
    const el = byId('legend');
    if(!cy){ el.innerHTML=''; return; }
    const counts = {};
    cy.nodes().forEach(n=>{
      const g = typeGroup(n.data('type')||'Other');
      counts[g] = (counts[g]||0)+1;
    });
    const chips = Object.entries(counts).sort((a,b)=>a[0].localeCompare(b[0])).map(([g,c])=>{
      const dot = `<span class="legend-dot" style="background:${colorForType(g)}"></span>`;
      const active = (gState.typeFilter===g)?' style="outline:2px solid var(--focus)"':'';
      return `<button class="legend-chip" data-type="${g}" title="Filter to ${g}. Click again to clear."${active}>${dot}<span>${g}</span><span class="mini">(${c})</span></button>`;
    }).join('');
    el.innerHTML = chips || '';
    el.querySelectorAll('.legend-chip').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const t = btn.getAttribute('data-type');
        gState.typeFilter = (gState.typeFilter===t)? null : t;
        buildLegend();
        applyFilters();               // keep list & graph in sync
      });
    });
  }

  /* Search / filter (sync graph + list) */
  const searchInput = byId('search');
  let debounceTimer=null;
  searchInput.addEventListener('input', ()=>{ clearTimeout(debounceTimer); debounceTimer = setTimeout(applyFilters, 150); });

  function parseQuery(q){
    const res = { text:[], kv:{} };
    const re = /(\w+):"([^"]+)"|(\w+):(\S+)|"([^"]+)"|(\S+)/g;
    let m;
    while((m = re.exec(q))!==null){
      if(m[1] && m[2]) res.kv[m[1].toLowerCase()] = m[2].toLowerCase();
      else if(m[3] && m[4]) res.kv[m[3].toLowerCase()] = m[4].toLowerCase();
      else if(m[5]) res.text.push(m[5].toLowerCase());
      else if(m[6]) res.text.push(m[6].toLowerCase());
    }
    return res;
  }
  function metaForNode(n){
    const d = n.data();
    if(d.type==='URL'){
      return { title: d.label.replace(/\n\(URL\)$/,''), type:'URL', owner:'', id:'', keywords:'', url:d.url||'' };
    }
    const m = gState.metasById[d.itemId] || (d.itemId===gState.deps?.root?.id?gState.deps.root:null) || {};
    return {
      title: m.title||'',
      type: m.type||'',
      owner: m.owner||'',
      id: m.id||d.itemId||'',
      keywords: (m.typeKeywords||[]).join(' ').toLowerCase(),
      url: m.serviceUrl||''
    };
  }
  function matches(meta, q){
    const t = q.text;
    const kv = q.kv;
    if(kv.type && !meta.type.toLowerCase().includes(kv.type)) return false;
    if(kv.owner && !meta.owner.toLowerCase().includes(kv.owner)) return false;
    if(kv.title && !meta.title.toLowerCase().includes(kv.title)) return false;
    if(kv.id && !String(meta.id).toLowerCase().includes(kv.id)) return false;
    return t.every(tok =>
      meta.title.toLowerCase().includes(tok) ||
      meta.type.toLowerCase().includes(tok) ||
      meta.owner.toLowerCase().includes(tok) ||
      String(meta.id).toLowerCase().includes(tok) ||
      meta.keywords.includes(tok)
    );
  }

  function applyFilters(){
    if(!cy) return;
    const q = parseQuery(searchInput.value.trim());
    const typeFilter = gState.typeFilter;

    cy.elements().removeClass('match match-edge dim');

    let matchedNodes = cy.collection();
    cy.nodes().forEach(n=>{
      const meta = metaForNode(n);
      const okSearch = (q.text.length===0 && Object.keys(q.kv).length===0) || matches(meta, q);
      const okType = !typeFilter || typeGroup(n.data('type'))===typeFilter;
      if(okSearch && okType) matchedNodes = matchedNodes.add(n);
    });

    if(matchedNodes.length > 0){
      matchedNodes.addClass('match');
      const matchedIds = new Set(matchedNodes.filter(n=>n.data('type')!=='URL').map(n=> n.data('itemId')));
      const matchedUrls = new Set(matchedNodes.filter(n=>n.data('type')==='URL').map(n=> n.data('url')));

      // highlight connecting edges
      const matchedIdSet = new Set(matchedNodes.map(n=>n.id()));
      cy.edges().forEach(e=>{
        if(matchedIdSet.has(e.source().id()) && matchedIdSet.has(e.target().id())) e.addClass('match-edge');
      });

      // dim the rest
      cy.elements().difference(matchedNodes.union(cy.edges('.match-edge'))).addClass('dim');

      // sync list
      renderItemsListFiltered({ ids: matchedIds, urls: matchedUrls });
    } else {
      // if query or type filter exists and nothing matched: dim everything and show empty list
      if(searchInput.value.trim() || typeFilter){
        cy.elements().addClass('dim');
        renderItemsListFiltered({ ids:new Set(), urls:new Set() });
      } else {
        cy.elements().removeClass('dim');
        renderItemsListFiltered({ all:true });
      }
    }
  }

  /* URL toggle & zoom helpers */
  const toggleUrlsBtn = byId('toggleUrls');
  toggleUrlsBtn.addEventListener('click', ()=>{
    gState.hideUrls = !gState.hideUrls;
    hideUrlNodes(gState.hideUrls);
    toggleUrlsBtn.textContent = gState.hideUrls ? 'Show URLs' : 'Collapse URLs';
  });
  function hideUrlNodes(hide){
    if(!cy) return;
    const urls = cy.nodes().filter(n=> n.data('type')==='URL');
    urls.toggleClass('hidden', !!hide);
    cy.layout({ name:'dagre', rankDir:'LR', ranker:'network-simplex', nodeSep:44, rankSep:120, edgeSep:22, fit:false, padding:8 }).run();
    cy.fit(cy.nodes(':visible'), 40);
  }
  const expandWebMapsBtn = byId('expandWebMaps');
  expandWebMapsBtn.addEventListener('click', ()=>{
    if(!cy) return;
    const wms = cy.nodes().filter(n=> typeGroup(n.data('type'))==='Web Map');
    if(wms.length){ cy.fit(wms, 40); }
  });

  /* EXPORTS */
  byId('exportJson').addEventListener('click', ()=>{
    const blob = new Blob([byId('raw').textContent], {type:'application/json'});
    downloadBlob('dependencies.json', blob);
  });
  byId('exportCsv').addEventListener('click', exportCsv);
  byId('exportPng').addEventListener('click', ()=>{
    if(!cy) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
    const png = cy.png({ full:true, scale:2, bg });
    downloadDataUrl('graph.png', png);
  });
  function downloadBlob(filename, blob){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function downloadDataUrl(filename, dataUrl){
    const a = document.createElement('a');
    a.href = dataUrl; a.download = filename; a.click();
  }

  /* CSV */
  function exportCsv(){
    const deps = gState.deps;
    if(!deps){ showAlert('Nothing to export yet. Analyze an item first.', true); return; }
    const parentMap = {};
    (deps.edges||[]).forEach(([s,t])=>{
      parentMap[t] = parentMap[t] || new Set(); parentMap[t].add(s);
    });
    const metaById = (id)=> id===deps.root.id ? deps.root : gState.metasById[id];
    const portal = deps.portal;
    const toISO = (ms)=> typeof ms === 'number' && ms>0 ? new Date(ms).toISOString() : '';
    const isCfg = (t)=> {
      const x=(t||'').toLowerCase();
      return x.includes('web map')||x.includes('dashboard')||x.includes('experience')||x.includes('story')||x.includes('web mapping application');
    };

    const rows = [];
    const items = [deps.root, ...(deps.discovered||[])];
    items.forEach(m=>{
      const pIds = [...(parentMap[m.id]||[])];
      const pTitles = pIds.map(pid=> (metaById(pid)||{}).title || '').filter(Boolean);
      const itemUrl = `${portal}/home/item.html?id=${m.id}`;
      const restUrl = isCfg(m.type)
        ? `${portal}${REST_PATH}/content/items/${m.id}/data?f=pjson`
        : `${portal}${REST_PATH}/content/items/${m.id}?f=pjson`;
      rows.push({
        NodeType: 'Item',
        Title: m.title || '',
        Type: m.type || '',
        ItemID: m.id || '',
        Owner: m.owner || '',
        Access: m.access || '',
        Portal: portal.replace(/^https?:\/\//,''),
        ItemURL: itemUrl,
        RESTURL: restUrl,
        ServiceURL: m.serviceUrl || '',
        ParentIDs: pIds.join(';'),
        ParentTitles: pTitles.join(';'),
        CreatedISO: toISO(m.created),
        ModifiedISO: toISO(m.modified),
        TypeKeywords: Array.isArray(m.typeKeywords)? m.typeKeywords.join(';') : ''
      });
    });
    (deps.urls||[]).forEach((u,i)=>{
      const nodeId = `url_${i}`;
      const pIds = [...(parentMap[nodeId]||[deps.root.id])];
      const pTitles = pIds.map(pid=> (metaById(pid)||{}).title || '').filter(Boolean);
      rows.push({
        NodeType: 'URL',
        Title: u.replace(/^https?:\/\//,'').slice(0,80),
        Type: 'URL',
        ItemID: '',
        Owner: '',
        Access: '',
        Portal: portal.replace(/^https?:\/\//,''),
        ItemURL: '',
        RESTURL: '',
        ServiceURL: u,
        ParentIDs: pIds.join(';'),
        ParentTitles: pTitles.join(';'),
        CreatedISO: '',
        ModifiedISO: '',
        TypeKeywords: ''
      });
    });

    const headers = Object.keys(rows[0] || {
      NodeType:'', Title:'', Type:'', ItemID:'', Owner:'', Access:'', Portal:'', ItemURL:'', RESTURL:'', ServiceURL:'', ParentIDs:'', ParentTitles:'', CreatedISO:'', ModifiedISO:'', TypeKeywords:''
    });
    const escape = (v)=>{
      const s = String(v??'');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const csv = [headers.join(','), ...rows.map(r=> headers.map(h=>escape(r[h])).join(','))].join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    downloadBlob('dependencies.csv', blob);
  }

  /* TOKEN INPUTS */
  byId('token').addEventListener('change',(e)=> setToken(e.target.value||null,null));
  byId('genToken').addEventListener('click', async ()=>{
    const portal = ensurePortal(byId('portalAuth').value.trim() || gState.portal);
    const u = byId('user').value.trim();
    const p = byId('pass').value;
    const useReqIp = byId('useReqIp').checked;
    if(!u||!p){ showAlert('Enter username and password.', true); return; }
    try{
      const params = useReqIp
        ? { username:u, password:p, client:'requestip', expiration:'60', f:'json' }
        : { username:u, password:p, client:'referer', referer:location.origin, expiration:'60', f:'json' };
      const body = new URLSearchParams(params);
      const r = await fetch(`${portal}${REST_PATH}/generateToken`,{
        method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body
      });
      const j = await r.json().catch(()=>({ error:{ message:'Non-JSON response' } }));
      if(j.error) throw new Error(j.error.message||'Token error');
      setToken(j.token, Date.now()+60*60*1000);
      showAlert('Token generated. You can now analyze private items.');
    }catch(err){
      showAlert('Failed to get token: ' + esc(err.message), true);
    }
  });
  byId('clearToken').addEventListener('click', ()=> setToken(null,null));

  /* Expose for console */
  window.__depcheck = { analyze };
})();
function esc(s){ return (s+"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
