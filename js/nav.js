/* =====================================================================
   Radar Play · Navegación tipo Google Maps
   Rutas con tráfico (Routes API), alternativas, paradas, búsqueda de
   sitios (Places API New, opcional), indicaciones por voz, límites de
   velocidad estimados, radares y avisos, recálculo y ruta más rápida.
   ===================================================================== */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

const NAV_DEF={home:'',work:'',alerts:true,speedWarn:true,simX:2,highways:false,tolls:false,traffic:false,reports:[]};
const NAV={
  setts:Object.assign({},NAV_DEF,(()=>{try{return JSON.parse(LS.get('rp-nav')||'{}')}catch(e){return{}}})()),
  recent:(()=>{ try{ const r=JSON.parse(LS.get('rp-recientes2')||'null'); if(Array.isArray(r)) return r; }catch(e){}
    try{ return (JSON.parse(LS.get('rp-recientes')||'[]')).map(t=>({name:t,text:t})); }catch(e){ return []; } })(),
  active:false,r:null,alts:[],sel:0,dest:null,stops:[],legIdx:0,along:0,stepIdx:0,spoken:{},alerts:[],
  ov:[],altOv:[],alertMk:[],repMk:[],trafOv:[],results:[],targetKmh:null,rerouting:false,bannerActs:[],bannerTimer:0,
  overWarned:false,fasterTimer:0,trafficLayer:null,lastTrim:0,lastEta:0,searchMode:'dest',zoomLock:0,lastZoom:0
};
const saveNav=()=>LS.set('rp-nav',JSON.stringify(NAV.setts));
const saveRecents=()=>LS.set('rp-recientes2',JSON.stringify(NAV.recent.slice(0,8)));

/* ---------- Formatos ---------- */
const fmtKm=m=>{ m=Math.max(0,m||0); if(m>=10000) return Math.round(m/1000)+' km'; if(m>=1000) return (m/1000).toFixed(1).replace('.',',')+' km'; if(m>=300) return Math.round(m/50)*50+' m'; return Math.max(10,Math.round(m/10)*10)+' m'; };
const fmtMin=s=>{ s=Math.max(0,s||0); if(s>=3600) return Math.floor(s/3600)+' h '+Math.round(s%3600/60)+' min'; return Math.max(1,Math.round(s/60))+' min'; };
const fmtHM=d=>two(d.getHours())+':'+two(d.getMinutes());
const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
const sayDist=m=>{ if(m>=1000){ const v=(Math.round(m/100)/10).toString().replace('.',','); return v==='1'?'1 kilómetro':v+' kilómetros'; } return (m>=300?Math.round(m/50)*50:Math.max(10,Math.round(m/10)*10))+' metros'; };
const strip=h=>{const d=document.createElement('div');d.innerHTML=h;return d.textContent;};

/* ---------- Voz en cola (no corta la frase anterior) ---------- */
function sayQ(text){
  if(!S.voice||!text||!('speechSynthesis' in window)) return;
  const u=new SpeechSynthesisUtterance(text); u.lang='es-ES'; u.rate=1.03;
  const v=speechSynthesis.getVoices().find(v=>v.lang&&v.lang.startsWith('es')); if(v) u.voice=v;
  u.onstart=()=>MU.duck(true);
  u.onend=u.onerror=()=>{ setTimeout(()=>{ if(!speechSynthesis.speaking&&!speechSynthesis.pending) MU.duck(false); },150); };
  speechSynthesis.speak(u);
}
let actx=null;
function beep(f=880,d=.12,n=1){ try{ actx=actx||new (window.AudioContext||window.webkitAudioContext)(); for(let i=0;i<n;i++){ const o=actx.createOscillator(), g=actx.createGain(), t=actx.currentTime+i*(d+.08);
  o.frequency.value=f; o.type='sine'; g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.25,t+.01); g.gain.exponentialRampToValueAtTime(.0001,t+d); o.connect(g).connect(actx.destination); o.start(t); o.stop(t+d+.02); } }catch(e){} }

/* ---------- Maniobras ---------- */
const MAN={
  TURN_LEFT:['gira a la izquierda','l'],TURN_RIGHT:['gira a la derecha','r'],
  TURN_SLIGHT_LEFT:['gira ligeramente a la izquierda','sl'],TURN_SLIGHT_RIGHT:['gira ligeramente a la derecha','sr'],
  TURN_SHARP_LEFT:['gira bruscamente a la izquierda','hl'],TURN_SHARP_RIGHT:['gira bruscamente a la derecha','hr'],
  UTURN_LEFT:['cambia de sentido','ul'],UTURN_RIGHT:['cambia de sentido','ur'],
  STRAIGHT:['sigue recto','s'],NAME_CHANGE:['continúa recto','s'],DEPART:['sigue la ruta','s'],
  RAMP_LEFT:['toma la salida de la izquierda','rl'],RAMP_RIGHT:['toma la salida de la derecha','rr'],
  MERGE:['incorpórate','m'],FORK_LEFT:['mantente a la izquierda','fl'],FORK_RIGHT:['mantente a la derecha','fr'],
  ROUNDABOUT_LEFT:['en la rotonda','ro'],ROUNDABOUT_RIGHT:['en la rotonda','ro'],
  FERRY:['toma el ferri','s'],FERRY_TRAIN:['toma el tren','s'],DESTINATION:['llegarás a tu destino','d'],DEST:['llegarás a tu destino','d'],STOP:['llegarás a tu parada','d']
};
const MANI={
  r:'<path d="M16 42V24a6 6 0 0 1 6-6h14"/><path d="M30 12l6 6-6 6"/>',
  l:'<path d="M32 42V24a6 6 0 0 0-6-6H12"/><path d="M18 12l-6 6 6 6"/>',
  sr:'<path d="M18 42V28L32 14"/><path d="M23 13h10v10"/>',
  sl:'<path d="M30 42V28L16 14"/><path d="M25 13H15v10"/>',
  hr:'<path d="M16 42V14l18 18"/><path d="M34 22v10H24"/>',
  hl:'<path d="M32 42V14L14 32"/><path d="M14 22v10h10"/>',
  ul:'<path d="M30 42V20a8 8 0 0 0-16 0v8"/><path d="M8 23l6 6 6-6"/>',
  ur:'<path d="M18 42V20a8 8 0 0 1 16 0v8"/><path d="M28 23l6 6 6-6"/>',
  s:'<path d="M24 42V8"/><path d="M16 16l8-8 8 8"/>',
  rr:'<path d="M18 42V8" opacity=".35"/><path d="M18 30l14-14"/><path d="M23 15h10v10"/>',
  rl:'<path d="M30 42V8" opacity=".35"/><path d="M30 30L16 16"/><path d="M25 15H15v10"/>',
  m:'<path d="M14 42V30l10-10V8"/><path d="M34 42V30l-10-10" opacity=".45"/><path d="M17 15l7-7 7 7"/>',
  ro:'<circle cx="24" cy="22" r="8"/><path d="M24 42V30"/><path d="M30 16l7-7"/><path d="M30 9h7v7"/>',
  d:'<path d="M24 43s12-10.5 12-20a12 12 0 1 0-24 0c0 9.5 12 20 12 20z"/><circle cx="24" cy="23" r="4"/>',
};
MANI.fr=MANI.rr; MANI.fl=MANI.rl;
const manCode=m=>(MAN[m]||[0,'s'])[1];
const manSvg=(c,exit)=>`<svg viewBox="0 0 48 48" class="mani">${MANI[c]||MANI.s}${c==='ro'&&exit?`<text x="24" y="25.6" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor" stroke="none">${exit}</text>`:''}</svg>`;
const normMan=m=>String(m||'').toUpperCase().replace(/[-\s]/g,'_');
const ORD=['','primera','segunda','tercera','cuarta','quinta','sexta','séptima','octava'];
function exitNum(t){ const m=/(\d+)\s*\.?\s*[ªaº°]?\s*salida/i.exec(t||''); if(m) return +m[1]; const w=/(primera|segunda|tercera|cuarta|quinta|sexta)\s+salida/i.exec(t||''); return w?ORD.indexOf(w[1].toLowerCase()):0; }
function toward(t){ const m=/\b(?:hacia|por|en dirección a)\s+([^.,;]+)/i.exec(t||''); return m?m[1].trim():''; }
function phraseFor(st){
  if(st.man&&st.man.startsWith('ROUNDABOUT')) return st.exit?`en la rotonda, toma la ${ORD[st.exit]||st.exit+'ª'} salida`:'en la rotonda, sigue las indicaciones';
  return (MAN[st.man]||['continúa'])[0];
}

