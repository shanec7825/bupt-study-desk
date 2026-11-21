// Connects only to official BUPT domains. Never log credentials or tokens.
import CryptoJS from "npm:crypto-js@4.2.0";
import { login } from "jsr:@byrdocs/bupt-auth@0.2.1";
import { normalizeWeek, normalizeHomework } from "./normalize.mjs";
import { normalizeUcloudCourses, enrichUcloudHomework, uniqueAssignmentSiteMatches, courseIdFromWorkDetail, unresolvedCurrentHomework, courseIdExplicitlyNamedInWorkTitle } from "./ucloud_courses.mjs";
import { CURRENT_TERM_START, isPreviousSemesterDeadline } from "./semester.mjs";
import { mergeWorkDetails, normalizeAttachmentList, normalizeHomeworkDetail } from "./ucloud_details.mjs";
import { summarizeLoginResponse } from "./jwgl_diagnostics.mjs";

import { collectStudyDesk } from "./ucloud_study.mjs";

const JWGL_BASE = "https://jwglweixin.bupt.edu.cn/bjyddx";
const UCLOUD_BASE = "https://apiucloud.bupt.edu.cn";
const UCLOUD_BASIC = "Basic c3dvcmQ6c3dvcmRfc2VjcmV0"; // Public app client from BUPT API example.

async function checkedJSON(response, service) {
  if (!response.ok) throw new Error(service + " HTTP " + response.status);
  try { return await response.json(); }
  catch { throw new Error(service + " returned non-JSON response"); }
}

async function jwglRequest(path, params = {}, token) {
  const url = new URL(JWGL_BASE + path);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      // The official mobile-frontend login sends blank captchaData/codeVal.
      url.searchParams.set(name, String(value));
    }
  }
  const headers = {
    Accept: "application/json",
    Origin: "https://jwglweixin.bupt.edu.cn",
    Referer: "https://jwglweixin.bupt.edu.cn/sjd/",
    ...(token ? { Token: token } : {})
  };
  let response;
  try {
    response = await fetch(url, {
      method: "POST", headers, signal: AbortSignal.timeout(18000)
    });
  } catch (error) {
    console.error("Mobile academic system request failed before receiving an HTTP response.");
    throw error;
  }
  if (!response.ok) console.error("Mobile academic system HTTP status: " + response.status);
  return checkedJSON(response, "移动教务");
}

export async function loadClasses(username, password) {
  const key = CryptoJS.enc.Utf8.parse("qzkj1kjghd=876&*");
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(password), key, {
    mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7
  }).toString();
  const credential = btoa(encrypted);
  console.log("Mobile academic system: requesting login.");
  const signedIn = await jwglRequest("/login", {
    userNo: username, pwd: credential, encode: "1",
    captchaData: "", codeVal: ""
  });
  const token = signedIn?.data?.token;
  if (!token || String(signedIn.code) !== "1") {
    const category = summarizeLoginResponse(signedIn);
    console.error("Mobile academic system: login response rejected or token missing.");
    console.error("Mobile academic system login categories: " + JSON.stringify(category));
    if (category.notice === "mentions_credentials") throw new Error("JWGL_CREDENTIALS_REJECTED");
    if (category.notice === "mentions_verification") throw new Error("JWGL_VERIFICATION_REQUIRED");
    throw new Error("JWGL_LOGIN_FAILED");
  }
  console.log("Mobile academic system: login accepted; requesting teaching weeks.");
  const weeksResponse = await jwglRequest("/teachingWeek", {}, token);
  if (String(weeksResponse?.code) !== "1" || !Array.isArray(weeksResponse.data)) {
    throw new Error("移动教务教学周接口返回异常");
  }
  const weeks = [...new Set(weeksResponse.data.map(w => Number(w.week))
    .filter(n => Number.isInteger(n) && n > 0 && n <= 30))].sort((a, b) => a - b);
  if (!weeks.length) throw new Error("无法取得有效教学周");
  console.log("Mobile academic system: teaching weeks received; requesting timetable.");
  const output = new Map();
  for (const week of weeks) {
    const response = await jwglRequest("/student/curriculum", { week }, token);
    if (String(response?.code) !== "1") throw new Error("获取第 " + week + " 周课表失败");
    for (const course of normalizeWeek(response, week)) output.set(course.sourceKey, course);
  }
  return [...output.values()];
}

