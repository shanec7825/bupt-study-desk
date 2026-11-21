// Pure, read-only normalization of the AppUCloud student course directory.
// A "site" is a teaching-cloud course, not a timetable meeting.
export function normalizeUcloudCourses(payload) {
  const records = payload?.data?.records;
  if (!Array.isArray(records)) throw new Error("UCloud current course response missing records");

  const unique = new Map();
  for (const row of records) {
    if (!row || typeof row !== "object") continue;
    const id = String(row.id ?? row.siteId ?? "").trim();
    const name = String(row.siteName || row.courseName || row.name || "").trim();
    if (!id || !name) continue;
    const teacherField = Array.isArray(row.teachers)
      ? row.teachers.map(t => typeof t === "string" ? t : (t && typeof t === "object" ? t.name : "")).filter(Boolean).join(", ")
      : "";
    const teachers = String(row.teacherNames || row.teacherName || teacherField || "").trim();
    unique.set(id, { id, name, teachers });
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id));
}

function usefulCourseName(value) {
  const name = String(value || "").trim();
  return name && name !== "未知课程" ? name : "";
}

// For site-scoped queries, only accept matches with a unique confirmed site.
// This prevents a buggy/ignored siteId filter from assigning every work to one course.
export function uniqueAssignmentSiteMatches(courseResults, wantedIds) {
  const matches = new Map();
  const wanted = new Set(wantedIds.map(String));
  for (const entry of courseResults) {
    const siteId = String(entry.siteId);
    for (const record of entry.records || []) {
      const id = String(record?.id ?? record?.assignmentId ?? "").trim();
      if (!wanted.has(id)) continue;
      const reportedSite = String(record.siteId || "").trim();
      if (reportedSite && reportedSite !== siteId) continue;
      if (!matches.has(id)) matches.set(id, new Set());
      matches.get(id).add(siteId);
    }
  }
  return new Map([...matches].filter(([, sites]) => sites.size === 1)
    .map(([id, sites]) => [id, [...sites][0]]));
}

export function enrichUcloudHomework(homework, courses, siteIds = new Map()) {
  const courseById = new Map(courses.map(c => [String(c.id), c]));
  return homework.map(item => {
    const override = siteIds.get(item.sourceId);
    const siteId = String(override || item.siteId || "").trim();
    const site = courseById.get(siteId);
    const name = usefulCourseName(item.course) || site?.name || "未知课程";
    // A site-scoped match is more authoritative than a placeholder in a global listing.
    const course = override && site ? site.name : name;
    const courseChanged = course !== item.course;
    return {
      ...item, siteId, course, teachers: site?.teachers || "",
      notes: courseChanged
        ? "课程：" + course + "\n截止：" + (item.rawDue || "未提供") + "\n来源：北邮教学云"
        : item.notes
    };
  });
}


// Select a school-provided course identity only when it is unambiguous.
export function courseIdFromWorkDetail(detail, courses) {
  if (!detail || typeof detail !== "object") return "";
  const known = new Map(courses.map(c => [String(c.id), c]));
  for (const value of [
    detail.siteId, detail.courseInfo?.id, detail.courseInfo?.siteId,
    detail.site?.id
  ]) {
    const id = String(value ?? "").trim();
    if (known.has(id)) return id;
  }
  // Name-only fallback is allowed if the detailed record explicitly names one
  // unique course already found through the authenticated current-site endpoint.
  const name = String(detail.siteName || detail.courseInfo?.name || "").trim();
  if (!name || name === "未知课程") return "";
  const matches = courses.filter(c => c.name.trim() === name);
  return matches.length === 1 ? String(matches[0].id) : "";
}

export function unresolvedCurrentHomework(homework, semesterStart) {
  const boundary = Date.parse(semesterStart + "T00:00:00+08:00");
  return homework.filter(h =>
    (!h.course || h.course === "未知课程") &&
    (!h.due || h.due.getTime() >= boundary));
}


// Last-resort fallback ONLY when a work title explicitly contains a complete
// name from the authenticated current course directory. Never fuzzy-guess.
export function courseIdExplicitlyNamedInWorkTitle(title, courses) {
  const normalized = String(title || "").toLowerCase().replace(/[\s（）()【】\[\]·＿_-]/g, "");
  if (!normalized) return "";
  const candidates = courses.filter(c => {
    const courseName = String(c.name || "").toLowerCase().replace(/[\s（）()【】\[\]·＿_-]/g, "");
    return courseName.length >= 4 && normalized.includes(courseName);
  });
  return candidates.length === 1 ? String(candidates[0].id) : "";
}
