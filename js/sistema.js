/* =====================================================================
   Radar Play · Sistema (Raspberry Pi)
   Modo coche (kiosk), animación de arranque, teclado en pantalla,
   app Sistema (estado, WiFi, volumen, brillo, actualizar, apagar),
   apagado al quitar la llave, GPS USB, copia de ajustes en la tarjeta
   y continuar la ruta tras un reinicio.
   ===================================================================== */
const KIOSK=new URLSearchParams(location.search).has('kiosk');
const SYS={bridge:false,info:null,timer:0,lastSync:'',syncTs:+(LS.get('rp-sync-ts')||0)};
const GPS={ok:false,lat:null,lng:null,speed:0,track:null,sats:null,estado:'',fixToast:false};
if(KIOSK){ document.body.dataset.kiosk='1'; document.addEventListener('contextmenu',e=>e.preventDefault()); }
/* Ratón: en la pantalla del coche el puntero está oculto, pero si mueves un ratón aparece
   (y se esconde a los 6 s quieto). En Ajustes se puede dejar siempre visible para probar. */
let ratonT=0; const ratonSiempre=()=>LS.get('rp-raton')==='1';
function ratonVer(on){ if(on) document.body.dataset.raton='1'; else if(!ratonSiempre()) document.body.removeAttribute('data-raton'); }
document.addEventListener('pointermove',e=>{ if(e.pointerType!=='mouse') return; ratonVer(true); clearTimeout(ratonT); ratonT=setTimeout(()=>ratonVer(false),6000); },{passive:true});
document.addEventListener('pointerdown',e=>{ if(e.pointerType==='touch'&&!ratonSiempre()) ratonVer(false); },{passive:true});
if(ratonSiempre()) ratonVer(true);
document.addEventListener('wheel',e=>{ if(e.ctrlKey) e.preventDefault(); },{passive:false});

ICONS.sistema=Sv('<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>');
APPS.push({id:'sistema',name:'Sistema',bg:'linear-gradient(160deg,#39424d,#14181d)'});

/* ---------- Animación de arranque ---------- */
function bootScreen(){
  const on=KIOSK||(LS.get('rp-boot')!=='0'&&!sessionStorage.getItem('rp-booted'));
  if(!on) return; sessionStorage.setItem('rp-booted','1');
  const h=new Date().getHours(), hola=h<6?'Buenas noches':h<13?'Buenos días':h<21?'Buenas tardes':'Buenas noches';
  const b=document.createElement('div'); b.id='boot';
  b.innerHTML=`<div class="bradar"><i class="sweep"></i><i class="r1"></i><i class="r2"></i><i class="r3"></i><span class="bcar"></span></div>
    <b class="bt">RADAR PLAY</b><span class="bs">${esc(LS.get('rp-coche')||'Alfa Romeo Giulietta')} · ${hola}</span><ul id="bchk"></ul>`;
  document.body.appendChild(b); b.onclick=()=>endBoot();
  const checks=[['Sistema',()=>[true,KIOSK?'Modo coche':'Modo ordenador']],['Puente',()=>[SYS.bridge,SYS.bridge?'Conectado':'Sin puente (abre con el lanzador)']],
    ['Google Maps',()=>[!!map,map?'Mapa listo':'Cargando…']],['Motor',()=>[E.real,E.real?'OBD-II en directo':'Simulado']],
    ['GPS',()=>[GPS.ok,GPS.ok?'Posición encontrada':(GPS.estado||'Sin GPS')]],['iPhone',()=>[false,'Simulado · CarPlay con el adaptador']]];
  checks.forEach((c,i)=>setTimeout(()=>{ const [ok,t]=c[1](); const li=document.createElement('li'); li.className=ok?'ok':''; li.innerHTML=`<i>${ok?'✓':'·'}</i><b>${c[0]}</b><span>${esc(t)}</span>`; const ul=$('bchk'); if(ul) ul.appendChild(li); },700+i*320));
  setTimeout(endBoot,700+checks.length*320+900);
}
function endBoot(){ const b=$('boot'); if(!b||b.classList.contains('out')) return; b.classList.add('out'); setTimeout(()=>b.remove(),600); }

