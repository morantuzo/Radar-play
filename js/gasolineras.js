/* =====================================================================
   Radar Play · Gasolineras
   Precios oficiales del Ministerio (se actualizan cada media hora).
   La más barata cerca o en tu ruta, cuánto ahorras, ir y apuntar el
   repostaje en Mi coche.
   ===================================================================== */
const MINETUR='https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
const GTIPOS={A:'Gasóleo A',P:'Gasóleo Premium','95':'Gasolina 95','98':'Gasolina 98',GLP:'GLP'};
const GORDEN=['A','P','95','98','GLP'].map(k=>[k,GTIPOS[k]]);   // las claves numéricas irían primero
const GAS={lista:[],fecha:null,cargando:false,err:null,tipo:LS.get('rp-gas-tipo')||'A',modo:'cerca',radio:+(LS.get('rp-gas-radio')||10),orden:LS.get('rp-gas-orden')||'precio',mk:[],ts:0};

ICONS.gasolineras=Sv('<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 11h10M14 8l3 3v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>');
APPS.splice(APPS.findIndex(a=>a.id==='coche')+1,0,{id:'gasolineras',name:'Gasolineras',bg:'linear-gradient(160deg,#ffb020,#c25e00)'});

/* ---------- Datos ---------- */
function gasCompactar(bruto){
  const nrm=s=>String(s).normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace('(wgs84)','').replace(/\s+/g,' ').trim();
  const num=v=>{ v=String(v||'').trim().replace(',','.'); return v?+v:null; };
  const T={A:'gasoleo a',P:'gasoleo premium','95':'gasolina 95 e5','98':'gasolina 98 e5',GLP:'gases licuados del petroleo'};
  return (bruto.ListaEESSPrecio||[]).map(f=>{ const n={}; for(const k in f) n[nrm(k)]=f[k];
    const p={}; for(const k in T){ const v=num(n['precio '+T[k]]); if(v) p[k]=v; }
    const t=s=>String(s||'').trim().toLowerCase().replace(/(^|\s)\S/g,x=>x.toUpperCase());
    return {id:String(n.ideess||''),r:t(n.rotulo),d:t(n.direccion),m:t(n.municipio||n.localidad),lat:num(n.latitud),lng:num(n.longitud),h:String(n.horario||'').trim(),p}; })
    .filter(g=>g.lat!=null&&g.lng!=null&&Object.keys(g.p).length);
}
async function gasLoad(force){
  if(GAS.cargando) return; GAS.cargando=true; GAS.err=null;
  try{
    let d=null;
    if(SYS.bridge){ try{ d=await api('/api/gasolineras'); }catch(e){} }
    if(d&&d.lista&&d.lista.length&&!(force&&d.viejo)){ GAS.lista=d.lista; GAS.fecha=d.fecha; GAS.ts=d.descargado*1000; }
    if(!GAS.lista.length||(d&&d.viejo)||force){
      /* El puente no pudo: los descarga la pantalla y se los pasa al puente para la próxima vez */
      const r=await fetch(MINETUR,{headers:{Accept:'application/json'}}); const b=await r.json();
      GAS.lista=gasCompactar(b); GAS.fecha=b.Fecha; GAS.ts=Date.now();
      if(SYS.bridge) api('/api/gasolineras',{fecha:b.Fecha,lista:GAS.lista}).catch(()=>{});
    }
  }catch(e){ if(!GAS.lista.length) GAS.err='No he podido descargar los precios. Hace falta internet.'; }
  GAS.cargando=false;
}
const kmEntre=(a,b)=>{ const R=6371, r=Math.PI/180, x=(b.lng-a.lng)*r*Math.cos((a.lat+b.lat)*r/2), y=(b.lat-a.lat)*r; return Math.sqrt(x*x+y*y)*R; };
function gasFiltrar(){
  const t=GAS.tipo, c=S.pos||FALLBACK, out=[];
  if(GAS.modo==='ruta'&&NAV.active&&NAV.r){
    /* En ruta: a menos de 1,5 km de lo que queda de recorrido; «más adelante» = km de ruta hasta ella */
    const pts=NAV.r.pts, cum=NAV.r.cum, along=NAV.along||0, muestras=[];
    for(let i=0;i<pts.length;i+=Math.max(1,Math.floor(pts.length/400))) if(cum[i]>=along-200) muestras.push({lat:pts[i].lat(),lng:pts[i].lng(),d:cum[i]-along});
    const box=muestras.reduce((b,p)=>({a:Math.min(b.a,p.lat),b:Math.max(b.b,p.lat),c:Math.min(b.c,p.lng),d:Math.max(b.d,p.lng)}),{a:90,b:-90,c:180,d:-180});
    for(const g of GAS.lista){ if(!g.p[t]||g.lat<box.a-.02||g.lat>box.b+.02||g.lng<box.c-.03||g.lng>box.d+.03) continue;
      let best=1e9,dr=0; for(const p of muestras){ const k=kmEntre(g,p); if(k<best){ best=k; dr=p.d; } }
      if(best<=1.5) out.push({...g,km:Math.max(0,dr/1000),desvio:best,precio:g.p[t]}); }
  } else {
    for(const g of GAS.lista){ if(!g.p[t]) continue; const k=kmEntre(c,g); if(k<=GAS.radio) out.push({...g,km:k,precio:g.p[t]}); }
  }
  const media=out.length?out.reduce((s,g)=>s+g.precio,0)/out.length:null, min=out.length?Math.min(...out.map(g=>g.precio)):null;
  out.sort((a,b)=>GAS.orden==='precio'?(a.precio-b.precio)||(a.km-b.km):a.km-b.km);
  return {lista:out.slice(0,60),media,min,n:out.length};
}
/* Horario del Ministerio («L-D: 24H», «L-V: 06:00-22:00; S: 07:00-15:00») → ¿abierta ahora? */
function gasAbierta(h){
  if(!h) return null; if(/24H/i.test(h)&&/L-D/i.test(h)) return true;
  const D='LMXJVSD', now=new Date(), dia=(now.getDay()+6)%7, min=now.getHours()*60+now.getMinutes();
  for(const parte of h.split(';')){ const m=parte.match(/([LMXJVSD])(?:-([LMXJVSD]))?\s*:\s*(.*)/i); if(!m) continue;
    const a=D.indexOf(m[1].toUpperCase()), b=m[2]?D.indexOf(m[2].toUpperCase()):a; if(dia<a||dia>b) continue;
    if(/24H/i.test(m[3])) return true;
    for(const tr of m[3].matchAll(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/g)){ const i=+tr[1]*60+ +tr[2], f=+tr[3]*60+ +tr[4]; if(f>i?min>=i&&min<f:min>=i||min<f) return true; }
    return false; }
  return null;
}
const eur=v=>v==null?'—':v.toFixed(3).replace('.',',');

