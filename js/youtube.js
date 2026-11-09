/* =====================================================================
   Radar Play · YouTube Music
   Parecido a la app del móvil: Principal (estados de ánimo, escuchar de
   nuevo, éxitos, mixes), Explorar, Biblioteca y buscar. Minirreproductor
   abajo y pantalla «Reproduciendo» con portada grande, progreso, aleatorio,
   repetir, «A continuación» y cambio Canción / Vídeo.
   - Suena con el reproductor oficial de YouTube (el mismo que Música).
   - Busca con YouTube Data API v3 (clave de YouTube en Ajustes o la de Maps).
     Las búsquedas se guardan 12 h para gastar poca cuota (unas 100 al día).
   - Conduciendo, el vídeo se tapa con la portada y sigue el sonido.
   ===================================================================== */
const YM={tab:LS.get('rp-ym-tab')||'principal',vista:null,q:'',res:null,cargando:{},err:'',
  likes:JSON.parse(LS.get('rp-ym-likes')||'[]'),hist:JSON.parse(LS.get('rp-ym-hist')||'[]'),
  listas:JSON.parse(LS.get('rp-ym-listas')||'[]'),video:LS.get('rp-ym-video')==='1',
  azar:LS.get('rp-ym-azar')==='1',repetir:LS.get('rp-ym-rep')||'no',lista:null,chip:null};
const ymClave=()=>Y.key||S.key||'';
const ymG=(k,v)=>{ try{ LS.set(k,JSON.stringify(v)); }catch(e){} };
ICONS.youtube=`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" style="fill:#fff;stroke:none"/><circle cx="12" cy="12" r="6.6" style="fill:none;stroke:#ff0033;stroke-width:1.6"/><path d="M10.2 9.2v5.6l4.6-2.8z" style="fill:#ff0033;stroke:none"/></svg>`;
{ const i=APPS.findIndex(a=>a.id==='youtube'); const app={id:'youtube',name:'YT Music',bg:'linear-gradient(160deg,#ff2a3a,#c4001a)'};
  if(i>=0) APPS[i]=app; else APPS.splice(APPS.findIndex(a=>a.id==='musica')+1,0,app); }

const CHIPS=[['Para conducir','música para conducir en coche'],['Energía','canciones con energía éxitos'],['Relax','música relajante chill'],['Entrenar','música para entrenar gym'],
  ['Fiesta','música de fiesta éxitos'],['Reggaetón','reggaeton éxitos'],['Pop español','pop español éxitos'],['Rock','rock clásico éxitos'],['Los 80 y 90','éxitos años 80 90 español'],['Flamenco','flamenco pop rumba']];
const GENEROS=[['Para conducir','#c2185b'],['Energía','#f57c00'],['Relax','#00897b'],['Entrenar','#d32f2f'],['Fiesta','#7b1fa2'],['Reggaetón','#5d4037'],['Pop español','#1976d2'],['Rock','#455a64'],['Los 80 y 90','#ad1457'],['Flamenco','#bf360c']];

/* ---------- Limpieza de títulos: «Artista - Canción (Official Video)» → canción y artista ---------- */
function ymLimpia(titulo,canal){
  let t=decH(titulo||''), a=decH(canal||'').replace(/\s*-\s*Topic$/i,'').replace(/VEVO$/i,'').replace(/\s*Official$/i,'').trim();
  t=t.replace(/\s*[\(\[][^\)\]]*(official|oficial|video|vídeo|audio|lyric|letra|visualizer|hd|4k|remaster)[^\)\]]*[\)\]]/gi,'').replace(/\s*\|\s*.*$/,'').trim();
  const m=t.match(/^(.+?)\s+[-–—]\s+(.+)$/); if(m&&m[1].length<60){ a=m[1].trim(); t=m[2].trim(); }
  return {titulo:t||titulo,artista:a};
}
const ymArte=(id,q)=>`https://i.ytimg.com/vi/${id}/${q||'mqdefault'}.jpg`;
const ymItem=i=>{ const id=i.id&&i.id.videoId||(i.snippet&&i.snippet.resourceId&&i.snippet.resourceId.videoId)||i.id; const l=ymLimpia(i.snippet.title,i.snippet.videoOwnerChannelTitle||i.snippet.channelTitle);
  return {id,title:l.titulo,channel:l.artista,thumb:ymArte(id),dur:i.contentDetails&&i.contentDetails.duration?ytaDur(i.contentDetails.duration):''}; };
const ytaDur=iso=>{ const m=String(iso||'').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if(!m) return ''; const h=+m[1]||0,mi=+m[2]||0,se=+m[3]||0; return (h?h+':'+String(mi).padStart(2,'0'):mi)+':'+String(se).padStart(2,'0'); };