/* ---------- Teclado en pantalla ---------- */
const OSK={el:null,target:null,shift:false,acc:false};
const oskOn=()=>LS.get('rp-osk')==='1'||(KIOSK&&LS.get('rp-osk')!=='0');
const OSK_ROWS=[['1','2','3','4','5','6','7','8','9','0','⌫'],['q','w','e','r','t','y','u','i','o','p','´'],['a','s','d','f','g','h','j','k','l','ñ','↵'],['⇧','z','x','c','v','b','n','m',',','.','-','@'],['Ocultar','/',' ','?','Siri']];
const ACC={a:'á',e:'é',i:'í',o:'ó',u:'ú',n:'ñ'};
function oskBuild(){
  const k=document.createElement('div'); k.id='osk'; k.hidden=true; document.body.appendChild(k); OSK.el=k;
  k.addEventListener('pointerdown',e=>{ e.preventDefault(); const b=e.target.closest('button'); if(b) oskKey(b.dataset.k); });
  oskDraw();
}
function oskDraw(){ OSK.el.innerHTML=OSK_ROWS.map(r=>`<div class="okr">${r.map(c=>{ const lab=c===' '?'espacio':(OSK.shift&&c.length===1?c.toUpperCase():c); return `<button data-k="${esc(c)}" class="${c===' '?'sp':''} ${c.length>1&&c!==' '?'fn':''} ${(c==='⇧'&&OSK.shift)||(c==='´'&&OSK.acc)?'on':''}">${esc(lab)}</button>`; }).join('')}</div>`).join(''); }
function oskKey(c){
  const t=OSK.target; if(!t) return;
  if(c==='Ocultar'){ t.blur(); oskHide(); return; }
  if(c==='Siri'){ t.blur(); oskHide(); SR.open(); return; }
  if(c==='⇧'){ OSK.shift=!OSK.shift; oskDraw(); return; }
  if(c==='´'){ OSK.acc=!OSK.acc; oskDraw(); return; }
  if(c==='⌫'){ const s=t.selectionStart,e=t.selectionEnd; if(s===e&&s>0) t.setRangeText('',s-1,s,'end'); else t.setRangeText('',s,e,'end'); t.dispatchEvent(new Event('input',{bubbles:true})); return; }
  if(c==='↵'){ if(t.tagName==='TEXTAREA'){ t.setRangeText('\n',t.selectionStart,t.selectionEnd,'end'); t.dispatchEvent(new Event('input',{bubbles:true})); } else t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true})); return; }
  let ch=c; if(OSK.acc&&ACC[c]){ ch=ACC[c]; OSK.acc=false; oskDraw(); }
  if(OSK.shift){ ch=ch.toUpperCase(); OSK.shift=false; oskDraw(); }
  t.setRangeText(ch,t.selectionStart,t.selectionEnd,'end'); t.dispatchEvent(new Event('input',{bubbles:true}));
}
function oskHide(){ if(OSK.el) OSK.el.hidden=true; document.body.classList.remove('osk'); OSK.target=null; }
document.addEventListener('focusin',e=>{ const t=e.target; if(!oskOn()||!t.matches('input:not([type=range]):not([type=checkbox]):not([type=file]):not([type=date]),textarea')) return;
  if(!OSK.el) oskBuild(); OSK.target=t; OSK.el.hidden=false; document.body.classList.add('osk'); setTimeout(()=>t.scrollIntoView({block:'center',behavior:'smooth'}),50); });
document.addEventListener('focusout',()=>setTimeout(()=>{ const a=document.activeElement; if(!a||!a.matches('input,textarea')) oskHide(); },120));

