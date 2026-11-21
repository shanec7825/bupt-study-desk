import { normalizeUcloudCourses, enrichUcloudHomework, uniqueAssignmentSiteMatches, courseIdFromWorkDetail, unresolvedCurrentHomework, courseIdExplicitlyNamedInWorkTitle } from "../src/ucloud_courses.mjs";
function eq(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Expected " + JSON.stringify(expected) + " but got " + JSON.stringify(actual));
  }
}
Deno.test("UCloud course directory supports teacher records, IDs and deduplication", () => {
  const data = { data: { records: [
    { id: 101, siteName: "数据结构", teachers: [{ name: "教师A" }, "教师B"] },
    { id: 102, siteName: "离散数学", teacherName: "教师C" },
    { id: 101, siteName: "数据结构", teachers: [{ name: "教师A" }, "教师B"] },
    { id: null, siteName: "无效记录" }
  ] } };
  const courses = normalizeUcloudCourses(data);
  eq(courses.length, 2);
  eq(courses.find(c => c.id === "101"), { id: "101", name: "数据结构", teachers: "教师A, 教师B" });
  eq(courses.find(c => c.id === "102")?.teachers, "教师C");
});
Deno.test("UCloud course normalization rejects an unexpected response", () => {
  let threw = false;
  try { normalizeUcloudCourses({ success: true, data: {} }); } catch { threw = true; }
  if (!threw) throw new Error("Missing records must fail");
});
Deno.test("site-scoped assignment ID is only accepted if exactly one course matches", () => {
  const entries = [
    { siteId: "101", records: [{ id: "a1" }, { id: "shared" }] },
    { siteId: "102", records: [{ assignmentId: "a2" }, { id: "shared" }] }
  ];
  const matches = uniqueAssignmentSiteMatches(entries, ["a1", "a2", "shared"]);
  eq([...matches], [["a1", "101"], ["a2", "102"]]);
});
Deno.test("course enrichment replaces only unknown names and preserves homework IDs", () => {
  const courses = [{ id: "101", name: "数据结构", teachers: "教师A" }];
  const homework = [{
    sourceId: "a1", sourceKey: "hw:a1", title: "第三次作业", siteId: "",
    course: "未知课程", rawDue: "2026-11-05 23:59",
    notes: "课程：未知课程\n截止：2026-11-05 23:59\n来源：北邮教学云"
  }, {
    sourceId: "a2", sourceKey: "hw:a2", title: "作业2", siteId: "",
    course: "离散数学", rawDue: "", notes: "original note"
  }];
  const result = enrichUcloudHomework(homework, courses, new Map([["a1", "101"]]));
  eq(result[0].course, "数据结构");
  eq(result[0].sourceKey, "hw:a1");
  eq(result[0].siteId, "101");
  if (!result[0].notes.includes("数据结构")) throw new Error("Notes were not enriched");
  eq(result[1].course, "离散数学");
  eq(result[1].notes, "original note");
});


Deno.test("detail matching uses direct site ID or uniquely matching official site name", () => {
  const courses = [{id:"1",name:"数据结构"}, {id:"2",name:"数字逻辑"}, {id:"3",name:"同名"}, {id:"4",name:"同名"}];
  eq(courseIdFromWorkDetail({siteId:"1"}, courses), "1");
  eq(courseIdFromWorkDetail({courseInfo:{id:"2"}}, courses), "2");
  eq(courseIdFromWorkDetail({siteName:"数据结构"}, courses), "1");
  eq(courseIdFromWorkDetail({siteName:"同名"}, courses), "");
  eq(courseIdFromWorkDetail({siteId:"999",siteName:"不存在的课程"}, courses), "");
});

Deno.test("only unknown, current-term homework requires expensive matching", () => {
  const data = [
    {sourceId:"old",course:"未知课程", due:new Date("2026-07-01T10:00:00+08:00")},
    {sourceId:"new",course:"未知课程", due:new Date("2026-10-01T10:00:00+08:00")},
    {sourceId:"done",course:"数据结构",due:new Date("2026-10-01T10:00:00+08:00")},
    {sourceId:"undated",course:"未知课程",due:null}
  ];
  eq(unresolvedCurrentHomework(data,"2026-09-01").map(x=>x.sourceId),["new","undated"]);
});

Deno.test("explicit homework title mapping only accepts a unique complete course name", () => {
  const courses = [
    {id:"1",name:"离散数学"},
    {id:"2",name:"数字逻辑与数字系统"},
    {id:"3",name:"离散数学（下）"}
  ];
  eq(courseIdExplicitlyNamedInWorkTitle("数字逻辑与数字系统-实验报告",courses),"2");
  eq(courseIdExplicitlyNamedInWorkTitle("离散数学（下）第七周作业",courses),"");
  eq(courseIdExplicitlyNamedInWorkTitle("第七周作业",courses),"");
});
