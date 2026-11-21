import { buildStudySnapshot, publishStudySnapshot } from "../src/study_site.mjs";
const base = {repository:"example-user/study-desk", runId:"12", attempt:"2", at:"2026-11-21T15:19:16Z", passed:true,
  homework:[{title:"Old",due:new Date("2026-01-01Z")},{title:"New",course:"Course",due:new Date("2026-11-20Z"),detail:{instructions:"Read the document",attachments:[{name:"lab.pdf",downloadUrl:"https://example.invalid/path?token=secret"}]}}],
  report:{tasks:{created:1,unchanged:2}}};
function assert(value){if(!value)throw new Error("assertion failed");}
Deno.test("dry run sends aggregate only and never reports Google writes",()=>{
  const p=buildStudySnapshot({...base,dryRun:true});
  assert(p.run.current===1&&p.run.archived===1&&p.run.tasks===null&&!p.assignments);
});
Deno.test("private Site gets current records without signed URLs",()=>{
  const p=buildStudySnapshot(base);
  assert(p.assignments.length===1&&p.run.tasks.created===1&&p.run.tasks.updated===0);
  assert(p.assignments[0].files[0].title==="lab.pdf"&&!JSON.stringify(p).includes("token="));
  assert(!buildStudySnapshot({...base,passed:false}).assignments);
});
Deno.test("sender skips without credentials and never follows redirects",async()=>{
  const p=buildStudySnapshot(base);
  const fail=()=>{throw new Error("should not call fetch")};
  assert(await publishStudySnapshot({payload:p,fetchImpl:fail})==="not_configured");
  const seen=await publishStudySnapshot({payload:p,siteOrigin:"https://example.chatgpt.site",serviceToken:"site",ingestSecret:"ingest",fetchImpl:async (url,request)=>{
    assert(new URL(url).hostname==="example.chatgpt.site");
    assert(request.redirect==="error"&&request.headers["OAI-Sites-Authorization"]==="Bearer site");
    return {ok:true};
  }});
  assert(seen==="published");
});