/* ---------- Avisos (tipos, iconos) ---------- */
const AL={radar:['Radar fijo','#2f7fd6'],tramo:['Radar de tramo','#2f7fd6'],atasco:['Retención','#e5322d'],accidente:['Accidente','#e5322d'],
  obras:['Obras','#f39c12'],policia:['Control policial','#3b5bdb'],parado:['Vehículo detenido','#f39c12'],peligro:['Peligro en la vía','#f39c12'],cortado:['Carril cortado','#f39c12']};
const ALG={
  radar:'<rect x="4" y="8" width="16" height="10" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M8 8l1-2h6l1 2"/>',
  tramo:'<rect x="4" y="7" width="16" height="9" rx="2"/><circle cx="12" cy="11.5" r="2.6"/><path d="M3 20h18M7 20v-2M17 20v-2"/>',
  atasco:'<rect x="4" y="10" width="16" height="7" rx="2"/><path d="M7 10l2-4h6l2 4M7 20v-3M17 20v-3"/>',
  accidente:'<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.4"/>',
  obras:'<path d="M12 3l6 18H6z"/><path d="M8 15h8M10 9h4"/>',
  policia:'<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  peligro:'<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.4"/>',
  parado:'<rect x="4" y="10" width="16" height="7" rx="2"/><path d="M7 10l2-4h6l2 4M12 2v2"/>',
  cortado:'<path d="M6 3v18M18 3v18"/><path d="M9 9l6 6M15 9l-6 6"/>',
};
const alertSvg=(k,sz=34)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 34 34"><circle cx="17" cy="17" r="15" fill="${(AL[k]||AL.peligro)[1]}" stroke="#fff" stroke-width="2.5"/><g transform="translate(5 5)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ALG[k]||ALG.peligro}</g></svg>`;
const svgUrl=s=>'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(s);
const alertIcon=k=>({url:svgUrl(alertSvg(k,34)),scaledSize:new G.Size(30,30),anchor:new G.Point(15,15)});
function pinIcon(c,t=''){ const s=`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40"><path d="M15 39s13-12.4 13-23A13 13 0 0 0 2 16c0 10.6 13 23 13 23z" fill="${c}" stroke="#fff" stroke-width="2.5"/>${t?`<text x="15" y="20.5" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#fff">${t}</text>`:'<circle cx="15" cy="16" r="5" fill="#fff"/>'}</svg>`;
  return {url:svgUrl(s),scaledSize:new G.Size(30,40),anchor:new G.Point(15,39)}; }
const BLANK=svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
const TCOL={SLOW:'#f39c12',TRAFFIC_JAM:'#e5322d'};
const CONFIRMABLE=['accidente','obras','policia','parado','peligro','cortado','radarm'];

/* ---------- Geometría sobre la ruta ---------- */
const SPH=()=>G.geometry.spherical;
function idxAt(r,d){ let lo=0,hi=r.cum.length-1; while(lo<hi-1){ const m=(lo+hi)>>1; if(r.cum[m]<=d) lo=m; else hi=m; } return lo; }
function pointAt(r,d){ d=Math.max(0,Math.min(r.len,d)); const i=idxAt(r,d), j=Math.min(i+1,r.pts.length-1); const seg=(r.cum[j]-r.cum[i])||1; return SPH().interpolate(r.pts[i],r.pts[j],Math.min(1,(d-r.cum[i])/seg)); }
function stepAt(r,d){ for(let i=0;i<r.steps.length;i++) if(d<r.steps[i].d1) return r.steps[i]; return r.steps[r.steps.length-1]; }
function trafficAt(r,d){ const t=r.traffic.find(t=>d>=t.d0&&d<t.d1); return t?t.speed:'NORMAL'; }
function project(r,p,from=0,span=1e9){
  const lat0=p.lat, c=Math.cos(lat0*Math.PI/180), X=q=>[(q.lng()-p.lng)*c*111320,(q.lat()-lat0)*110540];
  let best={off:1e9,d:0,i:from}; const a=Math.max(0,from-5), b=Math.min(r.pts.length-2,from+span);
  for(let i=a;i<=b;i++){ const [x1,y1]=X(r.pts[i]),[x2,y2]=X(r.pts[i+1]); const dx=x2-x1,dy=y2-y1,L=dx*dx+dy*dy; let t=L?-(x1*dx+y1*dy)/L:0; t=Math.max(0,Math.min(1,t));
    const off=Math.hypot(x1+t*dx,y1+t*dy); if(off<best.off) best={off,d:r.cum[i]+t*(r.cum[i+1]-r.cum[i]),i}; }
  return best;
}

