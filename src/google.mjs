import { isPreviousSemesterDeadline } from "./semester.mjs";
import { detailsForGoogle, mergeGeneratedTaskNotes } from "./ucloud_details.mjs";
// Minimal OAuth and Google Calendar/Tasks REST client. Mutations are idempotent.
const CALENDAR = "https://www.googleapis.com/calendar/v3";
const TASKS = "https://tasks.googleapis.com/tasks/v1";
const TZ = "Asia/Shanghai";

async function request(url, token, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });
  if (response.status === 404) return { notFound: true };
  if (!response.ok) throw new Error("Google API returned HTTP " + response.status +
    " at " + new URL(url).pathname);
  if (response.status === 204) return {};
  return response.json();
}

export async function googleAccessToken(clientId, clientSecret, refreshToken) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error("Google OAuth token refresh failed, HTTP " + response.status);
  const json = await response.json();
  if (!json.access_token) throw new Error("Google OAuth response missing access_token");
  return json.access_token;
}

// Check Calendar and Tasks read access without creating or modifying Google data.
export async function verifyGoogleReadAccess(token) {
  const calendars = await request(CALENDAR + "/users/me/calendarList?maxResults=1", token);
  if (calendars.notFound) throw new Error("Google read access unavailable");
  const lists = await request(TASKS + "/users/@me/lists?maxResults=1", token);
  if (lists.notFound) throw new Error("Google read access unavailable");
}

async function paged(url, token) {
  const all = [];
  let next = "";
  do {
    const separator = url.includes("?") ? "&" : "?";
    const response = await request(url + (next ? separator + "pageToken=" + encodeURIComponent(next) : ""), token);
    all.push(...(response.items || []));
    next = response.nextPageToken || "";
  } while (next);
  return all;
}

async function findOrCreateCalendar(token, name, marker) {
  const list = await paged(CALENDAR + "/users/me/calendarList?maxResults=250", token);
  const match = list.find(c => c.description === marker) ||
    list.find(c => c.summary === name && c.accessRole === "owner");
  if (match) return match.id;
  const calendar = await request(CALENDAR + "/calendars", token, {
    method: "POST",
    body: { summary: name, timeZone: TZ, description: marker }
  });
  return calendar.id;
}

async function findOrCreateTaskList(token, name) {
  const list = await paged(TASKS + "/users/@me/lists?maxResults=100", token);
  const match = list.find(t => t.title === name);
  if (match) return match.id;
  const result = await request(TASKS + "/users/@me/lists", token, {
    method: "POST", body: { title: name }
  });
  return result.id;
}

async function stableEventId(sourceKey) {
  const bytes = new TextEncoder().encode(sourceKey);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return "bupt" + Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

async function upsertEvent(token, calendarId, key, event) {
  const root = CALENDAR + "/calendars/" + encodeURIComponent(calendarId) + "/events";
  const id = await stableEventId(key);
  const url = root + "/" + id;
  const old = await request(url, token);
  if (old.notFound) {
    await request(root, token, { method: "POST", body: { ...event, id } });
    return "created";
  }
  // Do not rewrite unchanged events.
  const fields = ["summary", "description", "location", "start", "end", "reminders"];
  const changed = fields.some(k => JSON.stringify(old[k] ?? null) !== JSON.stringify(event[k] ?? null));
  if (!changed) return "unchanged";
  await request(url, token, { method: "PATCH", body: event });
  return "updated";
}

function eventForCourse(c) {
  return {
    summary: c.title, description: c.description, location: c.location,
    start: { dateTime: c.start + "+08:00", timeZone: TZ },
    end: { dateTime: c.end + "+08:00", timeZone: TZ },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 20 }] },
    extendedProperties: { private: { buptKey: c.sourceKey } }
  };
}

function eventForDeadline(h) {
  const end = new Date(h.due.getTime() + 5 * 60 * 1000);
  return {
    summary: "DDL · " + h.course + " · " + h.title,
    description: h.notes + (detailsForGoogle(h.detail) ? "\n\n" + detailsForGoogle(h.detail) : ""),
    start: { dateTime: h.due.toISOString(), timeZone: TZ },
    end: { dateTime: end.toISOString(), timeZone: TZ },
    reminders: { useDefault: false, overrides: [
      { method: "popup", minutes: 1440 }, { method: "popup", minutes: 60 }
    ] },
    extendedProperties: { private: { buptKey: h.sourceKey } }
  };
}