async function ucloudRequest(path, userinfo, body = undefined, query = {}) {
  const url = new URL(UCLOUD_BASE + path);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: UCLOUD_BASIC,
      "Blade-Auth": userinfo.access_token,
      ...(body === undefined ? {} : { "Content-Type": "application/json;charset=UTF-8" })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const json = await checkedJSON(response, "教学云");
  if (json.success !== true) throw new Error("教学云接口返回失败");
  return json;
}

// Authenticate only to the official UCloud endpoint; never print passwords or tokens.
async function connectUcloud(username, password, ocrToken) {
  const options = ocrToken ? { ocr: { token: ocrToken } } : {};
  console.log("UCloud stage: authentication starting.");
  let userinfo;
  try {
    userinfo = await login(username, password, options);
  } catch (error) {
    // The underlying exception might include a URL or personal information.
    console.log("UCloud stage: authentication failed.");
    throw error;
  }
  if (!userinfo?.access_token || !userinfo?.user_id) throw new Error("教学云认证没有返回用户 Token");
  console.log("UCloud stage: authentication accepted.");
  return userinfo;
}

async function currentUcloudSites(userinfo) {
  const records = [];
  const pageSize = 200;
  for (let page = 1; page <= 30; page++) {
    let response;
    try {
      response = await ucloudRequest("/ykt-site/site/list/student/current", userinfo, undefined, {
        size: pageSize, current: page, userId: userinfo.user_id, siteRoleCode: 2
      });
    } catch (error) {
      console.log("UCloud stage: course site fetch failed.");
      throw error;
    }
    const batch = response?.data?.records;
    if (!Array.isArray(batch)) throw new Error("教学云课程列表缺少 records");
    records.push(...batch);
    const total = Number(response.data.total || 0);
    const pages = Number(response.data.pages || (total ? Math.ceil(total / pageSize) : 1));
    if (page >= pages) {
      console.log("UCloud stage: current course sites fetched; count=" + records.length + ".");
      return { data: { records } };
    }
    if (batch.length === 0) throw new Error("教学云课程分页异常");
  }
  throw new Error("教学云课程分页超过安全上限");
}

// A real course directory; site records do not include physical classroom meeting times.
export async function loadUcloudCourses(username, password, ocrToken) {
  const userinfo = await connectUcloud(username, password, ocrToken);
  return normalizeUcloudCourses(await currentUcloudSites(userinfo));
}

async function getUcloudUndoneWorks(userinfo) {
  const records = [];
  const pageSize = 200;
  for (let page = 1; page <= 50; page++) {
    let response;
    try {
      response = await ucloudRequest("/ykt-site/work/student/list", userinfo,
        { studentAssignmentStatus: 99, current: page, size: pageSize });
    } catch (error) {
      console.log("UCloud stage: homework list fetch failed.");
      throw error;
    }
    const batch = response?.data?.records;
    if (!Array.isArray(batch)) throw new Error("教学云作业列表缺少 records");
    records.push(...batch);
    const total = Number(response.data.total || 0);
    const pages = Number(response.data.pages || (total ? Math.ceil(total / pageSize) : 1));
    if (page >= pages) return records;
    if (batch.length === 0) throw new Error("教学云作业分页异常");
  }
  throw new Error("教学云作业分页超过安全上限");
}

