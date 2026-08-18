const LOCAL_KEYS=["me","theme","tab","estProj","estFocus"];
const PREFS_KEY="mesa-bosques-prefs";
function loadLocalPrefs(){ try{ const r=localStorage.getItem(PREFS_KEY); if(r)return JSON.parse(r); }catch(e){} return {}; }
function saveLocalPrefs(state){ try{ localStorage.setItem(PREFS_KEY,JSON.stringify({me:state.me,theme:state.theme,tab:state.tab,estProj:state.estProj,estFocus:state.estFocus})); }catch(e){} }
function stripLocal(state){ const o=Object.assign({},state); LOCAL_KEYS.forEach(k=>delete o[k]); return o; }

export function startApp({ seed, pushRemoteState }){
  const K4="mesa-bosques-v5";
  const DAY=86400000, ARCH_DAYS=10;
  const STATUS={curso:{l:"En curso",v:"--s-curso"},espera:{l:"En espera",v:"--s-espera"},sin:{l:"Sin empezar",v:"--s-sin"},listo:{l:"Terminado",v:"--s-listo"},bloq:{l:"Bloqueado",v:"--s-bloq"}};
  const STORD=["sin","curso","espera","bloq","listo"];
  const PRIO={alta:{l:"Alta",v:"--p-alta"},media:{l:"Media",v:"--p-media"},baja:{l:"Baja",v:"--p-baja"}};
  const LVL=["--l1","--l2","--l3","--l4","--l5","--l6"];
  const AV=["#3f9d6b","#4a86c4","#d19a34","#7a5aa8","#c15b46","#2f9e8a","#c9902f","#5f83a3"];
  const OX=3000,OY=2000;

  let state=null, active="mapa", selId=null, cam={tx:0,ty:0,s:1}, linking=false, linkSrc=null, editing=false, taskGroup="estado", cal={y:null,m:null};
  const off=new Set(), treeOpen=new Set();
  let dragTask=null, dragCard=null, colClickTimer=null, chatChan="team";

  const N=id=>state.nodes[id];
  function uid(){ return "n"+(state.seq++).toString(36); }
  const cssv=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim()||"#888";
  const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const initials=n=>{ if(!n)return"?"; const p=n.trim().split(/\s+/); return (p[0][0]+(p[1]?p[1][0]:"")).toUpperCase(); };
  const avColor=n=>{ let h=0; for(const c of (n||"")) h=(h*31+c.charCodeAt(0))>>>0; return AV[h%AV.length]; };
  function depthOf(n){ let d=1,x=n; while(x&&x.parent){ d++; x=N(x.parent); } return d; }
  function accentOf(node){ if(node.hue!=null) return `hsl(${node.hue} 45% 52%)`; return cssv(LVL[Math.min(depthOf(node),LVL.length)-1]); }
  function baseSize(node){ const d=depthOf(node); const b=d===1?172:d===2?150:d===3?116:d===4?100:88; return Math.round(b*(node.scale||1)); }
  function childrenOf(id){ const n=N(id); return n?(n.children||[]).map(N).filter(Boolean):[]; }
  function pathOf(id){ const a=[]; let x=N(id); while(x){ a.unshift(x); x=N(x.parent); } return a; }
  function keyFor(a,b){ return a<b?a+"|"+b:b+"|"+a; }
  function EM(){ return state.edgeMeta||(state.edgeMeta={}); }
  function setEdgeMeta(k,o){ const e=EM(); e[k]=Object.assign({},e[k],o); }
  function agg(node){ let nc=0,ic=0,dc=0; const owners=new Set(),st=new Set();
    if(node.encargado)owners.add(node.encargado.trim());
    (node.items||[]).forEach(k=>{ if(k.archived)return; ic++; if(k.owner)owners.add(k.owner.trim()); st.add(k.status); if(k.done)dc++; });
    (node.children||[]).forEach(cid=>{ const c=N(cid); if(!c)return; nc++; const a=agg(c); nc+=a.nc; ic+=a.ic; dc+=a.dc; a.owners.forEach(o=>owners.add(o)); a.st.forEach(s=>st.add(s)); });
    return {nc,ic,dc,owners,st}; }
  function allItems(){ const out=[]; Object.values(state.nodes).forEach(n=>(n.items||[]).forEach(k=>out.push({k,node:n}))); return out; }
  function activeItems(){ return allItems().filter(x=>!x.k.archived); }
  function allPeople(){ const s=new Set(state.members||[]); Object.values(state.nodes).forEach(n=>{ if(n.encargado)s.add(n.encargado.trim()); (n.items||[]).forEach(k=>{ if(k.owner)s.add(k.owner.trim()); }); }); return [...s].filter(Boolean).sort((a,b)=>a.localeCompare(b)); }
  function newTask(){ return {id:"i"+uid(),title:"",owner:"",status:"sin",prio:"media",due:"",notas:"",done:false,doneAt:null,archived:false}; }
  function newNode(o){ const id=uid(); state.nodes[id]=Object.assign({id,kind:"neuron",parent:null,children:[],x:0,y:0,prio:"media",hue:null,scale:1,objetivo:"",contexto:"",encargado:"",links:[],items:[]},o); return id; }
  function setStatus(k,st){ k.status=st; if(st==="listo"){ k.done=true; if(!k.doneAt)k.doneAt=nowMs(); } else { k.done=false; k.doneAt=null; k.archived=false; } }
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
    const mk=o=>{ const id="n"+(seq++).toString(36); nodes[id]=Object.assign({id,kind:"neuron",parent:null,children:[],x:0,y:0,prio:"media",hue:null,scale:1,objetivo:"",contexto:"",encargado:"",links:[],items:[]},o); return id; };
    const link=(a,b)=>{ nodes[a].links.push(b); nodes[b].links.push(a); };
    const t=(title,status,prio,notas,due)=>({id:"i"+(seq++),title,owner:"",status:status||"sin",prio:prio||"media",due:due||"",notas:notas||"",done:status==="listo",doneAt:null,archived:false});
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
    const _d=new Date(); _d.setDate(_d.getDate()+3); const evd=_d.getFullYear()+"-"+String(_d.getMonth()+1).padStart(2,"0")+"-"+String(_d.getDate()).padStart(2,"0");
    const events=[{id:"ev1",date:evd,title:"Reunión de equipo",time:"18:00",desc:"Repasamos avances de la semana y próximos pasos.",rsvp:{Nico:"yes"}}];
    const chat={team:[{id:"m1",from:"Juanpi",text:"Equipo, ¿cómo venimos con los informes de dominio?",ts:null},{id:"m2",from:"Nico",text:"Los del ejido ya salieron; falta Provincia.",ts:null},{id:"m3",from:"Lucas",text:"Yo sigo con el bastón, avanza bien.",ts:null},{id:"m4",from:"Juanpi",ev:"ev1",ts:null}],dm:{}};
    return {version:5,seq,nodes,roots,theme:null,edgeMeta:{},members:["Nico","Juanpi","Lucas","Juanso"],me:"",events,chat,tab:"panel",estProj:P1,estFocus:"",weekGoals:"",_seedfix:true,_layout3:true};
  }

  function normalize(d){ if(!d.edgeMeta)d.edgeMeta={}; if(!d.members)d.members=[]; if(d.me==null)d.me=""; if(!d.events)d.events=[]; if(d.weekGoals==null)d.weekGoals=""; if(d.estFocus==null)d.estFocus=""; if(!d.chat)d.chat={team:[],dm:{}}; if(!d.chat.dm)d.chat.dm={}; if(!d.myNotes)d.myNotes={}; (d.events||[]).forEach(ev=>{ if(ev.rsvp==null)ev.rsvp={}; if(ev.time==null)ev.time=""; if(ev.desc==null)ev.desc=""; });
    Object.values(d.nodes).forEach(n=>{ if(n.scale==null)n.scale=1; if(n.objetivo==null)n.objetivo=""; if(n.contexto==null)n.contexto=""; if(n.encargado==null)n.encargado=""; if(n.prio==null)n.prio="media";
      (n.items||[]).forEach(k=>{ if(k.notas==null)k.notas=""; if(k.due==null)k.due=""; if(k.done==null)k.done=(k.status==="listo"); if(k.doneAt===undefined)k.doneAt=null; if(k.archived==null)k.archived=false; if(!k.title&&k.kind)k.title=""; delete k.kind; }); });
    if(!d._seedfix){ const fix=s=>s?String(s).replace(/\bPablo\b(?! K)/g,"Pablo K").replace(/\s*Con Elixir\.?/gi,"").replace(/\s*\(Elixir\)/gi,"").replace(/\s*Canto ayuda\.?/gi,"").replace(/\bCanto\b/g,"").trim():s;
      Object.values(d.nodes).forEach(n=>{ n.contexto=fix(n.contexto); n.objetivo=fix(n.objetivo); (n.items||[]).forEach(k=>{ k.title=fix(k.title); k.notas=fix(k.notas); }); }); d._seedfix=true; }
    if(!d._layout3){ doLayout(d.nodes,d.roots); d._layout3=true; }
    d.version=5; return d; }
  function sweepArchive(){ let ch=false; const now=nowMs(); Object.values(state.nodes).forEach(n=>(n.items||[]).forEach(k=>{ if(k.done&&k.doneAt&&!k.archived&&(now-k.doneAt)>=ARCH_DAYS*DAY){ k.archived=true; ch=true; } })); if(ch)save(); }
  function load(){ try{ const r=localStorage.getItem(K4); if(r){ const d=JSON.parse(r); if(d&&d.nodes) return normalize(d); } }catch(e){} return demo(); }
  function save(){ try{ state.tab=active; }catch(e){} saveLocalPrefs(state); syncPeopleList(); pushRemoteState(stripLocal(state)); }
  function applyRemoteState(remoteData){ Object.keys(remoteData).forEach(k=>{ if(!LOCAL_KEYS.includes(k))state[k]=remoteData[k]; }); if(typeof state.seq!=="number")state.seq=9999; if(!state.edgeMeta)state.edgeMeta={}; sweepArchive(); syncPeopleList(); renderActive(); }

  const viewport=document.getElementById("viewport"),world=document.getElementById("world"),worldInner=document.getElementById("worldInner"),svg=document.getElementById("synapses"),handles=document.getElementById("handles");
  const fPerson=document.getElementById("fPerson"),fStatus=document.getElementById("fStatus"),meSel=document.getElementById("meSel");
  function matches(node){ const p=fPerson.value,s=fStatus.value; if(!p&&!s)return true; const a=agg(node); return (!p||a.owners.has(p))&&(!s||a.st.has(s)); }
  function isOff(node){ let x=node; while(x){ if(off.has(x.id))return true; x=N(x.parent); } return false; }
  function isBright(node){ return !isOff(node)&&matches(node); }

  function applyTabControls(name){ const P=name==="mapa"||name==="tareas"; const E=name==="mapa"||name==="tareas"||name==="panel"; const S=name==="panel"||name==="chat";
    document.getElementById("filtPersona").style.display=P?"":"none"; document.getElementById("filtEstado").style.display=E?"":"none"; document.getElementById("filtSos").style.display=S?"":"none"; }
  function showTab(name){ active=name; applyTabControls(name);
    document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.id==="tab-"+name));
    document.querySelectorAll(".navtab").forEach(b=>b.classList.toggle("on",b.dataset.tab===name));
    renderActive(); if(name==="mapa"){ requestAnimationFrame(()=>{ if(!cam._init){ fit(); cam._init=1; } applyCam(); }); } save(); }
  document.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
  function renderActive(){ refreshChrome();
    if(active==="mapa")renderMap(); else if(active==="estructura")renderEstructura(); else if(active==="tareas")renderTareas(); else if(active==="panel")renderPanel(); else if(active==="archivo")renderArchivo(); else if(active==="chat")renderChat(); }
  function refreshChrome(){ const cur=fPerson.value; fPerson.innerHTML='<option value="">Todas</option>'+allPeople().map(p=>`<option${p===cur?" selected":""}>${esc(p)}</option>`).join("");
    const m=state.me||""; meSel.innerHTML='<option value="">—</option>'+allPeople().map(p=>`<option${p===m?" selected":""}>${esc(p)}</option>`).join(""); }

  // ---------- MAPA ----------
  function edgeList(){ const list=[],seen=new Set();
    Object.values(state.nodes).forEach(n=>{ if(n.parent&&N(n.parent)){ const k=keyFor(n.parent,n.id); if(!seen.has(k)){seen.add(k);list.push({a:N(n.parent),b:n,type:"struct",key:k});} } });
    Object.values(state.nodes).forEach(n=>{ (n.links||[]).forEach(l=>{ if(!N(l))return; const k=keyFor(n.id,l); if(!seen.has(k)){seen.add(k);list.push({a:n,b:N(l),type:"link",key:k});} }); });
    return list; }
  function ctrlOf(a,b){ const m=EM()[keyFor(a.id,b.id)]||{}; const bd=m.bend||{dx:0,dy:0}; return {x:(a.x+b.x)/2+bd.dx,y:(a.y+b.y)/2+bd.dy}; }
  function edgeD(a,b){ const c=ctrlOf(a,b); return `M ${OX+a.x} ${OY+a.y} Q ${OX+c.x} ${OY+c.y} ${OX+b.x} ${OY+b.y}`; }
  function edgeColor(e){ const m=EM()[e.key]||{}; return m.color||(e.type==="link"?cssv("--link"):accentOf(e.b)); }
  function edgeDash(e){ const m=EM()[e.key]||{}; const st=m.style||(e.type==="link"?"dash":"solid"); return st==="solid"?"":st==="dot"?"1.5 7":"7 7"; }
  function buildEdges(){ const list=edgeList(); let paths="",hits="";
    list.forEach(e=>{ const on=isBright(e.a)&&isBright(e.b); const col=edgeColor(e),dash=edgeDash(e),d=edgeD(e.a,e.b);
      paths+=`<path class="edge" data-key="${e.key}" d="${d}" stroke="${col}" stroke-width="${on?(e.type==="link"?1.6:2.2):1}" ${dash?`stroke-dasharray="${dash}"`:""} opacity="${on?0.7:0.12}" style="pointer-events:none"/>`;
      if(editing&&on) hits+=`<path class="hit" data-key="${e.key}" d="${d}"/>`; });
    svg.innerHTML=paths+hits; svg.style.pointerEvents=editing?"auto":"none"; handles.innerHTML="";
    if(editing){ svg.querySelectorAll("path.hit").forEach(p=>p.addEventListener("click",ev=>{ ev.stopPropagation(); const e=list.find(x=>x.key===p.dataset.key); if(e)openEdgePop(e); }));
      list.forEach(e=>{ if(!(isBright(e.a)&&isBright(e.b)))return; const c=ctrlOf(e.a,e.b); const h=document.createElement("div"); h.className="ehandle"; h.dataset.key=e.key; h.style.left=(OX+c.x)+"px"; h.style.top=(OY+c.y)+"px"; handles.appendChild(h); wireHandle(h,e); }); } }
  function wireHandle(h,e){ let drag=false,sx,sy,b0;
    h.addEventListener("pointerdown",ev=>{ ev.stopPropagation(); drag=true; h.setPointerCapture(ev.pointerId); sx=ev.clientX;sy=ev.clientY; const m=EM()[e.key]||{}; b0=Object.assign({dx:0,dy:0},m.bend); });
    h.addEventListener("pointermove",ev=>{ if(!drag)return; const dx=(ev.clientX-sx)/cam.s,dy=(ev.clientY-sy)/cam.s; setEdgeMeta(e.key,{bend:{dx:b0.dx+dx,dy:b0.dy+dy}}); const c=ctrlOf(e.a,e.b); h.style.left=(OX+c.x)+"px"; h.style.top=(OY+c.y)+"px"; const d=edgeD(e.a,e.b); const pa=svg.querySelector(`path.edge[data-key="${e.key}"]`); if(pa)pa.setAttribute("d",d); const hi=svg.querySelector(`path.hit[data-key="${e.key}"]`); if(hi)hi.setAttribute("d",d); });
    h.addEventListener("pointerup",()=>{ if(!drag)return; drag=false; save(); renderMap(); }); }
  function renderMap(){ buildEdges();
    [...worldInner.querySelectorAll(".neu")].forEach(n=>n.remove());
    Object.values(state.nodes).forEach(node=>{ const a=agg(node),depth=depthOf(node),hasKids=(node.children||[]).length>0,size=baseSize(node),acc=accentOf(node);
      const el=document.createElement("div"); el.className="neu"+(node.id===selId?" sel":"")+(isBright(node)?"":" off")+(node.id===linkSrc?" linksrc":"")+(depth>=4?" deep":"");
      el.dataset.lvl=Math.min(depth,4); el.style.width=size+"px"; el.style.borderTopColor=acc; el.style.left=(OX+node.x)+"px"; el.style.top=(OY+node.y)+"px"; el.dataset.id=node.id; el.title="Clic: detalle · Doble clic: apagar";
      const owners=[...a.owners].slice(0,4); const avs=owners.map(o=>`<span class="av" style="background:${avColor(o)}" title="${esc(o)}">${esc(initials(o))}</span>`).join("");
      const pc=cssv(PRIO[node.prio].v); const outLinks=(node.links||[]).length;
      const sub=`${hasKids?a.nc+" sub · ":""}${a.ic} tarea${a.ic===1?"":"s"}${a.ic?` · ${a.dc}✓`:""}`;
      el.innerHTML=`<span class="nm">${esc(node.name)}</span><span class="sub">${sub}</span>${avs?`<span class="avs">${avs}</span>`:''}${outLinks?`<span class="link-mark">✦ ${outLinks}</span>`:''}<span class="pr" style="background:${pc}">${PRIO[node.prio].l}</span>`;
      worldInner.appendChild(el); wireNeuron(el,node); });
    document.getElementById("addLabel").textContent=selId?"Nuevo sub-tema":"Nuevo proyecto"; }
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
  function addSubTo(pid){ const p=N(pid); const ang=Math.random()*6.28; const id=newNode({name:"Nuevo sub-tema",parent:p.id,x:p.x+Math.cos(ang)*200,y:p.y+Math.sin(ang)*200}); p.children.push(id); treeOpen.add(p.id); save(); openPanel(id); pTitle.select(); }
  function addProject(){ const id=newNode({kind:"project",name:"Nuevo proyecto",x:(Math.random()-.5)*400,y:(Math.random()-.5)*300}); state.roots.push(id); state.estProj=id; save(); renderActive(); openPanel(id); pTitle.select(); }

  // ---------- ESTRUCTURA ----------
  const estree=document.getElementById("estree");
  function moveTask(itemId,fromId,toId,beforeId){ const from=N(fromId),to=N(toId); if(!from||!to)return; const idx=(from.items||[]).findIndex(x=>x.id===itemId); if(idx<0)return; const [it]=from.items.splice(idx,1); to.items=to.items||[]; let j=to.items.length; if(beforeId){ const bi=to.items.findIndex(x=>x.id===beforeId); if(bi>=0)j=bi; } to.items.splice(j,0,it); save(); }
  function quickTask(node){ node.items=node.items||[]; node.items.push(newTask()); treeOpen.add(node.id); save(); renderEstructura(); }
  function encChip(node){ return node.encargado?`<span class="encchip"><span class="av" style="background:${avColor(node.encargado)}">${esc(initials(node.encargado))}</span>${esc(node.encargado)}</span>`:""; }
  function renderEstructura(){ const roots=state.roots.map(N).filter(Boolean);
    if(!roots.length){ estree.innerHTML='<div class="empty">Sin proyectos todavía.</div>'; return; }
    let projId=(state.estProj&&N(state.estProj))?state.estProj:roots[0].id; state.estProj=projId; const proj=N(projId);
    const macros=(proj.children||[]).map(N).filter(Boolean);
    if(state.estFocus && (!N(state.estFocus)||N(state.estFocus).parent!==projId)) state.estFocus="";
    let html=`<div class="projsel">`+roots.map(r=>`<button class="${r.id===projId?'on':''}" data-proj="${r.id}"><span style="width:9px;height:9px;border-radius:50%;background:${accentOf(r)}"></span>${esc(r.name)}</button>`).join("")+`<button class="add" data-addproj>＋ proyecto</button></div>`;
    if(!state.estFocus && macros.length) html+=`<div class="esthint">Doble clic en un tema para verlo desplegado.</div>`;
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
    card.innerHTML=`<div style="display:flex;align-items:center;gap:10px"><h2 class="fname" style="flex:1;cursor:pointer">${esc(macro.name)}</h2><span class="chip" style="background:${cssv(PRIO[macro.prio].v)}">${PRIO[macro.prio].l}</span><button class="rowbtn fedit">Editar</button></div>`
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
  function colFor(macro){ const col=document.createElement("div"); col.className="estcol"; col.style.borderTopColor=accentOf(macro); const pc=cssv(PRIO[macro.prio].v);
    const head=document.createElement("div"); head.className="colh";
    head.innerHTML=`<div class="top"><span class="orb" style="background:${accentOf(macro)}"></span><span class="cname">${esc(macro.name)}</span><span class="chip" style="background:${pc}">${PRIO[macro.prio].l}</span></div>${macro.contexto?`<div class="ctxline">${esc(macro.contexto)}</div>`:""}${macro.encargado?`<div style="margin-top:6px">${encChip(macro)}</div>`:""}`;
    head.style.cursor="pointer"; head.title="Doble clic para ver desplegado";
    head.querySelector(".cname").addEventListener("click",e=>{ e.stopPropagation(); if(colClickTimer)clearTimeout(colClickTimer); colClickTimer=setTimeout(()=>{colClickTimer=null;openPanel(macro.id);},210); });
    head.addEventListener("dblclick",()=>{ if(colClickTimer){clearTimeout(colClickTimer);colClickTimer=null;} state.estFocus=macro.id; save(); renderEstructura(); });
    col.appendChild(head);
    const body=document.createElement("div"); body.className="colbody"; body.dataset.drop=macro.id;
    (macro.items||[]).filter(k=>!k.archived).forEach(k=>body.appendChild(taskRow(macro,k)));
    (macro.children||[]).map(N).filter(Boolean).forEach(c=>body.appendChild(subBlock(c)));
    wireDrop(body,macro); col.appendChild(body);
    const add=document.createElement("div"); add.className="coladd"; add.innerHTML=`<button class="rowbtn" data-sub>＋ sub-tema</button><button class="rowbtn" data-task>＋ tarea</button>`;
    add.querySelector("[data-sub]").addEventListener("click",()=>addSubTo(macro.id));
    add.querySelector("[data-task]").addEventListener("click",()=>quickTask(macro)); col.appendChild(add); return col; }
  function subBlock(node,forceOpen){ const wrap=document.createElement("div"); wrap.className="subblock"; wrap.style.borderLeftColor=accentOf(node); const a=agg(node); const open=forceOpen||treeOpen.has(node.id); const pc=cssv(PRIO[node.prio].v);
    const head=document.createElement("div"); head.className="sbh"; head.innerHTML=`<span class="car ${open?"open":""}">▶</span><span class="sname">${esc(node.name)}</span>${node.encargado?`<span class="av" style="width:17px;height:17px;border-radius:50%;display:grid;place-items:center;font-size:8.5px;font-weight:700;color:#fff;background:${avColor(node.encargado)}" title="${esc(node.encargado)}">${esc(initials(node.encargado))}</span>`:""}<span class="chip" style="background:${pc};font-size:9px">${PRIO[node.prio].l}</span><span class="cnt">${a.ic}</span>`;
    head.querySelector(".sname").addEventListener("click",()=>openPanel(node.id));
    head.querySelector(".car").addEventListener("click",()=>{ if(treeOpen.has(node.id))treeOpen.delete(node.id); else treeOpen.add(node.id); renderEstructura(); });
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
    row.innerHTML=`<span class="grip" title="Arrastrá para mover">⋮⋮</span><input type="checkbox" class="chk" ${k.done?"checked":""}><span class="tt" style="${k.done?'text-decoration:line-through;color:var(--ink-faint)':''}">${esc(k.title||"Tarea")}</span><span class="sdotc" style="background:${sc}" title="${STATUS[k.status].l}"></span>${k.owner?`<span class="who">${esc(k.owner)}</span>`:''}`;
    const chk=row.querySelector(".chk"); chk.addEventListener("click",e=>e.stopPropagation());
    chk.addEventListener("change",e=>{ setDone(k,e.target.checked); save(); renderEstructura(); });
    row.querySelector(".tt").addEventListener("click",()=>openPanel(node.id));
    row.addEventListener("dragstart",e=>{ dragTask={item:k,from:node}; row.classList.add("dragging"); if(e.dataTransfer)e.dataTransfer.effectAllowed="move"; });
    row.addEventListener("dragend",()=>{ dragTask=null; row.classList.remove("dragging"); document.querySelectorAll(".taskrow.over,.dropz").forEach(x=>x.classList.remove("over","dropz")); });
    row.addEventListener("dragover",e=>{ if(!dragTask)return; e.preventDefault(); e.stopPropagation(); row.classList.add("over"); });
    row.addEventListener("dragleave",()=>row.classList.remove("over"));
    row.addEventListener("drop",e=>{ if(!dragTask)return; e.preventDefault(); e.stopPropagation(); row.classList.remove("over"); moveTask(dragTask.item.id,dragTask.from.id,node.id,k.id); renderEstructura(); });
    return row; }
  function wireDrop(el,node){ el.addEventListener("dragover",e=>{ if(!dragTask)return; if(e.target.closest(".taskrow"))return; e.preventDefault(); el.classList.add("dropz"); }); el.addEventListener("dragleave",e=>{ if(e.target===el)el.classList.remove("dropz"); }); el.addEventListener("drop",e=>{ if(!dragTask)return; if(e.target.closest(".taskrow"))return; e.preventDefault(); el.classList.remove("dropz"); moveTask(dragTask.item.id,dragTask.from.id,node.id,null); renderEstructura(); }); }

  // ---------- TAREAS ----------
  const kanban=document.getElementById("kanban");
  function renderTareas(){ const wg=document.getElementById("weekGoals"); if(wg&&document.activeElement!==wg)wg.value=state.weekGoals||"";
    const items=activeItems().filter(x=>{ const p=fPerson.value; return !p||(x.k.owner||"").trim()===p; });
    document.getElementById("taskCount").textContent=items.length+" tareas"; kanban.innerHTML="";
    if(taskGroup==="estado"){ STORD.forEach(st=>kanban.appendChild(makeCol(STATUS[st].l,cssv(STATUS[st].v),items.filter(x=>x.k.status===st),{status:st}))); }
    else if(taskGroup==="persona"){ const people=allPeople(); const groups={}; people.forEach(p=>groups[p]=[]); const sinA=[]; items.forEach(x=>{ const o=(x.k.owner||"").trim(); if(o&&groups[o])groups[o].push(x); else sinA.push(x); });
      people.forEach(p=>kanban.appendChild(makeCol(p,avColor(p),groups[p],{person:p}))); kanban.appendChild(makeCol("Sin asignar",cssv("--ink-faint"),sinA,{person:""})); }
    else { const byNode={}; items.forEach(x=>{ (byNode[x.node.id]=byNode[x.node.id]||[]).push(x); }); Object.keys(byNode).forEach(nid=>{ const n=N(nid); const p=pathOf(nid).map(z=>z.name); const label=p.pop(); kanban.appendChild(makeCol(label,accentOf(n),byNode[nid],{pth:p.join(" › ")})); }); if(!Object.keys(byNode).length)kanban.innerHTML='<div class="empty">Sin tareas.</div>'; } }
  function makeCol(title,color,items,meta){ const col=document.createElement("div"); col.className="kcol"; col.dataset.status=meta.status||""; col.dataset.person=meta.person==null?"__none":meta.person;
    col.innerHTML=`<h4><span style="width:9px;height:9px;border-radius:50%;background:${color}"></span>${esc(title)}<span class="n">${items.length}</span>${meta.pth?`<span class="pth">${esc(meta.pth)}</span>`:""}</h4>`;
    items.forEach(x=>col.appendChild(taskCard(x)));
    if(meta.status||meta.person!=null){ col.addEventListener("dragover",e=>{ if(!dragCard)return; e.preventDefault(); col.classList.add("drop"); });
      col.addEventListener("dragleave",()=>col.classList.remove("drop"));
      col.addEventListener("drop",e=>{ if(!dragCard)return; e.preventDefault(); col.classList.remove("drop"); if(meta.status){ setStatus(dragCard.k,meta.status); } else if(meta.person!=null){ dragCard.k.owner=(col.dataset.person==="__none"?"":col.dataset.person); } save(); renderTareas(); refreshChrome(); }); }
    return col; }
  function taskCard(x){ const k=x.k,node=x.node; const c=document.createElement("div"); c.className="kcard"; c.style.borderLeftColor=cssv(STATUS[k.status].v); c.draggable=true;
    const path=pathOf(node.id).map(p=>p.name).join(" › ");
    c.innerHTML=`<div class="kt">${esc(k.title||"Tarea")}</div><div class="kp"><span>${esc(path)}</span>${k.due?`<span style="color:var(--ink-faint)">📅 ${esc(k.due)}</span>`:''}${k.owner?`<span class="kwho" style="background:${avColor(k.owner)}" title="${esc(k.owner)}">${esc(initials(k.owner))}</span>`:''}</div>`;
    c.addEventListener("dragstart",()=>{ dragCard=x; c.classList.add("dragging"); });
    c.addEventListener("dragend",()=>{ dragCard=null; c.classList.remove("dragging"); });
    c.addEventListener("click",()=>openPanel(node.id)); return c; }
  document.getElementById("groupSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b)return; taskGroup=b.dataset.g; document.querySelectorAll("#groupSeg button").forEach(x=>x.classList.toggle("on",x===b)); renderTareas(); });

  // ---------- ARCHIVO ----------
  function renderArchivo(){ const box=document.getElementById("archivoBody"); const arch=allItems().filter(x=>x.k.archived);
    if(!arch.length){ box.innerHTML=`<div class="ph"><div class="big">🗃️</div><b>Nada archivado todavía</b><div style="margin-top:6px;font-size:13px">Cuando marques una tarea como terminada, a los 10 días se archiva sola y aparece acá.</div></div>`; return; }
    box.innerHTML=`<div class="card">${arch.map(x=>{ const path=pathOf(x.node.id).map(p=>p.name).join(" › "); const dstr=x.k.doneAt?new Date(x.k.doneAt).toLocaleDateString():""; return `<div class="arow"><span>✓ ${esc(x.k.title||"Tarea")}</span><span class="ap">${esc(path)}${dstr?" · terminada "+esc(dstr):""}</span><button class="btn restore" data-r="${x.node.id}|${x.k.id}">Restaurar</button></div>`; }).join("")}</div>`;
    box.querySelectorAll(".restore").forEach(b=>b.addEventListener("click",()=>{ const [nid,iid]=b.dataset.r.split("|"); const n=N(nid); if(!n)return; const k=(n.items||[]).find(x=>x.id===iid); if(!k)return; k.archived=false; setStatus(k,"curso"); save(); renderArchivo(); refreshChrome(); })); }

  // ---------- CHAT + EVENTOS (preview local) ----------
  function msgsOf(chan){ if(chan==="team")return state.chat.team||(state.chat.team=[]); const n=chan.slice(3); return state.chat.dm[n]||(state.chat.dm[n]=[]); }
  function renderChat(){ const me=state.me;
    const list=document.getElementById("chanList");
    list.innerHTML=`<div class="chsec">Canales</div><div class="chanitem ${chatChan==="team"?"on":""}" data-ch="team"><span class="av" style="background:var(--wood)">👥</span>Equipo</div><div class="chsec">Personal</div>`+
      allPeople().filter(p=>p&&p!==me).map(p=>`<div class="chanitem ${chatChan==="dm:"+p?"on":""}" data-ch="dm:${esc(p)}"><span class="av" style="background:${avColor(p)}">${esc(initials(p))}</span>${esc(p)}</div>`).join("");
    list.querySelectorAll("[data-ch]").forEach(el=>el.addEventListener("click",()=>{ chatChan=el.dataset.ch; renderChat(); }));
    const head=document.getElementById("chatHead");
    head.innerHTML=`<span>${chatChan==="team"?"👥 Equipo":"💬 "+esc(chatChan.slice(3))}</span><span class="previewbadge">preview local</span><span class="spacer"></span>${chatChan==="team"?'<button class="btn" id="newEv">＋ Evento</button>':""}`;
    const ne=document.getElementById("newEv"); if(ne)ne.addEventListener("click",openEvNew);
    const box=document.getElementById("msgs"); const inp=document.getElementById("msgInput");
    if(!me){ box.innerHTML=`<div class="ph"><div class="big">💬</div><b>Elegí quién sos</b><div style="margin-top:6px;font-size:13px">Usá el selector "Sos" (arriba) para chatear como vos.</div></div>`; inp.disabled=true; return; }
    inp.disabled=false; const msgs=msgsOf(chatChan);
    box.innerHTML=msgs.length?msgs.map(m=>msgHTML(m,me)).join(""):`<div class="empty">Sin mensajes todavía. Escribí el primero.</div>`;
    msgs.forEach(m=>{ if(!m.ev)return; const row=box.querySelector(`[data-msg="${m.id}"]`); if(!row)return; row.querySelectorAll("[data-rsvp]").forEach(b=>b.addEventListener("click",()=>setRsvp(m.ev,b.dataset.rsvp))); const t=row.querySelector(".evtitle"); if(t)t.addEventListener("click",()=>openEvView(m.ev)); });
    box.scrollTop=box.scrollHeight; }
  function msgHTML(m,me){ if(m.ev){ const ev=(state.events||[]).find(e=>e.id===m.ev); if(!ev)return ""; const yes=Object.values(ev.rsvp||{}).filter(v=>v==="yes").length; const mine=(ev.rsvp||{})[me];
      return `<div class="msg event" data-msg="${m.id}"><div class="who">${esc(m.from)} propuso un evento</div><div class="evtitle" style="cursor:pointer">📅 ${esc(ev.title)}</div><div class="evmeta">${esc(ev.date)}${ev.time?" · "+esc(ev.time):""}</div><div class="rsvp"><button class="yes ${mine==="yes"?"on":""}" data-rsvp="yes">Voy</button><button class="no ${mine==="no"?"on":""}" data-rsvp="no">No voy</button><span class="tally">${yes} confirmado${yes===1?"":"s"}</span></div></div>`; }
    const mm=(m.from===me); return `<div class="msg ${mm?"mine":""}">${mm?"":`<div class="who">${esc(m.from)}</div>`}<div>${esc(m.text)}</div></div>`; }
  function sendMsg(){ const inp=document.getElementById("msgInput"); const me=state.me; if(!me)return; const t=inp.value.trim(); if(!t)return; msgsOf(chatChan).push({id:"m"+uid(),from:me,text:t,ts:nowMs()}); inp.value=""; save(); renderChat(); }
  function closeEv(){ document.getElementById("evModal").classList.remove("on"); }
  function openEvNew(presetDate){ const box=document.getElementById("evBox"); const today=ymdLocal(new Date()); const da0=(presetDate&&/^\d{4}-\d{2}-\d{2}$/.test(presetDate))?presetDate:today;
    box.innerHTML=`<h2>Nuevo evento</h2><div class="pctl"><div class="c" style="flex:1 1 100%"><label>Título</label><input class="txt" id="evTitle" placeholder="Reunión de equipo"></div></div><div class="pctl"><div class="c"><label>Fecha</label><input type="date" class="txt" id="evDate" value="${da0}"></div><div class="c"><label>Hora</label><input type="time" class="txt" id="evTime"></div></div><div class="pctl"><div class="c" style="flex:1 1 100%"><label>Descripción (opcional)</label><textarea class="txt" id="evDesc" rows="2" placeholder="Lugar, agenda, notas…"></textarea></div></div><div class="row"><div style="flex:1"></div><button class="btn" id="evCancel">Cancelar</button><button class="btn btn-primary" id="evCreate">Crear y avisar al equipo</button></div>`;
    document.getElementById("evModal").classList.add("on");
    box.querySelector("#evCancel").addEventListener("click",closeEv);
    box.querySelector("#evTitle").focus();
    box.querySelector("#evCreate").addEventListener("click",()=>{ const ti=box.querySelector("#evTitle").value.trim()||"Evento"; const da=box.querySelector("#evDate").value||da0; const ho=box.querySelector("#evTime").value||""; const de=box.querySelector("#evDesc").value.trim(); const id="ev"+uid(); const rsvp={}; if(state.me)rsvp[state.me]="yes"; state.events.push({id,date:da,title:ti,time:ho,desc:de,rsvp}); state.chat.team.push({id:"m"+uid(),from:state.me||"Equipo",ev:id,ts:nowMs()}); chatChan="team"; save(); closeEv(); renderActive(); }); }
  function openEvView(id){ const ev=(state.events||[]).find(e=>e.id===id); if(!ev)return; const box=document.getElementById("evBox"); const me=state.me;
    const rows=(state.members||[]).map(p=>{ const v=(ev.rsvp||{})[p]; return `<div class="arow"><span>${esc(p)}</span><span class="ap">${v==="yes"?"✅ Voy":v==="no"?"❌ No voy":"— sin responder"}</span></div>`; }).join("");
    box.innerHTML=`<h2>${esc(ev.title)}</h2><p>📅 ${esc(ev.date)}${ev.time?" · ⏰ "+esc(ev.time):""}</p>${ev.desc?`<p style="color:var(--ink-soft);font-size:13px;line-height:1.5;margin-top:-6px">${esc(ev.desc)}</p>`:""}${me?`<div class="pop-l">Tu respuesta</div><div class="rsvp"><button class="yes ${(ev.rsvp||{})[me]==="yes"?"on":""}" data-rv="yes">Voy</button><button class="no ${(ev.rsvp||{})[me]==="no"?"on":""}" data-rv="no">No voy</button></div>`:'<p style="color:var(--ink-faint);font-size:12px">Elegí quién sos (arriba) para responder.</p>'}<div class="pop-l" style="margin-top:14px">Asistencia del equipo</div>${rows}<div class="row" style="margin-top:14px"><button class="btn danger" id="evDel">Eliminar</button><div style="flex:1"></div><button class="btn btn-primary" id="evOk">Listo</button></div>`;
    document.getElementById("evModal").classList.add("on");
    box.querySelectorAll("[data-rv]").forEach(b=>b.addEventListener("click",()=>{ setRsvp(id,b.dataset.rv); openEvView(id); }));
    box.querySelector("#evOk").addEventListener("click",closeEv);
    box.querySelector("#evDel").addEventListener("click",()=>{ if(confirm("¿Eliminar el evento?")){ state.events=state.events.filter(e=>e.id!==id); if(state.chat)state.chat.team=(state.chat.team||[]).filter(m=>m.ev!==id); save(); closeEv(); renderActive(); } }); }
  function setRsvp(id,val){ if(!state.me){ alert("Elegí quién sos (arriba) para responder."); return; } const ev=(state.events||[]).find(e=>e.id===id); if(!ev)return; ev.rsvp=ev.rsvp||{}; if(ev.rsvp[state.me]===val)delete ev.rsvp[state.me]; else ev.rsvp[state.me]=val; save(); if(active==="chat")renderChat(); if(active==="panel")renderPanel(); }

  // ---------- PANEL personal ----------
  const MES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const DOWL=["lun","mar","mié","jue","vie","sáb","dom"];
  function ymdLocal(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  function renderPanel(){ if(cal.y==null){ const t=new Date(); cal.y=t.getFullYear(); cal.m=t.getMonth(); } renderCalendar(); renderUpcoming(); renderMyTasks(); renderMyNotes(); }
  function renderMyNotes(){ const box=document.getElementById("myNotes"); if(!box)return; const me=state.me;
    if(document.activeElement&&document.activeElement.id==="myNotesArea")return;
    if(!me){ box.innerHTML=""; return; }
    const val=(state.myNotes&&state.myNotes[me])||"";
    box.innerHTML=`<div class="card"><div class="lab" style="margin-bottom:8px">📝 Mis notas <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--ink-faint)">· privadas, solo las ves vos</span></div><textarea id="myNotesArea" class="notesarea" placeholder="Recordatorios, ideas, pendientes personales… lo que quieras."></textarea></div>`;
    const ta=box.querySelector("#myNotesArea"); ta.value=val;
    ta.addEventListener("input",e=>{ state.myNotes=state.myNotes||{}; state.myNotes[me]=e.target.value; save(); }); }
  function renderUpcoming(){ const box=document.getElementById("upcoming"); if(!box)return; const today=ymdLocal(new Date()); const me=state.me;
    const evs=(state.events||[]).filter(e=>e.date>=today).sort((a,b)=>(a.date+ (a.time||"")).localeCompare(b.date+(b.time||""))).slice(0,6);
    if(!evs.length){ box.innerHTML=""; return; }
    box.innerHTML=`<div class="card"><div class="lab" style="margin-bottom:6px">🗓️ Próximos eventos</div>`+evs.map(ev=>{ const mine=(ev.rsvp||{})[me]; const yes=Object.values(ev.rsvp||{}).filter(v=>v==="yes").length;
      const tag=mine==="yes"?'<span class="evtag yes">✅ vas</span>':mine==="no"?'<span class="evtag no">❌ no vas</span>':`<span class="evtag">${yes} van</span>`;
      return `<div class="evrow" data-ev="${ev.id}"><div class="evrow-main"><b>${esc(ev.title)}</b><span class="evrow-meta">${esc(ev.date)}${ev.time?" · "+esc(ev.time):""}${ev.desc?" · "+esc(ev.desc):""}</span></div>${tag}</div>`; }).join("")+`</div>`;
    box.querySelectorAll("[data-ev]").forEach(r=>r.addEventListener("click",()=>openEvView(r.dataset.ev))); }
  function renderCalendar(){ const mount=document.getElementById("calMount"); if(!mount)return; const y=cal.y,m=cal.m; const first=new Date(y,m,1); const startDow=(first.getDay()+6)%7; const daysIn=new Date(y,m+1,0).getDate(); const todayS=ymdLocal(new Date()); const me=state.me; const byDay={};
    const push=(ds,c)=>{ (byDay[ds]=byDay[ds]||[]).push(c); };
    activeItems().forEach(x=>{ const k=x.k; if(!k.due)return; if(me&&(k.owner||"").trim()!==me)return; push(k.due,{type:"task",label:k.title||"Tarea",color:cssv(STATUS[k.status].v),node:x.node.id}); });
    (state.events||[]).forEach(ev=>push(ev.date,{type:"event",label:ev.title,id:ev.id}));
    const totalCells=Math.ceil((startDow+daysIn)/7)*7; let cells="";
    for(let i=0;i<totalCells;i++){ const dayNum=i-startDow+1; const inMonth=dayNum>=1&&dayNum<=daysIn; const ds=ymdLocal(new Date(y,m,dayNum)); const chips=inMonth?(byDay[ds]||[]):[];
      const shown=chips.slice(0,3).map((c,idx)=>`<span class="chipcal ${c.type==='event'?'ev':''}" ${c.type==='task'?`style="background:${c.color}"`:''} data-cell="${ds}" data-idx="${idx}">${esc(c.label)}</span>`).join("");
      const more=chips.length>3?`<span class="calmore">+${chips.length-3} más</span>`:"";
      cells+=`<div class="calcell ${inMonth?'':'out'} ${ds===todayS?'today':''}" data-day="${inMonth?ds:''}">${inMonth?`<span class="dnum">${dayNum}</span>${shown}${more}`:''}</div>`; }
    mount.innerHTML=`<div class="cal"><div class="calhead"><h3>${MES[m]} ${y}</h3><div class="nav"><button class="btn btn-icon" data-cal="prev">‹</button><button class="btn" data-cal="today">Hoy</button><button class="btn btn-icon" data-cal="next">›</button></div></div><div class="calgrid">${DOWL.map(d=>`<div class="caldow">${d}</div>`).join("")}${cells}</div><div style="font-size:11.5px;color:var(--ink-faint);margin-top:10px">Tocá un día para sumar un evento. Las tareas con fecha ${me?"tuyas ":""}aparecen solas.</div></div>`;
    mount.querySelector('[data-cal="prev"]').addEventListener("click",()=>{ cal.m--; if(cal.m<0){cal.m=11;cal.y--;} renderCalendar(); });
    mount.querySelector('[data-cal="next"]').addEventListener("click",()=>{ cal.m++; if(cal.m>11){cal.m=0;cal.y++;} renderCalendar(); });
    mount.querySelector('[data-cal="today"]').addEventListener("click",()=>{ const t=new Date(); cal.y=t.getFullYear(); cal.m=t.getMonth(); renderCalendar(); });
    mount.querySelectorAll(".calcell").forEach(cell=>cell.addEventListener("click",e=>{ if(e.target.closest(".chipcal"))return; const ds=cell.dataset.day; if(!ds)return; openEvNew(ds); }));
    mount.querySelectorAll(".chipcal").forEach(ch=>ch.addEventListener("click",e=>{ e.stopPropagation(); const c=(byDay[ch.dataset.cell]||[])[+ch.dataset.idx]; if(!c)return; if(c.type==="task")openPanel(c.node); else openEvView(c.id); })); }
  function renderMyTasks(){ const box=document.getElementById("myTasks"); if(!box)return; const me=state.me;
    if(!me){ box.innerHTML=`<div class="ph"><div class="big">👋</div><b>¿Quién sos?</b><div style="margin-top:6px;font-size:13px">Elegí tu nombre arriba (campo "Sos") para ver acá lo tuyo. Cuando migremos a cuentas, cada quien verá solo lo suyo.</div></div>`; return; }
    const sf=fStatus.value; let mine=activeItems().filter(x=>(x.k.owner||"").trim()===me); if(sf)mine=mine.filter(x=>x.k.status===sf);
    const groups=STORD.map(s=>({s,arr:mine.filter(x=>x.k.status===s)})).filter(g=>g.arr.length);
    box.innerHTML=`<div class="myfoco"><b>Tu foco</b> · ${mine.length} tarea${mine.length===1?"":"s"} a tu nombre</div>`+
      (groups.length?groups.map(g=>`<div class="card" style="margin-top:14px"><div class="lab" style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="width:9px;height:9px;border-radius:50%;background:${cssv(STATUS[g.s].v)}"></span>${STATUS[g.s].l} · ${g.arr.length}</div>${g.arr.map(x=>`<div class="listline" data-go="${x.node.id}" style="cursor:pointer">${x.k.done?"☑":"•"} ${esc(x.k.title||"Tarea")}<span class="who">${x.k.due?"📅 "+esc(x.k.due):esc(pathOf(x.node.id).map(p=>p.name).slice(-1)[0]||"")}</span></div>`).join("")}</div>`).join(""):'<div class="ph" style="margin-top:14px">Sin tareas a tu nombre por ahora.</div>');
    box.querySelectorAll("[data-go]").forEach(r=>r.addEventListener("click",()=>openPanel(r.dataset.go))); }

  // ---------- panel lateral ----------
  const drawer=document.getElementById("drawer"),scrim=document.getElementById("scrim");
  const pTitle=document.getElementById("pTitle"),pPrio=document.getElementById("pPrio"),pEnc=document.getElementById("pEnc"),pObj=document.getElementById("pObj"),pCtx=document.getElementById("pCtx"),pKind=document.getElementById("pKind"),pDot=document.getElementById("pDot"),subList=document.getElementById("subList"),itemList=document.getElementById("itemList"),linkList=document.getElementById("linkList");
  let panelOpen=false;
  function openPanel(id){ const n=N(id); if(!n)return; selId=id; panelOpen=true;
    pTitle.value=n.name; pPrio.value=n.prio; pEnc.value=n.encargado||""; pObj.value=n.objetivo||""; pCtx.value=n.contexto||"";
    const depth=depthOf(n); pKind.textContent=n.kind==="project"?"Proyecto":(depth<=2?"Macro-tema":"Sub-tema · nivel "+depth); pDot.style.background=accentOf(n);
    renderPanelBody(n); renderActive(); drawer.classList.add("on"); scrim.classList.add("on"); drawer.setAttribute("aria-hidden","false"); }
  function closePanel(){ panelOpen=false; drawer.classList.remove("on"); scrim.classList.remove("on"); drawer.setAttribute("aria-hidden","true"); document.getElementById("picker").classList.remove("on"); }
  function commit(){ save(); if(panelOpen&&N(selId))renderPanelBody(N(selId)); renderActive(); }
  function renderPanelBody(n){
    subList.innerHTML=(n.children||[]).length?n.children.map(cid=>{ const c=N(cid); if(!c)return""; const a=agg(c); return `<div class="subrow" data-open="${cid}"><span class="orb" style="background:${accentOf(c)}"></span><span class="t"><b>${esc(c.name)}</b><span>${(c.children||[]).length} sub · ${a.ic} tareas</span></span><span class="go">↳</span></div>`; }).join(""):`<div class="empty">Sin sub-temas.</div>`;
    subList.querySelectorAll(".subrow").forEach(r=>r.addEventListener("click",()=>openPanel(r.dataset.open)));
    const acts=(n.items||[]).filter(k=>!k.archived);
    itemList.innerHTML=acts.length?acts.map(k=>itemHTML(k)).join(""):`<div class="empty">Sin tareas. Una tarea puede ser hacer algo o tomar una decisión.</div>`;
    acts.forEach(k=>wireItem(n,k));
    const ls=(n.links||[]).map(N).filter(Boolean);
    linkList.innerHTML=ls.length?ls.map(t=>{ const p=pathOf(t.id).map(x=>x.name); const label=p.pop(); return `<div class="linkrow"><span style="width:9px;height:9px;border-radius:50%;background:${accentOf(t)}"></span><span class="path" data-go="${t.id}"><b>${esc(label)}</b><span>${esc(p.join(" › ")||"raíz")}</span></span><button class="x" data-unlink="${t.id}">✕</button></div>`; }).join(""):`<div class="empty">Sin vínculos.</div>`;
    linkList.querySelectorAll("[data-go]").forEach(g=>g.addEventListener("click",()=>openPanel(g.dataset.go)));
    linkList.querySelectorAll("[data-unlink]").forEach(b=>b.addEventListener("click",()=>{ removeLink(n.id,b.dataset.unlink); renderPanelBody(n); renderActive(); })); }
  function itemHTML(k){ const sc=cssv(STATUS[k.status].v); return `<div class="item" data-it="${k.id}" style="border-left-color:${sc}">
    <div class="r1"><input type="checkbox" class="chk" ${k.done?"checked":""}><input class="it ${k.done?'done':''}" value="${esc(k.title)}" placeholder="¿Qué hay que hacer / decidir?"><button class="notesbtn" title="Notas">🗒${k.notas?'<span class="dotn"></span>':''}</button><button class="del" aria-label="Eliminar">✕</button></div>
    <div class="r2"><input class="own" value="${esc(k.owner||"")}" placeholder="Encargado" list="peopleList"><select class="m st">${Object.entries(STATUS).map(([v,o])=>`<option value="${v}"${v===k.status?" selected":""}>${o.l}</option>`).join("")}</select><select class="m pr">${Object.entries(PRIO).map(([v,o])=>`<option value="${v}"${v===k.prio?" selected":""}>${o.l}</option>`).join("")}</select><input type="date" class="due" value="${k.due||''}"></div>
    <div class="notes" style="display:${k.notas?'block':'none'}"><textarea placeholder="Notas · en qué está la persona…">${esc(k.notas||"")}</textarea></div></div>`; }
  function wireItem(n,k){ const row=itemList.querySelector(`[data-it="${k.id}"]`); if(!row)return;
    row.querySelector(".chk").addEventListener("change",e=>{ setDone(k,e.target.checked); renderPanelBody(n); commit(); });
    row.querySelector(".it").addEventListener("input",e=>{k.title=e.target.value;save();});
    row.querySelector(".own").addEventListener("input",e=>{k.owner=e.target.value;save();});
    row.querySelector(".own").addEventListener("change",()=>{refreshChrome();renderActive();});
    row.querySelector(".st").addEventListener("change",e=>{setStatus(k,e.target.value);row.style.borderLeftColor=cssv(STATUS[k.status].v);renderPanelBody(n);commit();});
    row.querySelector(".pr").addEventListener("change",e=>{k.prio=e.target.value;save();});
    row.querySelector(".due").addEventListener("change",e=>{k.due=e.target.value;commit();});
    const nb=row.querySelector(".notesbtn"),notes=row.querySelector(".notes"); nb.addEventListener("click",()=>{ notes.style.display=notes.style.display==="none"?"block":"none"; if(notes.style.display==="block")notes.querySelector("textarea").focus(); });
    notes.querySelector("textarea").addEventListener("input",e=>{ k.notas=e.target.value; save(); nb.innerHTML="🗒"+(k.notas?'<span class="dotn"></span>':''); });
    row.querySelector(".del").addEventListener("click",()=>{ n.items=n.items.filter(x=>x!==k); renderPanelBody(n); commit(); }); }
  pTitle.addEventListener("input",()=>{ const n=N(selId); if(n){n.name=pTitle.value;save(); const e=document.querySelector(`.neu[data-id="${selId}"] .nm`); if(e)e.textContent=n.name;} });
  pTitle.addEventListener("change",()=>renderActive());
  pPrio.addEventListener("change",()=>{ const n=N(selId); if(n){n.prio=pPrio.value;commit();} });
  pEnc.addEventListener("input",()=>{ const n=N(selId); if(n){n.encargado=pEnc.value;save();} });
  pEnc.addEventListener("change",()=>{ refreshChrome(); renderActive(); });
  pObj.addEventListener("input",()=>{ const n=N(selId); if(n){n.objetivo=pObj.value;save();} });
  pObj.addEventListener("change",()=>renderActive());
  pCtx.addEventListener("input",()=>{ const n=N(selId); if(n){n.contexto=pCtx.value;save();} });
  pCtx.addEventListener("change",()=>renderActive());
  document.getElementById("enterBtn").addEventListener("click",()=>{ if(selId){ showTab("mapa"); focusNode(selId); } });
  document.getElementById("addSub").addEventListener("click",()=>{ if(selId)addSubTo(selId); });
  document.getElementById("addTaskBtn").addEventListener("click",()=>{ const n=N(selId); if(!n)return; n.items=n.items||[]; n.items.push(newTask()); renderPanelBody(n); commit(); const its=itemList.querySelectorAll(".it"); its[its.length-1]?.focus(); });
  document.getElementById("delNode").addEventListener("click",()=>{ const n=N(selId); if(!n)return; if(n.kind==="project"&&state.roots.length<=1){ alert("Tiene que quedar al menos un proyecto."); return; } if(!confirm(`¿Eliminar "${n.name}" y todo su contenido?`))return;
    const rm=id=>{ const x=N(id); if(!x)return; (x.children||[]).slice().forEach(rm); (x.links||[]).slice().forEach(l=>removeLink(id,l)); const par=N(x.parent); if(par)par.children=par.children.filter(c=>c!==id); state.roots=state.roots.filter(r=>r!==id); delete state.nodes[id]; off.delete(id); };
    rm(n.id); selId=null; save(); closePanel(); renderActive(); });
  document.getElementById("closePanel").addEventListener("click",closePanel);
  scrim.addEventListener("click",closePanel);
  const picker=document.getElementById("picker"),pickSearch=document.getElementById("pickSearch"),pickList=document.getElementById("pickList");
  document.getElementById("addLink").addEventListener("click",()=>{ picker.classList.toggle("on"); if(picker.classList.contains("on")){pickSearch.value="";renderPick("");pickSearch.focus();} });
  pickSearch.addEventListener("input",()=>renderPick(pickSearch.value));
  function renderPick(q){ const n=N(selId); if(!n)return; q=q.toLowerCase(); const opts=Object.values(state.nodes).filter(x=>x.id!==selId&&!n.links.includes(x.id)&&x.name.toLowerCase().includes(q)).slice(0,40).map(x=>{ const p=pathOf(x.id).map(z=>z.name); const label=p.pop(); return `<div class="opt" data-pick="${x.id}"><b>${esc(label)}</b> <span>${esc(p.join(" › ")||"proyecto")}</span></div>`; }).join(""); pickList.innerHTML=opts||`<div class="empty">Sin resultados</div>`;
    pickList.querySelectorAll("[data-pick]").forEach(o=>o.addEventListener("click",()=>{ addLinkBetween(selId,o.dataset.pick); picker.classList.remove("on"); renderPanelBody(n); renderActive(); toast("Vínculo creado ✦"); })); }

  fPerson.addEventListener("change",renderActive); fStatus.addEventListener("change",renderActive);
  document.getElementById("weekGoals").addEventListener("input",e=>{ state.weekGoals=e.target.value; save(); });
  document.getElementById("sendMsg").addEventListener("click",sendMsg);
  document.getElementById("msgInput").addEventListener("keydown",e=>{ if(e.key==="Enter")sendMsg(); });
  document.getElementById("evModal").addEventListener("click",e=>{ if(e.target.id==="evModal")closeEv(); });
  meSel.addEventListener("change",()=>{ state.me=meSel.value; save(); if(active==="panel")renderPanel(); });
  function applyTheme(t){ if(t)document.documentElement.setAttribute("data-theme",t); else document.documentElement.removeAttribute("data-theme"); }
  document.getElementById("themeBtn").addEventListener("click",()=>{ const cur=document.documentElement.getAttribute("data-theme"); const next=cur==="dark"?"light":"dark"; state.theme=next; applyTheme(next); save(); renderActive(); });
  const modal=document.getElementById("modal"),jsonArea=document.getElementById("jsonArea");
  document.getElementById("openData").addEventListener("click",()=>{ jsonArea.value=JSON.stringify(state,null,2); modal.classList.add("on"); });
  function closeModal(){ modal.classList.remove("on"); }
  document.getElementById("closeModal").addEventListener("click",closeModal);
  modal.addEventListener("click",e=>{ if(e.target===modal)closeModal(); });
  document.getElementById("copyJson").addEventListener("click",async()=>{ try{await navigator.clipboard.writeText(jsonArea.value);}catch(e){jsonArea.select();document.execCommand("copy");} flashBtn("copyJson","¡Copiado!"); });
  document.getElementById("loadJson").addEventListener("click",()=>{ try{ const d=JSON.parse(jsonArea.value); if(!d||!d.nodes)throw 0; state=normalize(d); if(typeof state.seq!=="number")state.seq=9999; applyTheme(state.theme||null); selId=null; off.clear(); treeOpen.clear(); closePops(); cam._init=0; save(); renderActive(); if(active==="mapa"){fit();cam._init=1;} closeModal(); }catch(e){ alert("Ese texto no es válido."); } });
  document.getElementById("dlJson").addEventListener("click",async()=>{ const data=JSON.stringify(state,null,2),fname="mesa-bosques.json"; if(window.claude&&window.claude.downloads){ try{ await window.claude.downloads.save({filename:fname,data}); flashBtn("dlJson","Descargado"); return; }catch(err){ if(err&&err.code==="declined")return; } } try{ const b=new Blob([data],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=fname; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }catch(e){ alert("Usá Copiar."); } });
  document.getElementById("resetDemo").addEventListener("click",()=>{ if(confirm("Esto borra los datos de TODO el equipo (compartidos) y los reemplaza por el ejemplo. Esta acción no se puede deshacer. ¿Seguro que querés seguir?")){ state=demo(); applyTheme(null); selId=null; off.clear(); treeOpen.clear(); cam._init=0; save(); renderActive(); fit(); cam._init=1; closeModal(); } });
  function flashBtn(id,t){ const b=document.getElementById(id); const o=b.textContent; b.textContent=t; setTimeout(()=>b.textContent=o,1200); }
  let toastT; const toastEl=document.getElementById("toast");
  function toast(m){ toastEl.textContent=m; toastEl.classList.remove("hide"); clearTimeout(toastT); toastT=setTimeout(()=>toastEl.classList.add("hide"),2600); }
  document.addEventListener("keydown",e=>{ if(e.key!=="Escape")return; if(document.getElementById("evModal").classList.contains("on")){closeEv();return;} if(picker.classList.contains("on")){picker.classList.remove("on");return;} if(viewport.querySelector(".pop")){closePops();return;} if(linking){linking=false;linkSrc=null;document.getElementById("linkMode").classList.remove("on");viewport.classList.remove("linking");renderMap();return;} if(editing){editing=false;document.getElementById("editMode").classList.remove("on");renderMap();return;} if(panelOpen){closePanel();return;} if(modal.classList.contains("on")){closeModal();return;} });

  const dl=document.createElement("datalist"); dl.id="peopleList"; document.body.appendChild(dl);
  function syncPeopleList(){ dl.innerHTML=allPeople().map(p=>`<option value="${esc(p)}">`).join(""); }

  { const prefs=loadLocalPrefs(); state=Object.assign(seed?normalize(seed):demo(),prefs); }
  if(typeof state.seq!=="number")state.seq=9999; if(!state.edgeMeta)state.edgeMeta={}; applyTheme(state.theme||null); sweepArchive(); syncPeopleList();
  if(!seed) pushRemoteState(stripLocal(state));
  active=state.tab||"mapa"; if(active==="personal")active="panel"; showTab(active);
  window.addEventListener("resize",()=>{ if(active==="mapa")applyCam(); });

  return { applyRemoteState };
}