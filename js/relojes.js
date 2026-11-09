/* =====================================================================
   Radar Play · Relojes redondos del salpicadero (3 pantallas por USB)
   Ajustes › Relojes: qué dato enseña cada uno, cuándo se encienden,
   brillo, identificar, demo y preparar placas nuevas.
   La pantalla le dice al puente el modo DNA (se encienden en Dynamic).
   ===================================================================== */
const RL={d:null,t:null,dnaEnv:null,dnaT:0};
async function rlCargar(){ try{ RL.d=await (await fetch('/api/relojes',{cache:'no-store'})).json(); }catch(e){ RL.d=null; } return RL.d; }

/* El modo DNA va al puente: al cambiar y cada 30 s (por si el puente se reinicia) */
setInterval(()=>{ if(!SYS.bridge) return; const m=E.dna; if(m!==RL.dnaEnv||Date.now()-RL.dnaT>30000){ RL.dnaEnv=m; RL.dnaT=Date.now(); api('/api/relojes',{accion:'dna',dna:m}).catch(()=>{ RL.dnaEnv=null; }); } },1500);

function rlCuerpo(){
  const d=RL.d; if(!d) return '<div class="set"><div class="muted">Cargando…</div></div>';
  const modos=[['dynamic','Solo en Dynamic'],['siempre','Siempre'],['off','Apagados']];
  const opciones=r=>d.datos.map(x=>`<option value="${x.k}" ${x.k===r.rol?'selected':''}>${esc(x.n)}</option>`).join('');
  const lista=d.relojes.length?d.relojes.map(r=>`<div class="set"><div><b>Reloj ${r.n}</b><div class="muted">${r.on?'Encendido':'Apagado'}${r.on&&r.valor!=null?' · '+r.valor:''}${r.on&&r.valor==null?' · sin datos del motor':''}</div></div>
      <select data-rl="rol" data-id="${esc(r.id)}" class="rlsel">${opciones(r)}</select></div>`).join('')
    :'<div class="set"><div><b>Ningún reloj conectado</b><div class="muted">Conecta las placas redondas por USB a la Raspberry. Si son nuevas, hay que prepararlas una vez.</div></div></div>';
  const pr=d.prep||{};
  const nuevas=(d.sin_programa||[]).length;
  const prep=pr.activo||pr.msg?`<div class="set"><div><b>${pr.activo?'Preparando placas…':pr.ok?'Placas preparadas':'Preparar placas'}</b><div class="muted">${esc(pr.msg||'')}</div></div>${pr.activo?'<span class="rlspin"></span>':''}</div>`:'';
  return `${lista}
    ${nuevas&&!pr.activo?`<div class="set" style="background:rgba(255,170,30,.12)"><div><b>${nuevas===1?'Hay 1 placa nueva':'Hay '+nuevas+' placas nuevas'} sin preparar</b><div class="muted">Le instalo MicroPython y el programa del reloj (2-3 minutos por placa, con internet). Se borra lo que tenga.</div></div>
      <span style="display:flex;gap:8px;align-items:center"><select data-rl="placa" class="rlsel"><option value="lcd128" ${d.placa==='lcd128'?'selected':''}>ESP32-S3-LCD-1.28 (y -B)</option><option value="touch128" ${d.placa==='touch128'?'selected':''}>ESP32-S3-Touch-LCD-1.28</option></select><button class="pill on" data-rl="preparar">Preparar</button></span></div>`:''}
    ${prep}
    <div class="set"><div><b>Cuándo se encienden</b><div class="muted">${d.encendidos?'Ahora están encendidos':'Ahora están apagados'}${d.modo==='dynamic'?' · el DNA está en '+({D:'Dynamic',N:'Normal',A:'All Weather'}[d.dna]||'—'):''}</div></div>
      <span style="display:flex;gap:6px">${modos.map(([k,n])=>`<button class="pill ${d.modo===k?'on':''}" data-rl="modo" data-v="${k}">${n}</button>`).join('')}</span></div>
    <div class="set"><div><b>Brillo</b><div class="muted">${d.brillo}%</div></div><input type="range" min="5" max="100" step="5" value="${d.brillo}" data-rl="brillo" style="width:260px"></div>
    <div class="set"><div><b>Pruebas</b><div class="muted">«Identificar» pone un número grande en cada reloj. «Demo» mueve las agujas 25 s sin el coche.</div></div>
      <span style="display:flex;gap:6px"><button class="pill" data-rl="identificar" ${d.relojes.length?'':'disabled'}>Identificar</button><button class="pill ${d.demo?'on':''}" data-rl="demo">${d.demo?'Parar demo':'Demo'}</button></span></div>
    <div class="set"><div><b>Colores cambiados</b><div class="muted">Si el rojo sale azul en los relojes, actívalo.</div></div><button class="tog ${d.rb?'on':''}" data-rl="rb" aria-label="Colores cambiados"></button></div>`;
}
function rlHTML(){ if(!SYS.bridge) return ''; return `<h3 class="sh">Relojes del salpicadero</h3><div id="rlSec">${rlCuerpo()}</div>`; }
function rlRefrescar(){ const s=$('rlSec'); if(!s) return; if(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#rlSec')&&document.activeElement.tagName!=='BUTTON') return; s.innerHTML=rlCuerpo(); }
{ const _v=VIEWS.ajustes; VIEWS.ajustes=()=>{ const s=_v(); return s.replace('<h3 class="sh">Sistema</h3>',rlHTML()+'<h3 class="sh">Sistema</h3>'); }; }
{ const _sv=setView; setView=function(v,...a){ const r=_sv(v,...a); if(v==='ajustes'&&SYS.bridge) rlCargar().then(rlRefrescar); return r; }; }
setInterval(()=>{ if(S.view==='ajustes'&&$('rlSec')) rlCargar().then(rlRefrescar); },2000);

document.addEventListener('click',async e=>{ const el=e.target.closest('[data-rl]'); if(!el||el.tagName==='INPUT'||el.tagName==='SELECT') return; e.stopPropagation(); const a=el.dataset.rl;
  if(a==='modo') await api('/api/relojes',{accion:'ajustes',modo:el.dataset.v}).catch(()=>{});
  if(a==='rb') await api('/api/relojes',{accion:'ajustes',rb:!(RL.d&&RL.d.rb)}).catch(()=>{});
  if(a==='identificar'){ await api('/api/relojes',{accion:'identificar'}).catch(()=>{}); toast('Mira los relojes: cada uno enseña su número'); }
  if(a==='demo') await api('/api/relojes',{accion:'demo',on:!(RL.d&&RL.d.demo)}).catch(()=>{});
  if(a==='preparar'){ const pl=document.querySelector('select[data-rl="placa"]'); confirmBox('¿Preparar las placas nuevas?','Se borra lo que tengan y se instala el reloj de Radar Play. No las desconectes mientras tanto.','Preparar',async()=>{ await api('/api/relojes',{accion:'preparar',placa:pl?pl.value:'lcd128'}).catch(()=>{}); await rlCargar(); rlRefrescar(); }); return; }
  await rlCargar(); rlRefrescar();
},true);
document.addEventListener('change',async e=>{ const el=e.target.closest('[data-rl]'); if(!el) return; const a=el.dataset.rl;
  if(a==='rol'){ await api('/api/relojes',{accion:'rol',id:el.dataset.id,rol:el.value}).catch(()=>{}); toast('Cambiado'); }
  if(a==='brillo') await api('/api/relojes',{accion:'ajustes',brillo:+el.value}).catch(()=>{});
  if(a==='placa') return;
  el.blur(); await rlCargar(); rlRefrescar();
});
document.head.insertAdjacentHTML('beforeend',`<style>
.rlsel{background:var(--panel-2,#222);color:var(--fg,#fff);border:0;border-radius:12px;padding:10px 14px;font:inherit;font-size:16px}
.rlspin{width:24px;height:24px;border:3px solid rgba(255,255,255,.2);border-top-color:var(--accent,#ff2a3a);border-radius:50%;display:inline-block;animation:ycg .8s linear infinite}
@keyframes ycg{to{transform:rotate(360deg)}}
</style>`);
