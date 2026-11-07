/* =====================================================================
   Radar Play · Actualizar sin pendrive (Sistema › Actualizar)
   - Desde el iPhone o el PC: QR a la página /actualizar para subir el zip.
   - En la Raspberry: instala el zip que haya en Descargas o en un pendrive.
   - Volver a la versión anterior.
   Mientras se actualiza enseña el progreso y, cuando Radar Play vuelve con
   la versión nueva, recarga la pantalla sola.
   ===================================================================== */
const ACTU={d:null,t:0,ver:null,caido:false,siguiendo:false};
async function actuCargar(){ try{ ACTU.d=await api('/api/actualizar'); if(ACTU.ver===null) ACTU.ver=ACTU.d.version; }catch(e){} }
const actuUrl=()=>BR&&BR.mando&&BR.mando.url?BR.mando.url.replace('/mando?','/actualizar?'):'';
function actuHTML(){
  const d=ACTU.d; if(!d) return '';
  const z=d.zips||[];
  return `<h3 class="sh">Actualizar</h3>
    <div class="set"><div><b>Versión ${esc(d.version)}</b><div class="muted">${d.online&&d.online.msg?esc(d.online.msg):'Busca en internet si hay una versión nueva'}</div></div>
      <span style="display:flex;gap:8px">${d.online&&d.online.hay?'<button class="pill on" data-actu="online">Actualizar ahora</button>':''}<button class="pill ${d.online&&d.online.hay?'':'on'}" data-actu="buscar">Buscar</button></span></div>
    <div class="set"><div><b>Desde el iPhone o el PC</b><div class="muted">Sube un zip por la WiFi, o pega la clave de Google sin escribirla aquí</div></div><button class="pill" data-actu="qr">Abrir en el móvil</button></div>
    ${z.map(x=>`<div class="set"><div><b>${esc(x.nombre)}</b><div class="muted">${esc(x.donde)} · ${esc(x.fecha)} · ${x.mb} MB</div></div><button class="pill" data-actu="instalar" data-ruta="${esc(x.ruta)}">Instalar</button></div>`).join('')}
    ${d.anterior?`<div class="set"><div><b>Versión anterior guardada</b><div class="muted">${esc(d.anterior)} · por si la nueva da problemas</div></div><button class="pill" data-actu="deshacer">Volver a ella</button></div>`:''}`;
}
const _vSisA=VIEWS.sistema; VIEWS.sistema=()=>{ const s=_vSisA(); return SYS.bridge?s.replace('<h3 class="sh">Pantalla y sonido</h3>',actuHTML()+'<h3 class="sh">Pantalla y sonido</h3>'):s; };
const _setViewA=setView; setView=function(v,...a){ const r=_setViewA(v,...a); if(v==='sistema'&&SYS.bridge) actuCargar().then(()=>{ if(S.view==='sistema'&&$('ov').hidden) renderApp(); }); return r; };

