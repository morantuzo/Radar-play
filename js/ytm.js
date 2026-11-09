/* =====================================================================
   Radar Play · YouTube Music con TU cuenta (Premium)
   Cuando has entrado con tu cuenta, la app YT Music usa tu contenido:
   tu Principal, tus listas (también las compartidas que guardaste),
   «Me gusta», álbumes, Explorar con las novedades y buscar sin límite.
   Suena en la Raspberry (mpv, sin anuncios) y sigue aunque cambies de
   pantalla. Sin cuenta, sigue funcionando como antes (YouTube Data API).
   ===================================================================== */
const YC={d:null,tab:LS.get('rp-yc-tab')||'principal',vista:null,np:false,q:'',datos:{},cargando:{},err:{},f:{},likes:new Set(),t0:0,ultErr:''};
const ycCuenta=()=>!!(YC.d&&YC.d.cuenta);
const ycRep=()=>YC.d&&YC.d.rep||{};
const ycActual=()=>ycRep().actual||null;
async function ycEstado(){ try{ YC.d=await (await fetch('/api/ytm',{cache:'no-store'})).json(); YC.t0=Date.now(); }catch(e){} return YC.d; }
const ycPost=o=>api('/api/ytm',o).catch(()=>({ok:false,error:'Sin puente'}));
async function ycGet(a,extra){ const r=await (await fetch('/api/ytm?a='+a+(extra||''),{cache:'no-store'})).json(); if(!r.ok) throw new Error(r.error||'error'); return r.d; }
async function ycCargar(clave,a,extra){
  if(YC.cargando[clave]) return; YC.cargando[clave]=1; YC.err[clave]='';
  try{ YC.datos[clave]=await ycGet(a,extra); }catch(e){ YC.err[clave]=e.message; }
  YC.cargando[clave]=0; ycPintar();
}

/* ---------- Tocar ---------- */
function ycPararOtros(){ try{ if(Y.ready&&Y.playing) Y.player.pauseVideo(); }catch(e){} try{ M.a.pause(); }catch(e){} }
async function ycTocar(lista,i){
  const cola=lista.filter(x=>x.tipo==='cancion'); const sel=lista[i]; const j=Math.max(0,cola.indexOf(sel));
  if(!cola.length) return; ycPararOtros();
  const r=await ycPost({accion:'tocar',cola,i:j}); if(r&&r.error) return toast(r.error);
  setTimeout(ycRefrescar,300);
}
async function ycAzar(lista){ const c=lista.filter(x=>x.tipo==='cancion').slice(); for(let k=c.length-1;k>0;k--){ const j=Math.floor(Math.random()*(k+1)); [c[k],c[j]]=[c[j],c[k]]; } if(c.length) ycTocar(c,0); }
async function ycRefrescar(){ await ycEstado(); if(S.view==='youtube'&&ycCuenta()) ycPintar(); else { try{ renderMusicCard(); renderDock(); }catch(e){} } }

/* ---------- Abrir cosas ---------- */
function ycAbrir(x){
  if(!x) return;
  if(x.tipo==='lista'||x.tipo==='album'){ YC.vista={tipo:'lista',x}; YC.np=false; ycPintar(); ycCargar('l-'+x.id,'lista','&id='+encodeURIComponent(x.id)); return; }
  if(x.tipo==='animo'){ YC.vista={tipo:'animo',x}; YC.np=false; ycPintar(); ycCargar('m-'+x.id,'animo','&id='+encodeURIComponent(x.id)); return; }
  if(x.tipo==='artista'){ ycBuscar(x.title); return; }
}
function ycBuscar(q){ q=(q||'').trim(); if(!q) return; YC.q=q; YC.tab='buscar'; YC.vista=null; YC.np=false; YC.datos.res=null; ycPintar(); ycCargar('res','buscar','&q='+encodeURIComponent(q)); }

