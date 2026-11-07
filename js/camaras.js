/* =====================================================================
   Radar Play · Cámaras
   Cámara de marcha atrás (se abre sola con la señal de la luz de marcha
   atrás) y visión 360 a vista de pájaro uniendo 4 cámaras (WebGL), con
   calibración en pantalla. También admite un kit 360 comercial.
   Medidas en metros. Origen en el centro del coche, x a la derecha, y hacia delante.
   ===================================================================== */
const CAR={L:4.35,W:1.80};                       // Alfa Romeo Giulietta
const L2=CAR.L/2, W2=CAR.W/2;
const ROLES=[['front','Delantera'],['rear','Trasera'],['left','Izquierda'],['right','Derecha'],['kit','Kit 360']];
const roleName=r=>(ROLES.find(x=>x[0]===r)||[0,r])[1];
const CAM=Object.assign({roles:{front:'',rear:'',left:'',right:'',kit:''},cal:{},guides:{top:.30,bottom:.86,height:.55},duck:true,kit:false},ld('rp-camaras',{}));
['front','rear','left','right','kit'].forEach(r=>{ if(CAM.roles[r]==null) CAM.roles[r]=''; });
const saveCam=()=>LS.set('rp-camaras',JSON.stringify({roles:CAM.roles,cal:CAM.cal,guides:CAM.guides,duck:CAM.duck,kit:CAM.kit}));
const CS={streams:{},videos:{},devices:[],rev:false,revCloseT:0,tab:'rear',calRole:'rear',taps:[],raf:0,cv:{},bridge:false,gpioRev:null,ducked:false};
const CALPTS={
  rear:[[-.9,-L2-.5],[.9,-L2-.5],[.9,-L2-2],[-.9,-L2-2]],
  front:[[-.9,L2+.5],[.9,L2+.5],[.9,L2+2],[-.9,L2+2]],
  left:[[-W2-.5,1],[-W2-.5,-1],[-W2-2,-1],[-W2-2,1]],
  right:[[W2+.5,-1],[W2+.5,1],[W2+2,1],[W2+2,-1]],
};

ICONS.camaras=Sv('<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/>');
APPS.splice(Math.max(0,APPS.findIndex(a=>a.id==='sistema')),0,{id:'camaras',name:'Cámaras',bg:'linear-gradient(160deg,#20c7b5,#0d6f66)'});

