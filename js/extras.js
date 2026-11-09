/* =====================================================================
   Radar Play · Dashcam, luz ambiente y estado del hardware nuevo
   ===================================================================== */
const XT={dash:null,leds:null,hw:{}};

/* ---------- Dashcam (Sistema) ---------- */
function dashHTML(){
  const d=XT.dash; if(!d) return '';
  const clips=d.clips||[], guard=clips.filter(c=>c.protegido);
  return `<h3 class="sh">Dashcam</h3>
    <div class="set"><div><b>${d.activo?(d.grabando?'Grabando':'Parada'):'Sin dashcam'}</b><div class="muted">${esc(d.msg||'')}${d.ultimo_guardado?' · último guardado '+esc(d.ultimo_guardado):''}${d.error?' · '+esc(d.error.slice(0,90)):''}</div></div>
      ${d.activo?`<span style="display:flex;gap:8px"><button class="pill on" data-dc="guardar">Guardar vídeo</button><button class="pill" data-dc="${d.grabando?'pausar':'seguir'}">${d.grabando?'Pausar':'Grabar'}</button></span>`:''}</div>
    ${clips.length?`<div class="set"><div><b>Vídeos</b><div class="muted">${guard.length} guardados · ${clips.length-guard.length} en bucle (se borran los más viejos)</div></div><button class="pill" data-dc="lista">Ver vídeos</button></div>`:''}
    ${!d.activo?'<p class="muted" style="margin:4px 4px 0;font-size:13px">Pon DASHCAM_CAMARA=/dev/video0 (la cámara delantera) en sistema/radar-play.conf. Con el acelerómetro, un golpe guarda el vídeo solo.</p>':''}`;
}
function dashLista(){
  const c=(XT.dash&&XT.dash.clips)||[];
  overlay(`<h2>Vídeos de la dashcam</h2><video id="dcV" controls playsinline style="width:100%;max-height:46vh;background:#000;border-radius:12px;display:none"></video>
    <div class="mp-res">${c.map(x=>`<div class="row" style="padding:9px 4px"><div style="flex:1;min-width:0"><b>${esc(x.fecha)}${x.protegido?' <span class="chip pronto" style="margin-left:6px">GUARDADO</span>':''}</b><span>${x.mb} MB · ${esc(x.nombre)}</span></div>
      <button class="pill" data-dc="ver" data-u="${esc(x.url)}">Ver</button><button class="pill" data-dc="borrar" data-n="${esc(x.nombre)}">Borrar</button></div>`).join('')||'<p>No hay vídeos.</p>'}</div>
    <div style="text-align:right;margin-top:10px"><button class="pill on" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv;
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-dc]'); if(!el) return; e.stopPropagation(); const a=el.dataset.dc;
  if(a==='lista') return dashLista();
  if(a==='ver'){ const v=$('dcV'); v.style.display='block'; v.src=el.dataset.u; v.play().catch(()=>{}); return; }
  if(a==='borrar'){ await api('/api/dashcam',{accion:'borrar',nombre:el.dataset.n}).catch(()=>{}); await xtLoad(); return dashLista(); }
  const r=await api('/api/dashcam',{accion:a}).catch(()=>({ok:false,error:'Sin respuesta'}));
  toast(r.ok?(a==='guardar'?'Vídeo guardado: no se borrará solo':a==='pausar'?'Dashcam en pausa':'Dashcam grabando'):r.error);
  await xtLoad(); renderApp();
},true);

/* ---------- Luz ambiente (Ajustes) ---------- */
const LCOL=['#ff1e1e','#ff8a00','#ffd400','#27d36f','#1fb8ff','#3b5bff','#a63bff','#ffffff'];
function ledsHTML(){
  const l=XT.leds; if(!l) return '';
  return `<h3 class="sh">Luz ambiente</h3>
    <div class="set"><div><b>Tira LED</b><div class="muted">${esc(l.msg)}${l.n?' · '+l.n+' LEDs':''}</div></div>
      <span class="co-sw" style="min-width:420px">${[['dna','Según DNA'],['color','Un color'],['respirar','Respirar'],['arcoiris','Arcoíris'],['apagado','Apagada']].map(([k,n])=>`<button class="${l.modo===k?'on':''}" data-lx="modo" data-k="${k}">${n}</button>`).join('')}</span></div>
    <div class="set"><div><b>Color</b><div class="muted">Dynamic rojo · Normal blanco cálido · All Weather azul</div></div><span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><input type="color" id="lxC" value="${l.color?'#'+l.color.map(x=>x.toString(16).padStart(2,'0')).join(''):'#ff2020'}" aria-label="Elegir cualquier color" style="width:38px;height:32px;border:0;background:none;padding:0">${LCOL.map(c=>`<button data-lx="color" data-k="${c}" aria-label="Color ${c}" style="width:30px;height:30px;border-radius:50%;background:${c};border:2px solid ${l.color&&'#'+l.color.map(x=>x.toString(16).padStart(2,'0')).join('')===c?'var(--fg)':'transparent'}"></button>`).join('')}</span></div>
    <div class="set"><div><b>Brillo</b><div class="muted">${l.brillo} %</div></div><input type="range" id="lxB" min="5" max="100" value="${l.brillo}" style="width:240px"></div>
    ${lxBtHTML(l.bt||{})}`;
}
/* Tiras USB que se manejan con una app del móvil: van por Bluetooth */
function lxBtHTML(b){
  const lista=(b.encontradas||[]).map(x=>`<div class="set"><div><b>${esc(x.nombre)}</b><div class="muted">${esc(x.mac)}${x.rssi?' · señal '+x.rssi+' dBm':''}</div></div><button class="pill on" data-lxbt="usar" data-mac="${esc(x.mac)}" data-n="${esc(x.nombre)}">Usar esta</button></div>`).join('');
  const otros=(b.otros||[]).length&&!b.mac?`<details style="margin:4px 0 8px"><summary class="muted" style="cursor:pointer">¿No sale la tuya? Ver todos los aparatos Bluetooth (${b.otros.length})</summary>${b.otros.map(x=>`<div class="set"><div><b>${esc(x.nombre)}</b><div class="muted">${esc(x.mac)}</div></div><button class="pill" data-lxbt="usar" data-mac="${esc(x.mac)}" data-n="${esc(x.nombre)}">Probar esta</button></div>`).join('')}</details>`:'';
  const ajuste=b.mac&&b.conectado?`<div class="set"><div><b>¿Salen los colores cambiados?</b><div class="muted">Orden actual: ${esc((b.orden||'rgb').toUpperCase())}. Tu controlador pone G R B: si pides rojo y sale otro color, ajústalo aquí</div></div><button class="pill" data-lxbt="asistente">Ajustar colores</button></div>`:'';
  return ajuste+otros+`<div class="set"><div><b>Tira USB por Bluetooth</b><div class="muted">${b.mac?(b.conectado?'✓ ':'')+esc(b.msg||b.nombre||b.mac):'Si tu tira tiene app en el móvil (duoCo, Lotus Lamp, Happy Lighting…), cierra esa app y pulsa Buscar'}</div></div>
    <span style="display:flex;gap:8px">${b.mac?'<button class="pill" data-lxbt="olvidar">Olvidar</button>':''}<button class="pill ${b.mac?'':'on'}" data-lxbt="buscar">${b.buscando?'Buscando…':'Buscar'}</button></span></div>${lista}`;
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-lxbt]'); if(!el) return; e.stopPropagation(); const a=el.dataset.lxbt;
  if(a==='asistente') return lxAsistente();
  const r=await api('/api/leds',a==='usar'?{accion:'bt_usar',mac:el.dataset.mac,nombre:el.dataset.n}:{accion:'bt_'+a}).catch(()=>({ok:false,error:'Sin respuesta'}));
  if(!r.ok) return toast(r.error); if(a==='buscar') toast('Buscando tiras LED durante 8 segundos…');
  const rep=async n=>{ await xtLoad(); if(S.view==='ajustes') renderApp(); if(n>0&&XT.leds&&XT.leds.bt&&(XT.leds.bt.buscando||(XT.leds.bt.mac&&!XT.leds.bt.conectado))) setTimeout(()=>rep(n-1),2000); };
  rep(a==='olvidar'?0:12);
},true);
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-lx]'); if(!el) return; e.stopPropagation(); const a=el.dataset.lx, k=el.dataset.k;
  await api('/api/leds',a==='modo'?{modo:k,dna:E.dna}:{color:k}).catch(()=>{}); await xtLoad(); renderApp();
},true);
document.addEventListener('change',async e=>{ if(e.target.id==='lxB'){ await api('/api/leds',{brillo:+e.target.value}).catch(()=>{}); await xtLoad(); renderApp(); } });
/* Al cambiar el modo DNA, la luz también */
const _setDNA2=setDNA; setDNA=function(m){ _setDNA2(m); if(SYS.bridge) api('/api/leds',{dna:m}).catch(()=>{}); };

/* ---------- Carga y vistas ---------- */
async function xtLoad(){
  if(!SYS.bridge) return;
  const g=p=>api(p).catch(()=>null);
  const [dash,leds,gar,ru,bt,acel,gas]=await Promise.all(['/api/dashcam','/api/leds','/api/garaje','/api/ruedas','/api/bt','/api/acel','/api/gasolineras/estado'].map(g));
  Object.assign(XT,{dash,leds}); XT.hw={gar,ru,bt,acel,gas};
}
const _vSis4=VIEWS.sistema; VIEWS.sistema=()=>{ const s=_vSis4(); return SYS.bridge?s.replace('<h3 class="sh">Pantalla y sonido</h3>',dashHTML()+'<h3 class="sh">Pantalla y sonido</h3>'):s; };
const _vAj5=VIEWS.ajustes; VIEWS.ajustes=()=>{ const s=_vAj5(); return SYS.bridge?s.replace('<h3 class="sh">Sistema</h3>',ledsHTML()+'<h3 class="sh">Sistema</h3>'):s; };
const _rApp8=renderApp; renderApp=function(){ _rApp8(); if((S.view==='sistema'||S.view==='ajustes')&&SYS.bridge&&!XT.cargando&&Date.now()-(XT.t||0)>4000){ XT.cargando=true; XT.t=Date.now(); xtLoad().then(()=>{ XT.cargando=false; if((S.view==='sistema'||S.view==='ajustes')&&$('ov').hidden) _rApp8(); }); } };

/* Sistema › Hardware: las piezas nuevas */
const _hw2=hwHTML; hwHTML=function(){
  const h=_hw2(), x=XT.hw||{}, row=(n,st,cls,txt,como)=>`<div class="hw-r"><span class="chip ${cls}">${st}</span><div><b>${n}</b><span>${txt}</span>${como?`<small>${como}</small>`:''}</div></div>`;
  const ru=x.ru, nru=ru?Object.values(ru.ruedas||{}).filter(r=>r.fresco).length:0;
  const filas=[
    row('Bluetooth (iPhone)',x.bt&&x.bt.telefono?'Conectado':x.bt&&x.bt.disponible?'Listo':'No',x.bt&&x.bt.telefono?'ok':x.bt&&x.bt.disponible?'pronto':'',x.bt?esc(x.bt.telefono?x.bt.telefono.nombre:x.bt.msg):'—','El de la Raspberry vale; para más alcance, un adaptador USB. Micrófono USB para hablar'),
    row('Sensores de ruedas',nru?nru+' de 4':'Ninguno',nru===4?'ok':nru?'pronto':'',ru?esc(ru.estado.msg):'—','Tapones TPMS Bluetooth (los de la app «TPMS», 4 tapones). Se detectan solos'),
    row('Garaje',x.gar&&x.gar.activo?'Listo':'Simulado',x.gar&&x.gar.activo?'ok':'',x.gar?esc(x.gar.msg):'—','Por radio: emisor FS1000A (DATA→GPIO17, 5 V, antena de 17 cm) y receptor RXB6 (DATA→GPIO27, 3,3 V); se aprende en Ajustes › Garaje. Para mandos de código variable: relé en paralelo con el botón de un mando, PIN_GARAJE=número'),
    row('Acelerómetro',x.acel&&x.acel.ok?'Funcionando':'No',x.acel&&x.acel.ok?'ok':'',x.acel?esc(x.acel.msg):'—','MPU-6050 al I2C. ACELEROMETRO=1. Fuerzas G reales y golpes para la dashcam'),
    row('Dashcam',XT.dash&&XT.dash.grabando?'Grabando':'No',XT.dash&&XT.dash.grabando?'ok':'',XT.dash?esc(XT.dash.msg):'—','Una cámara USB delantera solo para grabar: DASHCAM_CAMARA=/dev/video0'),
    row('Tira LED',XT.leds&&XT.leds.activo?XT.leds.n+' LEDs':'No',XT.leds&&XT.leds.activo?'ok':'',XT.leds?esc(XT.leds.msg):'—','Tira USB con app del móvil: por Bluetooth, en Ajustes › Luz ambiente › Buscar. Tira WS2812: datos al GPIO10 con 5 V aparte, LEDS=número de LEDs'),
    row('Precios de gasolineras',x.gas&&x.gas.n?'Al día':'Sin datos',x.gas&&x.gas.n&&!x.gas.viejo?'ok':'pronto',x.gas&&x.gas.n?x.gas.n.toLocaleString('es-ES')+' gasolineras · '+esc(x.gas.fecha||''):esc((x.gas&&x.gas.error)||'Se descargan con internet'),'')];
  const i=h.lastIndexOf('</div>'); return h.slice(0,i)+filas.join('')+h.slice(i);
};

/* Siri: «guarda el vídeo» */
if(typeof siriHandle==='function'){ const _sh6=siriHandle; siriHandle=function(t){ const s=(t||'').toLowerCase();
  if(/guarda.*(v[ií]deo|grabaci)|dashcam/.test(s)){ api('/api/dashcam',{accion:'guardar'}).catch(()=>{}); return sayQ('Vídeo guardado.'); }
  return _sh6.apply(this,arguments); }; }

/* ---------- Registro (log) para depurar ---------- */
XT.log=null;
function logHTML(){
  const l=XT.log; if(!l) return '';
  return `<h3 class="sh">Registro de fallos</h3>
    <div class="set"><div><b>${l.errores?l.errores+' error'+(l.errores>1?'es':'')+(l.avisos?' y '+l.avisos+' avisos':''):'Sin errores'+(l.avisos?' · '+l.avisos+' avisos':'')} desde que arrancó</b>
      <div class="muted">Se guarda en ${esc(l.archivo)} · nivel ${esc(String(l.nivel).toLowerCase())}</div></div>
      <span style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="pill on" data-lg="ver">Ver</button><button class="pill" data-lg="errores">Solo errores</button>
      <button class="pill" data-lg="usb">Copiar a pendrive</button><button class="pill" data-lg="borrar">Borrar</button></span></div>`;
}
async function logVer(nivel){
  const r=await api('/api/log?n=400'+(nivel?'&nivel='+nivel:'')).catch(()=>null); if(!r) return toast('No puedo leer el registro');
  const col=l=>/ ERROR /.test(l)?'var(--stop)':/ WARNING /.test(l)?'#ffb020':/\[acción\]|\[pantalla\] .*Pulsa/.test(l)?'var(--fg)':'var(--muted)';
  overlay(`<h2>${nivel?'Errores y avisos':'Registro'} <span class="muted" style="font-size:14px;font-weight:600">últimas ${r.lineas.length} líneas</span></h2>
    <div id="lgBox" style="max-height:58vh;overflow:auto;background:var(--bg);border-radius:12px;padding:10px 12px;font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word">${r.lineas.map(l=>`<div style="color:${col(l)}">${esc(l)}</div>`).join('')||'Vacío'}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="pill" data-lg="${nivel?'ver':'errores'}">${nivel?'Ver todo':'Solo errores'}</button><button class="pill" data-lg="usb">Copiar a pendrive</button><button class="pill on" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv; const b=$('lgBox'); b.scrollTop=b.scrollHeight;
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-lg]'); if(!el) return; e.stopPropagation(); const a=el.dataset.lg;
  if(a==='ver') return logVer();
  if(a==='errores') return logVer('errores');
  if(a==='usb'){ const r=await api('/api/log',{accion:'usb'}).catch(()=>({ok:false,error:'Sin respuesta'})); return toast(r.ok?'Copiado al pendrive: '+r.ruta.split('/').pop():r.error); }
  if(a==='borrar') return confirmBox('¿Borrar el registro?','Se vacía el archivo de log.','Borrar',async()=>{ await api('/api/log',{accion:'borrar'}); XT.log=await api('/api/log?n=1'); renderApp(); });
},true);
const _xtLoad=xtLoad; xtLoad=async function(){ await _xtLoad(); try{ XT.log=await api('/api/log?n=1'); }catch(e){} };
const _vSis5=VIEWS.sistema; VIEWS.sistema=()=>{ const s=_vSis5(); return SYS.bridge?s.replace('<h3 class="sh">Pantalla y sonido</h3>',logHTML()+'<h3 class="sh">Pantalla y sonido</h3>'):s; };

