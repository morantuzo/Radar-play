/* =====================================================================
   Radar Play · Google Maps normal
   Tipos de mapa (mapa, satélite, relieve), capas (tráfico, transporte
   público, bici), ficha de cualquier sitio del mapa (fotos, valoración,
   horario, teléfono), Street View, «Explorar cerca» y noche automática.
   ===================================================================== */
const MP={capas:Object.assign({tipo:'roadmap',transit:false,bike:false},(()=>{ try{ return JSON.parse(LS.get('rp-capas')||'{}'); }catch(e){ return {}; } })()),
  transit:null,bike:null,res:[],resMk:[],pin:null,sv:null,lastNight:null};
const saveCapas=()=>LS.set('rp-capas',JSON.stringify(MP.capas));

/* Una sola vez: pasa al mapa normal de Google (los estilos GTA siguen en Estilos) */
if(!LS.get('rp-mapas-normal')){ LS.set('rp-mapas-normal','1'); S.theme='google'; LS.set('rp-estilo','google'); }

/* ---------- Estilos propios ---------- */
document.head.insertAdjacentHTML('beforeend',`<style>
#bCapas.on,#bExp.on{background:var(--accent);color:#fff}#bCapas.on svg,#bExp.on svg{stroke:#fff}
.mp-sec{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px}
.mp-types{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.mp-type{border-radius:14px;overflow:hidden;background:var(--panel-2);border:2px solid transparent;text-align:left;padding:0}
.mp-type.on{border-color:var(--accent)}
.mp-type i{display:block;height:74px;background-size:cover;background-position:center}
.mp-type b{display:block;padding:8px 10px;font-size:15px}
.mp-togs{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.mp-tog{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:var(--panel-2);text-align:left;font-weight:700}
.mp-tog svg{width:26px;height:26px;flex:none;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.mp-tog small{display:block;font-weight:500;color:var(--muted);font-size:12.5px}
.mp-tog.on{background:var(--accent);color:#fff}.mp-tog.on small{color:rgba(255,255,255,.8)}
.mp-place .ph{height:170px;margin:-22px -22px 14px;background:var(--panel-2) center/cover;border-radius:20px 20px 0 0}
.mp-place .meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--muted);margin:4px 0 0;font-size:15px}
.mp-place .meta b{color:#fbbc04;font-weight:800}
.mp-place .open{font-weight:800}.mp-place .open.si{color:var(--ok)}.mp-place .open.no{color:var(--stop)}
.mp-place .hrs{columns:2;font-size:13px;color:var(--muted);margin:10px 0 0;padding:0;list-style:none;line-height:1.6}
.mp-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.mp-acts .pill{padding:11px 18px;font-size:15px}
.mp-cats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.mp-cat{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 6px;border-radius:14px;background:var(--panel-2);font-weight:700;font-size:14px}
.mp-cat span{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff}
.mp-cat svg{width:24px;height:24px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.mp-res{max-height:52vh;overflow:auto;margin-top:6px}
.mp-res .row{padding:11px 6px}.mp-res .row b{display:block}.mp-res .row span{color:var(--muted);font-size:13px}
.mp-res .row .r{margin-left:auto;text-align:right;flex:none;color:var(--muted);font-size:13px}.mp-res .row .r b{color:#fbbc04}
#mpsv{position:absolute;inset:0;z-index:6;background:#000}
#mpsv .pano{position:absolute;inset:0}
#mpsv .x{position:absolute;left:16px;top:16px;z-index:2;background:rgba(8,10,13,.9);color:#fff;border-radius:999px;padding:12px 20px;font-weight:800;font-size:16px}
#mpsv .t{position:absolute;left:50%;transform:translateX(-50%);bottom:16px;z-index:2;background:rgba(8,10,13,.85);color:#fff;border-radius:12px;padding:8px 14px;font-size:14px;max-width:70%;text-align:center}
body[data-nav] .mp-resbar{bottom:96px}
.mp-resbar{position:absolute;left:14px;bottom:14px;z-index:3;display:flex;gap:8px;align-items:center;background:rgba(8,10,13,.93);border-radius:14px;padding:8px 8px 8px 14px;font-weight:700}
</style>`);

