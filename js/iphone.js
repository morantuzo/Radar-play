/* =====================================================================
   Radar Play · iPhone por Bluetooth
   En la Raspberry, con el iPhone emparejado: llamadas reales (contestar,
   colgar, llamar), tus contactos y la música del iPhone con sus botones.
   En el PC (o sin iPhone conectado) sigue el teléfono simulado.
   ===================================================================== */
const BTS={d:null,simContactos:null,ult:null};
const btReal=()=>!!(BTS.d&&BTS.d.telefono);
async function btPoll(){
  if(!SYS.bridge) return;
  try{ BTS.d=await api('/api/bt'); }catch(e){ return; }
  const d=BTS.d, tel=d.telefono;
  /* Contactos del iPhone en lugar de los de ejemplo */
  if(tel&&d.contactos_fecha&&BTS.cfecha!==d.contactos_fecha){ BTS.cfecha=d.contactos_fecha;
    try{ const c=await api('/api/bt/contactos'); if(c.lista&&c.lista.length){ if(!BTS.simContactos) BTS.simContactos=PH.contacts;
      const favs=new Set((BTS.simContactos||[]).filter(x=>x.fav).map(x=>x.n)); PH.contacts=c.lista.map(x=>({n:x.n,t:x.t[0],tt:x.t,fav:favs.has(x.n)?1:0})); } }catch(e){} }
  /* Llamada real → la pantalla de llamada de siempre */
  /* Una llamada que acabas de colgar no vuelve a salir mientras el iPhone termina de cortarla */
  const col=BTS.colgando, colgada=x=>col&&col.id===x.id&&Date.now()<col.hasta;
  const c=(d.llamadas||[]).find(x=>x.estado!=='disconnected'&&!colgada(x));
  if(c&&col&&col.id===c.id){ BTS.colgando=null; toast('El iPhone sigue con la llamada. Prueba otra vez o cuélgala en el iPhone'); }
  if(c){
    const nombre=c.nombre||c.numero||'Número oculto';
    const st=c.estado==='incoming'||c.estado==='waiting'?'ringing':c.estado==='dialing'||c.estado==='alerting'?'dialing':'active';
    if(!PH.call||!PH.call.real||PH.call.id!==c.id){
      if(PH.call&&!PH.call.real){ clearTimeout(PH.callTimer); ringStop(); }
      PH.call={n:nombre,dir:st==='ringing'?'in':'out',state:st,t0:st==='active'?Date.now():0,muted:false,real:true,id:c.id,num:c.numero};
      pauseForCall(); renderCall(); if(st==='ringing'){ sayQ('Llamada de '+nombre); if(SYS.bridge) api('/api/leds',{efecto:'llamada',segundos:30}).catch(()=>{}); }
    } else if(PH.call.state!==st){ PH.call.state=st; if(st==='active'&&!PH.call.t0) PH.call.t0=Date.now(); renderCall(); if(st==='active') api('/api/leds',{efecto:'fin'}).catch(()=>{}); }
  } else if(PH.call&&PH.call.real){ api('/api/leds',{efecto:'fin'}).catch(()=>{}); endCall(); }
  if(S.view==='sistema'&&$('ov').hidden&&JSON.stringify([d.dispositivos,d.emparejando,d.codigo,d.msg,d.contactos_msg])!==BTS.ult){ BTS.ult=JSON.stringify([d.dispositivos,d.emparejando,d.codigo,d.msg,d.contactos_msg]); renderApp(); }
  if(S.view==='musica'||S.view==='panel') btMusicaUI();
}
setInterval(btPoll,1200);

