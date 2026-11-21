import { isPreviousSemesterDeadline } from "./semester.mjs";

function siteEndpoint(origin) {
  if(!origin)return null;
  const u=new URL(origin);
  if(u.protocol!=="https:"||!u.hostname.endsWith(".chatgpt.site")||u.username||u.password||u.port||u.pathname!=="/"||u.search||u.hash)throw Error("invalid_site_origin");
  return u.origin+"/api/ingest";
}
export function buildStudySnapshot({dryRun, passed, homework, report, repository, runId, attempt, at, studyData}) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository??"") || !/^\d+$/.test(runId??"") || !/^\d+$/.test(attempt??"")) return null;
  const active = Array.isArray(homework) ? homework.filter(h => !isPreviousSemesterDeadline(h.due)) : null;
  const payload = {
    run: {
      at, mode: dryRun ? "dry_run" : "write", status: passed ? "success" : "failure",
      runUrl: "https://github.com/" + repository + "/actions/runs/" + runId + "/attempts/" + attempt,
      found: homework?.length ?? null, current: active?.length ?? null,
      archived: active ? homework.length-active.length : null,
      tasks: !dryRun && passed && report?.tasks
        ? {created: report.tasks.created??0, updated: report.tasks.updated??0, unchanged: report.tasks.unchanged??0} : null,
      note: dryRun ? (passed ? "只读验证通过。没有写入 Google Tasks 或日历。" : "只读检查未通过，没有写入 Google。")
        : (passed ? "Google Calendar 和 Google Tasks 同步程序已正常结束。" : "未确认正式写入全部完成，请查看运行日志。")
    },
  };
  if (!dryRun && passed && active) payload.assignments = active.map(h => ({
    title:h.title, course:h.course, kind:"作业", state:"云邮未完成列表", date:h.due?.toISOString()??null,
    detail:h.detail?.instructions??"", files:(h.detail?.attachments??[]).map(a=>({title:a.name}))
  }));
  if (!dryRun && passed && studyData) {
    if(Array.isArray(studyData.currentCourses))payload.currentCourses=studyData.currentCourses;
    if(Array.isArray(studyData.resources))payload.resources=studyData.resources;
    if(Array.isArray(studyData.notices))payload.notices=studyData.notices;
  }
  return payload;
}
export async function publishStudySnapshot({payload, siteOrigin, serviceToken, ingestSecret, fetchImpl = fetch}) {
  if (!payload || !siteOrigin || !serviceToken || !ingestSecret) return "not_configured";
  const endpoint=siteEndpoint(siteOrigin);
  const snapshot=structuredClone(payload);
  const encoder=new TextEncoder();
  let body=JSON.stringify(snapshot);
  for(let i=(snapshot.resources?.length??0)-1;i>=0&&encoder.encode(body).length>900000;i--){
    const item=snapshot.resources[i];
    if(item.contentText){delete item.contentText;delete item.contentComplete;body=JSON.stringify(snapshot);}
  }
  if(encoder.encode(body).length>900000)throw Error("snapshot_limit");
  const res = await fetchImpl(endpoint, {method:"POST", redirect:"error", signal:AbortSignal.timeout(10000),
    headers:{"content-type":"application/json","OAI-Sites-Authorization":"Bearer "+serviceToken,"authorization":"Bearer "+ingestSecret},
    body});
  return res.ok ? "published" : "failed_http_" + res.status;
}

