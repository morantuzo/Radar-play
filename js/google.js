/* =====================================================================
   Radar Play · Clave de Google sin escribirla en la Raspberry
   - Recoge la clave y el ID de mapa que pegas en el móvil o el PC.
   - Dice al puente si el mapa ha cargado bien (para «Comprobar APIs»).
   - Ajustes › Google: comprobar qué APIs funcionan.
   ===================================================================== */
const GCF={reportado:false,apis:null};
/* 1. Lo que llega del móvil */
setInterval(async()=>{
  if(!SYS.bridge) return;
  let r; try{ r=await (await fetch('/api/google/pendiente',{cache:'no-store'})).json(); }catch(e){ return; }
  if(!r||!r.datos) return;
  Object.entries(r.datos).forEach(([k,v])=>LS.set(k,v));
  if(typeof RPLOG!=='undefined') RPLOG.info('Ajustes de Google recibidos del móvil: '+Object.keys(r.datos).join(', '));
  closeOv(); toast('Clave recibida del móvil. Recargando…'); if(typeof syncPush==='function') await syncPush(true);
  setTimeout(()=>location.reload(),1200);
},3000);

/* 2. ¿Ha cargado el mapa con esta clave? */
function gcfReporta(ok,msg){
  if(!SYS.bridge||GCF.reportado===(ok?'ok':msg)) return; GCF.reportado=ok?'ok':msg;
  api('/api/google',{accion:'maps_js',ok,msg:msg||'',clave_fin:(S.key||'').slice(-6)}).catch(()=>{});
}
['error','warn'].forEach(k=>{ const o=console[k]; console[k]=function(...a){ try{ const t=a.join(' '); const m=t.match(/([A-Za-z]+MapError)/); if(m) gcfReporta(false,m[1]); }catch(e){} return o.apply(this,a); }; });
const _gmAF=window.gm_authFailure; window.gm_authFailure=function(){ gcfReporta(false,'gm_authFailure'); if(_gmAF) return _gmAF(); };
const gcfT=setInterval(()=>{ if(typeof map!=='undefined'&&map&&typeof G!=='undefined'&&G&&G.event){ clearInterval(gcfT); G.event.addListenerOnce(map,'tilesloaded',()=>gcfReporta(true)); } },1500);

/* 3. La ventana de la clave: también desde el móvil */
const _keyScreen=keyScreen; keyScreen=function(err){ _keyScreen(err); gcfQRClave(0); };
function gcfQRClave(n){
  const u=typeof actuUrl==='function'?actuUrl():'';
  if(!$('kIn')||$('kqr')) return;                       // la ventana ya no está, o ya tiene el QR
  if(!u){ if(n<15) setTimeout(()=>gcfQRClave(n+1),1500); return; }
  $('ovbox').insertAdjacentHTML('beforeend',`<div style="display:flex;gap:16px;align-items:center;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
    <div id="kqr" style="background:#fff;padding:8px;border-radius:10px;flex:none"></div>
    <div><b>Mejor pégala desde el móvil o el PC</b><div class="muted">Escanea el código con el iPhone (misma WiFi) o abre <b style="color:var(--fg);word-break:break-all">${esc(u)}</b> en el PC donde tienes Google Cloud. Pega la clave y el ID de mapa: aquí se ponen solos.</div></div></div>`);
  if(window.QRCode) new QRCode($('kqr'),{text:u,width:130,height:130});
};

/* 4. Ajustes › Google */
const GAPIS_TXT={maps:'Maps JavaScript API',routes:'Routes API',places:'Places API (New)',geocoding:'Geocoding API',youtube:'YouTube Data API v3'};
async function gcfComprobar(){
  overlay(`<h2>APIs de Google</h2><p class="muted">Comprobando tu clave con Google…</p>`);
  const r=await api('/api/google',{accion:'comprobar',clave:S.key}).catch(()=>({ok:false}));
  const l=r&&r.apis||[];
  overlay(`<h2>APIs de Google</h2><p class="muted">Actívalas en console.cloud.google.com › APIs y servicios › Biblioteca, en el mismo proyecto que la clave.</p>
    ${l.length?l.map(a=>`<div class="set"><div style="display:flex;gap:12px;align-items:flex-start"><span class="btp-ic ${a.ok===true?'ok':a.ok===false?'no':'esp'}">${a.ok===true?'✓':a.ok===false?'✕':'?'}</span><div><b>${esc(a.api)}</b><div class="muted">${esc(a.para)} · ${esc(a.msg)}</div></div></div></div>`).join(''):'<p>No se pudo comprobar (¿hay internet?)</p>'}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="pill" id="gcfR">Comprobar otra vez</button><button class="pill on" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv; $('gcfR').onclick=gcfComprobar;
}
const _vAjG=VIEWS.ajustes; VIEWS.ajustes=()=>{ const s=_vAjG(); if(!SYS.bridge) return s;
  return s.replace('<h3 class="sh">Sistema</h3>',`<h3 class="sh">Google</h3>
    <div class="set"><div><b>Comprobar APIs</b><div class="muted">Dice qué APIs de tu clave funcionan y cuál falta activar</div></div><button class="pill on" data-gcf="comprobar">Comprobar</button></div>
    <div class="set"><div><b>Clave e ID de mapa desde el móvil</b><div class="muted">Pégalos en el iPhone o el PC en vez de escribirlos aquí</div></div><button class="pill" data-gcf="movil">Abrir en el móvil</button></div>
    <h3 class="sh">Sistema</h3>`); };
document.addEventListener('click',e=>{ const el=e.target.closest('[data-gcf]'); if(!el) return; e.stopPropagation();
  if(el.dataset.gcf==='comprobar') gcfComprobar(); else if(typeof actuQR==='function') actuQR(); },true);