/* Cualquier color con el selector */
document.addEventListener('change',e=>{ if(e.target&&e.target.id==='lxC') api('/api/leds',{color:e.target.value}).then(()=>xtLoad()).then(()=>{ if(S.view==='ajustes') renderApp(); }); });
/* Asistente: enciende cada canal por separado y preguntas qué color ves */
async function lxAsistente(){
  const visto=[];
  const paso=async n=>{
    await api('/api/leds',{accion:'bt_prueba',canal:n});
    const ops=['r','g','b'].filter(c=>!visto.includes(c));
    if(ops.length===1){ visto.push(ops[0]); return fin(); }
    overlay(`<h2>Ajustar colores · paso ${n} de 2</h2><p>Mira la tira. ¿De qué color está ahora?</p>
      <div style="display:flex;gap:10px;margin-top:10px">${ops.map(c=>`<button class="pill" data-lxa="${c}" style="flex:1;padding:18px;font-size:18px;background:${{r:'#d32f2f',g:'#2e7d32',b:'#1565c0'}[c]};color:#fff">${{r:'Rojo',g:'Verde',b:'Azul'}[c]}</button>`).join('')}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="pill" id="lxaNo">Cancelar</button></div>`);
    $('lxaNo').onclick=async()=>{ await api('/api/leds',{accion:'bt_prueba',canal:null}); closeOv(); };
    document.querySelectorAll('[data-lxa]').forEach(bt=>bt.onclick=()=>{ visto.push(bt.dataset.lxa); paso(n+1); });
  };
  const fin=async()=>{ const orden=visto.join(''); await api('/api/leds',{accion:'bt_orden',orden}); closeOv(); toast('Colores ajustados ('+orden.toUpperCase()+'). Prueba a elegir rojo'); await xtLoad(); if(S.view==='ajustes') renderApp(); };
  paso(1);
}