/* ---------- Pedir rutas a Google ---------- */
const destParam=()=>NAV.dest.loc||NAV.dest.text||NAV.dest.name;
const destText=()=>NAV.dest?(NAV.dest.loc?NAV.dest.loc.lat+','+NAV.dest.loc.lng:(NAV.dest.text||NAV.dest.name)):'';
async function computeRoutes(origin,dest,{alts=true,stops=[]}={}){
  const {Route}=await G.importLibrary('routes');
  const inter=stops.map(s=>s.loc||s.text||s.name);
  const base={origin,destination:dest,travelMode:'DRIVING',language:'es',region:'es'};
  if(inter.length) base.intermediates=inter;
  const mods={avoidHighways:!!NAV.setts.highways,avoidTolls:!!NAV.setts.tolls};
  const tries=[
    {...base,routingPreference:'TRAFFIC_AWARE',computeAlternativeRoutes:alts&&!inter.length,routeModifiers:mods,extraComputations:['TRAFFIC_ON_POLYLINE'],
      fields:['path','legs','distanceMeters','durationMillis','staticDurationMillis','speedPaths','routeLabels','warnings']},
    {...base,routingPreference:'TRAFFIC_AWARE',computeAlternativeRoutes:alts&&!inter.length,routeModifiers:mods,fields:['path','legs','distanceMeters','durationMillis','staticDurationMillis']},
    {...base,computeAlternativeRoutes:alts&&!inter.length,fields:['path','legs','distanceMeters','durationMillis']},
  ];
  let err=null;
  for(const req of tries){
    try{ const {routes}=await Route.computeRoutes(req); return (routes||[]).map(processRoute).filter(r=>r.pts.length>1); }
    catch(e){ err=e; console.warn('computeRoutes',e); }
  }
  throw err||new Error('Sin respuesta de Google');
}
function processRoute(R){
  const sp=SPH(), pts=(R.path||[]).map(toLL).filter(Boolean);
  const cum=[0]; for(let i=1;i<pts.length;i++) cum.push(cum[i-1]+sp.computeDistanceBetween(pts[i-1],pts[i]));
  const len=cum[cum.length-1]||R.distanceMeters||1;
  const steps=[], legEnds=[]; let d=0, ssum=0;
  (R.legs||[]).forEach(leg=>{ (leg.steps||[]).forEach(st=>{ const sl=st.distanceMeters||0, ss=(st.staticDurationMillis||0)/1000, txt=String(st.instructions||'').trim();
      steps.push({text:txt.includes('<')?strip(txt):txt,man:normMan(st.maneuver),d0:d,d1:d+sl,ss,exit:exitNum(txt)}); d+=sl; ssum+=ss; }); legEnds.push(d); });
  if(!steps.length){ steps.push({text:'',man:'DEPART',d0:0,d1:len,ss:0,exit:0}); d=len; legEnds.length=0; legEnds.push(len); }
  const k=d?len/d:1; steps.forEach(s=>{ s.d0*=k; s.d1*=k; }); for(let i=0;i<legEnds.length;i++) legEnds[i]*=k;
  const secs=(R.durationMillis||0)/1000||ssum||len/12, stat=(R.staticDurationMillis||0)/1000||ssum||secs, tk=ssum?secs/ssum:1;
  steps.forEach(s=>{ const L=s.d1-s.d0, v=s.ss?L/s.ss*3.6:45; s.limit=v>=85?120:v>=62?90:v>=36?50:30; s.sec=s.ss?s.ss*tk:L/(s.limit/3.6*.8); });
  const traffic=[]; let td=0;
  (R.speedPaths||[]).forEach(p=>{ const pp=(p.path||[]).map(toLL).filter(Boolean), l=pp.length>1?sp.computeLength(pp):0;
    traffic.push({d0:td,d1:td+l,speed:String(p.speed||'NORMAL').toUpperCase(),pts:pp}); td+=l; });
  if(td){ const kt=len/td; traffic.forEach(t=>{ t.d0*=kt; t.d1*=kt; }); }
  return {pts,cum,len,secs,stat,steps,legEnds,traffic,labels:(R.routeLabels||[]).map(String),warnings:(R.warnings||[]).map(String)};
}

/* ---------- Avisos sobre la ruta ---------- */
function genAlerts(r){
  const A=[], rnd=mulberry32(Math.round(r.len)*7+r.pts.length);
  // Retenciones reales (tráfico de Google)
  r.traffic.forEach(t=>{ const L=t.d1-t.d0; if(t.speed==='TRAFFIC_JAM'||(t.speed==='SLOW'&&L>400)){
    const lim=stepAt(r,t.d0).limit, slow=t.speed==='TRAFFIC_JAM'?10:lim*.45, delay=Math.max(0,L/1000/slow*3600-L/1000/lim*3600);
    A.push({type:'atasco',d:t.d0,d1:t.d1,delay,real:true}); } });
  if(NAV.setts.alerts){
    // Radares fijos (simulados) en tramos rápidos
    for(let d=1500+rnd()*2500; d<r.len-400;){ const lim=stepAt(r,d).limit;
      if(lim>=50&&rnd()<(lim>=90?.7:.35)) A.push({type:'radar',d,limit:lim,sim:true});
      d+=lim>=90?5000+rnd()*7000:2000+rnd()*3000; }
    // Un radar de tramo en autovía larga
    const fast=r.steps.find(s=>s.limit>=120&&s.d1-s.d0>7000);
    if(fast&&rnd()<.7){ const d0=fast.d0+1500+rnd()*1500, d1=Math.min(fast.d1-800,d0+3000+rnd()*3000); if(d1>d0+1500) A.push({type:'tramo',d:d0,d1,limit:fast.limit,sim:true,t:0}); }
    // Incidencias notificadas por otros conductores (simuladas)
    const n=r.len>4000?(rnd()<.55?2:1):(rnd()<.4?1:0), kinds=['obras','accidente','policia','parado','peligro'];
    for(let i=0;i<n;i++){ const d=800+rnd()*Math.max(200,r.len-1600); A.push({type:kinds[Math.floor(rnd()*kinds.length)],d,sim:true}); }
  }
  // Tus avisos guardados que caen en esta ruta
  NAV.setts.reports.forEach(rep=>{ const pr=project(r,{lat:rep.lat,lng:rep.lng}); if(pr.off<35&&pr.d>50) A.push({type:rep.k,d:pr.d,limit:rep.k==='radarm'?stepAt(r,pr.d).limit:undefined,user:true,rid:rep.rid}); });
  // Quitar radares demasiado juntos a otros avisos
  A.sort((a,b)=>a.d-b.d);
  return A.filter((x,i)=>!(x.type==='radar'&&x.sim&&A.some((y,j)=>j!==i&&y.type!=='radar'&&Math.abs(y.d-x.d)<300)));
}
function alertPhrase(x,rel){
  const dd=sayDist(Math.max(50,rel));
  switch(x.type){
    case 'radar': return `Radar a ${dd}. Límite ${x.limit}.`;
    case 'tramo': return `Radar de tramo en ${dd}. Límite ${x.limit}.`;
    case 'atasco': return `Retención en ${dd}. ${x.delay>=60?'Unos '+Math.round(x.delay/60)+' minutos de retraso.':'Circulación lenta.'}`;
    case 'accidente': return `Accidente notificado a ${dd}.`;
    case 'obras': return `Obras a ${dd}.`;
    case 'policia': return `Control policial notificado a ${dd}.`;
    case 'parado': return `Vehículo detenido a ${dd}.`;
    case 'cortado': return `Carril cortado a ${dd}.`;
    case 'radarm': return `Radar móvil notificado a ${dd}. Límite ${x.limit}.`;
    default: return `Peligro en la vía a ${dd}.`;
  }
}
const warnDist=x=>x.type==='radar'||x.type==='radarm'?(x.limit>=90?1000:500):x.type==='tramo'?1000:x.type==='atasco'?2000:900;

