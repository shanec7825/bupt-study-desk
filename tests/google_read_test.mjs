import { verifyGoogleReadAccess } from "../src/google.mjs";

Deno.test("Google verification uses only authenticated GETs for calendar and tasks", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), method: init.method, headers: init.headers });
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };
    await verifyGoogleReadAccess("test-token");
    if (requests.length !== 2 || requests.some(req => req.method !== "GET")) throw new Error("Expected two read-only requests");
    if (!requests[0].url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList") ||
        !requests[1].url.startsWith("https://tasks.googleapis.com/tasks/v1/users/@me/lists")) throw new Error("Unexpected endpoints");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Google verification does not treat missing calendar API as success", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("", { status: 404 });
    let failed = false;
    try { await verifyGoogleReadAccess("test-token"); } catch { failed = true; }
    if (!failed) throw new Error("Expected a missing endpoint to fail verification");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
