// Pure functions: no credentials, network, or filesystem access.
export function weekNumbers(text) {
  const value = String(text ?? "").replace(/周/g, "");
  const weeks = new Set();
  for (const part of value.split(/[,，、]/)) {
    const match = part.trim().match(/^(\d+)\s*[-~至]\s*(\d+)$/);
    if (match) {
      const start = Number(match[1]), end = Number(match[2]);
      if (start > 0 && end >= start && end <= 40) {
        for (let i = start; i <= end; i++) weeks.add(i);
      }
    } else if (/^\d+$/.test(part.trim())) {
      weeks.add(Number(part.trim()));
    }
  }
  return weeks;
}

export function normalizeWeek(payload, week) {
  const data = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
  if (!data || !Array.isArray(data.courses) || !Array.isArray(data.date)) {
    throw new Error("教务课表响应缺少 courses/date，接口可能已改变");
  }
  const dates = new Map(data.date.map(d => [String(d.xqid), String(d.mxrq)]));
  const classes = [];
  for (const course of data.courses) {
    const indicated = weekNumbers(course.classWeekDetails || course.classWeek);
    if (indicated.size && !indicated.has(Number(week))) continue;
    const date = dates.get(String(course.weekDay));
    const begin = String(course.startTime || "");
    const finish = String(course.endTIme || course.endTime || "");
    if (!date || !/^\d{2}:\d{2}/.test(begin) || !/^\d{2}:\d{2}/.test(finish)) continue;
    const title = String(course.courseName || "课程");
    // Distinguishes multiple lectures of one course on the same day.
    const identity = String(course.jx0404id || title);
    const sourceKey = "class:" + identity + ":" + date + ":" + begin.slice(0, 5);
    classes.push({
      sourceKey, title,
      start: date + "T" + begin.slice(0, 5) + ":00",
      end: date + "T" + finish.slice(0, 5) + ":00",
      location: String(course.location || course.classroomName || ""),
      description: "教师：" + String(course.teacherName || "未知") +
        "\n周次：" + String(course.classWeek || week) + "\n来源：北邮教务系统"
    });
  }
  return classes;
}

export function parseShanghaiDateTime(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const normalized = text.replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) return null;
  const withOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)
    ? normalized : normalized + "+08:00";
  const date = new Date(withOffset);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function shanghaiDay(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

export function normalizeHomework(payload, sitePayload) {
  const records = Array.isArray(payload?.undoneList)
    ? payload.undoneList
    : Array.isArray(payload?.data?.records) ? payload.data.records : null;
  if (!records) throw new Error("教学云作业响应结构不符合预期");
  const sites = new Map((sitePayload?.data?.records || []).map(
    s => [String(s.id), String(s.siteName || "未知课程")]
  ));
  return records.flatMap(r => {
    const id = String(r.activityId || r.assignmentId || r.id || "");
    if (!id) return [];
    const siteId = String(r.siteId || "");
    const course = String(r.courseInfo?.name || r.siteName || sites.get(siteId) || "未知课程");
    const title = String(r.activityName || r.assignmentTitle || r.title || "未命名作业");
    const rawDue = String(r.endTime || r.assignmentEndTime || "");
    const due = parseShanghaiDateTime(rawDue);
    return [{
      sourceKey: "hw:" + id, title, course, rawDue, siteId,
      due, sourceId: id,
      notes: "课程：" + course + "\n截止：" + (rawDue || "未提供") +
        "\n来源：北邮教学云"
    }];
  });
}