/* ---------- Pedir a YouTube (con caché de 12 h) ---------- */
async function ymPedir(ruta,clave){
  const c=JSON.parse(LS.get('rp-ym-c-'+clave)||'null'); if(c&&Date.now()-c.t<12*3600e3) return c.d;
  const k=ymClave(); if(!k) throw new Error('sinclave');
  const r=await fetch('https://www.googleapis.com/youtube/v3/'+ruta+'&key='+encodeURIComponent(k)); const j=await r.json();
  if(j.error){ const e=new Error(j.error.message||'error'); e.api=/has not been used|disabled|not enabled|blocked|referer|quota/i.test(e.message+JSON.stringify(j.error.errors||'')); e.cuota=/quota/i.test(e.message); throw e; }
  try{ LS.set('rp-ym-c-'+clave,JSON.stringify({t:Date.now(),d:j})); }catch(e){ Object.keys(localStorage).filter(x=>x.startsWith('rp-ym-c-')).forEach(x=>localStorage.removeItem(x)); }
  return j;
}
async function ymCargar(clave,fn){
  if(YM.cargando[clave]) return; YM.cargando[clave]=1; YM.err='';
  try{ YM[clave]=await fn(); }catch(e){ YM.err=e.message==='sinclave'?'sinclave':e.cuota?'cuota':e.api?'api':'red'; if(typeof RPLOG!=='undefined') RPLOG.aviso('YT Music: '+e.message); }
  YM.cargando[clave]=0; ymPintar();
}
const ymExitos=()=>ymCargar('exitos',async()=>(await ymPedir('videos?part=snippet,contentDetails&chart=mostPopular&videoCategoryId=10&regionCode=ES&maxResults=40','exitos')).items.map(ymItem));
const ymBuscarListas=(q,clave)=>ymCargar(clave,async()=>(await ymPedir('search?part=snippet&type=playlist&maxResults=12&regionCode=ES&q='+encodeURIComponent(q),'pl-'+q)).items
  .filter(i=>i.id&&i.id.playlistId).map(i=>({lista:i.id.playlistId,title:decH(i.snippet.title),channel:decH(i.snippet.channelTitle),thumb:(i.snippet.thumbnails.high||i.snippet.thumbnails.medium||{}).url})));
async function ymAbrirLista(l){
  YM.vista={tipo:'lista',l,items:null}; ymPintar();
  try{ const j=await ymPedir('playlistItems?part=snippet&maxResults=50&playlistId='+l.lista,'pi-'+l.lista);
    YM.vista.items=j.items.filter(i=>i.snippet&&i.snippet.resourceId&&!/^(Deleted|Private) video$/i.test(i.snippet.title)).map(ymItem); }
  catch(e){ YM.vista.items=[]; YM.err='red'; }
  ymPintar();
}
async function ymBuscar(q){
  q=(q||'').trim(); if(!q) return; const p=ytParse(q);
  if(p&&p.type==='list') return ymAbrirLista({lista:p.id,title:'Lista de YouTube',channel:''});
  if(p){ ymTocar([{id:p.id,title:'Vídeo de YouTube',channel:'',thumb:ymArte(p.id)}],0); return; }
  YM.q=q; YM.tab='buscar'; YM.vista=null; YM.res=null; ymPintar();
  await ymCargar('res',async()=>{ const [v,l]=await Promise.all([
      ymPedir('search?part=snippet&type=video&videoCategoryId=10&videoEmbeddable=true&maxResults=20&regionCode=ES&q='+encodeURIComponent(q),'s-'+q),
      ymPedir('search?part=snippet&type=playlist&maxResults=8&regionCode=ES&q='+encodeURIComponent(q),'pl-'+q).catch(()=>({items:[]}))]);
    return {canciones:v.items.filter(i=>i.id&&i.id.videoId).map(ymItem),listas:l.items.filter(i=>i.id&&i.id.playlistId).map(i=>({lista:i.id.playlistId,title:decH(i.snippet.title),channel:decH(i.snippet.channelTitle),thumb:(i.snippet.thumbnails.high||i.snippet.thumbnails.medium||{}).url}))}; });
}

