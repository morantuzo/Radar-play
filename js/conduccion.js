/* =====================================================================
   Radar Play · Ayudas a la conducción
   - Indicador de cambio de marcha (eficiente en Normal/All Weather, al corte en Dynamic)
   - Nota de conducción eficiente (por viaje, en Mi coche)
   - Aviso de descanso cada 2 horas
   - Dónde está aparcado el coche
   - Prestaciones: 0-100, 80-120, 100-0 y medidor de fuerzas G
   - Filtro de partículas (FAP): avisa cuando regenera para no apagar el motor
   ===================================================================== */
const CD={prevV:0,prevT:performance.now(),acc:0,eco:100,ecoInst:100,drvDesde:null,paradoDesde:null,descansoAviso:0,
  gLong:0,gLat:0,prevH:null,acel:null,dpf:{regen:false,desde:null,posible:false,datos:{},demo:false,aviso:0}};

/* ---------- Medidas comunes (cada 100 ms) ---------- */
setInterval(()=>{
  const now=performance.now(), dt=Math.max(.05,(now-CD.prevT)/1000), v=E.v||0;
  const a=(v-CD.prevV)/3.6/dt;                                     // m/s²
  CD.acc+=(a-CD.acc)*.25; CD.prevV=v; CD.prevT=now;
  /* Fuerzas G: del acelerómetro si lo hay; si no, de la velocidad y del giro */
  if(CD.acel&&CD.acel.fresco){ CD.gLong=CD.acel.long; CD.gLat=CD.acel.lat; }
  else { const h=S.heading||0; let w=0; if(CD.prevH!=null){ let d=h-CD.prevH; while(d>180)d-=360; while(d<-180)d+=360; w=d*Math.PI/180/dt; } CD.prevH=h;
    CD.gLong+=(CD.acc/9.81-CD.gLong)*.3; CD.gLat+=((v/3.6)*w/9.81-CD.gLat)*.2; CD.gLat=Math.max(-1.5,Math.min(1.5,CD.gLat)); }
  /* Nota eficiente instantánea */
  let s=100; const acc=CD.acc;
  if(v>3){ if(acc>1.6) s-=Math.min(45,(acc-1.6)*35); if(acc<-2.5) s-=Math.min(50,(-acc-2.5)*30);
    if(E.dna!=='D'&&E.rpm>2600) s-=Math.min(30,(E.rpm-2600)/40); if(v>125) s-=Math.min(25,(v-125)*1.2); }
  else if(E.rpm>700&&v<1) s-=8;                                   // al ralentí parado
  CD.ecoInst=Math.max(0,s); CD.eco+=(CD.ecoInst-CD.eco)*.01;
  shiftTick(); prestTick(now);
},100);

/* ---------- Indicador de cambio de marcha ---------- */
document.head.insertAdjacentHTML('beforeend',`<style>
#shiftb{position:absolute;right:92px;bottom:96px;z-index:4;display:none;align-items:center;gap:8px;padding:10px 16px;border-radius:14px;font-weight:900;font-size:22px;background:rgba(8,10,13,.88);color:#fff;font-family:var(--f-d)}
#shiftb.up{display:flex;color:var(--ok)}#shiftb.down{display:flex;color:#5ab0ff}#shiftb.corte{display:flex;background:var(--stop);animation:cdpul .25s steps(2) infinite}
#shiftb small{font:700 12px var(--f-b);color:var(--muted);letter-spacing:.04em}
@keyframes cdpul{50%{opacity:.35}}
.main[data-view=panel] #shiftb{right:14px;top:14px;bottom:auto}
@media (prefers-reduced-motion:reduce){#shiftb.corte{animation:none}}
.cd-park{display:flex;align-items:center;gap:12px}
.pr{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:14px}
.pr-big{background:var(--panel);border-radius:18px;padding:18px;text-align:center}
.pr-big .t{font-family:var(--f-d);font-size:92px;line-height:1;font-variant-numeric:tabular-nums}
.pr-big .s{color:var(--muted);font-weight:700;margin-top:6px}
.pr-big .st{display:inline-block;margin-top:12px;padding:6px 14px;border-radius:999px;font-weight:800;background:var(--panel-2)}
.pr-big .st.listo{background:rgba(52,196,106,.18);color:var(--ok)}.pr-big .st.corre{background:var(--accent);color:#fff}
.pr-g{background:var(--panel);border-radius:18px;padding:14px;display:flex;flex-direction:column;align-items:center}
.pr-g canvas{width:220px;height:220px}
.pr-best{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}
.dpf{display:flex;gap:12px;align-items:center;background:var(--panel);border-radius:16px;padding:10px 16px;flex:none}
.dpf .chip{min-width:110px;text-align:center}
</style>`);
(function(){ $('stage').insertAdjacentHTML('beforeend','<div id="shiftb" aria-live="polite"></div>'); })();
let shiftLast='';
function shiftTick(){
  const b=$('shiftb'); if(!b) return;
  const v=E.v||0, g=E.v<1?0:E.gear, r=E.rpm||0, thr=E.thr||0;
  let cls='', html='';
  if(v>4&&g>0&&(S.view==='mapas'||S.view==='panel')){
    if(E.dna==='D'&&r>4200){ cls='corte'; html='CAMBIA ↑'; }
    else if(E.dna!=='D'&&g<6&&r>2400&&thr<70){ cls='up'; html=`↑ ${g+1}ª <small>GASTA MENOS</small>`; }
    else if(g>1&&r<1150&&thr>25){ cls='down'; html=`↓ ${g-1}ª <small>BAJA MARCHA</small>`; }
  }
  if(cls+html!==shiftLast){ shiftLast=cls+html; b.className=cls; b.innerHTML=html; }
}


