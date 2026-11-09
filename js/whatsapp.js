/* =====================================================================
   Radar Play · Mensajes = WhatsApp de tu iPhone (solo ver, sin contestar)
   Los avisos llegan por Bluetooth (ancs.py): nombre de la persona o del
   grupo y el texto. Sin nada simulado.
   - En marcha: el aviso enseña quién escribe; el texto, solo parado
     (o pulsa «Leer» y lo lee en voz alta).
   - Si lo lees en el iPhone, aquí se marca como leído.
   ===================================================================== */
const WA={desde:0,st:null,primera:true,ids:{}};
/* Fuera los mensajes simulados de versiones anteriores */
if(LS.get('rp-msgs-reales')!=='1'){ PH.threads={}; PH.save(); LS.set('rp-msgs-reales','1'); }
const waIco=`<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#25d366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z"/><path fill="#fff" d="M17.2 14.6c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.6.1l-.9 1.1c-.2.2-.3.2-.6.1a7.6 7.6 0 0 1-3.8-3.3c-.3-.5.3-.5.8-1.6.1-.2 0-.3 0-.5l-.9-2c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.7-.7 1.9-1.4.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3z"/></svg>`;
ICONS.mensajes=`<svg viewBox="0 0 24 24"><path d="M12 2.2a9.8 9.8 0 0 0-8.4 14.8L2.2 21.8l4.9-1.3A9.8 9.8 0 1 0 12 2.2z" style="fill:#fff;stroke:none"/><path d="M17 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.6.1l-.9 1.1c-.2.2-.3.2-.6.1a7.6 7.6 0 0 1-3.8-3.3c-.3-.5.3-.5.8-1.6.1-.2 0-.3 0-.5l-.9-2c-.2-.5-.4-.4-.6-.4H8a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.7-.7 1.9-1.4.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3z" style="fill:#25d366;stroke:none"/></svg>`;
{ const a=APPS.find(x=>x.id==='mensajes'); if(a){ a.name='WhatsApp'; a.bg='linear-gradient(160deg,#2be074,#119c4a)'; } }

const waParado=()=>(E.v||0)<5;
function waNuevo(e){
  const nombre=e.titulo||'WhatsApp', t=thread(nombre);
  if(t.m.some(m=>m.id===e.id)) return;
  t.wa=1; t.m.push({me:0,x:e.texto||'',sub:e.sub||'',t:e.t||Date.now(),id:e.id}); if(t.m.length>60) t.m.splice(0,t.m.length-60);
  if(!e.previo) t.unread=(t.unread||0)+1;
  WA.ids[e.id]=nombre;
}
function waQuitar(id){ const n=WA.ids[id]; if(!n) return; const t=PH.threads[n]; if(t&&t.unread){ t.unread=Math.max(0,t.unread-1); } delete WA.ids[id]; }
function waAviso(e){
  const nombre=e.titulo||'WhatsApp', quien=e.sub&&e.sub!==nombre?e.sub+' · ':'';
  if(PH.dnd){ decorate(); return; }
  notify({title:nombre,sub:'WhatsApp',body:waParado()?(quien+(e.texto||'')).slice(0,160):'Mensaje nuevo · toca «Leer» para oírlo',
    acts:[['Leer',()=>readThread(nombre)],['Ver',()=>{ if(waEnVivo()){ setView('mensajes'); waAbrir(nombre); } else { PH.open=nombre; setView('mensajes'); } }]]});
  beep(1320,.08,2);
}
async function waPoll(){
  if(!SYS.bridge) return;
  let d; try{ d=await (await fetch('/api/avisos?desde='+WA.desde,{cache:'no-store'})).json(); }catch(e){ return; }
  const antes=JSON.stringify(WA.st&&[WA.st.suscrito,WA.st.msg]); WA.st=d;
  let hay=false;
  for(const e of d.eventos||[]){
    WA.desde=Math.max(WA.desde,e.n);
    if(e.tipo==='nuevo'){ const viendo=S.view==='mensajes'&&WA.abierto&&WA.abierto===e.titulo; if(viendo) e.previo=true;   // ya lo estás viendo: sin aviso
      waNuevo(e); if(!e.previo&&!WA.primera) waAviso(e); hay=true; }
    else if(e.tipo==='quitar'){ waQuitar(e.id); hay=true; }
  }
  WA.primera=false;
  if(hay){ PH.save(); decorate(); if(!waEnVivo()) refreshPhone(); }
  else if(S.view==='mensajes'&&antes!==JSON.stringify([d.suscrito,d.msg])) renderApp();
}
setInterval(waPoll,2000); setTimeout(waPoll,1500);
/* Estado de WhatsApp Web en la Raspberry (QR / conectado) */
async function waWebPoll(){ if(!SYS.bridge) return; try{ const d=await (await fetch('/api/whatsapp',{cache:'no-store'})).json();
  const antes=WA.web&&WA.web.estado; WA.web=d; if(S.view==='mensajes'&&antes!==d.estado&&($('ov').hidden||!$('waQR'))) renderApp(); waQRPintar(); }catch(e){} }
