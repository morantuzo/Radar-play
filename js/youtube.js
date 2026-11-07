/* =====================================================================
   Radar Play · App de YouTube
   Vídeos en grande: tendencias, música, buscar, guardados y enlaces
   que mandas desde el iPhone. Usa el mismo reproductor que Música.
   Con el coche en marcha la imagen se tapa y sigue el sonido.
   Para buscar usa la clave de YouTube de Ajustes o, si no hay, la de
   Google Maps (activa «YouTube Data API v3» en el mismo proyecto).
   «YouTube completo» abre la web con tu cuenta en otra ventana (parado).
   ===================================================================== */
const YTA={tab:LS.get('rp-yta-tab')||'inicio',lista:[],cargando:false,err:'',q:'',cache:{},hist:JSON.parse(LS.get('rp-yta-hist')||'[]')};
ICONS.youtube=`<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4.2" style="fill:#fff;stroke:none"/><path d="M9.6 8.4v7.2l6.3-3.6z" style="fill:#e62117;stroke:none"/></svg>`;
APPS.splice(APPS.findIndex(a=>a.id==='musica')+1,0,{id:'youtube',name:'YouTube',bg:'linear-gradient(160deg,#ff3d3d,#b80d0d)'});
const ytaClave=()=>Y.key||S.key||'';

document.head.insertAdjacentHTML('beforeend',`<style>
.yta{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px;height:100%;min-height:0}
.yta.sola{grid-template-columns:1fr}
.yta-p{display:flex;flex-direction:column;gap:10px;min-height:0}
.yta-slot{width:100%;aspect-ratio:16/9;border-radius:14px;background:#000}
.yta-t b{font-size:18px;display:block;line-height:1.25}.yta-t span{color:var(--muted);font-size:14px}
.yta-c{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.yta-l{display:flex;flex-direction:column;min-height:0}
.yta-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.yta-q{display:flex;gap:8px;margin-bottom:10px}.yta-q input{flex:1;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:11px 14px;color:var(--fg);font:inherit;font-size:16px}
.yta-g{overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;align-content:start;padding-bottom:12px}
.yta.con .yta-g{grid-template-columns:1fr}
.yta-v{display:flex;flex-direction:column;gap:6px;text-align:left;background:none;padding:0;color:var(--fg)}
.yta.con .yta-v{flex-direction:row;gap:10px}
.yta-v img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:var(--panel);flex:none}
.yta.con .yta-v img{width:150px}
.yta-v b{font-size:14.5px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.yta-v small{color:var(--muted);font-size:12.5px}
.yta-v.on b{color:var(--accent)}
.yta-aviso{background:var(--panel);border-radius:14px;padding:14px 16px;line-height:1.45}
</style>`);

const ytaDur=iso=>{ const m=String(iso||'').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if(!m) return ''; const h=+m[1]||0,mi=+m[2]||0,se=+m[3]||0; return (h?h+':'+String(mi).padStart(2,'0'):mi)+':'+String(se).padStart(2,'0'); };
const ytaVistas=n=>{ n=+n||0; return n>=1e6?(n/1e6).toFixed(n>=1e7?0:1).replace('.',',')+' M de visualizaciones':n>=1e3?Math.round(n/1e3)+' K de visualizaciones':n?n+' visualizaciones':''; };
const ytaItem=i=>({id:i.id&&i.id.videoId||i.id,title:decH(i.snippet.title),channel:decH(i.snippet.channelTitle),
  thumb:((i.snippet.thumbnails||{}).medium||(i.snippet.thumbnails||{}).default||{}).url||'',dur:i.contentDetails?ytaDur(i.contentDetails.duration):'',vistas:i.statistics?ytaVistas(i.statistics.viewCount):''});