/* ---------- Dibujo en el mapa ---------- */
function clearOv(arr){ arr.forEach(o=>o&&o.setMap&&o.setMap(null)); arr.length=0; }
function drawActive(){
  clearOv(NAV.ov); NAV.trafOv=[]; const r=NAV.r, col=THEMES[S.theme].route;
  NAV.mainShadow=new G.Polyline({map,path:r.pts,strokeColor:'#000',strokeOpacity:.45,strokeWeight:14,zIndex:1});
  NAV.mainLine=new G.Polyline({map,path:r.pts,strokeColor:col,strokeWeight:8,zIndex:2});
  NAV.radarLine=new G.Polyline({map:radar,path:r.pts,strokeColor:col,strokeWeight:7});
  NAV.ov.push(NAV.mainShadow,NAV.mainLine,NAV.radarLine);
  r.traffic.filter(t=>t.speed!=='NORMAL'&&t.pts.length>1).forEach(t=>{
    const a=new G.Polyline({map,path:t.pts,strokeColor:TCOL[t.speed]||TCOL.SLOW,strokeWeight:8,zIndex:3}), b=new G.Polyline({map:radar,path:t.pts,strokeColor:TCOL[t.speed]||TCOL.SLOW,strokeWeight:7});
    a.seg=b.seg=t; NAV.trafOv.push(a,b); NAV.ov.push(a,b); });
  NAV.ov.push(new G.Marker({map,position:r.pts[r.pts.length-1],icon:pinIcon('#e5322d'),zIndex:6}));
  r.legEnds.slice(0,-1).forEach((d,i)=>NAV.ov.push(new G.Marker({map,position:pointAt(r,d),icon:pinIcon('#f39c12',String(i+1)),zIndex:6})));
  clearOv(NAV.alertMk);
  NAV.alerts.forEach(x=>{ if(x.type==='atasco'||x.user) return; NAV.alertMk.push(new G.Marker({map,position:pointAt(r,x.d),icon:alertIcon(x.type),zIndex:7,title:AL[x.type][0]})); });
}
function trimRoute(){
  const r=NAV.r; if(!r||!NAV.mainLine) return; const i=idxAt(r,NAV.along);
  const rest=[pointAt(r,NAV.along),...r.pts.slice(i+1)];
  NAV.mainLine.setPath(rest); NAV.mainShadow.setPath(rest); NAV.radarLine.setPath(rest);
  NAV.trafOv.forEach(p=>{ if(p.seg.d1<NAV.along&&p.getMap()) p.setMap(null); });
}
function drawAlts(){
  clearOv(NAV.altOv);
  NAV.alts.forEach((r,i)=>{ const sel=i===NAV.sel;
    NAV.altOv.push(new G.Polyline({map,path:r.pts,strokeColor:'#000',strokeOpacity:sel?.45:.25,strokeWeight:sel?14:10,zIndex:sel?3:1}));
    const ln=new G.Polyline({map,path:r.pts,strokeColor:sel?THEMES[S.theme].route:'#9aa3ad',strokeOpacity:sel?1:.85,strokeWeight:sel?8:6,zIndex:sel?4:2});
    ln.addListener('click',()=>selAlt(i)); NAV.altOv.push(ln);
    if(sel) r.traffic.filter(t=>t.speed!=='NORMAL'&&t.pts.length>1).forEach(t=>NAV.altOv.push(new G.Polyline({map,path:t.pts,strokeColor:TCOL[t.speed]||TCOL.SLOW,strokeWeight:8,zIndex:5})));
    const mk=new G.Marker({map,position:pointAt(r,r.len*(.42+.14*i)),zIndex:sel?11:10,
      icon:{url:BLANK,size:new G.Size(2,2),labelOrigin:new G.Point(1,1)},label:{text:fmtMin(r.secs),className:'rlab'+(sel?' on':''),color:'#ffffff',fontSize:'14px',fontWeight:'800'}});
    mk.addListener('click',()=>selAlt(i)); NAV.altOv.push(mk);
  });
  const r0=NAV.alts[0]; if(r0) NAV.altOv.push(new G.Marker({map,position:r0.pts[r0.pts.length-1],icon:pinIcon('#e5322d'),zIndex:12}));
}
function selAlt(i){ NAV.sel=i; drawAlts(); renderPreview(); }
function fitRoute(rs){ const b=new G.LatLngBounds(); rs.forEach(r=>r.pts.forEach(p=>b.extend(p))); map.fitBounds(b,{top:70,bottom:70,left:420,right:110}); S.follow=false; }
function drawReportMarkers(){ if(!map) return; clearOv(NAV.repMk);
  NAV.setts.reports.forEach(rep=>NAV.repMk.push(new G.Marker({map,position:{lat:rep.lat,lng:rep.lng},icon:alertIcon(rep.k),zIndex:7,title:'Tu aviso: '+(AL[rep.k]||AL.peligro)[0]}))); }

/* ---------- Seguir al coche con la cámara ---------- */
function followCam(){
  const p=S.pos; if(!p||!map) return;
  if(Date.now()>NAV.zoomLock){ const z=E.v>85?15:E.v>50?16:17; if(z!==NAV.lastZoom){ map.setZoom(z); NAV.lastZoom=z; } }
  const zoom=map.getZoom()||17, h=$('map').clientHeight||600, mpp=156543.03392*Math.cos(p.lat*Math.PI/180)/Math.pow(2,zoom);
  map.setCenter(SPH().computeOffset(new G.LatLng(p.lat,p.lng),h*.22*mpp,S.heading));
}

/* ---------- Búsqueda de sitios ---------- */
const CATS=[['Gasolineras','gasolinera'],['Aparcamiento','aparcamiento'],['Restaurantes','restaurante'],['Cafeterías','cafetería'],['Supermercados','supermercado'],['Farmacias','farmacia'],['Talleres','taller mecánico'],['Cargadores','cargador coche eléctrico']];
async function placesSearch(q,near){
  const {Place}=await G.importLibrary('places');
  const req={textQuery:q,fields:['displayName','formattedAddress','location','rating'],maxResultCount:10,language:'es',region:'es'};
  const c=near||S.pos; if(c) req.locationBias={center:c,radius:near?6000:20000};
  const {places}=await Place.searchByText(req);
  return (places||[]).map(p=>({name:p.displayName||q,address:p.formattedAddress||'',loc:p.location?(p.location.toJSON?p.location.toJSON():p.location):null,rating:p.rating||0}));
}
const pinSmall=`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
const micSvg=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
function destScreen(mode='dest',q=''){
  if(!map){ toast('El mapa aún no ha cargado'); return; }
  NAV.searchMode=mode;
  const favs=[NAV.setts.home&&['Casa',NAV.setts.home],NAV.setts.work&&['Trabajo',NAV.setts.work]].filter(Boolean);
  overlay(`<h2>${mode==='stop'?'Añadir parada':'Buscar'}</h2>
    <div class="field"><input id="dIn" placeholder="${mode==='stop'?'Gasolinera, café, dirección…':'Dirección, sitio o pueblo'}" value="${esc(q)}"><button class="pill on" id="dOk">Buscar</button><button class="pill" data-siri="1" aria-label="Dictar a Siri">${micSvg}</button></div>
    <div class="chips" style="margin-top:12px">${favs.map(f=>`<button class="pill on" data-nav="fav" data-q="${esc(f[1])}" data-n="${f[0]}">${f[0]}</button>`).join('')}${CATS.map(c=>`<button class="pill" data-nav="cat" data-q="${esc(c[1])}">${c[0]}</button>`).join('')}</div>
    <div id="dRes" class="list">${recentsHTML()}</div>
    <div style="margin-top:14px;text-align:right"><button class="pill" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv; const go=()=>doSearch($('dIn').value); $('dOk').onclick=go; $('dIn').onkeydown=e=>{ if(e.key==='Enter') go(); }; $('dIn').focus();
  if(q) doSearch(q);
}
function recentsHTML(){ if(!NAV.recent.length) return '<p class="muted">Aún no hay destinos recientes.</p>';
  return '<p class="muted" style="margin:10px 0 4px">Recientes</p>'+NAV.recent.map((r,i)=>`<button class="row" data-nav="recent" data-i="${i}"><span class="av">${pinSmall}</span><span class="t"><b>${esc(r.name)}</b><small>${esc(r.address||r.text||'')}</small></span></button>`).join(''); }
