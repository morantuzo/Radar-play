/* =====================================================================
   Radar Play · Registro de la pantalla
   Se carga lo primero. Manda al puente (datos/logs/radar-play.log):
   errores de JavaScript, avisos de la consola, pantallas que abres,
   botones que pulsas, rutas, órdenes de voz y avisos que salen.
   Nunca manda lo que escribes, contraseñas ni claves.
   ===================================================================== */
(function(){
  const cola=[]; let envio=0;
  function anota(nivel,msg){
    cola.push({nivel,msg:String(msg).slice(0,1500),t:Date.now()}); if(cola.length>400) cola.splice(0,cola.length-400);
    if(!envio) envio=setTimeout(enviar,nivel==='error'?300:3000);
  }
  async function enviar(){
    envio=0; if(!cola.length) return; const lote=cola.splice(0,200);
    try{ const r=await fetch('/api/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineas:lote}),keepalive:true}); if(!r.ok) throw 0; }
    catch(e){ if(location.protocol!=='file:'&&cola.length<300) cola.unshift(...lote.slice(-100)); setTimeout(enviar,10000); }
    if(cola.length&&!envio) envio=setTimeout(enviar,1000);
  }
  window.RPLOG={info:m=>anota('info',m),aviso:m=>anota('aviso',m),error:m=>anota('error',m),debug:m=>anota('debug',m)};
  const ocultar=s=>String(s).replace(/AIza[0-9A-Za-z_\-]{20,}/g,'AIza…').replace(/([?&](k|key|clave)=)[^&\s]+/gi,'$1…');
  window.addEventListener('error',e=>{ if(e.target&&e.target!==window&&(e.target.src||e.target.href)){ anota('aviso','No carga '+(e.target.tagName||'')+': '+ocultar(e.target.src||e.target.href)); return; }
    anota('error','Error JS: '+ocultar(e.message)+' en '+String(e.filename||'').split('/').pop()+':'+e.lineno+':'+e.colno+(e.error&&e.error.stack?' · '+ocultar(e.error.stack).split('\n').slice(1,4).join(' | '):'')); },true);
  window.addEventListener('unhandledrejection',e=>{ const r=e.reason; anota('error','Promesa sin capturar: '+ocultar(r&&(r.stack||r.message)||r)); });
  const ce=console.error, cw=console.warn;
  console.error=function(...a){ try{ anota('error','console.error: '+ocultar(a.map(x=>x&&x.stack||(typeof x==='object'?JSON.stringify(x):x)).join(' '))); }catch(e){} return ce.apply(this,a); };
  console.warn=function(...a){ try{ const t=a.join(' '); if(!/deprecat|DevTools|Marker is deprecated/i.test(t)) anota('aviso','console.warn: '+ocultar(t)); }catch(e){} return cw.apply(this,a); };
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') enviar(); });
  window.addEventListener('pagehide',enviar);
  anota('info','Pantalla cargada: '+innerWidth+'×'+innerHeight+' · '+navigator.userAgent.replace(/\s*\(.*?\)\s*/,' ').slice(0,90));

  /* Botones que pulsas (sin textos de campos ni teclas del teclado en pantalla) */
  document.addEventListener('click',e=>{
    const b=e.target.closest('button,a,[data-open],[data-act],.tile,.row'); if(!b||b.closest('#osk')) return;
    const ds=Object.entries(b.dataset||{}).filter(([k])=>!/^(i|id|mac|u|n|ri)$/.test(k)).map(([k,v])=>k+'='+String(v).slice(0,24)).join(' ');
    const txt=(b.getAttribute('aria-label')||b.textContent||'').replace(/\s+/g,' ').trim().slice(0,40);
    const vista=typeof S!=='undefined'?S.view:'?';
    anota('info',`Pulsa «${txt||b.id||b.tagName}» en ${vista}${ds?' ['+ds+']':''}`);
  },true);

  /* Cuando todo ha cargado: engancha las funciones principales */
  window.addEventListener('load',()=>setTimeout(()=>{
    const env=(nombre,fmt)=>{ const f=window[nombre]; if(typeof f!=='function') return;
      window[nombre]=function(...a){ try{ anota('info',fmt(...a)); }catch(e){} return f.apply(this,a); }; };
    env('setView',v=>'Abre «'+v+'»');
    env('startNav',()=>'Empieza la navegación'+(typeof NAV!=='undefined'&&NAV.dest?' a «'+(NAV.dest.name||'')+'»':''));
    env('clearRoute',()=>'Termina la ruta');
    env('previewTo',d=>'Busca ruta a «'+(d&&(d.name||d.text)||'')+'»');
    env('reroute',()=>'Recalcula la ruta');
    env('setDNA',m=>'Modo DNA → '+m);
    env('showBanner',t=>'Aviso en pantalla: '+String(t).slice(0,120));
    env('toast',t=>'Mensaje: '+String(t).slice(0,120));
    env('siriHandle',t=>'Orden de voz: «'+String(t||'').slice(0,80)+'»');
    env('openRev',()=>'Abre la cámara trasera');
    env('gjAbrir',o=>'Garaje: pulsar ('+(o||'pantalla')+')');
    env('phDial',n=>'Llamar a '+(n?'un contacto':'un número'));
    env('acceptCall',()=>'Contesta la llamada'); env('endCall',()=>'Cuelga la llamada');
    /* Sin conexión con el puente o con Google */
    let puente=null; setInterval(()=>{ if(typeof SYS==='undefined') return; if(puente!==null&&puente!==SYS.bridge) anota(SYS.bridge?'info':'aviso','Puente '+(SYS.bridge?'conectado':'desconectado')); puente=SYS.bridge; },3000);
    let red=navigator.onLine; addEventListener('online',()=>{ if(!red) anota('info','Internet: vuelve la conexión'); red=true; }); addEventListener('offline',()=>{ anota('aviso','Internet: sin conexión'); red=false; });
    if(typeof google==='undefined') anota('aviso','Google Maps aún no ha cargado');
  },500));
})();