/* ---------- Capas y tipo de mapa ---------- */
function mapAfterStyle(){
  if(!map) return;
  map.setOptions({mapTypeId:MP.capas.tipo||'roadmap'});
  if(G.TransitLayer){ if(!MP.transit) MP.transit=new G.TransitLayer(); MP.transit.setMap(MP.capas.transit?map:null); }
  if(G.BicyclingLayer){ if(!MP.bike) MP.bike=new G.BicyclingLayer(); MP.bike.setMap(MP.capas.bike?map:null); }
  const b=$('bCapas'); if(b) b.classList.toggle('on',MP.capas.tipo!=='roadmap'||MP.capas.transit||MP.capas.bike||!!NAV.setts.traffic);
  MP.lastNight=themeNight(THEMES[S.theme]);
}
const SAT='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 70"><rect width="120" height="70" fill="#3f5a36"/><path d="M0 40 C30 30 50 55 120 35 V70 H0z" fill="#56703f"/><rect x="62" y="8" width="18" height="14" fill="#9a8f7a"/><rect x="84" y="12" width="14" height="10" fill="#b3a68c"/><path d="M0 26 L120 18" stroke="#c9c2b3" stroke-width="3"/><path d="M40 0 L58 70" stroke="#c9c2b3" stroke-width="2.5"/></svg>');
const MAPA='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 70"><rect width="120" height="70" fill="#f1f3f4"/><rect x="70" y="0" width="50" height="30" fill="#c3ecb2"/><path d="M0 52 C40 46 70 60 120 50 V70 H0z" fill="#aadaff"/><path d="M0 26 L120 18" stroke="#fdd663" stroke-width="5"/><path d="M40 0 L58 70" stroke="#fff" stroke-width="4"/><path d="M40 0 L58 70" stroke="#dadce0" stroke-width="5" opacity=".4"/></svg>');
const RELIEVE='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 70"><rect width="120" height="70" fill="#e9eee0"/><path d="M10 60 Q40 10 70 45 T120 25 V70 H0z" fill="#d3dcc3"/><path d="M30 64 Q55 30 80 52" fill="none" stroke="#b9c4a6" stroke-width="2"/><path d="M50 66 Q70 46 92 60" fill="none" stroke="#b9c4a6" stroke-width="2"/><path d="M0 22 L120 30" stroke="#fff" stroke-width="3.5"/></svg>');
const IC={traf:'<rect x="8" y="2" width="8" height="20" rx="3"/><circle cx="12" cy="7" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="17" r="1.4"/>',
  bus:'<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 21v-3M16 21v-3"/><circle cx="8.5" cy="14.5" r=".8"/><circle cx="15.5" cy="14.5" r=".8"/>',
  bike:'<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8M10 8l2 8h-6M14 5h3"/>',
  sv:'<circle cx="12" cy="5" r="2.5"/><path d="M9 21l1-7-2-1 1-4h6l1 4-2 1 1 7"/>'};
function capasScreen(){
  const c=MP.capas, t=(k,n,img)=>`<button class="mp-type ${c.tipo===k?'on':''}" data-tipo="${k}"><i style="background-image:url('${img}')"></i><b>${n}</b></button>`;
  const g=(id,on,ic,n,sub)=>`<button class="mp-tog ${on?'on':''}" id="${id}"><svg viewBox="0 0 24 24">${IC[ic]}</svg><span>${n}<small>${sub}</small></span></button>`;
  const th=THEMES[S.theme];
  overlay(`<h2>Capas del mapa</h2>
    <div class="mp-sec">Tipo de mapa</div><div class="mp-types">${t('roadmap','Mapa',MAPA)}${t('hybrid','Satélite',SAT)}${t('terrain','Relieve',RELIEVE)}</div>
    <div class="mp-sec">Detalles del mapa</div><div class="mp-togs">
      ${g('gTraf',NAV.setts.traffic,'traf','Tráfico','Atascos en tiempo real')}
      ${g('gBus',c.transit,'bus','Transporte público','Metro, Cercanías y autobús')}
      ${g('gBike',c.bike,'bike','En bici','Carriles y rutas ciclistas')}
      ${g('gSV',false,'sv','Street View','Ver la calle en el centro del mapa')}</div>
    <div class="mp-sec">Aspecto</div>
    <div class="set" style="padding:6px 4px;border:0"><div><b>${esc(th.name)}</b><div class="muted">${esc(th.sub)}${th.auto?' · ahora '+(themeNight(th)?'de noche':'de día'):''}</div></div><button class="pill" id="gEst">Cambiar</button></div>
    <div style="margin-top:12px;text-align:right"><button class="pill on" id="cOv">Hecho</button></div>`);
  $('cOv').onclick=closeOv;
  document.querySelectorAll('[data-tipo]').forEach(b=>b.onclick=()=>{ c.tipo=b.dataset.tipo; saveCapas(); mapAfterStyle(); capasScreen(); });
  $('gTraf').onclick=()=>{ toggleTraffic(); mapAfterStyle(); capasScreen(); };
  $('gBus').onclick=()=>{ c.transit=!c.transit; saveCapas(); mapAfterStyle(); capasScreen(); };
  $('gBike').onclick=()=>{ c.bike=!c.bike; saveCapas(); mapAfterStyle(); capasScreen(); };
  $('gSV').onclick=()=>{ closeOv(); const p=map.getCenter(); streetView(p&&p.toJSON?p.toJSON():S.pos); };
  $('gEst').onclick=()=>styleScreen();
}