/* Llamar, contestar y colgar de verdad cuando el iPhone está conectado */
const _phDial=phDial; phDial=function(name,num){
  if(!btReal()) return _phDial(name,num);
  const c=PH.find?PH.find(name):null, n=num||(c&&c.t)||name;
  api('/api/bt',{accion:'llamar',numero:n}).then(r=>{ if(!r.ok) toast(r.error); }).catch(()=>toast('Sin respuesta del puente'));
  toast('Llamando desde el iPhone a '+(c?c.n:n)+'…');
};
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-ph]'); if(!el||!PH.call||!PH.call.real) return;
  const a=el.dataset.ph; if(!['accept','decline','hang','mute'].includes(a)) return;
  e.stopPropagation(); e.preventDefault();
  if(a==='accept') api('/api/bt',{accion:'contestar'}).then(r=>{ if(!r.ok) toast(r.error); });
  if(a==='decline'||a==='hang'){
    BTS.colgando={id:PH.call.id,hasta:Date.now()+7000};
    endCall();                                        // la pantalla se libera al momento
    api('/api/bt',{accion:'colgar'}).then(r=>{ if(!r.ok){ BTS.colgando=null; toast(r.error||'No se pudo colgar'); btPoll(); } else if(r.msg) toast(r.msg); })
      .catch(()=>{ BTS.colgando=null; toast('Sin respuesta del puente'); });
  }
  if(a==='mute') api('/api/bt',{accion:'silenciar'}).then(r=>{ if(r.ok){ PH.call.muted=r.silenciado; renderCall(); } });
},true);

/* Música del iPhone: tarjeta con canción y botones (en Música y en el panel) */
document.head.insertAdjacentHTML('beforeend',`<style>
.btmu{display:flex;gap:14px;align-items:center;background:var(--panel);border-radius:16px;padding:12px 16px;margin-bottom:12px}
.btmu .ic{width:54px;height:54px;border-radius:12px;background:linear-gradient(160deg,#fa2d48,#a20f2a);display:grid;place-items:center;flex:none}
.btmu .ic svg{width:28px;height:28px;stroke:#fff;fill:none;stroke-width:2}
.btmu .i{flex:1;min-width:0}.btmu .i b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:17px}.btmu .i span{color:var(--muted);font-size:13.5px}
.btmu .b{display:flex;gap:6px}.btmu .b button{width:46px;height:46px;border-radius:50%;background:var(--panel-2);display:grid;place-items:center}
.btmu .b button svg{width:22px;height:22px;fill:var(--fg)}
.bt-pair{background:var(--panel-2);border-radius:14px;padding:14px 16px;margin:8px 0}
.bt-pair b.cod{font-family:var(--f-d);font-size:40px;letter-spacing:.12em;display:block}
</style>`);
function btMusicaHTML(){
  const m=BTS.d&&BTS.d.musica; if(!m) return '';
  const pl=m.estado==='playing';
  return `<div class="btmu" id="btmu"><span class="ic"><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>
    <div class="i"><b>${esc(m.titulo||'Música del iPhone')}</b><span>${esc(m.artista||'')}${m.album?' · '+esc(m.album):''} · iPhone por Bluetooth</span></div>
    <div class="b"><button data-btm="previous" aria-label="Anterior"><svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg></button>
      <button data-btm="${pl?'pause':'play'}" aria-label="${pl?'Pausa':'Reproducir'}"><svg viewBox="0 0 24 24">${pl?'<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>':'<path d="M7 5v14l12-7z"/>'}</svg></button>
      <button data-btm="next" aria-label="Siguiente"><svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg></button></div></div>`;
}
function btMusicaUI(){ const old=$('btmu'), h=btMusicaHTML(); if(old){ if(!h) old.remove(); else if(old.outerHTML!==h) old.outerHTML=h; }
  else if(h&&S.view==='musica'){ const ab=document.querySelector('#appview .abody'); if(ab) ab.insertAdjacentHTML('afterbegin',h); } }
document.addEventListener('click',e=>{ const el=e.target.closest('[data-btm]'); if(!el) return; e.stopPropagation();
  if(MU.playing()) MU.toggle();                     // pausa YouTube si suena el iPhone
  api('/api/bt',{accion:'musica',orden:el.dataset.btm}).then(r=>{ if(!r.ok) toast(r.error); setTimeout(btPoll,400); }); },true);