/* ---------- Fuentes de vídeo ---------- */
async function getVideo(role){
  const id=CAM.roles[role]; if(!id) return null;
  if(CS.videos[role]) return CS.videos[role];
  let stream;
  try{
    if(id==='demo') stream=demoStream(role);
    else stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:id},width:{ideal:role==='rear'||role==='kit'?1280:640},height:{ideal:role==='rear'||role==='kit'?720:480},frameRate:{ideal:role==='rear'?30:20}},audio:false});
  }catch(e){ toast(`Cámara ${roleName(role).toLowerCase()}: ${e.name==='NotFoundError'||e.name==='OverconstrainedError'?'no está conectada':e.name==='NotReadableError'?'la está usando otro programa':'no se puede abrir'}`); return null; }
  const v=document.createElement('video'); v.muted=true; v.playsInline=true; v.autoplay=true; v.srcObject=stream;
  CS.streams[role]=stream; CS.videos[role]=v; v.play().catch(()=>{}); return v;
}
function stopCams(keep=[]){ for(const r of Object.keys(CS.streams)){ if(keep.includes(r)) continue; CS.streams[r].getTracks().forEach(t=>t.stop()); clearInterval(CS.streams[r]._t); delete CS.streams[r]; delete CS.videos[r]; } }
async function findCams(ask){
  if(!navigator.mediaDevices||!navigator.mediaDevices.enumerateDevices){ CS.devices=[]; return; }
  if(ask){ try{ const s=await navigator.mediaDevices.getUserMedia({video:true}); s.getTracks().forEach(t=>t.stop()); }catch(e){ toast('Permite el uso de la cámara en el navegador'); } }
  CS.devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
}
/* Imágenes de demostración (sin cámaras conectadas) */
function demoStream(role){
  const c=document.createElement('canvas'); c.width=640; c.height=360; const x=c.getContext('2d'), t0=performance.now();
  const s=c.captureStream(25); s._t=setInterval(()=>drawDemoCam(x,role,(performance.now()-t0)/1000),40); drawDemoCam(x,role,0); return s;
}
function drawDemoCam(x,role,t){
  const W=640,H=360,hz=H*.36,f=360,h=.9;
  const back=role==='rear'?3.4-((t*.22)%2.8):role==='front'?4.5:3;
  x.fillStyle='#3b4047'; x.fillRect(0,0,W,hz);
  const g=x.createLinearGradient(0,hz,0,H); g.addColorStop(0,'#33373c'); g.addColorStop(1,'#565b61'); x.fillStyle=g; x.fillRect(0,hz,W,H-hz);
  const P=(X,D)=>[W/2+f*X/D,hz+f*h/D];
  const ln=(a,b,c='#e8e8e8',w=5)=>{ x.strokeStyle=c; x.lineWidth=w; x.beginPath(); x.moveTo(...a); x.lineTo(...b); x.stroke(); };
  const wy=P(0,back)[1], wh=f*1.3/back, [wl]=P(-4,back), [wr]=P(4,back);
  x.fillStyle=role==='rear'?'#6b5b4a':'#4e5a66'; x.fillRect(wl,wy-wh,wr-wl,wh);
  x.fillStyle='#8b8f94'; x.fillRect(wl,wy-6,wr-wl,6);
  ln(P(-1.25,.4),P(-1.25,back)); ln(P(1.25,.4),P(1.25,back));
  if(role!=='rear'){ x.fillStyle='#7b1e1e'; const [a,b]=P(1.6,back-.4),[c]=P(3.4,back-.4); x.fillRect(a,b-f*1.1/(back-.4),c-a,f*1.1/(back-.4)); }
  const [cx,cy]=P(.8,Math.max(.6,back-.5)), cs=f*.45/Math.max(.6,back-.5); x.fillStyle='#ff6a1a'; x.beginPath(); x.moveTo(cx,cy-cs); x.lineTo(cx-cs*.35,cy); x.lineTo(cx+cs*.35,cy); x.fill();
  const v=x.createRadialGradient(W/2,H/2,H*.3,W/2,H/2,W*.65); v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,.6)'); x.fillStyle=v; x.fillRect(0,0,W,H);
  x.fillStyle='rgba(255,255,255,.75)'; x.font='600 16px sans-serif'; x.fillText('DEMOSTRACIÓN · '+roleName(role).toUpperCase(),14,26);
}
function drawDemoBird(x,w,h,t){
  const span=7, sc=w/span, G=(X,Y)=>[w/2+X*sc,h/2-Y*sc], off=((t*.25)%3);
  x.fillStyle='#42474d'; x.fillRect(0,0,w,h);
  x.strokeStyle='#e8e8e8'; x.lineWidth=Math.max(2,sc*.1);
  for(const X of [-1.25,1.25]){ const [a,b]=G(X,-L2-4+off), [,d]=G(X,L2+1+off); x.beginPath(); x.moveTo(a,b); x.lineTo(a,d); x.stroke(); }
  x.fillStyle='#6b5b4a'; const [p,q]=G(-4,-L2-3+off); x.fillRect(p,q,8*sc,1.2*sc);
  x.fillStyle='#7b1e1e'; const [m,n]=G(1.7,1.6+off); x.fillRect(m,n,1.8*sc,4.3*sc);
  x.fillStyle='#ff6a1a'; const [ca,cb]=G(.8,-L2-2.4+off); x.beginPath(); x.arc(ca,cb,sc*.18,0,7); x.fill();
}

/* ---------- WebGL: corrección de ojo de pez y vista de pájaro ---------- */
const FS=`precision mediump float;
uniform sampler2D t0,t1,t2,t3; uniform mat3 H0,H1,H2,H3; uniform vec4 K,M,ON,A; uniform vec2 R,SPAN,CARS; uniform float MODE;
vec2 dist(vec2 u,float k,float a){ vec2 c=u-.5; vec2 q=vec2(c.x*a,c.y); float r2=dot(q,q)/(.25*(a*a+1.)); return c*(1.+k*r2)+.5; }
float inside(vec2 uv){ return step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.); }
vec4 cam(sampler2D t,mat3 H,float k,float m,float a,vec2 g,out float ok){ vec3 p=H*vec3(g,1.); if(p.z<=0.){ ok=0.; return vec4(0.); }
  vec2 uv=dist(p.xy/p.z,k,a); if(m>.5) uv.x=1.-uv.x; ok=inside(uv); return texture2D(t,clamp(uv,0.,1.)); }
void main(){ vec2 o=vec2(gl_FragCoord.x/R.x,1.-gl_FragCoord.y/R.y);
  if(MODE<.5){ vec2 uv=dist(o,K.x,A.x); if(M.x>.5) uv.x=1.-uv.x; gl_FragColor=inside(uv)>0.?texture2D(t0,uv):vec4(0.,0.,0.,1.); return; }
  vec2 g=vec2((o.x-.5)*SPAN.x,(.5-o.y)*SPAN.y); float l2=CARS.y*.5, w2=CARS.x*.5, ok, w; vec4 acc=vec4(0.); float ws=0.;
  vec4 c=cam(t0,H0,K.x,M.x,A.x,g,ok); w=ON.x*ok*clamp((g.y-l2)/1.2+.6,0.,1.); acc+=c*w; ws+=w;
  c=cam(t1,H1,K.y,M.y,A.y,g,ok); w=ON.y*ok*clamp((-g.y-l2)/1.2+.6,0.,1.); acc+=c*w; ws+=w;
  c=cam(t2,H2,K.z,M.z,A.z,g,ok); w=ON.z*ok*clamp((-g.x-w2)/1.2+.6,0.,1.); acc+=c*w; ws+=w;
  c=cam(t3,H3,K.w,M.w,A.w,g,ok); w=ON.w*ok*clamp((g.x-w2)/1.2+.6,0.,1.); acc+=c*w; ws+=w;
  gl_FragColor=ws>.001?vec4(acc.rgb/ws,1.):vec4(.06,.07,.08,1.); }`;