/* ---------- Pintar ---------- */
const ycImg=(u,cls)=>u?`<img class="${cls||'im'}" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span class="${cls||'im'} ycph" style="display:block;background:linear-gradient(135deg,#333,#161616)"></span>`;
function ycTile(x,f,i){
  const c=ycActual(), on=c&&x.id===c.id;
  return `<button class="ym-tile ${x.tipo==='artista'?'art':''}" data-yc="it" data-f="${f}" data-i="${i}">${ycImg(x.thumb)}<b style="${on?'color:#ff4e5c':''}">${esc(x.title)}</b><small>${esc(x.sub||'')}</small></button>`;
}
function ycFila(x,f,i,num){
  const c=ycActual(), on=c&&x.id===c.id;
  return `<button class="ym-can ${on?'on':''}" data-yc="it" data-f="${f}" data-i="${i}">${num!=null?`<span style="width:26px;text-align:center;font-weight:800;color:var(--muted)">${num}</span>`:''}${ycImg(x.thumb,'')}<span class="t"><b>${esc(x.title)}</b><small>${esc([x.sub,x.dur].filter(Boolean).join(' · '))}</small></span></button>`;
}
function ycSeccion(s,k){
  const f='s'+k; YC.f[f]=s.items; const canc=s.items.filter(x=>x.tipo==='cancion').length;
  if(s.animo) return `<section><h3>${esc(s.titulo)}</h3><div class="ym-gen">${s.items.map((x,i)=>`<button style="background:hsl(${(i*47)%360} 55% 32%)" data-yc="it" data-f="${f}" data-i="${i}">${esc(x.title)}</button>`).join('')}</div></section>`;
  if(canc>=6&&canc===s.items.length) return `<section><h3>${esc(s.titulo)}</h3><div class="ym-rej">${s.items.map((x,i)=>ycFila(x,f,i)).join('')}</div></section>`;
  return `<section><h3>${esc(s.titulo)}</h3><div class="ym-fila">${s.items.map((x,i)=>ycTile(x,f,i)).join('')}</div></section>`;
}
const ycCargando=k=>YC.cargando[k]?'<p class="muted">Cargando…</p>':YC.err[k]?`<div class="ym-av">${esc(YC.err[k]==='sincuenta'?'Vuelve a entrar con tu cuenta.':YC.err[k])} <button class="pill" data-yc="reintentar" data-k="${k}">Reintentar</button></div>`:'';
function ycPrincipal(){
  if(!YC.datos.inicio&&!YC.cargando.inicio&&!YC.err.inicio) ycCargar('inicio','inicio');
  const d=YC.datos.inicio||[];
  return `${ycCargando('inicio')}${d.map((s,k)=>ycSeccion(s,'i'+k)).join('')}`;
}
function ycExplorar(){
  if(!YC.datos.explorar&&!YC.cargando.explorar&&!YC.err.explorar) ycCargar('explorar','explorar');
  return `${ycCargando('explorar')}${(YC.datos.explorar||[]).map((s,k)=>ycSeccion(s,'e'+k)).join('')}`;
}
function ycBiblio(){
  if(!YC.datos.biblio&&!YC.cargando.biblio&&!YC.err.biblio) ycCargar('biblio','biblioteca');
  const b=YC.datos.biblio||{listas:[],albumes:[]};
  const listas=[{tipo:'lista',id:'LM',title:'Me gusta',sub:'Tus canciones',thumb:''},...b.listas.filter(x=>x.id!=='LM')];
  YC.f.bl=listas; YC.f.ba=b.albumes;
  return `${ycCargando('biblio')}<section><h3>Tus listas</h3><div class="ym-fila">${listas.map((x,i)=>x.id==='LM'?`<button class="ym-tile" data-yc="it" data-f="bl" data-i="0"><span class="im" style="display:grid;place-items:center;background:linear-gradient(135deg,#ff2a6a,#7b2cff)"><span style="width:64px;height:64px;color:#fff">${YI.like.replace('<svg','<svg width="64" height="64"')}</span></span><b>Me gusta</b><small>Tus canciones</small></button>`:ycTile(x,'bl',i)).join('')}</div></section>
    ${b.albumes.length?`<section><h3>Álbumes</h3><div class="ym-fila">${b.albumes.map((x,i)=>ycTile(x,'ba',i)).join('')}</div></section>`:''}`;
}
function ycBuscarV(){
  const r=YC.datos.res; YC.f.rc=r&&r.canciones||[]; YC.f.rl=r&&r.listas||[];
  return `<div class="ym-q"><input id="ycIn" placeholder="Buscar en YouTube Music" value="${esc(YC.q)}" enterkeyhint="search" autocomplete="off"><button class="pill on" data-yc="buscar">Buscar</button></div>
    ${YC.cargando.res?'<p class="muted">Buscando…</p>':ycCargando('res')}
    ${r&&r.canciones.length?`<section><h3>Canciones</h3><div class="ym-rej">${r.canciones.map((x,i)=>ycFila(x,'rc',i)).join('')}</div></section>`:''}
    ${r&&r.listas.length?`<section><h3>Álbumes y listas</h3><div class="ym-fila">${r.listas.map((x,i)=>ycTile(x,'rl',i)).join('')}</div></section>`:''}
    ${r&&!r.canciones.length&&!r.listas.length?'<p class="muted">Sin resultados.</p>':''}`;
}
function ycVistaV(){
  const v=YC.vista, x=v.x;
  if(v.tipo==='animo'){ const k='m-'+x.id, l=YC.datos[k]||[]; YC.f.ma=l;
    return `<h2 style="margin:0;font-size:30px">${esc(x.title)}</h2>${ycCargando(k)}<div class="ym-gal">${l.map((y,i)=>ycTile(y,'ma',i)).join('')}</div>`; }
  const k='l-'+x.id, d=YC.datos[k], it=d&&d.items||null; YC.f.vl=it||[];
  return `<div style="display:flex;gap:24px;align-items:flex-end">${x.id==='LM'?`<span style="width:200px;height:200px;border-radius:10px;flex:none;display:grid;place-items:center;background:linear-gradient(135deg,#ff2a6a,#7b2cff);color:#fff">${YI.like.replace('<svg','<svg width="90" height="90"')}</span>`:`<img src="${esc((d&&d.thumb)||x.thumb||'')}" alt="" referrerpolicy="no-referrer" style="width:200px;height:200px;border-radius:10px;object-fit:cover;background:#222;flex:none">`}
    <div style="min-width:0"><div class="muted">${x.tipo==='album'?'Álbum':'Lista'}</div><h2 style="margin:4px 0 6px;font-size:30px;line-height:1.1">${esc((d&&d.title)||x.title)}</h2><div class="muted">${esc((d&&d.sub)||x.sub||'')}${it?' · '+it.length+' canciones':''}</div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="pill on" data-yc="todo" ${it&&it.length?'':'disabled'}>${YI.play.replace('<svg','<svg width="18" height="18" style="vertical-align:-3px"')} Reproducir</button><button class="pill" data-yc="azar" ${it&&it.length?'':'disabled'}>Aleatorio</button></div></div></div>
    <section>${it?(it.length?it.map((y,i)=>ycFila(y,'vl',i,x.tipo==='album'?i+1:null)).join(''):'<p class="muted">Esta lista está vacía.</p>'):ycCargando(k)||'<p class="muted">Cargando…</p>'}</section>`;
}
const ycFm=s=>!s||s<0?'0:00':Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
function ycPos(){ const r=ycRep(); return Math.min(r.dur||1e9,(r.pos||0)+(!r.pausa&&!r.cargando?(Date.now()-YC.t0)/1000:0)); }
function ycNP(){
  const c=ycActual(), r=ycRep(); if(!c){ YC.np=false; return ycPrincipal(); }
  const cola=YC.datos.cola||[]; YC.f.cola=cola;
  return `<div class="ym-np"><div style="display:flex;flex-direction:column;justify-content:center;min-height:0"><div class="ym-art">${ycImg(c.thumb,'')}</div></div>
    <div class="der"><div style="display:flex;align-items:flex-start;gap:10px"><div style="flex:1;min-width:0"><h2>${esc(c.title)}</h2><div class="ar">${esc([c.sub,c.album].filter(Boolean).join(' · '))}</div></div>
        <button class="ym-ib ${YC.likes.has(c.id)?'on':''}" data-yc="like" aria-label="Me gusta">${YC.likes.has(c.id)?YI.like:YI.likeo}</button></div>
      <div><div class="ym-bar" id="ycBar"><i id="ycBarI"></i></div><div class="ym-tm"><span id="ycT0">${ycFm(ycPos())}</span><span id="ycT1">${r.dur?ycFm(r.dur):esc(c.dur||'')}</span></div></div>
      <div class="ym-ctl"><button class="ym-ib" data-yc="mezclar" aria-label="Mezclar lo que queda">${YI.azar}</button><button class="ym-ib" data-yc="ant" aria-label="Anterior">${YI.prev}</button>
        <button class="ym-ib big" data-yc="pausa" aria-label="Reproducir o pausar">${r.cargando?'<span class="ycspin"></span>':r.pausa?YI.play:YI.pause}</button><button class="ym-ib" data-yc="sig" aria-label="Siguiente">${YI.next}</button>
        <button class="ym-ib ${r.repetir!=='no'?'on':''}" data-yc="rep" aria-label="Repetir" style="position:relative">${YI.rep}${r.repetir==='una'?'<b style="position:absolute;font-size:10px;top:13px;left:20px">1</b>':''}</button></div>
      ${r.error?`<p class="muted" style="color:#ff8a8a;margin:0">${esc(r.error)}</p>`:''}
      <div><h3 style="font-size:17px;margin:4px 0 6px">A continuación</h3><div class="ym-cola">${cola.slice(1,30).map((y,k)=>ycFila(y,'cola',k+1)).join('')||'<p class="muted">Al acabar sigue la radio de esta canción.</p>'}</div></div></div></div>`;
}
function ycSinCuenta(){
  const d=YC.d||{};
  if(!SYS.bridge) return '';
  const btn=d.login||d.preparando?`<button class="pill" disabled>${d.preparando?'Preparando…':'Esperando a que entres…'}</button>`:`<button class="pill on" data-yc="login">Entrar con mi cuenta</button>`;
  return `<div class="ym-av" style="display:flex;gap:16px;align-items:center;background:linear-gradient(90deg,rgba(255,0,51,.22),rgba(255,255,255,.05))"><span style="width:44px;height:44px;flex:none">${ICONS.youtube}</span>
    <div style="flex:1"><b>¿Tienes YouTube Music Premium?</b><div class="muted">${esc(d.error||d.msg||'Entra con tu cuenta y tendrás aquí tus listas, «Me gusta», las novedades y búsquedas sin límite. Se entra una vez.')}</div></div>${btn}</div>`;
}
{ const _v=VIEWS.youtube; VIEWS.youtube=()=>{
  if(!ycCuenta()){ const s=_v(); return s.replace('<div class="ym">','<div class="ym">'+ycSinCuenta()); }
  const c=ycActual(), np=YC.np&&c, r=ycRep();
  const tabs=[['principal','Principal'],['explorar','Explorar'],['biblioteca','Biblioteca']];
  const cab=np?`<button class="ym-ib" data-yc="np-cerrar" aria-label="Cerrar">${YI.abajo}</button>`
    :`<span style="display:flex;gap:6px;align-items:center">${tabs.map(([k,n])=>`<button class="pill ${YC.tab===k&&!YC.vista?'on':''}" data-yc="tab" data-t="${k}">${n}</button>`).join('')}<button class="ym-ib ${YC.tab==='buscar'?'on':''}" data-yc="tab" data-t="buscar" aria-label="Buscar">${YI.buscar}</button>${YC.d.foto?`<button class="ycyo" data-yc="cuenta" aria-label="Tu cuenta"><img src="${esc(YC.d.foto)}" alt="" referrerpolicy="no-referrer"></button>`:`<button class="ym-ib" data-yc="cuenta" aria-label="Tu cuenta">👤</button>`}</span>`;
  const cuerpo=np?ycNP():YC.vista?`<div><button class="pill" data-yc="atras">‹ Atrás</button></div>${ycVistaV()}`:YC.tab==='explorar'?ycExplorar():YC.tab==='biblioteca'?ycBiblio():YC.tab==='buscar'?ycBuscarV():ycPrincipal();
  const mini=c&&!np?`<div class="ym-mini">${ycImg(c.thumb,'')}<button class="t" data-yc="np"><b>${esc(c.title)}</b><small>${esc(c.sub||'')}</small></button>
      <button class="ym-ib ${YC.likes.has(c.id)?'on':''}" data-yc="like">${YC.likes.has(c.id)?YI.like:YI.likeo}</button><button class="ym-ib" data-yc="pausa">${r.cargando?'<span class="ycspin"></span>':r.pausa?YI.play:YI.pause}</button><button class="ym-ib" data-yc="sig">${YI.next}</button><i class="pb" id="ycMiniB"></i></div>`:'';
  return `${appbar(np?'Reproduciendo':`<span style="display:inline-flex;align-items:center;gap:8px"><span style="width:30px;height:30px;display:inline-block">${ICONS.youtube}</span>Music</span>`,cab)}
    <div class="abody" ${np?'style="overflow:hidden"':''}><div class="ym">${cuerpo}</div></div>${mini}`;
}; }
function ycPintar(){
  if(S.view!=='youtube') return;
  if(!ycCuenta()){ if(typeof ymPintar==='function') ymPintar(); return; }
  const f=document.activeElement&&document.activeElement.id==='ycIn', val=$('ycIn')?$('ycIn').value:null, ab=document.querySelector('#appview .abody'), sc=ab?ab.scrollTop:0;
  const filas=[...document.querySelectorAll('.ym-fila,.ym-rej')].map(x=>x.scrollLeft);
  renderApp();
  if(val!=null&&$('ycIn')){ $('ycIn').value=val; if(f) $('ycIn').focus(); }
  const ab2=document.querySelector('#appview .abody'); if(ab2) ab2.scrollTop=sc;
  document.querySelectorAll('.ym-fila,.ym-rej').forEach((x,i)=>{ if(filas[i]) x.scrollLeft=filas[i]; });
  ycProgreso();
}
/* Si estás en YT Music, el pintado de la versión sin cuenta no se mete */
{ const _yp=ymPintar; ymPintar=function(){ if(ycCuenta()) return ycPintar(); return _yp(); }; }
function ycProgreso(){
  const r=ycRep(); if(!r.actual) return; const d=r.dur||0, t=ycPos(), p=d?Math.min(100,t/d*100):0;
  if($('ycBarI')) $('ycBarI').style.width=p+'%'; if($('ycMiniB')) $('ycMiniB').style.width=p+'%'; if($('cProg')&&ycSuena()) $('cProg').style.width=p+'%';
  if($('ycT0')) $('ycT0').textContent=ycFm(t); if($('ycT1')&&d) $('ycT1').textContent=ycFm(d);
}
document.head.insertAdjacentHTML('beforeend',`<style>
.ym-tile.art .im{border-radius:50%}
.yccard{width:92px;height:92px;border-radius:8px;object-fit:cover;flex:none}
.ym-can .ycph{width:54px;height:54px;border-radius:5px;flex:none}.ym-mini .ycph{width:48px;height:48px;border-radius:5px;flex:none}.ym-art .ycph{width:100%;height:100%}
.ym-gal{display:grid;grid-template-columns:repeat(auto-fill,168px);gap:18px 14px}
.ycyo{width:40px;height:40px;border-radius:50%;padding:0;overflow:hidden;background:#333;margin-left:4px}.ycyo img{width:100%;height:100%;object-fit:cover}
.ycspin{width:26px;height:26px;border:3px solid rgba(0,0,0,.25);border-top-color:currentColor;border-radius:50%;display:inline-block;animation:ycg .8s linear infinite}
@keyframes ycg{to{transform:rotate(360deg)}}
</style>`);

