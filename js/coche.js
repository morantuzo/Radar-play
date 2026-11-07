/* =====================================================================
   Radar Play · Mi coche
   Kilómetros totales, consumo medio (real por repostajes y estimado por
   el motor), viajes y mantenimiento (filtros, correa, aceite, ITV...).
   Todo se guarda en la Raspberry (puente → coche.py, carpeta datos/).
   ===================================================================== */

/* La pantalla manda al puente posición, velocidad y datos del motor (sirve sin GPS y al simular) */
setInterval(()=>{
  if(!SYS.bridge||!S.pos) return;
  const r=x=>x==null||isNaN(x)?null:Math.round(x*10)/10;
  api('/api/telemetria',{lat:S.pos.lat,lng:S.pos.lng,speed:Math.round(E.v||0),sim:!!S.sim,dna:E.dna,
    rpm:Math.round(E.rpm||0),consumo:r(E.cons),eco:typeof CD!=='undefined'?Math.round(CD.ecoInst):null,refrigerante:r(E.coolant),bateria:r(E.volt),obd:!!E.real}).catch(()=>{});
},2000);

ICONS.coche=Sv('<path d="M5 17h14M3 17v-4l2.2-5.2A2 2 0 0 1 7 6.5h10a2 2 0 0 1 1.8 1.3L21 13v4"/><path d="M3 13h18"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>');
APPS.splice(APPS.findIndex(a=>a.id==='motor')+1,0,{id:'coche',name:'Mi coche',bg:'linear-gradient(160deg,#e0455a,#6d1222)'});

const CO={info:null,tab:LS.get('rp-coche-tab')||'resumen',err:null};
const nf=(n,d=0)=>n==null||isNaN(n)?'—':Number(n).toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d});
const fD=s=>s?String(s).slice(8,10)+'/'+String(s).slice(5,7)+'/'+String(s).slice(0,4):'—';
const fDur=s=>{ if(s<60) return 'menos de 1 min'; s=Math.round(s/60); return s<60?s+' min':Math.floor(s/60)+' h '+String(s%60).padStart(2,'0'); };
const hoyISO=()=>{ const d=new Date(); return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); };
async function coLoad(){ try{ CO.info=await api('/api/coche'); CO.err=null; }catch(e){ CO.err='No hay conexión con el puente'; } }
async function coAct(body,okMsg){
  const r=await api('/api/coche',body).catch(()=>({ok:false,error:'Sin respuesta del puente'}));
  if(!r.ok){ toast(r.error||'No se pudo guardar'); return false; }
  if(okMsg) toast(okMsg); closeOv(); await coLoad(); if(S.view==='coche') renderApp(); return true;
}