/* ---------- Ficha de un sitio (al tocar cualquier icono del mapa) ---------- */
const stars=r=>'★'.repeat(Math.round(r))+'☆'.repeat(5-Math.round(r));
const PRICE={INEXPENSIVE:'€',MODERATE:'€€',EXPENSIVE:'€€€',VERY_EXPENSIVE:'€€€€'};
const llj=p=>p?(p.toJSON?p.toJSON():{lat:+(typeof p.lat==='function'?p.lat():p.lat),lng:+(typeof p.lng==='function'?p.lng():p.lng)}):null;
async function placeCard(id,where){
  overlay(`<div class="mp-place"><h2>Cargando…</h2><p>Buscando la información del sitio.</p></div>`);
  let pl=null;
  try{ const {Place}=await G.importLibrary('places'); pl=new Place({id,requestedLanguage:'es'});
    await pl.fetchFields({fields:['displayName','formattedAddress','location','rating','userRatingCount','priceLevel','regularOpeningHours','nationalPhoneNumber','websiteURI','photos','primaryTypeDisplayName','googleMapsURI']}); }
  catch(e){ console.warn('Place',e); pl=null; }
  if($('ov').hidden) return;
  if(!pl) return spotCard(llj(where),'Sitio del mapa','No he podido leer la ficha. Activa «Places API (New)» en Google Cloud para ver fotos, horarios y teléfono.');
  let abierto=null; try{ abierto=pl.isOpen?await pl.isOpen():null; }catch(e){}
  const loc=llj(pl.location)||llj(where), name=pl.displayName||'Sitio';
  let foto=''; try{ if(pl.photos&&pl.photos[0]) foto=pl.photos[0].getURI({maxHeight:400,maxWidth:900}); }catch(e){}
  const hrs=pl.regularOpeningHours&&pl.regularOpeningHours.weekdayDescriptions||[];
  const dest={name,address:pl.formattedAddress||'',loc};
  overlay(`<div class="mp-place">${foto?`<div class="ph" style="background-image:url('${foto}')"></div>`:''}<h2>${esc(name)}</h2>
    <div class="meta">${pl.rating?`<span><b>${String(pl.rating).replace('.',',')} ${stars(pl.rating)}</b> (${nf(pl.userRatingCount||0)})</span>`:''}${pl.primaryTypeDisplayName?`<span>${esc(pl.primaryTypeDisplayName)}</span>`:''}${PRICE[pl.priceLevel]?`<span>${PRICE[pl.priceLevel]}</span>`:''}${abierto!=null?`<span class="open ${abierto?'si':'no'}">${abierto?'Abierto ahora':'Cerrado ahora'}</span>`:''}${S.pos&&loc?`<span>a ${fmtDist(G.geometry.spherical.computeDistanceBetween(S.pos,loc))}</span>`:''}</div>
    <p style="margin:8px 0 0">${esc(pl.formattedAddress||'')}${pl.nationalPhoneNumber?' · '+esc(pl.nationalPhoneNumber):''}</p>
    ${hrs.length?`<ul class="hrs">${hrs.map(h=>`<li>${esc(h)}</li>`).join('')}</ul>`:''}
    <div class="mp-acts"><button class="pill on" id="pGo">Cómo llegar</button>${NAV.active?'<button class="pill" id="pStop">Añadir parada</button>':''}
      ${pl.nationalPhoneNumber?'<button class="pill" id="pCall">Llamar</button>':''}<button class="pill" id="pSV">Street View</button>
      ${pl.websiteURI?`<a class="pill" href="${esc(pl.websiteURI)}" target="_blank" rel="noopener">Web</a>`:''}<span style="flex:1"></span><button class="pill" id="cOv">Cerrar</button></div></div>`);
  $('cOv').onclick=closeOv;
  $('pGo').onclick=()=>{ closeOv(); previewTo(dest); };
  if($('pStop')) $('pStop').onclick=()=>{ closeOv(); addStop(dest); };
  if($('pCall')) $('pCall').onclick=()=>{ closeOv(); phDial(name,pl.nationalPhoneNumber); };
  $('pSV').onclick=()=>{ closeOv(); streetView(loc,name); };
}
/* Un punto cualquiera (mantén pulsado el mapa) */
async function spotCard(p,title='Punto en el mapa',nota=''){
  if(!p) return;
  const coords=p.lat.toFixed(5)+', '+p.lng.toFixed(5);
  const draw=dir=>overlay(`<div class="mp-place"><h2>${esc(title)}</h2><p>${esc(dir||coords)}${nota?'<br>'+esc(nota):''}</p>
    <div class="meta">${S.pos?`<span>a ${fmtDist(G.geometry.spherical.computeDistanceBetween(S.pos,p))}</span>`:''}<span>${coords}</span></div>
    <div class="mp-acts"><button class="pill on" id="pGo">Ir aquí</button>${NAV.active?'<button class="pill" id="pStop">Añadir parada</button>':''}<button class="pill" id="pSV">Street View</button><span style="flex:1"></span><button class="pill" id="cOv">Cerrar</button></div></div>`);
  const bind=dir=>{ const d={name:dir?dir.split(',')[0]:title,address:dir||coords,loc:p};
    $('cOv').onclick=()=>{ closeOv(); clearPin(); }; $('pGo').onclick=()=>{ closeOv(); clearPin(); previewTo(d); };
    if($('pStop')) $('pStop').onclick=()=>{ closeOv(); clearPin(); addStop(d); }; $('pSV').onclick=()=>{ closeOv(); streetView(p,dir); }; };
  draw(''); bind('');
  if(G.Geocoder&&!nota){ try{ const {results}=await new G.Geocoder().geocode({location:p,language:'es'}); const dir=results&&results[0]&&results[0].formatted_address;
    if(dir&&!$('ov').hidden&&$('pGo')){ draw(dir); bind(dir); } }catch(e){} }
}
function clearPin(){ if(MP.pin){ MP.pin.setMap(null); MP.pin=null; } }
const fmtDist=m=>m<1000?Math.round(m/10)*10+' m':(m/1000).toFixed(m<10000?1:0).replace('.',',')+' km';