function actuQR(){
  const u=actuUrl();
  overlay(`<h2>Radar Play desde el móvil o el PC</h2>
    <p>Escanea este código con la cámara del iPhone (misma WiFi). En esa página puedes <b>pegar la clave de Google y el ID de mapa</b>, <b>comprobar las APIs</b> y <b>subir una versión nueva</b>.</p>
    <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><div id="actuqr" style="background:#fff;padding:10px;border-radius:12px"></div>
      <div class="muted" style="flex:1;min-width:200px">Desde el PC abre en el navegador:<br><b style="color:var(--fg);word-break:break-all">${esc(u||'(sin WiFi)')}</b><br><br>También está en el mando del iPhone, abajo: «Actualizar Radar Play».</div></div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="pill on" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv;
  if(u&&window.QRCode) new QRCode($('actuqr'),{text:u,width:190,height:190}); else if(!u) $('actuqr').textContent='Conecta la WiFi';
}
/* Progreso: se ve aunque la actualización la empiece el iPhone */
function actuProgreso(d){
  let el=$('actubox');
  if(!el){ document.body.insertAdjacentHTML('beforeend','<div id="actubox" style="position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:90;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px 20px;min-width:340px;max-width:80vw;box-shadow:0 10px 40px rgba(0,0,0,.6)"></div>'); el=$('actubox'); }
  el.innerHTML=d;
}
async function actuVigilar(){
  if(!SYS.bridge&&!ACTU.siguiendo) return;
  let d;
  try{ d=await (await fetch('/api/actualizar/estado',{cache:'no-store'})).json(); }
  catch(e){ if(ACTU.siguiendo){ ACTU.caido=true; actuProgreso('<b>Reiniciando Radar Play…</b><div class="muted">Vuelve en unos segundos con la versión nueva</div>'); } return; }
  if(ACTU.ver===null) ACTU.ver=d.version;
  /* Solo se recarga cuando Radar Play ya ha vuelto con la versión nueva (fase vacía tras reiniciar) */
  if(ACTU.siguiendo&&!d.fase&&(d.version!==ACTU.ver||ACTU.caido)){ ACTU.siguiendo=false;
    actuProgreso('<b style="color:#34c46a">✓ Versión '+esc(d.version)+' instalada</b><div class="muted">Recargando la pantalla…</div>');
    const recargar=async(n=0)=>{ try{ const r=await fetch(location.pathname,{cache:'no-store'}); if(r.ok) return location.reload(); }catch(e){} if(n<30) setTimeout(()=>recargar(n+1),2000); };
    setTimeout(recargar,1500); return; }
  const act=d.fase&&!['hecho','error'].includes(d.fase);
  if(act){ ACTU.siguiendo=true; actuProgreso(`<b>Actualizando Radar Play</b><div class="muted">${esc(d.msg||'')}</div>${d.log?'<div class="muted" style="font-size:12px;margin-top:4px">'+esc(d.log)+'</div>':''}`); }
  else if(d.fase==='error'&&$('actubox')){ actuProgreso(`<b style="color:var(--stop)">No se pudo actualizar</b><div class="muted">${esc(d.msg||'')}</div><div style="text-align:right;margin-top:8px"><button class="pill" onclick="this.closest('#actubox').remove()">Cerrar</button></div>`); ACTU.siguiendo=false; }
  else if(d.fase==='hecho'){ actuProgreso(`<b style="color:#34c46a">${esc(d.msg||'')}</b>`); ACTU.siguiendo=false; }
}
setInterval(actuVigilar,2000);
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-actu]'); if(!el) return; e.stopPropagation(); const a=el.dataset.actu;
  if(a==='qr') return actuQR();
  if(a==='buscar'){ toast('Buscando actualizaciones…'); const r=await api('/api/actualizar',{accion:'buscar'}).catch(()=>null); await actuCargar(); if(r) toast(r.msg); if(S.view==='sistema') renderApp(); return; }
  if(a==='online') return confirmBox('¿Actualizar a la versión '+esc(ACTU.d&&ACTU.d.online&&ACTU.d.online.nueva||'nueva')+'?','Se descarga de internet. Se guarda la actual por si quieres volver. Radar Play se reinicia al terminar.','Actualizar',async()=>{
    const r=await api('/api/actualizar',{accion:'online'}).catch(()=>({ok:false,error:'Sin respuesta'})); if(!r.ok) return toast(r.error); ACTU.siguiendo=true; actuVigilar(); });
  if(a==='instalar') return confirmBox('¿Instalar esta versión?','Se guarda una copia de la actual por si quieres volver. Radar Play se reinicia al terminar.','Instalar',async()=>{
    const r=await api('/api/actualizar',{accion:'instalar',ruta:el.dataset.ruta}).catch(()=>({ok:false,error:'Sin respuesta'})); if(!r.ok) return toast(r.error); ACTU.siguiendo=true; actuVigilar(); });
  if(a==='deshacer') return confirmBox('¿Volver a la versión anterior?','Radar Play se reinicia con la versión '+(ACTU.d&&ACTU.d.anterior||'anterior')+'.','Volver',async()=>{
    const r=await api('/api/actualizar',{accion:'deshacer'}).catch(()=>({ok:false,error:'Sin respuesta'})); if(!r.ok) return toast(r.error); ACTU.siguiendo=true; actuVigilar(); });
},true);

/* Aviso cuando hay versión nueva en internet (una vez por versión) */
setInterval(async()=>{ if(!SYS.bridge) return; await actuCargar(); const o=ACTU.d&&ACTU.d.online;
  if(o&&o.hay&&LS.get('rp-actu-aviso')!==o.nueva&&(E.v||0)<3){ LS.set('rp-actu-aviso',o.nueva);
    showBanner('Hay una versión nueva de Radar Play ('+o.nueva+')',[['Actualizar',()=>api('/api/actualizar',{accion:'online'}).then(r=>{ if(r.ok){ ACTU.siguiendo=true; actuVigilar(); } else toast(r.error); })],['Luego',null]],20000); } },10*60000);
