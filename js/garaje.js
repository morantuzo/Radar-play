/* =====================================================================
   Radar Play · Puerta del garaje
   Botón en el mapa, en el panel, en el mando del iPhone y por voz.
   Al llegar a casa: te ofrece abrirla (o la abre sola, con 5 s para
   cancelar, si lo activas). Sin relé conectado se simula.
   ===================================================================== */
const GJ={pos:(()=>{ try{ return JSON.parse(LS.get('rp-garaje')||'null'); }catch(e){ return null; } })(),auto:LS.get('rp-garaje-auto')==='1',
  st:null,prev:null,hecho:0,cuenta:null};
const gjOn=()=>!!GJ.pos||!!(GJ.st&&GJ.st.activo);
document.head.insertAdjacentHTML('beforeend',`<style>
#bGar{display:none}body[data-gar] #bGar{display:flex}
#bGar.on{background:var(--ok)}#bGar.on svg{stroke:#fff}
.gj-cuenta{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:40;background:rgba(8,10,13,.95);border-radius:22px;padding:24px 30px;text-align:center;min-width:300px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.gj-cuenta b{display:block;font-family:var(--f-d);font-size:64px;line-height:1;color:var(--ok)}
.gj-cuenta p{margin:6px 0 14px;font-weight:700}
</style>`);
(function(){ const z=document.querySelector('.mctl [data-act="center"]'); if(!z) return;
  z.insertAdjacentHTML('beforebegin','<button class="mbtn" id="bGar" data-gj="abrir" aria-label="Abrir el garaje"><svg viewBox="0 0 24 24"><path d="M3 21V9l9-6 9 6v12"/><path d="M7 21v-8h10v8M7 16h10"/></svg><small>Garaje</small></button>'); })();
function gjMarca(){ if(gjOn()) document.body.dataset.gar='1'; else document.body.removeAttribute('data-gar'); }

async function gjAbrir(origen){
  let r={ok:true,simulado:true};
  if(SYS.bridge) r=await api('/api/garaje',{accion:'abrir',origen:origen||'pantalla'}).catch(()=>({ok:false,error:'Sin respuesta del puente'}));
  if(!r.ok){ toast(r.error||'No se pudo abrir'); return false; }
  GJ.hecho=Date.now(); const b=$('bGar'); if(b){ b.classList.add('on'); setTimeout(()=>b.classList.remove('on'),2500); }
  toast(r.simulado?'Garaje: pulsado (simulado, sin mando por radio ni relé)':r.radio?'Abriendo el garaje (señal enviada)':'Abriendo el garaje'); return true;
}
function gjCancelar(){ if(GJ.cuenta){ clearInterval(GJ.cuenta.t); GJ.cuenta.el.remove(); GJ.cuenta=null; } }
function gjCuenta(){
  gjCancelar(); let n=5; const el=document.createElement('div'); el.className='gj-cuenta';
  el.innerHTML=`<b id="gjN">5</b><p>Abriendo el garaje…</p><button class="pill" id="gjX">Cancelar</button>`;
  $('stage').appendChild(el); $('gjX').onclick=gjCancelar;
  GJ.cuenta={el,t:setInterval(()=>{ n--; if(n<=0){ gjCancelar(); gjAbrir('llegada'); } else $('gjN').textContent=n; },1000)};
  sayQ('Llegando a casa. Abro el garaje.');
}
/* Al acercarse al garaje (menos de 150 m, acercándose y en marcha) */
setInterval(()=>{
  if(!GJ.pos||!S.pos) return;
  const d=kmEntre(S.pos,GJ.pos)*1000, prev=GJ.prev; GJ.prev=d;
  if(d>400){ GJ.listo=true; return; }
  if(!GJ.listo||d>150||prev==null||prev-d<1||(E.v||0)<3||Date.now()-GJ.hecho<300000) return;
  GJ.listo=false;
  if(GJ.auto) gjCuenta();
  else showBanner('Llegando a casa',[['Abrir garaje',()=>gjAbrir('llegada')],['No',null]],15000);
},1000);

/* Ajustes */
const _vAj4=VIEWS.ajustes; VIEWS.ajustes=()=>_vAj4().replace('<h3 class="sh">Sistema</h3>',`<h3 class="sh">Garaje</h3>
  <div class="set"><div><b>Puerta del garaje</b><div class="muted">${GJ.st?esc(GJ.st.msg):'Sin relé conectado: se simula'}</div></div><button class="pill on" data-gj="abrir">Probar</button></div>
  ${gjRfHTML()}
  <div class="set"><div><b>Dónde está el garaje</b><div class="muted">${GJ.pos?'Guardado ('+GJ.pos.lat.toFixed(5)+', '+GJ.pos.lng.toFixed(5)+')':'Ponte delante de la puerta y pulsa «Guardar aquí»'}</div></div><span style="display:flex;gap:8px"><button class="pill" data-gj="aqui">Guardar aquí</button>${GJ.pos?'<button class="pill" data-gj="quitar">Quitar</button>':''}</span></div>
  ${togRow('tGjAuto',GJ.auto,'Abrir sola al llegar','Con 5 segundos para cancelar. Si está apagado, te pregunta al llegar')}
  <h3 class="sh">Sistema</h3>`);