/* ---------- Aviso de descanso (cada 2 h de conducción seguida) ---------- */
setInterval(()=>{
  const v=E.v||0, t=Date.now();
  if(v>5){ CD.paradoDesde=null; if(!CD.drvDesde) CD.drvDesde=t; }
  else { CD.paradoDesde=CD.paradoDesde||t; if(t-CD.paradoDesde>15*60e3){ CD.drvDesde=null; CD.descansoAviso=0; } }
  if(!CD.drvDesde) return;
  const h=(t-CD.drvDesde)/36e5;
  if(h>=2&&t-CD.descansoAviso>30*60e3){ CD.descansoAviso=t;
    showBanner(`Llevas ${h>=2.5?nf(h,1)+' horas':'2 horas'} conduciendo. Para a descansar 15 minutos`,[['Buscar área',()=>{ setView('mapas'); explore(['Áreas de servicio','área de servicio','#188038','']); }],['Luego',null]],25000);
    sayQ('Llevas dos horas conduciendo. Es buen momento para parar a descansar.'); }
},15000);

/* ---------- Dónde está aparcado (Mi coche › Resumen) ---------- */
const _coRes=coResumen; coResumen=function(){ const h=_coRes(), n=CO.info, p=n&&n.aparcado;
  const eco=n&&n.eco_media!=null?`<div class="co-box" style="margin-top:12px"><h4>Conducción eficiente</h4><div class="co-li"><div><b>${n.eco_media} / 100</b><span>Media de tus últimos viajes: acelerar y frenar con suavidad y subir de marcha antes de 2.500 rpm la sube.</span></div></div></div>`:'';
  if(!p) return h+eco;
  return h+`<div class="co-box" style="margin-top:12px"><h4>Aparcado${p.simulado?' (simulado)':''}<button class="pill" data-cd="park">Ver en el mapa</button></h4>
    <div class="co-li"><div><b>Desde el ${fD(p.desde)} a las ${String(p.desde).slice(11,16)}</b><span>${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${S.pos?' · a '+fmtDist(kmEntre(S.pos,p)*1000)+' de aquí':''}</span></div></div></div>`+eco; };
/* Nota en la lista de viajes */
const _coVia=coViajes; coViajes=function(){ let h=_coVia(); (CO.info.viajes||[]).forEach(v=>{ if(v.eco!=null) h=h.replace(`data-id="${v.id}">`,`data-id="${v.id}" data-eco="${v.eco}">`); }); return h; };
document.head.insertAdjacentHTML('beforeend','<style>.co-li[data-eco]::after{content:"eco " attr(data-eco);flex:none;font-size:12px;font-weight:800;color:var(--ok);background:rgba(52,196,106,.14);border-radius:6px;padding:3px 8px}</style>');