/* ---------- Estilos propios ---------- */
document.head.insertAdjacentHTML('beforeend',`<style>
.co-k{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.co-t{background:var(--panel);border-radius:16px;padding:14px 16px;min-width:0;display:flex;flex-direction:column;gap:2px}
.co-t small{color:var(--muted);font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.co-t b{font-family:var(--f-d);font-size:38px;line-height:1.05;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-t b u{text-decoration:none;font-size:20px;color:var(--muted);margin-left:4px}
.co-t span{color:var(--muted);font-size:13px}
.co-t .pill{align-self:flex-start;margin-top:8px;padding:6px 12px;font-size:13px}
.co-2{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:12px;margin-top:12px}
.co-box{background:var(--panel);border-radius:16px;padding:14px 16px;min-width:0}
.co-box h4{margin:0 0 8px;font-family:var(--f-d);font-size:22px;display:flex;align-items:center;gap:8px}
.co-box h4 .pill{margin-left:auto;font-family:var(--f-b);font-size:13px;padding:6px 12px}
.co-li{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line);min-width:0}
.co-li:first-of-type{border-top:0}
.co-li>div{flex:1;min-width:0}.co-li b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-li span{color:var(--muted);font-size:13px}
.co-li .r{text-align:right;flex:none}.co-li .r b{font-family:var(--f-d);font-size:22px;font-variant-numeric:tabular-nums}
.chip{flex:none;font-size:12px;font-weight:800;letter-spacing:.04em;border-radius:6px;padding:3px 8px;background:var(--panel-2);color:var(--muted)}
.chip.vencido{background:rgba(255,77,79,.16);color:var(--stop)}.chip.pronto{background:rgba(255,176,32,.16);color:#ffb020}.chip.ok{background:rgba(52,196,106,.14);color:var(--ok)}
.co-bar{height:6px;border-radius:3px;background:var(--panel-2);overflow:hidden;margin:6px 0 4px}
.co-bar i{display:block;height:100%;border-radius:3px;background:var(--ok)}
.co-bar i.pronto{background:#ffb020}.co-bar i.vencido{background:var(--stop)}
.co-mant{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.co-it{background:var(--panel);border-radius:16px;padding:14px 16px;min-width:0;display:flex;flex-direction:column}
.co-it .h{display:flex;gap:10px;align-items:flex-start}.co-it .h b{flex:1;min-width:0;font-size:17px}
.co-it .t{font-size:15px}.co-it .u{color:var(--muted);font-size:13px;margin-top:2px}
.co-it .n{color:var(--muted);font-size:12.5px;margin-top:6px;line-height:1.4}
.co-it .a{display:flex;gap:8px;margin-top:auto;padding-top:10px}.co-it .a .pill{padding:7px 14px;font-size:14px}
.co-f{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;margin-top:12px}
.co-f label{display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--muted);font-weight:700;min-width:0}
.co-f label.w{grid-column:1/-1}
.co-f input,.co-f select{background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:11px 12px;color:var(--fg);font:inherit;font-size:17px;min-width:0;width:100%}
.co-f input[type=date]{color-scheme:dark}
.co-sw{display:flex;gap:6px}.co-sw button{flex:1;padding:10px;border-radius:10px;background:var(--panel-2);font-weight:700;color:var(--muted)}.co-sw button.on{background:var(--accent);color:#fff}
.co-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}.co-btns .izq{margin-right:auto}
.co-note{color:var(--muted);font-size:13px;line-height:1.45;margin:10px 0 0}
.co-chart{width:100%;height:auto;display:block;margin-top:4px}
.co-chart text{fill:var(--muted);font:600 12px var(--f-b)}.co-chart .v{fill:var(--fg);font:700 13px var(--f-b)}
.co-empty{color:var(--muted);padding:6px 0;line-height:1.5}
.tag-sim{font-size:11px;font-weight:800;color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:1px 6px;margin-left:6px;vertical-align:2px}
@media (max-width:900px){.co-k{grid-template-columns:1fr 1fr}.co-2,.co-mant{grid-template-columns:1fr}}
</style>`);