/* ---------- Street View ---------- */
async function streetView(p,title){
  if(!p||!G.StreetViewPanorama){ toast('Street View no está disponible'); return; }
  let pos=p, head=0;
  try{ const sv=new G.StreetViewService(); const r=await sv.getPanorama({location:p,radius:120,source:G.StreetViewSource?G.StreetViewSource.OUTDOOR:undefined});
    const d=r&&r.data; if(!d||!d.location){ toast('No hay Street View en este sitio'); return; }
    pos=llj(d.location.latLng); head=G.geometry.spherical.computeHeading(pos,p)||0; }
  catch(e){ toast('No hay Street View en este sitio'); return; }
  let box=$('mpsv'); if(!box){ $('stage').insertAdjacentHTML('beforeend','<div id="mpsv"><div class="pano" id="mpsvp"></div><button class="x" id="mpsvx">✕ Volver al mapa</button><div class="t" id="mpsvt"></div></div>'); box=$('mpsv'); $('mpsvx').onclick=closeSV; }
  box.hidden=false; $('mpsvt').textContent=title||'Street View'; $('mpsvt').hidden=!title;
  MP.sv=new G.StreetViewPanorama($('mpsvp'),{position:pos,pov:{heading:head,pitch:0},zoom:0,addressControl:false,fullscreenControl:false,motionTracking:false,motionTrackingControl:false,enableCloseButton:false,showRoadLabels:true,linksControl:true,panControl:true,zoomControl:true});
}
function closeSV(){ const b=$('mpsv'); if(b) b.hidden=true; if(MP.sv){ MP.sv.setVisible&&MP.sv.setVisible(false); MP.sv=null; } }