const VS='attribute vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }';
function glFor(cv){
  if(cv._gl!==undefined) return cv._gl;
  const gl=cv.getContext('webgl',{antialias:false,premultipliedAlpha:false}); if(!gl) return cv._gl=null;
  const sh=(t,s)=>{ const o=gl.createShader(t); gl.shaderSource(o,s); gl.compileShader(o); if(!gl.getShaderParameter(o,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  try{ const pr=gl.createProgram(); gl.attachShader(pr,sh(gl.VERTEX_SHADER,VS)); gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const lp=gl.getAttribLocation(pr,'p'); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp,2,gl.FLOAT,false,0,0);
    const U={}; ['t0','t1','t2','t3','H0','H1','H2','H3','K','M','ON','A','R','SPAN','CARS','MODE'].forEach(n=>U[n]=gl.getUniformLocation(pr,n));
    const tex=[0,1,2,3].map(i=>{ const t=gl.createTexture(); gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D,t);
      [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T].forEach(p=>gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE)); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([10,12,14,255])); gl.uniform1i(U['t'+i],i); return t; });
    return cv._gl={gl,U,tex};
  }catch(e){ console.warn('WebGL',e); return cv._gl=null; }
}
const colMajor=h=>h?[h[0],h[3],h[6],h[1],h[4],h[7],h[2],h[5],h[8]]:[1,0,0,0,1,0,0,0,1];
function fitCanvas(cv){ const d=Math.min(1.5,devicePixelRatio||1), w=Math.round(cv.clientWidth*d), h=Math.round(cv.clientHeight*d); if(w&&h&&(cv.width!==w||cv.height!==h)){ cv.width=w; cv.height=h; } return w&&h; }
function upload(G,i,v){ const gl=G.gl; gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D,G.tex[i]); if(v&&v.readyState>=2&&v.videoWidth) gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,v); }
function renderSingle(cv,role){
  if(!fitCanvas(cv)) return; const v=CS.videos[role], cal=CAM.cal[role]||{}, G=glFor(cv);
  if(!G){ const x=cv.getContext('2d'); x.fillStyle='#000'; x.fillRect(0,0,cv.width,cv.height); if(v&&v.readyState>=2){ x.save(); if(cal.m){ x.translate(cv.width,0); x.scale(-1,1); } x.drawImage(v,0,0,cv.width,cv.height); x.restore(); } return; }
  const gl=G.gl; gl.viewport(0,0,cv.width,cv.height); upload(G,0,v);
  gl.uniform1f(G.U.MODE,0); gl.uniform2f(G.U.R,cv.width,cv.height); gl.uniform4f(G.U.K,cal.k||0,0,0,0); gl.uniform4f(G.U.M,cal.m?1:0,0,0,0);
  gl.uniform4f(G.U.A,v&&v.videoWidth?v.videoWidth/v.videoHeight:16/9,1,1,1); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}
const SPANX=7.2;
function renderBird(cv){
  if(!fitCanvas(cv)) return; const span=[SPANX,SPANX*cv.height/cv.width];
  const roles=['front','rear','left','right'];
  if(cv._demo){ const x=cv.getContext('2d'); if(x) drawDemoBird(x,cv.width,cv.height,performance.now()/1000); return; }
  const G=glFor(cv); if(!G) return;
  const gl=G.gl; gl.viewport(0,0,cv.width,cv.height); const k=[],m=[],on=[],a=[];
  roles.forEach((r,i)=>{ const v=CS.videos[r], c=CAM.cal[r]; upload(G,i,v); gl.uniformMatrix3fv(G.U['H'+i],false,colMajor(c&&c.H));
    k.push(c?c.k||0:0); m.push(c&&c.m?1:0); on.push(c&&c.H&&v&&v.readyState>=2?1:0); a.push(v&&v.videoWidth?v.videoWidth/v.videoHeight:16/9); });
  gl.uniform1f(G.U.MODE,1); gl.uniform2f(G.U.R,cv.width,cv.height); gl.uniform2f(G.U.SPAN,span[0],span[1]); gl.uniform2f(G.U.CARS,CAR.W,CAR.L);
  gl.uniform4fv(G.U.K,k); gl.uniform4fv(G.U.M,m); gl.uniform4fv(G.U.ON,on); gl.uniform4fv(G.U.A,a); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}
