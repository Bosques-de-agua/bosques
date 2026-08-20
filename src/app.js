// Preferencias de cada persona: quedan en SU navegador y no viajan al equipo.
// Cualquier clave nueva que sea personal tiene que sumarse acá, o se le
// aparecería al resto (y además haría escribir la base sin necesidad).
const LOCAL_KEYS=["me","theme","palette","navRail","panelView","tab","estProj","estFocus","treeOpen","taskFilters","panelFilter","chatSeen","tasksSeen"];
// Datos personales: van a una tabla propia con permisos, nunca a la fila compartida.
const PRIV_KEYS=["privTasks","myNotes"];
const PREFS_KEY="mesa-bosques-prefs";

function loadLocalPrefs(){
  try{ const raw=JSON.parse(localStorage.getItem(PREFS_KEY)||"{}"); const o={};
    LOCAL_KEYS.forEach(k=>{ if(k in raw)o[k]=raw[k]; }); return o; }
  catch(e){ return {}; }
}
function saveLocalPrefs(state){
  try{ const o={}; LOCAL_KEYS.forEach(k=>{ if(state[k]!==undefined)o[k]=state[k]; });
    localStorage.setItem(PREFS_KEY,JSON.stringify(o)); }catch(e){}
}
function stripLocal(state){ const o=Object.assign({},state); LOCAL_KEYS.forEach(k=>delete o[k]); return o; }
// Del payload compartido se saca SOLO la porción privada propia. Las de quienes
// todavía no entraron después de la migración quedan intactas hasta que cada
// uno las mueva: borrarlas de una les haría perder sus notas y tareas privadas.
function stripShared(state){ const o=stripLocal(state); const me=state.me;
  PRIV_KEYS.forEach(k=>{ const v=o[k];
    if(!v||typeof v!=="object"){ delete o[k]; return; }
    const resto=Object.assign({},v); if(me)delete resto[me];
    if(Object.keys(resto).length)o[k]=resto; else delete o[k]; });
  return o; }