function dayOfDeadline(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return p.year + "-" + p.month + "-" + p.day;
}

export async function syncGoogle(token, courses, homework) {
  const courseCalendar = await findOrCreateCalendar(token, "北邮课程", "BUPT_SYNC_COURSES");
  const deadlineCalendar = await findOrCreateCalendar(token, "北邮作业截止", "BUPT_SYNC_DEADLINES");
  const taskListId = await findOrCreateTaskList(token, "北邮作业");
  // The school's unfinished list can still include overdue work from last term.
  // Never recreate previous-semester events/tasks after they were intentionally removed.
  const activeHomework = homework.filter(hw => !isPreviousSemesterDeadline(hw.due));

  const report = { courseEvents: {}, deadlineEvents: {}, tasks: {} };
  function inc(group, status) { report[group][status] = (report[group][status] || 0) + 1; }
  for (const course of courses) {
    inc("courseEvents", await upsertEvent(token, courseCalendar, course.sourceKey, eventForCourse(course)));
  }
  for (const hw of activeHomework) {
    if (hw.due) {
      inc("deadlineEvents", await upsertEvent(token, deadlineCalendar, hw.sourceKey, eventForDeadline(hw)));
    }
  }

  // Query complete+hidden tasks; preserve the user's checked/completed state.
  const root = TASKS + "/lists/" + encodeURIComponent(taskListId) + "/tasks";
  const existing = await paged(root + "?maxResults=100&showCompleted=true&showHidden=true", token);
  const taskMap = new Map();
  for (const task of existing) {
    const key = String(task.notes || "").match(/\[BUPT_SYNC_ID:(hw:[^\]]+)\]/)?.[1];
    if (key) taskMap.set(key, task);
  }
  for (const hw of activeHomework) {
    const old = taskMap.get(hw.sourceKey);
    const due = hw.due ? dayOfDeadline(hw.due) + "T00:00:00.000Z" : undefined;
    const title = hw.course + " · " + hw.title;
    if (!old) {
      await request(root, token, { method: "POST", body: {
        title, ...(due ? { due } : {}),
        notes: mergeGeneratedTaskNotes(hw.notes + "\n[BUPT_SYNC_ID:" + hw.sourceKey + "]", detailsForGoogle(hw.detail))
      } });
      inc("tasks", "created");
    } else {
      const oldDay = old.due ? old.due.slice(0, 10) : undefined;
      const newDay = due ? due.slice(0, 10) : undefined;
      // Repair only the original generated placeholder, retaining all user-added notes.
      const generatedMarker = "[BUPT_SYNC_ID:" + hw.sourceKey + "]";
      const repairNotes = hw.course !== "未知课程" &&
        String(old.notes || "").includes(generatedMarker) &&
        /^课程：未知课程(?:\r?\n|$)/.test(String(old.notes || ""));
      const repaired = repairNotes
        ? String(old.notes).replace(/^课程：未知课程/, "课程：" + hw.course)
        : String(old.notes || "");
      // Update only the bounded, clearly marked generated detail section.
      // Personal text outside it, status, and task identity are preserved.
      const updatedNotes = repaired.includes(generatedMarker)
        ? mergeGeneratedTaskNotes(repaired, detailsForGoogle(hw.detail)) : repaired;
      const notes = updatedNotes !== String(old.notes || "") ? updatedNotes : undefined;
      if (old.title === title && oldDay === newDay && notes === undefined) {
        inc("tasks", "unchanged"); continue;
      }
      const patch = { title };
      if (due) patch.due = due;
      if (notes !== undefined) patch.notes = notes;
      // Never alter the user's completion status or overwrite personal note additions.
      await request(root + "/" + encodeURIComponent(old.id), token, { method: "PATCH", body: patch });
      inc("tasks", "updated");
    }
  }
  return report;
}