function birdMode(){
  if(CAM.kit) return 'kit';
  const r=['front','rear','left','right'], real=r.filter(x=>CAM.roles[x]&&CAM.roles[x]!=='demo');
  if(r.some(x=>CAM.cal[x]&&CAM.cal[x].H&&CAM.roles[x])) return 'stitch';
  if(real.length) return 'grid';
  return 'demo';
}

/* ---------- Homografía (4 puntos del suelo → 4 puntos de la imagen) ---------- */
function homography(src,dst){
  const A=[],b=[];
  for(let i=0;i<4;i++){ const [x,y]=src[i],[u,v]=dst[i]; A.push([x,y,1,0,0,0,-u*x,-u*y]); b.push(u); A.push([0,0,0,x,y,1,-v*x,-v*y]); b.push(v); }
  for(let c=0;c<8;c++){ let p=c; for(let r=c+1;r<8;r++) if(Math.abs(A[r][c])>Math.abs(A[p][c])) p=r; if(Math.abs(A[p][c])<1e-12) return null;
    [A[c],A[p]]=[A[p],A[c]]; [b[c],b[p]]=[b[p],b[c]];
    for(let r=0;r<8;r++){ if(r===c) continue; const f=A[r][c]/A[c][c]; for(let k=c;k<8;k++) A[r][k]-=f*A[c][k]; b[r]-=f*b[c]; } }
  const H=[...b.map((v,i)=>v/A[i][i]),1], [x0,y0]=src[0];
  if(H[6]*x0+H[7]*y0+H[8]<0) for(let i=0;i<9;i++) H[i]=-H[i];   // misma proyección, con el suelo delante de la cámara
  return H;
}
const applyH=(H,x,y)=>{ const z=H[6]*x+H[7]*y+H[8]; return z>0?[(H[0]*x+H[1]*y+H[2])/z,(H[3]*x+H[4]*y+H[5])/z]:null; };

/* ---------- Líneas de aparcamiento ---------- */
function guidesSVG(){
  const c=CAM.cal.rear, segs=[[0,.5,'#ff3b30'],[.5,1,'#ffcc00'],[1,2,'#34c759'],[2,3,'#34c759']];
  if(c&&c.H){ const P=(x,y)=>{ const p=applyH(c.H,x,y); return p?p.map(v=>v*100):null; }; let s='';
    segs.forEach(([d0,d1,col])=>{ for(const x of [-W2,W2]){ const a=P(x,-L2-d0-.1), b=P(x,-L2-d1-.1); if(a&&b) s+=`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${col}"/>`; }
      const a=P(-W2,-L2-d1-.1), b=P(-W2+.35,-L2-d1-.1), e=P(W2-.35,-L2-d1-.1), f=P(W2,-L2-d1-.1); if(a&&b&&e&&f) s+=`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${col}"/><line x1="${e[0]}" y1="${e[1]}" x2="${f[0]}" y2="${f[1]}" stroke="${col}"/>`; });
    return `<svg class="guides" viewBox="0 0 100 100" preserveAspectRatio="none">${s}</svg>`; }
  const g=CAM.guides, yB=100, yT=100-g.height*100, X=(f,y)=>{ const t=(yB-y)/(yB-yT), half=(g.bottom+(g.top-g.bottom)*t)*50; return [50-half,50+half]; };
  let s=''; const fr=[0,.17,.38,.7,1];
  segs.forEach(([,,col],i)=>{ const y0=yB-(yB-yT)*fr[i], y1=yB-(yB-yT)*fr[i+1], [a0,b0]=X(0,y0), [a1,b1]=X(0,y1);
    s+=`<line x1="${a0}" y1="${y0}" x2="${a1}" y2="${y1}" stroke="${col}"/><line x1="${b0}" y1="${y0}" x2="${b1}" y2="${y1}" stroke="${col}"/><line x1="${a1}" y1="${y1}" x2="${a1+(b1-a1)*.16}" y2="${y1}" stroke="${col}"/><line x1="${b1}" y1="${y1}" x2="${b1-(b1-a1)*.16}" y2="${y1}" stroke="${col}"/>`; });
  return `<svg class="guides" viewBox="0 0 100 100" preserveAspectRatio="none">${s}</svg>`;
}
const carSVG=(a=4/3)=>{ const sy=SPANX/a; return `<svg class="carov" viewBox="${-SPANX/2} ${-sy/2} ${SPANX} ${sy}" preserveAspectRatio="xMidYMid slice"><g><rect x="${-W2}" y="${-L2}" width="${CAR.W}" height="${CAR.L}" rx=".42" fill="#d9dde2" stroke="#111" stroke-width=".04"/><path d="M${-W2+.18} ${-L2+1.15} Q0 ${-L2+.9} ${W2-.18} ${-L2+1.15} L${W2-.28} ${-L2+1.75} L${-W2+.28} ${-L2+1.75}Z" fill="#20262d"/><path d="M${-W2+.25} ${L2-.75} L${W2-.25} ${L2-.75} L${W2-.18} ${L2-.35} Q0 ${L2-.22} ${-W2+.18} ${L2-.35}Z" fill="#20262d"/><rect x="${-W2-.16}" y="${-L2+1.3}" width=".16" height=".26" rx=".05" fill="#9aa1a8"/><rect x="${W2}" y="${-L2+1.3}" width=".16" height=".26" rx=".05" fill="#9aa1a8"/></g></svg>`; };
/* El SVG del coche usa y hacia abajo: el morro queda arriba (y negativa) */

