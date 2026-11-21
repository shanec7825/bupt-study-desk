import { listResources,readNotices,collectStudyDesk,indexCurrentAssignments } from "../src/ucloud_study.mjs";
const CS={id:"100",name:"数字逻辑"};
const assert=(ok)=>{if(!ok)throw Error("assertion failed");};
Deno.test("resource index keeps identifiers and excludes signed/deceptive original URLs",()=>{
  const r=listResources([{label:"课件",children:[
    {fileName:"逻辑门",resourceId:"200",ext:"pdf",webUrl:"https://ucloud.bupt.edu.cn/course/lesson"},
    {name:"试卷",resourceId:"201",ext:"docx",webUrl:"https://ucloud.bupt.edu.cn/file?token=NO"}
  ]}],CS);
  assert(r.length===2&&r[0].materialId==="100:200"&&r[0].url.startsWith("https://ucloud.bupt.edu.cn/"));
  assert(r[1].url===undefined&&!JSON.stringify(r).includes("token"));
});
Deno.test("unread notices require exact active ID; uncertain notices are not reported as empty",async()=>{
  const calls=[];
  const res=await readNotices(async(path,params,post)=>{
    calls.push(path);
    if(path.endsWith("/list")){
      assert(post&&params.newsCopyPersonId==="owner");
      return {data:{records:[
        {id:"n1",siteId:"100",newsTitle:"新成绩",isRead:0,newsModel:"assignment",newsUrl:"To-Be-Student-Assignment-Detail",objectId:"7"},
        {id:"n2",siteId:"101",newsTitle:"旧课",isRead:0},
        {id:"n3",siteId:"100",newsTitle:"已读",isRead:1},
        {id:"n4",newsTitle:"无法归类",isRead:0}
      ]}};
    }
    assert(path.endsWith("/submit-view")&&!post&&params.assignmentId==="7");
    return {data:{assignmentId:"7",assignmentScore:96,assignmentComment:"<p>讲清楚了</p>"}};
  },[CS],"owner");
  assert(res.notices.length===1&&res.notices[0].score==="96"&&res.notices[0].detail.includes("讲清楚了")&&res.unresolved===1);
  assert(!calls.some(p=>/read\/|mark|delete/.test(p)));
  const unknown=await readNotices(async()=>({data:{records:[{isRead:4}]}}),[CS],"owner");
  assert(unknown.notices===null);
});
Deno.test("downloads approved source once, supplies real bytes, sends no session or transient links",async()=>{
  let writes=0;
  const request=async(path)=>{
    if(path.endsWith("/list"))return {data:{records:[]}};
    if(path.includes("/tree/"))return {data:[{resourceName:"讲义.txt",resourceId:"200"}]};
    if(path.endsWith("/preview-url"))return {data:{previewUrl:"https://ucloud.bupt.edu.cn/resource?token=example"}};
    throw Error("unexpected request");
  };
  const result=await collectStudyDesk({courses:[CS],userId:"owner",request,
    fetchImpl:async(url,opts)=>{assert(opts.redirect==="error"&&!opts.headers);writes++;return new Response("实际文本");},
    extract:async(bytes,ext)=>{assert(ext==="txt");return {text:new TextDecoder().decode(bytes),complete:true}}
  });
  assert(writes===1&&result.notices.length===0&&result.resources[0].contentText==="实际文本");
  assert(!JSON.stringify(result).includes("token=example"));
});

Deno.test("joins unread assignment and material IDs to verified courses; skips pre-term dates",async()=>{
  const c2={id:"101",name:"Other"};
  const requests=[];
  const live=async(path,params,post,body)=>{
    requests.push(path);
    if(path.endsWith("work/student/list")){
      assert(post&&body.siteId);
      return {data:{records:body.siteId==="100"?[{siteId:"100",id:"7"},{siteId:"100",id:"9"}]:[{siteId:"101",id:"9"}]}};
    }
    if(path.endsWith("news/list"))return {data:{records:[
      {id:"notice1",isRead:0,newsTitle:"Recent grade",objectId:"7",newsCopyTime:"2026-11-21 17:30:00"},
      {id:"notice2",isRead:0,newsTitle:"Old grade",objectId:"7",newsCopyTime:"2026-08-31 23:30:00"},
      {id:"notice3",isRead:0,newsTitle:"New material",objectId:"10",newsCopyTime:"2026-11-22T01:00:00+08:00"},
      {id:"notice4",isRead:0,newsTitle:"Conflicting ID",objectId:"9"},
    ]}};
    if(path.endsWith("submit-view"))return {data:{assignmentId:"7",assignmentScore:98}};
    throw Error("unexpected request");
  };
  const indexed=await indexCurrentAssignments(live,[CS,c2]);
  assert(indexed.complete&&indexed.ids.get("7")==="100"&&!indexed.ids.has("9"));
  const found=await readNotices(live,[CS,c2],"owner",null,{workIndex:indexed.ids,resourceIndex:new Map([["10","100"]])});
  assert(found.notices.length===2&&found.notices[0].score==="98");
  assert(found.older===1&&found.unresolved===1&&found.currentMatches===2);
  assert(!requests.some(path=>/mark|delete/.test(path)));
});
Deno.test("a complete scan with only prior-semester notices yields verified zero",async()=>{
  const r=await readNotices(async()=>({data:{records:[{id:"past",isRead:0,newsTitle:"Old",createTime:Date.parse("2026-08-03T14:00:00Z")} ]}}),[CS],"owner");
  assert(r.finished&&r.older===1&&r.notices.length===0);
});