async function doSearch(q,isCat){
  q=(q||'').trim(); if(!q) return; if(!$('dRes')) destScreen(NAV.searchMode);
  $('dRes').innerHTML='<p class="muted">Buscando…</p>';
  const near=NAV.searchMode==='stop'&&NAV.active&&NAV.r?pointAt(NAV.r,Math.min(NAV.r.len,NAV.along+3000)).toJSON():null;
  let res=null; try{ res=await placesSearch(q,near); }catch(e){ console.warn('Places',e); }
  const box=$('dRes'); if(!box) return;
  if(res===null){
    if(isCat){ box.innerHTML=`<p class="note">Para buscar <b>${esc(q)}</b> cerca necesito <b>Places API (New)</b>. Actívala en Google Cloud › Biblioteca, en tu mismo proyecto, y vuelve a probar.</p>`; return; }
    pick({name:q,text:q}); return;
  }
  NAV.results=res;
  box.innerHTML=res.length?res.map((p,i)=>`<button class="row" data-nav="res" data-i="${i}"><span class="av">${pinSmall}</span><span class="t"><b>${esc(p.name)}</b><small>${esc(p.address)}</small></span><span class="muted num" style="white-space:nowrap">${p.loc&&S.pos?fmtKm(SPH().computeDistanceBetween(S.pos,p.loc)):''}${p.rating?' · ★ '+p.rating.toFixed(1).replace('.',','):''}</span></button>`).join('')
    :`<p class="muted">No he encontrado «${esc(q)}».</p><button class="pill" data-nav="raw" data-q="${esc(q)}">Ir igualmente a «${esc(q)}»</button>`;
}
function pick(place){
  closeOv();
  if(NAV.searchMode==='stop'){ NAV.searchMode='dest'; if(NAV.active) addStop(place); else if(NAV.dest){ NAV.stops.push(place); previewTo(NAV.dest,{keepStops:true}); } else previewTo(place); return; }
  previewTo(place);
}
function saveRecent(d){ const key=d.address||d.text||d.name; NAV.recent=[{name:d.name,address:d.address||'',text:d.text||d.address||d.name,loc:d.loc||null},...NAV.recent.filter(r=>(r.address||r.text||r.name)!==key)].slice(0,8); saveRecents(); }
// Compatibilidad con el resto de la app
function routeTo(text){ return previewTo({name:text,text}); }

/* ---------- Vista previa de rutas ---------- */
async function previewTo(dest,o={}){
  if(!map){ toast('El mapa aún no ha cargado'); return false; }
  if(NAV.active&&!o.keepStops) clearRoute();
  NAV.dest=dest; if(!o.keepStops) NAV.stops=[]; NAV.sel=0;
  if(S.view!=='mapas') setView('mapas');
  setGuide('Calculando ruta…',dest.name); $('preview').hidden=true;
  let rs=[]; try{ rs=await computeRoutes(S.pos||FALLBACK,destParam(),{alts:true,stops:NAV.stops}); }
  catch(e){ toast('Google no ha podido calcular la ruta'); console.warn(e); }
  if(!rs.length){ setGuide('No encuentro esa ruta','Revisa la dirección'); clearOv(NAV.altOv); if(o.auto) sayQ('No he encontrado una ruta a '+dest.name); return false; }
  rs.forEach(r=>r.alerts=genAlerts(r));
  NAV.alts=rs; saveRecent(dest);
  if(o.auto){ startNav(0,!!o.sim); return true; }
  drawAlts(); fitRoute(rs); renderPreview(); setGuide('Elige una ruta',dest.name);
  return true;
}
function renderPreview(){
  const p=$('preview'); if(!NAV.alts.length){ p.hidden=true; return; }
  const d=NAV.dest, fastest=Math.min(...NAV.alts.map(r=>r.secs));
  p.hidden=false;
  p.innerHTML=`<div class="pvh"><small>RUTA HACIA</small><b>${esc(d.name)}</b>${d.address?`<span>${esc(d.address)}</span>`:''}${NAV.stops.length?`<span>Paradas: ${NAV.stops.map(s=>esc(s.name)).join(', ')}</span>`:''}</div>
    <div class="pvl">${NAV.alts.map((r,i)=>{ const delay=r.secs-r.stat, nr=(r.alerts||[]).filter(a=>a.type==='radar'||a.type==='tramo').length, inc=(r.alerts||[]).filter(a=>!['radar','tramo','atasco'].includes(a.type)).length;
      return `<button class="rcard ${i===NAV.sel?'on':''}" data-nav="sel" data-i="${i}"><div class="rc1"><b class="${delay>=300?'bad':delay>=60?'mid':'ok'}">${fmtMin(r.secs)}</b><span>${fmtKm(r.len)} · llegada ${fmtHM(new Date(Date.now()+r.secs*1000))}</span></div>
        <div class="rc2">${r.secs===fastest?'<span class="tag">Más rápida</span>':`<span class="tag dim">+${fmtMin(r.secs-fastest)}</span>`}${delay>=60?`<span class="tr bad">+${Math.round(delay/60)} min por tráfico</span>`:'<span class="tr ok">Tráfico fluido</span>'}${nr?`<span class="tr">${nr} radar${nr>1?'es':''}</span>`:''}${inc?`<span class="tr">${inc} aviso${inc>1?'s':''}</span>`:''}</div>
        ${r.warnings.length?`<small>${esc(r.warnings[0])}</small>`:''}</button>`; }).join('')}</div>
    <div class="pvo"><button class="chip ${NAV.setts.highways?'on':''}" data-nav="opt-highways">Sin autopistas</button><button class="chip ${NAV.setts.tolls?'on':''}" data-nav="opt-tolls">Sin peajes</button><button class="chip" data-nav="stop">+ Parada</button></div>
    <div class="pvb"><button class="pill" data-nav="cancel">Cancelar</button><button class="pill" data-nav="go-sim">Simular viaje</button><button class="pill on go" data-nav="go">Iniciar</button></div>`;
}

/* ---------- Navegación activa ---------- */
function startNav(i=NAV.sel,sim=false){
  const r=NAV.alts[i]; if(!r) return;
  clearOv(NAV.altOv); $('preview').hidden=true; NAV.alts=[];
  NAV.legIdx=0; applyRoute(r);
  NAV.active=true; document.body.dataset.nav='1'; S.follow=true; NAV.lastZoom=0;
  buildEta(); $('eta').hidden=false; $('spd').hidden=false;
  sayQ(`Vamos hacia ${NAV.dest.name}. ${etaPhrase()}`);
  clearInterval(NAV.fasterTimer); NAV.fasterTimer=setInterval(checkFaster,150000);
  renderNavCard(); navUpdate(); followCam();
  if(sim) startSim();
}
function applyRoute(r){ NAV.r=r; NAV.along=0; NAV.stepIdx=0; NAV.spoken={}; NAV.overWarned=false; NAV.alerts=r.alerts||genAlerts(r); drawActive(); }
function clearRoute(){
  stopSim(); clearOv(NAV.ov); clearOv(NAV.altOv); clearOv(NAV.alertMk); NAV.trafOv=[];
  NAV.active=false; NAV.r=null; NAV.alts=[]; NAV.alerts=[]; NAV.stops=[]; NAV.targetKmh=null; NAV.rerouting=false;
  delete document.body.dataset.nav; clearInterval(NAV.fasterTimer);
  ['eta','spd','alertb','banner','preview','tThen'].forEach(id=>{ const el=$(id); if(el) el.hidden=true; });
  NAV.alertKey=''; setTurn('s',0,'Sin destino','Pulsa «Buscar» o díselo a Siri'); renderNavCard();
}
const remainingStops=()=>NAV.stops.slice(NAV.legIdx);
function remainingSecs(){ const r=NAV.r; if(!r) return 0; let s=0;
  r.steps.forEach(st=>{ if(st.d1<=NAV.along) return; s+=st.sec*(st.d0>=NAV.along?1:(st.d1-NAV.along)/Math.max(1,st.d1-st.d0)); }); return s; }
const etaPhrase=()=>`Llegarás a las ${fmtHM(new Date(Date.now()+remainingSecs()*1000))}.`;
function curLimit(){ const t=NAV.alerts.find(x=>x.type==='tramo'&&x.inside&&!x.done); return t?t.limit:(NAV.r?stepAt(NAV.r,NAV.along).limit:50); }

let turnKey='';
function setTurn(code,exit,main,sub){ const k=code+'|'+exit; if(k!==turnKey){ turnKey=k; const s=manSvg(code,exit); $('tMan').innerHTML=s; if($('pMan')) $('pMan').innerHTML=s; } setGuide(main,sub); }