/* ---------- Vista ---------- */
document.head.insertAdjacentHTML('beforeend',`<style>
.gs-top{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.gs-top .seg{display:flex;background:var(--panel);border-radius:999px;padding:3px}.gs-top .seg button{padding:8px 14px;border-radius:999px;font-weight:700;color:var(--muted);font-size:14px}.gs-top .seg button.on{background:var(--accent);color:#fff}
.gs{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:14px;align-items:start}
.gs-l{background:var(--panel);border-radius:16px;padding:4px 14px;min-width:0}
.gs-r{display:flex;flex-direction:column;gap:12px;min-width:0}
.gs-row{display:flex;gap:12px;align-items:center;width:100%;padding:11px 2px;border-top:1px solid var(--line);text-align:left;min-width:0}
.gs-row:first-child{border-top:0}
.gs-row .n{width:28px;flex:none;font-weight:800;color:var(--muted);font-variant-numeric:tabular-nums}
.gs-row .i{flex:1;min-width:0}.gs-row .i b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gs-row .i span{color:var(--muted);font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-row .p{text-align:right;flex:none}.gs-row .p b{font-family:var(--f-d);font-size:26px;font-variant-numeric:tabular-nums}.gs-row .p span{display:block;font-size:12.5px;font-weight:700}
.gs-row .p .bar{color:var(--ok)}.gs-row .p .car{color:#ffb020}
.gs-row.top .n{color:var(--ok)}
.gs-row .i .gs-ab{display:inline;font-size:11px;font-weight:800;border-radius:5px;padding:1px 6px;margin-left:6px;vertical-align:2px}.gs-ab.si{background:rgba(52,196,106,.15);color:var(--ok)}.gs-ab.no{background:rgba(255,77,79,.15);color:var(--stop)}
.gs-best{background:linear-gradient(150deg,rgba(52,196,106,.18),var(--panel) 60%);border-radius:16px;padding:16px}
.gs-best small{font-weight:800;letter-spacing:.08em;color:var(--ok);font-size:12px}
.gs-best b.big{display:block;font-family:var(--f-d);font-size:46px;line-height:1.05;font-variant-numeric:tabular-nums}
.gs-best .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.gs-tab{width:100%;border-collapse:collapse;margin-top:10px}.gs-tab td{padding:7px 0;border-top:1px solid var(--line)}.gs-tab td:last-child{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}
@media (max-width:900px){.gs{grid-template-columns:1fr}}
</style>`);