async function ytaPedir(url){
  const k=ytaClave(); if(!k) throw new Error('sinclave');
  const r=await fetch(url+'&key='+encodeURIComponent(k)); const j=await r.json();
  if(j.error){ const m=j.error.message||''; const e=new Error(m);
    e.api=/has not been used|is disabled|not enabled|blocked|API_KEY_SERVICE_BLOCKED|referer/i.test(m+' '+JSON.stringify(j.error.details||'')); throw e; }
  return j;
}
async function ytaCargar(force){
  const t=YTA.tab; if(t==='guardados'||t==='historial'){ YTA.err=''; ytaPintar(); return; }
  const key=t+'|'+(t==='buscar'?YTA.q:''); if(!force&&YTA.cache[key]&&Date.now()-YTA.cache[key].ts<20*60000){ YTA.lista=YTA.cache[key].l; YTA.err=''; ytaPintar(); return; }
  if(t==='buscar'&&!YTA.q){ YTA.lista=[]; ytaPintar(); return; }
  YTA.cargando=true; YTA.err=''; ytaPintar();
  try{
    const base='https://www.googleapis.com/youtube/v3/';
    let j;
    if(t==='buscar') j=await ytaPedir(`${base}search?part=snippet&type=video&videoEmbeddable=true&maxResults=24&regionCode=ES&relevanceLanguage=es&q=${encodeURIComponent(YTA.q)}`);
    else j=await ytaPedir(`${base}videos?part=snippet,contentDetails,statistics&chart=mostPopular&regionCode=ES&maxResults=24${t==='musica'?'&videoCategoryId=10':''}`);
    YTA.lista=(j.items||[]).map(ytaItem).filter(x=>x.id);
    YTA.cache[key]={l:YTA.lista,ts:Date.now()};
  }catch(e){
    YTA.lista=[];
    YTA.err=e.message==='sinclave'?'sinclave':e.api?'api':'Sin conexión con YouTube'+(e.message?': '+e.message:'');
    if(typeof RPLOG!=='undefined') RPLOG.aviso('YouTube: '+(e.message||e));
  }
  YTA.cargando=false; ytaPintar();
}
function ytaFuente(){
  if(YTA.tab==='guardados') return Y.saved.filter(x=>x.type==='video').map(x=>({id:x.id,title:x.title,channel:'Guardado',thumb:`https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`}));
  if(YTA.tab==='historial') return YTA.hist;
  return YTA.lista;
}
function ytaPlay(i){
  const l=ytaFuente(), v=l[i]; if(!v) return;
  Y.results=l.map(x=>({...x})); Y.playRes(i);
  YTA.hist=[{id:v.id,title:v.title,channel:v.channel,thumb:v.thumb},...YTA.hist.filter(x=>x.id!==v.id)].slice(0,30);
  try{ LS.set('rp-yta-hist',JSON.stringify(YTA.hist)); }catch(e){}
  ytaPintar();
}
function ytaAviso(){
  if(YTA.err==='sinclave') return `<div class="yta-aviso"><b>Falta una clave para buscar.</b><br>Pega un enlace de YouTube arriba (o mándalo desde el iPhone con el mando), o pon tu clave de Google Maps en Ajustes.</div>`;
  if(YTA.err==='api') return `<div class="yta-aviso"><b>Activa YouTube en tu proyecto de Google Cloud</b> (gratis, unas 100 búsquedas al día):<br>
    1. En el PC o el móvil abre <b>console.cloud.google.com</b> con el mismo proyecto de la clave de Maps.<br>
    2. <b>APIs y servicios › Biblioteca</b> › busca «<b>YouTube Data API v3</b>» › <b>Habilitar</b>.<br>
    3. Si tu clave tiene «Restricciones de API», añade también YouTube Data API v3.<br>
    Luego pulsa <b>Reintentar</b>. Mientras tanto puedes pegar enlaces de YouTube arriba.</div>
    <div style="margin-top:10px"><button class="pill on" data-yta="reintentar">Reintentar</button></div>`;
  if(YTA.err) return `<div class="yta-aviso">${esc(YTA.err)}</div><div style="margin-top:10px"><button class="pill on" data-yta="reintentar">Reintentar</button></div>`;
  return '';
}
VIEWS.youtube=()=>{
  const l=ytaFuente(), suena=Y.has()&&MU.src==='yt', cur=Y.results[Y.idx];
  const tabs=[['inicio','Tendencias'],['musica','Música'],['buscar','Buscar'],['guardados','Guardados'],['historial','Historial']];
  const parado=(E.v||0)<=8;
  return `${appbar('YouTube',`<button class="pill" data-yta="completo" ${parado?'':'disabled'} title="Con tu cuenta, en otra ventana">YouTube completo</button>`)}
  <div class="abody"><div class="yta ${suena?'con':'sola'}">
    ${suena?`<div class="yta-p"><div class="yta-slot" id="slotApp"></div>
      <div class="yta-t"><b>${esc(Y.title||'')}</b><span>${esc(Y.channel||'')}${parado?'':' · solo sonido mientras conduces'}</span></div>
      <div class="yta-c">${btn('prev',B.prev,'','Anterior')}${btn('toggle',Y.playing?B.pause:B.play,'big','Reproducir o pausar')}${btn('next',B.next,'','Siguiente')}
        <span class="sp" style="flex:1"></span>${cur?`<button class="pill" data-yta="guardar">${Y.saved.some(x=>x.id===cur.id)?'Guardado ✓':'Guardar'}</button>`:''}<button class="pill" data-yta="parar">Cerrar vídeo</button></div></div>`:''}
    <div class="yta-l">
      <div class="yta-q"><input id="ytaIn" placeholder="Buscar en YouTube o pegar un enlace" value="${esc(YTA.q)}" enterkeyhint="search"><button class="pill on" data-yta="buscar">Buscar</button></div>
      <div class="yta-tabs">${tabs.map(([k,n])=>`<button class="pill ${YTA.tab===k?'on':''}" data-yta-tab="${k}">${n}</button>`).join('')}</div>
      <div class="yta-g" id="ytaG">${YTA.cargando?'<p class="muted">Cargando…</p>':ytaAviso()||(l.length?l.map((v,i)=>`<button class="yta-v ${cur&&cur.id===v.id&&suena?'on':''}" data-yta-v="${i}"><img src="${esc(v.thumb||'')}" alt="" loading="lazy"><span><b>${esc(v.title)}</b><small>${esc([v.channel,v.dur,v.vistas].filter(Boolean).join(' · '))}</small></span></button>`).join('')
        :`<p class="muted">${YTA.tab==='buscar'?'Escribe qué quieres ver y pulsa Buscar.':YTA.tab==='guardados'?'Aún no has guardado vídeos.':YTA.tab==='historial'?'Aún no has visto nada.':'Nada que mostrar.'}</p>`)}</div>
    </div></div></div>`;
};
function ytaPintar(){
  if(S.view!=='youtube') return;
  const f=document.activeElement&&document.activeElement.id==='ytaIn', val=$('ytaIn')?$('ytaIn').value:null, sc=$('ytaG')?$('ytaG').scrollTop:0;
  renderApp(); if(val!=null&&$('ytaIn')) $('ytaIn').value=val; if(f&&$('ytaIn')){ $('ytaIn').focus(); }
  if($('ytaG')) $('ytaG').scrollTop=sc; setTimeout(placeYT,20);
}
function ytaBuscar(){
  const t=($('ytaIn')&&$('ytaIn').value||'').trim(); if(!t) return;
  const p=ytParse(t);
  if(p&&p.type==='list'){ Y.save({type:'list',id:p.id,title:'Lista de YouTube'}); Y.playList(p.id); ytaPintar(); return; }
  if(p){ Y.save({type:'video',id:p.id,title:'Vídeo de YouTube'}); Y.playVideo(p.id); ytaPintar(); return; }
  YTA.q=t; YTA.tab='buscar'; ytaCargar();
}
document.addEventListener('click',async e=>{
  const tb=e.target.closest('[data-yta-tab]'); if(tb){ e.stopPropagation(); YTA.tab=tb.dataset.ytaTab; LS.set('rp-yta-tab',YTA.tab==='buscar'?'inicio':YTA.tab); ytaCargar(); return; }
  const v=e.target.closest('[data-yta-v]'); if(v){ e.stopPropagation(); ytaPlay(+v.dataset.ytaV); return; }
  const el=e.target.closest('[data-yta]'); if(!el) return; e.stopPropagation(); const a=el.dataset.yta;
  if(a==='buscar') return ytaBuscar();
  if(a==='reintentar') return ytaCargar(true);
  if(a==='guardar'){ const c=Y.results[Y.idx]; if(c){ Y.save({type:'video',id:c.id,title:c.title}); toast('Guardado en YouTube › Guardados'); ytaPintar(); } return; }
  if(a==='parar'){ if(Y.ready) Y.player.stopVideo(); Y.mode='none'; Y.playing=false; Y.title=''; refreshMusic(); ytaPintar(); return; }
  if(a==='completo'){
    if((E.v||0)>8) return toast('Para el coche para abrir YouTube completo');
    if(!SYS.bridge){ window.open('https://m.youtube.com/','_blank'); return; }
    if(Y.playing) Y.toggle();
    const r=await api('/api/apps',{web:'youtube'}).catch(()=>({ok:false,error:'Sin respuesta del puente'}));
    toast(r.ok?'Abriendo YouTube… Ciérralo con la ✕ de arriba. Se cierra solo si arrancas':r.error);
  }
},true);
document.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target&&e.target.id==='ytaIn'){ e.preventDefault(); ytaBuscar(); } });
/* Al abrir la app, carga la pestaña; y se repinta cuando cambia lo que suena */
const _setViewYT=setView; setView=function(v,...a){ const r=_setViewYT(v,...a); if(v==='youtube'&&!YTA.lista.length&&!YTA.cargando) ytaCargar(); return r; };
const _refreshMusicYT=refreshMusic; refreshMusic=function(...a){ const r=_refreshMusicYT(...a); if(S.view==='youtube') ytaPintar(); return r; };
/* Al pasar de parado a en marcha (o al revés) cambia el aviso y el botón */
let ytaMarcha=null; setInterval(()=>{ const m=(E.v||0)>8; if(m!==ytaMarcha){ ytaMarcha=m; if(S.view==='youtube'&&document.activeElement.id!=='ytaIn') ytaPintar(); } },1500);
/* Siri: «pon en YouTube …» */
if(typeof siriHandle==='function'){ const _sYT=siriHandle; siriHandle=function(t,...a){ const m=String(t||'').match(/^(?:pon|busca|abre)\s+(?:en\s+)?youtube\s*(.*)$/i);
  if(m){ setView('youtube'); if(m[1]){ YTA.q=m[1]; YTA.tab='buscar'; ytaCargar(); } return; } return _sYT(t,...a); }; }