/* ---------- Lienzos persistentes y bucle de dibujo ---------- */
function canvasEl(k){ return CS.cv[k]||(CS.cv[k]=Object.assign(document.createElement('canvas'),{className:'camcv'})); }
function mount(slotId,k){ const s=$(slotId); if(s){ const c=canvasEl(k); s.querySelectorAll('.camcv').forEach(o=>{ if(o!==c) o.remove(); }); if(c.parentNode!==s) s.prepend(c); } }
const birdKey=k=>birdMode()==='demo'?k+'D':k;
function birdCv(k){ const key=birdKey(k), c=canvasEl(key); if(key.endsWith('D')) c._demo=true; return c; }
function camLoop(){
  const act=[];
  if($('slotRev')) act.push(()=>renderSingle(CS.cv.rev,'rear'));
  if($('slotRevBird')) act.push(()=>renderBird(birdCv('revbird')));
  if($('slotSingle')) act.push(()=>renderSingle(CS.cv.single,CS.tab==='cal'?CS.calRole:CS.tab));
  if($('slotBird')&&birdMode()!=='grid'&&birdMode()!=='kit') act.push(()=>renderBird(birdCv('bird')));
  if(!act.length){ CS.raf=0; return; }
  act.forEach(f=>{ try{ f(); }catch(e){ console.warn(e); } }); CS.raf=requestAnimationFrame(camLoop);
}
const kick=()=>{ if(!CS.raf) CS.raf=requestAnimationFrame(camLoop); };
function setAspect(slot,role){ const v=CS.videos[role], s=$(slot); if(s&&v){ const f=()=>{ if(v.videoWidth) s.style.aspectRatio=v.videoWidth+'/'+v.videoHeight; }; f(); v.addEventListener('loadedmetadata',f,{once:true}); } }
function attachVideo(slot,role){ const s=$(slot), v=CS.videos[role]; if(s&&v&&v.parentNode!==s){ v.className='camvid'; s.prepend(v); } }

/* ---------- Pantalla de marcha atrás ---------- */
async function openRev(auto){
  clearTimeout(CS.revCloseT); if(CS.rev) return; CS.rev=true;
  if(!CAM.roles.rear){ CS.rev=false; if(!auto) toast('Asigna la cámara trasera en Cámaras › Ajustes'); return; }
  const side=CAM.kit?'kit':birdMode()==='stitch'||birdMode()==='demo'?'bird':'';
  const o=document.createElement('div'); o.id='rev';
  o.innerHTML=`<div class="rvmain"><div class="rvbox" id="slotRev">${guidesSVG()}</div><div class="rvtop"><b>MARCHA ATRÁS</b><span>Comprueba siempre el entorno</span></div><button class="pill rvx" data-cam="revclose">Cerrar</button></div>
    ${side?`<div class="rvside"><div class="birdbox" id="${side==='kit'?'slotRevKit':'slotRevBird'}">${side==='bird'?carSVG(3/4):''}</div><span>${side==='kit'?'Kit 360':'Visión 360'}</span></div>`:''}`;
  document.body.appendChild(o);
  if(CAM.duck&&MU.playing()){ MU.duck(true); CS.ducked=true; }
  await getVideo('rear'); if(!CS.rev) return;
  if(side==='bird') for(const r of ['front','left','right']) await getVideo(r);
  if(side==='kit'){ await getVideo('kit'); attachVideo('slotRevKit','kit'); }
  setAspect('slotRev','rear'); mount('slotRev','rev'); if(side==='bird') mount('slotRevBird',birdKey('revbird')); kick();
}
function closeRev(){ clearTimeout(CS.revCloseT); CS.rev=false; const o=$('rev'); if(o) o.remove(); if(CS.ducked){ MU.duck(false); CS.ducked=false; } if(S.view!=='camaras') stopCams(); }
async function pollRev(){
  let c=null; try{ c=await api('/api/camara'); }catch(e){}
  if(!c||!c.activo) return;
  if(c.atras!==CS.gpioRev){ CS.gpioRev=c.atras;
    if(c.atras){ openRev(true); } else if(CS.rev){ clearTimeout(CS.revCloseT); CS.revCloseT=setTimeout(closeRev,3500); } }
  setTimeout(pollRev,250);
}