/* ---------- Enlaces externos en el coche: se abren en el iPhone con un QR ---------- */
document.addEventListener('click',e=>{
  if(!KIOSK) return; const a=e.target.closest('a[target=_blank]'); if(!a) return; e.preventDefault(); e.stopPropagation();
  overlay(`<h2>Ábrelo en tu iPhone</h2><p>En el coche no se abren otras webs. Escanea el código con la cámara del iPhone.</p><div id="lnkqr" class="qrbox" style="display:inline-block"></div><div style="text-align:right;margin-top:14px"><button class="pill" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv; if(window.QRCode) new QRCode($('lnkqr'),{text:a.href,width:200,height:200}); else $('lnkqr').textContent=a.href;
},true);

/* ---------- Puente: estado, contacto, GPS, copia de ajustes ---------- */
const api=(p,body)=>fetch(p,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'}).then(r=>r.json());
async function sysInit(){
  if(!location.protocol.startsWith('http')) return;
  try{ await api('/api/estado'); SYS.bridge=true; }catch(e){ return; }
  if(await syncRestore()) return;
  setInterval(()=>syncPush(),15000); setTimeout(()=>syncPush(),4000);
  pollContacto(); pollGPS();
}
function snapshot(){ const o={}; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.startsWith('rp-')&&k!=='rp-sync-ts') o[k]=localStorage.getItem(k); } return o; }
async function syncPush(force){
  if(!SYS.bridge) return; const data=snapshot(), s=JSON.stringify(data); if(!force&&s===SYS.lastSync) return;
  const ts=Date.now(); try{ const r=await api('/api/ajustes',{ts,data}); if(r.ok){ SYS.lastSync=s; SYS.syncTs=ts; LS.set('rp-sync-ts',ts); } }catch(e){}
}
async function syncRestore(){
  try{ const j=await api('/api/ajustes'); if(!j||!j.data||!j.ts) return false;
    const local=+(LS.get('rp-sync-ts')||0);
    if((j.ts>local||!LS.get('rp-clave'))&&!sessionStorage.getItem('rp-restored')&&j.data['rp-clave']){
      sessionStorage.setItem('rp-restored','1'); Object.entries(j.data).forEach(([k,v])=>LS.set(k,v)); LS.set('rp-sync-ts',j.ts); location.reload(); return true; }
  }catch(e){} return false;
}
async function pollContacto(){
  let c=null; try{ c=await api('/api/contacto'); }catch(e){}
  if(c&&c.activo){ showPower(c); setTimeout(pollContacto,1000); }
}
function showPower(c){
  let p=$('pwr');
  if(c.apagado_en==null){ if(p) p.remove(); return; }
  if(!p){ p=document.createElement('div'); p.id='pwr'; document.body.appendChild(p); syncPush(true); sayQ('Contacto quitado. El sistema se apagará en '+c.apagado_en+' segundos.');
    p.innerHTML=`<div class="pbox"><span class="pico">⏻</span><h2>Contacto quitado</h2><p>Apagando en <b id="pwrS" class="num">${c.apagado_en}</b> s</p><div class="pbtn"><button class="pill" data-sys="posponer">Seguir encendido 5 min</button><button class="pill stop" data-sys="apagar">Apagar ya</button></div></div>`; }
  $('pwrS').textContent=c.apagado_en; if(c.apagado_en<=3) syncPush(true);
}
async function pollGPS(){
  try{ const g=await api('/api/gps'); Object.assign(GPS,{estado:g.estado,sats:g.sats});
    const fresh=g.ok&&Date.now()/1000-g.ts<5; GPS.ok=fresh;
    if(fresh){ GPS.lat=g.lat; GPS.lng=g.lng; GPS.speed=g.speed||0; GPS.track=g.track;
      if(!S.sim&&map){ if(!E.real){ E.v=GPS.speed; E.target=GPS.speed; }
        if(!GPS.fixToast){ GPS.fixToast=true; toast('GPS: posición encontrada'); S.follow=true; }
        onGPS({lat:g.lat,lng:g.lng},GPS.speed>3&&g.track!=null?g.track:null); } }
  }catch(e){}
  setTimeout(pollGPS,GPS.ok?1000:5000);
}

/* ---------- Continuar la ruta tras un reinicio o un corte ---------- */
const _startNav=startNav; startNav=function(...a){ _startNav(...a); if(NAV.active&&NAV.dest) LS.set('rp-ultima',JSON.stringify({dest:NAV.dest,stops:NAV.stops,t:Date.now()})); };
const _clearRoute=clearRoute; clearRoute=function(...a){ LS.set('rp-ultima',''); return _clearRoute(...a); };
const _navInit=navInit; navInit=function(...a){ _navInit(...a); setTimeout(offerResume,KIOSK?4500:1500); };
function offerResume(){
  let l=null; try{ l=JSON.parse(LS.get('rp-ultima')||'null'); }catch(e){}
  if(!l||!l.dest||Date.now()-l.t>3*3600e3||NAV.active) return;
  showBanner(`¿Continuar hacia ${l.dest.name}?`,[['Continuar',()=>{ NAV.stops=l.stops||[]; previewTo(l.dest,{auto:true,keepStops:true}); }],['No',()=>LS.set('rp-ultima','')]],25000);
  sayQ('¿Quieres continuar hacia '+l.dest.name+'?');
}

/* ---------- App Sistema ---------- */
const hms=s=>s==null?'—':(s>=86400?Math.floor(s/86400)+' d ':'')+Math.floor(s%86400/3600)+' h '+two(Math.floor(s%3600/60))+' min';
function tilesHTML(i){
  if(!i) return '<p class="muted">Leyendo el estado…</p>';
  const t=(k,v,s,cls='')=>`<div class="stile ${cls}"><small>${k}</small><b class="num">${v}</b><span>${s}</span></div>`;
  const c=i.contacto||{}, g=i.gps||{};
  return t('Temperatura',i.temp!=null?i.temp.toFixed(0)+' °C':'—',i.temp>80?'Muy caliente: ventila la Raspberry':i.temp>70?'Caliente':'Normal',i.temp>80?'bad':i.temp>70?'mid':'')
    +t('Alimentación',i.bajo_voltaje?'Baja':'Correcta',i.bajo_voltaje?'Revisa el convertidor de 5 V':i.bajo_voltaje_antes?'Hubo caídas de tensión':'Sin cortes',i.bajo_voltaje?'bad':i.bajo_voltaje_antes?'mid':'')
    +t('Memoria',i.memoria!=null?i.memoria+' %':'—','en uso')
    +t('Almacenamiento',i.disco_libre_gb!=null?i.disco_libre_gb.toString().replace('.',',')+' GB':'—','libres')
    +t('Encendido',hms(i.encendido_s),i.protegido?'Modo protegido activo':'desde el arranque')
    +t('Red',i.wifi?esc(i.wifi.ssid):'Sin WiFi',i.ip?'IP '+i.ip:'Sin conexión',i.wifi?'':'mid')
    +t('GPS',g.ok?'Con señal':'—',esc(g.estado||'Sin GPS')+(g.sats!=null?' · '+g.sats+' satélites':''),g.ok?'':'mid')
    +t('Llave',!c.activo?'Sin cable':c.on?'Contacto':'Quitada',esc(c.msg||''),c.activo&&!c.on?'mid':'');
}
VIEWS.sistema=()=>{
  if(!SYS.bridge) return `${appbar('Sistema')}<div class="abody"><div class="empty"><h2 style="font-family:var(--f-d);font-size:30px;margin:0">Sin puente</h2><p>Abre Radar Play con «Iniciar Radar Play.bat» (o en la Raspberry, que arranca sola) para ver y controlar el sistema.</p></div></div>`;
  const i=SYS.info||{}, pi=i.plataforma==='raspberry', dis=pi?'':'disabled';
  return `${appbar('Sistema',`<span class="pill">${pi?esc(i.modelo||'Raspberry Pi'):'Ordenador'}</span>`)}<div class="abody">
    ${pi?'':'<p class="note">Estás en el ordenador: aquí solo se ve el estado. El volumen, el WiFi, las actualizaciones y el apagado funcionan en la Raspberry.</p>'}
    <div class="stiles" id="sysTiles">${tilesHTML(SYS.info)}</div>
    <h3 class="sh">Pantalla y sonido</h3>
    <div class="set"><div><b>Volumen del sistema</b><div class="muted">Salida de audio de la Raspberry</div></div><span class="srange"><input type="range" id="sVol" min="0" max="100" value="${i.volumen??60}" ${dis}><b id="sVolT" class="num">${i.volumen??'—'}</b></span></div>
    <div class="set"><div><b>Brillo</b><div class="muted">${i.brillo==null?'Esta pantalla lo regula con sus propios botones':'Pantalla oficial'}</div></div><span class="srange"><input type="range" id="sBri" min="5" max="100" value="${i.brillo??80}" ${i.brillo==null?'disabled':''}><b id="sBriT" class="num">${i.brillo??'—'}</b></span></div>
    <h3 class="sh">WiFi</h3>
    <div class="set"><div><b>${i.wifi?'Conectado a '+esc(i.wifi.ssid):'Sin conexión'}</b><div class="muted">Para Google Maps y YouTube. En el coche, comparte internet desde el iPhone (Punto de acceso personal).</div></div><button class="pill on" data-sys="wifi" ${dis}>Buscar redes</button></div>
    <div id="wifiList" class="list"></div>
    <h3 class="sh">Radar Play</h3>
    ${togRow('tOsk',oskOn(),'Teclado en pantalla','Aparece al tocar un campo de texto')}
    ${togRow('tBoot',LS.get('rp-boot')!=='0','Animación de arranque','La pantalla de inicio con las comprobaciones')}
    ${txtRow('iCoche',LS.get('rp-coche')||'Alfa Romeo Giulietta','Nombre del coche','Sale al arrancar')}
    <div class="set"><div><b>Copia de los ajustes</b><div class="muted">Se guarda sola en la Raspberry (claves, contactos, destinos). Última: ${SYS.syncTs?new Date(SYS.syncTs).toLocaleString('es-ES'):'nunca'}</div></div><button class="pill" data-sys="copia">Guardar ahora</button></div>
    <div class="set"><div><b>Actualizar Radar Play</b><div class="muted">${i.actualizacion?'Encontrado en el USB: Radar-Play.zip ('+esc(i.actualizacion.fecha)+')':'Mete un pendrive con Radar-Play.zip'}</div></div><button class="pill ${i.actualizacion?'on':''}" data-sys="actualizar" ${i.actualizacion&&pi?'':'disabled'}>Instalar</button></div>
    ${togRow('tProt',!!i.protegido,'Modo protegido','Protege la tarjeta de los cortes de corriente. Mientras está activo, los cambios se borran al apagar. Necesita reiniciar.')}
    <h3 class="sh">Energía</h3>
    <div class="set"><div><b>Salir al escritorio</b><div class="muted">Para mantenimiento. Al reiniciar vuelve a Radar Play.</div></div><button class="pill" data-sys="escritorio" ${dis}>Salir</button></div>
    <div class="set"><div><b>Reiniciar</b></div><button class="pill" data-sys="reiniciar" ${dis}>Reiniciar</button></div>
    <div class="set"><div><b>Apagar</b><div class="muted">Con el cable de la llave montado se apaga solo al quitar el contacto.</div></div><button class="pill stop" data-sys="apagar" ${dis}>Apagar</button></div>
    <p class="muted" style="font-size:12px">Radar Play ${esc(i.version||'')} · ${KIOSK?'modo coche':'modo ordenador'}</p>
  </div>`;
};
async function sysRefresh(full){
  if(S.view!=='sistema'||!SYS.bridge) return;
  try{ SYS.info=await api('/api/sistema'); }catch(e){}
  if(full) renderApp(); else { const t=$('sysTiles'); if(t) t.innerHTML=tilesHTML(SYS.info); }
}
function bindSistema(){
  const deb={}, send=(a,v,t)=>{ clearTimeout(deb[a]); $(t).textContent=v; deb[a]=setTimeout(async()=>{ const r=await api('/api/sistema',{accion:a,valor:+v}).catch(()=>({})); if(r&&r.error) toast(r.error); },250); };
  const vo=$('sVol'); if(vo) vo.oninput=()=>send('volumen',vo.value,'sVolT');
  const br=$('sBri'); if(br) br.oninput=()=>send('brillo',br.value,'sBriT');
  const tg=(id,fn)=>{ const b=$(id); if(b) b.onclick=fn; };
  tg('tOsk',()=>{ LS.set('rp-osk',oskOn()?'0':'1'); renderApp(); });
  tg('tBoot',()=>{ LS.set('rp-boot',LS.get('rp-boot')==='0'?'1':'0'); renderApp(); });
  tg('tProt',()=>confirmBox(SYS.info&&SYS.info.protegido?'¿Quitar el modo protegido?':'¿Activar el modo protegido?','Se reiniciará la Raspberry. '+(SYS.info&&SYS.info.protegido?'Después podrás cambiar ajustes y se guardarán.':'Primero se guarda una copia de tus ajustes.'),'Sí, reiniciar',async()=>{ await syncPush(true); const r=await api('/api/sistema',{accion:'protegido',on:!(SYS.info&&SYS.info.protegido)}); if(r.ok) api('/api/sistema',{accion:'reiniciar'}); else toast(r.error||'No se pudo'); }));
  document.querySelectorAll('[data-save="iCoche"]').forEach(b=>b.onclick=()=>{ LS.set('rp-coche',$('iCoche').value.trim()); toast('Guardado'); });
}
function confirmBox(title,text,ok,fn){
  overlay(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="pill" id="cOv">Cancelar</button><button class="pill on" id="cOk">${esc(ok)}</button></div>`);
  $('cOv').onclick=closeOv; $('cOk').onclick=()=>{ closeOv(); fn(); };
}
async function wifiScan(){
  const L=$('wifiList'); if(!L) return; L.innerHTML='<p class="muted">Buscando redes…</p>';
  const r=await api('/api/sistema',{accion:'wifi_lista'}).catch(()=>({ok:false,error:'Sin respuesta'}));
  if(!$('wifiList')) return;
  if(!r.ok){ L.innerHTML=`<p class="note">${esc(r.error||'No se pudo buscar')}</p>`; return; }
  SYS.redes=r.redes; L.innerHTML=r.redes.map((n,i)=>`<button class="row" data-sys="red" data-i="${i}"><span class="av">${n.senal>66?'▂▄▆':n.senal>33?'▂▄':'▂'}</span><span class="t"><b>${esc(n.ssid)}${n.actual?' · conectado':''}</b><small>${n.segura?'Con contraseña':'Abierta'} · ${n.senal} %</small></span></button>`).join('')||'<p class="muted">No hay redes a la vista.</p>';
}
function wifiJoin(n){
  const go=async clave=>{ toast('Conectando a '+n.ssid+'…'); const r=await api('/api/sistema',{accion:'wifi_conectar',ssid:n.ssid,clave}).catch(()=>({ok:false,error:'Sin respuesta'})); toast(r.ok?'Conectado a '+n.ssid:(r.error||'No se pudo conectar')); sysRefresh(true); };
  if(!n.segura) return go('');
  overlay(`<h2>${esc(n.ssid)}</h2><p>Contraseña de la red</p><div class="field"><input id="wPass" type="text" autocomplete="off"><button class="pill on" id="wOk">Conectar</button></div><div style="text-align:right;margin-top:14px"><button class="pill" id="cOv">Cancelar</button></div>`);
  $('cOv').onclick=closeOv; const ok=()=>{ const v=$('wPass').value; closeOv(); go(v); }; $('wOk').onclick=ok; $('wPass').onkeydown=e=>{ if(e.key==='Enter') ok(); }; $('wPass').focus();
}
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-sys]'); if(!el||el.disabled) return; e.stopPropagation(); const a=el.dataset.sys;
  if(a==='posponer'){ api('/api/sistema',{accion:'posponer',segundos:300}); const p=$('pwr'); if(p) p.remove(); toast('Seguirá encendido 5 minutos'); return; }
  if(a==='apagar') return confirmBox('¿Apagar el sistema?','Espera a que la pantalla se quede negra antes de cortar la corriente.','Apagar',async()=>{ await syncPush(true); const r=await api('/api/sistema',{accion:'apagar'}); if(!r.ok) toast(r.error); else document.body.insertAdjacentHTML('beforeend','<div id="bye">Apagando…</div>'); });
  if(a==='reiniciar') return confirmBox('¿Reiniciar el sistema?','Tarda menos de un minuto.','Reiniciar',async()=>{ await syncPush(true); const r=await api('/api/sistema',{accion:'reiniciar'}); if(!r.ok) toast(r.error); else document.body.insertAdjacentHTML('beforeend','<div id="bye">Reiniciando…</div>'); });
  if(a==='escritorio') return confirmBox('¿Salir al escritorio?','Radar Play se cerrará hasta el próximo arranque.','Salir',async()=>{ await syncPush(true); const r=await api('/api/sistema',{accion:'escritorio'}); if(!r.ok) toast(r.error); });
  if(a==='actualizar') return confirmBox('¿Instalar la actualización?','Se guarda una copia de la versión actual en «radar-play-copia» y se recarga Radar Play.','Instalar',async()=>{ await syncPush(true); const r=await api('/api/sistema',{accion:'actualizar'}); if(!r.ok){ toast(r.error); return; } document.body.insertAdjacentHTML('beforeend','<div id="bye">Actualizando…</div>'); setTimeout(()=>location.reload(),6000); });
  if(a==='copia'){ syncPush(true).then(()=>{ toast('Copia guardada'); renderApp(); }); return; }
  if(a==='wifi') return wifiScan();
  if(a==='red') return wifiJoin(SYS.redes[+el.dataset.i]);
});
const _renderApp2=renderApp; renderApp=function(){ _renderApp2(); if(S.view==='sistema'){ bindSistema(); clearInterval(SYS.timer); SYS.timer=setInterval(()=>sysRefresh(false),4000); if(!SYS.info) sysRefresh(true); } else clearInterval(SYS.timer); };

bootScreen(); sysInit();