function navUpdate(){
  const r=NAV.r; if(!NAV.active||!r) return;
  const a=NAV.along;
  while(NAV.stepIdx<r.steps.length-1&&a>=r.steps[NAV.stepIdx].d1) NAV.stepIdx++;
  if(NAV.legIdx<r.legEnds.length-1&&a>=r.legEnds[NAV.legIdx]-25){ const s=NAV.stops[NAV.legIdx]; NAV.legIdx++;
    toast('Parada: '+(s?s.name:'')); sayQ('Has llegado a tu parada'+(s?', '+s.name:'')+'. Continuamos hacia '+NAV.dest.name+'.'); }
  if(a>=r.len-15){ arrive(); return; }
  const i=NAV.stepIdx, legEnd=r.legEnds[NAV.legIdx]??r.len, isStop=NAV.legIdx<r.legEnds.length-1;
  let nx=r.steps[i+1]; if(nx&&nx.d0>legEnd+5) nx=null;
  const nxt=nx||{man:isStop?'STOP':'DEST',text:isStop?'Llegarás a tu parada'+(NAV.stops[NAV.legIdx]?': '+NAV.stops[NAV.legIdx].name:''):'Llegarás a '+NAV.dest.name,d0:legEnd,exit:0};
  const dn=nxt.d0-a, code=nxt.man==='DEST'||nxt.man==='STOP'||nxt.man==='DESTINATION'?'d':manCode(nxt.man);
  setTurn(code,nxt.exit,dn<25&&code!=='d'?'Ahora':fmtKm(dn),nxt.text||cap(phraseFor(nxt)));
  // "Luego…"
  const th=r.steps[i+2], tc=$('tThen');
  if(nx&&th&&th.d0-nx.d0<250&&th.d0<=legEnd+5){ const k='then'+(i+2); if(tc.dataset.k!==k){ tc.dataset.k=k; tc.innerHTML=`<span>Luego</span>${manSvg(manCode(th.man),th.exit)}`; } tc.hidden=false; } else tc.hidden=true;
  voicePrompts(i,nxt,dn);
  updateAlerts(a);
  // Velocidad
  const lim=curLimit(), over=E.v>lim+3;
  $('spdLim').textContent=lim; $('spdCur').textContent=Math.round(E.v); $('spd').classList.toggle('over',over);
  if(over&&NAV.setts.speedWarn&&!NAV.overWarned){ NAV.overWarned=true; beep(880,.12,2); } if(E.v<lim) NAV.overWarned=false;
  const now=Date.now();
  if(now-NAV.lastEta>1000){ NAV.lastEta=now; updEta(); }
  if(now-NAV.lastTrim>1500){ NAV.lastTrim=now; trimRoute(); }
}
function voicePrompts(i,nxt,dn){
  const hw=curLimit()>=90, key='s'+Math.round(nxt.d0), sp=NAV.spoken[key]||(NAV.spoken[key]={});
  const far=hw?1500:500, near=hw?500:150, nowD=Math.max(hw?150:40,E.v/3.6*4), segLen=nxt.d0-(NAV.r.steps[i]?NAV.r.steps[i].d0:0);
  const dest=nxt.man==='DEST'||nxt.man==='DESTINATION', stop=nxt.man==='STOP', ph=dest?'llegarás a tu destino':stop?'llegarás a tu parada':phraseFor(nxt), tw=dest||stop?'':toward(nxt.text);
  if(dn<=nowD){ if(!sp.now){ sp.now=sp.near=sp.far=1; if(!dest&&!stop) sayQ(cap(ph)+(tw&&!sp.tw?' hacia '+tw:'')+'.'); } }
  else if(dn<=near){ if(!sp.near){ sp.near=sp.far=1; sayQ(dest?`Tu destino está a ${sayDist(dn)}.`:`En ${sayDist(dn)}, ${ph}${tw&&!sp.tw?' hacia '+tw:''}.`); sp.tw=1; } }
  else if(dn<=far&&segLen>far+200){ if(!sp.far){ sp.far=1; sp.tw=1; sayQ(`En ${sayDist(dn)}, ${ph}${tw?' hacia '+tw:''}.`); } }
}
function updateAlerts(a){
  let show=null;
  for(const x of NAV.alerts){
    if(x.done) continue;
    if(x.type==='tramo'){
      if(a>=x.d&&a<=x.d1){ if(!x.inside){ x.inside=true; x.t=0; x.warned=true; sayQ(`Inicio de tramo controlado. Límite ${x.limit}.`); } show=show||x; continue; }
      if(a>x.d1){ x.done=true; if(x.inside&&x.t) sayQ(`Fin del tramo. Velocidad media ${Math.round((x.d1-x.d)/x.t*3.6)} kilómetros por hora.`); continue; }
    }
    if(x.type==='atasco'&&a>=x.d&&a<x.d1){ show=show||x; continue; }
    const rel=x.d-a, end=x.type==='atasco'?x.d1-a:rel;
    if(end<-40){ x.done=true; if((x.sim||x.user)&&CONFIRMABLE.includes(x.type)) askConfirm(x); continue; }
    if(rel<=warnDist(x)&&rel>-40){ if(!x.warned){ x.warned=true; sayQ(alertPhrase(x,rel)); if(['radar','radarm','tramo'].includes(x.type)) beep(1046,.1,2); } show=show||x; }
  }
  renderAlert(show,a);
}
function renderAlert(x,a){
  const b=$('alertb'); if(!x){ b.hidden=true; NAV.alertKey=''; return; }
  const inside=x.type==='tramo'&&x.inside||x.type==='atasco'&&a>=x.d;
  let dist=inside?'Ahora':fmtKm(x.d-a), extra='';
  if(x.type==='tramo'&&inside){ const avg=x.t>1?(a-x.d)/x.t*3.6:E.v; dist=`Media ${Math.round(avg)} km/h`; extra=`<span class="${avg>x.limit?'bad':''}">quedan ${fmtKm(x.d1-a)}</span>`; }
  if(x.type==='atasco') extra=`<span>${inside?'quedan '+fmtKm(x.d1-a):fmtKm(x.d1-x.d)+' de retención'}${x.delay>=60?' · +'+Math.round(x.delay/60)+' min':''}</span>`;
  const src=x.user?'Notificado por ti':x.real?'Tráfico de Google':x.sim?'Aviso simulado':'';
  const html=`${alertSvg(x.type,44)}<div class="at"><b>${AL[x.type][0]}</b><span class="ad num">${dist}</span>${extra}<small>${src}</small></div>${x.limit?`<span class="lsign">${x.limit}</span>`:''}`;
  if(html!==NAV.alertKey){ NAV.alertKey=html; b.innerHTML=html; } b.hidden=false; b.dataset.k=x.type;
}
function askConfirm(x){ showBanner(`¿Sigue habiendo ${AL[x.type][0].toLowerCase()}?`,[['Sí',()=>toast('Gracias por confirmarlo')],['No',()=>{ if(x.user) removeReport(x.rid); toast('Gracias, aviso retirado'); }]],9000); }
function showBanner(text,acts,ms=10000){ NAV.bannerActs=acts; const b=$('banner');
  b.innerHTML=`<span>${esc(text)}</span><div>${acts.map((a,i)=>`<button class="pill ${i===0?'on':''}" data-nav="bn" data-i="${i}">${esc(a[0])}</button>`).join('')}</div>`; b.hidden=false;
  clearTimeout(NAV.bannerTimer); NAV.bannerTimer=setTimeout(()=>{ b.hidden=true; },ms); }