/* ---------- Estado: cada segundo si suena o estás en la app ---------- */
let ycUltId=null;
async function ycBucle(){
  const antes=YC.d; await ycEstado(); const d=YC.d; if(!d) return;
  const c=ycActual(), id=c&&c.id;
  const cambio=!antes||antes.cuenta!==d.cuenta||id!==ycUltId||(antes.rep&&(antes.rep.pausa!==d.rep.pausa||antes.rep.cargando!==d.rep.cargando||antes.rep.repetir!==d.rep.repetir||antes.rep.error!==d.rep.error))||antes.login!==d.login||antes.preparando!==d.preparando||antes.msg!==d.msg;
  if(id!==ycUltId){ ycUltId=id; if(id&&ycCuenta()) YC.datos.cola=await ycGet('cola').catch(()=>[]); }
  if(d.rep&&d.rep.error&&d.rep.error!==YC.ultErr){ YC.ultErr=d.rep.error; toast('YT Music: '+d.rep.error); }
  if(cambio){ if(S.view==='youtube'&&!(document.activeElement&&document.activeElement.id==='ycIn')) ycPintar(); try{ renderMusicCard(); renderDock(); }catch(e){} }
}
setInterval(()=>{ if(!SYS.bridge) return; const r=ycRep(); if(S.view==='youtube'||(r.actual&&!r.pausa)||(YC.d&&(YC.d.login||YC.d.preparando))) ycBucle(); },1000);
setInterval(()=>{ if(SYS.bridge) ycBucle(); },10000);
setTimeout(()=>{ if(SYS.bridge) ycBucle(); },1500);
setInterval(ycProgreso,500);