/* ---------- Prestaciones ---------- */
ICONS.prestaciones=Sv('<circle cx="12" cy="13" r="8"/><path d="M12 13V9M10 2h4M12 2v3M19 6l1.5-1.5"/>');
APPS.splice(APPS.findIndex(a=>a.id==='motor')+1,0,{id:'prestaciones',name:'Prestaciones',bg:'linear-gradient(160deg,#3b3b46,#111116)'});
const PRUEBAS={'0-100':{de:0,a:100,txt:'0 a 100 km/h'},'80-120':{de:80,a:120,txt:'80 a 120 km/h'},'100-0':{de:100,a:0,txt:'Frenada de 100 a 0'}};
const PR={modo:LS.get('rp-prest-modo')||'0-100',st:'espera',t0:0,t:0,res:(()=>{ try{ return JSON.parse(LS.get('rp-prest')||'{}'); }catch(e){ return {}; } })(),gTrail:[],gMax:{acel:0,fren:0,lat:0},vPrev:0};
function prestTick(now){
  const p=PRUEBAS[PR.modo], v=E.v||0, up=p.a>p.de;
  if(PR.st==='espera'||PR.st==='hecho'){
    if(up?(p.de===0?v<1:v<p.de-2):v>=p.de+1) PR.st='listo';            // en posición de salida
  } else if(PR.st==='listo'){
    if(up?(p.de===0?v>=1.5:v>=p.de):v<=p.de){ PR.st='corre'; PR.t0=now; PR.t=0; }
  } else if(PR.st==='corre'){
    PR.t=(now-PR.t0)/1000;
    const fin=up?v>=p.a:v<=Math.max(1,p.a);
    if(fin){ PR.st='hecho'; const t=Math.round(PR.t*100)/100, r=PR.res[PR.modo]||[]; r.unshift({t,f:new Date().toISOString().slice(0,16),sim:!!S.sim}); PR.res[PR.modo]=r.slice(0,10);
      LS.set('rp-prest',JSON.stringify(PR.res)); if(S.view==='prestaciones') renderApp(); sayQ(p.txt+': '+String(t).replace('.',' coma ')+' segundos.'); }
    if(PR.t>60) PR.st='espera';
  }
  PR.gTrail.push([CD.gLat,CD.gLong]); if(PR.gTrail.length>60) PR.gTrail.shift();
  PR.gMax.acel=Math.max(PR.gMax.acel,CD.gLong); PR.gMax.fren=Math.max(PR.gMax.fren,-CD.gLong); PR.gMax.lat=Math.max(PR.gMax.lat,Math.abs(CD.gLat));
  if(S.view==='prestaciones'){ const set=(id,x)=>{ const e=$(id); if(e) e.textContent=x; };
    set('prT',PR.st==='corre'||PR.st==='hecho'?PR.t.toFixed(2).replace('.',','):'0,00'); set('prV',Math.round(v)+' km/h');
    const s=$('prSt'); if(s){ s.className='st '+PR.st; s.textContent={espera:up?(p.de===0?'Para el coche para empezar':'Baja de '+p.de+' km/h para empezar'):'Pasa de '+p.de+' km/h para empezar',listo:'Listo: '+(up?'acelera':'frena'),corre:'Midiendo…',hecho:'Hecho'}[PR.st]; }
    set('gA',nf(PR.gMax.acel,2)); set('gF',nf(PR.gMax.fren,2)); set('gL',nf(PR.gMax.lat,2)); dibujaG(); }
}
function dibujaG(){
  const c=$('prG'); if(!c) return; const x=c.getContext('2d'), W=c.width=440, H=c.height=440, cx=W/2, cy=H/2, R=W/2-20, k=R/1.2;
  const css=getComputedStyle(document.body), line=css.getPropertyValue('--line')||'#333', mut=css.getPropertyValue('--muted')||'#888', acc=css.getPropertyValue('--accent')||'#e33';
  x.clearRect(0,0,W,H); x.strokeStyle=line; x.lineWidth=2;
  [.4,.8,1.2].forEach(r=>{ x.beginPath(); x.arc(cx,cy,r*k,0,7); x.stroke(); }); x.beginPath(); x.moveTo(cx-R,cy); x.lineTo(cx+R,cy); x.moveTo(cx,cy-R); x.lineTo(cx,cy+R); x.stroke();
  x.fillStyle=mut; x.font='600 22px sans-serif'; x.fillText('0,4',cx+.4*k+4,cy-6); x.fillText('0,8',cx+.8*k+4,cy-6);
  x.strokeStyle=acc; x.globalAlpha=.5; x.lineWidth=4; x.beginPath(); PR.gTrail.forEach(([l,g],i)=>{ const px=cx+l*k, py=cy-g*k; i?x.lineTo(px,py):x.moveTo(px,py); }); x.stroke(); x.globalAlpha=1;
  x.fillStyle=acc; x.beginPath(); x.arc(cx+CD.gLat*k,cy-CD.gLong*k,14,0,7); x.fill();
}
VIEWS.prestaciones=()=>{
  const p=PRUEBAS[PR.modo], r=PR.res[PR.modo]||[], best=r.filter(x=>!x.sim).sort((a,b)=>a.t-b.t)[0];
  return `${appbar('Prestaciones',`<span class="pill ${CD.acel&&CD.acel.fresco?'on':''}">${CD.acel&&CD.acel.fresco?'Acelerómetro':'G calculadas por GPS'}</span>`)}<div class="abody">
  <div class="gs-top"><div class="seg">${Object.entries(PRUEBAS).map(([k,x])=>`<button class="${PR.modo===k?'on':''}" data-cd="modo" data-k="${k}">${x.txt}</button>`).join('')}</div><button class="pill" data-cd="reset">Reiniciar</button></div>
  <div class="pr"><div class="pr-big"><div class="t" id="prT">0,00</div><div class="s"><span id="prV">0 km/h</span> · ${p.txt}</div><span class="st" id="prSt"></span>
    <div class="pr-best">${[['Mejor',best?nf(best.t,2)+' s':'—'],['Último',r[0]?nf(r[0].t,2)+' s'+(r[0].sim?' (sim.)':''):'—'],['Intentos',r.length]].map(([a,b])=>`<div class="co-t" style="background:var(--panel-2)"><small>${a}</small><b style="font-size:28px">${b}</b></div>`).join('')}</div></div>
    <div class="pr-g"><canvas id="prG" width="440" height="440" aria-label="Medidor de fuerzas G"></canvas>
      <div class="pr-best" style="width:100%"><div class="co-t" style="background:var(--panel-2)"><small>Acelerar</small><b style="font-size:24px" id="gA">0</b></div><div class="co-t" style="background:var(--panel-2)"><small>Frenar</small><b style="font-size:24px" id="gF">0</b></div><div class="co-t" style="background:var(--panel-2)"><small>Curva</small><b style="font-size:24px" id="gL">0</b></div></div></div></div>
  <p class="co-note">Haz las pruebas solo en un circuito o en un sitio cerrado al tráfico. Con GPS los tiempos son orientativos (±0,2 s); con el acelerómetro las fuerzas G son reales.</p></div>`;
};