/* ---------- Explorar cerca ---------- */
const EXPL=[['Gasolineras','gasolinera','#1a73e8','<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 11h10M14 8l3 3v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>'],
  ['Aparcamiento','aparcamiento','#1967d2','<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V8h3a2.5 2.5 0 0 1 0 5h-3"/>'],
  ['Restaurantes','restaurante','#e8710a','<path d="M7 2v20M4 2v6a3 3 0 0 0 6 0V2M17 2c-2 2-3 5-3 8h3v12"/>'],
  ['Cafeterías','cafetería','#a0522d','<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2.5 2.5 0 0 1 0 5h-2M8 2v3M12 2v3"/>'],
  ['Supermercados','supermercado','#188038','<circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11L21 7H6"/>'],
  ['Talleres','taller mecánico','#5f6368','<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/>'],
  ['Farmacias','farmacia','#d93025','<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 7v10M7 12h10"/>'],
  ['Cajeros','cajero automático','#137333','<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>'],
  ['Hoteles','hotel','#c5221f','<path d="M3 20V6M3 14h18v6M21 14v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="10" r="2"/>'],
  ['Cargadores','punto de carga eléctrico','#12b5cb','<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'],
  ['Lavado de coches','lavado de coches','#4285f4','<path d="M5 17h14M4 17v-4l2-5h12l2 5v4M4 13h16"/><path d="M8 3v2M12 2v3M16 3v2"/>'],
  ['Hospitales','hospital','#d93025','<path d="M4 21V5h16v16M9 21v-4h6v4M12 8v5M9.5 10.5h5"/>']];