/* ---------- La música del coche (tarjeta, dock, volante, Siri) ---------- */
const ycSuena=()=>ycCuenta()&&!!ycActual();
{ const m={playing:MU.playing,toggle:MU.toggle,next:MU.next,prev:MU.prev,duck:MU.duck};
  MU.playing=function(){ return ycSuena()?!ycRep().pausa:m.playing.call(this); };
  MU.toggle=function(){ if(ycSuena()){ ycPost({accion:'pausa'}).then(()=>setTimeout(ycRefrescar,150)); return; } return m.toggle.call(this); };
  MU.next=function(){ if(ycSuena()){ ycPost({accion:'siguiente'}).then(()=>setTimeout(ycRefrescar,300)); return; } return m.next.call(this); };
  MU.prev=function(){ if(ycSuena()){ ycPost({accion:'anterior'}).then(()=>setTimeout(ycRefrescar,300)); return; } return m.prev.call(this); };
  MU.duck=function(on){ if(ycSuena()) ycPost({accion:'duck',on}); return m.duck.call(this,on); };
}
/* Si pones otra música (YouTube sin cuenta o tu carpeta), YT Music se para */
{ const _pr=Y.playRes.bind(Y); Y.playRes=function(...a){ if(ycSuena()) ycPost({accion:'parar'}).then(ycRefrescar); return _pr(...a); }; }
try{ const _mp=M.playIdx.bind(M); M.playIdx=function(...a){ if(ycSuena()) ycPost({accion:'parar'}).then(ycRefrescar); return _mp(...a); }; }catch(e){}
{ const _rc=renderMusicCard; renderMusicCard=function(){
  const c=$('musiccard'); const t=ycActual();
  if(!c||!ycSuena()) return _rc();
  const r=ycRep();
  c.innerHTML=`<div class="ytcard">${ycImg(t.thumb,'yccard')}<div class="meta"><b>${esc(t.title)}</b><span>${esc(t.sub||'YouTube Music')}</span>
    <div class="ctrls" style="margin-top:6px">${btn('prev',B.prev,'','Anterior')}${btn('toggle',r.pausa?B.play:B.pause,'big','Reproducir o pausar')}${btn('next',B.next,'','Siguiente')}</div></div></div><div class="prog"><i id="cProg"></i></div>`;
}; }
/* Siri: «pon en YouTube Music …» con tu cuenta busca y pone la primera canción */
if(typeof siriHandle==='function'){ const _s=siriHandle; siriHandle=function(t,...a){
  const m=String(t||'').match(/^(?:pon|busca|abre)\s+(?:en\s+)?(?:youtube(?:\s+music)?|yt music)\s*(.*)$/i);
  if(m&&ycCuenta()){ setView('youtube'); if(m[1]){ ycBuscar(m[1]); ycGet('buscar','&q='+encodeURIComponent(m[1])).then(r=>{ if(r.canciones&&r.canciones.length){ ycTocar(r.canciones,0); if(typeof say==='function') say('Pongo '+r.canciones[0].title); } }).catch(()=>{}); } return; }
  return _s(t,...a); }; }