/* Sistema › iPhone por Bluetooth */
function btHTML(){
  const d=BTS.d;
  if(!d) return '';
  if(!d.disponible) return `<h3 class="sh">iPhone por Bluetooth</h3><div class="set"><div><b>No disponible aquí</b><div class="muted">${esc(d.msg)}<br>Para probar desde el PC con tu iPhone usa el mando (Ajustes › Mando desde tu iPhone).</div></div></div>`;
  const devs=d.dispositivos||[];
  return `<h3 class="sh">iPhone por Bluetooth</h3>
    <div class="set"><div><b>${d.telefono?'Conectado: '+esc(d.telefono.nombre):'Ningún iPhone conectado'}</b><div class="muted">${d.telefono?[d.telefono.operador,d.telefono.bateria>=0&&d.telefono.bateria!=null?'batería '+d.telefono.bateria*20+' %':'',d.contactos_n?d.contactos_n+' contactos':''].filter(Boolean).join(' · ')||'Llamadas y música por el coche':esc(d.msg)}</div></div>
      <button class="pill ${d.emparejando?'':'on'}" data-bt="${d.emparejando?'parar':'emparejar'}">${d.emparejando?'Parar':'Emparejar un iPhone'}</button></div>
    ${d.emparejando?`<div class="bt-pair"><b>En el iPhone: Ajustes › Bluetooth › «Radar Play»</b>${d.codigo?`<span class="muted">Comprueba que el iPhone muestra el mismo código y pulsa «Enlazar»:</span><b class="cod">${esc(d.codigo)}</b>`:'<span class="muted">Radar Play está visible durante 2 minutos.</span>'}
      <div class="muted" style="margin-top:6px">Cuando pregunte, permite «Sincronizar contactos» para verlos aquí.</div></div>`:''}
    ${devs.map(x=>`<div class="set"><div><b>${esc(x.nombre)}</b><div class="muted">${x.conectado?'Conectado':'Emparejado, no conectado'} · ${esc(x.mac)}</div></div><span style="display:flex;gap:8px">
      <button class="pill" data-bt="${x.conectado?'desconectar':'conectar'}" data-mac="${esc(x.mac)}">${x.conectado?'Desconectar':'Conectar'}</button><button class="pill" data-bt="olvidar" data-mac="${esc(x.mac)}">Olvidar</button></span></div>`).join('')}
    <div class="set"><div><b>Probar el iPhone</b><div class="muted">Comprueba llamadas, música, contactos, altavoces y micrófono</div></div><button class="pill on" data-bt="prueba">Probar</button></div>
    ${d.telefono?`<div class="set"><div><b>Contactos</b><div class="muted">${esc(d.contactos_msg||(d.contactos_fecha?'Actualizados el '+d.contactos_fecha:'Sin descargar'))}</div></div><button class="pill" data-bt="contactos">Actualizar</button></div>`:''}`;
}
const _vSis3=VIEWS.sistema; VIEWS.sistema=()=>{ const s=_vSis3(); return SYS.bridge?s.replace('<h3 class="sh">Hardware</h3>',btHTML()+'<h3 class="sh">Hardware</h3>'):s; };
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-bt]'); if(!el) return; e.stopPropagation(); const a=el.dataset.bt, mac=el.dataset.mac;
  const go=async b=>{ const r=await api('/api/bt',b).catch(()=>({ok:false,error:'Sin respuesta'})); if(!r.ok) toast(r.error); await btPoll(); BTS.ult=null; renderApp(); };
  if(a==='emparejar') return go({accion:'emparejar'});
  if(a==='parar') return go({accion:'parar_emparejar'});
  if(a==='olvidar') return confirmBox('¿Olvidar este iPhone?','Tendrás que volver a emparejarlo.','Olvidar',()=>go({accion:'olvidar',mac}));
  if(a==='conectar'||a==='desconectar') return go({accion:a,mac});
  if(a==='contactos') return go({accion:'contactos'});
  if(a==='prueba') return btPrueba();
},true);
/* Teléfono: dice si es real o simulado */
const _vTel=VIEWS.telefono; VIEWS.telefono=()=>{ const h=_vTel(); return btReal()?h.replace('iPhone simulado','iPhone conectado: '+esc(BTS.d.telefono.nombre)):h; };

