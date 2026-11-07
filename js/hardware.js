/* =====================================================================
   Radar Play · Hardware (Sistema)
   Lista de lo que se puede ir conectando poco a poco, con su estado y
   cómo activarlo. Todo es opcional: sin nada conectado, Radar Play
   funciona con datos simulados.
   ===================================================================== */
const HW={cam:null,t:0};
async function hwLoad(){ if(!SYS.bridge||Date.now()-HW.t<5000) return; HW.t=Date.now();
  try{ HW.cam=await api('/api/camara'); }catch(e){}
  try{ if(typeof findCams==='function') await findCams(false); }catch(e){} }
function hwHTML(){
  const i=SYS.info||{}, g=i.gps||{}, c=i.contacto||{}, k=HW.cam||{}, cams=(typeof CS!=='undefined'&&CS.devices)?CS.devices.length:0;
  const w=Math.round(screen.width*devicePixelRatio), h=Math.round(screen.height*devicePixelRatio), tactil=navigator.maxTouchPoints>0;
  const row=(n,st,cls,txt,como)=>`<div class="hw-r"><span class="chip ${cls}">${st}</span><div><b>${n}</b><span>${txt}</span>${como?`<small>${como}</small>`:''}</div></div>`;
  return `<h3 class="sh">Hardware</h3><p class="muted" style="margin:6px 0 4px">Todo es opcional: conecta las piezas poco a poco. Lo que falte se simula.</p><div class="hw">
    ${row('Pantalla',w+'×'+h,w>=1024&&h>=600?'ok':'pronto',(tactil?'Táctil':'Sin táctil detectado')+' · Radar Play está pensado para 1280×720 (también 1024×600 y 1280×800)',w<h?'Está en vertical: pon PANTALLA_GIRO=90 en sistema/radar-play.conf':'')}
    ${row('Internet',i.wifi||i.ip?'Conectado':'Sin red',i.wifi||i.ip?'ok':'pronto',i.wifi?'WiFi '+esc(i.wifi.ssid):i.ip?'IP '+esc(i.ip):'Hace falta para Google Maps y la música','Punto de acceso del iPhone, o un módem 4G USB (Huawei E3372 o similar)')}
    ${row('GPS USB',g.ok?'Con señal':g.estado&&/sin señal|buscando/i.test(g.estado)?'Buscando':'No',g.ok?'ok':'',g.ok?(g.sats!=null?g.sats+' satélites':'Posición real'):'Sin GPS, la posición sale de la ruta simulada','u-blox 7/8 (tipo VK-162). Se detecta solo; si no, cambia GPS_PUERTO')}
    ${row('Lector OBD-II',E.real?'En directo':'No',E.real?'ok':'',E.real?'Revoluciones, turbo, temperaturas y consumo reales':(E.obdMsg||'Los datos del motor se simulan'),'ELM327 USB (mejor) o Bluetooth. OBD_PUERTO=auto lo busca solo')}
    ${row('Cable de la llave',c.activo?(c.on?'Contacto':'Quitada'):'Desactivado',c.activo?'ok':'',c.activo?'Se apaga sola al quitar la llave':'Apagado automático al quitar la llave','Optoacoplador del cable de contacto a un GPIO y PIN_CONTACTO=número')}
    ${row('Marcha atrás',k.activo?'Conectado':'Desactivado',k.activo?'ok':'',k.activo?'La cámara trasera se abre sola':'Abrir la cámara al meter la marcha atrás','Optoacoplador de la luz de marcha atrás a un GPIO y PIN_MARCHA_ATRAS=número')}
    ${row('Cámaras USB',cams?cams+(cams===1?' cámara':' cámaras'):'Ninguna',cams?'ok':'',cams?'Configúralas en Cámaras › Ajustes':'Se ven imágenes de demostración','Cámara trasera USB; para 360°, cuatro gran angular (una por lado)')}
  </div>`;
}
document.head.insertAdjacentHTML('beforeend',`<style>
.hw{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 22px}
.hw-r{display:flex;gap:12px;align-items:flex-start;padding:12px 4px;border-bottom:1px solid var(--line);min-width:0}
.hw-r .chip{min-width:92px;text-align:center;margin-top:2px}
.hw-r>div{min-width:0}.hw-r b{display:block}.hw-r span{color:var(--muted);font-size:13.5px;display:block}
.hw-r small{display:block;color:var(--muted);font-size:12.5px;margin-top:3px;opacity:.8}
@media (max-width:1000px){.hw{grid-template-columns:1fr}}
</style>`);
const _vSis2=VIEWS.sistema; VIEWS.sistema=()=>{ const s=_vSis2(); return SYS.bridge?s.replace('<h3 class="sh">Pantalla y sonido</h3>',hwHTML()+'<h3 class="sh">Pantalla y sonido</h3>'):s; };
const _rApp6=renderApp; renderApp=function(){ _rApp6(); if(S.view==='sistema'&&SYS.bridge&&Date.now()-HW.t>5000) hwLoad().then(()=>{ if(S.view==='sistema'&&$('ov').hidden) _rApp6(); }); };