/* ---------- Filtro de partículas (FAP) ---------- */
setInterval(async()=>{
  const f=CD.dpf; let d={};
  if(SYS.bridge&&E.real){ try{ d=await (await fetch('/api/obd',{cache:'no-store'})).json(); }catch(e){} }
  f.datos=d;
  let regen=false, posible=false;
  if(f.demo){ regen=true; }
  else if(E.real){
    if(d.regen!=null) regen=d.regen>0;                                       // PID propio del fabricante
    else if(d.dpf_temp!=null) regen=d.dpf_temp>450;                         // temperatura del FAP (estándar)
    else posible=(E.v||0)<2&&E.rpm>950&&E.rpm<1300&&(E.coolant||0)>80&&(E.thr||0)<5;   // ralentí alto en caliente
  }
  if(posible){ f.posTicks=(f.posTicks||0)+1; } else f.posTicks=0;
  const ahora=regen||f.posTicks>=20;                                          // 60 s seguidos de ralentí alto
  if(ahora&&!f.regen){ f.desde=Date.now(); showBanner(`Filtro de partículas: ${regen?'regenerando':'parece que está regenerando'}. Si puedes, sigue unos minutos y no apagues el motor`,[['Vale',null]],20000);
    sayQ('El filtro de partículas se está limpiando. Si puedes, no apagues el motor todavía.'); if(SYS.bridge) api('/api/leds',{efecto:'aviso',segundos:6}).catch(()=>{}); }
  if(!ahora&&f.regen&&f.desde&&Date.now()-f.desde>60e3) toast('El filtro de partículas ha terminado de limpiarse');
  f.regen=ahora; f.posible=!regen&&ahora;
  if(f.regen&&(E.v||0)<1&&Date.now()-f.aviso>120e3&&Date.now()-f.desde>30e3){ f.aviso=Date.now(); sayQ('Sigue regenerando el filtro. Mejor no apagues el motor ahora.'); }
},3000);
function dpfHTML(){
  const f=CD.dpf, d=f.datos||{}, min=f.desde?Math.round((Date.now()-f.desde)/60000):0;
  const extra=[d.hollin!=null?'Hollín '+nf(d.hollin,0)+' %':'',d.dpf_temp!=null?'Temperatura '+d.dpf_temp+' °C':'',d.dpf_dp!=null?'Presión '+nf(d.dpf_dp,2)+' kPa':'',d.km_regen!=null?'Última limpieza hace '+nf(d.km_regen)+' km':''].filter(Boolean).join(' · ');
  return `<div class="dpf"><span class="chip ${f.regen?'pronto':E.real||f.demo?'ok':''}">${f.regen?'REGENERANDO':E.real||f.demo?'NORMAL':'SIN DATOS'}</span>
    <div style="flex:1;min-width:0"><b>Filtro de partículas (FAP)</b><div class="muted" style="font-size:13.5px">${f.regen?(f.posible?'Ralentí alto en caliente: parece una regeneración. ':'')+'Lleva '+min+' min. No apagues el motor hasta que termine.':E.real?(extra||'Vigilando. Si la centralita da datos del FAP, configúralos en OBD_EXTRA.'):'Conecta el lector OBD-II para vigilarlo.'}${extra&&f.regen?' · '+extra:''}</div></div>
    <button class="pill" data-cd="dpfdemo">${f.demo?'Parar demo':'Demo'}</button></div>`;
}
const _vMot=VIEWS.motor; VIEWS.motor=()=>_vMot().replace('abody motor">','abody motor">'+dpfHTML());

