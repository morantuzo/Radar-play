/* =====================================================================
   Radar Play · Tu logo y tu sonido al encender
   El logo sustituye al radar en la pantalla de arranque; el sonido suena
   una vez por encendido. Se suben desde el mando del iPhone.
   ===================================================================== */
const ARR={d:null};
async function arrCargar(){ try{ ARR.d=await (await fetch('/api/arranque',{cache:'no-store'})).json(); }catch(e){ ARR.d=null; } return ARR.d; }
/* En la animación de arranque: tu logo y tu sonido */
(async()=>{
  const d=await arrCargar(); if(!d) return;
  const b=$('boot');
  if(b&&d.logo&&d.logo_on){
    const r=b.querySelector('.bradar'); if(r) r.outerHTML=`<img class="blogo" src="/arranque/logo.png?t=${d.logo_t}" alt="">`;
    const t=b.querySelector('.bt'); if(t) t.style.display='none';
  }
  if(b&&d.sonido&&d.sonido_on) api('/api/arranque',{accion:'sonar'}).catch(()=>{});
})();
document.head.insertAdjacentHTML('beforeend',`<style>
#boot .blogo{width:min(46vh,46vw);height:min(46vh,46vw);object-fit:contain;animation:blogo 1.6s ease-out both;filter:drop-shadow(0 10px 40px rgba(0,0,0,.6))}
@keyframes blogo{0%{opacity:0;transform:scale(.86)}60%{opacity:1}100%{opacity:1;transform:scale(1)}}
</style>`);
/* Ajustes › Arranque */
function arrHTML(){
  const d=ARR.d; if(!SYS.bridge||!d) return '';
  return `<h3 class="sh">Arranque</h3>
    <div class="set"><div style="display:flex;gap:14px;align-items:center">${d.logo?`<img src="/arranque/logo.png?t=${d.logo_t}" alt="" style="width:56px;height:56px;object-fit:contain;background:#000;border-radius:10px">`:''}<div><b>Logo al encender</b><div class="muted">${d.logo?'Tu logo sale al arrancar':'Sin logo: sale el radar de Radar Play. Súbelo desde el móvil'}</div></div></div>
      <span style="display:flex;gap:8px">${d.logo?`<button class="tog ${d.logo_on?'on':''}" data-arr="logo_on" aria-label="Usar mi logo"></button>`:''}<button class="pill" data-arr="movil">Subir desde el móvil</button></span></div>
    <div class="set"><div><b>Sonido al encender</b><div class="muted">${d.sonido?esc(d.sonido_nombre)+' · volumen '+d.volumen+' %':'Sin sonido. Súbelo desde el móvil (MP3, M4A, WAV)'}</div></div>
      <span style="display:flex;gap:8px;align-items:center">${d.sonido?`<input type="range" min="10" max="100" step="5" value="${d.volumen}" data-arr="volumen" style="width:140px"><button class="pill" data-arr="probar">Probar</button><button class="tog ${d.sonido_on?'on':''}" data-arr="sonido_on" aria-label="Sonido al encender"></button>`:'<button class="pill" data-arr="movil">Subir desde el móvil</button>'}</span></div>`;
}
{ const _v=VIEWS.ajustes; VIEWS.ajustes=()=>{ const s=_v(); return s.replace('<h3 class="sh">Sistema</h3>',arrHTML()+'<h3 class="sh">Sistema</h3>'); }; }
{ const _sv=setView; setView=function(v,...a){ const r=_sv(v,...a); if(v==='ajustes'&&SYS.bridge) arrCargar().then(()=>{ if(S.view==='ajustes'&&$('ov').hidden) renderApp(); }); return r; }; }
document.addEventListener('click',async e=>{ const el=e.target.closest('[data-arr]'); if(!el||el.tagName==='INPUT') return; e.stopPropagation(); const a=el.dataset.arr;
  if(a==='movil') return typeof actuQR==='function'&&actuQR();
  if(a==='probar'){ await api('/api/arranque',{accion:'probar'}).catch(()=>{}); return; }
  if(a==='logo_on'||a==='sonido_on'){ await api('/api/arranque',{accion:'ajustes',[a]:!ARR.d[a]}).catch(()=>{}); await arrCargar(); renderApp(); }
},true);
document.addEventListener('change',async e=>{ const el=e.target.closest('input[data-arr="volumen"]'); if(!el) return;
  await api('/api/arranque',{accion:'ajustes',volumen:+el.value}).catch(()=>{}); await arrCargar(); renderApp(); });
