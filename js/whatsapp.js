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
    acts:[['Leer',()=>readThread(nombre)],['Ver',()=>{ PH.open=nombre; setView('mensajes'); }]]});
  beep(1320,.08,2);
}
async function waPoll(){
  if(!SYS.bridge) return;
  let d; try{ d=await (await fetch('/api/avisos?desde='+WA.desde,{cache:'no-store'})).json(); }catch(e){ return; }
  const antes=JSON.stringify(WA.st&&[WA.st.suscrito,WA.st.msg]); WA.st=d;
  let hay=false;
  for(const e of d.eventos||[]){
    WA.desde=Math.max(WA.desde,e.n);
    if(e.tipo==='nuevo'){ const viendo=!!$('waImg'); if(viendo) e.previo=true;   // lo estás viendo en directo: sin aviso
      waNuevo(e); if(!e.previo&&!WA.primera) waAviso(e); hay=true; }
    else if(e.tipo==='quitar'){ waQuitar(e.id); hay=true; }
  }
  WA.primera=false;
  if(hay){ PH.save(); decorate(); if(!$('waImg')) refreshPhone(); }
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

/* ===================== WhatsApp Web en directo dentro de Radar Play ===================== */
WA.modo=LS.get('rp-wa-modo')||'directo';
document.head.insertAdjacentHTML('beforeend',`<style>
.wav{display:flex;flex-direction:column;gap:10px;min-height:0;padding-bottom:10px}
.wa-live{flex:1;min-height:0;position:relative;border-radius:14px;overflow:hidden;background:#0b141a}
.wa-live img{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-drag:none;cursor:default}
.wa-live .wa-c{position:absolute;inset:0;display:grid;place-items:center;color:#8696a0;text-align:center;padding:20px}
.wa-esc{display:flex;gap:8px}.wa-esc input{flex:1;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:12px 16px;color:var(--fg);font:inherit;font-size:16px}
.wa-tabs{display:flex;gap:6px}
</style>`);
const _vMsgWA=VIEWS.mensajes;
VIEWS.mensajes=()=>{
  const w=WA.web;
  if(!SYS.bridge||!w||w.estado!=='conectado'||PH.open||WA.modo==='avisos') {
    const h=_vMsgWA();
    return w&&w.estado==='conectado'&&!PH.open?h.replace('<div class="abody">',`<div class="abody"><div class="wa-tabs" style="margin-bottom:12px"><button class="pill" data-wa="modo" data-m="directo">WhatsApp</button><button class="pill on">Avisos</button></div>`):h;
  }
  const parado=waParado();
  return `${appbar('WhatsApp',`<span class="wa-tabs"><button class="pill on">WhatsApp</button><button class="pill" data-wa="modo" data-m="avisos">Avisos</button></span>`)}
  <div class="abody wav"><div class="wa-live" id="waLive">${parado?'<img id="waImg" alt="WhatsApp">':`<div class="wa-c"><div>${waIco}<br><b style="color:var(--fg)">Por seguridad, WhatsApp se ve con el coche parado</b><br>Los avisos te siguen llegando arriba.</div></div>`}</div>
    ${parado?`<div class="wa-esc"><input id="waIn" placeholder="Escribe aquí y pulsa Enviar (abre antes el chat)" enterkeyhint="send" autocomplete="off"><button class="pill on" data-wa="enviar">Enviar</button></div>`:''}</div>`;
};
/* Tras pintar: arranca el vídeo con el tamaño exacto del hueco */
const _renderAppWA=renderApp; renderApp=function(...a){ const r=_renderAppWA(...a); waVideo(); return r; };
function waVideo(){
  const img=$('waImg'); if(!img||img.dataset.on) return; img.dataset.on='1';
  requestAnimationFrame(()=>{ const b=$('waLive').getBoundingClientRect(); WA.tam=[Math.round(b.width),Math.round(b.height)];
    img.src='/api/whatsapp/pantalla?w='+WA.tam[0]+'&h='+WA.tam[1]+'&t='+Date.now(); waEventos(img); });
}
const waIn=d=>fetch('/api/whatsapp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion:'entrada',...d})}).then(r=>r.json()).catch(()=>({ok:false}));
function waEventos(img){
  const xy=e=>{ const b=img.getBoundingClientRect(); return {x:(e.clientX-b.left)*(WA.tam[0]/b.width),y:(e.clientY-b.top)*(WA.tam[1]/b.height)}; };
  let ini=null, ult=null, acc=0, tm=0;
  img.addEventListener('pointerdown',e=>{ e.preventDefault(); ini=ult={x:e.clientX,y:e.clientY,p:xy(e)}; acc=0; try{ img.setPointerCapture(e.pointerId); }catch(x){} });
  img.addEventListener('pointermove',e=>{ if(!ini) return; const dy=ult.y-e.clientY; ult={x:e.clientX,y:e.clientY,p:ult.p}; acc+=dy;
    if(Math.abs(e.clientY-ini.y)>12&&!tm){ tm=setTimeout(()=>{ tm=0; if(acc){ waIn({t:'rueda',x:ini.p.x,y:ini.p.y,dy:acc*1.6}); acc=0; } },60); } });
  img.addEventListener('pointerup',e=>{ if(!ini) return; const mov=Math.hypot(e.clientX-ini.x,e.clientY-ini.y); if(mov<12) waIn({t:'toque',...ini.p}); else if(acc) waIn({t:'rueda',x:ini.p.x,y:ini.p.y,dy:acc*1.6}); ini=null; });
  img.addEventListener('wheel',e=>{ e.preventDefault(); const p=xy(e); waIn({t:'rueda',x:p.x,y:p.y,dy:e.deltaY}); },{passive:false});
  img.addEventListener('error',()=>{ setTimeout(()=>{ if($('waImg')===img){ img.dataset.on=''; img.removeAttribute('src'); waVideo(); } },3000); });
}
/* Teclado del Raspberry: si no estás en un campo, las teclas van a WhatsApp */
document.addEventListener('keydown',e=>{
  if(!$('waImg')||S.view!=='mensajes'||(e.target&&/INPUT|TEXTAREA/.test(e.target.tagName))||e.ctrlKey||e.altKey||e.metaKey) return;
  if(e.key.length===1){ e.preventDefault(); waIn({t:'texto',v:e.key}); }
  else if(['Enter','Backspace','Escape','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete'].includes(e.key)){ e.preventDefault(); waIn({t:'tecla',k:e.key}); }
});
async function waEnviar(){ const i=$('waIn'); if(!i) return; const v=i.value.trim(); if(!v) return;
  if(!waParado()) return toast('Para el coche para escribir');
  const r=await waIn({t:'enviar',v}); if(r.ok){ i.value=''; } else toast(r.error||'No se pudo enviar'); }
document.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target&&e.target.id==='waIn'){ e.preventDefault(); waEnviar(); } });
document.addEventListener('click',e=>{ const el=e.target.closest('[data-wa="enviar"],[data-wa="modo"]'); if(!el) return; e.stopPropagation();
  if(el.dataset.wa==='enviar') return waEnviar();
  WA.modo=el.dataset.m; LS.set('rp-wa-modo',WA.modo); renderApp(); },true);
/* Si arrancas, se corta el vídeo; al parar, vuelve */
let waParAntes=null; setInterval(()=>{ const p=waParado(); if(p!==waParAntes){ const cambio=waParAntes!==null; waParAntes=p; if(cambio&&S.view==='mensajes'&&!PH.open&&!(document.activeElement&&document.activeElement.id==='waIn')) renderApp(); } },1500);