/* ---------- Vista ---------- */
VIEWS.coche=()=>{
  const tabs=[['resumen','Resumen'],['consumo','Consumo'],['viajes','Viajes'],['taller','Taller'],['ruedas','Ruedas']];
  const t=`<div class="tabs">${tabs.map(([k,n])=>`<button class="${CO.tab===k?'on':''}" data-co="tab" data-k="${k}">${n}</button>`).join('')}</div>`;
  let body;
  if(!SYS.bridge) body='<p class="co-empty">Mi coche guarda los datos en el puente. Abre Radar Play con «Iniciar Radar Play» (o en la Raspberry) para usarlo.</p>';
  else if(!CO.info) body=`<p class="co-empty">${CO.err||'Leyendo…'}</p>`;
  else body=({resumen:coResumen,consumo:coConsumo,viajes:coViajes,taller:coTaller,ruedas:typeof coRuedas==='function'?coRuedas:()=>''}[CO.tab]||coResumen)();
  return `${appbar('Mi coche · Giulietta')}<div class="abody">${t}${body}</div>`;
};
function kmTile(n){
  return `<div class="co-t"><small>Kilómetros</small><b>${n.km_total!=null?nf(n.km_total):'—'}<u>km</u></b>
    <span>${n.odometro?'Ajustado el '+fD(n.odometro.fecha):'Pon los km que marca el cuadro'}</span><button class="pill" data-co="odo">${n.odometro?'Ajustar':'Poner km'}</button></div>`;
}
function coResumen(){
  const n=CO.info, c=n.consumo, p=n.pendientes||[];
  const ult=n.repostajes[0], v=n.viaje;
  return `<div class="co-k">${kmTile(n)}
    <div class="co-t"><small>Consumo real</small><b>${nf(c.media,1)}<u>l/100</u></b><span>${c.media!=null?'Media de '+c.tramos.length+' depósito'+(c.tramos.length>1?'s':'')+' · último '+nf(c.ultima,1):'Apunta dos repostajes con el depósito lleno'}</span></div>
    <div class="co-t"><small>Consumo estimado</small><b>${nf(n.consumo_est,1)}<u>l/100</u></b><span>${n.consumo_est!=null?'Calculado por el motor en tus viajes':'Saldrá al conducir con el lector OBD'}</span></div>
    <div class="co-t"><small>Este mes</small><b>${nf(n.mes.km)}<u>km</u></b><span>${n.mes.viajes} viaje${n.mes.viajes===1?'':'s'} · ${nf(n.mes.horas,1)} h al volante</span></div></div>
  <div class="co-2">
    <div class="co-box"><h4>Taller<button class="pill" data-co="tab" data-k="taller">Ver todo</button></h4>
      ${p.length?p.slice(0,4).map(x=>`<div class="co-li"><span class="chip ${x.urgente?'vencido':'pronto'}">${x.urgente?'PASADO':'PRONTO'}</span><div><b>${esc(x.nombre)}</b><span>${esc(x.texto)}</span></div></div>`).join('')
        :'<p class="co-empty">Nada pendiente en los próximos 1.500 km o 30 días.</p>'}</div>
    <div class="co-box"><h4>${v?'Viaje en curso':'Último repostaje'}${v?'':'<button class="pill on" data-co="rep">Repostar</button>'}</h4>
      ${v?`<div class="co-li"><div><b>${nf(v.km,1)} km · ${fDur(v.duracion_s)}</b><span>Media ${nf(v.vel_media)} km/h${v.consumo_est!=null?' · '+nf(v.consumo_est,1)+' l/100 estimado':''}${v.simulado?' · simulado':''}</span></div></div>`
        :ult?`<div class="co-li"><div><b>${nf(ult.litros,2)} l${ult.euros?' · '+nf(ult.euros,2)+' €':''}</b><span>${fD(ult.fecha)} · ${nf(ult.km)} km${ult.lleno?' · lleno':' · parcial'}</span></div></div>
          <p class="co-note">${c.precio_litro?'Precio medio '+nf(c.precio_litro,3)+' €/l'+(c.media?' · unos '+nf(c.media*c.precio_litro,2)+' € cada 100 km':''):''}</p>`
        :'<p class="co-empty">Cuando eches gasoil, apúntalo aquí para saber lo que gasta de verdad.</p>'}</div>
  </div>`;
}
function coChart(tr){
  tr=tr.slice(-10); if(!tr.length) return '';
  const W=640,H=190,pl=8,pb=26,pt=22, max=Math.max(...tr.map(t=>t.l100))*1.15, bw=(W-pl*2)/tr.length;
  const y=v=>H-pb-(v/max)*(H-pb-pt), med=tr.reduce((a,t)=>a+t.litros,0)/tr.reduce((a,t)=>a+t.km,0)*100;
  return `<svg class="co-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Consumo de cada depósito en litros cada 100 km">
    <line x1="${pl}" x2="${W-pl}" y1="${H-pb}" y2="${H-pb}" stroke="var(--line)"/>
    ${tr.map((t,i)=>{ const x=pl+i*bw+bw*.18, w=bw*.64; return `<rect x="${x}" y="${y(t.l100)}" width="${w}" height="${H-pb-y(t.l100)}" rx="4" fill="${t.l100>med*1.08?'#ffb020':'var(--accent)'}"/>
      <text class="v" x="${x+w/2}" y="${y(t.l100)-6}" text-anchor="middle">${nf(t.l100,1)}</text><text x="${x+w/2}" y="${H-8}" text-anchor="middle">${fD(t.fecha).slice(0,5)}</text>`; }).join('')}
    <line x1="${pl}" x2="${W-pl}" y1="${y(med)}" y2="${y(med)}" stroke="var(--fg)" stroke-dasharray="5 5" opacity=".55"/>
  </svg><p class="co-note">Litros cada 100 km de cada depósito. La línea es tu media (${nf(med,1)}); en naranja, los que gastaron bastante más.</p>`;
}
function coConsumo(){
  const n=CO.info, c=n.consumo, R=n.repostajes;
  return `<div class="co-k">
    <div class="co-t"><small>Media real</small><b>${nf(c.media,1)}<u>l/100</u></b><span>Depósito lleno a depósito lleno</span></div>
    <div class="co-t"><small>Último depósito</small><b>${nf(c.ultima,1)}<u>l/100</u></b><span>${c.tramos.length?nf(c.tramos[c.tramos.length-1].km)+' km con '+nf(c.tramos[c.tramos.length-1].litros,1)+' l':'—'}</span></div>
    <div class="co-t"><small>Precio medio</small><b>${nf(c.precio_litro,3)}<u>€/l</u></b><span>${c.media&&c.precio_litro?nf(c.media*c.precio_litro,2)+' € cada 100 km':'Pon los euros al repostar'}</span></div>
    <div class="co-t"><small>Gastado en gasoil</small><b>${nf(c.gastado,0)}<u>€</u></b><span>${R.length} repostaje${R.length===1?'':'s'} apuntado${R.length===1?'':'s'}</span></div></div>
  <div class="co-2">
    <div class="co-box"><h4>Consumo por depósito</h4>${c.tramos.length?coChart(c.tramos):'<p class="co-empty">Necesito dos repostajes con el depósito lleno para calcular el primero.</p>'}</div>
    <div class="co-box"><h4>Repostajes<button class="pill on" data-co="rep">Añadir</button></h4>
      ${R.length?R.slice(0,12).map(r=>`<button class="co-li row" style="padding:10px 4px" data-co="repEd" data-id="${r.id}"><div><b>${fD(r.fecha)} · ${nf(r.km)} km</b><span>${r.lleno?'Lleno':'Parcial'}${r.euros&&r.litros?' · '+nf(r.euros/r.litros,3)+' €/l':''}${r.notas?' · '+esc(r.notas):''}</span></div><div class="r"><b>${nf(r.litros,2)} l</b><span>${r.euros?nf(r.euros,2)+' €':''}</span></div></button>`).join('')
        :'<p class="co-empty">Aún no hay repostajes.</p>'}
      <p class="co-note">Para que el consumo sea exacto, llena hasta que salte el surtidor y marca «Lleno». Si echas solo una parte, márcalo como «Parcial»: se suma al siguiente lleno.</p></div>
  </div>`;
}
function coViajes(){
  const V=CO.info.viajes;
  if(!V.length) return '<p class="co-empty">Los viajes se apuntan solos al conducir: empiezan al pasar de 5 km/h y terminan tras 10 minutos parado o al apagar.</p>';
  return `<div class="co-box">${V.map(v=>`<button class="co-li row" style="padding:10px 4px" data-co="viaje" data-id="${v.id}">
    <div><b>${fD(v.inicio)} · ${v.inicio.slice(11,16)}${v.simulado?'<span class="tag-sim">SIMULADO</span>':''}${v.terminado?'':'<span class="tag-sim">EN CURSO</span>'}</b>
    <span>${fDur(v.duracion_s)} · media ${nf(v.vel_media)} km/h · máx ${nf(v.vel_max)} km/h${v.consumo_est!=null?' · '+nf(v.consumo_est,1)+' l/100':''}</span></div>
    <div class="r"><b>${nf(v.km,1)} km</b></div></button>`).join('')}</div>
    <p class="co-note">Los viajes simulados se guardan para que lo pruebes, pero no suman kilómetros ni cuentan en las medias.</p>`;
}
function coTaller(){
  const n=CO.info, M=n.mant, H=n.historial;
  const it=m=>{ const pr=m.progreso!=null?Math.min(100,m.progreso*100):0;
    const ult=m.fecha?(m.fecha_limite?'Vence el '+fD(m.fecha_limite):''):(m.ultima_fecha||m.ultimo_km!=null?'Última vez: '+[m.ultima_fecha?fD(m.ultima_fecha):null,m.ultimo_km!=null?nf(m.ultimo_km)+' km':null].filter(Boolean).join(' · '):'');
    const cada=m.fecha?'':[m.cada_km?'cada '+nf(m.cada_km)+' km':null,m.cada_meses?(m.cada_meses%12===0?'cada '+(m.cada_meses/12)+(m.cada_meses===12?' año':' años'):'cada '+m.cada_meses+' meses'):null].filter(Boolean).join(' o ');
    return `<div class="co-it"><div class="h"><b>${esc(m.nombre)}</b><span class="chip ${m.estado}">${{vencido:'PASADO',pronto:'PRONTO',ok:'AL DÍA',sin_datos:'SIN DATOS'}[m.estado]}</span></div>
      ${m.progreso!=null?`<div class="co-bar"><i class="${m.estado}" style="width:${pr}%"></i></div>`:''}
      <div class="t">${esc(m.texto)}</div><div class="u">${[ult,cada].filter(Boolean).join(' · ')}</div>${m.notas?`<div class="n">${esc(m.notas)}</div>`:''}
      <div class="a"><button class="pill on" data-co="hecho" data-id="${m.id}">${m.fecha?'Renovado':'Hecho'}</button><button class="pill" data-co="item" data-id="${m.id}">Editar</button></div></div>`; };
  return `<div class="co-k" style="grid-template-columns:repeat(3,minmax(0,1fr))">${kmTile(n)}
    <div class="co-t"><small>Pendiente</small><b>${M.filter(m=>m.estado==='vencido'||m.estado==='pronto').length}<u>tareas</u></b><span>${M.filter(m=>m.estado==='vencido').length} pasadas de fecha o km</span></div>
    <div class="co-t"><small>Gastado en taller</small><b>${nf(n.gasto_taller)}<u>€</u></b><span>${H.length} trabajo${H.length===1?'':'s'} apuntado${H.length===1?'':'s'}</span></div></div>
  ${M.some(m=>m.estado==='sin_datos')?'<p class="co-note">Para que avise a tiempo, entra en «Editar» de cada tarea y pon cuándo se hizo por última vez (fecha y km). Lo encontrarás en las facturas o en el libro de mantenimiento.</p>':''}
  <h3 class="sh" style="margin-bottom:10px">Mantenimiento</h3><div class="co-mant">${M.map(it).join('')}</div>
  <div class="co-btns" style="justify-content:flex-start"><button class="pill" data-co="item" data-id="">Añadir tarea</button><button class="pill" data-co="plan">Recuperar tareas del plan</button></div>
  <h3 class="sh" style="margin-bottom:10px">Historial</h3>
  <div class="co-box">${H.length?H.map(h=>`<div class="co-li"><div><b>${esc(h.nombre)}</b><span>${fD(h.fecha)}${h.km!=null?' · '+nf(h.km)+' km':''}${h.taller?' · '+esc(h.taller):''}${h.fecha_limite?' · vence '+fD(h.fecha_limite):''}${h.notas?' · '+esc(h.notas):''}</span></div>
    <div class="r"><b>${h.coste!=null?nf(h.coste,2)+' €':''}</b></div><button class="pill" style="padding:6px 10px" data-co="hBorra" data-id="${h.id}" aria-label="Borrar">✕</button></div>`).join('')
    :'<p class="co-empty">Cada vez que pulses «Hecho» se apunta aquí, con la fecha, los km y lo que costó.</p>'}</div>
  <p class="co-note">Intervalos orientativos para el Giulietta 1.6 JTDM. Compruébalos con tu libro de mantenimiento y cámbialos en «Editar» si tu taller te dice otros.</p>`;
}