export function startApp({ seed, priv, yo, team, pushRemoteState, pushPrivateState, saveMember, inviteEmail, refreshTeam, hayPendiente }){
  // El equipo viene de la base (tabla team_members), no del estado compartido.
  // Cada persona ES su email; el nombre es solo la etiqueta que se muestra.
  let equipo = Array.isArray(team) ? team.slice() : [];
  const miEmail = yo && yo.email ? yo.email : "";
  const miembroPorNombre = n => equipo.find(m => m.name === n) || null;
  const miembroPorEmail  = e => equipo.find(m => m.email === e) || null;
  const nombresEquipo = () => equipo.map(m => m.name).filter(Boolean);

  const DAY=86400000, ARCH_DAYS=7;
  const STATUS={curso:{l:"En curso",v:"--s-curso"},espera:{l:"En espera",v:"--s-espera"},sin:{l:"Sin empezar",v:"--s-sin"},listo:{l:"Terminado",v:"--s-listo"}};
  const STORD=["sin","curso","espera","listo"];
  const PRIO={alta:{l:"Alta",v:"--p-alta"},media:{l:"Media",v:"--p-media"},baja:{l:"Baja",v:"--p-baja"}};
  const PRORD=["alta","media","baja"]; // la prioridad es opcional: "" = sin prioridad
  const prioOf=k=>PRIO[k.prio]||null;
  const LVL=["--l1","--l2","--l3","--l4","--l5","--l6"];
  // Colores de persona: tonos profundos y bien distintos entre sí. Van siempre
  // dentro de círculos con iniciales o foto, así que la forma ya los separa de
  // las otras paletas (estado, prioridad, nivel) aunque compartan familia.
  const AV=["#5b53c4","#a8358f","#0f7d8c","#b0563a","#6b7a1f","#8e4bc9","#1b6b4f","#a63d5e","#3f6fb5","#8a5a2b"];
  const OX=3000,OY=2000;

  let state=null, active="mapa", selId=null, cam={tx:0,ty:0,s:1}, linking=false, linkSrc=null, editing=false, taskGroup="estado", cal={y:null,m:null};
  const off=new Set(), treeOpen=new Set();
  let dragTask=null, dragCard=null, colClickTimer=null, chatChan="team";

  const N=id=>state.nodes[id];
  // id único de verdad: un contador compartido genera choques apenas dos personas creen algo a la vez
  function uid(){ state.seq=(state.seq||0)+1;
    try{ if(crypto&&crypto.randomUUID)return crypto.randomUUID().slice(0,12); }catch(e){}
    return "n"+state.seq.toString(36)+Math.floor(Math.random()*1e6).toString(36); }
  const cssv=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim()||"#888";
  const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const initials=n=>{ if(!n)return"?"; const p=n.trim().split(/\s+/); return (p[0][0]+(p[1]?p[1][0]:"")).toUpperCase(); };
  // El color y la foto salen de la ficha del equipo; lo del estado compartido
  // queda solo como respaldo para datos anteriores a esa tabla.
  const avColor=n=>{ const m=miembroPorNombre(n); if(m&&m.color)return m.color;
    const c=state&&state.userColors&&state.userColors[n]; if(c)return c;
    let h=0; for(const ch of (n||"")) h=(h*31+ch.charCodeAt(0))>>>0; return AV[h%AV.length]; };
  const avFoto=n=>{ const m=miembroPorNombre(n); if(m&&m.avatar)return m.avatar;
    return (state&&state.avatars)?state.avatars[n]:null; };
  function avatarMarkup(name,cls,withTitle){ const t=withTitle?` title="${esc(name)}"`:""; const ph=avFoto(name); if(ph)return `<span class="${cls} hasimg" style="background-image:url('${ph}')"${t}></span>`; return `<span class="${cls}" style="background:${avColor(name)}"${t}>${esc(initials(name))}</span>`; }
  function loadAvatar(file,cb){ const r=new FileReader(); r.onload=()=>{ const img=new Image(); img.onload=()=>{ const S=80,c=document.createElement("canvas"); c.width=S;c.height=S; const x=c.getContext("2d"); const m=Math.min(img.width,img.height); x.drawImage(img,(img.width-m)/2,(img.height-m)/2,m,m,0,0,S,S); cb(c.toDataURL("image/jpeg",0.82)); }; img.src=r.result; }; r.readAsDataURL(file); }
  function depthOf(n){ let d=1,x=n; while(x&&x.parent){ d++; x=N(x.parent); } return d; }
  function accentOf(node){ if(node.hue!=null) return `hsl(${node.hue} 45% 52%)`; return cssv(LVL[Math.min(depthOf(node),LVL.length)-1]); }
  function baseSize(node){ const d=depthOf(node); const b=d===1?172:d===2?150:d===3?116:d===4?100:88; return Math.round(b*(node.scale||1)); }
  function childrenOf(id){ const n=N(id); return n?(n.children||[]).map(N).filter(Boolean):[]; }
  function pathOf(id){ const a=[]; let x=N(id); while(x){ a.unshift(x); x=N(x.parent); } return a; }
  function keyFor(a,b){ return a<b?a+"|"+b:b+"|"+a; }
  function EM(){ return state.edgeMeta||(state.edgeMeta={}); }
  function setEdgeMeta(k,o){ const e=EM(); e[k]=Object.assign({},e[k],o); }
  function ownersOf(k){ if(!Array.isArray(k.owners)) k.owners=(k.owner&&String(k.owner).trim())?[String(k.owner).trim()]:[]; return k.owners; }
  function encsOf(n){ if(!Array.isArray(n.encargados)) n.encargados=(n.encargado&&String(n.encargado).trim())?[String(n.encargado).trim()]:[]; return n.encargados; }
  const peopleLabel=a=>a.join(", ");
  function agg(node){ let nc=0,ic=0,dc=0; const owners=new Set(),st=new Set();
    encsOf(node).forEach(o=>owners.add(o));
    (node.items||[]).forEach(k=>{ if(k.archived)return; ic++; ownersOf(k).forEach(o=>owners.add(o)); st.add(k.status); if(k.done)dc++; });
    (node.children||[]).forEach(cid=>{ const c=N(cid); if(!c)return; nc++; const a=agg(c); nc+=a.nc; ic+=a.ic; dc+=a.dc; a.owners.forEach(o=>owners.add(o)); a.st.forEach(s=>st.add(s)); });
    return {nc,ic,dc,owners,st}; }
  // diálogos propios: en el visor de artifacts confirm/alert/prompt están bloqueados
  let askCb=null;
  function dialog(o){ const m=document.getElementById("askModal");
    document.getElementById("askTitle").textContent=o.title||"Confirmar";
    document.getElementById("askMsg").textContent=o.msg||"";
    const inp=document.getElementById("askInput");
    if(o.input){ inp.style.display=""; inp.placeholder=o.placeholder||""; inp.value=o.value||""; } else inp.style.display="none";
    const no=document.getElementById("askNo"); no.style.display=o.onlyOk?"none":""; no.textContent=o.no||"Cancelar";
    const yes=document.getElementById("askYes"); yes.textContent=o.yes||(o.onlyOk?"Entendido":"Sí"); yes.classList.toggle("danger",!!o.danger);
    askCb=o.cb||null; m.classList.add("on"); if(o.input)setTimeout(()=>inp.focus(),40); else setTimeout(()=>yes.focus(),40); }
  function closeAsk(){ document.getElementById("askModal").classList.remove("on"); askCb=null; }
  function note(msg,title){ dialog({title:title||"Aviso",msg,onlyOk:true}); }
  // Deshacer un borrado. A propósito NO guarda una copia del estado entero:
  // restaurarla pisaría lo que otra persona hizo mientras tanto. Guarda solo
  // lo borrado y lo vuelve a insertar sobre el estado del momento.
  let undoT=null;
  function ofrecerDeshacer(texto,rehacer){
    const bar=document.getElementById("undoBar"); if(!bar){ return; }
    document.getElementById("undoMsg").innerHTML=texto;
    bar.classList.add("on"); clearTimeout(undoT);
    const btn=document.getElementById("undoBtn");
    const cerrar=()=>{ bar.classList.remove("on"); btn.onclick=null; clearTimeout(undoT); };
    btn.onclick=()=>{ cerrar(); try{ rehacer(); }catch(e){ note("No se pudo deshacer."); } save(); refreshChrome(); renderActive(); };
    undoT=setTimeout(cerrar,9000);
  }
  function confirmar(msg,cb,o){ dialog(Object.assign({title:"¿Confirmás?",msg,yes:"Sí, dale",cb:()=>cb()},o||{})); }
  function pedirTexto(title,placeholder,cb){ dialog({title,msg:"",input:true,placeholder,yes:"Agregar",cb:v=>{ if(v&&v.trim())cb(v.trim()); }}); }
  // ---------- archivos de Drive (vínculos, no copias) ----------
  // ICONOS DE LINEA — reemplazan a los emojis. Un emoji es un dibujo
  // multicolor que pinta el sistema operativo: cambia según el dispositivo y
  // no puede tomar el cobre ni el oliva del tema. Estos son monocromáticos y
  // heredan el color del texto que tienen al lado.
  const ICO={
    doc:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><path d=\"M6 3h5l3 3v11H6z\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"/><path d=\"M11 3v3h3M8 10h4M8 13h4\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"/></svg>",
    sheet:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><rect x=\"4\" y=\"4\" width=\"12\" height=\"12\" rx=\"1.4\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M4 8.5h12M8.5 8.5V16M4 12.3h12\" stroke=\"currentColor\" stroke-width=\"1.2\"/></svg>",
    slides:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><rect x=\"3.5\" y=\"4.5\" width=\"13\" height=\"9\" rx=\"1.4\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M10 13.5v2.5M7.5 16h5\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/></svg>",
    form:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><rect x=\"5\" y=\"3.5\" width=\"10\" height=\"13\" rx=\"1.4\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M8 7.5h4M8 10.5h4M8 13.5h2\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"/></svg>",
    folder:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><path d=\"M3.5 6.5A1.5 1.5 0 0 1 5 5h3l1.5 2H15a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 15 16H5a1.5 1.5 0 0 1-1.5-1.5z\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"/></svg>",
    pdf:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><path d=\"M6 3h5l3 3v11H6z\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"/><path d=\"M11 3v3h3\" stroke=\"currentColor\" stroke-width=\"1.3\"/><path d=\"M8 12.5h4\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>",
    clip:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><path d=\"M13.6 9.4l-4.3 4.3a2.6 2.6 0 0 1-3.7-3.7l5.1-5.1a1.8 1.8 0 0 1 2.5 2.5l-5 5a1 1 0 0 1-1.4-1.4l4.4-4.4\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
    link:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><path d=\"M8.5 11.5l3-3M7.6 13.4a2.8 2.8 0 0 1 0-4l1.2-1.2M11.2 6.6l1.2-1.2a2.8 2.8 0 0 1 4 4l-1.2 1.2\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/></svg>",
    imagen:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><rect x=\"3.5\" y=\"4.5\" width=\"13\" height=\"11\" rx=\"1.5\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M3.5 12.4l3.5-3 3 2.4 2.5-2 4 3.4\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linejoin=\"round\"/><circle cx=\"7.4\" cy=\"8\" r=\"1.1\" stroke=\"currentColor\" stroke-width=\"1.2\"/></svg>",
    archivar:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><rect x=\"3.5\" y=\"4\" width=\"13\" height=\"3.4\" rx=\"1\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M5 7.4v7.1A1.5 1.5 0 0 0 6.5 16h7a1.5 1.5 0 0 0 1.5-1.5V7.4\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M8.4 10.4h3.2\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/></svg>",
    calendario:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><rect x=\"3.5\" y=\"5\" width=\"13\" height=\"11.5\" rx=\"1.5\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M3.5 8.6h13M7 3.5v3M13 3.5v3\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/></svg>",
    reloj:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><circle cx=\"10\" cy=\"10\" r=\"6.5\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M10 6.4V10l2.6 1.6\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/></svg>",
    candado:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><rect x=\"5\" y=\"9\" width=\"10\" height=\"7.5\" rx=\"1.5\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M7.5 9V7a2.5 2.5 0 0 1 5 0v2\" stroke=\"currentColor\" stroke-width=\"1.4\"/></svg>",
    nota:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><path d=\"M5 4.5h10v8l-3 3H5z\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"/><path d=\"M15 12.5h-3v3M7.6 8h4.8M7.6 11h3\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"/></svg>",
    equipo:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><circle cx=\"7.6\" cy=\"8\" r=\"2.4\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M3.6 15.6c0-2.2 1.8-3.7 4-3.7s4 1.5 4 3.7\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/><path d=\"M13.4 6.2a2.4 2.4 0 0 1 0 4.6M14.4 12.4c1.3.5 2.1 1.7 2.1 3.2\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/></svg>",
    grupo:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><path d=\"M4 8h12M4 12.4h12M8.6 4L7.1 16M13.4 4L11.9 16\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/></svg>",
    persona:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><circle cx=\"10\" cy=\"7.4\" r=\"2.8\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M4.8 16.2c0-2.7 2.3-4.4 5.2-4.4s5.2 1.7 5.2 4.4\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/></svg>",
    si:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><circle cx=\"10\" cy=\"10\" r=\"6.5\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M7 10.2l2.1 2.1L13 8.4\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
    ojo:"<svg class=\"ico\" viewBox=\"0 0 20 20\" fill=\"none\" aria-hidden=\"true\"><path d=\"M2.6 10S5.5 5.4 10 5.4 17.4 10 17.4 10 14.5 14.6 10 14.6 2.6 10 2.6 10Z\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"/><circle cx=\"10\" cy=\"10\" r=\"2.2\" stroke=\"currentColor\" stroke-width=\"1.4\"/></svg>"
  };
  const FKIND={doc:{i:ICO.doc,l:"Documento"},sheet:{i:ICO.sheet,l:"Hoja de cálculo"},slides:{i:ICO.slides,l:"Presentación"},form:{i:ICO.form,l:"Formulario"},folder:{i:ICO.folder,l:"Carpeta"},pdf:{i:ICO.pdf,l:"PDF"},word:{i:ICO.doc,l:"Word"},excel:{i:ICO.sheet,l:"Excel"},ppt:{i:ICO.slides,l:"PowerPoint"},image:{i:ICO.imagen,l:"Imagen"},file:{i:ICO.clip,l:"Archivo"},link:{i:ICO.link,l:"Link"}};
  // Un PDF o un Word subidos a Drive tienen URL "drive.google.com/file/d/…/view":
  // no dice nada del tipo. La segunda pista es la extension del nombre, que es
  // lo que la persona escribe al vincularlo.
  function kindOfName(n){ const x=String(n||"").toLowerCase();
    if(/\.pdf$/.test(x))return "pdf";
    if(/\.docx?$/.test(x)||/\.odt$/.test(x)||/\.rtf$/.test(x))return "word";
    if(/\.xlsx?$/.test(x)||/\.csv$/.test(x)||/\.ods$/.test(x))return "excel";
    if(/\.pptx?$/.test(x)||/\.odp$/.test(x))return "ppt";
    if(/\.(png|jpe?g|gif|webp|heic|svg|tiff?)$/.test(x))return "image";
    return null; }
  function kindOf(url,name){ const porUrl=kindOfUrl(url);
    // La URL manda cuando es un documento nativo de Google: ahi es exacta.
    if(porUrl!=="file"&&porUrl!=="link")return porUrl;
    return kindOfName(name)||kindOfName(url)||porUrl; }
  function kindOfUrl(u){ const s=String(u||"").toLowerCase();
    if(s.includes("docs.google.com/document"))return "doc";
    if(s.includes("docs.google.com/spreadsheets"))return "sheet";
    if(s.includes("docs.google.com/presentation"))return "slides";
    if(s.includes("docs.google.com/forms"))return "form";
    if(s.includes("drive.google.com/drive/folders")||s.includes("drive.google.com/drive/u/")&&s.includes("/folders/"))return "folder";
    if(s.endsWith(".pdf"))return "pdf";
    if(s.includes("drive.google.com"))return "file";
    return "link"; }
  function filesOf(o){ if(!Array.isArray(o.files))o.files=[]; return o.files; }
  // ---------- ver el archivo sin salir de la app ----------
  // Drive publica de cada archivo una vista de SOLO LECTURA en la direccion
  // .../preview, y esa si se deja incrustar (la de /edit y /view no: las
  // bloquea el propio Google). No hace falta permiso de Google ni verificacion
  // de la app: quien mira usa la sesion de Google que ya tiene abierta en su
  // navegador, asi que ve exactamente lo que Drive le deja ver, ni mas ni
  // menos. Las carpetas siguen sin poder mostrarse adentro.
  function previewUrl(url){ const s=String(url||"");
    if(!/^https:\/\/(docs|drive)\.google\.com\//i.test(s))return null;   // solo Drive se deja incrustar
    if(/\/folders\//i.test(s))return null;                               // una carpeta no tiene vista propia
    // Los identificadores de Drive son largos; pedir 20 caracteres o mas evita
    // confundirse con el "/d/e/" de los formularios publicados.
    const id=(s.match(/\/d\/([-\w]{20,})/)||s.match(/[?&]id=([-\w]{20,})/)||[])[1];
    const idForm=(s.match(/\/forms\/d\/e\/([-\w]{20,})/)||[])[1];
    if(idForm)return `https://docs.google.com/forms/d/e/${idForm}/viewform?embedded=true`;
    if(!id)return null;
    if(/\/document\//i.test(s))return `https://docs.google.com/document/d/${id}/preview`;
    if(/\/spreadsheets\//i.test(s))return `https://docs.google.com/spreadsheets/d/${id}/preview`;
    if(/\/presentation\//i.test(s))return `https://docs.google.com/presentation/d/${id}/preview`;
    if(/\/forms\//i.test(s))return `https://docs.google.com/forms/d/${id}/viewform?embedded=true`;
    if(/^https:\/\/drive\.google\.com\//i.test(s))return `https://drive.google.com/file/d/${id}/preview`;
    return null; }
  // El boton solo aparece si el archivo se puede mostrar adentro. Lo que no se
  // puede (carpetas, links de afuera) queda como estaba: se abre en Drive.
  function verBtn(f){ const p=previewUrl(f.url); if(!p)return "";
    return `<button class="fver" data-ver="${esc(p)}" data-vernm="${esc(f.name||f.url)}" data-verk="${esc(f.kind||"link")}" data-verurl="${esc(f.url)}" title="Ver acá">${ICO.ojo}</button>`; }
  function fileRow(f,onDel){ const k=FKIND[f.kind]||FKIND.link;
    return `<div class="filerow" data-f="${f.id}"><span class="fic" title="${k.l}">${k.i}</span><a class="fnm" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer" title="${esc(f.url)}">${esc(f.name||f.url)}</a>${verBtn(f)}${onDel?`<button class="x" data-delf="${f.id}" title="Desvincular">✕</button>`:""}</div>`; }
  // Archivos que cuelgan de los sub-temas de un tema (y de sus tareas).
  function filesHeredados(node){ const out=[];
    const bajar=id=>{ const n=N(id); if(!n)return;
      filesOf(n).forEach(f=>out.push({f,node:n,task:null}));
      (n.items||[]).forEach(k=>filesOf(k).forEach(f=>out.push({f,node:n,task:k})));
      (n.children||[]).forEach(bajar); };
    (node.children||[]).forEach(bajar); return out; }
  function renderFileList(el,owner,after){ const fs=filesOf(owner);
    let html=fs.map(f=>fileRow(f,true)).join("");
    // Entrás a un tema y ves todo lo que cuelga de ahí para abajo, no solo lo
    // vinculado al tema exacto. Lo heredado va marcado con su ruta y no se
    // puede desvincular desde acá: se desvincula donde vive.
    const hered=Array.isArray(owner.children)?filesHeredados(owner):[];
    if(hered.length) html+=`<div class="dsublab">De los sub-temas</div>`+hered.map(x=>{
      const k=FKIND[x.f.kind]||FKIND.link;
      const ruta=pathOf(x.node.id).map(z=>z.name).slice(pathOf(owner.id).length).join(" › ")+(x.task?" › "+(x.task.title||"Tarea"):"");
      return `<div class="filerow hered"><span class="fic" title="${k.l}">${k.i}</span><a class="fnm" href="${esc(x.f.url)}" target="_blank" rel="noopener noreferrer">${esc(x.f.name||x.f.url)}</a><span class="fpath" title="${esc(ruta)}">${esc(ruta)}</span>${verBtn(x.f)}</div>`; }).join("");
    el.innerHTML=html||`<div class="empty">Sin archivos. Pegá el link de Drive con "＋ archivo de Drive".</div>`;
    el.querySelectorAll("[data-delf]").forEach(b=>b.addEventListener("click",()=>{ const id=b.dataset.delf;
      confirmar("Se saca el link de acá. El archivo sigue intacto en Drive.",()=>{ owner.files=filesOf(owner).filter(f=>f.id!==id); save(); if(after)after(); },{title:"Desvincular archivo",yes:"Desvincular"}); })); }
  function allFiles(){ const out=[];
    // incluye las tareas archivadas: el archivo sigue siendo del tema aunque la tarea ya esté hecha
    Object.values(state.nodes).forEach(n=>{ filesOf(n).forEach(f=>out.push({f,node:n,task:null}));
      (n.items||[]).forEach(k=>{ filesOf(k).forEach(f=>out.push({f,node:n,task:k,archived:!!k.archived})); }); });
    return out; }
  function privList(who){ if(!state.privTasks)state.privTasks={}; const w=who||state.me; if(!w)return null; return state.privTasks[w]||(state.privTasks[w]=[]); }
  const privL=who=>privList(who)||[];   // para leer sin riesgo de escribir en un array descartable
  function allItems(){ const out=[]; Object.values(state.nodes).forEach(n=>(n.items||[]).forEach(k=>out.push({k,node:n}))); return out; }
  function activeItems(){ return allItems().filter(x=>!x.k.archived); }
  // La lista del equipo manda; se le suman nombres sueltos que hayan quedado
  // asignados en tareas viejas, para no hacerlos desaparecer.
  function allPeople(){ const s=new Set(nombresEquipo());
    if(!s.size)(state.members||[]).forEach(p=>s.add(p));
    Object.values(state.nodes).forEach(n=>{ encsOf(n).forEach(o=>s.add(o)); (n.items||[]).forEach(k=>{ ownersOf(k).forEach(o=>s.add(o)); }); });
    Object.values(state.privTasks||{}).forEach(arr=>(arr||[]).forEach(k=>ownersOf(k).forEach(o=>s.add(o))));
    return [...s].filter(Boolean).sort((a,b)=>a.localeCompare(b)); }
  function newTask(){ return {id:"i"+uid(),title:"",owners:[],status:"sin",prio:"",due:"",notas:"",objetivo:"",done:false,doneAt:null,archived:false,archivedAt:null,files:[]}; }
  function archiveTask(k){ if(k.status!=="listo")setStatus(k,"listo"); if(!k.doneAt)k.doneAt=nowMs(); k.archived=true; k.archivedAt=nowMs(); }
  function newNode(o){ const id=uid(); state.nodes[id]=Object.assign({id,kind:"neuron",parent:null,children:[],x:0,y:0,prio:"media",hue:null,scale:1,objetivo:"",contexto:"",encargados:[],links:[],items:[]},o); return id; }
  function setStatus(k,st){ k.status=st; if(st==="listo"){ k.done=true; if(!k.doneAt)k.doneAt=nowMs(); } else { k.done=false; k.doneAt=null; k.archived=false; k.archivedAt=null; } }
  function setDone(k,val){ setStatus(k, val?"listo":(k.status==="listo"?"curso":k.status)); }
  function nowMs(){ return new Date().getTime(); }

  function doLayout(nodes,roots){ const G=id=>nodes[id]; const M={}; const LEAF=100; const SPAN=Math.PI*1.6;
    function radius(id){ const ch=(G(id).children||[]).filter(G); if(!ch.length){ M[id]={r:LEAF}; return LEAF; }
      const crs=ch.map(radius); const maxc=Math.max.apply(null,crs); const sum=crs.reduce((a,b)=>a+b,0);
      const ring=Math.max(sum*2.4/SPAN, maxc*1.7, 170); M[id]={r:ring+maxc,ring,crs}; return M[id].r; }
    function place(id,cx,cy,facing){ const n=G(id); n.x=cx; n.y=cy; const ch=(n.children||[]).filter(G); if(!ch.length)return; const m=M[id]; const total=m.crs.reduce((a,b)=>a+b,0)||1; let ang=facing-SPAN/2; ch.forEach((cid,i)=>{ const sweep=(m.crs[i]/total)*SPAN; const a=ang+sweep/2; place(cid,cx+Math.cos(a)*m.ring,cy+Math.sin(a)*m.ring,a); ang+=sweep; }); }
    roots.forEach(radius); const one=roots.length===1; let acc=0; const centers=[];
    roots.forEach(rid=>{ const r=M[rid].r; centers.push(acc+r); acc+=2*r+380; }); const shift=(acc-380)/2;
    roots.forEach((rid,i)=>{ const cx=centers[i]-shift; place(rid,cx,0,one?-Math.PI/2:(cx<0?Math.PI:0)); }); }

  function demo(){
    let seq=1; const nodes={}; const roots=[];
    const mk=o=>{ const id="n"+(seq++).toString(36); nodes[id]=Object.assign({id,kind:"neuron",parent:null,children:[],x:0,y:0,prio:"media",hue:null,scale:1,objetivo:"",contexto:"",encargados:[],links:[],items:[]},o); return id; };
    const link=(a,b)=>{ nodes[a].links.push(b); nodes[b].links.push(a); };
    const t=(title,status,prio,notas,due)=>({id:"i"+(seq++),title,owners:[],status:status||"sin",prio:prio||"",due:due||"",notas:notas||"",objetivo:"",done:status==="listo",doneAt:null,archived:false,archivedAt:null});
    const kids=(pid,arr)=>{ nodes[pid].children=arr; arr.forEach(c=>{nodes[c].parent=pid;}); };

    const P1=mk({kind:"project",name:"Bosques de Agua",prio:"alta",objetivo:"Crear el Área Natural Protegida y regenerar bosques de agua a escala.",contexto:"Varios frentes abiertos: PNP, producción, siembra directa y Achala."}); roots.push(P1);
    const pnp=mk({name:"Área Natural Protegida (PNP)",parent:P1,prio:"alta",objetivo:"Asegurar la firma del gobernador y crear el PNP.",contexto:"Due diligence catastral avanzada; carta de intención en borrador."});
    const pnp_inf=mk({name:"Informes técnicos",parent:pnp,prio:"alta",contexto:"Informes de dominio en camino.",items:[
      t("Informes de dominio del ejido de Yacanto (Muni)","curso","alta","La Muni de Yacanto solo pasa los del ejido."),
      t("Resto de informes vía Provincia","curso","alta",""),
      t("Due diligence catastral: La Barranquita, Alessandri, Coto de Caza","curso","alta","Avanzada.")]});
    const pnp_carta=mk({name:"Carta de intención de la provincia",parent:pnp,prio:"alta",objetivo:"Asegurar la firma del gobernador.",contexto:"Borrador del acuerdo ya redactado.",items:[t("Hacer el boceto de la carta (corto plazo)","curso","alta")]});
    const pnp_est=mk({name:"Estancias – negociaciones",parent:pnp,prio:"alta",contexto:"Cerrar contratos una vez confirmados los titulares.",items:[
      t("Armar y cerrar contratos con dueños","espera","alta","Depende de confirmar titulares."),
      t("Relevar vecinos del sur: Vasco + Vallecitos","sin","media"),
      t("Relevar vecinos del norte: Nacha / Tres Árboles","sin","media")]});
    const pnp_fund=mk({name:"Fundación – funcionamiento",parent:pnp,prio:"media",contexto:"A desarrollar."});
    const pnp_info=mk({name:"Información más precisa",parent:pnp,prio:"media",contexto:"Mapeo catastral/territorial en progreso.",items:[
      t("Cruzar dimensiones declaradas vs. reales","curso","media"),
      t("Análisis territorial (satelital)","espera","baja","EN PAUSA.")]});
    const pnp_fil=mk({name:"Filantropía – marco",parent:pnp,prio:"media",contexto:"A desarrollar."});
    const pnp_yac=mk({name:"Reserva Municipal de Yacanto",parent:pnp,prio:"baja",contexto:"EN PAUSA: rol de BDA y delimitación Art. 4 sin definir."});
    kids(pnp,[pnp_inf,pnp_carta,pnp_est,pnp_fund,pnp_info,pnp_fil,pnp_yac]);
    const prod=mk({name:"Producción y plantación (100 mil árboles)",parent:P1,prio:"alta",objetivo:"Producir y plantar 100.000 árboles.",contexto:"Meta anual a definir (¿50.000 o 100.000?)."});
    const prod_fil=mk({name:"Filantropía",parent:prod,prio:"alta",contexto:"Sostener la meta año a año.",items:[t("Asegurar el mejor financiamiento anual","curso","alta")]});
    const prod_viv=mk({name:"Producción (vivero)",parent:prod,prio:"alta",contexto:"Propuestas de vivero y sustrato ya listas.",items:[t("Definir sustrato","curso","media"),t("Riego automático","sin","media"),t("Tubetes","sin","media"),t("Micorrizas","sin","media")]});
    const prod_pla=mk({name:"Plantación",parent:prod,prio:"alta",contexto:"Definir si se siembra este año y dónde.",items:[t("DECISIÓN: ¿se siembra este año y a qué escala?","espera","alta","Define la meta anual de árboles."),t("Definir meta anual (50.000 vs 100.000)","espera","alta")]});
    kids(prod,[prod_fil,prod_viv,prod_pla]);
    const sd=mk({name:"Siembra directa en campo (escala)",parent:P1,prio:"alta",objetivo:"Validar y escalar la siembra directa de P. australis.",contexto:"Protocolo en validación; ventana de siembra: septiembre."});
    const sd_bas=mk({name:"Bastón",parent:sd,prio:"alta",contexto:"Bastón de siembra en diseño (Pablo K con Peta).",items:[t("Avanzar el diseño del bastón de siembra","curso","alta","Pablo K con Peta.")]});
    const sd_est=mk({name:"Estudio – certificación",parent:sd,prio:"alta",objetivo:"Validar el protocolo completo de P. australis.",contexto:"Sustrato equilibrado + PG en bandejas forestales. Falta validación en campo.",items:[
      t("Pablo K: informe 1 — protocolo con variantes","curso","alta"),
      t("Pablo K: informe 2 — lectura/comprensión de la semilla","sin","alta"),
      t("Pablo K: informe 3 — gráficos del diferencial","sin","alta"),
      t("Validación en campo del protocolo","espera","alta","Pablo K continúa; su continuidad queda atada a Nideport.")]});
    const sd_pel=mk({name:"Pellet",parent:sd,prio:"media",contexto:"Peletizado + máquina en desarrollo.",items:[t("Pensar y presupuestar el primer paso de la pelletizadora","curso","media","")]});
    const sd_fec=mk({name:"Fecha de siembra",parent:sd,prio:"alta",contexto:"Ventana: septiembre.",items:[t("Ventana de siembra directa","sin","alta","Septiembre.","2026-09-01")]});
    kids(sd,[sd_bas,sd_est,sd_pel,sd_fec]);
    const com=mk({name:"Comunidad",parent:P1,prio:"media",contexto:"Difusión y jornadas."});
    const com_ig=mk({name:"Instagram – audiovisual",parent:com,prio:"media"});
    const com_jor=mk({name:"Jornadas",parent:com,prio:"media"});
    kids(com,[com_ig,com_jor]);
    const adm=mk({name:"Administración y gobernanza",parent:P1,prio:"media"});
    const adm_cont=mk({name:"Contables",parent:adm,prio:"media"});
    const adm_leg=mk({name:"Legales",parent:adm,prio:"alta",contexto:"Acuerdo con la Provincia + due diligence legal de campos.",items:[t("Acuerdo con la Provincia","curso","alta"),t("Due diligence legal de campos","curso","alta")]});
    const adm_board=mk({name:"Reunión board",parent:adm,prio:"media"});
    kids(adm,[adm_cont,adm_leg,adm_board]);
    const ach=mk({name:"Reserva Pampa de Achala",parent:P1,prio:"alta",contexto:"Mantenimiento y monitoreo."});
    const ach_man=mk({name:"Mantenimiento",parent:ach,prio:"alta",contexto:"Cortafuegos de Achala (210 ha) para temporada de fuego.",items:[t("Cortafuegos de Achala (210 ha)","curso","alta","Para temporada de fuego."),t("Coordinar con Perfi (caballos + agua)","sin","media"),t("Traer tanque de Umepai para la brigada","sin","media")]});
    const ach_mon=mk({name:"Monitoreo",parent:ach,prio:"media",contexto:"Brotes, siembra directa y parcelas. Target primavera/verano.",items:[t("Monitoreo de brotes, siembra directa y parcelas","sin","media","Target diciembre.","2026-12-01")]});
    kids(ach,[ach_man,ach_mon]);
    kids(P1,[pnp,prod,sd,com,adm,ach]);

    const P2=mk({kind:"project",name:"Boscora",prio:"alta",objetivo:"El brazo de negocio: proyectos de fondos de agua.",contexto:"Fonag en curso; Faunagua nuevo; Nideport en pausa."}); roots.push(P2);
    const bo_fonag=mk({name:"Fonag – Ecuador",parent:P2,prio:"alta",contexto:"Escenarios/propuestas en curso.",items:[t("Definir los puntos clave (mínimo de viabilidad)","curso","alta","Se fijan antes de empezar."),t("Evaluar viabilidad","espera","alta")]});
    const bo_fauna=mk({name:"Faunagua – Bolivia",parent:P2,prio:"media",contexto:"Frente nuevo, por desarrollar.",items:[t("Definir alcance y próximos pasos","sin","media")]});
    const bo_nide=mk({name:"Nideport",parent:P2,prio:"media",contexto:"EN PAUSA la decisión de fondo; activo solo el informe técnico.",items:[t("Informe técnico para Nideport","curso","media","Único frente activo.")]});
    kids(P2,[bo_fonag,bo_fauna,bo_nide]);
    link(sd,prod); link(bo_nide,sd_est); link(pnp,adm_leg);
    doLayout(nodes,roots);
    // El árbol de temas es real; la conversación y la agenda arrancan vacías.
    // Antes el sembrado traía un evento y cuatro mensajes de ejemplo que después
    // había que salir a borrar a mano de la base.
    const events=[];
    const chat={team:[],dm:{},groups:{}};
    return {version:5,seq,nodes,roots,theme:null,edgeMeta:{},members:["Nico","Juanpi","Lucas","Juanso"],me:"",events,chat,tab:"panel",estProj:P1,estFocus:"",weekGoals:"",privTasks:{},_seedfix:true,_layout3:true};
  }

  function normalize(d){ if(!d.edgeMeta)d.edgeMeta={}; if(!d.members)d.members=[]; if(d.me==null)d.me=""; if(!d.events)d.events=[]; if(d.weekGoals==null)d.weekGoals=""; if(d.estFocus==null)d.estFocus=""; if(!d.chat)d.chat={team:[],dm:{}}; if(!d.chat.dm)d.chat.dm={}; if(!d.chat.groups||typeof d.chat.groups!=="object")d.chat.groups={}; Object.keys(d.chat.groups).forEach(gid=>{ const g=d.chat.groups[gid]; if(!g||!g.name){ delete d.chat.groups[gid]; return; } if(!Array.isArray(g.members))g.members=[]; if(!Array.isArray(g.msgs))g.msgs=[]; g.id=gid; }); if(!d.myNotes)d.myNotes={}; if(!d.avatars)d.avatars={}; if(!d.userColors)d.userColors={}; if(!d.tasksSeen)d.tasksSeen={}; if(!d.chatSeen)d.chatSeen={}; if(d.taskTemaFilter==null)d.taskTemaFilter="";
    if(!d.taskFilters||typeof d.taskFilters!=="object")d.taskFilters={people:[],status:[],temas:[],prio:[]};
    ["people","status","temas","prio"].forEach(kk=>{ if(!Array.isArray(d.taskFilters[kk]))d.taskFilters[kk]=[]; });
    if("taskTemaFilter" in d)delete d.taskTemaFilter;
    if(d.palette==="atelier")d.palette="carbon";   // nombre viejo de la paleta de fábrica
    d.taskFilters.status=d.taskFilters.status.filter(s=>STATUS[s]);
    d.taskFilters.prio=d.taskFilters.prio.filter(p=>p==="__none"||PRIO[p]);
    d.taskFilters.temas=d.taskFilters.temas.filter(t=>d.nodes[t]);   // un tema borrado dejaba el tablero vacío sin explicación
    if(!Array.isArray(d.panelFilter))d.panelFilter=[]; d.panelFilter=d.panelFilter.filter(p=>p==="__none"||PRIO[p]);
    if(!Array.isArray(d.treeOpen))d.treeOpen=[]; d.treeOpen=d.treeOpen.filter(t=>d.nodes[t]); (d.events||[]).forEach(ev=>{ if(ev.rsvp==null)ev.rsvp={}; if(ev.time==null)ev.time=""; if(ev.desc==null)ev.desc=""; });
    if(!d.privTasks||typeof d.privTasks!=="object")d.privTasks={};
    // DM viejos: la clave era una sola persona, así el mensaje no llegaba a destino. Se reparte por remitente al par correcto.
    if(!d._dmpair){ const viejo=d.chat.dm||{}, nuevo={};
      Object.keys(viejo).forEach(k=>{ const arr=viejo[k]||[]; if(k.includes(" ~ ")){ nuevo[k]=(nuevo[k]||[]).concat(arr); return; }
        arr.forEach(m=>{ const otro=(m&&m.from&&m.from!==k)?m.from:k; const nk=[k,otro].sort((x,y)=>x.localeCompare(y)).join(" ~ "); (nuevo[nk]=nuevo[nk]||[]).push(m); }); });
      Object.keys(nuevo).forEach(k=>nuevo[k].sort((a,b)=>(a.ts||0)-(b.ts||0)));
      d.chat.dm=nuevo; d._dmpair=true; }
    // los "no leídos" son de cada persona, no del equipo
    if(d.chatSeen&&Object.values(d.chatSeen).some(v=>typeof v==="number"))d.chatSeen={};
    Object.keys(d.chatSeen||{}).forEach(p=>{ if(!d.chatSeen[p]||typeof d.chatSeen[p]!=="object")d.chatSeen[p]={}; });
    const fixItem=k=>{ if(k.notas==null)k.notas=""; if(k.due==null)k.due=""; if(k.status==="bloq"||!STATUS[k.status])k.status="espera"; k.done=(k.status==="listo"); if(k.doneAt===undefined)k.doneAt=null; if(k.done&&!k.doneAt)k.doneAt=nowMs(); if(!k.done)k.doneAt=null; if(k.archived==null)k.archived=false; if(k.archivedAt===undefined)k.archivedAt=(k.archived?(k.doneAt||null):null); if(k.objetivo==null)k.objetivo="";
      if(!Array.isArray(k.owners))k.owners=(k.owner&&String(k.owner).trim())?[String(k.owner).trim()]:[]; k.owners=k.owners.map(o=>String(o).trim()).filter(Boolean); delete k.owner;
      if(!Array.isArray(k.files))k.files=[];
      if(k.prio==null||!PRIO[k.prio])k.prio="";
      if(!k.title&&k.kind)k.title=""; delete k.kind; };
    Object.values(d.nodes).forEach(n=>{ if(n.scale==null)n.scale=1; if(n.objetivo==null)n.objetivo=""; if(n.contexto==null)n.contexto=""; if(n.prio==null)n.prio="media";
      if(!Array.isArray(n.encargados))n.encargados=(n.encargado&&String(n.encargado).trim())?[String(n.encargado).trim()]:[]; n.encargados=n.encargados.map(o=>String(o).trim()).filter(Boolean); delete n.encargado;
      if(!Array.isArray(n.files))n.files=[];
      (n.items||[]).forEach(fixItem); });
    Object.keys(d.privTasks).forEach(who=>{ if(!Array.isArray(d.privTasks[who])){ delete d.privTasks[who]; return; } d.privTasks[who].forEach(k=>{ fixItem(k); k.priv=true; }); });
    d._seedfix=true; // (la limpieza de textos del sembrado inicial ya cumplió su función; no debe tocar texto escrito por el equipo)
    if(!d._layout3){ doLayout(d.nodes,d.roots); d._layout3=true; }
    d.version=5; return d; }
  function sweepArchive(){ let ch=false; const now=nowMs();
    const sweep=k=>{ if(k.done&&k.doneAt&&!k.archived&&(now-k.doneAt)>=ARCH_DAYS*DAY){ k.archived=true; k.archivedAt=now; ch=true; } };
    Object.values(state.nodes).forEach(n=>(n.items||[]).forEach(sweep));
    Object.values(state.privTasks||{}).forEach(arr=>(arr||[]).forEach(sweep)); // las privadas también
    if(ch)save(); }
  // Todo cambio pasa por acá. El guard anti-eco evita reescribir la base
  // cuando el contenido no cambió: sin él, el chat entra en un bucle
  // (dibujar -> guardar -> llega por sincronización -> dibujar -> ...).
  let lastPushed="";
  function save(){
    try{ state.tab=active; }catch(e){}
    saveLocalPrefs(state); syncPeopleList();
    const shared=stripShared(state); const js=JSON.stringify(shared);
    if(js!==lastPushed){ lastPushed=js; pushRemoteState(shared); }
    if(pushPrivateState){ const mine=myPrivateSlice(); if(mine)pushPrivateState(mine); }
  }
  // Lo que llega del equipo pasa SIEMPRE por normalize(): es la puerta por
  // donde un cliente viejo podría inyectar el formato anterior.
  const SKIP=new Set([...LOCAL_KEYS,...PRIV_KEYS]);
  function applyRemoteState(remote){
    if(!remote||!remote.nodes)return;
    const merged=Object.assign({},remote);
    SKIP.forEach(k=>{ if(state[k]!==undefined)merged[k]=state[k]; else delete merged[k]; });
    state=normalize(merged);
    // Lo que estabas escribiendo en este instante no vivía todavía en el
    // estado que llegó: sin esto, un guardado de otra persona te borra el
    // renglón a medio escribir y encima deja la pantalla mostrando un texto
    // que ya no existe en ningún lado.
    reaplicarEdicionEnCurso();
    lastPushed=JSON.stringify(stripShared(state));
    // Si el panel quedó abierto, hay que volver a dibujarlo: sus manejadores
    // apuntaban a objetos del estado anterior y tocarlos no haría nada.
    if(selId&&!N(selId))closePanel();
    if(taskOpen&&!curTask())closeTask();
    if(panelOpen&&N(selId))renderPanelBody(N(selId));
    if(taskOpen&&curTask()){ renderTOwners(); renderTBelong(); renderTFiles(); syncTaskDone(curTask()); }
    loadTreeOpen(); sweepArchive(); syncPeopleList(); refreshChrome(); renderActive();
  }
  // Mi porción privada: es lo único que sube a la tabla con permisos.
  function myPrivateSlice(){ const me=state.me; if(!me)return null;
    return { privTasks:(state.privTasks||{})[me]||[], myNotes:(state.myNotes||{})[me]||"" }; }
  function mountPrivate(p){ const me=state.me; if(!me||!p)return;
    state.privTasks=state.privTasks||{}; state.myNotes=state.myNotes||{};
    if(Array.isArray(p.privTasks))state.privTasks[me]=p.privTasks;
    if(typeof p.myNotes==="string")state.myNotes[me]=p.myNotes; }
  function applyPrivateState(p){ mountPrivate(p); if(active==="panel")renderPanel(); }
  // Los datos privados vivían dentro de la fila compartida del equipo. La primera
  // vez que entrás, tu porción se copia a tu tabla y se saca de ahí.
  // Regla dura: se toca SOLO la porción propia, nunca la de otra persona.
  function migrarMisPrivados(yaTengo){
    const me=state.me; if(!me||yaTengo)return;
    const notas=(state.myNotes||{})[me];
    const tareas=(state.privTasks||{})[me];
    const hayAlgo=(typeof notas==="string"&&notas.trim())||(Array.isArray(tareas)&&tareas.length);
    if(!hayAlgo)return;
    if(pushPrivateState)pushPrivateState(myPrivateSlice());
    if(state.myNotes)delete state.myNotes[me];
    if(state.privTasks)delete state.privTasks[me];
    mountPrivate({privTasks:tareas||[],myNotes:notas||""});
    save();
  }

  const viewport=document.getElementById("viewport"),world=document.getElementById("world"),worldInner=document.getElementById("worldInner"),svg=document.getElementById("synapses"),handles=document.getElementById("handles");
  const fPerson=document.getElementById("fPerson"),fStatus=document.getElementById("fStatus");
  function matches(node){ const p=fPerson.value,s=fStatus.value; if(!p&&!s)return true; const a=agg(node); return (!p||a.owners.has(p))&&(!s||a.st.has(s)); }
  function isOff(node){ let x=node; while(x){ if(off.has(x.id))return true; x=N(x.parent); } return false; }
  function isBright(node){ return !isOff(node)&&matches(node); }
  // Vecindario de un tema: su padre, sus hijos y sus vínculos sueltos.
  function vecinos(id){ const v=new Set(); const n=N(id); if(!n)return v;
    if(n.parent)v.add(n.parent); (n.children||[]).forEach(c=>v.add(c)); (n.links||[]).forEach(l=>v.add(l));
    Object.values(state.nodes).forEach(o=>{ if((o.links||[]).includes(id))v.add(o.id); });
    return v; }
  function enFoco(){ return selId?new Set([selId,...vecinos(selId)]):null; }

  // Ya no hay selector de identidad: sos quien entró con su correo.
  function applyTabControls(name){
    // Persona y Estado solo atenúan nodos del mapa: fuera de ahí no hacen nada,
    // así que no tienen por qué ocupar la barra.
    const est=name==="estructura", mapa=est&&estView()==="mapa";
    const ver=(id,on)=>{ const el=document.getElementById(id); if(el)el.style.display=on?"":"none"; };
    const ctx=document.getElementById("topCtx"); if(ctx)ctx.hidden=!est;
    ["ctxDiv","linkMode","editMode","addNode","filtPersona","filtEstado"].forEach(id=>ver(id,mapa));
    const info=document.querySelector("#topCtx .infob"); if(info)info.style.display=mapa?"":"none";
    const s=document.getElementById("filtSos"); if(s)s.style.display="none";
    // Con las herramientas arriba, el mapa se queda con toda la página.
    const secc=document.getElementById("tab-estructura"); if(secc)secc.classList.toggle("mapafull",mapa); }
  function showTab(name){ active=name; applyTabControls(name); acomodarMenu();
    document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.id==="tab-"+name));
    document.querySelectorAll(".navtab").forEach(b=>b.classList.toggle("on",b.dataset.tab===name));
    renderActive(); save(); }
  document.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));

  // ---------- MENÚ LATERAL ----------
  // Se puede plegar a una banda de iconos. En Chat se pliega solo: ese costado
  // es de la lista de contactos y los dos juntos no entran.
  const sidebar=document.getElementById("sidebar"), sbToggle=document.getElementById("sbToggle"), panelSubs=document.getElementById("panelSubs");
  const plegado=()=>!!(sidebar&&sidebar.classList.contains("rail"));
  function pintarMenu(rail){ if(!sidebar)return;
    sidebar.classList.toggle("rail",!!rail);
    if(sbToggle){ sbToggle.setAttribute("aria-expanded",rail?"false":"true");
      sbToggle.title=rail?"Mostrar el menú":"Esconder el menú"; } }
  function acomodarMenu(){
    pintarMenu(active==="chat" ? true : !!state.navRail);
    if(typeof marcarSubs==="function")marcarSubs(); }
  if(sbToggle) sbToggle.addEventListener("click",()=>{
    // En Chat el plegado es forzado: el botón lo abre por esta vez y no toca
    // tu preferencia, así el menú vuelve a como lo tenías al salir de ahí.
    if(active==="chat"){ pintarMenu(!plegado()); return; }
    state.navRail=!plegado(); save(); pintarMenu(state.navRail); });
  document.querySelectorAll(".sbsub").forEach(b=>b.addEventListener("click",()=>{
    state.panelView=b.dataset.view; save();
    if(active!=="panel")showTab("panel"); else renderPanel(); }));
  // "Mi panel" vuelve a mostrarlo entero.
  const itemPanel=document.querySelector('.sbitem[data-tab="panel"]');
  if(itemPanel)itemPanel.addEventListener("click",()=>{ state.panelView=""; save();
    if(active==="panel")renderPanel(); },true);

  // Campos de texto que se editan en vivo. Si llega un cambio del equipo
  // mientras alguien escribe en uno de ellos, su contenido se vuelve a poner
  // sobre el estado recién llegado en vez de perderse.
  const EDITORES=[
    {id:"pTitle",  set:v=>{ const n=N(selId); if(n)n.name=v; }},
    {id:"pObj",    set:v=>{ const n=N(selId); if(n)n.objetivo=v; }},
    {id:"pCtx",    set:v=>{ const n=N(selId); if(n)n.contexto=v; }},
    {id:"tTitle",  set:v=>{ const k=curTask(); if(k)k.title=v; }},
    {id:"tObj",    set:v=>{ const k=curTask(); if(k)k.objetivo=v; }},
    {id:"tNotas",  set:v=>{ const k=curTask(); if(k)k.notas=v; }},
    {id:"weekGoals", set:v=>{ state.weekGoals=v; }},
    {id:"myNotesArea", set:v=>{ state.myNotes=state.myNotes||{}; if(state.me)state.myNotes[state.me]=v; }},
  ];
  function reaplicarEdicionEnCurso(){
    const el=document.activeElement; if(!el||!el.id)return;
    const e=EDITORES.find(x=>x.id===el.id); if(!e)return;
    try{ e.set(el.value); }catch(err){ console.error("No se pudo reaplicar la edición en curso:",err); }
  }

  // ---------- ESTADO DEL GUARDADO ----------
  let estadoGuardado="guardado", ultimoGuardado=null;
  function mostrarEstadoGuardado(estado,err){
    estadoGuardado=estado;
    if(estado==="guardado")ultimoGuardado=new Date();
    // Un fallo suelta el guard anti-eco: si no, el mismo contenido nunca se
    // vuelve a intentar y el cambio queda solo en la pantalla de quien lo hizo.
    if(estado==="error")lastPushed="";
    const barra=document.getElementById("saveState"); if(!barra)return;
    if(estado==="error"){
      barra.className="savestate mal";
      barra.innerHTML='<span>No se pudo guardar. Tu trabajo está en pantalla pero todavía no en la base — no cierres esta pestaña.</span><button class="rowbtn" id="saveRetry">Reintentar</button>';
      const b=barra.querySelector("#saveRetry");
      if(b)b.addEventListener("click",()=>{ lastPushed=""; mostrarEstadoGuardado("guardando"); save(); });
      return;
    }
    if(estado==="guardando"){ barra.className="savestate yendo"; barra.innerHTML='<span>Guardando…</span>'; return; }
    barra.className="savestate bien";
    barra.innerHTML='<span>Guardado '+ultimoGuardado.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})+'</span>';
  }
  // Cerrar la pestaña con algo sin guardar es la forma más fácil de perder
  // trabajo: el navegador pregunta antes.
  window.addEventListener("beforeunload",e=>{
    if(estadoGuardado==="error"||(hayPendiente&&hayPendiente())){ e.preventDefault(); e.returnValue=""; } });

  function renderActive(){ refreshChrome();
    if(active==="estructura")renderEstructuraTab(); else if(active==="tareas")renderTareas(); else if(active==="panel")renderPanel(); else if(active==="archivo")renderArchivo(); else if(active==="drive")renderDrive(); else if(active==="chat")renderChat(); else if(active==="config")renderConfigTab(); }
  // Estructura tiene dos vistas del mismo árbol: en columnas o como mapa.
  let vistaEst="arbol";
  function estView(){ return vistaEst==="mapa"?"mapa":"arbol"; }
  function renderEstructuraTab(){ const esMapa=estView()==="mapa";
    const seg=document.getElementById("estViewSeg"); if(seg)seg.querySelectorAll("[data-v]").forEach(b=>b.classList.toggle("on",b.dataset.v===(esMapa?"mapa":"arbol")));
    const wrap=document.getElementById("estMapaWrap"); if(wrap)wrap.hidden=!esMapa;
    applyTabControls(active);
    const arbol=document.getElementById("estree"); if(arbol)arbol.hidden=esMapa;
    const srch=document.querySelector("#tab-estructura .srchbar"); if(srch)srch.style.display=esMapa?"none":"";
    if(esMapa){ renderMap(); requestAnimationFrame(()=>{ if(!cam._init){ fit(); cam._init=1; } applyCam(); }); }
    else renderEstructura(); }
  // qué ramas dejaste abiertas: se recuerda entre sesiones
  function saveTreeOpen(){ state.treeOpen=[...treeOpen]; save(); }
  function loadTreeOpen(){ treeOpen.clear(); (state.treeOpen||[]).forEach(id=>{ if(N(id))treeOpen.add(id); }); }
  function ensureUserColors(){ if(!state.userColors)state.userColors={}; const used=new Set(Object.values(state.userColors)); let ch=false;
    allPeople().forEach(p=>{ if(state.userColors[p])return;
      let pick=AV.find(c=>!used.has(c));
      if(!pick){ let h=0; for(const c of p) h=(h*31+c.charCodeAt(0))>>>0; pick=AV[h%AV.length]; }
      state.userColors[p]=pick; used.add(pick); ch=true; });
    return ch; }
  function refreshChrome(){ if(ensureUserColors())save(); const cur=fPerson.value;
    fPerson.innerHTML='<option value="">Todas</option>'+allPeople().map(p=>`<option${p===cur?" selected":""}>${esc(p)}</option>`).join("");
    updateChatBadge(); updateAvisos(); }

  // ---------- MAPA ----------
  function edgeList(){ const list=[],seen=new Set();
    Object.values(state.nodes).forEach(n=>{ if(n.parent&&N(n.parent)){ const k=keyFor(n.parent,n.id); if(!seen.has(k)){seen.add(k);list.push({a:N(n.parent),b:n,type:"struct",key:k});} } });
    Object.values(state.nodes).forEach(n=>{ (n.links||[]).forEach(l=>{ if(!N(l))return; const k=keyFor(n.id,l); if(!seen.has(k)){seen.add(k);list.push({a:n,b:N(l),type:"link",key:k});} }); });
    return list; }
  function ctrlOf(a,b){ const m=EM()[keyFor(a.id,b.id)]||{}; const bd=m.bend||{dx:0,dy:0}; return {x:(a.x+b.x)/2+bd.dx,y:(a.y+b.y)/2+bd.dy}; }
  function edgeD(a,b){ const c=ctrlOf(a,b); return `M ${OX+a.x} ${OY+a.y} Q ${OX+c.x} ${OY+c.y} ${OX+b.x} ${OY+b.y}`; }
  function edgeColor(e){ const m=EM()[e.key]||{}; return m.color||(e.type==="link"?cssv("--link"):accentOf(e.b)); }
  function edgeDash(e){ const m=EM()[e.key]||{}; const st=m.style||(e.type==="link"?"dash":"solid"); return st==="solid"?"":st==="dot"?"1.5 7":"7 7"; }
  function buildEdges(){ const list=edgeList(); let paths="",hits=""; const foco=enFoco();
    list.forEach(e=>{ const on=isBright(e.a)&&isBright(e.b); const col=edgeColor(e),dash=edgeDash(e),d=edgeD(e.a,e.b);
      const tocaSel=!!selId&&(e.a.id===selId||e.b.id===selId);
      const grosor=on?(tocaSel?1.6:1):0.75;
      const opac=on?(!foco||tocaSel?0.72:0.14):0.1;
      paths+=`<path class="edge" data-key="${e.key}" d="${d}" stroke="${col}" stroke-width="${grosor}" ${dash?`stroke-dasharray="${dash}"`:""} opacity="${opac}" style="pointer-events:none"/>`;
      if(editing&&on) hits+=`<path class="hit" data-key="${e.key}" d="${d}"/>`; });
    svg.innerHTML=paths+hits; svg.style.pointerEvents=editing?"auto":"none"; handles.innerHTML="";
    if(editing){ svg.querySelectorAll("path.hit").forEach(p=>p.addEventListener("click",ev=>{ ev.stopPropagation(); const e=list.find(x=>x.key===p.dataset.key); if(e)openEdgePop(e); }));
      list.forEach(e=>{ if(!(isBright(e.a)&&isBright(e.b)))return; const c=ctrlOf(e.a,e.b); const h=document.createElement("div"); h.className="ehandle"; h.dataset.key=e.key; h.style.left=(OX+c.x)+"px"; h.style.top=(OY+c.y)+"px"; handles.appendChild(h); wireHandle(h,e); }); } }
  function wireHandle(h,e){ let drag=false,sx,sy,b0;
    h.addEventListener("pointerdown",ev=>{ ev.stopPropagation(); drag=true; h.setPointerCapture(ev.pointerId); sx=ev.clientX;sy=ev.clientY; const m=EM()[e.key]||{}; b0=Object.assign({dx:0,dy:0},m.bend); });
    h.addEventListener("pointermove",ev=>{ if(!drag)return; const dx=(ev.clientX-sx)/cam.s,dy=(ev.clientY-sy)/cam.s; setEdgeMeta(e.key,{bend:{dx:b0.dx+dx,dy:b0.dy+dy}}); const c=ctrlOf(e.a,e.b); h.style.left=(OX+c.x)+"px"; h.style.top=(OY+c.y)+"px"; const d=edgeD(e.a,e.b); const pa=svg.querySelector(`path.edge[data-key="${e.key}"]`); if(pa)pa.setAttribute("d",d); const hi=svg.querySelector(`path.hit[data-key="${e.key}"]`); if(hi)hi.setAttribute("d",d); });
    h.addEventListener("pointerup",()=>{ if(!drag)return; drag=false; save(); renderMap(); }); }
  function renderMap(){ buildEdges(); const foco=enFoco();
    [...worldInner.querySelectorAll(".neu")].forEach(n=>n.remove());
    Object.values(state.nodes).forEach(node=>{ const a=agg(node),depth=depthOf(node),hasKids=(node.children||[]).length>0,size=baseSize(node),acc=accentOf(node);
      const el=document.createElement("div"); el.className="neu"+(node.id===selId?" sel":"")+(isBright(node)?"":" off")+(node.id===linkSrc?" linksrc":"")+(depth>=4?" deep":"")+(foco&&!foco.has(node.id)?" dim":"")+(a.ic?" conprog":"");
      el.dataset.lvl=Math.min(depth,4); el.style.width=size+"px"; el.style.borderTopColor=acc; el.style.setProperty("--acc",acc); el.style.setProperty("--pct",a.ic?Math.round(a.dc/a.ic*100):0); el.style.left=(OX+node.x)+"px"; el.style.top=(OY+node.y)+"px"; el.dataset.id=node.id; el.title="Clic: detalle · Doble clic: apagar";
      const owners=[...a.owners].slice(0,4); const avs=owners.map(o=>avatarMarkup(o,"av",true)).join("");
      const outLinks=(node.links||[]).length;
      const sub=`${hasKids?a.nc+" sub · ":""}${a.ic} tarea${a.ic===1?"":"s"}${a.ic?` · ${a.dc}✓`:""}`;
      el.innerHTML=`<span class="nod"></span><span class="nm">${esc(node.name)}</span><span class="sub">${sub}</span>${avs?`<span class="avs">${avs}</span>`:''}${outLinks?`<span class="link-mark">✦ ${outLinks}</span>`:''}`;
      worldInner.appendChild(el); wireNeuron(el,node); });
    document.getElementById("addLabel").textContent=selId?"Nuevo sub-tema":"Nuevo proyecto";
    avisoFiltroVacio(); }
  function avisoFiltroVacio(){
    let aviso=document.getElementById("mapEmpty");
    const hayFiltro=(fPerson.value||fStatus.value);
    const ninguno=hayFiltro&&!Object.values(state.nodes).some(n=>isBright(n));
    if(!ninguno){ if(aviso)aviso.remove(); return; }
    if(!aviso){ aviso=document.createElement("div"); aviso.id="mapEmpty"; aviso.className="mapempty"; viewport.appendChild(aviso); }
    const quien=fPerson.value, estado=fStatus.value&&STATUS[fStatus.value]?STATUS[fStatus.value].l.toLowerCase():"";
    aviso.innerHTML=`<b>Ningún tema queda en pie con este filtro</b><span>${
      quien&&estado?"Nadie tiene tareas "+esc(estado)+" a nombre de "+esc(quien)+".":
      quien?esc(quien)+" no tiene tareas a su nombre en ningún tema.":
      "No hay tareas "+esc(estado)+" en ningún tema."}</span><button class="rowbtn" id="mapEmptyClear">Limpiar el filtro</button>`;
    const b=aviso.querySelector("#mapEmptyClear");
    if(b)b.addEventListener("click",()=>{ fPerson.value=""; fStatus.value=""; renderMap(); }); }
  function applyCam(){ world.style.transform=`translate(${cam.tx}px,${cam.ty}px) scale(${cam.s})`; }
  function fit(){ const ns=Object.values(state.nodes); const vw=viewport.clientWidth||960,vh=viewport.clientHeight||600;
    if(!ns.length){ cam.tx=vw/2-OX;cam.ty=vh/2-OY;cam.s=1;applyCam();return; }
    let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9; ns.forEach(k=>{ const r=baseSize(k)/2+50; mnx=Math.min(mnx,k.x-r);mxx=Math.max(mxx,k.x+r);mny=Math.min(mny,k.y-r);mxy=Math.max(mxy,k.y+r); });
    const cw=Math.max(300,mxx-mnx),ch=Math.max(300,mxy-mny); cam.s=Math.max(.12,Math.min(vw/cw,vh/ch,1.1));
    cam.tx=vw/2-(OX+(mnx+mxx)/2)*cam.s; cam.ty=vh/2-(OY+(mny+mxy)/2)*cam.s; applyCam(); }
  function focusNode(id){ const n=N(id); if(!n)return; pathOf(id).forEach(x=>off.delete(x.id)); selId=id; const vw=viewport.clientWidth,vh=viewport.clientHeight;
    world.style.transition="transform .4s cubic-bezier(.4,0,.2,1)"; cam.tx=vw/2-(OX+n.x)*cam.s; cam.ty=vh/2-(OY+n.y)*cam.s; applyCam(); setTimeout(()=>world.style.transition="",420); renderMap(); }
  let clickTimer=null;
  function wireNeuron(el,node){ let drag=false,moved=false,sx,sy,ox,oy;
    el.addEventListener("pointerdown",e=>{ if(e.button!==0)return; e.stopPropagation(); closePops(); drag=true; moved=false; el.setPointerCapture(e.pointerId); sx=e.clientX;sy=e.clientY;ox=node.x;oy=node.y; });
    el.addEventListener("pointermove",e=>{ if(!drag)return; const dx=(e.clientX-sx)/cam.s,dy=(e.clientY-sy)/cam.s; if(Math.abs(dx)>3||Math.abs(dy)>3)moved=true; node.x=ox+dx; node.y=oy+dy; el.style.left=(OX+node.x)+"px"; el.style.top=(OY+node.y)+"px"; buildEdges(); });
    el.addEventListener("pointerup",e=>{ if(!drag)return; drag=false; if(moved){ save(); return; } if(linking){ onLinkClick(node); return; }
      if(clickTimer){clearTimeout(clickTimer);clickTimer=null;} clickTimer=setTimeout(()=>{ clickTimer=null; if(editing)openAspect(node); else openPanel(node.id); },210); });
    el.addEventListener("dblclick",e=>{ e.stopPropagation(); if(clickTimer){clearTimeout(clickTimer);clickTimer=null;} if(linking||editing)return; toggleOff(node); }); }
  function toggleOff(node){ if(off.has(node.id))off.delete(node.id); else off.add(node.id); renderMap(); }
  function onLinkClick(node){ if(!linkSrc){ linkSrc=node.id; renderMap(); toast("Elegí el segundo tema para vincular"); return; } if(linkSrc===node.id){ linkSrc=null; renderMap(); return; } addLinkBetween(linkSrc,node.id); linkSrc=null; toast("Vínculo creado ✦"); renderMap(); }
  function addLinkBetween(a,b){ const na=N(a),nb=N(b); if(!na||!nb)return; if(!na.links.includes(b))na.links.push(b); if(!nb.links.includes(a))nb.links.push(a); save(); }
  function removeLink(a,b){ const na=N(a),nb=N(b); if(na)na.links=na.links.filter(x=>x!==b); if(nb)nb.links=nb.links.filter(x=>x!==a); if(EM())delete EM()[keyFor(a,b)]; save(); }

  function closePops(){ viewport.querySelectorAll(".pop").forEach(p=>p.remove()); }
  function placePop(el,wx,wy){ const sx=wx*cam.s+cam.tx,sy=wy*cam.s+cam.ty,w=el.offsetWidth||234,h=el.offsetHeight||220; el.style.left=Math.max(8,Math.min(viewport.clientWidth-w-8,sx+18))+"px"; el.style.top=Math.max(8,Math.min(viewport.clientHeight-h-8,sy-10))+"px"; }
  const NEU_HUES=[210,168,150,90,45,28,8,340,300,265,190,120];
  const LINE_COLORS=["#8a6aa8","#2f9e8a","#4a86c4","#d19a34","#c15b46","#6f9a6a"];
  function openAspect(node){ closePops(); selId=node.id; renderMap(); const el=document.createElement("div"); el.className="pop"; const cur=node.hue!=null?node.hue:200;
    el.innerHTML=`<div class="pop-h">Aspecto · ${esc(node.name)}</div><div class="pop-l">Color</div><div class="swatches">${NEU_HUES.map(hh=>`<span class="sw${node.hue===hh?' on':''}" data-h="${hh}" style="background:hsl(${hh} 45% 50%)"></span>`).join("")}</div><input type="range" class="hue" min="0" max="360" value="${cur}"><button class="tiny inherit">↺ Color por nivel (auto)</button><div class="pop-l">Tamaño</div><input type="range" class="size" min="0.6" max="2" step="0.05" value="${node.scale||1}"><div class="pop-actions"><button class="btn done">Listo</button></div>`;
    viewport.appendChild(el); placePop(el,OX+node.x,OY+node.y);
    const liveS=()=>{ const e=document.querySelector(`.neu[data-id="${node.id}"]`); if(e)e.style.width=baseSize(node)+"px"; };
    el.querySelectorAll("[data-h]").forEach(s=>s.addEventListener("click",()=>{ node.hue=+s.dataset.h; save(); renderMap(); el.querySelectorAll(".sw").forEach(x=>x.classList.toggle("on",+x.dataset.h===node.hue)); el.querySelector(".hue").value=node.hue; }));
    el.querySelector(".hue").addEventListener("change",e=>{ node.hue=+e.target.value; save(); renderMap(); });
    el.querySelector(".inherit").addEventListener("click",()=>{ node.hue=null; save(); renderMap(); closePops(); });
    el.querySelector(".size").addEventListener("input",e=>{ node.scale=+e.target.value; liveS(); });
    el.querySelector(".size").addEventListener("change",()=>{ save(); renderMap(); });
    el.querySelector(".done").addEventListener("click",closePops); }
  function openEdgePop(e){ closePops(); const m=EM()[e.key]||{}; const style=m.style||(e.type==="link"?"dash":"solid"); const color=(m.color||edgeColor(e)).toLowerCase(); const el=document.createElement("div"); el.className="pop";
    el.innerHTML=`<div class="pop-h">Conexión</div><div style="font-size:11px;color:var(--ink-faint);margin-top:2px">${esc(e.a.name)} ↔ ${esc(e.b.name)}${e.type==="struct"?" · estructural":" · vínculo"}</div><div class="pop-l">Textura</div><div class="seg"><button data-s="solid"${style==="solid"?' class="on"':""}>Sólida</button><button data-s="dash"${style==="dash"?' class="on"':""}>Guiones</button><button data-s="dot"${style==="dot"?' class="on"':""}>Punteada</button></div><div class="pop-l">Color</div><div class="swatches">${LINE_COLORS.map(c=>`<span class="sw${color===c?' on':''}" data-c="${c}" style="background:${c}"></span>`).join("")}</div><div class="pop-actions"><button class="btn straight">Enderezar</button>${e.type==="link"?'<button class="btn danger borrar">Borrar</button>':''}<button class="btn done">Listo</button></div>`;
    const c=ctrlOf(e.a,e.b); viewport.appendChild(el); placePop(el,OX+c.x,OY+c.y);
    el.querySelectorAll("[data-s]").forEach(bt=>bt.addEventListener("click",()=>{ setEdgeMeta(e.key,{style:bt.dataset.s}); save(); el.querySelectorAll("[data-s]").forEach(x=>x.classList.toggle("on",x===bt)); renderMap(); }));
    el.querySelectorAll("[data-c]").forEach(sw=>sw.addEventListener("click",()=>{ setEdgeMeta(e.key,{color:sw.dataset.c}); save(); el.querySelectorAll("[data-c]").forEach(x=>x.classList.toggle("on",x===sw)); renderMap(); }));
    el.querySelector(".straight").addEventListener("click",()=>{ setEdgeMeta(e.key,{bend:{dx:0,dy:0}}); save(); renderMap(); closePops(); });
    const rm=el.querySelector(".borrar"); if(rm)rm.addEventListener("click",()=>{ removeLink(e.a.id,e.b.id); closePops(); renderMap(); toast("Vínculo borrado"); });
    el.querySelector(".done").addEventListener("click",closePops); }

  (function(){ let pan=false,sx,sy,tx0,ty0,moved;
    viewport.addEventListener("pointerdown",e=>{ if(e.target.closest(".neu")||e.target.closest(".zoomctl")||e.target.closest(".maptools")||e.target.closest(".pop")||e.target.closest(".ehandle"))return; if(e.target.classList&&e.target.classList.contains("hit"))return; closePops(); pan=true;moved=false; viewport.classList.add("grabbing"); sx=e.clientX;sy=e.clientY;tx0=cam.tx;ty0=cam.ty; viewport.setPointerCapture(e.pointerId); });
    viewport.addEventListener("pointermove",e=>{ if(!pan)return; if(Math.abs(e.clientX-sx)>3||Math.abs(e.clientY-sy)>3)moved=true; cam.tx=tx0+(e.clientX-sx); cam.ty=ty0+(e.clientY-sy); applyCam(); });
    viewport.addEventListener("pointerup",()=>{ if(!pan)return; pan=false; viewport.classList.remove("grabbing"); if(!moved){ selId=null; document.querySelectorAll(".neu.sel").forEach(x=>x.classList.remove("sel")); } });
    viewport.addEventListener("dblclick",e=>{ if(e.target.closest(".neu")||e.target.closest(".maptools"))return; off.clear(); renderMap(); toast("Todo prendido"); });
    viewport.addEventListener("wheel",e=>{ e.preventDefault(); closePops(); const r=viewport.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,wx=(mx-cam.tx)/cam.s,wy=(my-cam.ty)/cam.s,f=e.deltaY<0?1.12:1/1.12; cam.s=Math.max(.1,Math.min(3,cam.s*f)); cam.tx=mx-wx*cam.s; cam.ty=my-wy*cam.s; applyCam(); },{passive:false}); })();
  document.getElementById("zin").addEventListener("click",()=>{ closePops(); cam.s=Math.min(3,cam.s*1.2); applyCam(); });
  document.getElementById("zout").addEventListener("click",()=>{ closePops(); cam.s=Math.max(.1,cam.s/1.2); applyCam(); });
  document.getElementById("zfit").addEventListener("click",()=>{ closePops(); fit(); });
  document.getElementById("linkMode").addEventListener("click",()=>{ linking=!linking; linkSrc=null; closePops(); if(linking&&editing){ editing=false; document.getElementById("editMode").classList.remove("on"); } document.getElementById("linkMode").classList.toggle("on",linking); viewport.classList.toggle("linking",linking); toast(linking?"Vincular: tocá dos temas":"Vincular desactivado"); renderMap(); });
  document.getElementById("editMode").addEventListener("click",()=>{ editing=!editing; closePops(); if(editing&&linking){ linking=false; linkSrc=null; document.getElementById("linkMode").classList.remove("on"); viewport.classList.remove("linking"); } document.getElementById("editMode").classList.toggle("on",editing); toast(editing?"Editar: clic en un tema (color/tamaño) · clic o arrastrá una línea":"Editar desactivado"); renderMap(); });
  document.getElementById("addNode").addEventListener("click",()=>{ if(selId)addSubTo(selId); else addProject(); });
  function addSubTo(pid){ const p=N(pid); const ang=Math.random()*6.28; const id=newNode({name:"Nuevo sub-tema",parent:p.id,x:p.x+Math.cos(ang)*200,y:p.y+Math.sin(ang)*200}); p.children.push(id); treeOpen.add(p.id); saveTreeOpen(); openPanel(id); pTitle.select(); }
  function addProject(){ const id=newNode({kind:"project",name:"Nuevo proyecto",x:(Math.random()-.5)*400,y:(Math.random()-.5)*300}); state.roots.push(id); state.estProj=id; save(); renderActive(); openPanel(id); pTitle.select(); }

  // ---------- ESTRUCTURA ----------
  const estree=document.getElementById("estree");
  function moveTask(itemId,fromId,toId,beforeId){ if(beforeId===itemId)return; // soltarla sobre sí misma no hace nada
    const from=N(fromId),to=N(toId); if(!from||!to)return; const idx=(from.items||[]).findIndex(x=>x.id===itemId); if(idx<0)return; const [it]=from.items.splice(idx,1); to.items=to.items||[]; let j=to.items.length; if(beforeId){ const bi=to.items.findIndex(x=>x.id===beforeId); if(bi>=0)j=bi; } to.items.splice(j,0,it); save(); }
  function quickTask(node){ treeOpen.add(node.id); saveTreeOpen(); openNewTask({nodeId:node.id}); }
  function encChip(node){ return encsOf(node).map(p=>`<span class="encchip">${avatarMarkup(p,"av")}${esc(p)}</span>`).join(" "); }
  function renderEstBusqueda(){ const q=norm(estQuery.trim()); const info=document.getElementById("estSearchInfo"), clr=document.getElementById("estSearchClear");
    clr.hidden=!estQuery.trim();
    const hl=(txt)=>{ const t=esc(txt); const i=norm(txt).indexOf(q); if(i<0)return t; const raw=String(txt); return esc(raw.slice(0,i))+"<mark>"+esc(raw.slice(i,i+q.length))+"</mark>"+esc(raw.slice(i+q.length)); };
    const res=[];
    Object.values(state.nodes).forEach(n=>{
      const path=pathOf(n.id).map(z=>z.name); const label=path.pop();
      if(norm(n.name).includes(q)||norm(n.objetivo).includes(q)||norm(n.contexto).includes(q))
        res.push({kind:n.kind==="project"?"Proyecto":(depthOf(n)<=2?"Macro-tema":"Sub-tema"),color:accentOf(n),name:label,trail:path.join(" › ")||"raíz",go:()=>openPanel(n.id)});
      (n.items||[]).forEach(k=>{ if(k.archived)return;
        if(norm(k.title).includes(q)||norm(k.notas).includes(q)||norm(k.objetivo).includes(q)||norm(ownersOf(k).join(" ")).includes(q))
          res.push({kind:"Tarea",color:cssv(STATUS[k.status].v),name:k.title||"Tarea",trail:pathOf(n.id).map(z=>z.name).join(" › "),go:()=>openTask(n.id,k.id)}); }); });
    info.textContent=res.length?`${res.length} resultado${res.length===1?"":"s"}`:"";
    if(!res.length){ estree.innerHTML=`<div class="ph"><b>Sin resultados</b><div style="margin-top:6px;font-size:13px">No hay temas ni tareas que digan “${esc(estQuery.trim())}”.</div></div>`; return; }
    estree.innerHTML=res.slice(0,80).map((r,i)=>`<div class="resline" data-r="${i}"><span class="rk" style="background:${r.color}">${r.kind}</span><span class="rt"><b>${hl(r.name)}</b><span>${esc(r.trail)}</span></span><span class="go" style="color:var(--ink-faint)">↗</span></div>`).join("")
      +(res.length>80?`<div class="empty">…y ${res.length-80} más. Afiná la búsqueda.</div>`:"");
    estree.querySelectorAll("[data-r]").forEach(el=>el.addEventListener("click",()=>res[+el.dataset.r].go())); }
  function renderEstructura(){ const roots=state.roots.map(N).filter(Boolean);
    const sc=document.getElementById("estSearchClear"); if(sc)sc.hidden=!estQuery.trim();
    if(estQuery.trim()){ renderEstBusqueda(); return; }
    const si=document.getElementById("estSearchInfo"); if(si)si.textContent="";
    if(!roots.length){ estree.innerHTML='<div class="empty">Sin proyectos todavía.</div>'; return; }
    let projId=(state.estProj&&N(state.estProj))?state.estProj:roots[0].id; state.estProj=projId; const proj=N(projId);
    const macros=(proj.children||[]).map(N).filter(Boolean);
    if(state.estFocus && (!N(state.estFocus)||N(state.estFocus).parent!==projId)) state.estFocus="";
    let html=`<div class="projsel">`+roots.map(r=>`<button class="${r.id===projId?'on':''}" data-proj="${r.id}"><span style="width:9px;height:9px;border-radius:50%;background:${accentOf(r)}"></span>${esc(r.name)}</button>`).join("")+`<button class="add" data-addproj>＋ proyecto</button></div>`;
    html+=`<div id="estbody"></div>`; estree.innerHTML=html;
    estree.querySelectorAll("[data-proj]").forEach(b=>b.addEventListener("click",()=>{ state.estProj=b.dataset.proj; state.estFocus=""; save(); renderEstructura(); }));
    estree.querySelector("[data-addproj]").addEventListener("click",addProject);
    const body=document.getElementById("estbody");
    if(state.estFocus && N(state.estFocus)){ renderFocus(body,N(state.estFocus)); return; }
    const bd=document.createElement("div"); bd.className="estboard";
    if(!macros.length) bd.innerHTML=`<div class="empty">"${esc(proj.name)}" no tiene temas todavía.</div>`;
    macros.forEach(macro=>bd.appendChild(colFor(macro)));
    const addc=document.createElement("button"); addc.className="btn addcol"; addc.innerHTML="＋ tema"; addc.addEventListener("click",()=>addSubTo(proj.id)); bd.appendChild(addc); body.appendChild(bd); }
  function renderFocus(body,macro){ const wrap=document.createElement("div"); wrap.className="focusview";
    const back=document.createElement("button"); back.className="rowbtn fback"; back.textContent="← Volver a todos los temas"; back.style.marginBottom="12px"; back.addEventListener("click",()=>{ state.estFocus=""; save(); renderEstructura(); }); wrap.appendChild(back);
    const card=document.createElement("div"); card.className="focuscard"; card.style.borderTopColor=accentOf(macro);
    card.innerHTML=`<div style="display:flex;align-items:center;gap:10px"><h2 class="fname" style="flex:1;cursor:pointer">${esc(macro.name)}</h2><button class="rowbtn fedit">Editar</button></div>`
      +`<div class="fsec"><div class="flab">Objetivo</div><div class="ftext">${macro.objetivo?esc(macro.objetivo):'<span style="color:var(--ink-faint)">— sin definir —</span>'}</div></div>`
      +`<div class="fsec"><div class="flab">Estado actual</div><div class="ftext">${macro.contexto?esc(macro.contexto):'<span style="color:var(--ink-faint)">— sin definir —</span>'}</div></div>`;
    card.querySelector(".fname").addEventListener("click",()=>openPanel(macro.id));
    card.querySelector(".fedit").addEventListener("click",()=>openPanel(macro.id));
    wrap.appendChild(card);
    const sub=document.createElement("div"); sub.className="focussubs"; sub.dataset.drop=macro.id;
    (macro.items||[]).filter(k=>!k.archived).forEach(k=>sub.appendChild(taskRow(macro,k)));
    (macro.children||[]).map(N).filter(Boolean).forEach(c=>sub.appendChild(subBlock(c,true)));
    const add=document.createElement("div"); add.className="sbadd"; add.innerHTML=`<button class="rowbtn" data-sub>＋ sub-tema</button><button class="rowbtn" data-task>＋ tarea</button>`;
    add.querySelector("[data-sub]").addEventListener("click",()=>addSubTo(macro.id));
    add.querySelector("[data-task]").addEventListener("click",()=>quickTask(macro));
    sub.appendChild(add); wireDrop(sub,macro); wrap.appendChild(sub); body.appendChild(wrap); }
  function colFor(macro){ const col=document.createElement("div"); col.className="estcol"; col.style.borderTopColor=accentOf(macro);
    const head=document.createElement("div"); head.className="colh";
    head.innerHTML=`<div class="top"><span class="orb" style="background:${accentOf(macro)}"></span><span class="cname">${esc(macro.name)}</span><button class="colexp" title="Desplegar este tema">⤢</button></div>${macro.contexto?`<div class="ctxline">${esc(macro.contexto)}</div>`:""}${encsOf(macro).length?`<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${encChip(macro)}</div>`:""}`;
    head.style.cursor="pointer"; head.title="Doble clic para ver desplegado";
    const expand=()=>{ if(colClickTimer){clearTimeout(colClickTimer);colClickTimer=null;} state.estFocus=macro.id; save(); renderEstructura(); };
    head.querySelector(".colexp").addEventListener("click",e=>{ e.stopPropagation(); expand(); });
    head.querySelector(".cname").addEventListener("click",e=>{ e.stopPropagation(); if(colClickTimer)clearTimeout(colClickTimer); colClickTimer=setTimeout(()=>{colClickTimer=null;openPanel(macro.id);},210); });
    head.addEventListener("dblclick",expand);
    col.appendChild(head);
    const body=document.createElement("div"); body.className="colbody"; body.dataset.drop=macro.id;
    (macro.items||[]).filter(k=>!k.archived).forEach(k=>body.appendChild(taskRow(macro,k)));
    (macro.children||[]).map(N).filter(Boolean).forEach(c=>body.appendChild(subBlock(c)));
    wireDrop(body,macro); col.appendChild(body);
    const add=document.createElement("div"); add.className="coladd"; add.innerHTML=`<button class="rowbtn" data-sub>＋ sub-tema</button><button class="rowbtn" data-task>＋ tarea</button>`;
    add.querySelector("[data-sub]").addEventListener("click",()=>addSubTo(macro.id));
    add.querySelector("[data-task]").addEventListener("click",()=>quickTask(macro)); col.appendChild(add); return col; }
  function subBlock(node,forceOpen){ const wrap=document.createElement("div"); wrap.className="subblock"; wrap.style.borderLeftColor=accentOf(node); const a=agg(node); const open=forceOpen||treeOpen.has(node.id);
    const head=document.createElement("div"); head.className="sbh"; head.innerHTML=`<span class="car ${open?"open":""}">▶</span><span class="sname">${esc(node.name)}</span>${encsOf(node).length?`<span class="avs2">${encsOf(node).map(p=>avatarMarkup(p,"av2",true)).join("")}</span>`:""}<span class="cnt">${a.ic}</span>`;
    head.querySelector(".sname").addEventListener("click",()=>openPanel(node.id));
    head.querySelector(".car").addEventListener("click",()=>{ if(treeOpen.has(node.id))treeOpen.delete(node.id); else treeOpen.add(node.id); saveTreeOpen(); renderEstructura(); });
    wrap.appendChild(head);
    if(open){ const inner=document.createElement("div"); inner.className="sbin"; inner.dataset.drop=node.id;
      if(node.contexto){ const cx=document.createElement("div"); cx.className="ctxline"; cx.style.margin="2px 0 6px"; cx.textContent=node.contexto; inner.appendChild(cx); }
      (node.items||[]).filter(k=>!k.archived).forEach(k=>inner.appendChild(taskRow(node,k)));
      (node.children||[]).map(N).filter(Boolean).forEach(c=>inner.appendChild(subBlock(c)));
      const add=document.createElement("div"); add.className="sbadd"; add.innerHTML=`<button class="rowbtn" data-sub>＋ sub-tema</button><button class="rowbtn" data-task>＋ tarea</button>`;
      add.querySelector("[data-sub]").addEventListener("click",()=>addSubTo(node.id));
      add.querySelector("[data-task]").addEventListener("click",()=>quickTask(node));
      inner.appendChild(add); wireDrop(inner,node); wrap.appendChild(inner); }
    return wrap; }
  function taskRow(node,k){ const row=document.createElement("div"); row.className="taskrow"; row.draggable=true; row.dataset.item=k.id; const sc=cssv(STATUS[k.status].v);
    row.innerHTML=`<span class="grip" title="Arrastrá para mover">⋮⋮</span><input type="checkbox" class="chk" ${k.done?"checked":""}><span class="tt" style="${k.done?'text-decoration:line-through;color:var(--ink-faint)':''}">${esc(k.title||"Tarea")}</span><span class="sdotc" style="background:${sc}" title="${STATUS[k.status].l}"></span>${ownersOf(k).length?`<span class="who">${esc(peopleLabel(ownersOf(k)))}</span>`:''}`;
    const chk=row.querySelector(".chk"); chk.addEventListener("click",e=>e.stopPropagation());
    chk.addEventListener("change",e=>{ setDone(k,e.target.checked); save(); renderEstructura(); });
    row.querySelector(".tt").addEventListener("click",()=>openTask(node.id,k.id));
    row.addEventListener("dragstart",e=>{ dragTask={item:k,from:node}; row.classList.add("dragging"); if(e.dataTransfer)e.dataTransfer.effectAllowed="move"; });
    row.addEventListener("dragend",()=>{ dragTask=null; row.classList.remove("dragging"); document.querySelectorAll(".taskrow.over,.dropz").forEach(x=>x.classList.remove("over","dropz")); });
    row.addEventListener("dragover",e=>{ if(!dragTask)return; e.preventDefault(); e.stopPropagation(); row.classList.add("over"); });
    row.addEventListener("dragleave",()=>row.classList.remove("over"));
    row.addEventListener("drop",e=>{ if(!dragTask)return; e.preventDefault(); e.stopPropagation(); row.classList.remove("over"); moveTask(dragTask.item.id,dragTask.from.id,node.id,k.id); renderEstructura(); });
    return row; }
  function wireDrop(el,node){ el.addEventListener("dragover",e=>{ if(!dragTask)return; if(e.target.closest(".taskrow"))return; e.preventDefault(); el.classList.add("dropz"); }); el.addEventListener("dragleave",e=>{ if(e.target===el)el.classList.remove("dropz"); }); el.addEventListener("drop",e=>{ if(!dragTask)return; if(e.target.closest(".taskrow"))return; e.preventDefault(); e.stopPropagation(); /* si no, el contenedor padre lo mueve de nuevo */ el.classList.remove("dropz"); moveTask(dragTask.item.id,dragTask.from.id,node.id,null); dragTask=null; renderEstructura(); }); }

  // ---------- TAREAS ----------
  const kanban=document.getElementById("kanban");
  function tfil(){ const f=state.taskFilters||(state.taskFilters={people:[],status:[],temas:[],prio:[]}); ["people","status","temas","prio"].forEach(k=>{ if(!Array.isArray(f[k]))f[k]=[]; }); return f; }
  function macroList(){ return state.roots.map(N).filter(Boolean).flatMap(r=>(r.children||[]).map(N).filter(Boolean)); }
  const norm=s=>String(s==null?"":s).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");
  let taskQuery="", estQuery="";
  function filteredItems(){ const f=tfil(); let items=activeItems();
    if(f.status.length) items=items.filter(x=>f.status.includes(x.k.status));
    if(f.prio.length) items=items.filter(x=>f.prio.includes(x.k.prio||"__none"));
    if(f.people.length) items=items.filter(x=>{ const os=ownersOf(x.k); return os.length?os.some(o=>f.people.includes(o)):f.people.includes("__none"); });
    if(f.temas.length) items=items.filter(x=>f.temas.some(t=>N(t)&&inSubtree(x.node.id,t)));
    const q=norm(taskQuery.trim());
    if(q) items=items.filter(x=>norm(x.k.title).includes(q)||norm(x.k.notas).includes(q)||norm(x.k.objetivo).includes(q)||norm(ownersOf(x.k).join(" ")).includes(q)||norm(pathOf(x.node.id).map(z=>z.name).join(" ")).includes(q));
    return items; }
  let openFdrop=null;
  function renderFilterBar(){ const bar=document.getElementById("taskFilters"); if(!bar)return; const f=tfil();
    const grp=(key,label,opts)=>{ const sel=f[key]; const n=sel.length;
      return `<div class="fdrop" data-g="${key}"><button class="${n?"act":""}">${label}${n?`<span class="cnum">${n}</span>`:""}<span class="car">▼</span></button><div class="fmenu${openFdrop===key?" on":""}">`
        +(opts.length?opts.map(o=>`<label class="fopt"><input type="checkbox" data-v="${esc(o.v)}"${sel.includes(o.v)?" checked":""}><span class="sd" style="background:${o.c}"></span><span class="lbl">${esc(o.l)}</span></label>`).join(""):`<div class="empty">Nada para filtrar</div>`)
        +(n?`<button class="fclear">Limpiar</button>`:"")+`</div></div>`; };
    const total=f.people.length+f.status.length+f.temas.length+f.prio.length;
    bar.innerHTML=`<span class="barlab">Filtros</span>`
      +grp("status","Estado",STORD.map(s=>({v:s,l:STATUS[s].l,c:cssv(STATUS[s].v)})))
      +grp("prio","Prioridad",PRORD.map(p=>({v:p,l:PRIO[p].l,c:cssv(PRIO[p].v)})).concat([{v:"__none",l:"Sin prioridad",c:cssv("--ink-faint")}]))
      +grp("people","Persona",allPeople().map(p=>({v:p,l:p,c:avColor(p)})).concat([{v:"__none",l:"Sin asignar",c:cssv("--ink-faint")}]))
      +grp("temas","Tema",macroList().map(m=>({v:m.id,l:m.name,c:accentOf(m)})))
      +(total?`<button class="rowbtn" id="clearFilters">Limpiar todo</button>`:"");
    bar.querySelectorAll(".fdrop").forEach(d=>{ const key=d.dataset.g, btn=d.querySelector("button"), menu=d.querySelector(".fmenu");
      btn.addEventListener("click",e=>{ e.stopPropagation(); const was=menu.classList.contains("on"); bar.querySelectorAll(".fmenu").forEach(m=>m.classList.remove("on")); if(was){ openFdrop=null; } else { menu.classList.add("on"); openFdrop=key; } });
      menu.addEventListener("click",e=>e.stopPropagation());
      menu.querySelectorAll("input[type=checkbox]").forEach(cb=>cb.addEventListener("change",()=>{ const arr=tfil()[key], v=cb.dataset.v, i=arr.indexOf(v); if(cb.checked){ if(i<0)arr.push(v); } else if(i>=0)arr.splice(i,1); openFdrop=key; save(); renderTareas(); }));
      const cl=menu.querySelector(".fclear"); if(cl)cl.addEventListener("click",()=>{ tfil()[key]=[]; openFdrop=key; save(); renderTareas(); }); });
    const ca=document.getElementById("clearFilters"); if(ca)ca.addEventListener("click",()=>{ state.taskFilters={people:[],status:[],temas:[],prio:[]}; openFdrop=null; save(); renderTareas(); }); }
  document.addEventListener("click",()=>{ if(!openFdrop)return; document.querySelectorAll(".fmenu.on").forEach(m=>m.classList.remove("on")); openFdrop=null; });
  function renderTareas(){ const wg=document.getElementById("weekGoals"); if(wg&&document.activeElement!==wg)wg.value=state.weekGoals||"";
    renderFilterBar(); const f=tfil(); const items=filteredItems(); kanban.innerHTML="";
    document.getElementById("taskCount").textContent=items.length+(items.length===1?" tarea":" tareas");
    // Agrupar por tema se sacó: generaba una columna por cada tema con tareas
    // (quince con los datos reales) y para eso ya está la pestaña Estructura.
    if(taskGroup==="prioridad"){ PRORD.filter(p=>!f.prio.length||f.prio.includes(p)).forEach(p=>kanban.appendChild(makeCol(PRIO[p].l,cssv(PRIO[p].v),items.filter(x=>x.k.prio===p),{prio:p})));
      if(!f.prio.length||f.prio.includes("__none")) kanban.appendChild(makeCol("Sin prioridad",cssv("--ink-faint"),items.filter(x=>!x.k.prio),{prio:""})); }
    else if(taskGroup==="persona"){ const people=allPeople(); const groups={}; people.forEach(p=>groups[p]=[]); const sinA=[]; items.forEach(x=>{ const os=ownersOf(x.k).filter(o=>groups[o]); if(os.length)os.forEach(o=>groups[o].push(x)); else sinA.push(x); });
      people.forEach(p=>{ if(f.people.length&&!f.people.includes(p))return; kanban.appendChild(makeCol(p,avColor(p),groups[p],{person:p})); });
      if(!f.people.length||f.people.includes("__none")) kanban.appendChild(makeCol("Sin asignar",cssv("--ink-faint"),sinA,{person:""})); }
    else { STORD.filter(st=>!f.status.length||f.status.includes(st)).forEach(st=>kanban.appendChild(makeCol(STATUS[st].l,cssv(STATUS[st].v),items.filter(x=>x.k.status===st),{status:st}))); } }
  function inSubtree(nodeId,ancId){ let x=N(nodeId); while(x){ if(x.id===ancId)return true; x=N(x.parent); } return false; }
  function makeCol(title,color,items,meta){ const col=document.createElement("div"); col.className="kcol"; col.dataset.status=meta.status||""; col.dataset.person=meta.person==null?"__none":meta.person; col.dataset.node=meta.node||""; if(meta.prio!=null)col.dataset.prio=meta.prio;
    const archAll=(meta.status==="listo"&&items.length)?`<button class="colact" data-archall>archivar todas</button>`:"";
    col.innerHTML=`<h4><span style="width:9px;height:9px;border-radius:50%;background:${color}"></span>${esc(title)}<span class="n">${items.length}</span>${archAll}${meta.pth?`<span class="pth">${esc(meta.pth)}</span>`:""}</h4>`;
    const ab=col.querySelector("[data-archall]"); if(ab)ab.addEventListener("click",()=>confirmar(`Se van al Archivo ${items.length} tarea${items.length===1?"":"s"} terminada${items.length===1?"":"s"}. Podés restaurarlas cuando quieras.`,()=>{ items.forEach(x=>archiveTask(x.k)); save(); renderTareas(); refreshChrome(); },{title:"Archivar terminadas",yes:"Archivar"}));
    items.forEach(x=>col.appendChild(taskCard(x))); return col; }
  function colUnder(px,py){ const el=document.elementFromPoint(px,py); return el?el.closest(".kcol"):null; }
  function applyColDrop(col,x){ if(taskGroup==="estado"&&col.dataset.status){ setStatus(x.k,col.dataset.status); } else if(taskGroup==="prioridad"&&col.dataset.prio!=null){ x.k.prio=col.dataset.prio; } else if(taskGroup==="persona"){ const p=col.dataset.person; const os=ownersOf(x.k);
      /* a "Sin asignar" se libera; entre personas se mueve; desde otra vista se suma */
      if(!p||p==="__none"){ x.k.owners=[]; }
      else { const from=x.fromPerson; if(from&&from!==p){ const i=os.indexOf(from); if(i>=0)os.splice(i,1); }
        if(!os.includes(p))os.push(p); } }
    save(); renderTareas(); refreshChrome(); }
  function taskCard(x){ const k=x.k,node=x.node; const c=document.createElement("div"); c.className="kcard"; c.style.borderLeftColor=cssv(STATUS[k.status].v);
    const path=pathOf(node.id).map(p=>p.name).join(" › ");
    const pr=prioOf(k);
    c.innerHTML=`<div class="kt"><input type="checkbox" class="kchk" ${k.done?"checked":""} title="Marcar terminada"><span class="ktt ${k.done?"done":""}">${esc(k.title||"Tarea")}</span>${pr?`<span class="kprio" style="background:${cssv(pr.v)}" title="Prioridad ${pr.l.toLowerCase()}"></span>`:""}${k.done?'<button class="karch" title="Mandar al archivo">${ICO.archivar}</button>':""}</div><div class="kp"><span>${esc(path)}</span>${k.due?`<span style="color:var(--ink-faint)">${ICO.calendario} ${esc(k.due)}</span>`:''}${ownersOf(k).length?`<span class="kavs">${ownersOf(k).map(o=>avatarMarkup(o,"kwho",true)).join("")}</span>`:''}</div>`;
    const kchk=c.querySelector(".kchk");
    kchk.addEventListener("pointerdown",e=>e.stopPropagation());
    kchk.addEventListener("click",e=>e.stopPropagation());
    kchk.addEventListener("change",e=>{ setDone(k,e.target.checked); save(); renderTareas(); refreshChrome(); });
    const karch=c.querySelector(".karch");
    if(karch){ karch.addEventListener("pointerdown",e=>e.stopPropagation()); karch.addEventListener("click",e=>{ e.stopPropagation(); archiveTask(k); save(); renderTareas(); refreshChrome(); }); }
    let ds=null;
    c.addEventListener("pointerdown",e=>{ if(e.button!==0)return; ds={sx:e.clientX,sy:e.clientY,moved:false,clone:null};
      const oc=c.closest(".kcol"); x.fromPerson=(oc&&oc.dataset.person!=="__none")?oc.dataset.person:""; // de qué columna salió
      c.setPointerCapture(e.pointerId); });
    c.addEventListener("pointermove",e=>{ if(!ds)return; const dx=e.clientX-ds.sx,dy=e.clientY-ds.sy; if(!ds.moved&&Math.hypot(dx,dy)>6){ ds.moved=true; dragCard=x; c.classList.add("dragging"); const cl=c.cloneNode(true); cl.className="kcard dragclone"; cl.style.width=c.offsetWidth+"px"; document.body.appendChild(cl); ds.clone=cl; }
      if(ds.moved){ ds.clone.style.left=e.clientX+"px"; ds.clone.style.top=e.clientY+"px"; const col=colUnder(e.clientX,e.clientY); document.querySelectorAll(".kcol.drop").forEach(z=>z.classList.remove("drop")); if(col)col.classList.add("drop"); } });
    c.addEventListener("pointerup",e=>{ if(!ds)return; const moved=ds.moved,clone=ds.clone; ds=null; if(clone)clone.remove(); c.classList.remove("dragging"); const col=colUnder(e.clientX,e.clientY); document.querySelectorAll(".kcol.drop").forEach(z=>z.classList.remove("drop"));
      if(!moved){ dragCard=null; openTask(node.id,k.id); return; } if(col)applyColDrop(col,x); dragCard=null; });
    c.addEventListener("pointercancel",()=>{ if(ds&&ds.clone)ds.clone.remove(); ds=null; c.classList.remove("dragging"); dragCard=null; });
    return c; }
  document.getElementById("groupSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b)return; taskGroup=b.dataset.g; document.querySelectorAll("#groupSeg button").forEach(x=>x.classList.toggle("on",x===b)); renderTareas(); });

  // ---------- ARCHIVO ----------
  function renderArchivo(){ const box=document.getElementById("archivoBody");
    const at=k=>k.archivedAt||k.doneAt||0;
    const arch=allItems().filter(x=>x.k.archived).concat(privL().filter(k=>k.archived).map(k=>({k,node:null,priv:true}))).sort((a,b)=>at(b.k)-at(a.k));
    if(!arch.length){ box.innerHTML=`<div class="ph"><b>Nada archivado todavía</b><div style="margin-top:6px;font-size:13px">Cuando marques una tarea como terminada se archiva sola a los ${ARCH_DAYS} días — o mandala vos con el botón ${ICO.archivar} de la tarjeta.</div></div>`; return; }
    box.innerHTML=`<div class="card">${arch.map(x=>{ const path=x.priv?"Privada":pathOf(x.node.id).map(p=>p.name).join(" › "); const t=at(x.k); const dstr=t?new Date(t).toLocaleDateString():""; return `<div class="arow"><span>✓ ${esc(x.k.title||"Tarea")}</span><span class="ap">${esc(path)}${dstr?" · archivada "+esc(dstr):""}</span><button class="btn restore" data-r="${x.priv?"__priv":x.node.id}|${x.k.id}">Restaurar</button></div>`; }).join("")}</div>`;
    box.querySelectorAll(".restore").forEach(b=>b.addEventListener("click",()=>{ const [nid,iid]=b.dataset.r.split("|"); let k=null; if(nid==="__priv")k=privL().find(x=>x.id===iid); else { const n=N(nid); k=n&&(n.items||[]).find(x=>x.id===iid); } if(!k)return; setStatus(k,"curso"); save(); renderArchivo(); refreshChrome(); })); }

  // ---------- DRIVE ----------
  // El filtro del Drive es una vista personal: vive acá, no en el estado, así
  // que filtrar no le cambia la pantalla a nadie más.
  let driveQuery="", driveTema="", driveOrden="tema", fmTarget=null;
  function openFileModal(target){ fmTarget=target; // target: {kind:"node"|"task"|"pick", node, task}
    document.getElementById("fmUrl").value=""; const fmn=document.getElementById("fmName"); fmn.value=""; fmn.dataset.touched="";
    const wrap=document.getElementById("fmWhereWrap"), sel=document.getElementById("fmWhere");
    if(target.kind==="pick"){ wrap.style.display="";
      const opts=[]; const walk=(id,depth)=>{ const n=N(id); if(!n)return; const pad=depth>1?"　".repeat(depth-1)+"› ":"";
        opts.push(`<option value="n:${n.id}">${esc(pad+n.name)}</option>`);
        (n.items||[]).forEach(k=>{ if(!k.archived)opts.push(`<option value="t:${n.id}:${k.id}">${esc("　".repeat(depth)+"· "+(k.title||"Tarea"))}</option>`); });
        (n.children||[]).forEach(c=>walk(c,depth+1)); };
      state.roots.forEach(r=>walk(r,1)); sel.innerHTML=opts.join("");
    } else wrap.style.display="none";
    document.getElementById("fileModal").classList.add("on"); setTimeout(()=>document.getElementById("fmUrl").focus(),40); }
  function closeFM(){ document.getElementById("fileModal").classList.remove("on"); fmTarget=null; }
  // La ventana de lectura. El marco se carga recién al abrirla y se vacía al
  // cerrarla: si se dejara la dirección puesta, Drive seguiría trabajando
  // detrás de una ventana que ya nadie mira.
  function abrirPreview(src,nombre,kind,url){ const m=document.getElementById("pvModal"); if(!m)return;
    document.getElementById("pvIco").innerHTML=(FKIND[kind]||FKIND.link).i;
    const t=document.getElementById("pvName"); t.textContent=nombre||"Archivo"; t.title=nombre||"";
    document.getElementById("pvOpen").href=url||src;
    document.getElementById("pvFrame").src=src;
    m.classList.add("on"); }
  function cerrarPreview(){ const m=document.getElementById("pvModal"); if(!m||!m.classList.contains("on"))return;
    m.classList.remove("on"); document.getElementById("pvFrame").src="about:blank"; }
  function saveFM(){ const url=document.getElementById("fmUrl").value.trim(); if(!url){ note("Pegá el link del archivo o la carpeta."); return; }
    if(!/^https?:\/\//i.test(url)){ note("El link tiene que empezar con http:// o https://"); return; }
    const nombre=document.getElementById("fmName").value.trim(); const kind=kindOf(url,nombre); const name=nombre||(FKIND[kind]||FKIND.link).l;
    const f={id:"f"+uid(),url,name,kind,addedBy:state.me||"",addedAt:nowMs()};
    let owner=null, t=fmTarget;
    if(t.kind==="pick"){ const v=document.getElementById("fmWhere").value; const p=v.split(":");
      if(p[0]==="n")owner=N(p[1]); else { const n=N(p[1]); owner=n&&(n.items||[]).find(x=>x.id===p[2]); } }
    else owner=t.kind==="task"?t.task:t.node;
    if(!owner){ note("No encontré dónde vincularlo."); return; }
    filesOf(owner).push(f); save(); closeFM(); renderActive();
    if(panelOpen&&N(selId))renderPanelBody(N(selId));
    if(taskOpen)renderTFiles(); }
  function llenarFiltroDrive(){
    const sel=document.getElementById("driveTema"); if(!sel)return;
    const abierto=document.activeElement===sel;
    if(!abierto) sel.innerHTML='<option value="">Todos los temas</option>'+nodeOptionsHTML(driveTema,true);
    sel.value=driveTema;
    const b=document.getElementById("driveTemaClear"); if(b)b.hidden=!driveTema;
    sel.classList.toggle("act",!!driveTema); }
  function renderDrive(){ const box=document.getElementById("driveBody"); const q=norm(driveQuery.trim());
    let all=allFiles();
    if(q)all=all.filter(x=>norm(x.f.name).includes(q)||norm(x.f.url).includes(q)||norm(pathOf(x.node.id).map(z=>z.name).join(" ")).includes(q)||norm(x.task?x.task.title:"").includes(q));
    // Elegir un tema muestra lo suyo y lo de sus sub-temas: entrás a PNP y ves
    // todo lo que cuelga de ahí, no solo lo pegado al tema exacto.
    if(driveTema&&N(driveTema))all=all.filter(x=>inSubtree(x.node.id,driveTema));
    else if(driveTema)driveTema="";
    llenarFiltroDrive();
    if(!all.length){ const filtrando=driveQuery.trim()||driveTema;
      box.innerHTML=`<div class="ph"><b>${filtrando?"Sin resultados":"Todavía no hay archivos vinculados"}</b><div style="margin-top:6px;font-size:13px">${driveQuery.trim()?"Probá con otro nombre, o con el nombre del tema.":"Vinculá el primero desde la ficha de un tema o de una tarea."}</div></div>`; return; }
    // Un archivo pertenece al tema o sub-tema donde se lo vinculó. Se agrupa por
    // ese tema exacto y los temas se listan en el orden del árbol: así el Drive
    // es un espejo de la Estructura y no una lista suelta de links.
    const porNodo=new Map();
    all.forEach(x=>{ if(!porNodo.has(x.node.id))porNodo.set(x.node.id,[]); porNodo.get(x.node.id).push(x); });
    const enOrden=raiz=>{ const out=[]; const bajar=id=>{ const n=N(id); if(!n)return; out.push(id); (n.children||[]).forEach(bajar); }; bajar(raiz); return out; };
    // Un archivo colgado del proyecto mismo no tiene ruta por debajo: se muestra
    // el nombre del proyecto para que la columna nunca quede vacía.
    const ruta=x=>{ const p=pathOf(x.node.id).map(z=>z.name); const bajo=p.slice(1).join(" › ")||p[0]||"Proyecto";
      return bajo+(x.task?" › "+(x.task.title||"Tarea"):""); };
    const filaConRuta=x=>{ const k=FKIND[x.f.kind]||FKIND.link; const r=ruta(x);
      return `<div class="filerow"><span class="fic" title="${k.l}">${k.i}</span><a class="fnm" href="${esc(x.f.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.f.url)}">${esc(x.f.name||x.f.url)}</a><button class="fpath fpathgo" data-go="${x.node.id}" title="Ir al tema: ${esc(r)}">${esc(r)}</button>${verBtn(x.f)}</div>`; };
    const fila=x=>{ const k=FKIND[x.f.kind]||FKIND.link; const tarea=x.task?(x.task.title||"Tarea"):"";
      return `<div class="filerow"><span class="fic" title="${k.l}">${k.i}</span><a class="fnm" href="${esc(x.f.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.f.url)}">${esc(x.f.name||x.f.url)}</a>${tarea?`<span class="fpath" title="Tarea: ${esc(tarea)}">${esc(tarea)}</span>`:""}${verBtn(x.f)}</div>`; };
    const bloque=(titulo,color,ids)=>{ const conArchivos=ids.filter(id=>porNodo.has(id)); if(!conArchivos.length)return "";
      const total=conArchivos.reduce((a,id)=>a+porNodo.get(id).length,0);
      let h=`<div class="drivegroup"><h3><span class="orb" style="background:${color}"></span>${esc(titulo)}<span class="cnt">${total}</span></h3>`;
      conArchivos.forEach(id=>{ const arr=porNodo.get(id);
        const ruta=pathOf(id).map(z=>z.name).slice(2).join(" › ");
        // Lo vinculado al macro-tema mismo va suelto: un sub-encabezado que
        // repite el título de arriba no agrega nada.
        h+=(ruta?`<div class="dsub"><button class="dsubname" data-go="${id}">${esc(ruta)}</button><span class="cnt">${arr.length}</span></div>`:"")+arr.map(fila).join(""); });
      return h+"</div>"; };
    let html="";
    if(driveOrden==="nombre"){
      // Todo junto, alfabético, con la ruta de cada uno al costado.
      html=all.slice().sort((a,b)=>(a.f.name||a.f.url).localeCompare(b.f.name||b.f.url,"es",{sensitivity:"base"}))
        .map(filaConRuta).join("");
    } else if(driveOrden==="tipo"){
      // Agrupado por tipo de archivo, en el orden en que están declarados.
      const orden=Object.keys(FKIND);
      const porTipo=new Map();
      all.forEach(x=>{ const k=FKIND[x.f.kind]?x.f.kind:"link"; if(!porTipo.has(k))porTipo.set(k,[]); porTipo.get(k).push(x); });
      orden.filter(k=>porTipo.has(k)).forEach(k=>{ const arr=porTipo.get(k).slice()
          .sort((a,b)=>(a.f.name||"").localeCompare(b.f.name||"","es",{sensitivity:"base"}));
        html+=`<div class="drivegroup"><h3>${FKIND[k].i}${esc(FKIND[k].l)}<span class="cnt">${arr.length}</span></h3>`
          +arr.map(filaConRuta).join("")+"</div>"; });
    } else {
      const macros=macroList();
      macros.forEach(m=>{ html+=bloque(m.name,accentOf(m),enOrden(m.id)); });
      // Lo que cuelga directo del proyecto, fuera de todo macro-tema.
      const sueltos=[...porNodo.keys()].filter(id=>!macros.some(m=>inSubtree(id,m.id)));
      if(sueltos.length) html+=bloque("Nivel proyecto","var(--ink-faint)",sueltos);
    }
    box.innerHTML=html;
    const cuenta=document.getElementById("driveCuenta");
    if(cuenta)cuenta.textContent=all.length+(all.length===1?" archivo":" archivos");
    document.querySelectorAll("#driveOrdenSeg [data-o]").forEach(b=>b.classList.toggle("on",b.dataset.o===driveOrden));
    box.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>openPanel(b.dataset.go))); }

  // ---------- CHAT + EVENTOS ----------
  function groupsAll(){ if(!state.chat.groups)state.chat.groups={}; return state.chat.groups; }
  function groupOf(chan){ return chan.startsWith("grp:")?groupsAll()[chan.slice(4)]:null; }
  function myGroups(){ const me=state.me; return Object.values(groupsAll()).filter(g=>!me||(g.members||[]).includes(me)).sort((a,b)=>a.name.localeCompare(b.name)); }
  // el canal privado se identifica por el PAR de personas, no por una sola:
  // con una sola clave, el mensaje no le llegaba al destinatario y sí lo veían los demás
  function dmKey(a,b){ return [String(a||""),String(b||"")].sort((x,y)=>x.localeCompare(y)).join(" ~ "); }
  function msgsOf(chan){ if(chan==="team")return state.chat.team||(state.chat.team=[]);
    if(chan.startsWith("grp:")){ const g=groupOf(chan); if(!g)return []; return g.msgs||(g.msgs=[]); }
    const other=chan.slice(3), me=state.me||""; if(!me||!other||other===me)return [];
    const k=dmKey(me,other); return state.chat.dm[k]||(state.chat.dm[k]=[]); }
  function chanTitle(chan){ if(chan==="team")return ICO.equipo+" Equipo"; const g=groupOf(chan); if(g)return ICO.grupo+" "+esc(g.name); return ICO.persona+" "+esc(chan.slice(3)); }
  function renderChat(){ const me=state.me;
    if(chatChan.startsWith("grp:")&&!groupOf(chatChan))chatChan="team";
    const list=document.getElementById("chanList");
    list.innerHTML=`<div class="chsec">Canales</div><div class="chanitem ${chatChan==="team"?"on":""}" data-ch="team"><span class="av" style="background:var(--wood)">${ICO.equipo}</span>Equipo</div>`+
      myGroups().map(g=>`<div class="chanitem ${chatChan==="grp:"+g.id?"on":""}" data-ch="grp:${g.id}"><span class="av" style="background:var(--accent-priv)">${ICO.grupo}</span><span class="chname">${esc(g.name)}</span></div>`).join("")+
      `<button class="chadd" id="newGroup">＋ nuevo grupo</button>`+
      `<div class="chsec">Personal</div>`+
      allPeople().filter(p=>p&&p!==me).map(p=>`<div class="chanitem ${chatChan==="dm:"+p?"on":""}" data-ch="dm:${esc(p)}">${avatarMarkup(p,"av")}<span class="chname">${esc(p)}</span></div>`).join("");
    list.querySelectorAll("[data-ch]").forEach(el=>el.addEventListener("click",()=>{ chatChan=el.dataset.ch; renderChat(); }));
    document.getElementById("newGroup").addEventListener("click",()=>openGroupModal(null));
    const head=document.getElementById("chatHead"); const g=groupOf(chatChan);
    // chanTitle ya devuelve HTML (icono + nombre escapado): volver a escapar
    // acá imprimía el SVG como texto.
    head.innerHTML=`<span>${chanTitle(chatChan)}</span>${g?`<span class="grpmem" title="${esc((g.members||[]).join(", "))}">${(g.members||[]).length} personas</span><button class="rowbtn" id="editGroup">editar</button>`:""}<span class="infob" tabindex="0">i<span class="infopop"><b>Chat, grupos y eventos</b><ul>
      <li><b>Grupos</b>: armá uno con dos o tres personas para un tema puntual. Solo lo ven quienes estén adentro.</li>
      <li>En <b>Personal</b> tenés un canal uno a uno con cada persona.</li>
      <li><b>＋ Evento</b> propone una reunión: se publica con <b>Voy / No voy</b> y aparece en el calendario de todos.</li>
      <li>Los mensajes llegan a los demás al instante, y si tienen las notificaciones activadas les avisa al celular.</li></ul></span></span><span class="spacer"></span>${chatChan==="team"?'<button class="btn" id="newEv">＋ Evento</button>':""}`;
    const ne=document.getElementById("newEv"); if(ne)ne.addEventListener("click",openEvNew);
    const eg=document.getElementById("editGroup"); if(eg)eg.addEventListener("click",()=>openGroupModal(g.id));
    const box=document.getElementById("msgs"); const inp=document.getElementById("msgInput");
    if(!me){ box.innerHTML=`<div class="ph"><b>No pudimos identificarte</b><div style="margin-top:6px;font-size:13px">Probá recargar la página.</div></div>`; inp.disabled=true; return; }
    inp.disabled=false; const msgs=msgsOf(chatChan);
    box.innerHTML=msgs.length?msgs.map(m=>msgHTML(m,me)).join(""):`<div class="empty">Sin mensajes todavía. Escribí el primero.</div>`;
    msgs.forEach(m=>{ const row=box.querySelector(`[data-msg="${m.id}"]`); if(!row)return;
      if(m.ev){ row.querySelectorAll("[data-rsvp]").forEach(b=>b.addEventListener("click",()=>setRsvp(m.ev,b.dataset.rsvp))); const t=row.querySelector(".evtitle"); if(t)t.addEventListener("click",()=>openEvView(m.ev)); }
      const dl=row.querySelector("[data-dl]"); if(dl)dl.addEventListener("click",()=>downloadMsgFile(m.id)); });
    seenMap()[chatChan]=msgs.length; save(); updateChatBadge(); box.scrollTop=box.scrollHeight; }
  function seenMap(){ const me=state.me||"__anon"; state.chatSeen=state.chatSeen||{}; if(!state.chatSeen[me]||typeof state.chatSeen[me]!=="object")state.chatSeen[me]={}; return state.chatSeen[me]; }
  function msgHTML(m,me){ if(m.ev){ const ev=(state.events||[]).find(e=>e.id===m.ev); if(!ev)return ""; const yes=Object.values(ev.rsvp||{}).filter(v=>v==="yes").length; const mine=(ev.rsvp||{})[me];
      return `<div class="msg event" data-msg="${m.id}"><div class="who">${esc(m.from)} propuso un evento</div><div class="evtitle" style="cursor:pointer">${ICO.calendario} ${esc(ev.title)}</div><div class="evmeta">${esc(ev.date)}${ev.time?" · "+esc(ev.time):""}</div><div class="rsvp"><button class="yes ${mine==="yes"?"on":""}" data-rsvp="yes">Voy</button><button class="no ${mine==="no"?"on":""}" data-rsvp="no">No voy</button><span class="tally">${yes} confirmado${yes===1?"":"s"}</span></div></div>`; }
    const mm=(m.from===me);
    if(m.file){ const f=m.file; const kb=f.size>=1048576?(f.size/1048576).toFixed(1)+" MB":Math.max(1,Math.round(f.size/1024))+" KB";
      const ic=/^image\//.test(f.type)?ICO.imagen:/pdf/.test(f.type)?ICO.pdf:/sheet|excel|csv/.test(f.type)?ICO.sheet:/word|document/.test(f.type)?ICO.doc:ICO.clip;
      return `<div class="msg ${mm?"mine":""}" data-msg="${m.id}">${mm?"":`<div class="who">${esc(m.from)}</div>`}`
        +(/^image\//.test(f.type)&&f.data?`<img class="msgimg" src="${f.data}" alt="${esc(f.name)}">`:"")
        +`<div class="msgfile"><span class="fic">${ic}</span><span class="fmeta"><b>${esc(f.name)}</b><span>${kb}</span></span><button class="rowbtn" data-dl="${m.id}">Descargar</button></div>`
        +(m.text?`<div style="margin-top:6px">${esc(m.text)}</div>`:"")+`</div>`; }
    return `<div class="msg ${mm?"mine":""}">${mm?"":`<div class="who">${esc(m.from)}</div>`}<div>${esc(m.text)}</div></div>`; }
  function sendMsg(){ const inp=document.getElementById("msgInput"); const me=state.me; if(!me)return; const t=inp.value.trim(); if(!t)return; msgsOf(chatChan).push({id:"m"+uid(),from:me,text:t,ts:nowMs()}); inp.value=""; save(); renderChat(); }
  const MAXFILE=3*1024*1024;
  function attachFile(file){ const me=state.me; if(!me)return;
    if(file.size>MAXFILE){ note(`"${file.name}" pesa ${(file.size/1048576).toFixed(1)} MB. Por ahora el límite es 3 MB por archivo, porque todo se guarda dentro de la app. Para algo más grande, subilo a Drive y compartí el link desde la pestaña Drive.`,"Archivo muy pesado"); return; }
    const r=new FileReader();
    r.onload=()=>{ msgsOf(chatChan).push({id:"m"+uid(),from:me,text:"",ts:nowMs(),file:{name:file.name,size:file.size,type:file.type||"",data:r.result}}); save(); renderChat(); };
    r.onerror=()=>note("No se pudo leer el archivo.");
    r.readAsDataURL(file); }
  async function downloadMsgFile(mid){ const m=msgsOf(chatChan).find(x=>x.id===mid); if(!m||!m.file)return; const f=m.file;
    if(window.claude&&window.claude.downloads){ try{ const b=await (await fetch(f.data)).blob(); await window.claude.downloads.save({filename:f.name,data:b}); return; }catch(err){ if(err&&err.code==="declined")return; } }
    try{ const a=document.createElement("a"); a.href=f.data; a.download=f.name; document.body.appendChild(a); a.click(); a.remove(); }
    catch(e){ note("No se pudo descargar el archivo."); } }
  function closeEv(){ document.getElementById("evModal").classList.remove("on"); }
  function openEvNew(presetDate){ evForm(null,presetDate); }
  function openEvEdit(id){ const ev=(state.events||[]).find(e=>e.id===id); if(ev)evForm(ev); }
  function evForm(ev,presetDate){ const box=document.getElementById("evBox"); const today=ymdLocal(new Date());
    const da0=ev?ev.date:((presetDate&&/^\d{4}-\d{2}-\d{2}$/.test(presetDate))?presetDate:today);
    box.innerHTML=`<h2>${ev?"Editar evento":"Nuevo evento"}</h2><div class="pctl"><div class="c" style="flex:1 1 100%"><label>Título</label><input class="txt" id="evTitle" placeholder="Reunión de equipo" value="${ev?esc(ev.title):""}"></div></div><div class="pctl"><div class="c"><label>Fecha</label><input type="date" class="txt" id="evDate" value="${da0}"></div><div class="c"><label>Hora</label><input type="time" class="txt" id="evTime" value="${ev?esc(ev.time||""):""}"></div></div><div class="pctl"><div class="c" style="flex:1 1 100%"><label>Descripción (opcional)</label><textarea class="txt" id="evDesc" rows="2" placeholder="Lugar, agenda, notas…">${ev?esc(ev.desc||""):""}</textarea></div></div><div class="row"><div style="flex:1"></div><button class="btn" id="evCancel">Cancelar</button><button class="btn btn-primary" id="evCreate">${ev?"Guardar cambios":"Crear y avisar al equipo"}</button></div>`;
    document.getElementById("evModal").classList.add("on");
    box.querySelector("#evCancel").addEventListener("click",()=>{ if(ev)openEvView(ev.id); else closeEv(); });
    box.querySelector("#evTitle").focus();
    box.querySelector("#evCreate").addEventListener("click",()=>{ const ti=box.querySelector("#evTitle").value.trim()||"Evento"; const da=box.querySelector("#evDate").value||da0; const ho=box.querySelector("#evTime").value||""; const de=box.querySelector("#evDesc").value.trim();
      if(ev){ ev.title=ti; ev.date=da; ev.time=ho; ev.desc=de; save(); renderActive(); openEvView(ev.id); return; }
      const id="ev"+uid(); const rsvp={}; if(state.me)rsvp[state.me]="yes"; state.events.push({id,date:da,title:ti,time:ho,desc:de,rsvp}); state.chat.team.push({id:"m"+uid(),from:state.me||"Equipo",ev:id,ts:nowMs()}); chatChan="team"; save(); closeEv(); renderActive(); }); }
  // link a Google Calendar con el evento precargado (el recordatorio lo manda Google)
  function gcalUrl(ev){ const pad=n=>String(n).padStart(2,"0");
    const [y,m,d]=(ev.date||"").split("-").map(Number); if(!y)return "";
    let dates;
    if(ev.time&&/^\d{1,2}:\d{2}$/.test(ev.time)){ const [hh,mm]=ev.time.split(":").map(Number);
      const ini=new Date(y,m-1,d,hh,mm), fin=new Date(ini.getTime()+60*60000);
      const f=x=>`${x.getFullYear()}${pad(x.getMonth()+1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
      dates=f(ini)+"/"+f(fin);
    } else { const ini=new Date(y,m-1,d), fin=new Date(y,m-1,d+1);
      const f=x=>`${x.getFullYear()}${pad(x.getMonth()+1)}${pad(x.getDate())}`;
      dates=f(ini)+"/"+f(fin); }
    const p=new URLSearchParams({action:"TEMPLATE",text:ev.title||"Reunión",dates});
    if(ev.desc)p.set("details",ev.desc);
    return "https://calendar.google.com/calendar/render?"+p.toString(); }
  function openEvView(id){ const ev=(state.events||[]).find(e=>e.id===id); if(!ev)return; const box=document.getElementById("evBox"); const me=state.me;
    const rows=allPeople().map(p=>{ const v=(ev.rsvp||{})[p]; return `<div class="arow"><span>${esc(p)}</span><span class="ap">${v==="yes"?"Voy":v==="no"?"No voy":"— sin responder"}</span></div>`; }).join("");
    box.innerHTML=`<h2>${esc(ev.title)}</h2><p>${ICO.calendario} ${esc(ev.date)}${ev.time?" · "+ICO.reloj+" "+esc(ev.time):""}</p>${ev.desc?`<p style="color:var(--ink-soft);font-size:13px;line-height:1.5;margin-top:-6px">${esc(ev.desc)}</p>`:""}${me?`<div class="pop-l">Tu respuesta</div><div class="rsvp"><button class="yes ${(ev.rsvp||{})[me]==="yes"?"on":""}" data-rv="yes">Voy</button><button class="no ${(ev.rsvp||{})[me]==="no"?"on":""}" data-rv="no">No voy</button></div>`:'<p style="color:var(--ink-faint);font-size:12px">Elegí quién sos (arriba) para responder.</p>'}<div class="pop-l" style="margin-top:14px">Asistencia del equipo</div>${rows}<div class="row" style="margin-top:14px"><a class="btn" href="${esc(gcalUrl(ev))}" target="_blank" rel="noopener noreferrer" title="Se abre Google Calendar con el evento ya cargado; vos confirmás">${ICO.calendario} Agregar a mi calendario</a><div style="flex:1"></div><button class="btn" id="evEdit">✎ Editar</button><button class="btn danger" id="evDel">Eliminar</button><button class="btn btn-primary" id="evOk">Listo</button></div>`;
    document.getElementById("evModal").classList.add("on");
    box.querySelectorAll("[data-rv]").forEach(b=>b.addEventListener("click",()=>{ setRsvp(id,b.dataset.rv); openEvView(id); }));
    box.querySelector("#evEdit").addEventListener("click",()=>openEvEdit(id));
    box.querySelector("#evOk").addEventListener("click",closeEv);
    box.querySelector("#evDel").addEventListener("click",()=>{ closeEv(); confirmar("El evento se borra para todo el equipo.",()=>{ state.events=state.events.filter(e=>e.id!==id); if(state.chat)state.chat.team=(state.chat.team||[]).filter(m=>m.ev!==id); save(); renderActive(); },{title:"Eliminar evento",yes:"Eliminar",danger:true}); }); }
  function setRsvp(id,val){ if(!state.me){ note("No pudimos identificarte para responder."); return; } const ev=(state.events||[]).find(e=>e.id===id); if(!ev)return; ev.rsvp=ev.rsvp||{}; if(ev.rsvp[state.me]===val)delete ev.rsvp[state.me]; else ev.rsvp[state.me]=val; save(); if(active==="chat")renderChat(); if(active==="panel")renderPanel(); }
  function chatUnread(){ const c=state.chat||{team:[],dm:{}}; const seen=seenMap(); const me=state.me;
    let u=Math.max(0,(c.team||[]).length-(seen.team||0));
    if(me)allPeople().filter(p=>p&&p!==me).forEach(p=>{ const arr=(c.dm||{})[dmKey(me,p)]||[]; u+=Math.max(0,arr.length-(seen["dm:"+p]||0)); });
    myGroups().forEach(g=>{ u+=Math.max(0,(g.msgs||[]).length-(seen["grp:"+g.id]||0)); });
    return u; }
  // ---------- grupos de chat ----------
  let grpEditId=null, grpMembers=[];
  function openGroupModal(gid){ const me=state.me;
    if(!me){ note("No pudimos identificarte para armar un grupo."); return; }
    grpEditId=gid; const g=gid?groupsAll()[gid]:null;
    grpMembers=g?(g.members||[]).slice():[me];
    document.getElementById("gmTitle").textContent=g?"Editar grupo":"Nuevo grupo";
    document.getElementById("gmName").value=g?g.name:"";
    document.getElementById("gmDel").style.display=g?"":"none";
    renderGrpMembers();
    document.getElementById("groupModal").classList.add("on"); setTimeout(()=>document.getElementById("gmName").focus(),40); }
  function renderGrpMembers(){ const me=state.me;
    document.getElementById("gmMembers").innerHTML=allPeople().map(p=>`<label class="fopt"><input type="checkbox" data-m="${esc(p)}" ${grpMembers.includes(p)?"checked":""} ${p===me?"disabled":""}><span class="sd" style="background:${avColor(p)}"></span><span class="lbl">${esc(p)}${p===me?" (vos)":""}</span></label>`).join("");
    document.getElementById("gmMembers").querySelectorAll("[data-m]").forEach(cb=>cb.addEventListener("change",()=>{ const p=cb.dataset.m; const i=grpMembers.indexOf(p);
      if(cb.checked){ if(i<0)grpMembers.push(p); } else if(i>=0)grpMembers.splice(i,1); })); }
  function closeGM(){ document.getElementById("groupModal").classList.remove("on"); grpEditId=null; }
  function saveGM(){ const name=document.getElementById("gmName").value.trim();
    if(!name){ note("Ponele un nombre al grupo."); return; }
    if(grpMembers.length<2){ note("Un grupo necesita al menos dos personas."); return; }
    const gs=groupsAll();
    if(grpEditId&&gs[grpEditId]){ gs[grpEditId].name=name; gs[grpEditId].members=grpMembers.slice(); }
    else { const id="g"+uid(); gs[id]={id,name,members:grpMembers.slice(),msgs:[],by:state.me||""}; chatChan="grp:"+id; }
    save(); closeGM(); renderChat(); }
  function delGM(){ const gid=grpEditId, gs=groupsAll(), g=gs[gid]; if(!g)return; closeGM();
    confirmar(`Se borra el grupo "${g.name}" y todos sus mensajes, para todos los que están adentro.`,()=>{ delete gs[gid]; if(chatChan==="grp:"+gid)chatChan="team"; save(); renderChat(); },{title:"Eliminar grupo",yes:"Eliminar",danger:true}); }
  function updateChatBadge(){ const b=document.getElementById("chatBadge"); if(!b)return; const u=chatUnread(); if(u>0){ b.textContent=u>9?"9+":u; b.hidden=false; } else b.hidden=true; }

  // ---------- PANEL personal ----------
  const MES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const DOWL=["lun","mar","mié","jue","vie","sáb","dom"];
  function ymdLocal(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  const VISTAS_PANEL={"":"Mi panel",cal:"Calendario",upcoming:"Próximos eventos",foco:"Mi foco",notas:"Mis notas"};
  function panelView(){ return VISTAS_PANEL[state.panelView]!==undefined?state.panelView:""; }
  function renderPanel(){ if(cal.y==null){ const t=new Date(); cal.y=t.getFullYear(); cal.m=t.getMonth(); }
    const v=panelView(), todo=v==="";
    // "Próximos eventos" se muestra con el calendario arriba: la lista sola queda
    // pelada, y con el mes delante se lee como una agenda.
    const ver=(id,on)=>{ const el=document.getElementById(id); if(el)el.hidden=!on; };
    ver("calMount", todo||v==="cal");
    ver("upcoming", todo||v==="upcoming");
    ver("myTasks",  todo||v==="foco");
    ver("myNotes",  todo||v==="notas");
    const h=document.querySelector("#tab-panel .h1");
    if(h&&h.firstChild&&h.firstChild.nodeType===3)h.firstChild.nodeValue=VISTAS_PANEL[v];
    renderCalendar(); renderUpcoming(); renderMyTasks(); renderMyNotes(); marcarSubs(); }
  function marcarSubs(){ const v=panelView();
    document.querySelectorAll(".sbsub").forEach(b=>b.classList.toggle("on", active==="panel"&&b.dataset.view===v));
    const mp=document.querySelector('.sbitem[data-tab="panel"]');
    if(mp)mp.classList.toggle("on", active==="panel"); }
  function renderConfigTab(){ renderProfile(); renderConfig(); }
  function renderProfile(){ const box=document.getElementById("profile"); if(!box)return; const me=state.me;
    if(!me){ box.innerHTML=""; return; }
    const mine=avColor(me); const hasPhoto=!!(state.avatars&&state.avatars[me]);
    box.innerHTML=`<div class="profilerow">${avatarMarkup(me,"pav")}<div class="pinfo"><b class="myname" title="Doble clic para cambiar tu color">${esc(me)}</b>`
      +`<button class="tinylink" id="changePhoto">${hasPhoto?"cambiar foto":"subir foto"}</button>`
      +`${hasPhoto?`<button class="tinylink" id="dropPhoto">sacar la foto</button>`:""}</div>`
      +`<div class="colorpick" id="colorPick" hidden><span class="cplab">Tu color</span>`
      +AV.map(c=>`<button class="sw2 ${c===mine?"on":""}" data-c="${c}" style="background:${c}" title="Elegir este color"></button>`).join("")
      +`</div><input type="file" id="photoInput" accept="image/*" hidden></div>`;
    box.querySelector("#changePhoto").addEventListener("click",()=>box.querySelector("#photoInput").click());
    const dp=box.querySelector("#dropPhoto"); if(dp)dp.addEventListener("click",()=>{ delete state.avatars[me]; save(); renderActive(); });
    box.querySelector(".myname").addEventListener("dblclick",()=>{ const cp=box.querySelector("#colorPick"); cp.hidden=!cp.hidden; });
    box.querySelectorAll("[data-c]").forEach(b=>b.addEventListener("click",()=>{ state.userColors=state.userColors||{}; state.userColors[me]=b.dataset.c; save(); renderActive(); }));
    box.querySelector("#photoInput").addEventListener("change",e=>{ const f=e.target.files&&e.target.files[0]; if(!f)return; loadAvatar(f,uri=>{ state.avatars=state.avatars||{}; state.avatars[me]=uri; save(); renderActive(); }); }); }

  // ---------- CONFIGURACIÓN ----------
  // Todo lo tuyo en un solo lugar: quién sos, cómo se ve la app, avisos,
  // el equipo y el respaldo.
  function renderConfig(){ const box=document.getElementById("config"); if(!box)return;
    const me=state.me||""; const yoM=miembroPorEmail(miEmail);
    const paleta=state.palette||"carbon";
    const temaActual=state.theme||"";
    box.innerHTML=`<div class="cfg">
      <div class="cfgsec"><div class="lab">Vos</div>
        <div class="cfgrow"><span class="lbl">Tu nombre<small>Así te ven los demás en toda la app</small></span>
          <input class="txt" id="cfgNombre" value="${esc(me)}" maxlength="40"><button class="btn" id="cfgNombreOk">Guardar</button></div>
        <div class="cfgrow"><span class="lbl">Tu correo<small>Con este entrás; no se puede cambiar</small></span>
          <span style="font-size:12.5px;color:var(--ink-faint)">${esc(miEmail||"—")}</span></div>
        <div class="cfgrow"><span class="lbl">Tu color<small>Te identifica en tarjetas, columnas y filtros</small></span>
          <div class="colorpick">${AV.map(c=>`<button class="sw2 ${c===avColor(me)?"on":""}" data-cfgc="${c}" style="background:${c}"></button>`).join("")}</div></div>
      </div>
      <div class="cfgsec"><div class="lab">Cómo se ve</div>
        <div class="cfgrow"><span class="lbl">Tema</span>
          <div class="segpal" id="cfgTema">
            <button data-t="" class="${temaActual===""?"on":""}">Automático</button>
            <button data-t="light" class="${temaActual==="light"?"on":""}">Claro</button>
            <button data-t="dark" class="${temaActual==="dark"?"on":""}">Oscuro</button></div></div>
        <div class="cfgrow"><span class="lbl">Paleta de fondo</span>
          <div class="segpal" id="cfgPal">${Object.entries(PALETAS).map(([k,l])=>`<button data-p="${k}" class="${paleta===k?"on":""}">${l}</button>`).join("")}</div></div>
      </div>
      <div class="cfgsec"><div class="lab">Avisos</div>
        <div class="cfgrow"><span class="lbl">Notificaciones en este dispositivo<small>Te avisa cuando te asignan una tarea o te escriben, aunque tengas la app cerrada</small></span>
          <span id="cfgPush"></span></div>
      </div>
      <div class="cfgsec"><div class="lab">Equipo</div>
        <div id="cfgTeam"></div>
        <div class="cfgrow"><span class="lbl">Sumar a alguien<small>Recibe acceso con su propio correo</small></span>
          <input class="txt" id="cfgInvitar" placeholder="correo@ejemplo.com" type="email"><button class="btn" id="cfgInvitarOk">Habilitar</button></div>
      </div>
      <div class="cfgsec"><div class="lab">Respaldo</div>
        <div class="cfgrow"><span class="lbl">Descargar una copia<small>Todo el contenido del equipo en un archivo</small></span>
          <button class="btn" id="cfgBackup">Descargar</button></div>
        <div class="cfgrow"><span class="lbl">Importar una copia<small>Reemplaza el contenido de todo el equipo</small></span>
          <button class="btn danger" id="cfgRestore">Importar…</button></div>
      </div>
    </div>`;
    const inp=document.getElementById("cfgNombre");
    const guardarNombre=()=>{ const nuevo=inp.value.trim();
      if(!nuevo){ note("El nombre no puede quedar vacío."); inp.value=me; return; }
      if(nuevo===me)return;
      if(nuevo.includes(" ~ ")){ note('El nombre no puede contener " ~ ".'); inp.value=me; return; }
      if(allPeople().some(p=>p!==me&&p.toLowerCase()===nuevo.toLowerCase())){ note("Ya hay alguien con ese nombre."); inp.value=me; return; }
      confirmar(`Vas a pasar a llamarte "${nuevo}" en toda la app, para todo el equipo.`,()=>renombrarme(nuevo),{title:"Cambiar tu nombre",yes:"Cambiar"}); };
    document.getElementById("cfgNombreOk").addEventListener("click",guardarNombre);
    inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); guardarNombre(); } });
    box.querySelectorAll("[data-cfgc]").forEach(b=>b.addEventListener("click",()=>{ const c=b.dataset.cfgc;
      state.userColors=state.userColors||{}; state.userColors[me]=c;
      if(saveMember)saveMember({email:miEmail,name:me,color:c}).catch(()=>{});
      const m=miembroPorEmail(miEmail); if(m)m.color=c;
      save(); renderActive(); }));
    document.getElementById("cfgTema").querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{
      const t=b.dataset.t; state.theme=t||null; applyTheme(state.theme); save(); renderActive(); }));
    document.getElementById("cfgPal").querySelectorAll("[data-p]").forEach(b=>b.addEventListener("click",()=>{
      state.palette=b.dataset.p; applyPalette(state.palette); save(); renderActive(); }));
    document.getElementById("cfgBackup").addEventListener("click",descargarRespaldo);
    // Se elige el archivo .json que se descargó. Pegarlo a mano era inviable:
    // son decenas de miles de caracteres, y en un teléfono directamente no se
    // puede. Queda el pegado como salida de emergencia por si el archivo no
    // está a mano.
    const fileRestore=document.getElementById("restoreFile");
    document.getElementById("cfgRestore").addEventListener("click",()=>{
      if(fileRestore){ fileRestore.value=""; fileRestore.click(); }
      else dialog({title:"Importar respaldo",msg:"Pegá el contenido del archivo de respaldo.",input:true,placeholder:"{ … }",yes:"Importar",cb:t=>{ if(t&&t.trim())importarRespaldo(t.trim()); }}); });
    if(fileRestore&&!fileRestore.dataset.listo){ fileRestore.dataset.listo="1";
      fileRestore.addEventListener("change",()=>{ const f=fileRestore.files&&fileRestore.files[0]; if(!f)return;
        if(f.size>25*1024*1024){ note("Ese archivo es demasiado grande para ser un respaldo."); return; }
        const lector=new FileReader();
        lector.onerror=()=>note("No se pudo leer el archivo.");
        lector.onload=()=>{ const txt=String(lector.result||"").trim();
          if(!txt){ note("El archivo está vacío."); return; }
          importarRespaldo(txt); };
        lector.readAsText(f); }); }
    const inv=document.getElementById("cfgInvitar");
    const invitar=()=>{ const v=inv.value.trim(); if(!v)return;
      if(!inviteEmail){ note("Todavía no se puede invitar desde acá."); return; }
      inviteEmail(v).then(mail=>{ inv.value=""; note(`Listo. ${mail} ya puede entrar con su correo desde la pantalla de acceso.`,"Persona habilitada"); renderTeamList(); })
        .catch(err=>note(String(err&&err.message||err),"No se pudo habilitar")); };
    document.getElementById("cfgInvitarOk").addEventListener("click",invitar);
    inv.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); invitar(); } });
    renderTeamList();
    // El control de avisos lo instala initPush() al entrar a la app real. Si no
    // esta (por ejemplo en el banco de pruebas), la fila quedaba muda: un
    // renglon con titulo y nada al lado, que parece un boton roto.
    const ph=document.getElementById("cfgPush");
    if(ph){ if(window.__mesaPushControl)window.__mesaPushControl(ph);
      else ph.innerHTML='<span style="font-size:12.5px;color:var(--ink-faint)">No disponible en esta ventana.</span>'; }
  }
  function renderTeamList(){ const t=document.getElementById("cfgTeam"); if(!t)return;
    t.innerHTML=equipo.length
      ? equipo.map(m=>`<div class="teamrow">${avatarMarkup(m.name,"av2")}<span class="tinfo"><b>${esc(m.name)}</b><span>${esc(m.email)}</span></span>${m.email===miEmail?'<span class="yo">vos</span>':""}</div>`).join("")
      : `<div class="empty">Todavía no hay fichas del equipo.</div>`; }
  // Renombrarse: hay que reescribir el nombre en TODOS lados donde se guardó
  // como texto, incluidas las dos mitades de cada conversación privada.
  function renombrarme(nuevo){ const viejo=state.me; if(!viejo||viejo===nuevo)return;
    const cambia=a=>a.map(x=>x===viejo?nuevo:x);
    const mueveClave=o=>{ if(o&&o[viejo]!==undefined){ o[nuevo]=o[viejo]; delete o[viejo]; } };
    state.members=cambia(state.members||[]);
    if(!state.members.includes(nuevo))state.members.push(nuevo);
    Object.values(state.nodes).forEach(n=>{ n.encargados=cambia(encsOf(n));
      (n.items||[]).forEach(k=>{ k.owners=cambia(ownersOf(k)); });
      filesOf(n).forEach(f=>{ if(f.addedBy===viejo)f.addedBy=nuevo; }); });
    // Los responsables DENTRO de las tareas privadas: si no, el nombre viejo
    // revive en los filtros y en las columnas por persona.
    Object.values(state.privTasks||{}).forEach(arr=>(arr||[]).forEach(k=>{ k.owners=cambia(ownersOf(k)); }));
    [state.privTasks,state.myNotes,state.avatars,state.userColors,state.tasksSeen,state.chatSeen].forEach(mueveClave);
    (state.events||[]).forEach(ev=>mueveClave(ev.rsvp));
    // conversaciones privadas: la clave son los dos nombres ordenados
    const dm=state.chat.dm||{}; const nuevoDm={};
    Object.keys(dm).forEach(k=>{ const partes=k.split(" ~ ").map(p=>p===viejo?nuevo:p);
      const nk=partes.sort((a,b)=>a.localeCompare(b)).join(" ~ ");
      // y el autor de cada mensaje: si no, tus propios mensajes privados
      // quedan con el nombre viejo y se dibujan como si fueran del otro.
      (dm[k]||[]).forEach(m=>{ if(m.from===viejo)m.from=nuevo; });
      (nuevoDm[nk]=nuevoDm[nk]||[]).push(...(dm[k]||[])); });
    Object.keys(nuevoDm).forEach(k=>nuevoDm[k].sort((a,b)=>(a.ts||0)-(b.ts||0)));
    state.chat.dm=nuevoDm;
    Object.values(state.chat.groups||{}).forEach(g=>{ g.members=cambia(g.members||[]); if(g.by===viejo)g.by=nuevo;
      (g.msgs||[]).forEach(m=>{ if(m.from===viejo)m.from=nuevo; }); });
    (state.chat.team||[]).forEach(m=>{ if(m.from===viejo)m.from=nuevo; });
    if(state.taskFilters)state.taskFilters.people=cambia(state.taskFilters.people||[]);
    const m=miembroPorEmail(miEmail); if(m)m.name=nuevo;
    state.me=nuevo;
    if(saveMember)saveMember({email:miEmail,name:nuevo}).catch(()=>{});
    save(); refreshChrome(); renderActive(); note(`Ahora sos "${nuevo}" para todo el equipo.`,"Nombre actualizado"); }
  function renderMyNotes(){ const box=document.getElementById("myNotes"); if(!box)return; const me=state.me;
    if(document.activeElement&&document.activeElement.id==="myNotesArea")return;
    if(!me){ box.innerHTML=""; return; }
    const val=(state.myNotes&&state.myNotes[me])||"";
    box.innerHTML=`<div class="card notescard"><div class="lab" style="margin-bottom:8px" title="Privadas: solo las ves vos">${ICO.nota} Mis notas</div><textarea id="myNotesArea" class="notesarea" placeholder="Recordatorios, ideas, pendientes personales… lo que quieras."></textarea></div>`;
    const ta=box.querySelector("#myNotesArea"); ta.value=val;
    ta.addEventListener("input",e=>{ state.myNotes=state.myNotes||{}; state.myNotes[me]=e.target.value; save(); }); }
  const DIAS=["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  const MESES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  function fechaLarga(ds){ const [y,m,d]=String(ds).split("-").map(Number); if(!y)return ds;
    const f=new Date(y,m-1,d); return DIAS[f.getDay()]+" "+d+" de "+MESES[m-1]; }
  function cuantoFalta(ds){ const hoy=new Date(); hoy.setHours(0,0,0,0);
    const [y,m,d]=String(ds).split("-").map(Number); const f=new Date(y,m-1,d);
    const dias=Math.round((f-hoy)/86400000);
    return dias===0?"hoy":dias===1?"mañana":dias<7?"en "+dias+" días":dias<14?"la semana que viene":"en "+Math.round(dias/7)+" semanas"; }
  function renderUpcoming(){ const box=document.getElementById("upcoming"); if(!box)return;
    const today=ymdLocal(new Date()); const me=state.me; const solaEnPantalla=panelView()==="upcoming";
    // En el Panel completo es un resumen corto; siendo la unica cosa en
    // pantalla no tiene sentido recortar a seis.
    let evs=(state.events||[]).filter(e=>e.date>=today).sort((a,b)=>(a.date+(a.time||"")).localeCompare(b.date+(b.time||"")));
    if(!solaEnPantalla)evs=evs.slice(0,6);
    if(!evs.length){ box.innerHTML=solaEnPantalla
      ? `<div class="ph"><b>No hay nada agendado</b><div style="margin-top:6px;font-size:13px">Los eventos se crean tocando un día en el calendario.</div></div>`
      : ""; return; }
    if(!solaEnPantalla){
      box.innerHTML=`<div class="card"><div class="lab" style="margin-bottom:6px">${ICO.calendario} Próximos eventos</div>`+evs.map(ev=>{
        const mine=(ev.rsvp||{})[me]; const yes=Object.values(ev.rsvp||{}).filter(v=>v==="yes").length;
        const tag=mine==="yes"?'<span class="evtag yes">vas</span>':mine==="no"?'<span class="evtag no">no vas</span>':`<span class="evtag">${yes} van</span>`;
        return `<div class="evrow" data-ev="${ev.id}"><div class="evrow-main"><b>${esc(ev.title)}</b><span class="evrow-meta">${esc(ev.date)}${ev.time?" · "+esc(ev.time):""}${ev.desc?" · "+esc(ev.desc):""}</span></div>${tag}</div>`; }).join("")+`</div>`;
    } else {
      // Agenda: una ficha por evento, agrupada por dia.
      let ultimoDia=""; let html="";
      evs.forEach(ev=>{
        if(ev.date!==ultimoDia){ ultimoDia=ev.date;
          html+=`<div class="agdia"><span class="agfecha">${esc(fechaLarga(ev.date))}</span><span class="agcuando">${esc(cuantoFalta(ev.date))}</span></div>`; }
        const rs=ev.rsvp||{}; const mine=rs[me];
        const van=Object.keys(rs).filter(p=>rs[p]==="yes");
        const noVan=Object.keys(rs).filter(p=>rs[p]==="no");
        const sinResponder=allPeople().filter(p=>!rs[p]);
        const tuya=mine==="yes"?'<span class="evtag yes">vas</span>':mine==="no"?'<span class="evtag no">no vas</span>':'<span class="evtag">sin responder</span>';
        html+=`<div class="agev" data-ev="${esc(ev.id)}">
          <div class="aghora">${ev.time?esc(ev.time):"—"}</div>
          <div class="agcuerpo">
            <div class="agtit"><b>${esc(ev.title||"Evento")}</b>${tuya}</div>
            ${ev.desc?`<div class="agdesc">${esc(ev.desc)}</div>`:""}
            <div class="agpie">
              ${van.length?`<span class="agq" title="${esc(van.join(", "))}">${ICO.si} ${van.length} ${van.length===1?"va":"van"}</span>`:""}
              ${noVan.length?`<span class="agq" title="${esc(noVan.join(", "))}">${noVan.length} no ${noVan.length===1?"va":"van"}</span>`:""}
              ${sinResponder.length?`<span class="agq agq-falta" title="${esc(sinResponder.join(", "))}">${sinResponder.length} sin responder</span>`:""}
              <button class="agver" data-cal="${esc(ev.date)}">Ver en el calendario</button>
            </div>
          </div></div>`; });
      box.innerHTML=html;
    }
    box.querySelectorAll("[data-ev]").forEach(r=>r.addEventListener("click",e=>{
      if(e.target.closest("[data-cal]"))return; openEvView(r.dataset.ev); }));
    box.querySelectorAll("[data-cal]").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation();
      // Llevar al calendario en el mes del evento, con el dia marcado.
      const [y,m]=b.dataset.cal.split("-").map(Number); cal.y=y; cal.m=m-1;
      state.panelView="cal"; save(); renderPanel();
      const cel=document.querySelector('.calcell[data-day="'+b.dataset.cal+'"]');
      if(cel){ cel.classList.add("resaltada"); cel.scrollIntoView({behavior:"smooth",block:"center"}); } })); }
  function renderCalendar(){ const mount=document.getElementById("calMount"); if(!mount)return; const y=cal.y,m=cal.m; const first=new Date(y,m,1); const startDow=(first.getDay()+6)%7; const daysIn=new Date(y,m+1,0).getDate(); const todayS=ymdLocal(new Date()); const me=state.me; const byDay={};
    const push=(ds,c)=>{ (byDay[ds]=byDay[ds]||[]).push(c); };
    activeItems().forEach(x=>{ const k=x.k; if(!k.due)return; if(me&&!ownersOf(k).includes(me))return; push(k.due,{type:"task",label:k.title||"Tarea",color:cssv(STATUS[k.status].v),node:x.node.id,taskId:k.id}); });
    if(me)(state.privTasks&&state.privTasks[me]||[]).forEach(k=>{ if(!k.due||k.archived)return; push(k.due,{type:"task",label:(k.title||"Tarea"),color:cssv(STATUS[k.status].v),priv:true,taskId:k.id}); });
    (state.events||[]).forEach(ev=>push(ev.date,{type:"event",label:ev.title,id:ev.id}));
    const totalCells=Math.ceil((startDow+daysIn)/7)*7; let cells="";
    for(let i=0;i<totalCells;i++){ const dayNum=i-startDow+1; const inMonth=dayNum>=1&&dayNum<=daysIn; const ds=ymdLocal(new Date(y,m,dayNum)); const chips=inMonth?(byDay[ds]||[]):[];
      const shown=chips.slice(0,3).map((c,idx)=>`<span class="chipcal ${c.type==='event'?'ev':''}" ${c.type==='task'?`style="background:${c.color}"`:''} data-cell="${ds}" data-idx="${idx}">${esc(c.label)}</span>`).join("");
      const more=chips.length>3?`<span class="calmore">+${chips.length-3} más</span>`:"";
      cells+=`<div class="calcell ${inMonth?'':'out'} ${ds===todayS?'today':''}" data-day="${inMonth?ds:''}">${inMonth?`<span class="dnum">${dayNum}</span>${shown}${more}`:''}</div>`; }
    mount.innerHTML=`<div class="cal"><div class="calhead"><h3>${MES[m]} ${y}</h3><div class="nav"><button class="btn btn-icon" data-cal="prev">‹</button><button class="btn" data-cal="today">Hoy</button><button class="btn btn-icon" data-cal="next">›</button></div></div><div class="calgrid">${DOWL.map(d=>`<div class="caldow">${d}</div>`).join("")}${cells}</div></div>`;
    mount.querySelector('[data-cal="prev"]').addEventListener("click",()=>{ cal.m--; if(cal.m<0){cal.m=11;cal.y--;} renderCalendar(); });
    mount.querySelector('[data-cal="next"]').addEventListener("click",()=>{ cal.m++; if(cal.m>11){cal.m=0;cal.y++;} renderCalendar(); });
    mount.querySelector('[data-cal="today"]').addEventListener("click",()=>{ const t=new Date(); cal.y=t.getFullYear(); cal.m=t.getMonth(); renderCalendar(); });
    mount.querySelectorAll(".calcell").forEach(cell=>cell.addEventListener("click",e=>{ if(e.target.closest(".chipcal"))return; const ds=cell.dataset.day; if(!ds)return; openEvNew(ds); }));
    mount.querySelectorAll(".chipcal").forEach(ch=>ch.addEventListener("click",e=>{ e.stopPropagation(); const c=(byDay[ch.dataset.cell]||[])[+ch.dataset.idx]; if(!c)return; if(c.type==="task"){ if(c.priv)openTask("__priv",c.taskId); else openTask(c.node,c.taskId); } else openEvView(c.id); })); }
  function prioTag(k){ const pr=prioOf(k); return pr?`<span class="ptag" style="background:color-mix(in srgb,${cssv(pr.v)} 20%,transparent);color:${cssv(pr.v)}"><span class="pdot" style="background:${cssv(pr.v)}"></span>${pr.l}</span>`:`<span class="ptag none">— sin prioridad</span>`; }
  function renderMyTasks(){ const box=document.getElementById("myTasks"); if(!box)return; const me=state.me;
    if(!me){ box.innerHTML=`<div class="ph"><b>¿Quién sos?</b><div style="margin-top:6px;font-size:13px">Probá recargar la página.</div></div>`; return; }
    const allMine=activeItems().filter(x=>ownersOf(x.k).includes(me));
    state.tasksSeen=state.tasksSeen||{}; const seenSet=new Set(state.tasksSeen[me]||[]); const news=allMine.filter(x=>!seenSet.has(x.k.id));
    // el panel muestra SIEMPRE todo lo tuyo salvo que vos filtres acá mismo
    if(!Array.isArray(state.panelFilter))state.panelFilter=[];
    const pf=state.panelFilter;
    // El filtro del panel es por PRIORIDAD: el estado ya se ve en los grupos.
    const pasa=k=>!pf.length||pf.includes(k.prio||"__none");
    const groups=STORD.map(s=>({s,arr:allMine.filter(x=>x.k.status===s&&pasa(x.k))})).filter(g=>g.arr.length);
    const allPriv=privL(me).filter(k=>!k.archived); const privs=allPriv.filter(pasa);
    const filtBtn=`<div class="fdrop" id="panelFilt"><button class="${pf.length?"act":""}">Prioridad${pf.length?`<span class="cnum">${pf.length}</span>`:""}<span class="car">▼</span></button><div class="fmenu">`
      +PRORD.map(p=>`<label class="fopt"><input type="checkbox" data-pf="${p}"${pf.includes(p)?" checked":""}><span class="sd" style="background:${cssv(PRIO[p].v)}"></span><span class="lbl">${PRIO[p].l}</span></label>`).join("")
      +`<label class="fopt"><input type="checkbox" data-pf="__none"${pf.includes("__none")?" checked":""}><span class="sd" style="background:${cssv("--ink-faint")}"></span><span class="lbl">Sin prioridad</span></label>`
      +(pf.length?`<button class="fclear">Ver todas</button>`:"")+`</div></div>`;
    box.innerHTML=`<div class="myfoco"><span class="mfl"><b>Tu foco</b> · ${allMine.length} tarea${allMine.length===1?"":"s"} a tu nombre${allPriv.length?` · ${allPriv.length} privada${allPriv.length===1?"":"s"}`:""}${news.length?` · <span class="newchip" id="ackNew">${news.length} nueva${news.length===1?"":"s"}</span>`:""}</span><span class="mfr"><button class="rowbtn" id="newPrivBtn">${ICO.candado} tarea privada</button>${filtBtn}</span></div>`+
      (privs.length?`<div class="card" style="margin-top:14px;border-left:4px solid var(--accent-priv)"><div class="lab" style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="width:9px;height:9px;border-radius:50%;background:var(--accent-priv)"></span>Privadas · ${privs.length} <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--ink-faint)">— solo las ves vos</span></div>`+
        privs.map(k=>`<div class="listline" data-priv="${k.id}" style="cursor:pointer"><input type="checkbox" class="lchk" data-donepriv="${k.id}" ${k.done?"checked":""} title="Marcar terminada"><span class="lt ${k.done?"done":""}">${esc(k.title||"Tarea")}</span>${prioTag(k)}</div>`).join("")+`</div>`:"")+
      (groups.length?groups.map(g=>`<div class="card" style="margin-top:14px"><div class="lab" style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="width:9px;height:9px;border-radius:50%;background:${cssv(STATUS[g.s].v)}"></span>${STATUS[g.s].l} · ${g.arr.length}</div>${g.arr.map(x=>`<div class="listline${seenSet.has(x.k.id)?"":" isnew"}" data-node="${x.node.id}" data-task="${x.k.id}" style="cursor:pointer"><input type="checkbox" class="lchk" data-donetask="${x.node.id}|${x.k.id}" ${x.k.done?"checked":""} title="Marcar terminada"><span class="lt ${x.k.done?"done":""}">${esc(x.k.title||"Tarea")}</span>${seenSet.has(x.k.id)?"":'<span class="nuevo">nueva</span>'}${prioTag(x.k)}</div>`).join("")}</div>`).join(""):(privs.length?"":'<div class="ph" style="margin-top:14px">Sin tareas a tu nombre por ahora.</div>'));
    box.querySelectorAll("[data-task]").forEach(r=>r.addEventListener("click",e=>{ if(e.target.closest(".lchk"))return; openTask(r.dataset.node,r.dataset.task); }));
    box.querySelectorAll("[data-priv]").forEach(r=>r.addEventListener("click",e=>{ if(e.target.closest(".lchk"))return; openTask("__priv",r.dataset.priv); }));
    box.querySelectorAll("[data-donetask]").forEach(cb=>{ cb.addEventListener("click",e=>e.stopPropagation());
      cb.addEventListener("change",e=>{ const [nid,iid]=cb.dataset.donetask.split("|"); const nd=N(nid); const k=nd&&(nd.items||[]).find(x=>x.id===iid); if(!k)return; setDone(k,e.target.checked); save(); renderPanel(); refreshChrome(); }); });
    box.querySelectorAll("[data-donepriv]").forEach(cb=>{ cb.addEventListener("click",e=>e.stopPropagation());
      cb.addEventListener("change",e=>{ const k=privL(me).find(x=>x.id===cb.dataset.donepriv); if(!k)return; setDone(k,e.target.checked); save(); renderPanel(); }); });
    document.getElementById("newPrivBtn").addEventListener("click",()=>openNewTask(true));
    const pfd=document.getElementById("panelFilt"), pfm=pfd.querySelector(".fmenu");
    pfd.querySelector("button").addEventListener("click",e=>{ e.stopPropagation(); pfm.classList.toggle("on"); });
    pfm.addEventListener("click",e=>e.stopPropagation());
    pfm.querySelectorAll("[data-pf]").forEach(cb=>cb.addEventListener("change",()=>{ const v=cb.dataset.pf, i=pf.indexOf(v);
      if(cb.checked){ if(i<0)pf.push(v); } else if(i>=0)pf.splice(i,1); save(); renderMyTasks(); document.getElementById("panelFilt").querySelector(".fmenu").classList.add("on"); }));
    const pfc=pfm.querySelector(".fclear"); if(pfc)pfc.addEventListener("click",()=>{ state.panelFilter=[]; save(); renderMyTasks(); });
    const ack=document.getElementById("ackNew"); if(ack)ack.addEventListener("click",()=>{ state.tasksSeen[me]=allMine.map(x=>x.k.id); save(); renderMyTasks(); updateAvisos(); }); }

  // ---------- panel lateral ----------
  const drawer=document.getElementById("drawer"),scrim=document.getElementById("scrim");
  const pTitle=document.getElementById("pTitle"),pObj=document.getElementById("pObj"),pCtx=document.getElementById("pCtx"),pKind=document.getElementById("pKind"),pDot=document.getElementById("pDot"),subList=document.getElementById("subList"),itemList=document.getElementById("itemList"),linkList=document.getElementById("linkList");
  let panelOpen=false;
  const taskDrawer=document.getElementById("taskDrawer"),tTitle=document.getElementById("tTitle"),tStatus=document.getElementById("tStatus"),tPrio=document.getElementById("tPrio"),tDue=document.getElementById("tDue"),tObj=document.getElementById("tObj"),tNotas=document.getElementById("tNotas"),tDot=document.getElementById("tDot");
  let selTaskNode=null,selTaskId=null,taskOpen=false;
  const isPriv=()=>selTaskNode==="__priv";
  function curTask(){ if(isPriv())return privL().find(x=>x.id===selTaskId); const nd=N(selTaskNode); return nd&&(nd.items||[]).find(x=>x.id===selTaskId); }
  function peoplePick(el,getArr,onChange){ const arr=getArr(); const opts=allPeople().filter(p=>!arr.includes(p));
    el.innerHTML=(arr.length?arr.map(p=>`<span class="pchip">${avatarMarkup(p,"av")}<span>${esc(p)}</span><button type="button" class="x" data-rm="${esc(p)}" title="Sacar">✕</button></span>`).join(""):`<span class="ppnone">— nadie —</span>`)
      +`<span class="ppadd"><button type="button" class="addp">＋ persona</button><div class="ppmenu">`
      +opts.map(p=>`<div class="fopt" data-add="${esc(p)}"><span class="sd" style="background:${avColor(p)}"></span><span class="lbl">${esc(p)}</span></div>`).join("")
      +`<div class="fopt" data-newp><span class="sd" style="background:var(--wood)"></span><span class="lbl">＋ otra persona…</span></div></div></span>`;
    el.querySelectorAll("[data-rm]").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); const a=getArr(); const i=a.indexOf(b.dataset.rm); if(i>=0)a.splice(i,1); onChange(); }));
    const addb=el.querySelector(".addp"), menu=el.querySelector(".ppmenu");
    addb.addEventListener("click",e=>{ e.stopPropagation(); const was=menu.classList.contains("on"); document.querySelectorAll(".ppmenu.on").forEach(m=>m.classList.remove("on")); if(!was)menu.classList.add("on"); });
    menu.addEventListener("click",e=>e.stopPropagation());
    menu.querySelectorAll("[data-add]").forEach(o=>o.addEventListener("click",()=>{ const a=getArr(); if(!a.includes(o.dataset.add))a.push(o.dataset.add); menu.classList.remove("on"); onChange(); }));
    menu.querySelector("[data-newp]").addEventListener("click",()=>{ menu.classList.remove("on"); pedirTexto("Sumar a alguien","Nombre de la persona",nv=>{ const a=getArr(); if(!a.includes(nv))a.push(nv); onChange(); }); }); }
  document.addEventListener("click",()=>{ document.querySelectorAll(".ppmenu.on").forEach(m=>m.classList.remove("on")); });
  function renderTOwners(){ const k=curTask(); if(!k)return; peoplePick(document.getElementById("tOwners"),()=>ownersOf(k),()=>{ save(); renderTOwners(); refreshChrome(); renderActive(); }); }
  function renderTFiles(){ const k=curTask(); if(!k)return; renderFileList(document.getElementById("tFiles"),k,()=>{ renderTFiles(); renderActive(); }); }
  function renderTBelong(){ const k=curTask(); if(!k)return; const box=document.getElementById("tBelong");
    document.getElementById("tKind").textContent=isPriv()?"Tarea privada":"Tarea";
    if(isPriv()){
      box.innerHTML=`<div class="subrow" style="cursor:default;border-left:3px solid var(--accent-priv)"><span class="orb" style="background:var(--accent-priv)"></span><span class="t"><b>${ICO.candado} Tarea privada</b><span>Solo la ves vos — no aparece para el equipo</span></span></div>`
        +`<div style="margin-top:8px"><label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-faint);margin-bottom:4px">Pasarla al equipo</label><div style="display:flex;gap:8px;flex-wrap:wrap"><select class="pick" id="tMoveNode" style="flex:1 1 190px"></select><button class="btn" id="tMoveGo">Compartir</button></div></div>`;
      document.getElementById("tMoveNode").innerHTML=nodeOptionsHTML("",true);
      document.getElementById("tMoveGo").addEventListener("click",()=>{ const n=N(document.getElementById("tMoveNode").value); if(!n){ note("Elegí a qué tema la querés pasar."); return; }
        const arr=privList(); if(!arr){ note("No pudimos identificarte para mover esta tarea."); return; }
        const i=arr.findIndex(x=>x.id===selTaskId); if(i<0){ note("Esa tarea ya no está en tu lista privada."); closeTask(); renderActive(); return; }
        const [it]=arr.splice(i,1); delete it.priv; n.items=n.items||[]; n.items.push(it);
        selTaskNode=n.id; save(); refreshChrome(); renderActive(); renderTBelong(); });
      return; }
    const node=N(selTaskNode); if(!node)return;
    const path=pathOf(selTaskNode); const label=path[path.length-1].name; const trail=path.map(p=>p.name).slice(0,-1).join(" › ")||"raíz";
    box.innerHTML=`<div class="subrow" id="tGoNode"><span class="orb" style="background:${accentOf(node)}"></span><span class="t"><b>${esc(label)}</b><span>${esc(trail)}</span></span><span class="go">↗</span></div>`
      +`<button class="rowbtn" id="tMakePriv" style="margin-top:8px">${ICO.candado} Convertir en tarea privada</button>`;
    document.getElementById("tGoNode").addEventListener("click",()=>{ closeTask(); openPanel(selTaskNode); });
    document.getElementById("tMakePriv").addEventListener("click",()=>{ const me=state.me; if(!me){ note("No pudimos identificarte."); return; }
      confirmar("La tarea sale del tema y pasa a tu panel privado: nadie más la va a ver y queda solo a tu nombre.",()=>{
        const n=N(selTaskNode); const i=(n.items||[]).findIndex(x=>x.id===selTaskId); if(i<0)return; const [it]=n.items.splice(i,1); it.priv=true; it.owners=[me];
        privList(me).push(it); selTaskNode="__priv"; save(); refreshChrome(); renderActive(); renderTBelong(); renderTOwners(); },{title:"Convertir en privada",yes:"Hacerla privada"}); }); }
  function openTask(nodeId,taskId){ let k=null;
    if(nodeId==="__priv"){ k=privL().find(x=>x.id===taskId); } else { const node=N(nodeId); k=node&&(node.items||[]).find(x=>x.id===taskId); }
    if(!k)return; selTaskNode=nodeId; selTaskId=taskId; taskOpen=true;
    // al abrirla deja de contar como "nueva" para vos
    if(state.me&&ownersOf(k).includes(state.me)){ state.tasksSeen=state.tasksSeen||{};
      const seen=state.tasksSeen[state.me]||[]; if(!seen.includes(taskId)){ state.tasksSeen[state.me]=seen.concat([taskId]); save(); updateAvisos(); } }
    drawer.classList.remove("on"); panelOpen=false;
    tTitle.value=k.title||""; tStatus.value=k.status; tPrio.value=k.prio; tDue.value=k.due||""; tObj.value=k.objetivo||""; tNotas.value=k.notas||""; syncTaskDone(k);
    document.getElementById("tKind").textContent=nodeId==="__priv"?"Tarea privada":"Tarea";
    renderTOwners(); renderTBelong(); renderTFiles();
    taskDrawer.classList.add("on"); scrim.classList.add("on"); taskDrawer.setAttribute("aria-hidden","false"); }
  function closeTask(){ taskOpen=false; taskDrawer.classList.remove("on"); scrim.classList.remove("on"); taskDrawer.setAttribute("aria-hidden","true"); if(active==="panel")renderPanel(); }
  function syncTaskDone(k){ const cb=document.getElementById("tDoneChk"); if(cb)cb.checked=!!k.done;
    tTitle.classList.toggle("done",!!k.done);
    const ab=document.getElementById("tArch"); if(ab)ab.textContent=k.done?"${ICO.archivar} Archivar":"${ICO.archivar} Terminar y archivar";
    syncTaskDots(k); }
  function syncTaskDots(k){ tDot.style.background=cssv(STATUS[k.status].v); tDot.title=STATUS[k.status].l;
    const pd=document.getElementById("tPrioDot"); if(!pd)return; const pr=prioOf(k);
    pd.classList.toggle("none",!pr); pd.style.background=pr?cssv(pr.v):"";
    pd.title=pr?"Prioridad "+pr.l.toLowerCase():"Sin prioridad"; }
  function openPanel(id){ const n=N(id); if(!n)return; taskDrawer.classList.remove("on"); taskOpen=false; selId=id; panelOpen=true;
    pTitle.value=n.name; pObj.value=n.objetivo||""; pCtx.value=n.contexto||""; renderPEncs();
    const depth=depthOf(n); pKind.textContent=n.kind==="project"?"Proyecto":(depth<=2?"Macro-tema":"Sub-tema · nivel "+depth); pDot.style.background=accentOf(n);
    renderPanelBody(n); renderActive(); drawer.classList.add("on"); scrim.classList.add("on"); drawer.setAttribute("aria-hidden","false"); }
  function closePanel(){ panelOpen=false; drawer.classList.remove("on"); scrim.classList.remove("on"); drawer.setAttribute("aria-hidden","true"); document.getElementById("picker").classList.remove("on"); }
  function renderPEncs(){ const n=N(selId); if(!n)return; peoplePick(document.getElementById("pEncs"),()=>encsOf(n),()=>{ save(); renderPEncs(); refreshChrome(); renderActive(); }); }
  function commit(){ save(); if(panelOpen&&N(selId))renderPanelBody(N(selId)); renderActive(); }
  function renderPanelBody(n){
    subList.innerHTML=(n.children||[]).length?n.children.map(cid=>{ const c=N(cid); if(!c)return""; const a=agg(c); return `<div class="subrow" data-open="${cid}"><span class="orb" style="background:${accentOf(c)}"></span><span class="t"><b>${esc(c.name)}</b><span>${(c.children||[]).length} sub · ${a.ic} tareas</span></span><span class="go">↳</span></div>`; }).join(""):`<div class="empty">Sin sub-temas.</div>`;
    subList.querySelectorAll(".subrow").forEach(r=>r.addEventListener("click",()=>openPanel(r.dataset.open)));
    const acts=(n.items||[]).filter(k=>!k.archived);
    itemList.innerHTML=acts.length?acts.map(k=>{ const sc=cssv(STATUS[k.status].v); return `<div class="taskrow2" data-t="${k.id}"><input type="checkbox" class="chk" ${k.done?"checked":""}><span class="tt ${k.done?'done':''}">${esc(k.title||"Tarea")}</span><span class="sdotc" style="background:${sc}"></span>${ownersOf(k).length?`<span class="who">${esc(peopleLabel(ownersOf(k)))}</span>`:''}<span class="go">↗</span></div>`; }).join(""):`<div class="empty">Sin tareas. Tocá "＋ tarea" para sumar una.</div>`;
    acts.forEach(k=>{ const row=itemList.querySelector(`[data-t="${k.id}"]`); if(!row)return; const cb=row.querySelector(".chk"); cb.addEventListener("click",e=>e.stopPropagation()); cb.addEventListener("change",e=>{ setDone(k,e.target.checked); commit(); }); row.addEventListener("click",e=>{ if(e.target.closest(".chk"))return; openTask(n.id,k.id); }); });
    // un proyecto es raíz: no pertenece a nada, no se vincula con otros y no lleva tareas propias
    const isRoot=!n.parent||!N(n.parent);
    const bs=document.getElementById("pBelongSec"), bb=document.getElementById("pBelong");
    bs.style.display=isRoot?"none":"";
    document.getElementById("pLinksSec").style.display=isRoot?"none":"";
    document.getElementById("pTasksSec").style.display=isRoot?"none":"";
    if(!isRoot){ const par=N(n.parent); const p=pathOf(par.id).map(z=>z.name); const label=p.pop();
      bb.innerHTML=`<div class="subrow" id="pGoUp"><span class="orb" style="background:${accentOf(par)}"></span><span class="t"><b>${esc(label)}</b><span>${esc(p.join(" › ")||"proyecto")}</span></span><span class="go">↗</span></div>`;
      document.getElementById("pGoUp").addEventListener("click",()=>openPanel(par.id)); }
    renderFileList(document.getElementById("pFiles"),n,()=>{ renderPanelBody(n); renderActive(); });
    const ls=(n.links||[]).map(N).filter(Boolean);
    linkList.innerHTML=ls.length?ls.map(t=>{ const p=pathOf(t.id).map(x=>x.name); const label=p.pop(); return `<div class="linkrow"><span style="width:9px;height:9px;border-radius:50%;background:${accentOf(t)}"></span><span class="path" data-go="${t.id}"><b>${esc(label)}</b><span>${esc(p.join(" › ")||"raíz")}</span></span><button class="x" data-unlink="${t.id}">✕</button></div>`; }).join(""):`<div class="empty">Sin vínculos.</div>`;
    linkList.querySelectorAll("[data-go]").forEach(g=>g.addEventListener("click",()=>openPanel(g.dataset.go)));
    linkList.querySelectorAll("[data-unlink]").forEach(b=>b.addEventListener("click",()=>{ removeLink(n.id,b.dataset.unlink); renderPanelBody(n); renderActive(); })); }
  pTitle.addEventListener("input",()=>{ const n=N(selId); if(n){n.name=pTitle.value;save(); const e=document.querySelector(`.neu[data-id="${selId}"] .nm`); if(e)e.textContent=n.name;} });
  pTitle.addEventListener("change",()=>renderActive());
  pObj.addEventListener("input",()=>{ const n=N(selId); if(n){n.objetivo=pObj.value;save();} });
  pObj.addEventListener("change",()=>renderActive());
  pCtx.addEventListener("input",()=>{ const n=N(selId); if(n){n.contexto=pCtx.value;save();} });
  pCtx.addEventListener("change",()=>renderActive());
  document.getElementById("enterBtn").addEventListener("click",()=>{ if(!selId)return;
    vistaEst="mapa"; closePanel(); showTab("estructura");
    requestAnimationFrame(()=>focusNode(selId)); });
  document.getElementById("addSub").addEventListener("click",()=>{ if(selId)addSubTo(selId); });
  document.getElementById("addTaskBtn").addEventListener("click",()=>{ const n=N(selId); if(!n)return; closePanel(); openNewTask({nodeId:n.id}); });
  document.getElementById("delNode").addEventListener("click",()=>{ const n=N(selId); if(!n)return; if(n.kind==="project"&&state.roots.length<=1){ note("Tiene que quedar al menos un proyecto."); return; }
    const a=agg(n); const cuantas=a.ic, cuantos=a.nc;
    const detalle=[cuantos?`${cuantos} sub-tema${cuantos===1?"":"s"}`:"",cuantas?`${cuantas} tarea${cuantas===1?"":"s"}`:""].filter(Boolean).join(" y ");
    confirmar(`Se elimina "${n.name}"${detalle?` con ${detalle}`:""}. Vas a poder deshacerlo por unos segundos.`,()=>{
      // Se guarda el subárbol completo para poder reponerlo tal cual estaba.
      const copia={}; const juntar=id=>{ const x=N(id); if(!x)return; copia[id]=JSON.parse(JSON.stringify(x)); (x.children||[]).forEach(juntar); };
      juntar(n.id);
      const padre=N(n.parent); const posicion=padre?padre.children.indexOf(n.id):state.roots.indexOf(n.id);
      const rm=id=>{ const x=N(id); if(!x)return; (x.children||[]).slice().forEach(rm); (x.links||[]).slice().forEach(l=>removeLink(id,l)); const par=N(x.parent); if(par)par.children=par.children.filter(c=>c!==id); state.roots=state.roots.filter(r=>r!==id); delete state.nodes[id]; off.delete(id); };
      rm(n.id); selId=null; save(); closePanel(); renderActive();
      ofrecerDeshacer(`Se eliminó <b>${esc(n.name)}</b>`,()=>{
        Object.keys(copia).forEach(id=>{ state.nodes[id]=copia[id]; });
        // los vínculos se reponen en ambos sentidos, si el otro extremo sigue existiendo
        Object.values(copia).forEach(x=>{ (x.links||[]).forEach(l=>{ const o=N(l); if(o&&!(o.links||[]).includes(x.id))(o.links=o.links||[]).push(x.id); }); });
        const p=N(copia[n.id].parent);
        if(p){ if(!p.children.includes(n.id))p.children.splice(posicion<0?p.children.length:posicion,0,n.id); }
        else if(!state.roots.includes(n.id))state.roots.splice(posicion<0?state.roots.length:posicion,0,n.id);
      });
    },{title:"Eliminar tema",yes:"Eliminar",danger:true}); });
  document.getElementById("closePanel").addEventListener("click",closePanel);
  scrim.addEventListener("click",()=>{ closePanel(); closeTask(); });
  document.getElementById("closeTask").addEventListener("click",closeTask);
  tTitle.addEventListener("input",()=>{ const k=curTask(); if(k){k.title=tTitle.value;save();} });
  tTitle.addEventListener("change",renderActive);
  tStatus.addEventListener("change",()=>{ const k=curTask(); if(k){ setStatus(k,tStatus.value); syncTaskDone(k); save(); renderActive(); } });
  document.getElementById("tDoneChk").addEventListener("change",e=>{ const k=curTask(); if(!k)return; setDone(k,e.target.checked); tStatus.value=k.status; syncTaskDone(k); save(); renderActive(); });
  document.getElementById("tArch").addEventListener("click",()=>{ const k=curTask(); if(!k)return; archiveTask(k); save(); closeTask(); renderActive(); refreshChrome(); });
  tPrio.addEventListener("change",()=>{ const k=curTask(); if(k){k.prio=tPrio.value;syncTaskDots(k);save();renderActive();} });
  tDue.addEventListener("change",()=>{ const k=curTask(); if(k){k.due=tDue.value;save();renderActive();} });
  tObj.addEventListener("input",()=>{ const k=curTask(); if(k){k.objetivo=tObj.value;save();} });
  tNotas.addEventListener("input",()=>{ const k=curTask(); if(k){k.notas=tNotas.value;save();} });
  document.getElementById("tDel").addEventListener("click",()=>{ const k=curTask(); if(!k)return;
    const titulo=k.title||"Tarea"; const copia=JSON.parse(JSON.stringify(k)); const nodoId=selTaskNode;
    if(isPriv()){ const arr=privList(); if(!arr){ note("No pudimos identificarte para borrarla."); return; }
      const i=arr.findIndex(x=>x.id===selTaskId); if(i<0){ note("Esa tarea ya no existe."); closeTask(); renderActive(); return; }
      arr.splice(i,1); save(); closeTask(); renderActive();
      ofrecerDeshacer(`Se eliminó <b>${esc(titulo)}</b>`,()=>{ const a=privList(); if(a)a.splice(Math.min(i,a.length),0,copia); });
    } else { const nd=N(nodoId); if(!nd)return; const i=(nd.items||[]).findIndex(x=>x.id===selTaskId);
      nd.items=(nd.items||[]).filter(x=>x.id!==selTaskId); save(); closeTask(); renderActive();
      ofrecerDeshacer(`Se eliminó <b>${esc(titulo)}</b>`,()=>{ const n2=N(nodoId); if(!n2){ note("El tema donde estaba ya no existe."); return; } n2.items=n2.items||[]; n2.items.splice(i<0?n2.items.length:Math.min(i,n2.items.length),0,copia); });
    } });
  const picker=document.getElementById("picker"),pickSearch=document.getElementById("pickSearch"),pickList=document.getElementById("pickList");
  document.getElementById("addLink").addEventListener("click",()=>{ picker.classList.toggle("on"); if(picker.classList.contains("on")){pickSearch.value="";renderPick("");pickSearch.focus();} });
  pickSearch.addEventListener("input",()=>renderPick(pickSearch.value));
  function renderPick(q){ const n=N(selId); if(!n)return; q=q.toLowerCase(); const opts=Object.values(state.nodes).filter(x=>x.id!==selId&&!n.links.includes(x.id)&&x.name.toLowerCase().includes(q)).slice(0,40).map(x=>{ const p=pathOf(x.id).map(z=>z.name); const label=p.pop(); return `<div class="opt" data-pick="${x.id}"><b>${esc(label)}</b> <span>${esc(p.join(" › ")||"proyecto")}</span></div>`; }).join(""); pickList.innerHTML=opts||`<div class="empty">Sin resultados</div>`;
    pickList.querySelectorAll("[data-pick]").forEach(o=>o.addEventListener("click",()=>{ addLinkBetween(selId,o.dataset.pick); picker.classList.remove("on"); renderPanelBody(n); renderActive(); toast("Vínculo creado ✦"); })); }

  // ---------- nueva tarea (desde la pestaña Tareas) ----------
  const ntModal=document.getElementById("ntModal");
  let ntOwnersArr=[];
  function renderNtOwners(){ peoplePick(document.getElementById("ntOwners"),()=>ntOwnersArr,renderNtOwners); }
  // los proyectos raíz no llevan tareas propias: van como encabezado inerte, no como opción elegible
  function nodeOptionsHTML(sel,noPriv){ const out=[];
    if(!noPriv&&state.me)out.push(`<option value="__priv"${sel==="__priv"?" selected":""}>Privada — solo la ves vos</option>`);
    const walk=(id,depth)=>{ const n=N(id); if(!n)return;
      if(depth===1) out.push(`<option disabled>── ${esc(n.name)} ──</option>`);
      else { const pad="　".repeat(depth-2)+(depth>2?"› ":""); out.push(`<option value="${n.id}"${n.id===sel?" selected":""}>${esc(pad+n.name)}</option>`); }
      (n.children||[]).forEach(c=>walk(c,depth+1)); };
    state.roots.forEach(r=>walk(r,1)); return out.join(""); }
  // Único camino para crear una tarea. Antes había tres, y dos creaban una
  // tarea vacía al instante: si cerrabas sin escribir, quedaba una tarjeta
  // llamada "Tarea" para siempre.
  function openNewTask(opts){ const f=tfil(); const o=(opts===true)?{priv:true}:(opts||{});
    const priv=o.priv===true;
    if(priv&&!state.me){ note("No pudimos identificarte para crear una tarea privada."); return; }
    document.getElementById("ntTitle").value="";
    const preT=priv?"__priv":(o.nodeId&&N(o.nodeId)?o.nodeId:(f.temas.length===1?f.temas[0]:(N(state.estFocus)?state.estFocus:"")));
    document.getElementById("ntNode").innerHTML=nodeOptionsHTML(preT);
    const preP=(f.people.length===1&&f.people[0]!=="__none")?f.people[0]:(state.me||"");
    ntOwnersArr=preP?[preP]:[]; renderNtOwners();
    document.getElementById("ntDue").value="";
    document.getElementById("ntStatus").innerHTML=STORD.filter(s=>s!=="listo").map(s=>`<option value="${s}"${s==="sin"?" selected":""}>${STATUS[s].l}</option>`).join("");
    document.getElementById("ntPrio").innerHTML=`<option value="" selected>— sin prioridad —</option>`+PRORD.map(v=>`<option value="${v}">${PRIO[v].l}</option>`).join("");
    ntModal.classList.add("on"); setTimeout(()=>document.getElementById("ntTitle").focus(),40); }
  function closeNT(){ ntModal.classList.remove("on"); }
  function createNT(){ const dest=document.getElementById("ntNode").value; const priv=dest==="__priv"; const n=priv?null:N(dest);
    if(!priv&&!n){ note("Elegí a qué tema pertenece."); return; }
    const title=document.getElementById("ntTitle").value.trim(); if(!title){ note("Poné un título para la tarea."); return; }
    const k=newTask(); k.title=title; k.owners=ntOwnersArr.slice(); k.due=document.getElementById("ntDue").value; k.prio=document.getElementById("ntPrio").value; setStatus(k,document.getElementById("ntStatus").value);
    if(priv){ const arr=privList(); if(!arr){ note("No pudimos identificarte para crear una tarea privada."); return; }
      k.priv=true; if(!k.owners.length&&state.me)k.owners=[state.me]; arr.push(k); save(); refreshChrome(); closeNT(); renderActive(); openTask("__priv",k.id); return; }
    n.items=n.items||[]; n.items.push(k); save(); refreshChrome(); closeNT(); renderActive(); openTask(n.id,k.id); }
  document.getElementById("gmCancel").addEventListener("click",closeGM);
  document.getElementById("gmSave").addEventListener("click",saveGM);
  document.getElementById("gmDel").addEventListener("click",delGM);
  document.getElementById("groupModal").addEventListener("click",e=>{ if(e.target.id==="groupModal")closeGM(); });
  document.getElementById("gmName").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); saveGM(); } });
  document.getElementById("driveSearch").addEventListener("input",e=>{ driveQuery=e.target.value; renderDrive(); });
  document.getElementById("driveTema").addEventListener("change",e=>{ driveTema=e.target.value; renderDrive(); });
  document.getElementById("driveTemaClear").addEventListener("click",()=>{ driveTema=""; renderDrive(); });
  document.querySelectorAll("#driveOrdenSeg [data-o]").forEach(b=>b.addEventListener("click",()=>{ driveOrden=b.dataset.o; renderDrive(); }));
  document.getElementById("driveAdd").addEventListener("click",()=>openFileModal({kind:"pick"}));
  // El ojo de "ver acá" aparece en cuatro listas distintas que se vuelven a
  // dibujar todo el tiempo. Un solo oyente arriba de todo evita tener que
  // volver a colgarlo en cada redibujado (y las fugas que eso trae).
  document.addEventListener("click",e=>{ const b=e.target.closest?e.target.closest("[data-ver]"):null; if(!b)return;
    e.preventDefault(); abrirPreview(b.dataset.ver,b.dataset.vernm,b.dataset.verk,b.dataset.verurl); });
  document.getElementById("pvClose").addEventListener("click",cerrarPreview);
  document.getElementById("pvModal").addEventListener("click",e=>{ if(e.target.id==="pvModal")cerrarPreview(); });
  document.getElementById("pAddFile").addEventListener("click",()=>{ const n=N(selId); if(!n)return; openFileModal({kind:"node",node:n}); });
  document.getElementById("tAddFile").addEventListener("click",()=>{ const k=curTask(); if(!k)return; openFileModal({kind:"task",task:k}); });
  document.getElementById("fmCancel").addEventListener("click",closeFM);
  document.getElementById("fmSave").addEventListener("click",saveFM);
  document.getElementById("fileModal").addEventListener("click",e=>{ if(e.target.id==="fileModal")closeFM(); });
  document.getElementById("fmUrl").addEventListener("input",e=>{ const nm=document.getElementById("fmName"); if(!nm.dataset.touched){ const k=kindOf(e.target.value,nm.value); nm.placeholder="Ej: "+(FKIND[k]||FKIND.link).l; } });
  document.getElementById("fmName").addEventListener("input",e=>{ e.target.dataset.touched=e.target.value?"1":""; });
  document.getElementById("fmName").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); saveFM(); } });
  document.getElementById("askYes").addEventListener("click",()=>{ const cb=askCb, v=document.getElementById("askInput").value; closeAsk(); if(cb)cb(v); });
  document.getElementById("askNo").addEventListener("click",closeAsk);
  document.getElementById("askModal").addEventListener("click",e=>{ if(e.target.id==="askModal")closeAsk(); });
  document.getElementById("askInput").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); document.getElementById("askYes").click(); } });
  document.getElementById("taskSearch").addEventListener("input",e=>{ taskQuery=e.target.value; renderTareas(); });
  document.getElementById("estSearch").addEventListener("input",e=>{ estQuery=e.target.value; renderEstructura(); });
  document.getElementById("estSearchClear").addEventListener("click",()=>{ estQuery=""; document.getElementById("estSearch").value=""; renderEstructura(); });
  document.getElementById("estViewSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b)return;
    vistaEst=b.dataset.v; renderEstructuraTab(); });
  document.getElementById("newTaskBtn").addEventListener("click",()=>openNewTask());
  document.getElementById("ntCancel").addEventListener("click",closeNT);
  document.getElementById("ntCreate").addEventListener("click",createNT);
  document.getElementById("ntTitle").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); createNT(); } });
  ntModal.addEventListener("click",e=>{ if(e.target===ntModal)closeNT(); });

  fPerson.addEventListener("change",renderActive); fStatus.addEventListener("change",renderActive);
  document.getElementById("weekGoals").addEventListener("input",e=>{ state.weekGoals=e.target.value; save(); });
  document.getElementById("sendMsg").addEventListener("click",sendMsg);
  document.getElementById("attachBtn").addEventListener("click",()=>{ if(!state.me){ note("No pudimos identificarte para mandar archivos."); return; } document.getElementById("chatFile").click(); });
  document.getElementById("chatFile").addEventListener("change",e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=""; if(f)attachFile(f); });
  document.getElementById("msgInput").addEventListener("keydown",e=>{ if(e.key==="Enter")sendMsg(); });
  document.getElementById("evModal").addEventListener("click",e=>{ if(e.target.id==="evModal")closeEv(); });
  // cambiar de identidad afecta panel, chat, privadas y archivo: hay que refrescar todo y soltar lo que estaba abierto
  // ---------- avisos (campanita) ----------
  // Las tareas que te asignaron y todavía no abriste. Se calcula acá, no se guarda:
  // así el contador es de este dispositivo y no le escribe nada al equipo.
  function pendientes(){ const me=state.me; if(!me)return [];
    const vistas=new Set((state.tasksSeen||{})[me]||[]);
    return activeItems().filter(x=>ownersOf(x.k).includes(me)&&!vistas.has(x.k.id)); }
  function updateAvisos(){ const b=document.getElementById("avisosBadge"); if(!b)return;
    const n=pendientes().length; if(n>0){ b.textContent=n>9?"9+":n; b.hidden=false; } else b.hidden=true; }
  function renderAvisos(){ const box=document.getElementById("avisosMenu"); if(!box)return;
    const ps=pendientes();
    box.innerHTML=ps.length
      ? ps.slice(0,12).map(x=>`<div class="aviso" data-av="${x.node.id}|${x.k.id}"><span class="sd" style="background:${cssv(STATUS[x.k.status].v)}"></span><span class="at"><b>${esc(x.k.title||"Tarea")}</b><span>${esc(pathOf(x.node.id).map(z=>z.name).slice(-1)[0]||"")}</span></span></div>`).join("")
        +(ps.length>12?`<div class="empty">…y ${ps.length-12} más</div>`:"")
        +`<button class="fclear" id="avisosOk">Marcar todo como visto</button>`
      : `<div class="empty">No tenés tareas nuevas.</div>`;
    box.querySelectorAll("[data-av]").forEach(el=>el.addEventListener("click",()=>{ const [nid,iid]=el.dataset.av.split("|"); box.classList.remove("on"); openTask(nid,iid); }));
    const ok=document.getElementById("avisosOk");
    if(ok)ok.addEventListener("click",()=>{ const me=state.me; if(!me)return; state.tasksSeen=state.tasksSeen||{};
      state.tasksSeen[me]=activeItems().filter(x=>ownersOf(x.k).includes(me)).map(x=>x.k.id);
      save(); box.classList.remove("on"); updateAvisos(); if(active==="panel")renderPanel(); }); }
  function applyTheme(t){ if(t)document.documentElement.setAttribute("data-theme",t); else document.documentElement.removeAttribute("data-theme");
    // La barra del navegador toma el fondo de verdad: si no, el celular pinta
    // un borde claro alrededor de una app oscura (o al revés).
    const m=document.getElementById("themeColor");
    if(m){ const bg=getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(); if(bg)m.setAttribute("content",bg); } }
  // Paleta de fondo, aparte del claro/oscuro: cada una define sus tonos en ambos modos.
  const PALETAS={carbon:"Carbón",bosque:"Bosque",papel:"Papel",pizarra:"Pizarra"};
  function applyPalette(p){ // Carbón es la paleta de fábrica. "atelier" era su nombre viejo, de cuando
    // el estilo y el color venían juntos: se migra en silencio.
    if(p==="atelier")p="carbon";
    document.documentElement.setAttribute("data-palette", (p&&PALETAS[p])?p:"carbon"); }
  document.getElementById("avisosBtn").addEventListener("click",e=>{ e.stopPropagation();
    const m=document.getElementById("avisosMenu");
    if(m.classList.contains("on")){ m.classList.remove("on"); return; }
    renderAvisos(); m.classList.add("on"); });
  // Cerrar al tocar fuera. Se mira dónde cayó el clic en vez de confiar en
  // detener la propagación, que es frágil cuando hay varios menús.
  document.addEventListener("click",e=>{ if(e.target.closest&&e.target.closest(".avisos"))return;
    const m=document.getElementById("avisosMenu"); if(m)m.classList.remove("on"); });
  document.getElementById("themeBtn").addEventListener("click",()=>{ let cur=document.documentElement.getAttribute("data-theme");
    if(!cur)cur=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"; // sin esto, el 1er clic no hacía nada
    const next=cur==="dark"?"light":"dark"; state.theme=next; applyTheme(next); save(); renderActive(); });
  // Respaldo e importación: viven en Configuración, no en un botón de la barra.
  // El volcado del estado completo salía en pantalla y exponía datos de todos.
  function descargarRespaldo(){
    const data=JSON.stringify(stripShared(state),null,2);
    const fecha=new Date().toISOString().slice(0,10);
    try{ const b=new Blob([data],{type:"application/json"}); const a=document.createElement("a");
      a.href=URL.createObjectURL(b); a.download=`estudio-bda-${fecha}.json`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
    catch(e){ note("No se pudo descargar el respaldo."); }
  }
  function importarRespaldo(texto){
    let d; try{ d=JSON.parse(texto); }catch(e){ note("Ese texto no es un respaldo válido."); return; }
    if(!d||typeof d!=="object"||!d.nodes||typeof d.nodes!=="object"){ note("Ese respaldo no tiene el árbol de temas."); return; }
    if(!Array.isArray(d.roots))d.roots=Object.values(d.nodes).filter(n=>n&&!n.parent).map(n=>n.id);
    d.roots=d.roots.filter(r=>d.nodes[r]);
    if(!d.roots.length){ note("Ese respaldo no tiene ningún proyecto."); return; }
    confirmar("Se reemplaza el contenido de TODO el equipo por el del respaldo. No se puede deshacer.",()=>{
      const prefs=loadLocalPrefs();
      state=normalize(Object.assign(d,prefs));
      if(typeof state.seq!=="number")state.seq=9999;
      selId=null; off.clear(); treeOpen.clear(); closePops(); cam._init=0;
      save(); refreshChrome(); renderActive();
    },{title:"Importar respaldo",yes:"Reemplazar todo",danger:true});
  }
  function flashBtn(id,t){ const b=document.getElementById(id); const o=b.textContent; b.textContent=t; setTimeout(()=>b.textContent=o,1200); }
  let toastT; const toastEl=document.getElementById("toast");
  function toast(m){ toastEl.textContent=m; toastEl.classList.remove("hide"); clearTimeout(toastT); toastT=setTimeout(()=>toastEl.classList.add("hide"),2600); }
  document.addEventListener("keydown",e=>{ if(e.key!=="Escape")return; if(document.getElementById("pvModal").classList.contains("on")){cerrarPreview();return;} if(document.getElementById("askModal").classList.contains("on")){closeAsk();return;} if(document.getElementById("fileModal").classList.contains("on")){closeFM();return;} if(document.getElementById("groupModal").classList.contains("on")){closeGM();return;} if(ntModal.classList.contains("on")){closeNT();return;} if(document.getElementById("evModal").classList.contains("on")){closeEv();return;} if(picker.classList.contains("on")){picker.classList.remove("on");return;} if(viewport.querySelector(".pop")){closePops();return;} if(linking){linking=false;linkSrc=null;document.getElementById("linkMode").classList.remove("on");viewport.classList.remove("linking");renderMap();return;} if(editing){editing=false;document.getElementById("editMode").classList.remove("on");renderMap();return;} if(taskOpen){closeTask();return;} if(panelOpen){closePanel();return;} });

  const dl=document.createElement("datalist"); dl.id="peopleList"; document.body.appendChild(dl);
  function syncPeopleList(){ dl.innerHTML=allPeople().map(p=>`<option value="${esc(p)}">`).join(""); }


  // Arranque. normalize() corre DESPUÉS de mezclar las preferencias locales,
  // así un tema borrado por otro no deja filtros apuntando a la nada.
  { const prefs=loadLocalPrefs();
    state=normalize(Object.assign(seed?seed:demo(),prefs)); }
  if(typeof state.seq!=="number")state.seq=9999; if(!state.edgeMeta)state.edgeMeta={};
  // La identidad la manda la sesión: no se elige a mano, así nadie puede
  // hacerse pasar por otro ni quedar con un nombre que ya no existe.
  if(yo&&yo.name)state.me=yo.name;
  mountPrivate(priv);
  migrarMisPrivados(priv);
  // Primer arranque en este dispositivo (o después de un renombre hecho en
  // otro): se da por visto lo que ya existe, para no mostrar treinta avisos.
  if(state.me){ state.tasksSeen=state.tasksSeen||{};
    if(!Array.isArray(state.tasksSeen[state.me]))
      state.tasksSeen[state.me]=activeItems().filter(x=>ownersOf(x.k).includes(state.me)).map(x=>x.k.id); }
  applyTheme(state.theme||null); applyPalette(state.palette||"carbon");
  sweepArchive(); loadTreeOpen(); syncPeopleList();
  lastPushed=JSON.stringify(stripShared(state));   // no escribir de arranque
  if(!seed) save();                                // base vacía: sembrar
  // Si la pestaña guardada ya no existe (el mapa pasó a vivir dentro de
  // Estructura), se cae a una válida en vez de quedar en pantalla vacía.
  const TABS=["panel","tareas","chat","drive","archivo","estructura","config"];
  active=state.tab||"panel";
  if(active==="personal")active="panel";
  if(active==="mapa"){ active="estructura"; }
  if(!TABS.includes(active))active="panel";
  showTab(active);
  window.addEventListener("resize",()=>{ if(active==="estructura"&&estView()==="mapa")applyCam(); });

  // Si llegaste desde una notificación, abrimos esa tarea directamente.
  try{ const q=new URLSearchParams(window.location.search); const tid=q.get("tarea");
    if(tid){ const hit=allItems().find(x=>x.k.id===tid);
      if(hit){ showTab("tareas"); setTimeout(()=>openTask(hit.node.id,hit.k.id),60); }
      history.replaceState(null,"",window.location.pathname); } }catch(e){}

  return { applyRemoteState, applyPrivateState, mostrarEstadoGuardado };
}
