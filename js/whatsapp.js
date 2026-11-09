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
    if(e.tipo==='nuevo'){ waNuevo(e); if(!e.previo&&!WA.primera) waAviso(e); hay=true; }
    else if(e.tipo==='quitar'){ waQuitar(e.id); hay=true; }
  }
  WA.primera=false;
  if(hay){ PH.save(); decorate(); refreshPhone(); }
  else if(S.view==='mensajes'&&antes!==JSON.stringify([d.suscrito,d.msg])) renderApp();
}
setInterval(waPoll,2000); setTimeout(waPoll,1500);

/* No se puede contestar todavía: Siri «dile a…» avisa en vez de inventar un envío */
phSend=function(name){ toast('Por ahora Radar Play solo enseña los WhatsApp. Contesta desde el iPhone.'); };
shareTo=function(){ closeOv(); toast('Por ahora no se pueden mandar mensajes desde Radar Play'); };
replyTo=function(name){ toast('Por ahora Radar Play solo enseña los WhatsApp. Contesta desde el iPhone.'); };

function waEstado(){
  const d=WA.st;
  if(!SYS.bridge) return {ok:false,html:'Abre Radar Play en la Raspberry con tu iPhone cerca para ver tus WhatsApp.'};
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
    ${names.length?'<div style="margin-top:12px"><button class="pill" data-wa="limpiar">Borrar la lista</button></div>':''}</div>`;
};
function waConectar(){
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
  if(el.dataset.wa==='limpiar') confirmBox('¿Borrar la lista?','Solo se borra en Radar Play, no en el iPhone.','Borrar',()=>{ PH.threads={}; PH.save(); decorate(); renderApp(); });
},true);