/* ---------- Reproducir ---------- */
function ymTocar(lista,i){
  let l=lista.slice(); if(YM.azar){ const sel=l[i]; l.splice(i,1); for(let k=l.length-1;k>0;k--){ const j=Math.floor(Math.random()*(k+1)); [l[k],l[j]]=[l[j],l[k]]; } l.unshift(sel); i=0; }
  Y.results=l.map(x=>({...x})); Y.playRes(i); ymHist(l[i]);
}
function ymHist(s){ if(!s) return; YM.hist=[{id:s.id,title:s.title,channel:s.channel,thumb:s.thumb},...YM.hist.filter(x=>x.id!==s.id)].slice(0,40); ymG('rp-ym-hist',YM.hist); }
const ymActual=()=>Y.has()&&MU.src==='yt'&&Y.mode==='queue'?Y.results[Y.idx]:null;
const ymGusta=id=>YM.likes.some(x=>x.id===id);
function ymLike(s){ if(!s) return; YM.likes=ymGusta(s.id)?YM.likes.filter(x=>x.id!==s.id):[{id:s.id,title:s.title,channel:s.channel,thumb:s.thumb},...YM.likes].slice(0,300); ymG('rp-ym-likes',YM.likes); toast(ymGusta(s.id)?'Añadida a «Me gusta»':'Quitada de «Me gusta»'); ymPintar(); }
/* Repetir, aleatorio y radio al acabar la cola */
{ const _next=Y.next.bind(Y); Y.next=function(){
    if(this.mode==='queue'&&YM.repetir==='una'&&this.ready&&this._fin){ this._fin=false; this.player.seekTo(0,true); this.player.playVideo(); return; }
    this._fin=false;
    if(this.mode==='queue'&&this.idx>=this.results.length-1){
      if(YM.repetir==='todo'&&this.results.length){ return this.playRes(0); }
      const ya=new Set(this.results.map(x=>x.id)), radio=(YM.exitos||[]).filter(x=>!ya.has(x.id));
      if(radio.length){ this.results.push(...radio.slice(0,15)); toast('Radio: siguen los éxitos del momento'); }
    }
    const r=_next(); const c=ymActual(); if(c) ymHist(c); return r; }; }
{ const _pr=Y.playRes.bind(Y); Y.playRes=function(i){ const r=_pr(i); const c=this.results[i]; if(c) ymHist(c); return r; }; }
/* Cuando acaba una canción, YouTube llama a Y.next(): marcamos que es fin (para «repetir una») */
setInterval(()=>{ try{ if(Y.ready&&Y.player.getPlayerState&&Y.player.getPlayerState()===0) Y._fin=true; }catch(e){} },400);