function exploreScreen(){
  overlay(`<h2>Explorar cerca</h2><p>${NAV.active?'Busca alrededor de donde vas ahora.':'Busca alrededor del centro del mapa.'}</p>
    <div class="mp-cats">${EXPL.map((c,i)=>`<button class="mp-cat" data-cat="${i}"><span style="background:${c[2]}"><svg viewBox="0 0 24 24">${c[3]}</svg></span>${c[0]}</button>`).join('')}</div>
    <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">${MP.res.length?'<button class="pill" id="eClr">Quitar resultados</button>':''}<button class="pill on" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv; if($('eClr')) $('eClr').onclick=()=>{ clearRes(); closeOv(); };
  document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>explore(EXPL[+b.dataset.cat]));
}
async function explore(cat){
  const c=NAV.active&&S.pos?S.pos:llj(map.getCenter())||S.pos;
  overlay(`<h2>${cat[0]}</h2><p>Buscando cerca…</p>`);
  let res=[];
  try{ const {Place}=await G.importLibrary('places');
    const {places}=await Place.searchByText({textQuery:cat[1],fields:['id','displayName','formattedAddress','location','rating','userRatingCount','regularOpeningHours'],locationBias:{center:c,radius:4000},maxResultCount:12,language:'es',region:'es'});
    res=(places||[]).map(p=>({id:p.id,name:p.displayName,address:p.formattedAddress||'',loc:llj(p.location),rating:p.rating||0,n:p.userRatingCount||0}))
      .filter(r=>r.loc).map(r=>({...r,d:G.geometry.spherical.computeDistanceBetween(c,r.loc)})).sort((a,b)=>a.d-b.d); }
  catch(e){ console.warn(e); overlay(`<h2>${cat[0]}</h2><p>No he podido buscar. Comprueba la conexión y que «Places API (New)» esté activada en Google Cloud.</p><div style="text-align:right"><button class="pill on" id="cOv">Cerrar</button></div>`); $('cOv').onclick=closeOv; return; }
  clearRes(); MP.res=res; MP.cat=cat;
  MP.resMk=res.map((r,i)=>{ const m=new G.Marker({map,position:r.loc,zIndex:20,label:{text:String(i+1),color:'#fff',fontWeight:'700',fontSize:'12px'},
    icon:{path:'M12 0C5.4 0 0 5.4 0 12c0 9 12 22 12 22s12-13 12-22C24 5.4 18.6 0 12 0z',fillColor:cat[2],fillOpacity:1,strokeColor:'#fff',strokeWeight:1.5,scale:1.15,anchor:new G.Point(12,34),labelOrigin:new G.Point(12,12)}});
    m.addListener('click',()=>r.id?placeCard(r.id,r.loc):spotCard(r.loc,r.name)); return m; });
  if(res.length&&G.LatLngBounds&&map.fitBounds){ const b=new G.LatLngBounds(); res.slice(0,8).forEach(r=>b.extend(r.loc)); b.extend(c); S.follow=false; map.fitBounds(b,80); }
  showRes(); resBar();
}
function showRes(){
  const cat=MP.cat, res=MP.res;
  overlay(`<h2>${cat[0]} cerca</h2>${res.length?`<div class="mp-res">${res.map((r,i)=>`<button class="row" data-ri="${i}"><b style="width:26px;flex:none;color:${cat[2]}">${i+1}</b><div style="min-width:0"><b>${esc(r.name)}</b><span>${esc(r.address)}</span></div><div class="r">${fmtDist(r.d)}${r.rating?`<br><b>★ ${String(r.rating).replace('.',',')}</b>`:''}</div></button>`).join('')}</div>`:'<p>No he encontrado nada cerca.</p>'}
    <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end"><button class="pill" id="eOtra">Otra categoría</button><button class="pill on" id="cOv">Ver en el mapa</button></div>`);
  $('cOv').onclick=closeOv; $('eOtra').onclick=exploreScreen;
  document.querySelectorAll('[data-ri]').forEach(b=>b.onclick=()=>{ const r=res[+b.dataset.ri]; r.id?placeCard(r.id,r.loc):spotCard(r.loc,r.name); });
}
function resBar(){
  let b=$('mpres'); if(b) b.remove(); if(!MP.res.length) return;
  $('stage').insertAdjacentHTML('beforeend',`<div class="mp-resbar" id="mpres">${esc(MP.cat[0])}: ${MP.res.length}<button class="pill" data-mp="lista">Lista</button><button class="pill" data-mp="quitar">Quitar</button></div>`);
}
function clearRes(){ MP.resMk.forEach(m=>m.setMap(null)); MP.resMk=[]; MP.res=[]; const b=$('mpres'); if(b) b.remove(); $('bExp')&&$('bExp').classList.remove('on'); }

/* ---------- Conexión con el mapa ---------- */
const _navInit4=navInit; navInit=function(...a){ _navInit4(...a);
  mapAfterStyle();
  map.addListener('click',e=>{ if(e&&e.placeId){ e.stop&&e.stop(); placeCard(e.placeId,e.latLng); } });
  map.addListener('contextmenu',e=>{ if(!e||!e.latLng) return; const p=llj(e.latLng); clearPin();
    MP.pin=new G.Marker({map,position:p,zIndex:25}); spotCard(p); });
  /* Noche automática: revisa cada 5 minutos si ha anochecido o amanecido */
  setInterval(()=>{ const t=THEMES[S.theme]; if(t&&t.auto&&themeNight(t)!==MP.lastNight) applyStyle(); },300000);
};
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-mp]'); if(!el) return; e.stopPropagation(); const a=el.dataset.mp;
  if(!map){ toast('El mapa aún no ha cargado'); return; }
  if(a==='capas') capasScreen();
  if(a==='explorar') exploreScreen();
  if(a==='lista') showRes();
  if(a==='quitar') clearRes();
},true);
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&$('mpsv')&&!$('mpsv').hidden) closeSV(); });

/* Siri: «busca gasolineras», «vista de satélite», «pon el tráfico», «Street View» */
if(typeof siriHandle==='function'){ const _sh2=siriHandle; siriHandle=function(t){ const s=(t||'').toLowerCase();
  const cat=EXPL.find(c=>s.includes(c[0].toLowerCase().slice(0,-1))||s.includes(c[1].split(' ')[0]));
  if(cat&&/busca|cerca|dónde|donde|hay/.test(s)){ setView('mapas'); explore(cat); return sayQ('Buscando '+cat[0].toLowerCase()+' cerca.'); }
  if(/sat[eé]lite/.test(s)){ MP.capas.tipo='hybrid'; saveCapas(); mapAfterStyle(); return sayQ('Vista de satélite.'); }
  if(/relieve|terreno/.test(s)){ MP.capas.tipo='terrain'; saveCapas(); mapAfterStyle(); return sayQ('Mapa de relieve.'); }
  if(/mapa normal|vista normal/.test(s)){ MP.capas.tipo='roadmap'; saveCapas(); mapAfterStyle(); return sayQ('Mapa normal.'); }
  if(/street ?view|vista de calle/.test(s)){ setView('mapas'); return streetView(S.pos); }
  return _sh2.apply(this,arguments); }; }
