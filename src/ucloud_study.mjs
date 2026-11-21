// Independent consumer of UCloud read-only response contracts.
// Reference: bupt-anything, docs/tools.md and ucloud.py (protocol only).
import { plainText, safeAttachmentUrl } from "./ucloud_details.mjs";
import { CURRENT_TERM_START } from "./semester.mjs";
const TERM_START = Date.parse(CURRENT_TERM_START+"T00:00:00+08:00");
const UCLOUD = "https://ucloud.bupt.edu.cn/";
const MAX_BYTES=8*1024*1024;
const asId=v=>typeof v==="string"&&/^[a-zA-Z0-9_-]{1,130}$/.test(v)?v:typeof v==="number"&&Number.isSafeInteger(v)&&v>0?String(v):"";
const contentType=n=>(n.match(/\.(pdf|docx|pptx|txt|md)$/i)?.[1]??"").toLowerCase();
function officialLink(value){
  if(typeof value!=="string"||!value.trim())return undefined;
  try{const u=new URL(value,UCLOUD);if(u.origin===UCLOUD.slice(0,-1)&&u.href!==UCLOUD&&!u.username&&!u.password&&!/token|signature|ticket|secret|session|password|credential/i.test(u.search+u.hash))return u.href;}catch{}
  return undefined;
}
const shapeKeys = value => value&&typeof value==="object"&&!Array.isArray(value)?Object.keys(value).filter(k=>/^[a-zA-Z][a-zA-Z0-9_]{0,32}$/.test(k)).sort().slice(0,45).join(","):"";
export function listResources(tree,course,shapes = null) {
  const queue=Array.isArray(tree)?tree.slice():Array.isArray(tree?.children)?tree.children.slice():Array.isArray(tree?.records)?tree.records.slice():Array.isArray(tree?.list)?tree.list.slice():null;
  if(!queue)throw Error("resource_shape");
  const rows=new Map();let visited=0;let unknown=0;
  if(shapes&&shapes.size<10)shapes.add("root:"+shapeKeys(tree)+" ["+queue.length+"]");
  for(let i=0;i<queue.length;i++){
    if(++visited>1200)throw Error("resource_limit");
    const x=queue[i];if(!x||typeof x!=="object"){unknown++;continue;}
    if(shapes&&shapes.size<10)shapes.add("node:"+shapeKeys(x));
    const children=x.children??x.childList??x.items;
    const attachments=Array.isArray(x.attachmentVOs)?x.attachmentVOs:null;
    if(attachments)for(const item of attachments){
      if(queue.length>=1200)throw Error("resource_limit");
      if(item?.resource&&Number(item.type)!==2){
        const asset=item.resource;
        queue.push({...asset,resourceId:asset.resourceId??asset.storageId??asset.id});
      }
    }
    if(Array.isArray(children))for(const child of children){if(queue.length>=1200)throw Error("resource_limit");queue.push(child);}
    const name=plainText(x.resourceName??x.fileName??x.originalName??x.originalFilename??x.name??x.label??x.title,200);
    const suffix=String(x.ext??x.extension??x.fileExt??x.resourceExt??"").replace(/^\./,"").toLowerCase();
    const nested=x.resource&&typeof x.resource==="object"?x.resource:null;
    const id=asId(x.resourceId??x.fileId??nested?.id??((suffix||contentType(name))?x.id:undefined));
    if(!id||!name){if(!Array.isArray(children)&&!attachments)unknown++;continue;}
    if(Array.isArray(children)&&!suffix&&!contentType(name)&&!nested&&!x.resourceId)continue;
    const title=suffix&&!name.toLowerCase().endsWith("."+suffix)&&/^[a-z0-9]{1,12}$/.test(suffix)?name+"."+suffix:name;
    rows.set(id,{materialId:course.id+":"+id,resourceId:id,courseId:course.id,course:course.name,title,kind:suffix.toUpperCase()||contentType(title).toUpperCase(),url:officialLink(x.webUrl??x.resourceUrl??nested?.webUrl),downloadIds:[x.storageId,x.previewStorageId,x.resourceId,x.id].map(asId).filter(Boolean),downloadUrls:[x.sourceUrl,x.resourceIdUrl,x.url,x.link].filter(y=>typeof y==="string"),sourceLabel:"北邮教学云 · "+course.name});
  }
  if(!rows.size&&unknown)throw Error("resource_nodes");
  return [...rows.values()];
}
const bit=v=>v===false||v===0||v==="0"||v==="false"?0:v===true||v===1||v==="1"||v==="true"?1:null;
function noticeDate(v){
  if((typeof v==="number"&&Number.isSafeInteger(v))||(typeof v==="string"&&/^\d{10}(?:\d{3})?$/.test(v.trim()))){
    const n=Number(v), ms=n<10000000000?n*1000:n;
    return ms>=946684800000&&ms<4102444800000?new Date(ms).toISOString():undefined;
  }
  if(typeof v!=="string")return undefined;
  const t=v.trim().replace(" ","T");if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(t))return undefined;
  const d=Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(t)?t:t+"+08:00");return Number.isFinite(d)?new Date(d).toISOString():undefined;
}
// A course-scoped listing is accepted only when all pages needed for uniqueness
// finish, and never if two courses return the same ID with contradictory ownership.
export async function indexCurrentAssignments(request,courses){
  const hits=new Map(),queue=courses.slice(0,24);let complete=queue.length===courses.length;
  await Promise.all(Array.from({length:4},async()=>{let c;while((c=queue.shift())){
    try{
      let finished=false;
      for(let page=1;page<=3;page++){
        const {data}=await request("/ykt-site/work/student/list",{},true,{siteId:c.id,studentAssignmentStatus:"",current:page,size:100});
        if(!Array.isArray(data?.records))throw Error("assignment_shape");
        for(const w of data.records){
          if(!w||typeof w!=="object")continue;
          const reported=asId(w.siteId??w.courseInfo?.id);
          // Keep contradictory/unscoped results in the ambiguity map; don't use them.
          const owner=reported&&reported!==c.id?"!conflict":c.id;
          for(const id of new Set([w.assignmentId,w.activityId,w.id].map(asId).filter(Boolean))){
            if(!hits.has(id))hits.set(id,new Set());
            hits.get(id).add(owner);
          }
        }
        const pages=data.pages==null?NaN:Number(data.pages);
        if((Number.isFinite(pages)&&pages>0&&page>=pages)||data.records.length<100){finished=true;break;}
      }
      if(!finished)complete=false;
    }catch{complete=false;}
  }}));
  return {complete,ids:complete?new Map([...hits].filter(([,list])=>list.size===1&&!list.has("!conflict")).map(([id,list])=>[id,[...list][0]])):new Map()};
}
function objectCandidates(n){
  const values=[n.objectId,n.assignmentId,n.activityId,n.workId];
  for(const raw of [n.newsUrl,n.newsNote,n.newsInfo,...Array.from({length:10},(_,i)=>n["extend"+(i+1)])]){
    if(typeof raw!=="string"||raw.length>7000)continue;
    if(raw.trim().startsWith("{")){
      try{const o=JSON.parse(raw);values.push(o.assignmentId,o.activityId,o.workId,o.resourceId,o.objectId);}catch{}
    }
    for(const m of raw.matchAll(/[?&](?:amp;)?(?:assignmentId|workId|activityId|resourceId)=([a-zA-Z0-9_-]{1,130})(?:[&#"'\s]|$)/gi))values.push(m[1]);
    if(asId(raw))values.push(raw);
  }
  return [...new Set(values.map(asId).filter(Boolean))].slice(0,16);
}
export async function readNotices(request,courses,userId,shapes=null,{workIndex=new Map(),resourceIndex=new Map()}={}){
  const byId=new Map(courses.map(c=>[c.id,c]));const out=[];const seen=new Set();let unresolved=0, detailReads=0;let finished=false, missingRead=0, readCount=0, unreadCount=0, noCourse=0, older=0, undated=0, currentMatches=0, outside=0;
  for(let page=1;page<=12;page++){
    const {data}=await request("/ykt-basics/api/inform/news/list",{newsCopyPersonId:userId,current:page,size:50},true);
    if(!Array.isArray(data?.records))throw Error("notification_shape");
    for(const n of data.records){
      if(shapes&&shapes.size<10)shapes.add("notice:"+shapeKeys(n));
      const isRead=bit(n?.isRead);
      if(isRead===null){unresolved++;missingRead++;continue;}
      if(isRead===1){readCount++;continue;}
      unreadCount++;
      const date=noticeDate(n.newsCopyTime)??noticeDate(n.createTime);
      if(date&&Date.parse(date)<TERM_START){older++;continue;}
      if(!date)undated++;
      const nid=asId(n.id);if(nid&&seen.has(nid))continue;if(nid)seen.add(nid);
      let cid=asId(n.siteId??n.courseId);
      if(!cid){
        // Only an exact value matching one verified current site ID qualifies.
        // Never guess from course names or notification text.
        const matches=new Set();
        for(let field=1;field<=10;field++){const exact=asId(n["extend"+field]);if(exact&&byId.has(exact))matches.add(exact);}
        if(matches.size===1)cid=[...matches][0];
      }
      const action=String(n.newsUrl??"");
      const candidates=objectCandidates(n);
      const assignmentMatches=candidates.filter(id=>workIndex.has(id));
      const matchedCourses=new Set([...assignmentMatches.map(id=>workIndex.get(id)),...candidates.filter(id=>resourceIndex.has(id)).map(id=>resourceIndex.get(id))]);
      if(!cid&&matchedCourses.size===1)cid=[...matchedCourses][0];
      const assignment=assignmentMatches.length===1?assignmentMatches[0]:
        /assignment|homework/i.test(String(n.newsModel??"")+" "+action)?asId(n.objectId):"";
      if(!cid&&assignment&&detailReads++<20){
        try{const {data:d}=await request("/ykt-site/work/detail",{assignmentId:assignment},false);if(asId(d?.id??d?.assignmentId)===assignment)cid=asId(d.siteId??d.courseInfo?.id);}catch{}
      }
      if(!cid){
        for(const raw of [n.newsUrl,n.newsNote,...Array.from({length:10},(_,i)=>n["extend"+(i+1)])]){
          if(typeof raw!=="string"||raw.length>2500)continue;
          if(raw.trim().startsWith("{")){
            try {const o=JSON.parse(raw);const key=asId(o.siteId??o.courseId??o.site?.id??o.course?.id);if(key&&byId.has(key)){cid=key;break;}}catch{}
          }
          const m=raw.match(/[?&](?:siteId|courseId)=([a-zA-Z0-9_-]{1,130})(?:[&#"'\s]|$)/i);
          if(m&&byId.has(m[1])){cid=m[1];break;}
        }
      }
      if(!cid){unresolved++;noCourse++;continue;}
      const course=byId.get(cid);if(!course){outside++;continue;}
      if(matchedCourses.size&&(!matchedCourses.has(cid)||matchedCourses.size>1)){unresolved++;continue;}
      currentMatches++;
      const title=plainText(n.newsTitle,200);if(!title){unresolved++;continue;}
      let score="",comment="";
      if(assignment&&detailReads++<20){
        try{const {data:d}=await request("/ykt-site/work/submit-view",{assignmentId:assignment},false);
          if(asId(d?.assignmentId)===assignment){
            const value=d?.assignmentScore;
            if(value!=null&&String(value)!=="-1"&&/^\d+(?:\.\d+)?$/.test(String(value)))score=String(value);
            comment=plainText(d?.assignmentComment,700);
          }
        }catch{}
      }
      out.push({title,courseId:cid,course:course.name,unread:true,date,url:officialLink(n.webUrl),detail:[plainText(n.newsInfo,1200),comment&&"教师评语："+comment].filter(Boolean).join("\n"),score});
    }
    const pages=data.pages==null?NaN:Number(data.pages),total=data.total==null?NaN:Number(data.total);
    if(data.records.length===0||data.records.length<50||(Number.isFinite(pages)&&pages>0&&page>=pages)||(Number.isFinite(total)&&total>=0&&page*50>=total)){finished=true;break;}
  }
  return {notices:(out.length||(!unresolved&&finished))?out.slice(0,200):null,unresolved,finished,missingRead,readCount,unreadCount,noCourse,older,undated,currentMatches,outside};
}
async function bytesOf(req){
  if(!req.ok||!req.body)throw Error("file_unavailable");
  if(Number(req.headers.get("content-length"))>MAX_BYTES)throw Error("file_too_large");
  const rd=req.body.getReader(), chunks=[];let size=0;
  for(;;){const {value,done}=await rd.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await rd.cancel();throw Error("file_too_large");}chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const x of chunks){all.set(x,offset);offset+=x.byteLength;}return all;
}
const asText=ext=>new Deno.Command("python3",{args:["src/study_extract.py",ext],stdin:"piped",stdout:"piped",stderr:"null",signal:AbortSignal.timeout(12000)}).spawn();
async function textOf(value,ext){
  const proc=asText(ext),w=proc.stdin.getWriter(), result=proc.output();
  try{await w.write(value);await w.close();const got=await result;return got.success?JSON.parse(new TextDecoder().decode(got.stdout)):null;}
  catch{try{w.releaseLock();proc.kill();}catch{} await result.catch(()=>{});return null;}
}
async function withText(row,request,fetchImpl,extract,diag){
  const ext=contentType(row.title);if(!ext)return null;
  const urls=new Set();
  for(const raw of row.downloadUrls??[]){const safe=safeAttachmentUrl(raw);if(safe)urls.add(safe.href);}
  for(const id of [...new Set([...(row.downloadIds??[]),row.resourceId])].slice(0,2)){
    try{const {data}=await request("/blade-source/resource/preview-url",{resourceId:id},false);
      for(const u of [data?.downloadUrl,data?.previewUrl,data?.url]){const safe=safeAttachmentUrl(u);if(safe)urls.add(safe.href);}
      if(urls.size)break;
    }catch{diag.previewErrors++;}
  }
  if(!urls.size){diag.noApprovedUrl++;return null;}
  for(const u of [...urls].slice(0,3)){
    try{
      const response=await fetchImpl(u,{redirect:"error",signal:AbortSignal.timeout(8000)});
      if(!response.ok){diag.downloadHttp++;continue;}
      if((response.headers.get("content-type")??"").includes("text/html")){diag.htmlPreview++;continue;}
      const body=await bytesOf(response);const got=await extract(body,ext);
      if(got?.text)return got;
      diag.emptyText++;
    }catch{diag.downloadErrors++;}
  }
  return null;
}
export async function collectStudyDesk({courses,userId,request,fetchImpl=fetch,extract=textOf,log=()=>{}}){
  const currentCourses=courses.filter(c=>asId(c.id)&&c.name).map(c=>({id:String(c.id),name:c.name}));
  const resources=[];let missed=0;
  const resourceShapes=new Set(), noticeShapes=new Set();
  const assignmentsPromise=indexCurrentAssignments(request,currentCourses);
  const queue=currentCourses.slice(0,24);
  if(queue.length!==currentCourses.length)missed++;
  await Promise.all(Array.from({length:3},async()=>{let course;while((course=queue.shift())){
    try{const {data}=await request("/ykt-site/site-resource/tree/student",{siteId:course.id,userId},true);resources.push(...listResources(data,course,resourceShapes));}catch{missed++;}
  }}));
  const a=await assignmentsPromise;
  const resourceOwner=new Map();
  for(const r of resources){
    for(const id of new Set([r.resourceId,...r.downloadIds].filter(Boolean))){
      if(!resourceOwner.has(id))resourceOwner.set(id,new Set());
      resourceOwner.get(id).add(r.courseId);
    }
  }
  const resourceIndex=new Map([...resourceOwner].filter(([,set])=>set.size===1).map(([id,set])=>[id,[...set][0]]));
  const noticePromise=readNotices(request,currentCourses,userId,noticeShapes,{workIndex:a.ids,resourceIndex}).catch(()=>({notices:null,finished:false,unresolved:0}));
  resources.sort((a,b)=>a.course.localeCompare(b.course,"zh-CN")||a.title.localeCompare(b.title,"zh-CN")||a.materialId.localeCompare(b.materialId));
  let total=0,count=0;
  const diag={previewErrors:0,noApprovedUrl:0,downloadHttp:0,htmlPreview:0,emptyText:0,downloadErrors:0};
  for(const row of resources.filter(r=>contentType(r.title)).slice(0,16)){
    if(total>=260000)break;
    try{const record=await withText(row,request,fetchImpl,extract,diag);if(record?.text){
      const slice=record.text.slice(0,Math.min(48000,260000-total));
      row.contentText=slice;row.contentComplete=record.complete===true&&slice.length===record.text.length;total+=slice.length;count++;
    }}catch{}
  }
  const n=await noticePromise;
  log("Study text: "+JSON.stringify(diag));
  log("Study shape: "+JSON.stringify({resources:[...resourceShapes],notices:[...noticeShapes],read:n.readCount,unread:n.unreadCount,missingRead:n.missingRead,noCourse:n.noCourse,older:n.older,undated:n.undated,matched:n.currentMatches,outside:n.outside,assignmentIndex:a.ids.size,indexComplete:a.complete}));
  log("Study pull: courses="+currentCourses.length+", resource_count="+resources.length+", text_count="+count+", resource_failures="+missed+", unread_current="+(n.notices?.length??"unknown")+", unread_unresolved="+n.unresolved+", notification_scan_complete="+n.finished+".");
  return {currentCourses,resources:(!missed||resources.length)?resources.slice(0,380).map(({resourceId,downloadIds,downloadUrls,...r})=>r):null,notices:n.notices};
}
