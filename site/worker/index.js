const ucloud = "https://ucloud.bupt.edu.cn/";
const tasks = "https://calendar.google.com/calendar/u/0/r/tasks";
const baseline = {
  run:{at:null,mode:null,status:null,tasks:null,runUrl:null}, lastWrite:null,
  assignments:null,resources:null,notices:null,folder:null,currentCourses:null
};
const scrub = (v,n=230) => typeof v==="string"?v.replace(/[\u0000-\u001f\u007f]/g," ").slice(0,n).trim():"";
function schoolLink(v){
  try{const u=new URL(v);if(u.protocol!=="https:"||u.hostname!=="ucloud.bupt.edu.cn"||u.username||u.password)return null;
    const safe=k=>!/token|password|secret|signature|cookie|credential|code|session|key|ticket|auth/i.test(k);
    if([...u.searchParams.keys()].some(k=>!safe(k)))return null;
    const query=u.hash.split("?")[1];if(query&&[...new URLSearchParams(query).keys()].some(k=>!safe(k)))return null;
    return u.href.length<=1600?u.href:null;
  }catch{return null;}
}
function runLink(v){try{const u=new URL(v);return u.origin==="https://github.com"&&/^\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/.test(u.pathname)?u.origin+u.pathname:null;}catch{return null;}}
const when=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const count=v=>Number.isInteger(v)&&v>=0&&v<=15000?v:null;
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const courseKey=v=>scrub(v,128).normalize("NFKC").toLowerCase();
const formatText=(v,n)=>typeof v==="string"?v.replace(/\r\n?/g,"\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g," ").slice(0,n).trim():"";
function shapeRow(r,type){
  const row={title:scrub(r.title),course:scrub(r.course,100),courseId:scrub(r.courseId,128),url:schoolLink(r.url),kind:scrub(r.kind,45),detail:formatText(r.detail,type==="resource"?700:2400),date:when(r.date)};
  if(type==="assignment")return {...row,state:scrub(r.state,36),files:Array.isArray(r.files)?r.files.slice(0,16).filter(object).map(f=>({title:scrub(f.title),url:schoolLink(f.url)})).filter(f=>f.title):[]};
  if(type==="notice")return {...row,score:scrub(r.score,60),unread:r.unread===true};
  const sourceText=typeof r.contentText==="string"?r.contentText:"";
  const contentText=formatText(sourceText,260000);
  const materialId=scrub(r.materialId,150);
  return {...row,materialId:materialId||null,contentText:materialId?contentText:"",contentComplete:Boolean(materialId&&contentText&&r.contentComplete===true&&sourceText.length<=260000),sourceLabel:scrub(r.sourceLabel,180)};
}
function rows(v,type){return Array.isArray(v)?v.slice(0,600).filter(object).map(r=>shapeRow(r,type)).filter(r=>r.title&&(type!=="notice"||r.unread)):null;}
function courses(v){
  if(!Array.isArray(v))return null;
  return v.slice(0,180).filter(object).map(x=>({id:scrub(x.id,128),name:scrub(x.name,100)})).filter(x=>x.id&&x.name);
}
function currentNotices(s){
  if(!Array.isArray(s.notices)||!Array.isArray(s.currentCourses))return null;
  const current=new Map(s.currentCourses.map(c=>[courseKey(c.id),c.name]));
  return s.notices.filter(n=>n.unread===true&&n.courseId&&current.has(courseKey(n.courseId)))
    .map(n=>({...n,course:current.get(courseKey(n.courseId))}))
    .sort((a,b)=>(b.date??"").localeCompare(a.date??""));
}
const hasText=r=>Boolean(r.materialId&&r.contentText);
const publicMaterial=r=>({materialId:r.materialId??null,course:r.course,title:r.title,kind:r.kind,url:r.url,description:r.detail||null,sourceLabel:r.sourceLabel||null,contentStatus:hasText(r)?(r.contentComplete?"complete":"partial"):"metadata_only"});
function normalize(v){
  if(!object(v)||!object(v.run))throw Error("expected run");
  const r=v.run, at=when(r.at), mode=r.mode, status=r.status, runUrl=runLink(r.runUrl);
  if(!at||!runUrl||!["dry_run","write"].includes(mode)||!["success","failure"].includes(status))throw Error("invalid run");
  const mods=r.tasks, taskCounts=object(mods)?{created:count(mods.created),updated:count(mods.updated),unchanged:count(mods.unchanged)}:null;
  return {run:{at,mode,status,runUrl,found:count(r.found),current:count(r.current),archived:count(r.archived),tasks:mode==="write"?taskCounts:null,note:scrub(r.note,400)},assignments:rows(v.assignments,"assignment"),resources:rows(v.resources,"resource"),notices:rows(v.notices,"notice"),currentCourses:courses(v.currentCourses),folder:object(v.folder)&&schoolLink(v.folder.url)?{title:scrub(v.folder.title),url:schoolLink(v.folder.url)}:null};
}
const header={ "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow"};
const json=(v,status=200)=>Response.json(v,{status,headers:header});
const key="dashboard-v1.json";
async function read(env){if(!env.BUCKET)return baseline;const o=await env.BUCKET.get(key);if(!o)return baseline;const s=await o.json();return {...baseline,...s,run:s.run??baseline.run,lastWrite:s.lastWrite??null};}
function eq(a,b){if(!a||!b||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
async function limited(req,limit){
  if(!req.body)throw Error("missing body");
  const rdr=req.body.getReader(),dec=new TextDecoder();let n=0,s="";
  for(;;){const {value,done}=await rdr.read();if(done)break;n+=value.byteLength;if(n>limit){await rdr.cancel();throw Error("size limit");}s+=dec.decode(value,{stream:true});}
  return JSON.parse(s+dec.decode());
}
const searchProps={query:{type:"string",maxLength:150},course:{type:"string",maxLength:100}};
const catalog = [
  ["sync_status","Get the latest verified GitHub sync result, Beijing time, and latest successful actual Google write. A dry run does not write.",{}],
  ["find_assignments","Find verified UCloud assignments and attachment names/original links. Do not infer missing records.",searchProps],
  ["find_materials","Find course resources and identify whether actual material text is available. Use read_material for the source content. Metadata alone does not confirm contents.",searchProps],
  ["read_material","Read the actual indexed text of a resource by material ID from find_materials; paginate using nextOffset. Unavailable means no text has been indexed, not that the file is empty.",{materialId:{type:"string",maxLength:150},offset:{type:"integer",minimum:0}}],
  ["unread_feedback","Find unread UCloud notifications only for courses on the verified current enrollment list, including score and teacher comments when available; never marks notices read.",searchProps],
].map(([name,description,properties])=>({name,description,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},inputSchema:{type:"object",additionalProperties:false,properties,...(name==="read_material"?{required:["materialId"]}:{})}}));
function contains(row,q){return !q||[row.title,row.course,row.kind,row.detail].join(" ").toLocaleLowerCase().includes(q.toLocaleLowerCase());}
async function mcp(req,env){
  let rpc;try{rpc=await limited(req,16000)}catch{return json({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Invalid JSON"}},400);}
  if(!object(rpc)||rpc.jsonrpc!=="2.0")return json({jsonrpc:"2.0",id:null,error:{code:-32600,message:"Invalid request"}},400);
  if(rpc.method==="notifications/initialized")return new Response(null,{status:202,headers:header});
  const reply=(result)=>json({jsonrpc:"2.0",id:rpc.id??null,result});
  const err=(code,message)=>json({jsonrpc:"2.0",id:rpc.id??null,error:{code,message}});
  if(rpc.method==="server/discover")return reply({supportedVersions:["2026-07-28"],capabilities:{tools:{}}});
  if(rpc.method==="initialize")return reply({protocolVersion:"2026-07-28",capabilities:{tools:{}},serverInfo:{name:"bupt-study-desk",version:"1.0.0"}});
  if(rpc.method==="ping")return reply({});
  if(rpc.method==="tools/list")return reply({tools:catalog});
  if(rpc.method!=="tools/call")return err(-32601,"Method not found");
  if(!req.headers.get("oai-authenticated-user-id"))return err(-32001,"Signed-in viewer required");
  const p=rpc.params??{}, tool=catalog.find(t=>t.name===p.name);if(!tool)return err(-32602,"Unknown tool");
  const s=await read(env), arg=p.arguments??{};
  const rowsKey={find_assignments:"assignments",find_materials:"resources",unread_feedback:"notices"}[tool.name];
  const source = rowsKey==="notices"?currentNotices(s):s[rowsKey];
  const message=rowsKey==="notices"?"未验证当前课程名单和未读通知；不能把未接入当成没有通知。":"云邮资料尚未接入，不能将未接入当成没有资料。";
  let result;
  if(tool.name==="read_material"){
    const id=scrub(arg.materialId,150), offset=Number.isSafeInteger(arg.offset)?Math.max(0,arg.offset):0;
    const candidates=id?s.resources?.filter(r=>r.materialId===id):null;
    const item=candidates?.length===1?candidates[0]:null;
    if(!item)result={available:false,message:"找不到唯一的资料。请先查找资料并使用返回的 ID。"};
    else if(!hasText(item))result={available:false,item:publicMaterial(item),message:"此资料目前只有名称或原链接，未索引正文。"};
    else {
      const end=Math.min(offset+6000,item.contentText.length);
      result={available:true,item:publicMaterial(item),text:item.contentText.slice(offset,end),offset,nextOffset:end<item.contentText.length?end:null,sourceTextComplete:item.contentComplete};
    }
  }else if(rowsKey){
    result=source==null?{connected:false,message}:{connected:true,items:source.filter(row=>contains(row,scrub(arg.query,150))&&row.course.includes(scrub(arg.course,100))).slice(0,12).map(row=>rowsKey==="resources"?publicMaterial(row):row),...(rowsKey==="notices"?{scope:"verified_current_courses_only"}:{}),...(rowsKey==="resources"?{folder:s.folder}:{})};
  }else{result={latest:s.run,lastVerifiedWrite:s.lastWrite??null};}
  return reply({content:[{type:"text",text:JSON.stringify(result)}]});
}
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const shTime = t=>t?new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"medium",timeStyle:"short",hour12:false}).format(new Date(t))+" 北京时间":"未确认";
const link=(url,text,css="")=>url?'<a class="'+css+'" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(text)+'</a>':"";
function localizedDate(t){
  return t?new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(t)):"时间待确认";
}
function groups(items){
  const by=new Map();
  for(const row of items){const name=row.course||"未分课程";if(!by.has(name))by.set(name,[]);by.get(name).push(row);}
  return [...by.entries()].sort(([a],[b])=>a.localeCompare(b,"zh-CN"));
}
function fileStyle(r){
  const type=String(r.kind||r.title.split(".").pop()||"").toUpperCase();
  return /PPT|SLIDE/.test(type)?["slides","orange"]:/XLS|CSV|SHEET/.test(type)?["table","green"]:/PDF/.test(type)?["file","red"]:["file","blue"];
}
function materialActions(r){
  const prefix="mini-action";
  const preview=hasText(r)?'<a class="'+prefix+'" href="/materials/read?id='+esc(encodeURIComponent(r.materialId))+'" title="阅读已收录的文字" aria-label="阅读已收录的文字：'+esc(r.title)+'">'+icon("book")+'</a>':'';
  const source=r.url?'<a class="'+prefix+'" href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer" title="在云邮打开" aria-label="在云邮打开：'+esc(r.title)+'">'+icon("chain")+'</a>':'';
  return preview||source?'<span class="row-actions">'+preview+source+'</span>':'';
}
function rowView(r,kind){
  if(kind==="materials"){
    const [glyph,tone]=fileStyle(r);
    const target=hasText(r)?'/materials/read?id='+encodeURIComponent(r.materialId):null;
    const title=r.url?link(r.url,r.title,"title-link"):target?'<a href="'+esc(target)+'" class="title-link">'+esc(r.title)+'</a>':'<span class="file-title">'+esc(r.title)+'</span>';
    return '<li class="entry material-entry"><div class="entryline"><span class="file-tile '+tone+'">'+icon(glyph)+'</span><span class="file-label">'+title+(!r.url&&!target?'<span class="meta file-state">仅目录</span>':'')+'</span>'+materialActions(r)+'</div></li>';
  }
  return '<li class="entry notice-entry" id="'+esc(r.anchor||"")+'"><details class="notice-detail"><summary class="entryline"><span class="notice-mark">'+icon("bell")+'</span><span class="file-label"><span class="notice-title">'+esc(r.title)+'</span>'+(r.score?'<span class="score">成绩 '+esc(r.score)+'</span>':'')+'</span>'+(r.date?'<time class="meta" datetime="'+esc(r.date)+'">'+esc(localizedDate(r.date))+'</time>':'')+'<span class="notice-toggle">'+icon("chevron")+'</span></summary><div class="notice-body"><p class="detail">'+(r.detail?esc(r.detail):'云邮未提供通知正文。')+'</p>'+(r.url?link(r.url,"在云邮打开","quiet"):'')+'</div></details></li>';

}
function grouped(items,kind,selected=""){
  if(items==null)return '<p class="placeholder">'+(kind==="materials"?"云邮资料尚未接入。":"尚未接入云邮通知及当前课程名单。")+'</p>';
  if(!items.length)return '<p class="placeholder">'+(kind==="materials"?"当前没有已收录的资料。":"当前课程没有未读通知。")+'</p>';
  return groups(items).map(([course,list])=>'<div class="course-group" data-course="'+esc(course)+'" data-count="'+list.length+'"'+(selected&&selected!==course?' hidden':'')+'><h3>'+esc(course)+'<span class="group-count">'+list.length+'</span></h3><ul>'+list.map(r=>rowView(r,kind)).join("")+'</ul></div>').join("");
}
const icons = {
  desk:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M9 9v11"/>',
  sync:'<path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5m-4 5a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/>',
  book:'<path d="M12 7c-3-3-7-3-10-2v14c3-1 7-1 10 2 3-3 7-3 10-2V5c-3-1-7-1-10 2v14"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
  file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 0v6h6M8 13h8m-8 4h5"/>',
  lines:'<path d="M4 5h16M4 10h12M4 15h9M4 20h5"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  warn:'<path d="M12 8v5m0 3h.01"/><circle cx="12" cy="12" r="9"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4m8-4v4m-7 7 2 2 4-4"/>',
  chain:'<path d="M10 14a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2m2 4a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2"/>',
  slides:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8m-9-8 3-3 3 2 4-4"/>',
  table:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M10 9v11"/>',
  filter:'<path d="M3 5h18l-7 8v5l-4 2v-7Z"/>',
  history:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search:'<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>'
};
const icon=name=>'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+icons[name]+'</svg>';
const css=`
:root{color-scheme:light;--ink:#17263b;--muted:#52647c;--border:#dbe4ee;--blue:#20539a;--sky:#ebf3ff;--sheet:#f2f6fb;--paper:#fff;--green:#116347;--amber:#79520d;--red:#a0273e}
*,*::before,*::after{box-sizing:border-box}
html{scroll-padding-top:1rem}
body{margin:0;background:var(--sheet);color:var(--ink);font:1rem/1.55 system-ui,"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif}
.shell{width:min(calc(100% - 3rem),1120px);margin-inline:auto}
h1,h2,h3,p{margin:0}h1{font-size:clamp(1.75rem,4vw,2.45rem);font-weight:740;letter-spacing:-.045em;line-height:1.2}
h2{font-size:1.2rem;line-height:1.3;letter-spacing:-.02em}h3{font-size:.94rem}
a{color:var(--blue);text-underline-offset:.2em}a:hover{text-decoration:underline}a:focus-visible,input:focus-visible{outline:2px solid #2369ba;outline-offset:3px}
.masthead{background:#142d4c;background-image:radial-gradient(ellipse at 84% 0%,#274f7f 0%,transparent 68%);color:#fff}
.brandbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.85rem 0 1.45rem}
.brand{display:flex;align-items:center;gap:.85rem}.brandmark,.icon-tile{display:grid;place-items:center;flex:none;border-radius:11px}
.brandmark{width:2.7rem;height:2.7rem;border:1px solid #6688b0;background:#ffffff14}.brandmark svg{width:1.35rem;height:1.35rem}
.top-link,.quiet{display:inline-flex;align-items:center;justify-content:center;min-height:2.4rem;padding:.25rem .75rem;border:1px solid var(--border);border-radius:9px;text-decoration:none;font-size:.875rem;font-weight:650;white-space:nowrap}
.top-link{color:#fff;border-color:#6787ae;background:#ffffff0c}.top-link:hover{background:#ffffff20}.quiet:hover{background:var(--sky)}
.nav{display:flex;gap:.4rem;flex-wrap:wrap}.nav a{position:relative;display:flex;align-items:center;min-height:2.7rem;padding:.45rem .8rem;color:#e0edff;text-decoration:none;font-size:.9rem;font-weight:650;border-radius:8px 8px 0 0}.nav a:hover{background:#ffffff18;text-decoration:underline}
main{padding-block:1.6rem 3rem}.board{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:1.25rem;align-items:start;margin-top:1.25rem}
.panel,.syncbox{background:var(--paper);border:1px solid var(--border);border-radius:16px;box-shadow:0 3px 10px #122f4f08}

#resources:target,#notices:target,#sync:target .syncbox{outline:2px solid #94b6dc;outline-offset:3px}
.syncbox{display:flex;justify-content:space-between;align-items:center;gap:.8rem;flex-wrap:wrap;padding:.9rem 1.1rem;border-inline-start:4px solid #8db0da}
.syncbox.success{border-inline-start-color:#4c9d80}.syncbox.failure{border-inline-start-color:#bd667a}
.syncleft,.sectiontitle{display:flex;align-items:center;gap:.7rem;min-width:0;flex-wrap:wrap}
.syncleft h2{font-size:1rem}.icon-tile{width:2.2rem;height:2.2rem;background:var(--sky);color:var(--blue)}
.icon-tile svg,.entryline>svg,.search>svg{width:1.12rem;height:1.12rem}
.result,.count{font-size:.875rem;white-space:nowrap;font-weight:700;border-radius:99px;padding:.15rem .55rem}
.result.success{color:var(--green);background:#e7f5ef}.result.check{color:var(--amber);background:#fff3d8}.result.failure{color:var(--red);background:#fcecf1}
.last{margin:.5rem .35rem 0;color:var(--muted);font-size:.875rem}
.meta,.sub{font-size:.875rem;color:var(--muted)}.mono,.count,.group-count{font-variant-numeric:tabular-nums}.count{background:var(--sky);color:var(--blue)}
.sectionhead{display:flex;align-items:center;justify-content:space-between;gap:.55rem;flex-wrap:wrap;padding:1rem 1.1rem;border-bottom:1px solid var(--border)}
.panel-body{padding:.9rem 1.1rem 1.15rem}.search{position:relative;display:block}.search>svg{position:absolute;inset:.8rem auto auto .78rem;color:var(--muted);pointer-events:none}
input{font:inherit;color:inherit;background:#f7faff;border:1px solid var(--border);border-radius:9px;width:100%;min-height:2.75rem;padding:.55rem .7rem .55rem 2.3rem}input::placeholder{color:var(--muted)}
.sub:not(:empty){margin-top:.4rem}.placeholder{color:var(--muted);font-size:.9375rem;padding:.5rem 0}
.course-group+.course-group,.search~.course-group{margin-top:.9rem}
.course-group h3{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;background:#eff4fb;border-radius:8px;padding:.45rem .65rem;overflow-wrap:anywhere}
.group-count{color:var(--muted);font-size:.8125rem;font-weight:600}
.course-group ul{margin:0;padding:0;list-style:none}
.entry{padding:.58rem .35rem;border-bottom:1px solid var(--border);overflow-wrap:anywhere}.entry:last-child{border-bottom:0}
.entryline{display:flex;gap:.48rem;align-items:baseline}.entryline>svg{align-self:start;margin-top:.17rem;flex:none;color:#54779e}.entryline .meta{margin-inline-start:auto;flex:0 1 auto;text-align:end;max-width:38%}
.file-title,.title-link{min-width:0;font-size:1rem;line-height:1.45}.title-link{font-weight:580;text-decoration:none}
.detail{font-size:.9rem;color:var(--muted);margin:.25rem 0 .05rem;white-space:pre-line}
.sr{position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden}[hidden]{display:none!important}
@media(max-width:760px){.shell{width:calc(100% - 2rem)}.board{display:flex;flex-direction:column;gap:1rem}.panel{width:100%}main{padding-top:1rem}.brandbar{padding:1.2rem 0 .95rem}.syncleft time{flex-basis:100%;padding-inline-start:2.9rem}}
@media(max-width:375px){.shell{width:calc(100% - 1.5rem)}.sectionhead,.panel-body,.syncbox{padding-inline:.75rem}.brand{gap:.5rem}.brandmark{width:2.15rem;height:2.15rem}.top-link,.quiet{padding-inline:.5rem}}
`;
const routes=[["/","总览"],["/notices","未读通知"],["/materials","学习资料"]];
const tile=name=>'<span class="icon-tile">'+icon(name)+'</span>';
const badge=items=>items==null?'':'<span class="count">'+items.length+' 条</span>';
const navLink=(href,label,active)=>'<a href="'+href+'"'+(active?' aria-current="page"':'')+'><span class="nav-icon">'+icon(href==="/"?"desk":href==="/notices"?"bell":"book")+'</span>'+label+'</a>';
const richCss=`
.masthead{background:#132944;background-image:radial-gradient(ellipse at 85% 0%,#244c77 0%,transparent 68%)}
.brandbar{padding-block:1.45rem 1rem}.brand a{font-size:1.32rem;font-weight:740;line-height:1.2;letter-spacing:-.025em;color:#fff;text-decoration:none}
.nav a{padding-inline:1rem;color:#d2e3fa;min-height:2.85rem}.nav a[aria-current]{color:#fff;background:#ffffff14}.nav a[aria-current]::after{content:"";position:absolute;inset:auto .8rem 0;height:3px;background:#8fc2ff;border-radius:3px 3px 0 0}
.pagehead{display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:.6rem;margin:0 0 1.25rem}
.pagehead h1{font-size:clamp(1.7rem,4vw,2.4rem);letter-spacing:-.04em}.pagehead .meta{margin-top:.3rem}
.board .panel h2{font-size:1.06rem}.board .entryline time{font-size:.8125rem}.board .panel-body{padding-top:.5rem}
.metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin-top:1rem}
.metric{text-decoration:none;display:flex;gap:.75rem;align-items:center;padding:1rem 1.1rem;color:var(--ink)}
.metric:hover{color:var(--blue);background:#f7faff;text-decoration:none;border-color:#a5bcda}
.metric .metric-value{font-size:1.55rem;font-weight:740;line-height:1.2;display:block;font-variant-numeric:tabular-nums;margin-top:.15rem}
.stack{max-width:920px;margin-inline:auto}.list-shell .panel-body{padding-top:0}
.filters{display:flex;gap:.75rem;align-items:end;padding:1rem 1.1rem;border-bottom:1px solid var(--border);flex-wrap:wrap}
.field{flex:1 1 13rem;min-width:0}.field>span:first-child{display:block;margin-bottom:.35rem;font-size:.875rem;font-weight:650}
select{appearance:none;color:var(--ink);font:inherit;border:1px solid var(--border);border-radius:9px;width:100%;min-height:2.75rem;padding:.55rem 2rem .55rem .7rem;background:#f7faff linear-gradient(45deg,transparent 50%,#52647c 50%) right 1.1rem top 1.14rem/5px 5px no-repeat;background-image:linear-gradient(45deg,transparent 50%,#52647c 50%),linear-gradient(135deg,#52647c 50%,transparent 50%);background-position:right 1rem top 1.17rem,right .68rem top 1.17rem;background-size:5px 5px;background-repeat:no-repeat}
.filters .search svg{top:.8rem}.filters button{min-height:2.75rem;border:1px solid var(--blue);background:#22579e;color:#fff;border-radius:9px;padding:.4rem .95rem;font:inherit;font-weight:650;cursor:pointer}
.filters button:hover{background:#173f77}select:focus-visible,button:focus-visible{outline:2px solid #2369ba;outline-offset:3px}
.list-meta{padding:.9rem 0 .75rem}.list-shell .placeholder{padding-top:0}.clear{align-self:center;font-size:.875rem}
.board .sectionhead{align-items:center}.peek-list{list-style:none;margin:0;padding:0}.compact-title{font-size:.875rem;color:var(--muted);margin-bottom:.15rem}
@media(max-width:600px){.brandbar{padding-block:1rem .7rem}.nav{gap:.25rem}.nav a{padding-inline:.72rem}.pagehead{margin-bottom:1rem}.metric-grid{gap:.65rem}.metric{padding:.7rem;gap:.45rem}.metric .icon-tile{width:1.7rem;height:1.7rem}.metric .metric-value{font-size:1.2rem}.filters{padding-inline:.8rem;gap:.55rem}.field{flex-basis:100%}.filters button{min-width:5rem}}
`;
const iconLabel=(glyph,label)=>icon(glyph)+'<span class="sr">'+esc(label)+'</span>';
const glyphLink=(url,label,glyph,cls="quiet",outside=false)=>'<a class="'+cls+' glyph-link" href="'+esc(url)+'"'+(outside?' target="_blank" rel="noopener noreferrer"':'')+' title="'+esc(label)+'">'+iconLabel(glyph,label)+'</a>';
const pattern=(type)=>'<svg class="line-art" viewBox="0 0 160 94" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">'+(type==="bell"?'<path d="M80 75c-36-6-33-42-2-51 28-8 50 14 42 41-4 15-18 23-32 24M72 86C36 79 27 36 59 16c41-25 83 6 82 39"/><path d="M105 50a12 12 0 0 0-24 0c0 13-7 15-7 18h38c0-3-7-5-7-18m-16 23c2 5 8 5 10 0"/><circle cx="120" cy="26" r="3"/><path d="M45 40h6m-3-3v6"/>':'<path d="M94 24c-14-10-31-12-47-7v47c16-5 33-3 47 7 14-10 31-12 47-7V17c-16-5-33-3-47 7v47M39 28v43c20-6 35-4 55 7 20-11 35-13 55-7V28M58 30c9-2 18-1 26 3m-26 8c9-2 18-1 26 3m20-11c8-4 17-5 26-3m-26 14c8-4 17-5 26-3"/><path d="M30 15h8m-4-4v8m103 63h7m-3.5-3.5v7"/><circle cx="153" cy="18" r="2"/>')+'</svg>';
const outlineCss=`
.nav .nav-icon svg,.glyph-link svg,.filters button svg{width:1.12rem;height:1.12rem}.nav a{gap:.38rem}.nav .nav-icon{display:grid;place-items:center}
.glyph-link{min-height:2.75rem;min-width:2.75rem;padding:.45rem}.top-link.glyph-link{min-width:2.85rem}
.metric{position:relative;overflow:hidden;min-height:7.15rem;isolation:isolate;padding:1.05rem 1.15rem;background:linear-gradient(115deg,#fff 45%,#e5f2ff)}
.metric:first-child{background:linear-gradient(115deg,#fff 45%,#e3eefb)}.metric:hover{background:#f5faff}
.metric .icon-tile{width:2.35rem;height:2.35rem}.metric .metric-value{font-size:1.9rem;letter-spacing:-.05em}
.line-art{position:absolute;z-index:-1;inset:auto .15rem -.18rem auto;width:min(44%,10rem);height:auto;color:#3467a5;opacity:.44;pointer-events:none}
.result{display:inline-flex;align-items:center;gap:.33rem}.result:before{display:none}.result svg{width:1rem;height:1rem}
.course-group h3{font-size:1rem;padding:.55rem .7rem}.group-count{background:#ddeafe;color:#244f85;border-radius:99px;padding:.08rem .48rem}
.file-tile,.notice-mark{display:grid;place-items:center;width:2.25rem;height:2.25rem;flex:none;border-radius:9px;background:#e9f1fb;color:#20539a}
.file-tile svg,.notice-mark svg{width:1.1rem;height:1.1rem}.file-tile.orange{color:#8b4518;background:#fff1e5}.file-tile.green{color:#13674b;background:#e4f4ed}.file-tile.red{color:#92384c;background:#fbeef2}
.notice-mark{width:1.75rem;height:1.75rem;background:transparent}.notice-mark svg{width:1rem;height:1rem}
.material-entry .entryline,.notice-entry .entryline{align-items:center;gap:.62rem}.file-label{flex:1;min-width:0}.file-state{display:block;font-size:.8rem;margin-top:.14rem}
.row-actions{display:flex;gap:.2rem;flex:none}.mini-action{display:grid;place-items:center;width:2.75rem;height:2.75rem;border-radius:9px;background:#eef5fd;color:#21558e}.mini-action svg{width:1.18rem;height:1.18rem}.mini-action:hover{background:#dbeafb}
.score{display:block;color:#265585;font-size:.875rem;margin-top:.17rem}.notice-entry .detail{margin-inline-start:2.35rem}
.filters button{display:grid;place-items:center;min-width:2.75rem;padding-inline:.7rem}
.read-shell{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:1rem 1.15rem;font:inherit;line-height:1.75}
.read-actions{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;margin-block:0 1rem}
.link-note{margin-top:.55rem}.trail{margin-bottom:.65rem;font-size:.9rem}
@media(max-width:600px){.metric{min-height:6rem;padding:.7rem;gap:.45rem}.metric .icon-tile{width:1.75rem;height:1.75rem}.metric .metric-value{font-size:1.45rem}.line-art{width:53%;opacity:.25;right:0}.filters button{min-width:2.75rem}.nav a{padding-inline:.55rem;gap:.28rem}.mini-action{width:2.45rem;height:2.75rem}.entryline .meta{max-width:28%}}
@media(max-width:340px){.nav a{padding-inline:.4rem}.nav .nav-icon{display:none}}
`;
const navTitle = (path, label, folder) => '<div class="pagehead"><div><h1>'+label+'</h1>'+(path==="/notices"?'<p class="meta">仅当前课程</p>':'')+'</div>'+(path==="/materials"?glyphLink(folder||ucloud,"打开云邮","chain","quiet",true):'')+'</div>';
function syncView(s){
  const r=s.run,w=s.lastWrite;
  const success=r.status==="success", writing=r.mode==="write";
  const label=!r.at?"尚未同步":success?(writing?"同步成功":"只读检查通过"):(writing?"同步失败":"只读检查失败");
  const state=!r.at?"check":success?(writing?"success":"check"):"failure";
  const smallTime=r.at?'<time class="meta mono" datetime="'+esc(r.at)+'">'+esc(localizedDate(r.at))+' 北京时间</time>':"";
  const hint=writing?"":'<p class="last">'+(w?.at?'最近正式写入：'+esc(localizedDate(w.at))+"（北京时间）":"尚未确认正式写入。")+'</p>';
  return '<section id="sync" aria-labelledby="sync-title"><div class="syncbox '+state+'"><div class="syncleft">'+tile("sync")+'<h2 id="sync-title">同步状态</h2><strong class="result '+state+'">'+icon(state==="success"?"check":"warn")+label+'</strong>'+smallTime+'</div>'+(r.runUrl?glyphLink(r.runUrl,"GitHub 记录","history","quiet",true):"")+'</div>'+hint+'</section>';
}
function metric(path, label, type, items){
  return '<a class="panel metric" href="'+path+'">'+tile(type)+'<span><span class="meta">'+label+'</span><strong class="metric-value">'+(items==null?"未接入":items.length)+'</strong></span>'+pattern(type)+'</a>';
}
function peek(title,path,rows,kind){
  return '<section class="panel '+kind+'"><div class="sectionhead"><h2>'+title+'</h2><a class="quiet" href="'+path+'">查看全部</a></div><div class="panel-body">'+(rows?.length?'<ul class="peek-list">'+rows.slice(0,4).map(r=>'<li class="entry"><p class="compact-title">'+esc(r.course||"未分课程")+'</p><div class="entryline">'+(kind==="notices"?'<a class="title-link" href="/notices#'+esc(r.anchor)+'">'+esc(r.title)+'</a>':r.url?link(r.url,r.title,"title-link"):kind==="materials"&&hasText(r)?'<a class="title-link" href="/materials/read?id='+esc(encodeURIComponent(r.materialId))+'">'+esc(r.title)+'</a>':'<span class="file-title">'+esc(r.title)+'</span>')+(kind==="notices"&&r.date?'<time class="meta" datetime="'+esc(r.date)+'">'+esc(localizedDate(r.date))+'</time>':'')+'</div></li>').join("")+'</ul>':grouped(rows,kind))+'</div></section>';
}
function overview(s,materials,notices){
  return navTitle("/","总览")+syncView(s)+'<div class="metric-grid">'+metric("/notices","当前课程未读","bell",notices)+metric("/materials","学习资料","book",materials)+'</div><div class="board">'+peek("最近未读","/notices",notices,"notices")+peek("资料速览","/materials",materials,"materials")+'</div>';
}
function browse(path,items,qParam,folder){
  const isMaterials=path==="/materials", kind=isMaterials?"materials":"notices", label=isMaterials?"学习资料":"未读通知";
  const selected=(qParam.get("course")||"").slice(0,150), query=isMaterials?(qParam.get("q")||"").trim().slice(0,150):"";
  const found=items?.filter(row=>!query||[row.course,row.title,row.kind].join(" ").normalize("NFKC").toLowerCase().includes(query.normalize("NFKC").toLowerCase()));
  const courseGroups=groups(found??[]);
  const total=found?.filter(row=>!selected||(row.course||"未分课程")===selected).length??0;
  const courseURL=name=>{const params=new URLSearchParams();if(query)params.set("q",query);if(name)params.set("course",name);return path+(params.size?"?"+params:"");};
  const option=(name,n)=>'<li><a data-choice="'+esc(name)+'" href="'+esc(courseURL(name))+'"'+(selected===name?' aria-current="true"':'')+'><span>'+esc(name||"全部课程")+'</span><span class="course-n">'+n+'</span></a></li>';
  const filter=items?.length?'<details class="course-picker"><summary class="quiet glyph-link" title="按课程筛选">'+iconLabel("lines","按课程筛选")+'<span class="active-dot"'+(selected?'':' hidden')+'></span></summary><div class="course-pop"><p>按课程筛选</p><ul>'+option("",found?.length??0)+courseGroups.map(([name,rows])=>option(name,rows.length)).join("")+'</ul></div></details>':'';
  const heading='<div class="pagehead"><div><h1>'+label+'</h1>'+(isMaterials?'':'<p class="meta">仅当前课程</p>')+'</div><div class="heading-actions">'+filter+(isMaterials?glyphLink(folder||ucloud,"打开云邮","chain","quiet",true):'')+'</div></div>';
  const field='<div class="field"><span id="query-label">搜索资料</span><label class="search">'+icon("search")+'<input aria-labelledby="query-label" type="search" name="q" placeholder="输入课程或资料名称" maxlength="150" value="'+esc(query)+'"></label></div>';
  const form=isMaterials&&items?.length?'<form class="filters" method="get" action="'+path+'">'+field+'<input type="hidden" name="course" value="'+esc(selected)+'"><button type="submit">'+iconLabel("search","搜索")+'</button>'+(query?'<a class="clear" id="clear-search" href="'+esc(path+(selected?"?course="+encodeURIComponent(selected):""))+'">清除关键词</a>':'')+'</form>':'';
  const matches=found?'<p class="meta list-meta" id="course-matches" aria-live="polite">'+total+' 条'+(selected?' · '+esc(selected):'')+'</p>':'<div class="list-meta"></div>';
  const listing=(items?.length?'<p class="placeholder" id="course-empty"'+(total?' hidden':'')+'>没有符合条件的结果。</p>':'')+(items?.length&&!found?.length?'':grouped(found??null,kind,selected));
  return '<div class="stack">'+heading+'<section class="panel list-shell" aria-label="'+label+'列表">'+form+'<div class="panel-body">'+(isMaterials?'<p class="meta link-note">书本：阅读文字 · 链环：在云邮打开</p>':'')+matches+listing+'</div></section></div>';
}
function materialReader(r,offset){
  const text=r.contentText, size=10000;
  const previous=offset?'<a class="quiet" href="/materials/read?id='+esc(encodeURIComponent(r.materialId))+'&amp;offset='+Math.max(0,offset-size)+'">上一段</a>':'';
  const next=offset+size<text.length?'<a class="quiet" href="/materials/read?id='+esc(encodeURIComponent(r.materialId))+'&amp;offset='+(offset+size)+'">下一段</a>':'';
  return '<div class="stack"><p class="trail"><a href="/materials">学习资料</a> / '+esc(r.course||"未分课程")+'</p><div class="pagehead"><h1>'+esc(r.title)+'</h1></div><div class="read-actions"><span class="meta">'+(r.contentComplete?"已收录文字":"已收录部分文字")+' · 非原文件</span>'+(r.url?glyphLink(r.url,"在云邮打开","chain","quiet",true):'')+previous+next+'</div><div class="panel"><pre class="read-shell">'+esc(text.slice(offset,offset+size))+'</pre></div></div>';
}
function html(s,path,query,r=null){
  const notices=currentNotices(s)?.map((n,i)=>({...n,anchor:"notice-"+(i+1)}))??null,materials=s.resources,active=r?"学习资料":routes.find(([href])=>href===path)[1];
  const offset=r?Math.min(Math.max(0,Math.floor((Number(query.get("offset"))||0)/10000)*10000),Math.floor((r.contentText.length-1)/10000)*10000):0;
  const body=r?materialReader(r,offset):path==="/"?overview(s,materials,notices):browse(path,path==="/materials"?materials:notices,query,s.folder?.url);
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+active+' · 北邮学习台</title><link rel="stylesheet" href="/desk.css"><script defer src="/desk.js"></script></head><body>'
  +'<header class="masthead"><div class="shell"><div class="brandbar"><div class="brand"><span class="brandmark">'+icon("desk")+'</span><a href="/">北邮学习台</a></div>'+glyphLink(tasks,"Google Tasks","calendar","top-link",true)+'</div><nav class="nav" aria-label="主导航">'+routes.map(([href,label])=>navLink(href,label,href===(r?"/materials":path))).join("")+'</nav></div></header>'
  +'<main class="shell">'+body+'</main></body></html>';
}
const pickerCss=`
.heading-actions{display:flex;gap:.5rem;align-items:center;align-self:center}
.course-picker{position:relative}.course-picker summary,.notice-detail summary{list-style:none;cursor:pointer}.course-picker summary::-webkit-details-marker,.notice-detail summary::-webkit-details-marker{display:none}
.course-picker summary{position:relative}.course-picker summary:focus-visible,.notice-detail summary:focus-visible{outline:2px solid #2369ba;outline-offset:3px}
.course-picker[open] summary{background:#e3efff;border-color:#a9bfdc}
.active-dot{position:absolute;border-radius:50%;width:.42rem;height:.42rem;background:#225b9d;top:.42rem;right:.42rem}
.course-pop{position:absolute;z-index:15;top:calc(100% + .48rem);right:0;width:min(18rem,calc(100vw - 4.5rem));background:#fff;border:1px solid var(--border);border-radius:13px;box-shadow:0 12px 30px #142d4c28}
.course-pop p{padding:.65rem .8rem .45rem;font-size:.875rem;font-weight:650;color:var(--muted)}.course-pop ul{list-style:none;margin:0;padding:.2rem .35rem .4rem;max-height:min(55vh,21rem);overflow-y:auto}
.course-pop a{display:flex;justify-content:space-between;align-items:center;gap:.65rem;min-height:2.65rem;padding:.35rem .55rem;border-radius:8px;text-decoration:none;color:var(--ink);overflow-wrap:anywhere}
.course-pop a[aria-current],.course-pop a:hover{background:#eaf3ff;color:#194c87}.course-n{font-size:.875rem;color:var(--muted);font-variant-numeric:tabular-nums}
.notice-entry{scroll-margin-block-start:1.1rem}.notice-title{font-weight:640;color:var(--blue)}.notice-detail summary:hover .notice-title{text-decoration:underline}
.notice-toggle{color:var(--muted);display:grid;place-items:center;flex:none}.notice-toggle svg{width:1rem;height:1rem}.notice-detail[open] .notice-toggle{transform:rotate(180deg)}
.notice-body{margin:.35rem 0 .45rem 2.35rem;padding:.65rem .7rem;background:#f4f8fe;border-radius:9px}.notice-entry .notice-body .detail{margin:0}.notice-body .quiet{margin-top:.55rem}
.filters input[type=hidden]{display:none}
@media(max-width:370px){.notice-entry .entryline{gap:.28rem}.notice-body{margin-inline-start:0}.notice-mark{width:1.25rem}}
`;
const js=`
if(location.pathname==="/"){const legacy={"#notices":"/notices","#resources":"/materials"}[location.hash];if(legacy)location.replace(legacy);}
const picker=document.querySelector(".course-picker");
if(picker){
  const toggle=picker.querySelector("summary"), choices=[...picker.querySelectorAll("[data-choice]")], groups=[...document.querySelectorAll("[data-course]")];
  function applyCourse(name){
    let total=0;
    for(const g of groups){g.hidden=!!name&&g.dataset.course!==name;if(!g.hidden)total+=Number(g.dataset.count);}
    for(const a of choices){if(a.dataset.choice===name)a.setAttribute("aria-current","true");else a.removeAttribute("aria-current");}
    picker.querySelector(".active-dot").hidden=!name;
    const count=document.getElementById("course-matches");if(count)count.textContent=total+" 条"+(name?" · "+name:"");
    const empty=document.getElementById("course-empty");if(empty)empty.hidden=total!==0;
    const input=document.querySelector('input[name="course"]');if(input)input.value=name;
    const clear=document.getElementById("clear-search");if(clear)clear.href=location.pathname+(name?"?course="+encodeURIComponent(name):"");
  }
  for(const a of choices)a.addEventListener("click",event=>{
    if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
    event.preventDefault();
    const next=new URL(a.href);
    if(next.pathname+next.search!==location.pathname+location.search||location.hash)history.pushState(null,"",next);
    applyCourse(a.dataset.choice);
    picker.open=false;toggle.focus({preventScroll:true});
  });
  document.addEventListener("click",e=>{if(picker.open&&!picker.contains(e.target))picker.open=false;});
  picker.addEventListener("keydown",e=>{if(e.key==="Escape"&&picker.open){picker.open=false;toggle.focus({preventScroll:true});}});
  window.addEventListener("popstate",()=>applyCourse(new URLSearchParams(location.search).get("course")||""));
}
if(/^#notice-[0-9]+$/.test(location.hash)){
  const notice=document.getElementById(location.hash.slice(1));
  const details=notice?.querySelector(".notice-detail");
  if(details&&!notice.closest("[hidden]")){details.open=true;requestAnimationFrame(()=>notice.scrollIntoView({block:"start"}));}
}
`;
const send=(body,type)=>new Response(body,{headers:{...header,"Content-Type":type,"Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'"}});
export default {
 async fetch(req,env){
  try{
    const u=new URL(req.url), p=u.pathname, user=req.headers.get("oai-authenticated-user-id");
    if(p==="/mcp"&&req.method==="POST")return await mcp(req,env);
    if(p==="/api/ingest"&&req.method==="POST"){
      if(!env.BUCKET||!env.BUPT_INGEST_SECRET)return json({error:"not_configured"},503);
      if(!eq(req.headers.get("authorization"),"Bearer "+env.BUPT_INGEST_SECRET))return json({error:"unauthorized"},401);
      let payload;try{payload=normalize(await limited(req,1024*1024));}catch{return json({error:"invalid_snapshot"},400);}
      const prior=await read(env);
      if(prior.run?.at&&prior.run.at>payload.run.at)return json({error:"older_snapshot"},409);
      const write=payload.run.mode==="write"&&payload.run.status==="success"&&payload.run.tasks?payload.run:(prior.lastWrite??null);
      const sourceOK=payload.run.status==="success";
      const next={run:payload.run,lastWrite:write,assignments:sourceOK?(payload.assignments??prior.assignments):prior.assignments,resources:sourceOK?(payload.resources??prior.resources):prior.resources,notices:sourceOK?(payload.notices??prior.notices):prior.notices,currentCourses:sourceOK?(payload.currentCourses??prior.currentCourses):prior.currentCourses,folder:sourceOK?(payload.folder??prior.folder):prior.folder};
      await env.BUCKET.put(key,JSON.stringify(next),{httpMetadata:{contentType:"application/json"}});
      return json({stored:true,latest:payload.run.at});
    }
    if(req.method!=="GET")return json({error:"not_found"},404);
    if(p==="/desk.css")return send(css+richCss+outlineCss+pickerCss,"text/css; charset=utf-8");
    if(p==="/desk.js")return send(js,"text/javascript; charset=utf-8");
    if(!routes.some(([href])=>href===p)&&p!=="/api/snapshot"&&p!=="/materials/read")return json({error:"not_found"},404);
    if(!user)return json({error:"signed_in_viewer_required"},401);
    const snapshot=await read(env);
    if(p==="/materials/read"){
      const material=snapshot.resources?.find(x=>x.materialId===u.searchParams.get("id")&&hasText(x));
      return material?send(html(snapshot,p,u.searchParams,material),"text/html; charset=utf-8"):Response.redirect(new URL("/materials",u),302);
    }
    return p==="/api/snapshot"?json({...snapshot,notices:currentNotices(snapshot),resources:snapshot.resources?.map(publicMaterial)??null}):send(html(snapshot,p,u.searchParams),"text/html; charset=utf-8");
  }catch{return json({error:"temporarily_unavailable"},503);}
 }
};