function runBanner(i){ const a=NAV.bannerActs[i]; $('banner').hidden=true; clearTimeout(NAV.bannerTimer); if(a&&a[1]) a[1](); }

function buildEta(){
  $('eta').innerHTML=`<div><b id="eArr" class="num">--:--</b><small>llegada</small></div><div><b id="eMin" class="num">-</b><small>tiempo</small></div><div><b id="eKm" class="num">-</b><small id="eDest"></small></div>
    <div class="r"><button class="pill" data-nav="steps">Pasos</button><button class="pill" data-nav="stop">Parada</button><button class="pill" data-nav="share">Compartir</button><button class="pill stop" data-act="end">Finalizar</button></div>`;
}
function updEta(){
  const r=NAV.r; if(!r) return; const secs=remainingSecs(), left=r.len-NAV.along, hh=fmtHM(new Date(Date.now()+secs*1000));
  const jam=NAV.alerts.some(x=>x.type==='atasco'&&!x.done&&x.d1>NAV.along);
  $('eArr').textContent=hh; $('eMin').textContent=fmtMin(secs); $('eMin').className='num '+(jam?'mid':'ok'); $('eKm').textContent=fmtKm(left); $('eDest').textContent=NAV.dest.name;
  if($('pEta')) $('pEta').textContent=`Llegada ${hh} · ${fmtMin(secs)} · ${fmtKm(left)}`;
}
function arrive(){
  const d=NAV.dest; sayQ('Has llegado a '+d.name+'.'); clearRoute();
  overlay(`<h2>Has llegado</h2><p style="font-size:18px;color:var(--fg)">${esc(d.name)}</p><p>${fmtHM(new Date())}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:14px"><button class="pill" data-nav="cat" data-q="aparcamiento">Buscar aparcamiento</button><button class="pill on" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv;
}

/* ---------- Recalcular, ruta más rápida, paradas ---------- */
async function reroute(why){
  if(NAV.rerouting||!NAV.active) return; NAV.rerouting=true;
  setGuide('Recalculando…',why||''); sayQ('Recalculando.');
  try{ const stops=remainingStops(); const rs=await computeRoutes(S.pos,destParam(),{alts:false,stops});
    if(rs.length){ NAV.stops=stops; NAV.legIdx=0; applyRoute(rs[0]); renderNavCard(); } else toast('No he encontrado otra ruta'); }
  catch(e){ toast('No se pudo recalcular la ruta'); }
  NAV.rerouting=false; navUpdate();
}
async function checkFaster(){
  if(!NAV.active||NAV.rerouting||!$('banner').hidden) return;
  try{ const stops=remainingStops(); const rs=await computeRoutes(S.pos,destParam(),{alts:!stops.length,stops}); if(!rs.length||!NAV.active) return;
    const best=rs.reduce((x,y)=>x.secs<y.secs?x:y), save=remainingSecs()-best.secs;
    if(save>=120&&Math.abs(best.len-(NAV.r.len-NAV.along))>150){
      sayQ(`Hay una ruta más rápida que ahorra ${fmtMin(save)}.`);
      showBanner(`Ruta más rápida disponible: ahorra ${fmtMin(save)}`,[['Cambiar',()=>{ best.alerts=genAlerts(best); NAV.stops=stops; NAV.legIdx=0; applyRoute(best); sayQ('Ruta cambiada. '+etaPhrase()); }],['Ignorar',null]],15000);
    } }catch(e){}
}
async function addStop(place){
  const stops=[place,...remainingStops()]; setGuide('Añadiendo parada…',place.name);
  try{ const rs=await computeRoutes(S.pos,destParam(),{alts:false,stops});
    if(!rs.length){ toast('No se pudo añadir la parada'); return; }
    NAV.stops=stops; NAV.legIdx=0; applyRoute(rs[0]); renderNavCard(); toast('Parada añadida: '+place.name);
    sayQ(`Parada añadida: ${place.name}. Llegarás en ${fmtMin(rs[0].steps.filter(s=>s.d1<=rs[0].legEnds[0]+1).reduce((t,s)=>t+s.sec,0))}.`);
  }catch(e){ toast('No se pudo añadir la parada'); }
  navUpdate();
}

/* ---------- Simulación del viaje ---------- */
function toggleSim(){ if(S.sim){ stopSim(); return; } if(!NAV.active){ if(NAV.alts.length){ startNav(NAV.sel,true); return; } toast('Primero busca un destino'); return; } startSim(); }
function startSim(){ if(S.sim) return; S.sim=setInterval(simTick,100); $('bSim').classList.add('on'); document.body.dataset.sim='1'; S.follow=true; updSimX(); }
function stopSim(){ if(S.sim){ clearInterval(S.sim); S.sim=null; } if($('bSim')) $('bSim').classList.remove('on'); delete document.body.dataset.sim; NAV.targetKmh=null; }
function simTick(){
  const r=NAV.r; if(!NAV.active||!r){ stopSim(); return; } if(NAV.rerouting) return;
  const dt=.1*(NAV.setts.simX||1), lim=curLimit(), a=NAV.along;
  let tgt=lim*({D:1.06,N:.97,A:.86}[E.dna]||.97);
  const tr=trafficAt(r,a); if(tr==='SLOW') tgt=Math.min(tgt,lim*.45); if(tr==='TRAFFIC_JAM') tgt=Math.min(tgt,12);
  const nx=r.steps[NAV.stepIdx+1];
  if(nx&&nx.d0-a<90){ const c=manCode(nx.man); if(c==='ro') tgt=Math.min(tgt,30); else if(['l','r','hl','hr','ul','ur'].includes(c)) tgt=Math.min(tgt,22); else if(['sl','sr','rl','rr','fl','fr'].includes(c)) tgt=Math.min(tgt,Math.max(45,lim*.6)); }
  if(r.len-a<150) tgt=Math.min(tgt,18);
  NAV.targetKmh=tgt;
  NAV.along=Math.min(r.len,a+Math.max(E.v,4)/3.6*dt);
  NAV.alerts.forEach(x=>{ if(x.type==='tramo'&&x.inside&&!x.done) x.t+=dt; });
  const p=pointAt(r,NAV.along), q=pointAt(r,Math.min(r.len,NAV.along+15));
  if(NAV.along<r.len-2){ const h=SPH().computeHeading(p,q); if(isFinite(h)){ let d=h-S.heading; while(d>180)d-=360; while(d<-180)d+=360; S.heading+=d*.35; } }
  moveCar(p.toJSON());
  navUpdate();
}
function updSimX(){ const b=$('bSimX'); if(b) b.innerHTML=`<b>×${NAV.setts.simX||1}</b>Velocidad`; }
function simDetour(){
  if(!NAV.active||!S.pos) return;
  const h=S.heading+90, q=SPH().computeOffset(new G.LatLng(S.pos.lat,S.pos.lng),180,h);
  S.heading=h; moveCar(q.toJSON()); toast('Te has salido de la ruta'); reroute('Te has salido de la ruta');
}
/* Para un GPS real (en el coche): proyecta la posición y recalcula si te sales */
let offCount=0;
function onGPS(p,heading){
  if(heading!=null) S.heading=heading; moveCar(p);
  if(!NAV.active||!NAV.r||NAV.rerouting) return;
  const pr=project(NAV.r,p,idxAt(NAV.r,NAV.along),200);
  if(pr.off>60){ if(++offCount>=3){ offCount=0; reroute('Te has salido de la ruta'); } return; }
  offCount=0; NAV.along=Math.max(NAV.along,pr.d); navUpdate();
}

/* ---------- Notificar avisos ---------- */
const REPORT_TYPES=[['accidente','Accidente'],['atasco','Retención'],['radarm','Radar móvil'],['policia','Policía'],['obras','Obras'],['peligro','Peligro'],['parado','Vehículo parado'],['cortado','Carril cortado']];
AL.radarm=['Radar móvil','#2f7fd6']; ALG.radarm=ALG.radar;
function reportScreen(){
  overlay(`<h2>Notificar</h2><p>El aviso se guarda en este coche y te avisará cuando vuelvas a pasar por aquí.</p>
    <div class="rgrid">${REPORT_TYPES.map(([k,n])=>`<button class="rtile" data-nav="rep" data-k="${k}">${alertSvg(k,56)}<span>${n}</span></button>`).join('')}</div>
    <div style="text-align:right;margin-top:14px"><button class="pill" id="cOv">Cancelar</button></div>`);
  $('cOv').onclick=closeOv;
}
function addReport(k){ const p=S.pos; if(!p) return; closeOv();
  NAV.setts.reports=[{k,lat:p.lat,lng:p.lng,t:Date.now(),rid:Date.now()},...NAV.setts.reports].slice(0,60); saveNav(); drawReportMarkers();
  toast(`Gracias. ${(AL[k]||AL.peligro)[0]} notificado`); sayQ(`${(AL[k]||AL.peligro)[0]} notificado. Gracias.`); }
function removeReport(rid){ NAV.setts.reports=NAV.setts.reports.filter(r=>r.rid!==rid); saveNav(); drawReportMarkers(); }

/* ---------- Pasos ---------- */
function stepsScreen(){
  const r=NAV.r; if(!r) return;
  overlay(`<h2>Indicaciones</h2><p>${fmtKm(r.len-NAV.along)} · ${fmtMin(remainingSecs())} · hacia ${esc(NAV.dest.name)}</p>
    <div class="list steps">${r.steps.map((s,i)=>i===0&&!s.text?'':`<div class="row ${i===NAV.stepIdx+1?'on':''} ${s.d0<NAV.along-5&&i!==NAV.stepIdx+1?'past':''}"><span class="sman">${manSvg(manCode(s.man),s.exit)}</span><span class="t"><b>${esc(s.text||cap(phraseFor(s)))}</b><small>${fmtKm(s.d1-s.d0)}${s.limit?' · límite estimado '+s.limit:''}</small></span></div>`).join('')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px"><a class="pill" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(destText())}">Abrir en Google Maps</a><button class="pill" id="cOv">Cerrar</button></div>`);
  $('cOv').onclick=closeOv;
}

/* ---------- Tarjeta de navegación del panel ---------- */
function renderNavCard(){
  const c=$('navcard'); if(!c) return; turnKey='';
  if(NAV.active&&NAV.dest){
    c.innerHTML=`<span class="cardlabel">Hacia ${esc(NAV.dest.name)}</span><div class="nc"><span class="ncman" id="pMan"></span><div style="min-width:0"><span class="big" id="pMain">${esc($('tMain').textContent)}</span><span class="muted ncsub" id="pSub">${esc($('tSub').textContent)}</span></div></div><span class="muted" id="pEta"></span>`;
    return;
  }
  const sug=[]; if(NAV.setts.home) sug.push(['Casa',NAV.setts.home]); if(NAV.setts.work) sug.push(['Trabajo',NAV.setts.work]);
  NAV.recent.forEach(r=>{ const q=r.address||r.text||r.name; if(sug.length<3&&!sug.some(s=>s[1]===q)) sug.push([r.name,q]); });
  const ev=typeof nextEvent==='function'?nextEvent():null;
  c.innerHTML=`<span class="cardlabel">Sugerencias de Siri</span><div class="sugs">${ev?`<button class="sug" data-nav="go-q" data-q="${esc(ev.place)}" data-n="${esc(ev.title)}"><b>${esc(ev.title)} · ${ev.time}</b><small>${esc(ev.place)}</small></button>`:''}${sug.map(s=>`<button class="sug" data-nav="go-q" data-q="${esc(s[1])}" data-n="${esc(s[0])}"><b>${esc(s[0])}</b><small>${esc(s[1])}</small></button>`).join('')}${!ev&&!sug.length?'<span class="muted">Pon Casa y Trabajo en Ajustes para tener accesos rápidos.</span>':''}</div>
    <div style="display:flex;gap:8px"><button class="pill on" data-nav="search">Buscar destino</button><button class="pill" data-siri="1">Siri</button></div>`;
}

/* ---------- Botones y arranque ---------- */
function toggleTraffic(force){
  if(!map) return; NAV.setts.traffic=force!=null?force:!NAV.setts.traffic; saveNav();
  if(!NAV.trafficLayer) NAV.trafficLayer=new G.TrafficLayer(); NAV.trafficLayer.setMap(NAV.setts.traffic?map:null);
  const b=$('bTraf'); if(b) b.classList.toggle('on',!!NAV.setts.traffic);
}
function updVoiceBtn(){ const b=$('bVoice'); if(!b) return; b.classList.toggle('off',!S.voice); b.querySelector('small').textContent=S.voice?'Voz':'Silencio'; }
function navInit(){ toggleTraffic(!!NAV.setts.traffic); drawReportMarkers(); updVoiceBtn(); updSimX(); renderNavCard(); setTurn('s',0,'Sin destino','Pulsa «Buscar» o díselo a Siri'); }
document.addEventListener('click',e=>{
  const z=e.target.closest('[data-act="zin"],[data-act="zout"]'); if(z) NAV.zoomLock=Date.now()+15000;
},true);
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-nav]'); if(!el) return; const d=el.dataset; e.stopPropagation();
  switch(d.nav){
    case 'search': destScreen(); break;
    case 'report': reportScreen(); break;
    case 'rep': addReport(d.k); break;
    case 'traffic': toggleTraffic(); toast(NAV.setts.traffic?'Tráfico en el mapa activado':'Tráfico en el mapa desactivado'); break;
    case 'voice': S.voice=!S.voice; LS.set('rp-voz',S.voice?'1':'0'); if(!S.voice) speechSynthesis.cancel(); updVoiceBtn(); toast(S.voice?'Indicaciones por voz activadas':'Indicaciones por voz silenciadas'); break;
    case 'simx': NAV.setts.simX={1:2,2:4,4:8,8:1}[NAV.setts.simX]||1; saveNav(); updSimX(); break;
    case 'detour': simDetour(); break;
    case 'sel': selAlt(+d.i); break;
    case 'go': startNav(NAV.sel,false); break;
    case 'go-sim': startNav(NAV.sel,true); break;
    case 'cancel': clearRoute(); break;
    case 'opt-highways': NAV.setts.highways=!NAV.setts.highways; saveNav(); if(NAV.dest) previewTo(NAV.dest,{keepStops:true}); break;
    case 'opt-tolls': NAV.setts.tolls=!NAV.setts.tolls; saveNav(); if(NAV.dest) previewTo(NAV.dest,{keepStops:true}); break;
    case 'stop': destScreen('stop'); break;
    case 'steps': stepsScreen(); break;
    case 'share': if(typeof shareScreen==='function') shareScreen(); break;
    case 'cat': doSearch(d.q,true); break;
    case 'fav': pick({name:d.n,text:d.q}); break;
    case 'res': pick(NAV.results[+d.i]); break;
    case 'recent': pick(NAV.recent[+d.i]); break;
    case 'raw': pick({name:d.q,text:d.q}); break;
    case 'bn': runBanner(+d.i); break;
    case 'go-q': previewTo({name:d.n||d.q,text:d.q}); break;
  }
});