async function findHomeworkCourseIds(userinfo, homework, courses) {
  const unresolved = unresolvedCurrentHomework(homework, CURRENT_TERM_START);
  if (!unresolved.length || !courses.length) return new Map();
  const discovered = new Map();
  const deadline = Date.now() + 95_000; // keep read-only diagnostics within Action limit

  // Details and submission view are scoped by assignment ID, not by guessed course.
  async function parallel(items, concurrency, fn) {
    const results = new Array(items.length).fill(null);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length && Date.now() < deadline) {
        const i = nextIndex++;
        try { results[i] = await fn(items[i]); }
        catch { results[i] = null; }
      }
    });
    await Promise.all(workers);
    return results;
  }

  const detailCandidates = unresolved.slice(0, 35);
  const details = await parallel(detailCandidates, 5, async h => {
    for (const path of ["/ykt-site/work/detail", "/ykt-site/work/submit-view"]) {
      try {
        const response = await ucloudRequest(path, userinfo, undefined,
          { assignmentId: h.sourceId });
        const id = courseIdFromWorkDetail(response?.data, courses);
        if (id) return { assignmentId: h.sourceId, siteId: id };
      } catch {
        // The school may restrict one of the detail endpoints.
      }
    }
    return null;
  });
  for (const item of details) {
    if (item?.siteId) discovered.set(item.assignmentId, item.siteId);
  }
  const pending = unresolved.filter(h => !discovered.has(h.sourceId));
  if (!pending.length || Date.now() >= deadline) return discovered;

  // Search by EXACT source assignment ID within a site-filtered keyword query.
  // Based on the site's student work listing; reject ambiguous results.
  // Avoid a full-course scan: a short title search is much cheaper.
  const queryJobs = pending.flatMap(h =>
    courses.map(course => ({ homework: h, course }))
  );
  if (queryJobs.length > 180) {
    console.log("UCloud course matching: safe search limit reached; leaving unknown items unresolved.");
    return discovered;
  }
  const results = await parallel(queryJobs, 6, async job => {
    const matches = [];
    for (let page = 1; page <= 3 && Date.now() < deadline; page++) {
      const response = await ucloudRequest("/ykt-site/work/student/list", userinfo, {
        siteId: job.course.id,
        keyword: job.homework.title,
        studentAssignmentStatus: "",
        current: page, size: 100
      });
      const batch = response?.data?.records;
      if (!Array.isArray(batch)) throw new Error("Course-filtered work listing invalid");
      matches.push(...batch);
      const totalPages = Number(response?.data?.pages ||
        (Number(response?.data?.total || 0) > 0
          ? Math.ceil(Number(response.data.total) / 100) : 1));
      if (page >= totalPages || batch.length === 0) return {
        siteId: job.course.id, records: matches, complete: true
      };
    }
    return null;
  });
  // Reject incomplete coverage: if one site query failed, the result cannot be
  // proven unique, because the school's siteId filter may be ignored upstream.
  const complete = results.length === queryJobs.length &&
    results.every(result => result?.complete);
  if (!complete) {
    console.log("UCloud course matching: some site searches unavailable; using only confirmed detail matches.");
    return discovered;
  }
  const indexed = uniqueAssignmentSiteMatches(results, pending.map(h => h.sourceId));
  for (const [id, siteId] of indexed) discovered.set(id, siteId);
  return discovered;
}


async function fetchUcloudHomeworkDetail(userinfo, assignmentId) {
  const calls = await Promise.allSettled([
    ucloudRequest("/ykt-site/work/detail", userinfo, undefined, { assignmentId }),
    ucloudRequest("/ykt-site/work/submit-view", userinfo, undefined, { assignmentId })
  ]);
  const primary = calls[0].status === "fulfilled" ? calls[0].value?.data : null;
  const secondary = calls[1].status === "fulfilled" ? calls[1].value?.data : null;
  if (!primary && !secondary) return null;
  const merged = mergeWorkDetails(primary, secondary);
  const resourceIds = [...new Set(
    (Array.isArray(merged.assignmentResource) ? merged.assignmentResource : [])
      .map(r => String(r?.resourceId || "").trim()).filter(Boolean)
  )].slice(0, 30);
  let metadata = [];
  if (resourceIds.length) {
    try {
      const data = await ucloudRequest("/blade-source/resource/list/byId", userinfo,
        undefined, { resourceIds: resourceIds.join(",") });
      if (Array.isArray(data?.data)) metadata = data.data;
    } catch {
      // Not all UCloud accounts expose the resource API; keep original names.
    }
  }
  const attachments = normalizeAttachmentList(merged, metadata);
  // Signed preview links are ephemeral and only used during private artifact export.
  for (const item of attachments.slice(0, 20)) {
    if (item.downloadUrl) continue;
    try {
      const response = await ucloudRequest("/blade-source/resource/preview-url", userinfo,
        undefined, { resourceId: item.resourceId });
      if (typeof response?.data?.previewUrl === "string") {
        item.downloadUrl = response.data.previewUrl;
      }
    } catch { /* Attachment metadata still returned without a URL. */ }
  }
  return normalizeHomeworkDetail(merged, attachments);
}