VIEWS.gasolineras=()=>{
  const ruta=NAV.active&&NAV.r;
  if(GAS.modo==='ruta'&&!ruta) GAS.modo='cerca';
  const top=`<div class="gs-top">
    <div class="seg">${GORDEN.map(([k,n])=>`<button class="${GAS.tipo===k?'on':''}" data-gs="tipo" data-k="${k}">${n}</button>`).join('')}</div>
    <div class="seg"><button class="${GAS.modo==='cerca'?'on':''}" data-gs="modo" data-k="cerca">Cerca</button><button class="${GAS.modo==='ruta'?'on':''}" data-gs="modo" data-k="ruta" ${ruta?'':'disabled style="opacity:.4"'}>En mi ruta</button></div>
    ${GAS.modo==='cerca'?`<div class="seg">${[5,10,25].map(r=>`<button class="${GAS.radio===r?'on':''}" data-gs="radio" data-k="${r}">${r} km</button>`).join('')}</div>`:''}
    <div class="seg"><button class="${GAS.orden==='precio'?'on':''}" data-gs="orden" data-k="precio">Más baratas</button><button class="${GAS.orden==='dist'?'on':''}" data-gs="orden" data-k="dist">Más cerca</button></div></div>`;
  let body;
  if(!GAS.lista.length) body=`<p class="co-empty">${GAS.cargando||!GAS.err?'Descargando los precios del Ministerio…':esc(GAS.err)}</p>${GAS.err?'<button class="pill on" data-gs="recargar">Reintentar</button>':''}`;
  else {
    const f=gasFiltrar(), b=f.lista.find(g=>g.precio===f.min);
    const ahorro=b&&f.media?(f.media-b.precio)*50:0;
    body=`<div class="gs"><div class="gs-l">${f.lista.length?f.lista.map((g,i)=>{ const ab=gasAbierta(g.h), dif=f.media?g.precio-f.media:0;
      return `<button class="gs-row ${g.precio===f.min?'top':''}" data-gs="ver" data-id="${g.id}"><span class="n">${i+1}</span><div class="i"><b>${esc(g.r||'Gasolinera')}${ab===true?'<span class="gs-ab si">ABIERTA</span>':ab===false?'<span class="gs-ab no">CERRADA</span>':''}</b>
        <span>${esc(g.d)}, ${esc(g.m)}</span><span>${GAS.modo==='ruta'?'a '+nf(g.km,1)+' km por tu ruta'+(g.desvio>.3?' · desvío '+nf(g.desvio,1)+' km':''):'a '+nf(g.km,1)+' km'}</span></div>
        <div class="p"><b>${eur(g.precio)}</b><span class="${dif<=-0.005?'bar':dif>=0.005?'car':''}">${Math.abs(dif)<0.005?'en la media':(dif<0?'−':'+')+nf(Math.abs(dif)*100,1)+' cts'}</span></div></button>`; }).join('')
      :`<p class="co-empty">${GAS.modo==='ruta'?'No hay gasolineras con '+GTIPOS[GAS.tipo]+' cerca de tu ruta.':'No hay gasolineras con '+GTIPOS[GAS.tipo]+' a menos de '+GAS.radio+' km.'}</p>`}</div>
      <div class="gs-r">${b?`<div class="gs-best"><small>LA MÁS BARATA ${GAS.modo==='ruta'?'EN TU RUTA':'CERCA'}</small><b class="big">${eur(b.precio)} €/l</b>
        <div style="font-weight:700;margin-top:4px">${esc(b.r)} · a ${nf(b.km,1)} km</div><div class="muted" style="font-size:13.5px">${esc(b.d)}, ${esc(b.m)}</div>
        <div class="muted" style="margin-top:8px;font-size:14px">${ahorro>0.2?'Llenando 50 litros ahorras unos <b style="color:var(--fg)">'+nf(ahorro,2)+' €</b> frente a la media de la zona ('+eur(f.media)+' €/l).':'Los precios de la zona son muy parecidos.'}</div>
        <div class="acts"><button class="pill on" data-gs="ir" data-id="${b.id}">${NAV.active?'Añadir parada':'Ir'}</button><button class="pill" data-gs="mapa">Ver en el mapa</button></div></div>`:''}
      <div class="co-box"><h4 style="font-size:18px">Datos</h4><p class="co-note" style="margin:0">${f.n} gasolineras ${GAS.modo==='ruta'?'junto a tu ruta':'a menos de '+GAS.radio+' km'} · media ${eur(f.media)} €/l<br>Precios del Ministerio para la Transición Ecológica${GAS.fecha?', '+esc(GAS.fecha):''}.</p>
        <div class="co-btns" style="justify-content:flex-start"><button class="pill" data-gs="recargar">Actualizar</button></div></div></div></div>`;
  }
  return `${appbar('Gasolineras')}<div class="abody">${top}${body}</div>`;
};
function gasVer(g){
  const ab=gasAbierta(g.h);
  overlay(`<h2>${esc(g.r||'Gasolinera')}</h2><p>${esc(g.d)}, ${esc(g.m)}${g.km!=null?' · a '+nf(g.km,1)+' km':''}</p>
    <p class="muted" style="margin-top:6px">${esc(g.h||'Sin horario')}${ab===true?' · <b style="color:var(--ok)">abierta ahora</b>':ab===false?' · <b style="color:var(--stop)">cerrada ahora</b>':''}</p>
    <table class="gs-tab">${GORDEN.filter(([k])=>g.p[k]).map(([k,n])=>`<tr><td>${n}</td><td>${eur(g.p[k])} €/l</td></tr>`).join('')}</table>
    <div class="mp-acts"><button class="pill on" id="gIr">${NAV.active?'Añadir parada':'Cómo llegar'}</button><button class="pill" id="gRep">Apuntar repostaje aquí</button><span style="flex:1"></span><button class="pill" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv; $('gIr').onclick=()=>{ closeOv(); gasIr(g); };
  $('gRep').onclick=()=>{ closeOv(); gasRepostar(g); };
}
function gasIr(g){ const d={name:g.r||'Gasolinera',address:g.d+', '+g.m,loc:{lat:g.lat,lng:g.lng}}; if(NAV.active) addStop(d); else { setView('mapas'); previewTo(d); } }
async function gasRepostar(g){
  const precio=g.p[GAS.tipo]; if(!CO.info) await coLoad(); if(!CO.info){ toast('Abre Mi coche con el puente funcionando'); return; }
  formRep({fecha:hoyISO(),km:CO.info.km_total!=null?Math.round(CO.info.km_total):'',lleno:true,notas:(g.r||'')+' · '+eur(precio)+' €/l',precio});
}
function gasMapa(){
  const f=gasFiltrar(); clearRes(); setView('mapas');
  setTimeout(()=>{ MP.cat=['Gasolineras','gasolinera','#ff9800']; MP.res=f.lista.slice(0,25).map(g=>({name:g.r+' · '+eur(g.precio)+' €',address:g.d,loc:{lat:g.lat,lng:g.lng},d:g.km*1000,gas:g}));
    MP.resMk=MP.res.map((r,i)=>{ const m=new G.Marker({map,position:r.loc,zIndex:20,label:{text:eur(r.gas.precio).slice(0,5),color:'#fff',fontWeight:'800',fontSize:'11px'},
      icon:{path:'M-22-12h44a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6l-6 7-6-7h-16a4 4 0 0 1-4-4V-8a4 4 0 0 1 4-4z',fillColor:r.gas.precio===f.min?'#1e9e4a':'#c25e00',fillOpacity:1,strokeColor:'#fff',strokeWeight:1.5,scale:1,labelOrigin:new G.Point(0,-2)}});
      m.addListener('click',()=>gasVer(r.gas)); return m; });
    if(G.LatLngBounds&&map.fitBounds&&MP.res.length){ const b=new G.LatLngBounds(); MP.res.slice(0,12).forEach(r=>b.extend(r.loc)); if(S.pos) b.extend(S.pos); S.follow=false; map.fitBounds(b,80); }
    resBar(); },150);
}
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-gs]'); if(!el) return; e.stopPropagation(); const a=el.dataset.gs, k=el.dataset.k;
  if(a==='tipo'){ GAS.tipo=k; LS.set('rp-gas-tipo',k); }
  if(a==='modo') GAS.modo=k;
  if(a==='radio'){ GAS.radio=+k; LS.set('rp-gas-radio',k); }
  if(a==='orden'){ GAS.orden=k; LS.set('rp-gas-orden',k); }
  if(a==='recargar'){ toast('Actualizando precios…'); gasLoad(true).then(()=>S.view==='gasolineras'&&renderApp()); }
  if(a==='ver'||a==='ir'){ const g=gasFiltrar().lista.find(x=>x.id===el.dataset.id); if(g) a==='ver'?gasVer(g):gasIr(g); return; }
  if(a==='mapa') return gasMapa();
  renderApp();
},true);
const _rApp7=renderApp; renderApp=function(){ _rApp7(); if(S.view==='gasolineras'&&!GAS.lista.length&&!GAS.cargando&&!GAS.err) gasLoad().then(()=>{ if(S.view==='gasolineras') renderApp(); }); };
/* Refresca cada 30 min si la app está abierta */
setInterval(()=>{ if(Date.now()-GAS.ts>30*60e3&&S.view==='gasolineras') gasLoad(true).then(()=>S.view==='gasolineras'&&renderApp()); },60000);

/* Siri: «gasolinera más barata», «dónde echo gasoil» */
if(typeof siriHandle==='function'){ const _sh3=siriHandle; siriHandle=async function(t){ const s=(t||'').toLowerCase();
  if(/gasolinera.*barat|barat.*gasolinera|d[oó]nde (echo|reposto)|gasoil m[aá]s barato|gasolina m[aá]s barata/.test(s)){
    if(!GAS.lista.length) await gasLoad(); GAS.modo=NAV.active?'ruta':'cerca'; const f=gasFiltrar(), b=f.lista.find(g=>g.precio===f.min);
    setView('gasolineras'); return sayQ(b?`La más barata ${GAS.modo==='ruta'?'en tu ruta':'cerca'} es ${b.r}, a ${nf(b.km,1)} kilómetros, a ${eur(b.precio).replace(',',' coma ')} euros el litro.`:'No encuentro gasolineras cerca.'); }
  return _sh3.apply(this,arguments); }; }