/* ---------- Pintar ---------- */
document.head.insertAdjacentHTML('beforeend',`<style>
.ym{display:flex;flex-direction:column;gap:22px;padding-bottom:84px}
.ym h3{margin:0 0 10px;font:800 22px/1.2 var(--f-b,inherit);letter-spacing:-.01em}
.ym-chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}.ym-chips::-webkit-scrollbar{display:none}
.ym-chip{flex:none;background:rgba(255,255,255,.1);color:var(--fg);border-radius:10px;padding:10px 14px;font-weight:600;font-size:15px}
.ym-chip.on{background:#fff;color:#000}
.ym-fila{display:grid;grid-auto-flow:column;grid-auto-columns:168px;gap:14px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none}.ym-fila::-webkit-scrollbar{display:none}
.ym-tile{text-align:left;background:none;padding:0;color:var(--fg);display:flex;flex-direction:column;gap:7px}
.ym-tile .im{width:168px;height:168px;border-radius:8px;object-fit:cover;background:#222}
.ym-tile b{font-size:15px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ym-tile small{color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ym-rej{display:grid;grid-template-rows:repeat(4,auto);grid-auto-flow:column;grid-auto-columns:minmax(300px,1fr);gap:4px 18px;overflow-x:auto;scrollbar-width:none}
.ym-can{display:flex;align-items:center;gap:12px;background:none;padding:6px 4px;color:var(--fg);text-align:left;border-radius:8px;min-width:0}
.ym-can:hover{background:rgba(255,255,255,.05)}.ym-can.on b{color:#ff4e5c}
.ym-can img{width:54px;height:54px;border-radius:5px;object-fit:cover;flex:none;background:#222}
.ym-can .t{min-width:0;flex:1}.ym-can b{display:block;font-size:15.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ym-can small{color:var(--muted);font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.ym-gen{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.ym-gen button{height:64px;border-radius:8px;color:#fff;font-weight:800;font-size:16px;text-align:left;padding:0 14px;border-left:6px solid rgba(0,0,0,.25)}
.ym-mini{position:absolute;left:12px;right:12px;bottom:10px;height:68px;background:#212121;border-radius:12px;display:flex;align-items:center;gap:12px;padding:0 12px;z-index:4;box-shadow:0 8px 26px rgba(0,0,0,.5);overflow:hidden}
.ym-mini img{width:48px;height:48px;border-radius:5px;object-fit:cover}.ym-mini .t{flex:1;min-width:0;text-align:left;background:none;color:var(--fg);padding:0}
.ym-mini b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ym-mini small{color:var(--muted);font-size:13px}
.ym-mini .pb{position:absolute;left:0;bottom:0;height:3px;background:#ff0033}
.ym-ib{background:none;color:var(--fg);width:46px;height:46px;border-radius:50%;display:grid;place-items:center;padding:0}
.ym-ib svg{width:28px;height:28px}.ym-ib.on{color:#ff4e5c}.ym-ib.big{width:72px;height:72px;background:#fff;color:#000}.ym-ib.big svg{width:36px;height:36px}
.ym-np{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;height:100%;min-height:0}
.ym-art{position:relative;align-self:center;width:100%;max-height:100%;aspect-ratio:1;border-radius:10px;overflow:hidden;background:#111;box-shadow:0 18px 50px rgba(0,0,0,.5)}
.ym-art.vid{aspect-ratio:16/9}.ym-art img{width:100%;height:100%;object-fit:cover}
.ym-np .der{display:flex;flex-direction:column;justify-content:center;gap:16px;min-width:0}
.ym-sw{display:inline-flex;background:rgba(255,255,255,.1);border-radius:20px;padding:3px;align-self:center}.ym-sw button{background:none;color:var(--fg);border-radius:18px;padding:7px 18px;font-weight:700}.ym-sw button.on{background:rgba(255,255,255,.22)}
.ym-np h2{margin:0;font-size:28px;line-height:1.15}.ym-np .ar{color:var(--muted);font-size:17px}
.ym-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.2);position:relative;cursor:pointer}.ym-bar i{position:absolute;left:0;top:0;bottom:0;background:#fff;border-radius:3px}
.ym-tm{display:flex;justify-content:space-between;color:var(--muted);font-size:13px;margin-top:6px}
.ym-ctl{display:flex;align-items:center;justify-content:space-between;max-width:420px}
.ym-cola{overflow:auto;max-height:200px;display:flex;flex-direction:column;gap:2px}
.ym-av{background:var(--panel);border-radius:14px;padding:14px 16px;line-height:1.45}
.ym-q{display:flex;gap:8px}.ym-q input{flex:1;min-width:0;background:#212121;border:0;border-radius:24px;padding:13px 18px;color:var(--fg);font:inherit;font-size:16px}
</style>`);
const YI={play:'<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',pause:'<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  next:'<svg viewBox="0 0 24 24"><path d="M6 6l8.5 6L6 18zM16 6h2v12h-2z" fill="currentColor"/></svg>',prev:'<svg viewBox="0 0 24 24"><path d="M18 6l-8.5 6L18 18zM6 6h2v12H6z" fill="currentColor"/></svg>',
  azar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  rep:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  like:'<svg viewBox="0 0 24 24"><path d="M2 21h4V9H2zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3a1.5 1.5 0 0 0-.5-1L13.2 1 6.6 7.6A2 2 0 0 0 6 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7z" fill="currentColor"/></svg>',
  likeo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 21h4V9H2zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3a1.5 1.5 0 0 0-.5-1L13.2 1 6.6 7.6A2 2 0 0 0 6 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7z"/></svg>',
  buscar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  abajo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>'};
const ymCan=(s,i,lista)=>{ const c=ymActual(); return `<button class="ym-can ${c&&c.id===s.id?'on':''}" data-ym="tocar" data-l="${lista}" data-i="${i}"><img src="${esc(s.thumb||ymArte(s.id))}" alt="" loading="lazy"><span class="t"><b>${esc(s.title)}</b><small>${esc([s.channel,s.dur].filter(Boolean).join(' · '))}</small></span></button>`; };
const ymTileL=(l,i,lista)=>`<button class="ym-tile" data-ym="lista" data-l="${lista}" data-i="${i}"><img class="im" src="${esc(l.thumb||'')}" alt="" loading="lazy"><b>${esc(l.title)}</b><small>${esc(l.channel||'')}</small></button>`;
const ymTileS=(s,i,lista)=>`<button class="ym-tile" data-ym="tocar" data-l="${lista}" data-i="${i}"><img class="im" src="${esc(s.thumb||ymArte(s.id))}" alt="" loading="lazy"><b>${esc(s.title)}</b><small>${esc(s.channel||'')}</small></button>`;
YM.fuentes={};                                   // listas que se pueden tocar por índice
function ymAviso(){
  if(YM.err==='sinclave') return `<div class="ym-av"><b>Falta la clave.</b> Pon tu clave de Google en Ajustes (la misma de Maps) y activa «YouTube Data API v3» en Google Cloud.</div>`;
  if(YM.err==='api') return `<div class="ym-av"><b>Activa «YouTube Data API v3»</b> en console.cloud.google.com › APIs y servicios › Biblioteca, en el mismo proyecto que tu clave. Si la clave tiene restricciones de API, añádela también. Luego pulsa <b>Reintentar</b>.<div style="margin-top:10px"><button class="pill on" data-ym="reintentar">Reintentar</button></div></div>`;
  if(YM.err==='cuota') return `<div class="ym-av"><b>Se ha gastado la cuota de búsquedas de hoy.</b> Lo ya cargado sigue funcionando; mañana se renueva.</div>`;
  if(YM.err==='red') return `<div class="ym-av">Sin conexión con YouTube. <button class="pill" data-ym="reintentar">Reintentar</button></div>`;
  return '';
}
function ymPrincipal(){
  if(!YM.exitos&&!YM.cargando.exitos) ymExitos();
  const chip=YM.chip, ex=YM.exitos||[]; YM.fuentes.exitos=ex; YM.fuentes.hist=YM.hist;
  if(chip&&!YM['mix-'+chip]&&!YM.cargando['mix-'+chip]){ const q=(CHIPS.find(c=>c[0]===chip)||[])[1]; if(q) ymBuscarListas(q,'mix-'+chip); }
  if(!YM.mixes&&!YM.cargando.mixes) ymBuscarListas('éxitos España 2026 lo más escuchado','mixes');
  YM.fuentes.mix=YM['mix-'+chip]||[]; YM.fuentes.mixes=YM.mixes||[];
  return `<div class="ym-chips">${CHIPS.map(c=>`<button class="ym-chip ${chip===c[0]?'on':''}" data-ym="chip" data-c="${esc(c[0])}">${esc(c[0])}</button>`).join('')}</div>
    ${ymAviso()}
    ${chip?`<section><h3>${esc(chip)}</h3>${YM.cargando['mix-'+chip]?'<p class="muted">Cargando…</p>':`<div class="ym-fila">${(YM['mix-'+chip]||[]).map((l,i)=>ymTileL(l,i,'mix')).join('')}</div>`}</section>`:''}
    ${YM.hist.length?`<section><h3>Escuchar de nuevo</h3><div class="ym-fila">${YM.hist.slice(0,16).map((s,i)=>ymTileS(s,i,'hist')).join('')}</div></section>`:''}
    <section><h3>Éxitos del momento</h3>${ex.length?`<div class="ym-rej">${ex.slice(0,20).map((s,i)=>ymCan(s,i,'exitos')).join('')}</div>`:YM.cargando.exitos?'<p class="muted">Cargando…</p>':''}</section>
    ${(YM.mixes||[]).length?`<section><h3>Listas para ti</h3><div class="ym-fila">${YM.mixes.map((l,i)=>ymTileL(l,i,'mixes')).join('')}</div></section>`:''}`;
}
function ymExplorar(){
  if(!YM.exitos&&!YM.cargando.exitos) ymExitos();
  if(!YM.nov&&!YM.cargando.nov) ymBuscarListas('novedades música nuevos lanzamientos','nov');
  YM.fuentes.nov=YM.nov||[]; YM.fuentes.exitos=YM.exitos||[];
  return `${ymAviso()}<section><h3>Novedades</h3><div class="ym-fila">${(YM.nov||[]).map((l,i)=>ymTileL(l,i,'nov')).join('')||'<p class="muted">Cargando…</p>'}</div></section>
    <section><h3>Listas de éxitos · España</h3><div class="ym-rej">${(YM.exitos||[]).slice(0,40).map((s,i)=>`${ymCan(s,i,'exitos').replace('<span class="t">',`<span style="width:26px;text-align:center;font-weight:800;color:var(--muted)">${i+1}</span><span class="t">`)}`).join('')}</div></section>
    <section><h3>Estados de ánimo y géneros</h3><div class="ym-gen">${GENEROS.map(g=>`<button style="background:${g[1]}" data-ym="chip" data-c="${esc(g[0])}" data-ir="1">${esc(g[0])}</button>`).join('')}</div></section>`;
}
function ymBiblio(){
  YM.fuentes.likes=YM.likes; YM.fuentes.hist=YM.hist; YM.fuentes.guard=YM.listas;
  return `<section><h3>Me gusta</h3>${YM.likes.length?`<div style="margin-bottom:8px"><button class="pill on" data-ym="tocar" data-l="likes" data-i="0">Reproducir todo</button> <button class="pill" data-ym="azar-todo" data-l="likes">Aleatorio</button></div><div class="ym-rej">${YM.likes.map((s,i)=>ymCan(s,i,'likes')).join('')}</div>`:'<p class="muted">Pulsa 👍 en una canción para guardarla aquí.</p>'}</section>
    <section><h3>Listas guardadas</h3>${YM.listas.length?`<div class="ym-fila">${YM.listas.map((l,i)=>ymTileL(l,i,'guard')).join('')}</div>`:'<p class="muted">Abre una lista y pulsa «Guardar».</p>'}</section>
    <section><h3>Historial</h3>${YM.hist.length?`<div class="ym-rej">${YM.hist.slice(0,24).map((s,i)=>ymCan(s,i,'hist')).join('')}</div>`:'<p class="muted">Aún no has escuchado nada.</p>'}</section>`;
}
function ymBuscarV(){
  const r=YM.res; YM.fuentes.canc=r&&r.canciones||[]; YM.fuentes.blis=r&&r.listas||[];
  return `<div class="ym-q"><input id="ymIn" placeholder="Buscar canciones, artistas o pegar un enlace" value="${esc(YM.q)}" enterkeyhint="search" autocomplete="off"><button class="pill on" data-ym="buscar">Buscar</button></div>
    ${ymAviso()}${YM.cargando.res?'<p class="muted">Buscando…</p>':''}
    ${r&&r.canciones.length?`<section><h3>Canciones</h3><div class="ym-rej">${r.canciones.map((s,i)=>ymCan(s,i,'canc')).join('')}</div></section>`:''}
    ${r&&r.listas.length?`<section><h3>Listas</h3><div class="ym-fila">${r.listas.map((l,i)=>ymTileL(l,i,'blis')).join('')}</div></section>`:''}
    ${!r&&!YM.cargando.res&&YM.hist.length?`<section><h3>Recientes</h3><div class="ym-rej">${YM.hist.slice(0,8).map((s,i)=>ymCan(s,i,'hist')).join('')}</div></section>`:''}`;
}
function ymListaV(){
  const v=YM.vista, it=v.items; YM.fuentes.vista=it||[];
  const guardada=YM.listas.some(x=>x.lista===v.l.lista);
  return `<div style="display:flex;gap:24px;align-items:flex-end"><img src="${esc(v.l.thumb||'')}" alt="" style="width:200px;height:200px;border-radius:10px;object-fit:cover;background:#222;flex:none">
    <div style="min-width:0"><div class="muted">Lista</div><h2 style="margin:4px 0 6px;font-size:30px;line-height:1.1">${esc(v.l.title)}</h2><div class="muted">${esc(v.l.channel||'')}${it?' · '+it.length+' canciones':''}</div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="pill on" data-ym="tocar" data-l="vista" data-i="0">${YI.play.replace('<svg','<svg width="18" height="18" style="vertical-align:-3px"')} Reproducir</button><button class="pill" data-ym="azar-todo" data-l="vista">Aleatorio</button><button class="pill" data-ym="guardar-lista">${guardada?'Guardada ✓':'Guardar'}</button></div></div></div>
    <section>${it?(it.length?it.map((s,i)=>ymCan(s,i,'vista')).join(''):'<p class="muted">Esta lista está vacía o es privada.</p>'):'<p class="muted">Cargando…</p>'}</section>`;
}
function ymNP(){
  const c=ymActual(); if(!c) { YM.np=false; return ymPrincipal(); }
  const parado=(E.v||0)<=8, vid=YM.video&&parado, rest=Y.results.slice(Y.idx+1,Y.idx+25); YM.fuentes.cola=Y.results;
  return `<div class="ym-np"><div style="display:flex;flex-direction:column;gap:14px;min-height:0;justify-content:center">
      <div class="ym-sw"><button class="${YM.video?'':'on'}" data-ym="modo" data-v="0">Canción</button><button class="${YM.video?'on':''}" data-ym="modo" data-v="1">Vídeo</button></div>
      <div class="ym-art ${vid?'vid':''}">${vid?'<div id="slotApp" style="width:100%;height:100%"></div>':`<img src="${esc(ymArte(c.id,'hqdefault'))}" alt="">`}</div>
      ${YM.video&&!parado?'<p class="muted" style="text-align:center;margin:0">El vídeo se ve con el coche parado</p>':''}</div>
    <div class="der"><div style="display:flex;align-items:flex-start;gap:10px"><div style="flex:1;min-width:0"><h2>${esc(c.title)}</h2><div class="ar">${esc(c.channel||'')}</div></div>
        <button class="ym-ib ${ymGusta(c.id)?'on':''}" data-ym="like" aria-label="Me gusta">${ymGusta(c.id)?YI.like:YI.likeo}</button></div>
      <div><div class="ym-bar" id="ymBar"><i id="ymBarI"></i></div><div class="ym-tm"><span id="ymT0">0:00</span><span id="ymT1">${esc(c.dur||'')}</span></div></div>
      <div class="ym-ctl"><button class="ym-ib ${YM.azar?'on':''}" data-ym="azar" aria-label="Aleatorio">${YI.azar}</button><button class="ym-ib" data-m="prev" aria-label="Anterior">${YI.prev}</button>
        <button class="ym-ib big" data-m="toggle" aria-label="Reproducir o pausar">${Y.playing?YI.pause:YI.play}</button><button class="ym-ib" data-m="next" aria-label="Siguiente">${YI.next}</button>
        <button class="ym-ib ${YM.repetir!=='no'?'on':''}" data-ym="rep" aria-label="Repetir" style="position:relative">${YI.rep}${YM.repetir==='una'?'<b style="position:absolute;font-size:10px;top:13px;left:20px">1</b>':''}</button></div>
      <div><h3 style="font-size:17px;margin:4px 0 6px">A continuación</h3><div class="ym-cola">${rest.map((s,k)=>ymCan(s,Y.idx+1+k,'cola')).join('')||'<p class="muted">Al acabar, sigue la radio con los éxitos del momento.</p>'}</div></div></div></div>`;
}
VIEWS.youtube=()=>{
  const c=ymActual(), np=YM.np&&c;
  const tabs=[['principal','Principal'],['explorar','Explorar'],['biblioteca','Biblioteca']];
  const cab=np?`<button class="ym-ib" data-ym="np-cerrar" aria-label="Cerrar">${YI.abajo}</button>`
    :`<span style="display:flex;gap:6px;align-items:center">${tabs.map(([k,n])=>`<button class="pill ${YM.tab===k&&!YM.vista?'on':''}" data-ym="tab" data-t="${k}">${n}</button>`).join('')}<button class="ym-ib ${YM.tab==='buscar'?'on':''}" data-ym="tab" data-t="buscar" aria-label="Buscar">${YI.buscar}</button></span>`;
  const cuerpo=np?ymNP():YM.vista?`<div><button class="pill" data-ym="atras">‹ Atrás</button></div>${ymListaV()}`:YM.tab==='explorar'?ymExplorar():YM.tab==='biblioteca'?ymBiblio():YM.tab==='buscar'?ymBuscarV():ymPrincipal();
  const mini=c&&!np?`<div class="ym-mini"><img src="${esc(ymArte(c.id))}" alt=""><button class="t" data-ym="np"><b>${esc(c.title)}</b><small>${esc(c.channel||'')}</small></button>
      <button class="ym-ib ${ymGusta(c.id)?'on':''}" data-ym="like">${ymGusta(c.id)?YI.like:YI.likeo}</button><button class="ym-ib" data-m="toggle">${Y.playing?YI.pause:YI.play}</button><button class="ym-ib" data-m="next">${YI.next}</button><i class="pb" id="ymMiniB"></i></div>`:'';
  return `${appbar(np?'Reproduciendo':`<span style="display:inline-flex;align-items:center;gap:8px"><span style="width:30px;height:30px;display:inline-block">${ICONS.youtube}</span>Music</span>`,cab)}
    <div class="abody" ${np?'style="overflow:hidden"':''}><div class="ym">${cuerpo}</div></div>${mini}`;
};
function ymPintar(){
  if(S.view!=='youtube') return;
  const f=document.activeElement&&document.activeElement.id==='ymIn', val=$('ymIn')?$('ymIn').value:null, ab=document.querySelector('#appview .abody'), sc=ab?ab.scrollTop:0;
  const filas=[...document.querySelectorAll('.ym-fila,.ym-rej')].map(x=>x.scrollLeft);
  renderApp();
  if(val!=null&&$('ymIn')){ $('ymIn').value=val; if(f) $('ymIn').focus(); }
  const ab2=document.querySelector('#appview .abody'); if(ab2) ab2.scrollTop=sc;
  document.querySelectorAll('.ym-fila,.ym-rej').forEach((x,i)=>{ if(filas[i]) x.scrollLeft=filas[i]; });
  setTimeout(placeYT,30); ymProgreso();
}
/* Progreso sin repintar todo */
function ymProgreso(){
  try{ if(!Y.ready||!ymActual()) return; const t=Y.player.getCurrentTime()||0, d=Y.player.getDuration()||0, p=d?Math.min(100,t/d*100):0;
    const fm=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
    if($('ymBarI')) $('ymBarI').style.width=p+'%'; if($('ymMiniB')) $('ymMiniB').style.width=p+'%';
    if($('ymT0')) $('ymT0').textContent=fm(t); if($('ymT1')&&d) $('ymT1').textContent=fm(d); }catch(e){}
}
setInterval(()=>{ if(S.view==='youtube') ymProgreso(); },500);
/* El reproductor: con «Vídeo» y parado, en la portada; si no, tapado (sigue el sonido) */
window.ytSoloSonido=()=>S.view==='youtube'&&!$('slotApp')&&Y.has();      // modo Canción en YT Music: solo sonido

/* ---------- Toques ---------- */
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-ym]'); if(!el) return; e.stopPropagation(); const a=el.dataset.ym;
  if(a==='tab'){ YM.tab=el.dataset.t; YM.vista=null; YM.np=false; if(YM.tab!=='buscar') LS.set('rp-ym-tab',YM.tab); ymPintar(); if(YM.tab==='buscar') setTimeout(()=>$('ymIn')&&$('ymIn').focus(),60); return; }
  if(a==='chip'){ const c=el.dataset.c; YM.chip=YM.chip===c&&!el.dataset.ir?null:c; YM.tab='principal'; YM.vista=null; ymPintar(); return; }
  if(a==='lista'){ const l=(YM.fuentes[el.dataset.l]||[])[+el.dataset.i]; if(l) ymAbrirLista(l); return; }
  if(a==='tocar'){ const l=YM.fuentes[el.dataset.l]||[]; const i=+el.dataset.i;
    if(el.dataset.l==='cola'){ Y.playRes(i); return; } if(l[i]) ymTocar(l,i); return; }
  if(a==='azar-todo'){ const l=YM.fuentes[el.dataset.l]||[]; if(!l.length) return; YM.azar=true; LS.set('rp-ym-azar','1'); ymTocar(l,Math.floor(Math.random()*l.length)); return; }
  if(a==='buscar') return ymBuscar($('ymIn')&&$('ymIn').value);
  if(a==='reintentar'){ Object.keys(localStorage).filter(x=>x.startsWith('rp-ym-c-')).forEach(x=>localStorage.removeItem(x)); ['exitos','mixes','nov','res'].forEach(k=>YM[k]=null); YM.err=''; ymPintar(); return; }
  if(a==='atras'){ YM.vista=null; ymPintar(); return; }
  if(a==='guardar-lista'){ const l=YM.vista&&YM.vista.l; if(!l) return; YM.listas=YM.listas.some(x=>x.lista===l.lista)?YM.listas.filter(x=>x.lista!==l.lista):[l,...YM.listas]; ymG('rp-ym-listas',YM.listas); ymPintar(); return; }
  if(a==='np'){ YM.np=true; ymPintar(); return; }
  if(a==='np-cerrar'){ YM.np=false; ymPintar(); return; }
  if(a==='like') return ymLike(ymActual());
  if(a==='azar'){ YM.azar=!YM.azar; LS.set('rp-ym-azar',YM.azar?'1':'0'); if(YM.azar&&Y.mode==='queue'){ const r=Y.results.slice(Y.idx+1); for(let k=r.length-1;k>0;k--){ const j=Math.floor(Math.random()*(k+1)); [r[k],r[j]]=[r[j],r[k]]; } Y.results.splice(Y.idx+1,r.length,...r); } ymPintar(); return; }
  if(a==='rep'){ YM.repetir={no:'todo',todo:'una',una:'no'}[YM.repetir]; LS.set('rp-ym-rep',YM.repetir); toast({no:'Repetir: no',todo:'Repetir: todo',una:'Repetir: una canción'}[YM.repetir]); ymPintar(); return; }
  if(a==='modo'){ YM.video=el.dataset.v==='1'; LS.set('rp-ym-video',YM.video?'1':'0'); ymPintar(); return; }
},true);
document.addEventListener('click',e=>{ const b=e.target.closest('#ymBar'); if(!b||!Y.ready) return; const r=b.getBoundingClientRect(), d=Y.player.getDuration()||0; if(d) Y.player.seekTo((e.clientX-r.left)/r.width*d,true); });
document.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target&&e.target.id==='ymIn'){ e.preventDefault(); ymBuscar(e.target.value); } });
/* Se repinta cuando cambia lo que suena, y al pasar de parado a en marcha */
{ const _rm=refreshMusic; refreshMusic=function(...a){ const r=_rm(...a); if(S.view==='youtube'&&!(document.activeElement&&document.activeElement.id==='ymIn')) ymPintar(); return r; }; }
let ymMarcha=null; setInterval(()=>{ const m=(E.v||0)>8; if(m!==ymMarcha){ ymMarcha=m; if(S.view==='youtube'&&YM.np) ymPintar(); } },1500);
/* Siri: «pon en YouTube Music …» / «pon música de …» */
if(typeof siriHandle==='function'){ const _sYT=siriHandle; siriHandle=function(t,...a){ const m=String(t||'').match(/^(?:pon|busca|abre)\s+(?:en\s+)?(?:youtube(?:\s+music)?|yt music)\s*(.*)$/i);
  if(m){ setView('youtube'); if(m[1]) ymBuscar(m[1]); return; } return _sYT(t,...a); }; }