// Only fetch personal details for the current semester. Old UCloud works stay
// out of Google; users may still access them using the school portal.
async function fetchCurrentWorkDetails(userinfo, homework) {
  const current = homework.filter(h => !isPreviousSemesterDeadline(h.due)).slice(0, 45);
  const result = new Map();
  const budgetEnd = Date.now() + 75_000;
  let cursor = 0;
  const jobs = Array.from({ length: Math.min(4, current.length) }, async () => {
    while (cursor < current.length && Date.now() < budgetEnd) {
      const hw = current[cursor++];
      try {
        const detail = await fetchUcloudHomeworkDetail(userinfo, hw.sourceId);
        if (detail) result.set(hw.sourceId, detail);
      } catch {
        // Details are supplementary; failing detail must not block DDL sync.
      }
    }
  });
  await Promise.all(jobs);
  return result;
}

export async function loadUcloudSnapshot(username, password, ocrToken, { withDetails = false, onStudyDesk = null } = {}) {
  const userinfo = await connectUcloud(username, password, ocrToken);
  const sitePayload = await currentUcloudSites(userinfo);
  const courses = normalizeUcloudCourses(sitePayload);
  const works = await getUcloudUndoneWorks(userinfo);
  const normalized = normalizeHomework({ data: { records: works } }, sitePayload);
  const inferred = await findHomeworkCourseIds(userinfo, normalized, courses);
  const fetchedDetails = withDetails ? await fetchCurrentWorkDetails(userinfo, normalized) : new Map();
  // Detailed work records can provide the official siteId even when the work list omits it.
  for (const [assignmentId, detail] of fetchedDetails) {
    const id = courseIdFromWorkDetail(detail, courses);
    if (id) inferred.set(assignmentId, id);
  }
  // Only accept an explicit full course title mention when no more authoritative ID exists.
  for (const h of unresolvedCurrentHomework(normalized, CURRENT_TERM_START)) {
    if (inferred.has(h.sourceId)) continue;
    const namedId = courseIdExplicitlyNamedInWorkTitle(h.title, courses);
    if (namedId) inferred.set(h.sourceId, namedId);
  }
  const enriched = enrichUcloudHomework(normalized, courses, inferred);
  const homework = enriched.map(h => ({ ...h, detail: fetchedDetails.get(h.sourceId) || null }));
  const current = homework.filter(h => !isPreviousSemesterDeadline(h.due));
  const unmatched = current.filter(h => !h.course || h.course === "未知课程").length;
  const old = homework.length - current.length;
  console.log("UCloud summary: courses=" + courses.length +
    ", homework=" + homework.length + ", current_homework=" + current.length +
    ", archived_homework=" + old + ", unmatched_current=" + unmatched +
    ", details_fetched=" + fetchedDetails.size + ".");
  if (onStudyDesk) {
    // One authenticated UCloud session; extra read errors do not block Google sync.
    onStudyDesk(collectStudyDesk({courses,userId:userinfo.user_id,
      request:(path,params,post,body)=>ucloudRequest(path,userinfo,post?(body??{}):undefined,params),
      log:message=>console.log(message)
    }).catch(()=>{console.log("Study pull: unavailable.");return null;}));
  }
  return { courses, homework };
}

export async function loadHomework(username, password, ocrToken, onStudyDesk = null) {
  const snapshot = await loadUcloudSnapshot(username, password, ocrToken, { withDetails: true, onStudyDesk });
  return snapshot.homework;
}