/* ---------- Acelerómetro del puente (si está) ---------- */
setInterval(async()=>{ if(!SYS.bridge||S.view==='prestaciones') return; try{ CD.acel=await api('/api/acel'); }catch(e){ CD.acel=null; } },1000);
setInterval(async()=>{ if(SYS.bridge&&S.view==='prestaciones'){ try{ CD.acel=await api('/api/acel'); }catch(e){} } },150);

/* ---------- Clics ---------- */
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-cd]'); if(!el) return; e.stopPropagation(); const a=el.dataset.cd;
  if(a==='modo'){ PR.modo=el.dataset.k; LS.set('rp-prest-modo',PR.modo); PR.st='espera'; PR.t=0; }
  if(a==='reset'){ PR.st='espera'; PR.t=0; PR.gMax={acel:0,fren:0,lat:0}; PR.gTrail=[]; if(SYS.bridge) api('/api/acel',{accion:'reset_max'}).catch(()=>{}); }
  if(a==='dpfdemo'){ CD.dpf.demo=!CD.dpf.demo; if(!CD.dpf.demo){ CD.dpf.regen=false; CD.dpf.desde=null; } }
  if(a==='park'){ const p=CO.info&&CO.info.aparcado; if(!p) return; setView('mapas'); setTimeout(()=>{ clearPin(); MP.pin=new G.Marker({map,position:{lat:p.lat,lng:p.lng},zIndex:25,label:{text:'P',color:'#fff',fontWeight:'800'}}); S.follow=false; map.panTo({lat:p.lat,lng:p.lng}); spotCard({lat:p.lat,lng:p.lng},'Tu coche'); },200); return; }
  renderApp();
},true);

/* Siri: «dónde está el coche», «cuánto llevo conduciendo» */
if(typeof siriHandle==='function'){ const _sh5=siriHandle; siriHandle=function(t){ const s=(t||'').toLowerCase();
  if(/d[oó]nde.*(aparcad|coche)|d[oó]nde lo dej/.test(s)){ const p=CO.info&&CO.info.aparcado; if(!p) return sayQ('No tengo guardado dónde está aparcado.'); CO.tab='resumen'; setView('coche'); return sayQ('Te lo enseño en Mi coche.'); }
  if(/cu[aá]nto llevo conduciendo|cu[aá]nto tiempo llevo/.test(s)){ const h=CD.drvDesde?(Date.now()-CD.drvDesde)/36e5:0; return sayQ(h?'Llevas '+Math.floor(h)+' horas y '+Math.round((h%1)*60)+' minutos conduciendo.':'Ahora mismo no estás conduciendo.'); }
  return _sh5.apply(this,arguments); }; }