/* ---------- App Cámaras ---------- */
const tabC=(k,l)=>`<button class="${CS.tab===k?'on':''}" data-cam="tab" data-k="${k}">${l}</button>`;
VIEWS.camaras=()=>{
  const bm=birdMode(), t=CS.tab;
  let body='';
  if(t==='rear'||t==='front'){
    body=CAM.roles[t]?`<div class="camwrap"><div class="camsingle" id="slotSingle">${t==='rear'?guidesSVG():''}</div></div>`
      :`<div class="empty"><p>No hay cámara ${roleName(t).toLowerCase()} asignada.</p><button class="pill on" data-cam="tab" data-k="cfg">Asignar cámaras</button></div>`;
  }
  if(t==='360'){
    if(bm==='kit') body=CAM.roles.kit?'<div class="camwrap"><div class="camsingle" id="slotKit"></div></div>':'<div class="empty"><p>Asigna la entrada del kit 360 en Ajustes.</p><button class="pill on" data-cam="tab" data-k="cfg">Ajustes</button></div>';
    else if(bm==='grid') body=`<div class="grid4">${['front','left','right','rear'].map(r=>`<div class="g4 g4-${r}" id="slot4-${r}"><small>${roleName(r)}</small></div>`).join('')}<div class="g4car">${carSVG()}</div></div><p class="note" style="margin-top:10px">Calibra cada cámara en Ajustes para unir las imágenes en una sola vista desde arriba.</p>`;
    else body=`<div class="birdwrap"><div class="birdbox big" id="slotBird">${carSVG()}</div></div>${bm==='demo'?'<p class="note" style="margin-top:10px">Demostración: así se verá con 4 cámaras calibradas.</p>':''}`;
  }
  if(t==='cfg') body=cfgHTML();
  if(t==='cal') body=calHTML();
  return `${appbar('Cámaras','<button class="pill" data-cam="test">Probar marcha atrás</button>')}<div class="abody"><div class="tabs">${tabC('rear','Trasera')}${tabC('360','Visión 360')}${tabC('front','Delantera')}${tabC('cfg','Ajustes')}</div>${body}</div>`;
};
function cfgHTML(){
  const opt=(r)=>`<select data-cam="role" data-r="${r}"><option value="">Ninguna</option><option value="demo" ${CAM.roles[r]==='demo'?'selected':''}>Demostración</option>${CS.devices.map((d,i)=>`<option value="${esc(d.deviceId)}" ${CAM.roles[r]===d.deviceId?'selected':''}>${esc(d.label||'Cámara '+(i+1))}</option>`).join('')}</select>`;
  const g=CAM.guides, rows=ROLES.filter(([r])=>r!=='kit'||CAM.kit);
  return `<div class="set"><div><b>Cámaras conectadas</b><div class="muted">${CS.devices.length?CS.devices.length+' encontradas':'Pulsa Buscar (el navegador pedirá permiso)'}</div></div><button class="pill on" data-cam="find">Buscar cámaras</button></div>
    ${rows.map(([r,n])=>`<div class="set"><div><b>${n}</b><div class="muted">${r==='kit'?'Salida de vídeo del kit 360 (capturadora USB)':CAM.cal[r]&&CAM.cal[r].H?'Calibrada':r==='rear'?'Se abre sola al meter la marcha atrás':'Sin calibrar'}</div></div><span style="display:flex;gap:8px;align-items:center">${opt(r)}${r!=='kit'?`<button class="pill" data-cam="calib" data-r="${r}" ${CAM.roles[r]?'':'disabled'}>Calibrar</button>`:''}</span></div>`).join('')}
    ${togRow('tKit',CAM.kit,'Uso un kit 360 comercial','El kit une las cámaras y Radar Play solo muestra su imagen')}
    ${togRow('tDuck',CAM.duck,'Bajar la música en marcha atrás','')}
    <h3 class="sh">Líneas de aparcamiento</h3>
    <p class="muted">${CAM.cal.rear&&CAM.cal.rear.H?'La cámara trasera está calibrada: las líneas marcan el ancho real del coche y 0,5 · 1 · 2 · 3 m.':'Sin calibrar: ajusta las líneas para que coincidan con el ancho del coche.'}</p>
    ${CAM.cal.rear&&CAM.cal.rear.H?'':`<div class="set"><b>Ancho abajo</b><input type="range" min="40" max="100" value="${Math.round(g.bottom*100)}" data-cam="gd" data-k="bottom"></div><div class="set"><b>Ancho arriba</b><input type="range" min="5" max="80" value="${Math.round(g.top*100)}" data-cam="gd" data-k="top"></div><div class="set"><b>Largo</b><input type="range" min="20" max="90" value="${Math.round(g.height*100)}" data-cam="gd" data-k="height"></div>`}`;
}
function calHTML(){
  const r=CS.calRole, c=CAM.cal[r]||{}, pts=c.pts||CALPTS[r];
  return `<div class="calgrid"><div><div class="camsingle cal" id="slotSingle">${CS.taps.map((p,i)=>`<span class="tap" style="left:${p[0]*100}%;top:${p[1]*100}%">${i+1}</span>`).join('')}</div>
      <p class="muted" style="margin:8px 0 0">${CS.taps.length<4?`Toca el punto <b>${CS.taps.length+1}</b> en la imagen.`:'Calibración guardada.'}</p></div>
    <div class="calside"><h3 class="sh" style="margin-top:0">Calibrar cámara ${roleName(r).toLowerCase()}</h3>
      <ol class="muted"><li>Con el coche parado en llano, pon 4 folios en el suelo en las posiciones del dibujo (medidas desde el centro del coche, en metros).</li><li>Si la imagen sale curvada, mueve «Ojo de pez» hasta que las rayas del suelo se vean rectas.</li><li>Toca los 4 folios en la imagen, en orden.</li></ol>
      <div class="set"><b>Ojo de pez</b><input type="range" min="-90" max="30" value="${Math.round((c.k||0)*100)}" data-cam="k"></div>
      ${togRow('tMir',c.m,'Imagen en espejo','Actívalo si la izquierda y la derecha salen al revés')}
      <div class="calpts">${pts.map((p,i)=>`<label>${i+1}<input type="number" step="0.1" value="${p[0]}" data-cam="pt" data-i="${i}" data-j="0"><input type="number" step="0.1" value="${p[1]}" data-cam="pt" data-i="${i}" data-j="1"></label>`).join('')}</div>
      <div class="calmini">${calMini(pts)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="pill" data-cam="retap">Volver a tocar</button><button class="pill" data-cam="uncal">Borrar calibración</button><button class="pill on" data-cam="tab" data-k="${r==='rear'?'rear':'360'}">Ver resultado</button></div></div></div>`;
}
function calMini(pts){ const s=4.2; return `<svg viewBox="${-s} ${-s} ${2*s} ${2*s}"><rect x="${-W2}" y="${-L2}" width="${CAR.W}" height="${CAR.L}" rx=".4" fill="#d9dde2"/><path d="M${-W2+.2} ${-L2+1.1} L${W2-.2} ${-L2+1.1} L${W2-.3} ${-L2+1.7} L${-W2+.3} ${-L2+1.7}Z" fill="#20262d"/>${pts.map((p,i)=>`<circle cx="${p[0]}" cy="${-p[1]}" r=".28" fill="#20c7b5"/><text x="${p[0]}" y="${-p[1]+.12}" font-size=".34" text-anchor="middle" fill="#000" font-weight="800">${i+1}</text>`).join('')}<text x="0" y="${-s+.4}" font-size=".32" text-anchor="middle" fill="#8a94a1">DELANTE</text></svg>`; }

