/* =====================================================================
   Radar Play · Funciones tipo CarPlay
   iPhone simulado (contactos, llamadas, mensajes, notificaciones),
   Siri por voz, calendario, compartir llegada, ajustes y mando desde
   el iPhone real a través del puente (misma WiFi).
   ===================================================================== */
const ld=(k,def)=>{ try{ const v=JSON.parse(LS.get(k)||'null'); return v==null?def:v; }catch(e){ return def; } };
const nrm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[¿?¡!.,;:"]/g,' ').replace(/\s+/g,' ').trim();
const hm=t=>fmtHM(new Date(t));

/* ---------- Iconos y apps nuevas ---------- */
ICONS.calendario=Sv('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>');
ICONS.siri=Sv('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>');
APPS.splice(APPS.findIndex(a=>a.id==='destinos'),0,{id:'calendario',name:'Calendario',bg:'linear-gradient(160deg,#ff6b5e,#d63a2e)'});

/* ---------- iPhone simulado ---------- */
const PH={
  contacts:ld('rp-contactos',[{n:'Mamá',t:'600 111 222',fav:1},{n:'Alejandra',t:'600 333 444',fav:1},{n:'Taller Ruiz',t:'916 000 111'},{n:'Cochera',t:'916 000 222'},{n:'Trabajo',t:'916 000 333'}]),
  calls:ld('rp-llamadas',[{n:'Taller Ruiz',dir:'in',t:Date.now()-3*3600e3,dur:95},{n:'Mamá',dir:'out',t:Date.now()-26*3600e3,dur:310},{n:'Alejandra',dir:'miss',t:Date.now()-28*3600e3,dur:0}]),
  threads:ld('rp-msgs',{'Alejandra':{unread:1,m:[{me:0,x:'¿A qué hora llegas?',t:Date.now()-50*60e3}]},'Taller Ruiz':{unread:0,m:[{me:0,x:'Ya tienes el coche listo',t:Date.now()-5*3600e3}]}}),
  dnd:LS.get('rp-dnd')==='1', events:LS.get('rp-eventos')!=='0', tab:'fav', open:null, dial:'', call:null, ring:null, resume:false, lastAuto:{},
  save(){ LS.set('rp-contactos',JSON.stringify(this.contacts)); LS.set('rp-llamadas',JSON.stringify(this.calls.slice(0,40))); LS.set('rp-msgs',JSON.stringify(this.threads)); },
  find(q){ const n=nrm(q).replace(/^(a|al|la|el)\s+/,''); if(!n) return null; return this.contacts.find(c=>nrm(c.n)===n)||this.contacts.find(c=>nrm(c.n).startsWith(n)||n.startsWith(nrm(c.n)))||this.contacts.find(c=>nrm(c.n).includes(n)); },
  unread(){ return Object.values(this.threads).reduce((s,t)=>s+(t.unread||0),0); },
  missed(){ return this.calls.filter(c=>c.dir==='miss'&&!c.seen).length; },
};
const thread=n=>PH.threads[n]||(PH.threads[n]={unread:0,m:[]});
function phSend(name,text){ const t=thread(name); t.m.push({me:1,x:text,t:Date.now()}); t.unread=0; setTimeout(decorate,0); PH.save(); refreshPhone(); }
function phIncomingMsg(name,text){
  const t=thread(name); t.m.push({me:0,x:text,t:Date.now()}); t.unread=(t.unread||0)+1; PH.save(); refreshPhone(); decorate();
  if(PH.dnd){ if(!PH.lastAuto[name]||Date.now()-PH.lastAuto[name]>30*60e3){ PH.lastAuto[name]=Date.now(); setTimeout(()=>phSend(name,'Estoy conduciendo con «No molestar» activado. Veré tu mensaje cuando llegue.'),1500); } return; }
  notify({title:name,sub:'Mensaje',body:'Toca «Leer» y Siri te lo lee',acts:[['Leer',()=>readThread(name)],['Responder',()=>replyTo(name)]]});
  beep(1320,.08,2);
}
function readThread(name){ const t=thread(name), un=t.m.filter(m=>!m.me).slice(-(t.unread||1)); t.unread=0; PH.save(); refreshPhone(); decorate();
  sayQ(`${name} dice: ${un.map(m=>m.x).join('. ')}`); }
function replyTo(name){ SR.open('dictate',text=>{ phSend(name,text); SR.reply(`Enviado a ${name}.`); },`Dicta tu respuesta a ${name}`); }

/* ---------- Llamadas ---------- */
function ringStart(kind){ ringStop(); try{ actx=actx||new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return; }
  const play=()=>{ if(kind==='in'){ beep(880,.18,1); setTimeout(()=>beep(660,.18,1),220); } else beep(425,.9,1); };
  play(); PH.ring=setInterval(play,kind==='in'?2200:3500); }
function ringStop(){ clearInterval(PH.ring); PH.ring=null; }
function pauseForCall(){ PH.resume=MU.playing(); if(PH.resume) MU.toggle(); }
function resumeAfterCall(){ if(PH.resume&&!MU.playing()) MU.toggle(); PH.resume=false; }
function phDial(name,num){
  if(PH.call) return; const c=PH.find(name); name=c?c.n:(name||num);
  PH.call={n:name,dir:'out',state:'dialing',t0:0,muted:false}; pauseForCall(); ringStart('out'); renderCall();
  const answers=Math.random()<.8;
  PH.callTimer=setTimeout(()=>{ if(!PH.call||PH.call.state!=='dialing') return; ringStop();
    if(answers){ PH.call.state='active'; PH.call.t0=Date.now(); renderCall(); }
    else { toast(name+' no contesta'); endCall(true); } },answers?4000+Math.random()*3000:11000);
}
function phIncoming(name){
  if(PH.call) return; const c=PH.find(name); name=c?c.n:name;
  if(PH.dnd&&!(c&&c.fav)){ PH.calls.unshift({n:name,dir:'miss',t:Date.now(),dur:0}); PH.save(); decorate(); return; }
  PH.call={n:name,dir:'in',state:'ringing',t0:0,muted:false}; pauseForCall(); ringStart('in'); renderCall(); sayQ('Llamada de '+name);
  PH.callTimer=setTimeout(()=>{ if(PH.call&&PH.call.state==='ringing'){ PH.calls.unshift({n:name,dir:'miss',t:Date.now(),dur:0}); PH.save(); ringStop(); PH.call=null; renderCall(); resumeAfterCall(); decorate(); toast('Llamada perdida de '+name); } },20000);
}
function acceptCall(){ if(!PH.call) return; ringStop(); clearTimeout(PH.callTimer); PH.call.state='active'; PH.call.t0=Date.now(); renderCall(); }
function endCall(noAnswer){
  const c=PH.call; if(!c) return; ringStop(); clearTimeout(PH.callTimer);
  const dur=c.t0?Math.round((Date.now()-c.t0)/1000):0;
  PH.calls.unshift({n:c.n,dir:c.dir==='in'?(c.state==='ringing'?'miss':'in'):'out',t:Date.now(),dur,seen:1}); PH.save();
  PH.call=null; renderCall(); resumeAfterCall(); refreshPhone(); decorate();
}
function renderCall(){
  const u=$('callui'), c=PH.call; if(!c){ u.hidden=true; return; }
  const st=c.state==='ringing'?'Llamada entrante · iPhone':c.state==='dialing'?'Llamando…':`<span id="cTime" class="num">${fmtT((Date.now()-c.t0)/1000)}</span>${c.muted?' · silenciado':''}`;
  u.innerHTML=`<span class="cav">${esc(c.n[0])}</span><div class="cinfo"><b>${esc(c.n)}</b><span>${st}</span></div><div class="cbtns">${c.state==='ringing'
    ?'<button class="cb red" data-ph="decline" aria-label="Rechazar">'+phoneSvg(true)+'</button><button class="cb green" data-ph="accept" aria-label="Aceptar">'+phoneSvg()+'</button>'
    :`<button class="cb ${c.muted?'on':''}" data-ph="mute" aria-label="Silenciar">${micSvg}</button><button class="cb red" data-ph="hang" aria-label="Colgar">${phoneSvg(true)}</button>`}</div>`;
  u.hidden=false;
}
const phoneSvg=down=>`<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" ${down?'style="transform:rotate(135deg)"':''}><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>`;
setInterval(()=>{ const e=$('cTime'); if(e&&PH.call&&PH.call.t0) e.textContent=fmtT((Date.now()-PH.call.t0)/1000); },1000);

/* ---------- Notificaciones ---------- */
let notifTimer=0, notifActs=[];
function notify({title,sub,body,acts=[]}){
  notifActs=acts; const n=$('notif');
  n.innerHTML=`<span class="nav2">${esc(title[0])}</span><div class="nt"><small>${esc(sub)}</small><b>${esc(title)}</b><span>${esc(body)}</span></div><div class="nb">${acts.map((a,i)=>`<button class="pill ${i===0?'on':''}" data-ph="nact" data-i="${i}">${esc(a[0])}</button>`).join('')}<button class="pill" data-ph="nclose" aria-label="Cerrar">✕</button></div>`;
  n.hidden=false; clearTimeout(notifTimer); notifTimer=setTimeout(()=>n.hidden=true,9000);
}
/* Mensajes y llamadas que llegan mientras "conduces" en la simulación */
const DEMO_MSG={'Alejandra':['¿Te falta mucho?','Compra pan cuando vengas','¿Cenamos fuera hoy?','Avísame cuando llegues'],'Mamá':['Llámame cuando puedas','¿Vienes el domingo a comer?'],'Taller Ruiz':['El presupuesto del embrague está listo','Puede pasar a recoger el coche mañana'],'Trabajo':['Mañana sales a las 7:15 desde la cochera','¿Puedes cubrir un servicio el sábado?']};
setInterval(()=>{
  if(!PH.events||!S.sim||!NAV.active||PH.call||Math.random()>.12) return;
  const names=Object.keys(DEMO_MSG), n=names[Math.floor(Math.random()*names.length)];
  if(Math.random()<.78){ const l=DEMO_MSG[n]; phIncomingMsg(n,l[Math.floor(Math.random()*l.length)]); } else phIncoming(n);
},20000);

/* ---------- Compartir hora de llegada ---------- */
function shareScreen(){
  if(!NAV.active) return; const hh=fmtHM(new Date(Date.now()+remainingSecs()*1000)), txt=`Voy de camino a ${NAV.dest.name}. Llego sobre las ${hh} (${fmtMin(remainingSecs())}).`;
  overlay(`<h2>Compartir llegada</h2><p>${esc(txt)}</p><div class="list">${PH.contacts.map((c,i)=>`<button class="row" data-ph="share" data-i="${i}"><span class="av">${esc(c.n[0])}</span><span class="t"><b>${esc(c.n)}</b><small>Enviar por Mensajes (iPhone simulado)</small></span></button>`).join('')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px"><a class="pill" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(txt)}">Enviar por WhatsApp</a><button class="pill" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv; shareScreen.txt=txt;
}
function shareTo(c){ phSend(c.n,shareScreen.txt||''); closeOv(); toast('Hora de llegada enviada a '+c.n); sayQ('Hora de llegada enviada a '+c.n+'.'); }

/* ---------- Calendario ---------- */
const CAL=ld('rp-calendario',[{h:'17:30',title:'Recoger el coche',place:'Taller mecánico, Valdemoro'},{h:'19:00',title:'Gimnasio',place:'Gimnasio, Valdemoro'},{h:'21:00',title:'Cena',place:'Plaza de la Constitución, Valdemoro'}]);
function nextEvent(){ const now=new Date(), m=now.getHours()*60+now.getMinutes(); const e=CAL.map(x=>({...x,mm:+x.h.split(':')[0]*60+ +x.h.split(':')[1]})).filter(x=>x.mm>=m).sort((a,b)=>a.mm-b.mm)[0]; return e?{title:e.title,time:e.h,place:e.place}:null; }

/* ---------- Vistas de apps ---------- */
const tabBtn=(k,l)=>`<button class="${PH.tab===k?'on':''}" data-ph="tab" data-k="${k}">${l}</button>`;
const iphoneTag='<span class="pill" title="Simulado hasta tener el adaptador CarPlay">iPhone simulado</span>';
VIEWS.telefono=()=>{
  const row=(c,extra='')=>`<button class="row" data-ph="call" data-n="${esc(c.n)}"><span class="av">${esc(c.n[0])}</span><span class="t"><b>${esc(c.n)}</b><small>${esc(c.t||'')}${extra}</small></span><span class="pill on">Llamar</span></button>`;
  let body='';
  if(PH.tab==='fav') body=PH.contacts.filter(c=>c.fav).map(c=>row(c)).join('')||'<p class="muted">Marca favoritos en Ajustes con un * delante del nombre.</p>';
  if(PH.tab==='rec'){ PH.calls.forEach(c=>c.seen=1); PH.save(); setTimeout(decorate,0);
    body=PH.calls.map(c=>`<button class="row ${c.dir==='miss'?'missed':''}" data-ph="call" data-n="${esc(c.n)}"><span class="av">${esc(c.n[0])}</span><span class="t"><b>${esc(c.n)}</b><small>${{in:'Entrante',out:'Saliente',miss:'Perdida'}[c.dir]}${c.dur?' · '+fmtT(c.dur):''}</small></span><span class="muted">${new Date(c.t).toDateString()===new Date().toDateString()?hm(c.t):new Date(c.t).toLocaleDateString('es-ES',{weekday:'short'})}</span></button>`).join(''); }
  if(PH.tab==='con') body=PH.contacts.map(c=>row(c)).join('');
  if(PH.tab==='kp') body=`<div class="kpad"><div class="kdisp num" id="kDisp">${esc(PH.dial)||'&nbsp;'}</div><div class="kgrid">${['1','2','3','4','5','6','7','8','9','*','0','#'].map(k=>`<button class="key num" data-ph="key" data-k="${k}">${k}</button>`).join('')}<span></span><button class="key green" data-ph="kcall" aria-label="Llamar">${phoneSvg()}</button><button class="key" data-ph="kdel" aria-label="Borrar">⌫</button></div></div>`;
  return `${appbar('Teléfono',iphoneTag)}<div class="abody"><div class="tabs">${tabBtn('fav','Favoritos')}${tabBtn('rec','Recientes')}${tabBtn('con','Contactos')}${tabBtn('kp','Teclado')}</div><div class="list">${body}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"><button class="pill" data-ph="demo-call">Simular llamada entrante</button></div></div>`;
};
VIEWS.mensajes=()=>{
  if(PH.open){ const t=thread(PH.open); if(t.unread){ t.unread=0; PH.save(); setTimeout(decorate,0); }
    const eta=NAV.active?`Llego en ${fmtMin(remainingSecs())}`:'Llego en un rato';
    return `${appbar(esc(PH.open),`<button class="pill" data-ph="back">Volver</button>`)}<div class="abody msgv"><div class="bubbles" id="bubs">${t.m.map(m=>`<div class="bub ${m.me?'me':''}">${esc(m.x)}<small>${hm(m.t)}</small></div>`).join('')}</div>
      <div class="qr"><button class="pill on" data-ph="read" data-n="${esc(PH.open)}">Leer</button><button class="pill on" data-ph="dict" data-n="${esc(PH.open)}">${micSvg} Responder</button>${['Voy conduciendo',eta,'Te llamo luego','Vale'].map(q=>`<button class="pill" data-ph="quick" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`; }
  const names=Object.keys(PH.threads).sort((a,b)=>{ const la=PH.threads[a].m.slice(-1)[0], lb=PH.threads[b].m.slice(-1)[0]; return (lb?lb.t:0)-(la?la.t:0); });
  return `${appbar('Mensajes',iphoneTag)}<div class="abody"><div class="list">${names.map(n=>{ const t=PH.threads[n], l=t.m.slice(-1)[0];
      return `<button class="row" data-ph="open" data-n="${esc(n)}"><span class="av">${esc(n[0])}</span><span class="t"><b>${t.unread?'<i class="dot"></i>':''}${esc(n)}</b><small>${l?esc((l.me?'Tú: ':'')+l.x):''}</small></span><span class="muted">${l?hm(l.t):''}</span></button>`; }).join('')}</div>
    <p class="note" style="margin-top:14px">Mientras conduces, CarPlay no muestra el texto: Siri lo lee y tú respondes dictando. Prueba: «Lee mis mensajes» o «Dile a Alejandra que llego en diez minutos».</p>
    <div style="margin-top:12px"><button class="pill" data-ph="demo-msg">Simular mensaje nuevo</button></div></div>`;
};
VIEWS.calendario=()=>`${appbar('Calendario','<span class="pill">Hoy</span>')}<div class="abody"><div class="list">${CAL.map(e=>`<div class="row"><span class="num" style="width:64px;font-weight:800;font-size:18px">${e.h}</span><span class="t"><b>${esc(e.title)}</b><small>${esc(e.place)}</small></span><button class="pill on" data-nav="go-q" data-q="${esc(e.place)}" data-n="${esc(e.title)}">Ir</button></div>`).join('')}</div>
  <p class="note" style="margin-top:14px">Como en CarPlay, cada cita con dirección se puede abrir en Mapas. Con el iPhone real conectado saldrían tus citas.</p></div>`;
function refreshPhone(){ if(['telefono','mensajes'].includes(S.view)){ renderApp(); const b=$('bubs'); if(b) b.scrollTop=b.scrollHeight; } }

/* ---------- Ajustes ---------- */
const togRow=(id,on,title,sub)=>`<div class="set"><div><b>${title}</b><div class="muted">${sub}</div></div><button class="tog ${on?'on':''}" id="${id}" aria-pressed="${!!on}" aria-label="${title}"></button></div>`;
const txtRow=(id,val,title,sub,ph='')=>`<div class="set"><div><b>${title}</b><div class="muted">${sub}</div></div><span style="display:flex;gap:8px"><input type="text" id="${id}" value="${esc(val)}" placeholder="${esc(ph)}"><button class="pill on" data-save="${id}">Guardar</button></span></div>`;
VIEWS.ajustes=()=>`${appbar('Ajustes')}<div class="abody">
  <h3 class="sh">Navegación</h3>
  ${txtRow('iHome',NAV.setts.home,'Casa','Para «Llévame a casa»','Calle, número, pueblo')}
  ${txtRow('iWork',NAV.setts.work,'Trabajo','Para «Llévame al trabajo»','Dirección de la cochera')}
  ${txtRow('iStart',S.start,'Punto de salida','Donde aparece el coche al abrir')}
  ${togRow('tAlerts',NAV.setts.alerts,'Radares e incidencias','Radares fijos, de tramo y avisos de otros conductores (simulados) además de las retenciones reales de Google')}
  ${togRow('tSpeed',NAV.setts.speedWarn,'Aviso de exceso de velocidad','Pita y marca en rojo si superas el límite estimado')}
  ${togRow('tVoice',S.voice,'Indicaciones por voz','Baja la música mientras habla')}
  ${togRow('tHw',NAV.setts.highways,'Evitar autopistas','')}${togRow('tToll',NAV.setts.tolls,'Evitar peajes','')}
  <div class="set"><div><b>Tus avisos guardados</b><div class="muted">${NAV.setts.reports.length} aviso${NAV.setts.reports.length===1?'':'s'} notificado${NAV.setts.reports.length===1?'':'s'} desde este coche</div></div><button class="pill" id="bClrRep">Borrar</button></div>
  <h3 class="sh">iPhone</h3>
  ${togRow('tDnd',PH.dnd,'No molestar al conducir','Silencia los mensajes, responde automáticamente y solo deja pasar llamadas de favoritos')}
  ${togRow('tEvt',PH.events,'Simular llamadas y mensajes en el viaje','Llegan de vez en cuando mientras simulas un viaje')}
  <div class="set" style="align-items:flex-start"><div><b>Contactos</b><div class="muted">Uno por línea: Nombre; teléfono. Pon * delante para favorito.</div></div><span style="display:flex;flex-direction:column;gap:8px;align-items:flex-end"><textarea id="iCon" rows="5">${esc(PH.contacts.map(c=>(c.fav?'*':'')+c.n+'; '+(c.t||'')).join('\n'))}</textarea><button class="pill on" id="bCon">Guardar</button></span></div>
  <div class="set" style="align-items:flex-start"><div><b>Mando desde tu iPhone</b><div class="muted" id="mandoInfo">${mandoText()}</div></div><div id="qr" class="qrbox"></div></div>
  <h3 class="sh">Sistema</h3>
  <div class="set"><div><b>Modo DNA</b><div class="muted">D cambia toda la pantalla a modo deportivo</div></div>${dnaSel()}</div>
  <div class="set"><div><b>Estilo de mapa</b><div class="muted">${THEMES[S.theme].name} · ${THEMES[S.theme].sub}</div></div><button class="pill" data-act="style">Cambiar</button></div>
  ${togRow('tTraf',NAV.setts.traffic,'Tráfico en todo el mapa','Colorea todas las calles según el tráfico (la ruta siempre lo muestra)')}
  ${txtRow('iYt',Y.key,'Clave de YouTube','Para buscar canciones escribiendo o por voz','AIza…')}
  <div class="set"><div><b>Clave de Google Maps</b><div class="muted">${S.key?'Guardada en este navegador':'Sin clave'} · Places API (New) opcional para buscar sitios cercanos</div></div><button class="pill" data-act="key">Cambiar</button></div>
  <div class="set"><div><b>Carpeta de música</b><div class="muted">${M.dirName?esc(M.dirName):'Ninguna'} · ${M.tracks.length} canciones</div></div><button class="pill" data-m="pick">Elegir</button></div>
</div>`;
function bindSettings(){
  const tg=(id,fn)=>{ const b=$(id); if(b) b.onclick=()=>{ fn(); renderApp(); }; };
  tg('tAlerts',()=>{ NAV.setts.alerts=!NAV.setts.alerts; saveNav(); });
  tg('tSpeed',()=>{ NAV.setts.speedWarn=!NAV.setts.speedWarn; saveNav(); });
  tg('tVoice',()=>{ S.voice=!S.voice; LS.set('rp-voz',S.voice?'1':'0'); updVoiceBtn(); });
  tg('tHw',()=>{ NAV.setts.highways=!NAV.setts.highways; saveNav(); });
  tg('tToll',()=>{ NAV.setts.tolls=!NAV.setts.tolls; saveNav(); });
  tg('tDnd',()=>{ PH.dnd=!PH.dnd; LS.set('rp-dnd',PH.dnd?'1':'0'); });
  tg('tEvt',()=>{ PH.events=!PH.events; LS.set('rp-eventos',PH.events?'1':'0'); });
  tg('tTraf',()=>toggleTraffic());
  $('bClrRep').onclick=()=>{ NAV.setts.reports=[]; saveNav(); drawReportMarkers(); toast('Avisos borrados'); renderApp(); };
  $('bCon').onclick=()=>{ const l=$('iCon').value.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{ const fav=s.startsWith('*'); const [n,t]=s.replace(/^\*/,'').split(';'); return {n:n.trim(),t:(t||'').trim(),fav:fav?1:0}; }).filter(c=>c.n);
    if(l.length){ PH.contacts=l; PH.save(); toast('Contactos guardados'); } };
  document.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>{ const id=b.dataset.save, v=$(id).value.trim();
    if(id==='iHome'){ NAV.setts.home=v; saveNav(); renderNavCard(); }
    if(id==='iWork'){ NAV.setts.work=v; saveNav(); renderNavCard(); }
    if(id==='iStart'){ if(!v) return; S.start=v; LS.set('rp-salida',v); if(map&&!NAV.active) setStart(); }
    if(id==='iYt'){ Y.key=v; LS.set('rp-ytkey',v); }
    toast('Guardado'); });
  drawQR();
}

/* ---------- Siri ---------- */
const SR={rec:null,mode:'cmd',cb:null,listening:false,timer:0,
  open(mode='cmd',cb=null,hint=''){
    this.mode=mode; this.cb=cb; clearTimeout(this.timer); speechSynthesis.cancel(); MU.duck(true);
    const s=$('siri'); s.hidden=false;
    s.innerHTML=`<div class="orb"><i></i><i></i><i></i></div><div class="st"><b id="srT">${esc(hint||'¿Qué quieres hacer?')}</b><span id="srH">${mode==='cmd'?'Prueba: «Llévame a casa» · «Pon música de Estopa» · «Llama a Mamá» · «¿Cuánto falta?»':'Habla ahora…'}</span>
      <span class="srin"><input id="srIn" placeholder="…o escríbelo aquí"><button class="pill on" data-siri="send">Enviar</button></span></div><button class="pill" data-siri="close" aria-label="Cerrar">✕</button>`;
    $('srIn').onkeydown=e=>{ if(e.key==='Enter') this.submit($('srIn').value); };
    const R=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!R){ $('srH').textContent='Este navegador no reconoce la voz. Escribe la orden (usa Chrome o Edge para hablar).'; $('srIn').focus(); return; }
    try{ const r=new R(); this.rec=r; r.lang='es-ES'; r.interimResults=true; r.maxAlternatives=1; let fin='';
      r.onresult=e=>{ let t=''; for(const x of e.results){ t+=x[0].transcript; if(x.isFinal) fin=t; } $('srT').textContent=t; };
      r.onerror=e=>{ this.listening=false; const m={'not-allowed':'Permite el micrófono en el navegador (icono del candado) o escribe la orden.','no-speech':'No te he oído. Pulsa el micrófono otra vez o escríbelo.','network':'Sin conexión para el reconocimiento de voz. Escríbelo.'}[e.error]||'No he podido escucharte. Escríbelo.'; $('srH').textContent=m; $('srIn').focus(); };
      r.onend=()=>{ this.listening=false; $('siri').classList.remove('on'); if(fin) this.submit(fin); };
      r.start(); this.listening=true; $('siri').classList.add('on');
    }catch(e){ $('srH').textContent='No he podido usar el micrófono. Escribe la orden.'; }
  },
  submit(text){ text=(text||'').trim(); if(!text) return; if(this.rec){ try{ this.rec.abort(); }catch(e){} } $('srT').textContent='«'+text+'»';
    if(this.mode==='dictate'&&this.cb){ const cb=this.cb; this.cb=null; cb(text); return; }
    siriHandle(text); },
  reply(t){ const s=$('siri'); if(!s.hidden){ $('srH').textContent=t; } MU.duck(false); sayQ(t); clearTimeout(this.timer); this.timer=setTimeout(()=>this.close(),3500); },
  close(){ if(this.rec){ try{ this.rec.abort(); }catch(e){} } $('siri').hidden=true; $('siri').classList.remove('on'); MU.duck(false); }
};
async function siriGo(q,name){
  let place={name:name||q,text:q};
  if(!name){ try{ const r=await placesSearch(q); if(r&&r[0]) place=r[0]; }catch(e){} }
  const ok=await previewTo(place,{auto:true});
  return ok?`Vamos hacia ${place.name}. ${etaPhrase()}`:`No he encontrado ${q}.`;
}
async function siriHandle(text){
  const n=nrm(text); let m; const R=t=>SR.reply(t);
  try{
  if((m=n.match(/^(?:llevame|lleva me|vamos|ir|navega|navegar|como llego|ruta|quiero ir)\s+(?:a|al|hasta|hacia|para)?\s*(.+)$/))){
    const q=m[1].replace(/^(la|el|mi)\s+/,'');
    if(/^casa$/.test(q)) return NAV.setts.home?R(await siriGo(NAV.setts.home,'Casa')):R('Todavía no sé dónde está tu casa. Ponla en Ajustes.');
    if(/^trabajo$/.test(q)) return NAV.setts.work?R(await siriGo(NAV.setts.work,'Trabajo')):R('Todavía no sé dónde trabajas. Ponlo en Ajustes.');
    R('Buscando '+m[1]+'…'); return R(await siriGo(m[1]));
  }
  if((m=n.match(/(gasolinera|aparcamiento|parking|restaurante|cafeteria|supermercado|farmacia|taller|cargador)/))&&/(busca|donde|cerca|proxim|necesito|hay)/.test(n)){
    SR.close(); destScreen(NAV.active?'stop':'dest'); doSearch(m[1]==='parking'?'aparcamiento':m[1],true); sayQ('Esto es lo que he encontrado.'); return; }
  if(/(cuanto falta|cuanto queda|a que hora llego|hora de llegada|cuando llego)/.test(n)) return R(NAV.active?`${etaPhrase()} Quedan ${sayDist(NAV.r.len-NAV.along)}, unos ${fmtMin(remainingSecs())}.`:'No hay ninguna ruta activa.');
  if(/(como esta el trafico|hay trafico|trafico)/.test(n)&&NAV.active){ const j=NAV.alerts.filter(x=>x.type==='atasco'&&!x.done&&x.d1>NAV.along);
    return R(j.length?`Hay ${j.length} retención${j.length>1?'es':''} en tu ruta. La primera a ${sayDist(j[0].d-NAV.along)}.`:'El tráfico es fluido en tu ruta.'); }
  if((m=n.match(/(?:comparte|compartir|envia|manda)\s+(?:mi\s+)?(?:hora de\s+)?llegada\s+(?:con|a)\s+(.+)$/))){ const c=PH.find(m[1]); if(!c) return R('No encuentro a '+m[1]+' en tus contactos.'); if(!NAV.active) return R('Primero inicia una ruta.'); shareScreen(); closeOv(); shareTo(c); return R('Hora de llegada compartida con '+c.n+'.'); }
  if((m=n.match(/^(?:dile|di le)\s+a\s+(.+?)\s+que\s+(.+)$/))||(m=n.match(/^(?:envia|manda|enviale|mandale)\s+(?:un\s+)?mensaje\s+a\s+(.+?)\s+(?:diciendo|que diga|que ponga|que)\s+(.+)$/))){
    const c=PH.find(m[1]); if(!c) return R('No encuentro a '+m[1]+' en tus contactos.'); const lo=text.toLowerCase(); let msg=m[2]; for(const k of [' diciendo ',' que diga ',' que ponga ',' que ']){ const i=lo.indexOf(k); if(i>=0){ msg=text.slice(i+k.length).replace(/[.!¡¿?]+$/,''); break; } } msg=cap(msg.trim()); phSend(c.n,msg); return R(`Enviado a ${c.n}: ${msg}`); }
  if((m=n.match(/^(?:envia|manda)\s+(?:un\s+)?mensaje\s+a\s+(.+)$/))){ const c=PH.find(m[1]); if(!c) return R('No encuentro a '+m[1]+'.'); SR.open('dictate',t=>{ phSend(c.n,t); SR.reply('Enviado a '+c.n+'.'); },'¿Qué le digo a '+c.n+'?'); sayQ('¿Qué le digo a '+c.n+'?'); return; }
  if(/(lee|leeme|lee me|leer)\s.*mensajes|mensajes nuevos|tengo mensajes/.test(n)){ const un=Object.entries(PH.threads).filter(([,t])=>t.unread);
    if(!un.length) return R('No tienes mensajes nuevos.'); SR.close(); un.forEach(([nm])=>readThread(nm)); return; }
  if((m=n.match(/^(?:llama|llamar|llamame a|telefonea|marca)\s+(?:a\s+)?(.+)$/))){ const c=PH.find(m[1]); const digits=m[1].replace(/\D/g,'');
    if(c){ R('Llamando a '+c.n+'.'); phDial(c.n); return; } if(digits.length>=3){ R('Llamando al '+digits+'.'); phDial(null,digits); return; } return R('No encuentro a '+m[1]+' en tus contactos.'); }
  if(/^(pausa|para la musica|deten la musica|para musica|pausa la musica|silencia la musica|quita la musica)/.test(n)){ if(MU.playing()) MU.toggle(); return R('Música en pausa.'); }
  if(/(siguiente cancion|pasa la cancion|pasa de cancion|siguiente tema|^siguiente$)/.test(n)){ MU.next(); return R('Siguiente.'); }
  if(/(cancion anterior|tema anterior|^anterior$)/.test(n)){ MU.prev(); return R('Anterior.'); }
  if(/^(reanuda|continua la musica|sigue la musica|play|pon la musica|reproduce)$/.test(n)){ if(!MU.playing()) MU.toggle(); return R('Reanudando.'); }
  if((m=n.match(/^(?:pon|ponme|reproduce|quiero escuchar|escuchar|play)\s+(?:musica de\s+|la cancion\s+|canciones de\s+|algo de\s+|el disco\s+)?(.+)$/))){
    const q=m[1];
    if(MU.src==='local'&&M.tracks.length){ const i=M.tracks.findIndex(t=>nrm(t.title+' '+t.artist+' '+t.album).includes(q)); if(i>=0){ M.playIdx(i); return R('Pongo '+M.tracks[i].title+'.'); } }
    if(!Y.key) return R('Para buscar música por voz necesito la clave de YouTube en Ajustes. También puedes pegar un enlace en Música.');
    MU.setSrc('yt'); await ytGo(q); if(Y.results.length){ Y.playRes(0); return R('Pongo '+q+' en YouTube.'); } return R('No he encontrado '+q+'.'); }
  if((m=n.match(/modo\s+(dynamic|dinamic|dinamico|deportivo|sport|normal|all weather|lluvia|todo tiempo|a)\b/))){ const k=/normal/.test(m[1])?'N':/(all|lluvia|todo|^a$)/.test(m[1])?'A':'D'; setDNA(k); return R({D:'Modo Dynamic activado.',N:'Modo normal.',A:'Modo All Weather.'}[k]); }
  if((m=n.match(/(?:notifica|notificar|avisa de|reporta|marca|hay un|hay una)\s+(?:un\s+|una\s+)?(accidente|radar|control|policia|obras|atasco|retencion|peligro|vehiculo parado|coche parado|carril cortado)/))){
    const k={accidente:'accidente',radar:'radarm',control:'policia',policia:'policia',obras:'obras',atasco:'atasco',retencion:'atasco',peligro:'peligro','vehiculo parado':'parado','coche parado':'parado','carril cortado':'cortado'}[m[1]]; addReport(k); return SR.close(); }
  if(/(silencia|desactiva|quita)\s+(la\s+)?(voz|las indicaciones|navegacion por voz)/.test(n)){ S.voice=false; LS.set('rp-voz','0'); updVoiceBtn(); SR.close(); toast('Indicaciones por voz silenciadas'); return; }
  if(/(activa|pon)\s+(la\s+)?(voz|las indicaciones)/.test(n)){ S.voice=true; LS.set('rp-voz','1'); updVoiceBtn(); return R('Indicaciones por voz activadas.'); }
  if(/(finaliza|termina|cancela|para|quita)\s+(la\s+)?(ruta|navegacion)/.test(n)){ clearRoute(); return R('Ruta finalizada.'); }
  if(/no molestar/.test(n)){ PH.dnd=!/(desactiva|quita)/.test(n); LS.set('rp-dnd',PH.dnd?'1':'0'); return R(PH.dnd?'No molestar al conducir activado.':'No molestar desactivado.'); }
  if(/(evita|sin)\s+(las\s+)?autopistas/.test(n)){ NAV.setts.highways=true; saveNav(); if(NAV.active) reroute('Evitando autopistas'); return R('Evitaré las autopistas.'); }
  if(/(evita|sin)\s+(los\s+)?peajes/.test(n)){ NAV.setts.tolls=true; saveNav(); if(NAV.active) reroute('Evitando peajes'); return R('Evitaré los peajes.'); }
  if(/(simula|simular|empieza la simulacion)/.test(n)){ toggleSim(); return R(S.sim?'Simulando el viaje.':'Simulación detenida.'); }
  if(/que hora es/.test(n)) return R('Son las '+fmtHM(new Date())+'.');
  if(/(abre|abrir|muestra)\s+(el\s+)?(motor|musica|telefono|mensajes|calendario|ajustes|mapa|mapas)/.test(n)){ const a=n.match(/(motor|musica|telefono|mensajes|calendario|ajustes|mapa|mapas)/)[1].replace(/^mapa$/,'mapas'); setView(a); return R('Abriendo '+a+'.'); }
  R('No te he entendido. Prueba con «Llévame a…», «Pon música de…» o «Llama a…».');
  }catch(e){ console.warn(e); R('Algo ha fallado al hacerlo.'); }
}

/* ---------- Insignias (mensajes sin leer, llamadas perdidas) ---------- */
function decorate(){
  const add=(id,n)=>document.querySelectorAll(`[data-open="${id}"] .ico`).forEach(ic=>{ let b=ic.querySelector('.bdg'); if(!n){ if(b) b.remove(); return; } if(!b){ b=document.createElement('span'); b.className='bdg'; ic.appendChild(b); } b.textContent=n; });
  add('mensajes',PH.unread()); add('telefono',PH.missed());
}
const _renderDock=renderDock; renderDock=function(){ _renderDock(); decorate(); };
const _renderApp=renderApp; renderApp=function(){ _renderApp(); decorate(); if(S.view==='mensajes'){ const b=$('bubs'); if(b) b.scrollTop=b.scrollHeight; } };

/* ---------- Clics de teléfono y Siri ---------- */
let holdT=0, holdFired=false;
$('homebtn').addEventListener('pointerdown',()=>{ holdFired=false; holdT=setTimeout(()=>{ holdFired=true; SR.open(); },650); });
['pointerup','pointerleave'].forEach(ev=>$('homebtn').addEventListener(ev,()=>clearTimeout(holdT)));
document.addEventListener('click',e=>{ if(holdFired&&e.target.closest('#homebtn')){ holdFired=false; e.stopImmediatePropagation(); e.preventDefault(); } },true);
document.addEventListener('click',e=>{
  const s=e.target.closest('[data-siri]'); if(s){ e.stopPropagation(); const v=s.dataset.siri;
    if(v==='close') SR.close(); else if(v==='send') SR.submit($('srIn').value); else { if(!$('ov').hidden&&$('dIn')){ const inp=$('dIn'); SR.open('dictate',t=>{ SR.close(); inp.value=t; doSearch(t); },'¿Qué buscas?'); } else SR.open(); }
    return; }
  const el=e.target.closest('[data-ph]'); if(!el) return; e.stopPropagation(); const d=el.dataset;
  switch(d.ph){
    case 'tab': PH.tab=d.k; renderApp(); break;
    case 'call': phDial(d.n); break;
    case 'key': PH.dial+=d.k; $('kDisp').textContent=PH.dial; break;
    case 'kdel': PH.dial=PH.dial.slice(0,-1); $('kDisp').innerHTML=esc(PH.dial)||'&nbsp;'; break;
    case 'kcall': if(PH.dial){ phDial(null,PH.dial); PH.dial=''; renderApp(); } break;
    case 'accept': acceptCall(); break;
    case 'decline': case 'hang': endCall(); break;
    case 'mute': if(PH.call){ PH.call.muted=!PH.call.muted; renderCall(); } break;
    case 'open': PH.open=d.n; renderApp(); break;
    case 'back': PH.open=null; renderApp(); break;
    case 'read': readThread(d.n); break;
    case 'dict': replyTo(d.n); break;
    case 'quick': phSend(PH.open,d.q); toast('Enviado'); break;
    case 'demo-call': { const c=PH.contacts[Math.floor(Math.random()*PH.contacts.length)]; toast('Llamada entrante en 2 segundos…'); setTimeout(()=>phIncoming(c.n),2000); break; }
    case 'demo-msg': { const ns=Object.keys(DEMO_MSG), n=ns[Math.floor(Math.random()*ns.length)]; setTimeout(()=>phIncomingMsg(n,DEMO_MSG[n][Math.floor(Math.random()*DEMO_MSG[n].length)]),1500); toast('Mensaje en camino…'); break; }
    case 'nact': { $('notif').hidden=true; const a=notifActs[+d.i]; if(a) a[1](); break; }
    case 'nclose': $('notif').hidden=true; break;
    case 'share': shareTo(PH.contacts[+d.i]); break;
  }
});

/* ---------- Mando desde el iPhone (puente) ---------- */
const BR={ok:false,mando:null,since:0};
function mandoText(){
  if(!BR.ok) return 'Arranca Radar Play con «Iniciar Radar Play.bat» para poder usarlo.';
  if(!BR.mando) return 'El puente está en modo solo-ordenador. Revisa MANDO_IPHONE en puente.py.';
  return `Con el iPhone en la misma WiFi, escanea el código con la cámara o abre <b>${esc(BR.mando.url)}</b>. Desde ahí envías destinos (también enlaces de Google Maps), música, el modo DNA u órdenes para Siri.`;
}
function drawQR(){ const q=$('qr'); if(!q) return; q.innerHTML=''; if(!BR.mando) return;
  if(window.QRCode){ new QRCode(q,{text:BR.mando.url,width:150,height:150,colorDark:'#000000',colorLight:'#ffffff'}); } else q.textContent=BR.mando.url; }
async function bridgeInit(){
  if(!location.protocol.startsWith('http')) return;
  try{ const r=await fetch('/api/estado',{cache:'no-store'}); if(!r.ok) return; const j=await r.json(); BR.ok=true; BR.mando=j.mando||null; BR.since=j.ultimo||0;
    if(S.view==='ajustes') renderApp(); pollCmds(); }catch(e){}
}
async function pollCmds(){
  try{ const r=await fetch('/api/cmd?desde='+BR.since,{cache:'no-store'}); if(r.ok){ const j=await r.json(); for(const c of (j.cmds||[])){ BR.since=Math.max(BR.since,c.id); runCmd(c).catch(e=>console.warn(e)); } } }catch(e){}
  setTimeout(pollCmds,1000);
}
async function runCmd(c){
  if(c.type==='dest'){
    toast('Destino recibido del iPhone'); const place=c.lat!=null?{name:c.name||'Destino compartido',address:c.addr||'',loc:{lat:+c.lat,lng:+c.lng}}:null;
    if(place){ sayQ('Destino recibido del iPhone: '+place.name+'.'); await previewTo(place,{auto:!!c.go}); }
    else if(c.text){ if(c.go){ sayQ(await siriGo(c.text)); } else { destScreen('dest',c.text); } }
    else toast('No he podido leer ese enlace de Google Maps');
  }
  if(c.type==='music'){ if(c.action==='toggle') MU.toggle(); else if(c.action==='next') MU.next(); else if(c.action==='prev') MU.prev(); else if(c.text){ MU.setSrc('yt'); const p=ytParse(c.text); if(p) await ytGo(c.text); else { await ytGo(c.text); if(Y.results.length) Y.playRes(0); } } }
  if(c.type==='dna'&&['D','N','A'].includes(c.mode)) setDNA(c.mode);
  if(c.type==='siri'&&c.text){ SR.open(); setTimeout(()=>SR.submit(c.text),300); }
  if(c.type==='msg'&&c.text) phIncomingMsg(c.from||'iPhone',c.text);
  if(c.type==='call') phIncoming(c.from||'iPhone');
  if(c.type==='sim'){ toggleSim(); }
}