setInterval(waWebPoll,3000); setTimeout(waWebPoll,1000);

/* No se puede contestar todavía: Siri «dile a…» avisa en vez de inventar un envío */
phSend=function(name){ toast('Por ahora Radar Play solo enseña los WhatsApp. Contesta desde el iPhone.'); };
shareTo=function(){ closeOv(); toast('Por ahora no se pueden mandar mensajes desde Radar Play'); };
replyTo=function(name){ toast('Por ahora Radar Play solo enseña los WhatsApp. Contesta desde el iPhone.'); };

function waEstado(){
  const d=WA.st, w=WA.web;
  if(!SYS.bridge) return {ok:false,html:'Abre Radar Play en la Raspberry para ver tus WhatsApp.'};
  if(w&&w.estado==='conectado') return {ok:true,html:'WhatsApp conectado'};
  if(w&&w.estado&&w.estado!=='apagado') return {ok:false,html:esc(w.estado==='qr'?'Pulsa «Conectar WhatsApp» y escanea el código con tu iPhone':w.msg||'')};
  if(!d||!d.disponible) return {ok:false,html:'El Bluetooth de la Raspberry no está listo.'};
  if(d.suscrito) return {ok:true,html:'Recibiendo los WhatsApp de '+esc(d.iphone||'tu iPhone')};
  return {ok:false,html:esc(d.msg||'Esperando al iPhone')};
}
VIEWS.mensajes=()=>{
  const st=waEstado();
  const tag=st.ok?`<span class="pill" style="display:inline-flex;gap:6px;align-items:center">${waIco} Conectado</span>`:`<button class="pill on" data-wa="activar">Conectar WhatsApp</button>`;
  if(PH.open){ const t=thread(PH.open); if(t.unread){ t.unread=0; PH.save(); setTimeout(decorate,0); }
    const parado=waParado();
    return `${appbar(esc(PH.open),`<button class="pill" data-ph="back">Volver</button>`)}<div class="abody msgv"><div class="bubbles" id="bubs">${t.m.map(m=>`<div class="bub">${m.sub&&m.sub!==PH.open?`<b style="display:block;font-size:13px;color:#25d366">${esc(m.sub)}</b>`:''}${parado?esc(m.x):'<i class="muted">Texto oculto mientras conduces</i>'}<small>${hm(m.t)}</small></div>`).join('')}</div>
      <div class="qr"><button class="pill on" data-ph="read" data-n="${esc(PH.open)}">Leer en voz alta</button><span class="muted" style="align-self:center">Para contestar, usa el iPhone</span></div></div>`; }
  const names=Object.keys(PH.threads).sort((a,b)=>{ const la=PH.threads[a].m.slice(-1)[0], lb=PH.threads[b].m.slice(-1)[0]; return (lb?lb.t:0)-(la?la.t:0); });
  return `${appbar('WhatsApp',tag)}<div class="abody">
    ${st.ok?'':`<div class="btcon" style="margin:0 0 12px"><div><b>${waIco} Ver tus WhatsApp aquí</b><span class="muted">${st.html}</span></div></div>`}
    <div class="list">${names.length?names.map(n=>{ const t=PH.threads[n], l=t.m.slice(-1)[0];
      return `<button class="row" data-ph="open" data-n="${esc(n)}"><span class="av" style="background:#128c4a">${esc(n[0]||'?')}</span><span class="t"><b>${t.unread?'<i class="dot"></i>':''}${esc(n)}</b><small>${l?esc(((l.sub&&l.sub!==n)?l.sub+': ':'')+(waParado()?l.x:'Mensaje')):''}</small></span><span class="muted">${l?hm(l.t):''}</span></button>`; }).join('')
      :`<p class="muted">${st.ok?'Aún no ha llegado ningún WhatsApp desde que conectaste.':'Cuando conectes el iPhone, aquí saldrán los WhatsApp que te lleguen.'}</p>`}</div>
    <div style="margin-top:12px;display:flex;gap:8px">${names.length?'<button class="pill" data-wa="limpiar">Borrar la lista</button>':''}${WA.web&&WA.web.estado==='conectado'?'<button class="pill" data-wa="salir">Desvincular WhatsApp</button>':''}</div></div>`;
};
function waConectar(){
  const w=WA.web;
  if(!w||w.estado==='apagado'){ api('/api/avisos',{accion:'activar'}).catch(()=>{}); return waConectarBT(); }
  overlay(`<h2>${waIco} Conectar WhatsApp</h2>
    <div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
      <div id="waQR" style="width:300px;height:300px;background:#fff;border-radius:14px;display:grid;place-items:center;color:#333;flex:none">Cargando…</div>
      <ol style="line-height:1.7;margin:0;padding-left:20px;flex:1;min-width:260px">
        <li>En el iPhone abre <b>WhatsApp</b>.</li>
        <li>Ve a <b>Ajustes › Dispositivos vinculados</b>.</li>
        <li>Pulsa <b>Vincular un dispositivo</b> y apunta al código.</li>
      </ol></div>
    <p class="muted" id="waSt" style="margin-top:12px"></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="pill" data-wa="reiniciar">Recargar</button><button class="pill on" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv; waQRPintar(); waWebPoll();
}
function waQRPintar(){
  const box=$('waQR'), st=$('waSt'), w=WA.web||{}; if(!box||$('ov').hidden) return;     // solo con la ventana del QR abierta
  if(w.estado==='conectado'){ closeOv(); toast('WhatsApp conectado. Tus mensajes saldrán aquí'); if(S.view==='mensajes') renderApp(); return; }
  if(w.qr){ if(box.dataset.qr!==w.qr.slice(-40)){ box.innerHTML=`<img src="${w.qr}" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated" alt="Código QR de WhatsApp">`; box.dataset.qr=w.qr.slice(-40); } }
  else box.textContent=w.estado==='error'?'No carga':'Cargando…';
  if(st) st.textContent=w.estado==='qr'?'El código cambia cada poco: escanéalo cuando salga.':(w.msg||'');
}
function waConectarBT(){

  api('/api/avisos',{accion:'activar'}).catch(()=>{});
  overlay(`<h2>${waIco} Ver tus WhatsApp en Radar Play</h2>
    <p>El iPhone tiene que estar ya emparejado con «Radar Play» por Bluetooth (Sistema › iPhone por Bluetooth).</p>
    <ol style="line-height:1.6;margin:0 0 10px;padding-left:20px">
      <li>En el iPhone: <b>Ajustes › Bluetooth</b> › toca la <b>(i)</b> junto a <b>Radar Play</b>.</li>
      <li>Activa <b>«Compartir notificaciones del sistema»</b>. Si sale <b>«Permitir notificaciones»</b>, pulsa <b>Permitir</b>.</li>
      <li>Si el iPhone pide <b>enlazar</b> y sale un código, comprueba que es el mismo que aquí y pulsa <b>Enlazar</b>.</li>
      <li>En el iPhone: <b>Ajustes › Notificaciones › WhatsApp</b> › «Permitir notificaciones» activado.</li>
    </ol>
    <p class="muted" id="waSt">Esperando al iPhone…</p>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="pill on" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv;
  const t=setInterval(()=>{ const el=$('waSt'); if(!el){ clearInterval(t); return; } const s=WA.st||{}, cod=BTS.d&&BTS.d.codigo;
    el.innerHTML=s.suscrito?'<b style="color:#25d366">✓ Conectado. Ya te llegarán los WhatsApp aquí.</b>':(cod?'Código: <b style="font-size:22px;color:var(--fg)">'+esc(cod)+'</b> · ':'')+esc(s.msg||'Esperando al iPhone…'); },1000);
}
document.addEventListener('click',e=>{ const el=e.target.closest('[data-wa]'); if(!el) return; e.stopPropagation();
  if(el.dataset.wa==='activar') waConectar();
  if(el.dataset.wa==='reiniciar'){ api('/api/whatsapp',{accion:'reiniciar'}).catch(()=>{}); toast('Recargando WhatsApp…'); }
  if(el.dataset.wa==='salir') confirmBox('¿Desvincular WhatsApp de Radar Play?','Dejarán de llegar los avisos hasta que vuelvas a escanear el código.','Desvincular',()=>api('/api/whatsapp',{accion:'cerrar_sesion'}).then(()=>{ toast('WhatsApp desvinculado'); }));
  if(el.dataset.wa==='limpiar') confirmBox('¿Borrar la lista?','Solo se borra en Radar Play, no en el iPhone.','Borrar',()=>{ PH.threads={}; PH.save(); decorate(); renderApp(); });
},true);

/* ===================== Tus chats de WhatsApp con la interfaz de Radar Play =====================
   WhatsApp Web sigue abierto en segundo plano; de ahí salen, en tiempo real, los chats (nombre,
   foto, último mensaje, hora, sin leer) y los mensajes del chat que abres (quién, hora, número). */
WA.chats=[]; WA.chat=null; WA.abierto=null;
document.head.insertAdjacentHTML('beforeend',`<style>
.wa-av{width:46px;height:46px;border-radius:50%;flex:none;object-fit:cover;background:#128c4a;display:grid;place-items:center;color:#fff;font-weight:800;font-size:18px;overflow:hidden}
.wa-av img{width:100%;height:100%;object-fit:cover}
.wa-nl{background:#25d366;color:#04140a;border-radius:12px;min-width:24px;height:24px;padding:0 7px;display:inline-grid;place-items:center;font-weight:800;font-size:13px}
.wa-row .t small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wa-row .der{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none}
.wa-row .der .h{color:var(--muted);font-size:13px}.wa-row.nl .der .h{color:#25d366}
.wa-cab{display:flex;align-items:center;gap:12px;min-width:0;font-style:normal}.wa-cab b{display:block;font-size:20px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wa-cab small{display:block;color:var(--muted);font:500 14px/1.2 Inter,system-ui,sans-serif;font-style:normal}
.wa-cab .wa-av{width:40px;height:40px;font-size:16px}
.bub.me{background:#005c4b;color:#fff}.bub .au{display:block;font-size:13px;font-weight:700;color:#25d366;margin-bottom:2px}
.wa-esc{display:flex;gap:8px;padding-top:10px}.wa-esc input{flex:1;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:12px 16px;color:var(--fg);font:inherit;font-size:16px}
</style>`);
const waAv=(nombre,foto)=>{ const ini=esc(((nombre||'?').replace(/^\+/,'')[0]||'?').toUpperCase());
  return `<span class="wa-av">${foto?`<img src="${esc(foto)}" alt="${ini}" referrerpolicy="no-referrer" onerror="this.parentNode.textContent=this.alt">`:ini}</span>`; };
const waNum=n=>n?'+'+n.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/,'$1 $2 $3 $4'):'';
const waEnVivo=()=>SYS.bridge&&WA.web&&WA.web.estado==='conectado';
let waTick=0;
async function waChatsPoll(){
  if(!waEnVivo()) return;
  if(S.view!=='mensajes'&&(waTick++%3)) return;            // fuera de la app, cada ~4 s (para la insignia)
  try{
    if(!WA.abierto){ const d=await (await fetch('/api/whatsapp/chats',{cache:'no-store'})).json(); const j=JSON.stringify(d.chats||[]);
      if(j!==WA.chatsJ){ WA.chatsJ=j; WA.chats=d.chats||[]; decorate(); waPintar(); } }
    else{ const d=await (await fetch('/api/whatsapp/chat',{cache:'no-store'})).json(); if(!d.chat) return; const j=JSON.stringify(d.chat);
      if(j!==WA.chatJ){ WA.chatJ=j; WA.chat=d.chat; waPintar(true); } }
  }catch(e){}
}
setInterval(waChatsPoll,1200);
function waPintar(abajo){
  if(S.view!=='mensajes') return;
  const f=document.activeElement&&document.activeElement.id==='waIn', v=$('waIn')?$('waIn').value:'', b=$('bubs'), alFinal=!b||b.scrollHeight-b.scrollTop-b.clientHeight<80;
  const l=document.querySelector('.abody .list'), sc=l?l.scrollTop:0;
  renderApp();
  if($('waIn')){ $('waIn').value=v; if(f) $('waIn').focus(); }
  const b2=$('bubs'); if(b2&&(abajo&&alFinal||!b)) b2.scrollTop=b2.scrollHeight;
  const l2=document.querySelector('.abody .list'); if(l2) l2.scrollTop=sc;
}
const _vMsgAvisos=VIEWS.mensajes;
VIEWS.mensajes=()=>{
  if(!waEnVivo()) return _vMsgAvisos();
  const parado=waParado();
  if(WA.abierto){
    const c=WA.chat&&WA.chat.nombre===WA.abierto?WA.chat:null, ms=c?c.msgs:[];
    const sub=c?(c.grupo?'Grupo':c.numero?waNum(c.numero):''):'Abriendo…';
    return `${appbar(`<span class="wa-cab">${waAv(WA.abierto,c&&c.foto)}<span><b>${esc(WA.abierto)}</b><small>${esc(sub)}</small></span></span>`,`<button class="pill" data-wa="volver">Volver</button>`)}
    <div class="abody msgv"><div class="bubbles" id="bubs">${ms.length?ms.map(m=>`<div class="bub ${m.yo?'me':''}">${c.grupo&&!m.yo&&(m.autor||m.de)?`<span class="au">${esc(m.autor||waNum(m.de))}</span>`:''}${parado||m.yo?esc(m.texto):'<i class="muted">Texto oculto mientras conduces</i>'}<small>${esc(m.hora)}</small></div>`).join(''):`<p class="muted">${c?'Sin mensajes cargados':'Cargando mensajes…'}</p>`}</div>
      ${parado?`<div class="wa-esc"><input id="waIn" placeholder="Escribe un mensaje" enterkeyhint="send" autocomplete="off"><button class="pill on" data-wa="enviar">Enviar</button><button class="pill" data-wa="leer">Leer</button></div>`
        :`<div class="qr"><button class="pill on" data-wa="leer">Leer en voz alta</button><span class="muted" style="align-self:center">Para escribir, para el coche</span></div>`}</div>`;
  }
  const lista=WA.chats||[];
  return `${appbar('WhatsApp',`<span class="pill" style="display:inline-flex;gap:6px;align-items:center">${waIco} Conectado</span>`)}<div class="abody">
    <div class="list">${lista.length?lista.map(c=>`<button class="row wa-row ${c.nl?'nl':''}" data-wa="abrir" data-n="${esc(c.nombre)}">${waAv(c.nombre,c.foto)}
      <span class="t"><b>${esc(c.nombre)}</b><small>${esc(parado?c.prev:(c.nl?'Mensaje nuevo':c.prev?'…':''))}</small></span>
      <span class="der"><span class="h">${esc(c.hora||'')}</span>${c.nl?`<span class="wa-nl">${c.nl}</span>`:''}</span></button>`).join('')
      :'<p class="muted">Cargando tus chats…</p>'}</div>
    <div style="margin-top:12px;display:flex;gap:8px"><button class="pill" data-wa="salir">Desvincular WhatsApp</button></div></div>`;
};
/* Insignia del icono: mensajes sin leer de tus chats */
{ const _un=PH.unread.bind(PH); PH.unread=()=>waEnVivo()?(WA.chats||[]).reduce((n,c)=>n+(c.nl||0),0):_un(); }
async function waAbrir(nombre){
  WA.abierto=nombre; WA.chat=null; WA.chatJ=''; renderApp();
  const r=await api('/api/whatsapp',{accion:'abrir',nombre}).catch(()=>({ok:false,error:'Sin respuesta'}));
  if(!r.ok){ toast(r.error||'No se pudo abrir'); WA.abierto=null; renderApp(); return; }
  waChatsPoll();
}
function waVolver(){ WA.abierto=null; WA.chat=null; api('/api/whatsapp',{accion:'cerrar_chat'}).catch(()=>{}); WA.chatsJ=''; renderApp(); waChatsPoll(); }
async function waEnviar(){ const i=$('waIn'); if(!i) return; const v=i.value.trim(); if(!v) return;
  if(!waParado()) return toast('Para el coche para escribir');
  const r=await api('/api/whatsapp',{accion:'entrada',t:'enviar',v}).catch(()=>({ok:false})); if(r.ok){ i.value=''; setTimeout(waChatsPoll,400); } else toast(r.error||'No se pudo enviar'); }
function waLeer(){ const c=WA.chat; if(!c) return; const ult=c.msgs.filter(m=>!m.yo).slice(-3);
  sayQ(ult.length?`${c.nombre}. `+ult.map(m=>(c.grupo&&m.autor?m.autor+' dice: ':'')+m.texto).join('. '):'No hay mensajes nuevos.'); }
document.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target&&e.target.id==='waIn'){ e.preventDefault(); waEnviar(); } });
document.addEventListener('click',e=>{ const el=e.target.closest('[data-wa="abrir"],[data-wa="volver"],[data-wa="enviar"],[data-wa="leer"]'); if(!el) return; e.stopPropagation();
  const a=el.dataset.wa;
  if(a==='abrir') return waAbrir(el.dataset.n);
  if(a==='volver') return waVolver();
  if(a==='enviar') return waEnviar();
  if(a==='leer') return waLeer(); },true);
/* Al salir de la app con un chat abierto, se cierra en WhatsApp (para que vuelvan los avisos) */
const _setViewWA=setView; setView=function(v,...a){ if(v!=='mensajes'&&WA.abierto){ WA.abierto=null; api('/api/whatsapp',{accion:'cerrar_chat'}).catch(()=>{}); } const r=_setViewWA(v,...a); if(v==='mensajes') setTimeout(waChatsPoll,50); return r; };
/* El aviso «Ver» abre el chat de verdad */
const _waAvisoOrig=waAviso; waAviso=function(e){ _waAvisoOrig(e); };
/* Si arrancas o paras, se vuelve a pintar (texto oculto / visible) */
let waParAntes=null; setInterval(()=>{ const p=waParado(); if(p!==waParAntes){ const cambio=waParAntes!==null; waParAntes=p; if(cambio&&S.view==='mensajes'&&!(document.activeElement&&document.activeElement.id==='waIn')) renderApp(); } },1500);
