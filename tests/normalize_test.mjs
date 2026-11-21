import { normalizeWeek, normalizeHomework, parseShanghaiDateTime, weekNumbers } from "../src/normalize.mjs";
function same(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Expected " + JSON.stringify(expected) + " but received " + JSON.stringify(actual));
  }
}
Deno.test("week range parsing", () => {
  same([...weekNumbers("1-3,5周")], [1, 2, 3, 5]);
});
Deno.test("timetable normalizes school record", () => {
  const input = { data: [{
    date: [{ xqid: "1", mxrq: "2026-10-26" }],
    courses: [{ courseName: "数据结构", jx0404id: "xyz", weekDay: "1",
      startTime: "08:00", endTIme: "09:40", classWeekDetails: "9,10",
      classroomName: "教三楼", teacherName: "T" }]
  }]};
  same(normalizeWeek(input, 9).map(x => x.title), ["数据结构"]);
  same(normalizeWeek(input, 8), []);
});
Deno.test("homework preserves deadline and identifier", () => {
  const records = { data: { records: [{
    id: "a123", assignmentTitle: "第三次作业", siteId: 23,
    assignmentEndTime: "2026-11-05 23:59:00"
  }] } };
  const sites = { data: { records: [{ id: 23, siteName: "数据结构" }] } };
  const list = normalizeHomework(records, sites);
  same(list.map(x => x.sourceKey), ["hw:a123"]);
  same(list.map(x => x.course), ["数据结构"]);
  same(list.map(x => x.due?.toISOString()), ["2026-11-05T15:59:00.000Z"]);
  if (!parseShanghaiDateTime("2026-11-05 23:59:00")) throw new Error("Timezone parsing failed");
});
