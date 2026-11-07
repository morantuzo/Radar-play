/* =====================================================================
   Radar Play · Presión de neumáticos (Mi coche › Ruedas)
   Tapones con sensor Bluetooth: presión, temperatura y pila de cada rueda,
   avisos de presión baja y de pinchazo lento. Sin sensores, demostración.
   ===================================================================== */
const RU={d:null,demo:false,t0:Date.now(),avisado:{}};
const RNOM={DI:'Delantera izquierda',DD:'Delantera derecha',TI:'Trasera izquierda',TD:'Trasera derecha'};
function ruDemo(){
  const t=(Date.now()-RU.t0)/1000, w=(b,f)=>Math.round((b+Math.sin(t/40+f)*.02)*100)/100;
  const mk=(pos,bar,temp,bat,f)=>{ const obj=pos[0]==='D'?2.3:2.2, r={mac:'DEMO-'+pos,bar:w(bar,f),temp:Math.round(temp+Math.sin(t/60+f)*2),bat,fresco:true,objetivo:obj,avisos:[]};
    if(r.bar<obj-.25) r.avisos.push(['aviso','Baja: '+nf(r.bar,1)+' bar (recomendado '+nf(obj,1)+')']); return r; };
  const R={DI:mk('DI',2.31,24,88,0),DD:mk('DD',2.29,25,90,1),TI:mk('TI',2.19,22,76,2),TD:mk('TD',1.93,23,12,3)};
  R.TD.avisos.push(['aviso','Más baja que las demás: posible pinchazo lento']); R.TD.avisos.push(['info','Pila del sensor baja']);
  return {estado:{ble:false,msg:'Demostración'},ruedas:R,sin_asignar:[],conf:{objetivo_del:2.3,objetivo_tras:2.2,aviso_bajo:.25,alarma_bar:1.8,temp_alta:80},n_vistos:0};
}
async function ruLoad(){ if(!SYS.bridge){ RU.d=null; return; } try{ RU.d=await api('/api/ruedas'); }catch(e){} }
const ruDatos=()=>RU.demo?ruDemo():RU.d;
document.head.insertAdjacentHTML('beforeend',`<style>
.ru{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px;align-items:start}
.ru-car{position:relative;background:var(--panel);border-radius:18px;padding:18px;display:grid;grid-template-columns:1fr 120px 1fr;grid-template-rows:1fr 1fr;gap:16px 10px;align-items:center}
.ru-car svg{grid-column:2;grid-row:1/3;width:120px;height:auto}
.ru-w{background:var(--panel-2);border-radius:14px;padding:12px 14px;border:2px solid transparent;min-width:0}
.ru-w.aviso{border-color:#ffb020}.ru-w.alarma{border-color:var(--stop);background:rgba(255,77,79,.12)}.ru-w.off{opacity:.55}
.ru-w small{display:block;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.ru-w b{display:block;font-family:var(--f-d);font-size:40px;line-height:1.05;font-variant-numeric:tabular-nums}.ru-w b u{text-decoration:none;font-size:18px;color:var(--muted);margin-left:3px}
.ru-w span{color:var(--muted);font-size:13px}
.ru-w.dcha{text-align:right}
</style>`);
function coRuedas(){
  const d=ruDatos();
  if(!d) return `<p class="co-empty">${SYS.bridge?'Leyendo los sensores…':'Hace falta el puente.'}</p><button class="pill on" data-ru="demo">Ver demostración</button>`;
  const R=d.ruedas, c=d.conf, hay=Object.keys(R).length;
  const w=(pos,cls)=>{ const r=R[pos];
    if(!r) return `<div class="ru-w off ${cls}"><small>${RNOM[pos]}</small><b>—</b><span>Sin sensor asignado</span></div>`;
    const niv=r.avisos&&r.avisos.some(a=>a[0]==='alarma')?'alarma':r.avisos&&r.avisos.some(a=>a[0]==='aviso')?'aviso':'';
    return `<div class="ru-w ${cls} ${niv} ${r.fresco?'':'off'}"><small>${RNOM[pos]}</small><b>${r.fresco?nf(r.bar,2):'—'}<u>bar</u></b>
      <span>${r.fresco?nf(r.temp)+' °C · pila '+r.bat+' %':'Sin señal (el coche lleva un rato parado)'}</span></div>`; };
  const avisos=Object.entries(R).flatMap(([p,r])=>(r.avisos||[]).map(a=>[p,...a]));
  const car=`<svg viewBox="0 0 120 240" aria-hidden="true"><rect x="22" y="8" width="76" height="224" rx="30" fill="var(--panel-2)" stroke="var(--line)" stroke-width="2"/><rect x="32" y="52" width="56" height="40" rx="8" fill="var(--bg)" opacity=".6"/><rect x="32" y="150" width="56" height="34" rx="8" fill="var(--bg)" opacity=".6"/>
    ${[[10,46],[96,46],[10,162],[96,162]].map(([x,y],i)=>`<rect x="${x}" y="${y}" width="14" height="36" rx="4" fill="${(()=>{ const r=R[['DI','DD','TI','TD'][i]]; return !r||!r.fresco?'var(--line)':r.avisos.some(a=>a[0]==='alarma')?'var(--stop)':r.avisos.some(a=>a[0]==='aviso')?'#ffb020':'var(--ok)'; })()}"/>`).join('')}</svg>`;
  return `${RU.demo?'<p class="co-note" style="margin:0 0 10px">Demostración: así se verá con los tapones con sensor puestos. <button class="pill" data-ru="demo" style="padding:4px 10px;font-size:12px">Salir</button></p>':''}
  <div class="ru"><div class="ru-car">${w('DI','')}${car}${w('DD','dcha')}${w('TI','')}${w('TD','dcha')}</div>
  <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
    <div class="co-box"><h4>Avisos</h4>${avisos.length?avisos.map(([p,n,t])=>`<div class="co-li"><span class="chip ${n==='alarma'?'vencido':n==='aviso'?'pronto':''}">${n==='alarma'?'ALARMA':n==='aviso'?'AVISO':'INFO'}</span><div><b>${RNOM[p]}</b><span>${esc(t)}</span></div></div>`).join('')
      :`<p class="co-empty">${hay?'Las cuatro ruedas están bien.':'Todavía no hay sensores asignados.'}</p>`}</div>
    ${d.sin_asignar&&d.sin_asignar.length?`<div class="co-box"><h4>Sensores sin rueda</h4>${d.sin_asignar.map(s=>`<div class="co-li"><div><b>${esc(s.mac)}</b><span>${nf(s.bar,2)} bar · ${nf(s.temp)} °C</span></div>
      <span style="display:flex;gap:4px;flex-wrap:wrap">${Object.keys(RNOM).map(p=>`<button class="pill" style="padding:5px 9px;font-size:12px" data-ru="asig" data-mac="${esc(s.mac)}" data-pos="${p}">${p}</button>`).join('')}</span></div>`).join('')}</div>`:''}
    <div class="co-box"><h4>Ajustes<button class="pill" data-ru="ajustes">Cambiar</button></h4><p class="co-note" style="margin:0">Presión recomendada: delante ${nf(c.objetivo_del,1)} bar, detrás ${nf(c.objetivo_tras,1)} bar. Alarma por debajo de ${nf(c.alarma_bar,1)} bar.<br>
      La presión correcta de tu Giulietta está en la pegatina del marco de la puerta del conductor.</p>
      <p class="co-note">${RU.demo?'':esc(d.estado.msg)}${!RU.demo&&!hay?' · Pon los tapones con sensor: se asignan solos según su número (1 delantera izquierda, 2 delantera derecha, 3 trasera izquierda, 4 trasera derecha).':''}</p>
      ${!RU.demo&&!hay?'<button class="pill" data-ru="demo">Ver demostración</button>':''}</div>
  </div></div>`;
}
function ruAjustes(){
  const c=ruDatos().conf;
  overlay(`<h2>Presión de las ruedas</h2><div class="co-f">${fIn('rD','Recomendada delante (bar)',String(c.objetivo_del).replace('.',','))}${fIn('rT','Recomendada detrás (bar)',String(c.objetivo_tras).replace('.',','))}
    ${fIn('rA','Alarma por debajo de (bar)',String(c.alarma_bar).replace('.',','))}${fIn('rB','Aviso si baja más de (bar)',String(c.aviso_bajo).replace('.',','))}</div>
    <div class="co-btns"><button class="pill" id="cOv">Cancelar</button><button class="pill on" id="fOk">Guardar</button></div>`);
  $('cOv').onclick=closeOv;
  $('fOk').onclick=async()=>{ if(RU.demo){ closeOv(); return; } const r=await api('/api/ruedas',{accion:'ajustes',objetivo_del:v_('rD'),objetivo_tras:v_('rT'),alarma_bar:v_('rA'),aviso_bajo:v_('rB')}).catch(()=>({ok:false}));
    if(!r.ok) return toast(r.error||'No se pudo guardar'); closeOv(); await ruLoad(); renderApp(); };
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-ru]'); if(!el) return; e.stopPropagation(); const a=el.dataset.ru;
  if(a==='demo'){ RU.demo=!RU.demo; RU.t0=Date.now(); }
  if(a==='asig'){ await api('/api/ruedas',{accion:'asignar',mac:el.dataset.mac,pos:el.dataset.pos}).catch(()=>{}); await ruLoad(); }
  if(a==='ajustes') return ruAjustes();
  renderApp();
},true);
/* Vigilancia en segundo plano: avisa aunque estés en otra pantalla */
setInterval(async()=>{
  if(!SYS.bridge) return; await ruLoad();
  if(S.view==='coche'&&CO.tab==='ruedas'&&$('ov').hidden) renderApp();
  const d=RU.d; if(!d) return;
  for(const [p,r] of Object.entries(d.ruedas)){ for(const [nivel,txt] of (r.avisos||[])){ if(nivel==='info') continue;
    const k=p+txt.slice(0,12); if(Date.now()-(RU.avisado[k]||0)<(nivel==='alarma'?120000:1800000)) continue; RU.avisado[k]=Date.now();
    showBanner(`${RNOM[p]}: ${txt}`,[['Ver',()=>{ CO.tab='ruedas'; setView('coche'); }],['Vale',null]],nivel==='alarma'?30000:12000);
    sayQ((nivel==='alarma'?'Atención. ':'')+RNOM[p]+'. '+txt.split(':')[0]+'.');
    if(SYS.bridge) api('/api/leds',{efecto:nivel==='alarma'?'alarma':'aviso',segundos:8}).catch(()=>{}); } }
},10000);
