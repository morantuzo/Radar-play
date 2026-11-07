/* =====================================================================
   Radar Play · Vista 3D al navegar (como Google Maps en el móvil)
   Con un «ID de mapa» vectorial de Google Cloud el mapa se inclina, gira
   para que siempre vayas hacia arriba y la cámara sigue al coche con
   suavidad. Sin ID de mapa sigue la vista desde arriba de siempre.
   ===================================================================== */
const V3={id:LS.get('rp-mapid')||'',on:LS.get('rp-3d')!=='0',puck:null,raf:0,cam:null,night:null,ok:false};
const v3Activo=()=>V3.ok&&V3.on&&NAV.active&&S.follow;

/* Opciones del mapa principal: vectorial con ID de mapa (solo con los estilos de Google) */
/* ¿Puede este Chromium dibujar el mapa vectorial? Necesita WebGL (aceleración gráfica) */
V3.webgl=(()=>{ try{ const c=document.createElement('canvas'); return !!(c.getContext('webgl2')||c.getContext('webgl')); }catch(e){ return false; } })();
V3.fallo=LS.get('rp-mapid-fallo')||'';
let v3Sin=false; try{ v3Sin=sessionStorage.getItem('rp-sin-mapid')==='1'; sessionStorage.removeItem('rp-sin-mapid'); }catch(e){}
function v3Limpiar(v){ return String(v||'').replace(/[\s"'«»“”]+/g,'').replace(/^(ID)?(de)?mapa:?/i,'').replace(/^mapId[:=]/i,''); }
function v3Valido(v){
  if(!v) return 'Pega el ID de mapa';
  if(/^AIza/.test(v)) return 'Eso es la clave de Google Maps, no el ID de mapa. Copia la columna «ID de mapa».';
  if(/^A[lI1]za/i.test(v)) return 'Eso parece la clave mal escrita. El ID de mapa no empieza por «AIza»';
  if(!/^[0-9a-zA-Z_-]{8,40}$/.test(v)) return 'El ID de mapa son solo letras y números, sin espacios (p. ej. 8f3a2c1b4d5e6f70)';
  return '';
}
function v3Fallo(msg){ if(!msg) return; V3.fallo=msg; LS.set('rp-mapid-fallo',msg); if(typeof RPLOG!=='undefined') RPLOG.aviso('ID de mapa: '+msg); }
/* Lo que Google dice del ID de mapa en la consola, para enseñarlo claro */
V3.msgs=[];
['error','warn'].forEach(k=>{ const o=console[k]; console[k]=function(...a){ try{ const t=a.map(x=>x&&x.message||String(x)).join(' ');
  if(/map ?id|mapid|vector|webgl/i.test(t)) V3.msgs.push(t.slice(0,300)); }catch(e){} return o.apply(this,a); }; });

function mapOpts3D(base){
  const t=THEMES[S.theme];
  if(!V3.id||!t.google) return base;
  if(v3Sin){ toast('El mapa no cargaba con el ID de mapa: hoy va sin vista 3D. Mira Ajustes › ID de mapa'); return base; }
  if(!V3.webgl){ v3Fallo('Esta Raspberry no tiene activada la aceleración gráfica (WebGL), que la vista 3D necesita. Reinstala con la última versión o reinicia.'); return base; }
  V3.ok=true; V3.night=themeNight(t);
  const o={...base,mapId:V3.id,tiltInteractionEnabled:true,headingInteractionEnabled:true};
  delete o.styles;                                   // con ID de mapa el aspecto lo pone Google
  if(G.RenderingType) o.renderingType=G.RenderingType.VECTOR;
  if(G.ColorScheme) o.colorScheme=V3.night?G.ColorScheme.DARK:G.ColorScheme.LIGHT;
  return o;
}

/* Flecha azul del coche, como la de Google Maps */
const PUCK=`<div class="v3puck"><svg viewBox="0 0 48 48" width="46" height="46"><path d="M24 3 41 43 24 34 7 43Z" fill="#1a73e8" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/></svg></div>`;
document.head.insertAdjacentHTML('beforeend',`<style>
.v3puck{width:46px;height:46px;transform-origin:50% 50%;filter:drop-shadow(0 3px 5px rgba(0,0,0,.45));transition:transform .25s linear}
body[data-v3] .mctl [data-act="zin"],body[data-v3] .mctl [data-act="zout"]{display:none}
#b3d{display:none}body[data-nav] #b3d{display:flex}
#b3d b{font-family:var(--f-d);font-size:22px;color:var(--fg);line-height:1}
#b3d.on{background:var(--accent)}#b3d.on b,#b3d.on small{color:#fff}
.v3-in{display:flex;gap:8px;margin-top:8px}.v3-in input{flex:1;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--fg);font:inherit}
</style>`);

async function puckInit(){
  if(!V3.ok||!map) return;
  try{ const {AdvancedMarkerElement}=await G.importLibrary('marker');
    const d=document.createElement('div'); d.innerHTML=PUCK;
    V3.puck=new AdvancedMarkerElement({map,position:S.pos||FALLBACK,content:d.firstChild,zIndex:30});
    carMarker.setMap(null);                            // la flecha nueva sustituye a la clásica
  }catch(e){ console.warn('3D',e); V3.puck=null; }
}
function puckMove(){
  if(!V3.puck) return; V3.puck.position=S.pos;
  const h=(map.getHeading&&map.getHeading())||0, el=V3.puck.content; if(el) el.style.transform=`rotate(${(S.heading-h).toFixed(1)}deg)`;
}

/* Cámara: un poco por delante del coche, inclinada y girada con el rumbo; se mueve con suavidad */
function camTarget(){
  const p=S.pos, z=E.v>90?16.4:E.v>55?17:E.v>25?17.6:18.2;
  const mpp=156543.03392*Math.cos(p.lat*Math.PI/180)/Math.pow(2,z), h=$('map').clientHeight||600;
  const c=SPH().computeOffset(new G.LatLng(p.lat,p.lng),h*.28*mpp,S.heading);
  return {lat:c.lat(),lng:c.lng(),heading:S.heading,zoom:z,tilt:60};
}
const ang=(a,b,f)=>{ let d=b-a; while(d>180)d-=360; while(d<-180)d+=360; return (a+d*f+360)%360; };
function camLoop(){
  V3.raf=0; if(!v3Activo()||!S.pos){ document.body.removeAttribute('data-v3'); return; }
  document.body.dataset.v3='1';
  const t=camTarget(), c=V3.cam||t, f=.12;
  V3.cam={lat:c.lat+(t.lat-c.lat)*f,lng:c.lng+(t.lng-c.lng)*f,heading:ang(c.heading,t.heading,f),zoom:c.zoom+(t.zoom-c.zoom)*.05,tilt:c.tilt+(t.tilt-c.tilt)*.08};
  map.moveCamera({center:{lat:V3.cam.lat,lng:V3.cam.lng},heading:V3.cam.heading,zoom:V3.cam.zoom,tilt:V3.cam.tilt});
  puckMove(); V3.raf=requestAnimationFrame(camLoop);
}
function camStart(){ if(!V3.raf&&v3Activo()){ V3.cam={...camTarget(),...(map.getCenter()?{lat:map.getCenter().lat(),lng:map.getCenter().lng()}:{}),heading:(map.getHeading&&map.getHeading())||0,tilt:(map.getTilt&&map.getTilt())||0,zoom:map.getZoom()||16}; V3.raf=requestAnimationFrame(camLoop); } }
function camFlat(){ if(!V3.ok||!map) return; V3.cam=null; document.body.removeAttribute('data-v3');
  if(map.moveCamera) map.moveCamera({tilt:0,heading:0}); puckMove(); }

/* Engancha con el resto de Radar Play */
const _followCam=followCam; followCam=function(){ if(V3.ok&&V3.on){ camStart(); return; } return _followCam(); };
const _moveCar=moveCar; moveCar=function(p){ _moveCar(p); puckMove(); };
const _startNav3=startNav; startNav=function(...a){ const r=_startNav3(...a); setTimeout(()=>{ upd3dBtn(); camStart(); },50); return r; };
const _clearRoute3=clearRoute; clearRoute=function(...a){ const r=_clearRoute3(...a); camFlat(); return r; };
function v3Vigilar(){
  if(!V3.ok||!map) return;
  let cargado=false; G.event.addListenerOnce(map,'tilesloaded',()=>{ cargado=true; });
  setTimeout(()=>{
    const rt=map.getRenderingType&&map.getRenderingType();
    const g=V3.msgs.find(m=>/map ?id|mapid/i.test(m));
    if(!cargado&&!navigator.onLine) return;
    if(!cargado){ v3Fallo('El mapa no terminaba de cargar con el ID de mapa'+(g?': '+g:'')); try{ sessionStorage.setItem('rp-sin-mapid','1'); }catch(e){} location.reload(); return; }
    if(rt&&String(rt).toUpperCase()==='RASTER'){
      V3.ok=false; upd3dBtn(); if(V3.puck){ V3.puck.map=null; V3.puck=null; carMarker.setMap(map); }
      v3Fallo(g?'Google dice: '+g:'El ID de mapa no da un mapa vectorial. En Gestión de mapas revisa que sea tipo «JavaScript» › «Vectorial» y que esté en el mismo proyecto que tu clave.');
      toast('La vista 3D no funciona con ese ID de mapa. Mira Ajustes › ID de mapa'); return; }
    if(g&&/not|invalid|no válid|no encontrad/i.test(g)){ v3Fallo('Google dice: '+g); return; }
    if(V3.fallo){ V3.fallo=''; LS.set('rp-mapid-fallo',''); if(typeof RPLOG!=='undefined') RPLOG.info('ID de mapa: vista 3D funcionando'); }
  },20000);
}
const _navInit5=navInit; navInit=function(...a){ _navInit5(...a); puckInit(); upd3dBtn(); v3Vigilar();
  /* Al anochecer o amanecer: con mapa vectorial hay que recargarlo; se hace cuando estés parado y sin ruta */
  setInterval(()=>{ if(!V3.ok) return; const n=themeNight(THEMES[S.theme]); if(n!==V3.night&&!NAV.active&&(E.v||0)<3&&$('ov').hidden) location.reload(); },60000); };

/* Botón 3D/2D (aparece al navegar, en lugar de + y −) */
(function(){ const z=document.querySelector('.mctl [data-act="zin"]'); if(!z) return;
  z.insertAdjacentHTML('beforebegin','<button class="mbtn" id="b3d" data-v3="t" aria-label="Vista 3D o desde arriba"><b>3D</b><small>Vista</small></button>'); })();
function upd3dBtn(){ const b=$('b3d'); if(!b) return; b.hidden=!V3.ok; b.classList.toggle('on',V3.on); b.querySelector('b').textContent=V3.on?'3D':'2D'; }
document.addEventListener('click',e=>{ const el=e.target.closest('[data-v3]'); if(!el) return; e.stopPropagation();
  if(!V3.ok){ toast('Pon tu ID de mapa en Capas para la vista 3D'); return; }
  V3.on=!V3.on; LS.set('rp-3d',V3.on?'1':'0'); upd3dBtn();
  if(V3.on){ S.follow=true; camStart(); } else { cancelAnimationFrame(V3.raf); V3.raf=0; camFlat(); if(NAV.active) _followCam(); }
},true);
/* «Centrar» también vuelve a la cámara de navegación */
document.addEventListener('click',e=>{ const el=e.target.closest('[data-act="center"]'); if(el&&NAV.active) setTimeout(camStart,30); });

/* Ajuste en Capas: ID de mapa */
const _capas3=capasScreen; capasScreen=function(){ _capas3();
  const secs=document.querySelectorAll('#ovbox .mp-sec'), h=secs[secs.length-1]; if(!h) return;
  h.insertAdjacentHTML('beforebegin',`<div class="mp-sec">Vista 3D al navegar</div>
    <div class="set" style="padding:6px 4px;border:0;flex-direction:column;align-items:stretch">
      <div class="muted">${V3.ok?'Activa. El mapa se inclina y gira con el coche, como en el móvil.':V3.id&&V3.fallo?'No funciona: '+esc(V3.fallo):V3.id&&!THEMES[S.theme].google?'Solo funciona con los estilos de Google Maps.':'Pega el ID de mapa vectorial que crees en Google Cloud (Gestión de mapas).'}</div>
      <div class="v3-in"><input type="text" id="v3id" placeholder="ID de mapa, p. ej. 8f3a2c1b4d5e6f70" value="${esc(V3.id)}"><button class="pill on" id="v3ok">Guardar</button>${V3.id?'<button class="pill" id="v3del">Quitar</button>':''}</div></div>`);
  $('v3ok').onclick=()=>{ const v=v3Limpiar($('v3id').value); const er=v&&v3Valido(v); if(er) return toast(er); LS.set('rp-mapid',v); LS.set('rp-mapid-fallo',''); if(typeof syncPush==='function') syncPush(true); toast(v?'Guardado. Recargando el mapa…':'Quitado'); setTimeout(()=>location.reload(),700); };
  if($('v3del')) $('v3del').onclick=()=>{ LS.set('rp-mapid',''); location.reload(); };
};

/* Cambiar entre estilos de Google y GTA con ID de mapa necesita recargar el mapa (vectorial ↔ normal) */
const _applyStyle3=applyStyle; applyStyle=function(){
  const quiere=!!(V3.id&&THEMES[S.theme].google);
  if(map&&quiere!==V3.ok){ if(!NAV.active) return location.reload(); }
  if(V3.ok&&quiere&&themeNight(THEMES[S.theme])!==V3.night&&!NAV.active) return location.reload();
  if(V3.ok&&quiere){ setAccent(); radar&&radar.setOptions({styles:gStyle(THEMES[S.theme])}); if(typeof mapAfterStyle==='function') mapAfterStyle(); carMarker.setIcon(carIcon()); return; }
  return _applyStyle3();
};

/* También en Ajustes, debajo de la clave de Google Maps */
function v3IdScreen(){
  overlay(`<h2>ID de mapa (vista 3D)</h2><p>Créalo en Google Cloud: Google Maps Platform › Gestión de mapas › Crear ID de mapa › tipo <b>JavaScript</b> › <b>Vectorial</b>, con Inclinación y Rotación marcadas. Tiene que estar en el <b>mismo proyecto</b> que tu clave. Copia el ID y pégalo aquí.</p>
    ${V3.fallo&&V3.id?`<div class="note" style="border:1px solid var(--stop);margin-bottom:10px"><b style="color:var(--fg)">Último fallo:</b> ${esc(V3.fallo)}</div>`:''}
    ${V3.webgl?'':'<div class="note" style="border:1px solid var(--stop);margin-bottom:10px">Este navegador no tiene WebGL: la vista 3D no puede funcionar aquí.</div>'}
    <div class="field"><input type="text" id="v3id2" placeholder="Por ejemplo 8f3a2c1b4d5e6f70" value="${esc(V3.id)}"><button class="pill" id="v3test">Comprobar</button><button class="pill on" id="v3ok2">Guardar</button></div>
    <div id="v3res" class="muted" style="margin-top:8px"></div><div id="v3prueba" style="position:fixed;left:-2000px;top:0;width:320px;height:220px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${V3.id?'<button class="pill" id="v3del2">Quitar</button>':''}<button class="pill" id="cOv">Cancelar</button></div>`);
  $('cOv').onclick=closeOv;
  const guardar=v=>{ LS.set('rp-mapid',v); LS.set('rp-mapid-fallo',''); if(typeof syncPush==='function') syncPush(true); toast('Guardado. Recargando el mapa…'); setTimeout(()=>location.reload(),900); };
  $('v3ok2').onclick=()=>{ const v=v3Limpiar($('v3id2').value); const er=v3Valido(v); if(er) return toast(er); guardar(v); };
  $('v3test').onclick=async()=>{ const v=v3Limpiar($('v3id2').value); const er=v3Valido(v); if(er) return toast(er);
    const out=$('v3res'); out.textContent='Comprobando con Google… (10 segundos)'; const r=await v3Comprobar(v);
    out.innerHTML=(r.ok?'<b style="color:#34a853">✓ Funciona.</b> ':'<b style="color:var(--stop)">✕ No funciona.</b> ')+esc(r.msg); };
  if($('v3del2')) $('v3del2').onclick=()=>{ LS.set('rp-mapid',''); LS.set('rp-mapid-fallo',''); if(typeof syncPush==='function') syncPush(true); setTimeout(()=>location.reload(),500); };
}
/* Prueba el ID en un mapa pequeño escondido: ¿es vectorial y se puede inclinar? */
async function v3Comprobar(id){
  if(!window.google||!G) return {ok:false,msg:'Google Maps no ha cargado: primero tiene que funcionar la clave.'};
  if(!V3.webgl) return {ok:false,msg:'Este navegador no tiene WebGL (aceleración gráfica), que la vista 3D necesita.'};
  const box=$('v3prueba'); if(!box) return {ok:false,msg:'Cancelado'};
  const n0=V3.msgs.length;
  try{
    const {Map}=await G.importLibrary('maps');
    const o={center:S.pos||FALLBACK,zoom:17,mapId:id,disableDefaultUI:true}; if(G.RenderingType) o.renderingType=G.RenderingType.VECTOR;
    const m=new Map(box,o);
    const cargo=await new Promise(res=>{ const t=setTimeout(()=>res(false),10000); G.event.addListenerOnce(m,'tilesloaded',()=>{ clearTimeout(t); res(true); }); });
    m.moveCamera({tilt:45,heading:30}); await new Promise(r=>setTimeout(r,800));
    const rt=String(m.getRenderingType&&m.getRenderingType()||'').toUpperCase(), tilt=m.getTilt?m.getTilt():0;
    const g=V3.msgs.slice(n0).find(x=>/map ?id|mapid|vector/i.test(x));
    if(!cargo) return {ok:false,msg:'El mapa no carga con ese ID'+(g?'. Google dice: '+g:'. Comprueba que esté en el mismo proyecto que la clave.')};
    if(rt==='RASTER') return {ok:false,msg:g?'Google dice: '+g:'El ID existe pero no es vectorial. Crea uno nuevo de tipo JavaScript › Vectorial.'};
    if(!(tilt>0)) return {ok:false,msg:'Es vectorial pero no deja inclinar. En Gestión de mapas edita el ID y marca «Inclinación» y «Rotación».'};
    return {ok:true,msg:'Mapa vectorial con inclinación. Pulsa Guardar.'};
  }catch(e){ return {ok:false,msg:'Error: '+(e.message||e)}; }
}
const _vAj3=VIEWS.ajustes; VIEWS.ajustes=()=>_vAj3().replace('<div class="set"><div><b>Clave de Google Maps</b>',
  `<div class="set"><div><b>Siempre en Dynamic</b><div class="muted">La pantalla se ve siempre en modo Dynamic (rojo). Apágalo para elegir N o A</div></div><button class="tog ${LS.get('rp-dna-fijo')!=='0'?'on':''}" data-dnafijo="1" aria-label="Siempre en Dynamic"></button></div>`+`<div class="set"><div><b>Ratón siempre visible</b><div class="muted">Para probar con ratón. Si está apagado, el puntero sale solo al mover el ratón</div></div><button class="tog ${LS.get('rp-raton')==='1'?'on':''}" data-raton-tog="1" aria-label="Ratón siempre visible"></button></div>`+'<div class="set"><div><b>Clave de Google Maps</b>').replace('<div class="set"><div><b>Clave de Google Maps</b>',
  `<div class="set"><div><b>ID de mapa (vista 3D al navegar)</b><div class="muted">${V3.ok?'Activo: al navegar el mapa se inclina y gira como en el móvil':V3.id&&V3.fallo?'<span style="color:var(--stop)">No funciona: '+esc(V3.fallo)+'</span>':V3.id?'Guardado, pero solo funciona con los estilos de Google Maps':'Sin ID: al navegar se ve desde arriba'}</div></div><button class="pill ${V3.id?'':'on'}" data-v3id="1">${V3.id?'Cambiar':'Poner ID'}</button></div>
  <div class="set"><div><b>Clave de Google Maps</b>`);
document.addEventListener('click',e=>{ if(e.target.closest('[data-v3id]')){ e.stopPropagation(); v3IdScreen(); } },true);

document.addEventListener('click',e=>{ if(e.target.closest('[data-raton-tog]')){ e.stopPropagation(); const on=LS.get('rp-raton')!=='1'; LS.set('rp-raton',on?'1':'0'); ratonVer(on); renderApp(); } },true);
document.addEventListener('click',e=>{ if(e.target.closest('[data-dnafijo]')){ e.stopPropagation(); const on=LS.get('rp-dna-fijo')==='0'; LS.set('rp-dna-fijo',on?'1':'0'); if(on) setDNA('D'); renderApp(); } },true);