async function camViewOpened(){
  const t=CS.tab, need=t==='360'?(birdMode()==='kit'?['kit']:['front','rear','left','right']):t==='cal'?[CS.calRole]:t==='cfg'?[]:[t];
  stopCams(CS.rev?['rear','front','left','right','kit'].concat(need):need);
  for(const r of need) await getVideo(r);
  if(S.view!=='camaras') return;
  if(t==='rear'||t==='front'||t==='cal'){ setAspect('slotSingle',t==='cal'?CS.calRole:t); mount('slotSingle','single'); }
  if(t==='360'){ const bm=birdMode(); if(bm==='kit'){ attachVideo('slotKit','kit'); setAspect('slotKit','kit'); } else if(bm==='grid') ['front','left','right','rear'].forEach(r=>attachVideo('slot4-'+r,r)); else mount('slotBird',birdKey('bird')); }
  if(t==='cfg'&&!CS.devices.length) findCams(false).then(()=>{ if(S.view==='camaras'&&CS.tab==='cfg'&&CS.devices.length) renderApp(); });
  kick();
}
const _renderApp3=renderApp; renderApp=function(){ _renderApp3(); if(S.view==='camaras') camViewOpened(); else if(!CS.rev) stopCams(); };

document.addEventListener('click',e=>{
  const el=e.target.closest('[data-cam]'); if(!el||el.disabled||el.tagName==='SELECT'||el.tagName==='INPUT') return; e.stopPropagation(); const d=el.dataset;
  switch(d.cam){
    case 'tab': CS.tab=d.k; renderApp(); break;
    case 'test': CS.rev?closeRev():openRev(false); break;
    case 'revclose': closeRev(); break;
    case 'find': findCams(true).then(()=>renderApp()); break;
    case 'calib': CS.calRole=d.r; CS.taps=[]; CS.tab='cal'; renderApp(); break;
    case 'retap': CS.taps=[]; renderApp(); break;
    case 'uncal': delete CAM.cal[CS.calRole]; saveCam(); CS.taps=[]; toast('Calibración borrada'); renderApp(); break;
  }
});
document.addEventListener('click',e=>{   // toques sobre la imagen al calibrar
  const s=e.target.closest('.camsingle.cal'); if(!s||CS.tab!=='cal'||CS.taps.length>=4) return;
  const r=s.getBoundingClientRect(); CS.taps.push([(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]);
  if(CS.taps.length===4){ const c=CAM.cal[CS.calRole]=CAM.cal[CS.calRole]||{}; const pts=c.pts||CALPTS[CS.calRole];
    const H=homography(pts,CS.taps); if(H){ c.H=H; c.pts=pts; saveCam(); toast('Cámara '+roleName(CS.calRole).toLowerCase()+' calibrada'); } else { toast('Los puntos no valen: tócalos otra vez en orden'); CS.taps=[]; } }
  renderApp();
});
document.addEventListener('change',e=>{ const el=e.target; if(!el.dataset||!el.dataset.cam) return; const d=el.dataset;
  if(d.cam==='role'){ CAM.roles[d.r]=el.value; saveCam(); stopCams(); renderApp(); }
  if(d.cam==='pt'){ const c=CAM.cal[CS.calRole]=CAM.cal[CS.calRole]||{}; c.pts=(c.pts||CALPTS[CS.calRole]).map(p=>p.slice()); c.pts[+d.i][+d.j]=parseFloat(el.value)||0; delete c.H; CS.taps=[]; saveCam(); renderApp(); }
});
document.addEventListener('input',e=>{ const el=e.target; if(!el.dataset||!el.dataset.cam) return; const d=el.dataset;
  if(d.cam==='k'){ const c=CAM.cal[CS.calRole]=CAM.cal[CS.calRole]||{}; c.k=el.value/100; delete c.H; CS.taps=[]; saveCam(); }
  if(d.cam==='gd'){ CAM.guides[d.k]=el.value/100; saveCam(); const g=document.querySelector('#slotSingle .guides'); if(g) g.outerHTML=guidesSVG(); }
});
document.addEventListener('click',e=>{ const t=e.target.closest('#tKit,#tDuck,#tMir'); if(!t||S.view!=='camaras') return; e.stopPropagation();
  if(t.id==='tKit'){ CAM.kit=!CAM.kit; stopCams(); } if(t.id==='tDuck') CAM.duck=!CAM.duck;
  if(t.id==='tMir'){ const c=CAM.cal[CS.calRole]=CAM.cal[CS.calRole]||{}; c.m=!c.m; delete c.H; CS.taps=[]; }
  saveCam(); renderApp(); },true);
document.addEventListener('keydown',e=>{ if(e.target.matches('input,textarea,select')) return; if(e.key==='r'||e.key==='R'){ CS.rev?closeRev():openRev(false); } });

/* Siri: «marcha atrás», «cámara trasera», «visión 360» */
const _siriHandle=siriHandle; siriHandle=async function(text){
  const n=nrm(text);
  if(/(marcha atras|camara trasera|camara de atras|aparcar)/.test(n)){ SR.close(); openRev(false); return; }
  if(/(vision|vista)\s*(360|de pajaro|desde arriba)|camara(s)? 360|^camaras$/.test(n)){ SR.close(); CS.tab='360'; setView('camaras'); return; }
  return _siriHandle(text);
};

(async()=>{ if(!location.protocol.startsWith('http')) return; try{ const c=await api('/api/camara'); if(c&&c.activo) pollRev(); }catch(e){} })();
