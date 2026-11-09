/* =====================================================================
   Radar Play · HAT CAN (Waveshare RS485 CAN HAT)
   Sistema › Coche: estado del bus, y «Escuchar el coche» para ver en
   directo los mensajes del bus y grabarlos (con marcas de lo que haces).
   ===================================================================== */
const CANX={d:null,t:null};
async function canCargar(){ try{ CANX.d=await (await fetch('/api/can',{cache:'no-store'})).json(); }catch(e){ CANX.d=null; } return CANX.d; }
function canResumen(d){
  if(!d) return ['Sin datos','—'];
  if(!d.hay) return ['Sin HAT CAN','No veo can0. Pon el HAT, instala esta versión y reinicia'];
  if(!d.arriba) return ['HAT listo, bus parado','can0 existe pero está apagado'];
  const ok=d.bus==='ERROR-ACTIVE'||d.bus==='';
  return [ok?'Bus OK':'Bus con errores', `${(d.velocidad/1000)|0} kbit/s · cristal ${d.cristal?(d.cristal/1e6)+' MHz':'—'} · ${esc(d.bus||'')}`];
}
function canHTML(){
  if(!SYS.bridge) return '';
  const d=CANX.d, [t,s]=canResumen(d);
  return `<h3 class="sh">Coche (HAT CAN)</h3>
    <div class="set"><div><b>${t}</b><div class="muted">${s}${d&&d.msg?' · '+esc(d.msg):''}</div>${d&&d.pista?`<div class="muted" style="color:var(--warn,#f5a524)">${esc(d.pista)}</div>`:''}</div>
      <span style="display:flex;gap:8px">${d&&d.hay?'<button class="pill on" data-can="abrir">Escuchar el coche</button>':''}${d&&d.hay&&!d.arriba?'<button class="pill" data-can="levantar">Encender bus</button>':''}</span></div>
    ${d&&d.hay?`<div class="set"><div><b>Cristal del HAT</b><div class="muted">Míralo en el componente plateado junto al chip MCP2515 (12.000 u 8.000). Si no coincide, el bus da errores. Cambiarlo pide reiniciar.</div></div>
      <span style="display:flex;gap:8px"><button class="pill ${d.cristal===12000000?'on':''}" data-can="cristal" data-hz="12000000">12 MHz</button><button class="pill ${d.cristal===8000000?'on':''}" data-can="cristal" data-hz="8000000">8 MHz</button></span></div>`:''}`;
}
{ const _v=VIEWS.sistema; VIEWS.sistema=()=>{ const s=_v(); return s.replace('<h3 class="sh">Energía</h3>',canHTML()+'<h3 class="sh">Energía</h3>'); }; }
{ const _sv=setView; setView=function(v,...a){ const r=_sv(v,...a); if(v==='sistema'&&SYS.bridge) canCargar().then(()=>{ if(S.view==='sistema'&&$('ov').hidden) renderApp(); }); return r; }; }