/* ===================== Probar el iPhone (pruebas reales en la Raspberry) ===================== */
const BTP={d:null,a:null,t:0,res:{}};
async function btPruebaCargar(){
  if(!$('btp')) { clearInterval(BTP.t); BTP.t=0; return; }
  const [d,a]=await Promise.all([api('/api/bt',{accion:'diagnostico'}).catch(e=>({ok:false,error:'Sin respuesta'})),api('/api/bt',{accion:'audio'}).catch(()=>null)]);
  BTP.d=d; BTP.a=a; btPruebaPintar();
}
function btPruebaPintar(){
  const box=$('btp'); if(!box) return;
  const d=BTP.d||{}, a=BTP.a||{}, b=BTS.d||{}, tel=b.telefono, R=BTP.res;
  const fila=(ok,t,sub,boton='')=>`<div class="set"><div style="display:flex;gap:12px;align-items:flex-start"><span class="btp-ic ${ok===true?'ok':ok===false?'no':'esp'}">${ok===true?'✓':ok===false?'✕':'…'}</span><div><b>${t}</b><div class="muted">${sub}</div></div></div>${boton}</div>`;
  if(!d.ok&&d.error){ box.innerHTML=fila(false,'Bluetooth',esc(d.error)); return; }
  const srv=d.servicios||[];
  box.innerHTML=[
    fila(d.adaptador&&d.encendido,'Bluetooth de la Raspberry',d.adaptador?(d.encendido?'Encendido, visible como «Radar Play»':'Apagado'):'No hay adaptador'),
    fila(!!d.conectado,'iPhone conectado',d.conectado?esc(d.conectado)+(srv.length?' · ofrece: '+srv.join(', '):''):(d.emparejados?'Emparejado pero no conectado: acércalo o pulsa Conectar':'Sin emparejar'),d.conectado?'':`<button class="pill on" data-btp="emparejar">${d.emparejados?'Conectar':'Emparejar'}</button>`),
    fila(d.conectado?d.llamadas:null,'Llamadas (manos libres)',d.llamadas?'Listo para llamar, contestar y colgar'+(tel&&tel.operador?' · '+esc(tel.operador):''):'oFono no ve el iPhone. Desconecta y vuelve a conectar, o reinicia la Raspberry',
      d.llamadas?`<span style="display:flex;gap:8px"><input id="btpNum" class="btp-num" inputmode="tel" placeholder="Número" value="${esc(LS.get('rp-btp-num')||'')}"><button class="pill on" data-btp="llamar">Llamar</button></span>`:''),
    fila(d.conectado?(d.musica||!!d.audio_musica):null,'Música del iPhone',d.musica?'Recibe canción y botones'+(d.audio_musica?' · sonido '+({idle:'en espera',pending:'preparando',active:'sonando'}[d.audio_musica]||esc(d.audio_musica)):''):'Pon música en el iPhone para probar',
      d.musica?'<span style="display:flex;gap:8px"><button class="pill" data-btm="previous">⏮</button><button class="pill on" data-btm="play">▶</button><button class="pill" data-btm="pause">⏸</button><button class="pill" data-btm="next">⏭</button></span>':''),
    fila(d.conectado?(b.contactos_n>0):null,'Contactos',b.contactos_n?b.contactos_n+' contactos del iPhone':esc(b.contactos_msg||'Activa «Sincronizar contactos» en el iPhone: Ajustes › Bluetooth › (i) junto a Radar Play'),'<button class="pill" data-bt="contactos">Descargar</button>'),
    fila(R.tono==null?((a.altavoces||[]).length?null:false):R.tono,'Altavoces',R.tono===true?'¿Has oído dos pitidos? Entonces suena bien':R.tonoMsg?esc(R.tonoMsg):((a.altavoces||[]).length?'Pulsa Probar: suenan dos pitidos':'No veo ninguna salida de sonido'),'<button class="pill" data-btp="tono">Probar</button>'),
    fila(R.micro==null?((a.microfonos||[]).length?null:false):R.micro,'Micrófono (para hablar en las llamadas)',R.microMsg?esc(R.microMsg):((a.microfonos||[]).length?'Pulsa Probar, habla 4 segundos y escucharás tu voz':'No hay micrófono. Conecta uno USB'),`<button class="pill" data-btp="micro">${R.grabando?'Grabando…':'Probar'}</button>`),
    a.bt_perfil?fila(true,'Sonido del iPhone ahora',a.bt_perfil.includes('a2dp')?'Modo música (alta calidad)':a.bt_perfil.includes('head')||a.bt_perfil.includes('hfp')?'Modo llamada':esc(a.bt_perfil)):'',
    tel&&PH.call&&PH.call.real?fila(true,'Llamada en curso','Puedes pasar el sonido al iPhone y devolverlo al coche','<span style="display:flex;gap:8px"><button class="pill" data-btp="al_iphone">Al iPhone</button><button class="pill" data-btp="al_coche">Al coche</button></span>'):''
  ].join('');
}
function btPrueba(){
  overlay(`<h2>Probar el iPhone</h2><p class="muted">Todo es real: llama, contesta y cuelga con tu iPhone. Si algo sale con ✕, mira la explicación.</p>
    <div id="btp" class="btp"><p class="muted">Comprobando…</p></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="pill" id="btpLog">Ver registro</button><button class="pill on" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv;
  $('btpLog').onclick=async()=>{ const r=await api('/api/log?n=40').catch(()=>null); const l=(r&&r.lineas||[]).filter(x=>/\[bt\]|iPhone|Llamada|Colgar/i.test(x)).slice(-15);
    $('btp').insertAdjacentHTML('beforeend',`<pre class="btp-log">${esc(l.join('\n')||'Nada del iPhone en el registro todavía')}</pre>`); };
  BTP.res={}; btPruebaCargar(); clearInterval(BTP.t); BTP.t=setInterval(btPruebaCargar,2500);
}
document.head.insertAdjacentHTML('beforeend',`<style>
.btp .set{gap:10px}.btp-ic{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:800;background:var(--panel-2);color:var(--muted)}
.btp-ic.ok{background:#1e8e3e;color:#fff}.btp-ic.no{background:#d93025;color:#fff}
.btp-num{width:150px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px;color:var(--fg);font:inherit}
.btp-log{white-space:pre-wrap;font-size:12px;background:var(--panel);border-radius:10px;padding:10px;max-height:200px;overflow:auto;margin-top:8px}
</style>`);
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-btp]'); if(!el) return; e.stopPropagation(); const a=el.dataset.btp, R=BTP.res;
  if(a==='emparejar'){ const dev=(BTS.d&&BTS.d.dispositivos||[])[0]; await api('/api/bt',dev?{accion:'conectar',mac:dev.mac}:{accion:'emparejar'}).catch(()=>{}); toast(dev?'Conectando con '+dev.nombre+'…':'En el iPhone: Ajustes › Bluetooth › «Radar Play»'); return; }
  if(a==='llamar'){ const n=($('btpNum').value||'').trim(); if(!n) return toast('Escribe un número para la prueba'); LS.set('rp-btp-num',n); phDial(null,n); return; }
  if(a==='tono'){ R.tono=null; R.tonoMsg='Sonando…'; btPruebaPintar(); const r=await api('/api/bt',{accion:'tono'}).catch(()=>({ok:false,error:'Sin respuesta'})); R.tono=r.ok; R.tonoMsg=r.ok?null:r.error; btPruebaPintar(); return; }
  if(a==='micro'){ if(R.grabando) return; R.grabando=true; R.micro=null; R.microMsg='Habla ahora… (4 segundos)'; btPruebaPintar();
    const r=await api('/api/bt',{accion:'microfono'}).catch(()=>({ok:false,error:'Sin respuesta'})); R.grabando=false; R.micro=r.ok&&r.nivel>=3; R.microMsg=r.ok?r.msg:r.error; btPruebaPintar(); return; }
  if(a==='al_iphone'||a==='al_coche'){ const r=await api('/api/bt',{accion:a}).catch(()=>({ok:false})); toast(r.ok?(a==='al_iphone'?'Sonido pasado al iPhone':'Sonido de vuelta al coche'):(r.error||'No se pudo')); }
},true);

/* Teléfono: si hay Bluetooth y ningún iPhone, botón para conectarlo de verdad */
const _vTel2=VIEWS.telefono; VIEWS.telefono=()=>{ const h=_vTel2(); const d=BTS.d;
  if(!SYS.bridge||!d||!d.disponible||d.telefono) return h;
  return h.replace('<div class="abody','<div class="btcon"><div><b>Usa tu iPhone de verdad</b><span class="muted">Llamadas, contactos y música reales por Bluetooth</span></div><button class="pill on" data-bt="prueba">Conectar iPhone</button></div><div class="abody'); };
document.head.insertAdjacentHTML('beforeend','<style>.btcon{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--panel);border-radius:14px;padding:12px 16px;margin:0 16px 10px}.btcon b{display:block}</style>');