/* ---------- Formularios ---------- */
const fIn=(id,label,val,extra='')=>{ const ty=extra.includes('date')?'type="date"':extra.includes('txt')?'type="text"':'type="text" inputmode="decimal"';
  return `<label${/\bw\b/.test(extra)?' class="w"':''}>${label}<input id="${id}" ${ty} value="${val==null?'':esc(String(val))}"></label>`; };
const v_=id=>{ const e=$(id); return e?e.value.trim():''; };
function formOdo(){
  const n=CO.info;
  overlay(`<h2>Kilómetros del cuadro</h2><p>Escribe los km que marca ahora el cuentakilómetros del Giulietta. A partir de ahí, Radar Play suma lo que recorras con el GPS.</p>
    <div class="co-f">${fIn('fOdo','Kilómetros',n.km_total!=null?Math.round(n.km_total):'','w')}</div>
    <div class="co-btns"><button class="pill" id="cOv">Cancelar</button><button class="pill on" id="fOk">Guardar</button></div>`);
  $('cOv').onclick=closeOv; $('fOk').onclick=()=>coAct({accion:'odometro',km:v_('fOdo')},'Kilómetros guardados');
}
function formRep(r){
  const n=CO.info; r=r||{fecha:hoyISO(),km:n.km_total!=null?Math.round(n.km_total):'',lleno:true};
  overlay(`<h2>${r.id?'Repostaje':'Nuevo repostaje'}</h2>
    <div class="co-f">${fIn('fRf','Fecha',r.fecha,'date')}${fIn('fRk','Km del cuadro',r.km)}${fIn('fRl','Litros',r.litros!=null?String(r.litros).replace('.',','):'')}${fIn('fRe','Euros (opcional)',r.euros!=null?String(r.euros).replace('.',','):'')}
      <label class="w">Depósito<div class="co-sw"><button id="fLl" class="${r.lleno?'on':''}">Lleno</button><button id="fPa" class="${r.lleno?'':'on'}">Parcial</button></div></label>
      ${fIn('fRn','Notas (gasolinera, etc.)',r.notas||'','w txt')}</div>
    <div class="co-btns">${r.id?'<button class="pill izq" id="fDel">Borrar</button>':''}<button class="pill" id="cOv">Cancelar</button><button class="pill on" id="fOk">Guardar</button></div>`);
  if(r.precio){ const L=$('fRl'), Eu=$('fRe'); L.addEventListener('input',()=>{ const l=parseFloat(L.value.replace(',','.')); if(l>0) Eu.value=(l*r.precio).toFixed(2).replace('.',','); }); }
  let lleno=!!r.lleno; $('fLl').onclick=()=>{ lleno=true; $('fLl').classList.add('on'); $('fPa').classList.remove('on'); }; $('fPa').onclick=()=>{ lleno=false; $('fPa').classList.add('on'); $('fLl').classList.remove('on'); };
  $('cOv').onclick=closeOv;
  $('fOk').onclick=()=>coAct({accion:'repostaje',id:r.id,fecha:v_('fRf'),km:v_('fRk'),litros:v_('fRl'),euros:v_('fRe'),lleno,notas:v_('fRn')},'Repostaje guardado');
  if($('fDel')) $('fDel').onclick=()=>coAct({accion:'borrar_repostaje',id:r.id},'Repostaje borrado');
}
function formHecho(m){
  const n=CO.info;
  overlay(`<h2>${esc(m.nombre)}</h2><p>${m.fecha?'Apunta la renovación y la nueva fecha de vencimiento.':'Apunta que se ha hecho. Desde aquí se cuenta el siguiente cambio.'}</p>
    <div class="co-f">${fIn('fHf','Fecha',hoyISO(),'date')}${m.fecha?fIn('fHv','Nueva fecha de vencimiento','', 'date'):fIn('fHk','Km del cuadro',n.km_total!=null?Math.round(n.km_total):'')}
      ${fIn('fHc','Coste en € (opcional)','')}${fIn('fHt','Taller (opcional)','','txt')}${fIn('fHn','Notas: marca, referencia…','','w txt')}</div>
    <div class="co-btns"><button class="pill" id="cOv">Cancelar</button><button class="pill on" id="fOk">Guardar</button></div>`);
  $('cOv').onclick=closeOv;
  $('fOk').onclick=()=>coAct({accion:'hecho',item:m.id,fecha:v_('fHf'),km:m.fecha?'':v_('fHk'),fecha_limite:v_('fHv'),coste:v_('fHc'),taller:v_('fHt'),notas:v_('fHn')},'Apuntado en el historial');
}
function formItem(m){
  m=m||{id:'',nombre:'',fecha:false}; let porFecha=!!m.fecha;
  const draw=()=>{ overlay(`<h2>${m.id?'Editar tarea':'Nueva tarea'}</h2>
    <div class="co-f">${fIn('fIn','Nombre',m.nombre,'w txt')}
      <label class="w">Tipo<div class="co-sw"><button id="fT1" class="${porFecha?'':'on'}">Cada cierto tiempo o km</button><button id="fT2" class="${porFecha?'on':''}">Con fecha de vencimiento</button></div></label>
      ${porFecha?fIn('fIv','Vence el',m.fecha_limite||'','date w')
        :fIn('fIk','Cada (km)',m.cada_km||'')+fIn('fIm','Cada (meses)',m.cada_meses||'')+fIn('fIf','Última vez: fecha',m.ultima_fecha||'','date')+fIn('fIu','Última vez: km',m.ultimo_km!=null?m.ultimo_km:'')}
      ${fIn('fIo','Notas',m.notas||'','w txt')}</div>
    <div class="co-btns">${m.id?'<button class="pill izq" id="fDel">Quitar tarea</button>':''}<button class="pill" id="cOv">Cancelar</button><button class="pill on" id="fOk">Guardar</button></div>`);
    $('fT1').onclick=()=>{ m.nombre=v_('fIn'); porFecha=false; draw(); }; $('fT2').onclick=()=>{ m.nombre=v_('fIn'); porFecha=true; draw(); };
    $('cOv').onclick=closeOv;
    $('fOk').onclick=()=>coAct(porFecha?{accion:'editar_item',id:m.id,nombre:v_('fIn'),fecha:true,fecha_limite:v_('fIv'),notas:v_('fIo')}
      :{accion:'editar_item',id:m.id,nombre:v_('fIn'),fecha:false,cada_km:v_('fIk'),cada_meses:v_('fIm'),ultima_fecha:v_('fIf'),ultimo_km:v_('fIu'),notas:v_('fIo')},'Tarea guardada');
    if($('fDel')) $('fDel').onclick=()=>confirmBox('¿Quitar «'+m.nombre+'»?','Se quita del plan. Lo que ya está en el historial se queda.','Quitar',()=>coAct({accion:'borrar_item',id:m.id},'Tarea quitada'));
  }; draw();
}
function verViaje(v){
  let svg='';
  if(v.ruta&&v.ruta.length>1){ const la=v.ruta.map(p=>p[0]), lo=v.ruta.map(p=>p[1]), k=Math.cos(la[0]*Math.PI/180);
    const x0=Math.min(...lo), x1=Math.max(...lo), y0=Math.min(...la), y1=Math.max(...la), w=Math.max((x1-x0)*k,1e-4), h=Math.max(y1-y0,1e-4), s=Math.min(560/w,220/h);
    const P=v.ruta.map(p=>[20+((p[1]-x0)*k)*s+(560-w*s)/2, 20+(y1-p[0])*s+(220-h*s)/2]);
    svg=`<svg viewBox="0 0 600 260" style="width:100%;height:auto;background:var(--bg2);border-radius:14px;margin-top:10px" role="img" aria-label="Recorrido del viaje">
      <polyline points="${P.map(p=>p.map(n=>n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${P[0][0]}" cy="${P[0][1]}" r="7" fill="var(--ok)"/><circle cx="${P[P.length-1][0]}" cy="${P[P.length-1][1]}" r="7" fill="var(--fg)"/></svg>`; }
  overlay(`<h2>Viaje del ${fD(v.inicio)}</h2><p>${v.inicio.slice(11,16)} – ${v.fin.slice(11,16)}${v.simulado?' · simulado':''}</p>${svg}
    <div class="co-k" style="margin-top:12px;grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="co-t"><small>Distancia</small><b>${nf(v.km,1)}<u>km</u></b></div><div class="co-t"><small>Tiempo</small><b style="font-size:30px">${fDur(v.duracion_s)}</b></div>
      <div class="co-t"><small>Media</small><b>${nf(v.vel_media)}<u>km/h</u></b></div><div class="co-t"><small>Consumo</small><b>${nf(v.consumo_est,1)}<u>l/100</u></b></div></div>
    <div class="co-btns"><button class="pill izq" id="fDel">Borrar viaje</button><button class="pill on" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv; $('fDel').onclick=()=>coAct({accion:'borrar_viaje',id:v.id},'Viaje borrado');
}

/* ---------- Clics ---------- */
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-co]'); if(!el) return; e.stopPropagation(); const a=el.dataset.co, id=el.dataset.id, n=CO.info;
  if(a==='tab'){ CO.tab=el.dataset.k; LS.set('rp-coche-tab',CO.tab); if(S.view!=='coche') setView('coche'); else renderApp(); return; }
  if(!n) return;
  if(a==='odo') formOdo();
  if(a==='rep') formRep();
  if(a==='repEd') formRep(n.repostajes.find(r=>r.id===id));
  if(a==='hecho') formHecho(n.mant.find(m=>m.id===id));
  if(a==='item') formItem(id?{...n.mant.find(m=>m.id===id)}:null);
  if(a==='viaje') verViaje(n.viajes.find(v=>v.id===id));
  if(a==='plan') coAct({accion:'restaurar_plan'},'Plan revisado');
  if(a==='hBorra') confirmBox('¿Borrar este apunte?','Se borra del historial. La tarea no cambia.','Borrar',()=>coAct({accion:'borrar_historial',id}));
},true);

/* Cargar al abrir y refrescar cada 10 s mientras está a la vista (sin tocar formularios abiertos) */
const _rApp5=renderApp; renderApp=function(){ _rApp5(); if(S.view==='coche'&&SYS.bridge&&!CO.info&&!CO.err) coLoad().then(()=>{ if(S.view==='coche') renderApp(); }); };
setInterval(async()=>{ if(S.view!=='coche'||!SYS.bridge||!$('ov').hidden) return; await coLoad(); if(S.view==='coche'&&$('ov').hidden){ const ab=document.querySelector('#appview .abody'), y=ab?ab.scrollTop:0; renderApp(); const nb=document.querySelector('#appview .abody'); if(nb) nb.scrollTop=y; } },10000);

/* Recordatorio de mantenimiento al arrancar (una vez al día) */
const _navInit3=navInit; navInit=function(...a){ _navInit3(...a); setTimeout(async()=>{ if(!SYS.bridge) return; await coLoad(); const m=CO.info&&CO.info.pendientes||[]; const hoy=new Date().toDateString();
  if(m.length&&LS.get('rp-mant-aviso')!==hoy&&$('banner').hidden){ LS.set('rp-mant-aviso',hoy); const x=m[0];
    showBanner(`Mantenimiento: ${x.nombre} (${x.texto.replace(/^Toca /,'')})`,[['Ver',()=>{ CO.tab='taller'; setView('coche'); }],['Vale',null]],20000); sayQ('Recordatorio de mantenimiento: '+x.nombre+'.'); } },KIOSK?9000:5000); };

/* Siri: «abre mi coche», «cuánto consume», «cuántos kilómetros» */
if(typeof siriHandle==='function'){ const _sh=siriHandle; siriHandle=function(t){ const s=(t||'').toLowerCase();
  if(/consum|gasta/.test(s)&&CO.info){ const c=CO.info.consumo; setView('coche'); CO.tab='consumo'; renderApp(); return sayQ(c.media!=null?'Consumo medio real: '+nf(c.media,1)+' litros cada cien kilómetros.':'Aún no tengo repostajes suficientes para calcularlo.'); }
  if(/kil[oó]metros|cuentakil/.test(s)&&CO.info&&CO.info.km_total!=null){ setView('coche'); return sayQ('El coche lleva '+nf(CO.info.km_total)+' kilómetros.'); }
  if(/mi coche|mantenimiento|taller/.test(s)){ CO.tab=/manten|taller/.test(s)?'taller':'resumen'; return setView('coche'); }
  return _sh.apply(this,arguments); }; }