/* ---------- Escuchar el coche ---------- */
function canTabla(d){
  const f=(d&&d.tabla)||[];
  if(!f.length) return `<p class="muted" style="padding:20px;text-align:center">${d&&d.escuchando?'Esperando mensajes… (¿contacto puesto?)':'Pulsa «Escuchar»'}</p>`;
  return `<table class="cant"><thead><tr><th>ID</th><th>Hz</th><th>Datos</th><th>Veces</th></tr></thead><tbody>${f.map(x=>{
    const by=x.datos.split(' ').map((b,i)=>`<span class="${x.vivo[i]?'viv':x.cambios[i]?'cam':''}">${b}</span>`).join(' ');
    return `<tr class="${x.viejo?'old':''}"><td>${x.id}</td><td>${x.hz}</td><td class="mono">${by}</td><td>${x.n}</td></tr>`; }).join('')}</tbody></table>`;
}
function canBarra(d){
  return `<span>${d.escuchando?'● Escuchando':'○ Parado'} · ${d.tramas} mensajes${d.grabando?' · <b style="color:#ff5a5a">● Grabando</b> '+esc(d.grabando):''}</span>`;
}
function canAbrir(){
  overlay(`<h2>Escuchar el coche</h2>
    <p class="muted">Solo escucha: no manda nada al coche. Graba, haz algo (pulsa un botón del volante, cambia el DNA, abre una puerta) y pulsa «Marca» justo después. Los bytes en <span class="viv">verde</span> están cambiando ahora; en <span class="cam">ámbar</span>, han cambiado alguna vez.</p>
    <div class="canbar" id="canBar"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
      <button class="pill on" id="canEsc">Escuchar</button><button class="pill" id="canGrab">Grabar</button>
      <button class="pill" id="canMarca">Marca</button><input id="canTxt" type="text" placeholder="qué has hecho (opcional)" style="flex:1;min-width:140px">
    </div>
    <div id="canTab" class="cantw"></div>
    <p class="muted" style="font-size:12px">La grabación se descarga desde el mando del iPhone (Ajustes de Radar Play › Registro). Guarda las 10 últimas.</p>
    <div style="text-align:right;margin-top:10px"><button class="pill" id="cOv">Cerrar</button></div>`);
  const pinta=async()=>{ const d=await canCargar(); if(!d||!$('canTab')) return;
    $('canBar').innerHTML=canBarra(d); $('canTab').innerHTML=canTabla(d);
    $('canEsc').textContent=d.escuchando?'Parar':'Escuchar'; $('canEsc').classList.toggle('on',!d.escuchando);
    $('canGrab').textContent=d.grabando?'Parar grabación':'Grabar'; $('canGrab').classList.toggle('stop',!!d.grabando); };
  $('canEsc').onclick=async()=>{ await api('/api/can',{accion:'escuchar',on:!(CANX.d&&CANX.d.escuchando)}).catch(()=>{}); pinta(); };
  $('canGrab').onclick=async()=>{ const r=await api('/api/can',{accion:'grabar',on:!(CANX.d&&CANX.d.grabando)}).catch(()=>({})); if(r&&r.error) toast(r.error); pinta(); };
  $('canMarca').onclick=async()=>{ await api('/api/can',{accion:'marcar',texto:$('canTxt').value.trim()||'marca'}).catch(()=>{}); $('canTxt').value=''; toast('Marca puesta'); };
  const cerrar=$('cOv'); cerrar.onclick=()=>{ clearInterval(CANX.t); CANX.t=null; closeOv(); };
  clearInterval(CANX.t); CANX.t=setInterval(()=>{ if(!$('canTab')){ clearInterval(CANX.t); CANX.t=null; return; } pinta(); },700);
  pinta();
}
document.addEventListener('click',async e=>{ const el=e.target.closest('[data-can]'); if(!el) return; e.stopPropagation(); const a=el.dataset.can;
  if(a==='abrir') return canAbrir();
  if(a==='levantar'){ const r=await api('/api/can',{accion:'levantar'}).catch(()=>({})); if(r.error) toast(r.error); await canCargar(); renderApp(); }
  if(a==='cristal') confirmBox('¿Cristal de '+(+el.dataset.hz/1e6)+' MHz?','Se cambia la configuración del HAT. Después reinicia la Raspberry.','Cambiar',async()=>{ const r=await api('/api/can',{accion:'cristal',hz:+el.dataset.hz}).catch(()=>({})); toast(r.msg||r.error||'Hecho'); await canCargar(); renderApp(); });
},true);
document.head.insertAdjacentHTML('beforeend',`<style>
.cantw{max-height:46vh;overflow:auto;border-radius:12px;background:rgba(0,0,0,.35)}
.cant{width:100%;border-collapse:collapse;font-size:14px}
.cant th{position:sticky;top:0;background:#111;text-align:left;padding:6px 10px;font-weight:600;color:#aaa}
.cant td{padding:4px 10px;border-top:1px solid rgba(255,255,255,.06);font-variant-numeric:tabular-nums}
.cant td.mono,.cant td:first-child{font-family:ui-monospace,Menlo,Consolas,monospace}
.cant tr.old{opacity:.4}
.viv{color:#3ddc84;font-weight:700}.cam{color:#f5a524}
.canbar{font-size:14px}
</style>`);