const _bind4=bindSettings; bindSettings=function(){ _bind4(); const t=$('tGjAuto'); if(t) t.onclick=()=>{ GJ.auto=!GJ.auto; LS.set('rp-garaje-auto',GJ.auto?'1':'0'); renderApp(); }; };

document.addEventListener('click',e=>{
  const el=e.target.closest('[data-gj]'); if(!el) return; e.stopPropagation(); const a=el.dataset.gj;
  if(a==='abrir') gjAbrir();
  if(a==='aqui'){ if(!S.pos) return toast('Todavía no sé dónde estás'); GJ.pos={lat:S.pos.lat,lng:S.pos.lng}; LS.set('rp-garaje',JSON.stringify(GJ.pos)); gjMarca(); toast('Garaje guardado aquí'); renderApp(); }
  if(a==='quitar'){ GJ.pos=null; LS.set('rp-garaje',''); gjMarca(); renderApp(); }
},true);
async function gjEstado(){ if(!SYS.bridge) return; try{ GJ.st=await api('/api/garaje'); }catch(e){} gjMarca(); }
setTimeout(gjEstado,1500); setInterval(gjEstado,30000); gjMarca();

/* Siri: «abre el garaje» */
if(typeof siriHandle==='function'){ const _sh4=siriHandle; siriHandle=function(t){ const s=(t||'').toLowerCase();
  if(/garaje|cochera|puerta de casa/.test(s)&&/abr|cierr|puls/.test(s)){ gjAbrir('voz'); return sayQ('Garaje.'); }
  return _sh4.apply(this,arguments); }; }

/* Mando por radio 433 MHz: aprender la señal de tu mando */
function gjRfHTML(){
  const rf=GJ.st&&GJ.st.rf; if(!SYS.bridge||!rf) return '';
  return `<div class="set"><div><b>Mando por radio (433 MHz)</b><div class="muted">${rf.aprendiendo?'Escuchando… pulsa el botón de tu mando 2 veces':rf.aprendido?'Aprendido el '+esc(rf.fecha)+' · código fijo de '+rf.bits+' bits. Se emite al pulsar Garaje':'Emisor FS1000A al GPIO'+rf.tx+' y receptor RXB6 al GPIO'+rf.rx+' (a 3,3 V). Luego pulsa Aprender'}</div></div>
    <span style="display:flex;gap:8px">${rf.aprendido?'<button class="pill" data-gjrf="olvidar">Olvidar</button>':''}<button class="pill ${rf.aprendido?'':'on'}" data-gjrf="aprender">${rf.aprendido?'Volver a aprender':'Aprender mando'}</button></span></div>`;
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-gjrf]'); if(!el) return; e.stopPropagation();
  if(el.dataset.gjrf==='olvidar'){ await api('/api/garaje',{accion:'olvidar_rf'}).catch(()=>{}); }
  else{
    overlay(`<h2>Aprender tu mando</h2><p>Pon el mando a <b>10-20 cm de la antena del receptor</b>.<br>Ahora <b>mantén pulsado el botón 1 segundo, suéltalo y vuelve a pulsarlo</b>.</p><p class="muted" id="gjrfT">Escuchando 7 segundos…</p>`);
    const r=await api('/api/garaje',{accion:'aprender'}).catch(()=>({ok:false,error:'Sin respuesta del puente'}));
    overlay(`<h2>${r.ok?'✓ Mando aprendido':'No se ha podido'}</h2><p>${esc(r.ok?r.msg:r.error)}</p>${r.variable?'<p class="muted">Con un relé: abre un mando de verdad y suelda dos cables a los lados del botón; el relé los une al pulsar Garaje. Va con todos los mandos.</p>':''}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${r.ok?'<button class="pill on" data-gj="abrir">Probar</button>':'<button class="pill on" data-gjrf="aprender">Otra vez</button>'}<button class="pill" id="cOv">Cerrar</button></div>`);
    $('cOv').onclick=closeOv;
  }
  try{ GJ.st=await api('/api/garaje'); }catch(x){} if(S.view==='ajustes') renderApp();
},true);