/* ---------- Toques ---------- */
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-yc]'); if(!el) return; e.stopPropagation(); const a=el.dataset.yc;
  if(a==='login'){ const r=await ycPost({accion:'login'}); if(r&&r.error) toast(r.error); else toast(r.preparando?'Preparando YouTube Music (la primera vez tarda 1-2 min)…':'Entra con tu cuenta de Google en la ventana que se abre'); setTimeout(ycBucle,800); return; }
  if(a==='tab'){ YC.tab=el.dataset.t; YC.vista=null; YC.np=false; if(YC.tab!=='buscar') LS.set('rp-yc-tab',YC.tab); ycPintar(); if(YC.tab==='buscar') setTimeout(()=>$('ycIn')&&$('ycIn').focus(),60); return; }
  if(a==='it'){ const l=YC.f[el.dataset.f]||[], x=l[+el.dataset.i]; if(!x) return;
    if(el.dataset.f==='cola'){ await ycPost({accion:'ir',i:(ycRep().idx||0)+(+el.dataset.i)}); setTimeout(ycRefrescar,300); return; }
    if(x.tipo==='cancion') return ycTocar(l,+el.dataset.i); return ycAbrir(x); }
  if(a==='todo') return ycTocar(YC.f.vl||[],0);
  if(a==='azar') return ycAzar(YC.f.vl||[]);
  if(a==='buscar') return ycBuscar($('ycIn')&&$('ycIn').value);
  if(a==='atras'){ YC.vista=null; ycPintar(); return; }
  if(a==='reintentar'){ const k=el.dataset.k; YC.err[k]=''; YC.datos[k]=null; if(k==='res') ycBuscar(YC.q); else ycPintar(); return; }
  if(a==='np'){ YC.np=true; ycPintar(); return; }
  if(a==='np-cerrar'){ YC.np=false; ycPintar(); return; }
  if(a==='pausa'){ await ycPost({accion:'pausa'}); setTimeout(ycRefrescar,150); return; }
  if(a==='sig'){ await ycPost({accion:'siguiente'}); setTimeout(ycRefrescar,300); return; }
  if(a==='ant'){ await ycPost({accion:'anterior'}); setTimeout(ycRefrescar,300); return; }
  if(a==='rep'){ const v={no:'todo',todo:'una',una:'no'}[ycRep().repetir||'no']; await ycPost({accion:'repetir',v}); toast({no:'Repetir: no',todo:'Repetir: todo',una:'Repetir: una canción'}[v]); ycRefrescar(); return; }
  if(a==='mezclar'){ const c=YC.datos.cola||[]; if(c.length>2){ const resto=c.slice(1); for(let k=resto.length-1;k>0;k--){ const j=Math.floor(Math.random()*(k+1)); [resto[k],resto[j]]=[resto[j],resto[k]]; } await ycPost({accion:'tocar',cola:[c[0],...resto],i:0}); toast('Mezclado'); YC.datos.cola=[c[0],...resto]; ycPintar(); } return; }
  if(a==='like'){ const c=ycActual(); if(!c) return; const on=!YC.likes.has(c.id); const r=await ycPost({accion:'me_gusta',id:c.id,on}); if(r&&r.ok){ on?YC.likes.add(c.id):YC.likes.delete(c.id); YC.datos['l-LM']=null; toast(on?'Añadida a «Me gusta»':'Quitada de «Me gusta»'); ycPintar(); } else toast((r&&r.error)||'No se pudo'); return; }
  if(a==='cuenta'){ overlay(`<h2>Tu cuenta de YouTube Music</h2><p>${esc(YC.d.nombre||'Sesión iniciada')}</p><p class="muted">La sesión se guarda en la Raspberry. Si un día caduca, vuelve a entrar.</p><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="pill" id="cOv">Cerrar</button><button class="pill" id="ycOtra">Cambiar de cuenta</button><button class="pill stop" id="ycSalir">Cerrar sesión</button></div>`);
    $('ycSalir').onclick=async()=>{ await ycPost({accion:'salir'}); closeOv(); YC.datos={}; await ycEstado(); renderApp(); };
    $('ycOtra').onclick=async()=>{ closeOv(); await ycPost({accion:'login'}); toast('Entra con la otra cuenta en la ventana'); setTimeout(ycBucle,800); }; return; }
},true);
document.addEventListener('click',async e=>{ const b=e.target.closest('#ycBar'); if(!b) return; const r=b.getBoundingClientRect(), d=ycRep().dur||0; if(!d) return;
  await ycPost({accion:'seek',t:(e.clientX-r.left)/r.width*d}); setTimeout(ycRefrescar,200); });
document.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target&&e.target.id==='ycIn'){ e.preventDefault(); ycBuscar(e.target.value); } });
{ const _sv=setView; setView=function(v,...a){ const r=_sv(v,...a); if(v==='youtube'&&SYS.bridge) ycBucle(); return r; }; }
