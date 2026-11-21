import { runSyncPlan, schoolCredentials, academicCredentials } from "../src/sync_plan.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

Deno.test("dry run reports only numeric source counts and never personal content", async () => {
  const logs = [];
  const ok = await runSyncPlan({
    dryRun: true,
    fetchClasses: async () => [{ title: "private-course" }, { title: "private-course" }],
    fetchHomework: async () => [{ title: "private-homework" }],
    checkGoogle: async () => {},
    writeGoogle: async () => { throw new Error("Unexpected write"); },
    log: message => logs.push(message),
  });
  assert(ok, "checks should pass");
  assert(logs.includes("Dry-run classes: passed; count=2."), "class count missing");
  assert(logs.includes("Dry-run homework: passed; count=1."), "homework count missing");
  assert(!logs.join(" ").includes("private-"), "personal content leaked");
});

Deno.test("non-array school data fails dry-run without skipping other checks", async () => {
  const calls = [];
  const ok = await runSyncPlan({
    dryRun: true,
    fetchClasses: async () => ({ unexpected: true }),
    fetchHomework: async () => { calls.push("homework"); return []; },
    checkGoogle: async () => { calls.push("google-read"); },
    writeGoogle: async () => { calls.push("google-write"); },
    log: () => {},
  });
  assert(!ok, "non-array source data must fail");
  assert(calls.join(",") === "homework,google-read", "other checks must continue without writes");
});

Deno.test("missing school secrets do not prevent a read-only Google check", async () => {
  const calls = [];
  const missingCredentials = () => schoolCredentials(() => undefined);
  const ok = await runSyncPlan({
    dryRun: true,
    fetchClasses: async () => { missingCredentials(); },
    fetchHomework: async () => { missingCredentials(); },
    checkGoogle: async () => { calls.push("google-read"); },
    writeGoogle: async () => { calls.push("google-write"); },
    log: () => {},
  });
  assert(ok === false, "missing school credentials must fail dry run");
  assert(calls.join(",") === "google-read", "Google should still be checked without writing");
});

Deno.test("dry run checks all services after a school failure, without writing or exposing errors", async () => {
  const calls = [];
  const logs = [];
  const ok = await runSyncPlan({
    dryRun: true,
    fetchClasses: async () => { calls.push("classes"); throw new Error("private-value"); },
    fetchHomework: async () => { calls.push("homework"); throw new Error("登录失败(-3): private-value"); },
    checkGoogle: async () => { calls.push("google-read"); },
    writeGoogle: async () => { calls.push("google-write"); },
    log: message => logs.push(message),
  });
  assert(ok === false, "dry run must report a failure");
  assert(calls.join(",") === "classes,homework,google-read", "all checks should run and no writes should run");
  assert(logs.some(message => message.includes("verification_required")), "captcha category missing");
  assert(!logs.join(" ").includes("private-value"), "diagnostic output leaked an exception");
});

Deno.test("normal synchronization stops without Google writes if either school source fails", async () => {
  for (const failingSource of ["classes", "homework"]) {
    const calls = [];
    try {
      await runSyncPlan({
        dryRun: false,
        fetchClasses: async () => { calls.push("classes"); if (failingSource === "classes") throw new Error("offline"); return []; },
        fetchHomework: async () => { calls.push("homework"); if (failingSource === "homework") throw new Error("offline"); return []; },
        checkGoogle: async () => { calls.push("google-read"); },
        writeGoogle: async () => { calls.push("google-write"); },
        log: () => {},
      });
      throw new Error("Expected source failure");
    } catch (error) {
      assert(error.message === "offline", "school failure must propagate");
      assert(!calls.includes("google-write"), "cannot write with incomplete school data");
    }
  }
});

Deno.test("normal synchronization writes only after both sources succeed", async () => {
  const calls = [];
  await runSyncPlan({
    dryRun: false,
    fetchClasses: async () => { calls.push("classes"); return [{ id: 1 }]; },
    fetchHomework: async () => { calls.push("homework"); return [{ id: 2 }]; },
    checkGoogle: async () => { throw new Error("not used in production"); },
    writeGoogle: async (classes, homework) => {
      assert(classes[0].id === 1 && homework[0].id === 2, "data must reach writer");
      calls.push("google-write");
    },
    log: () => {},
  });
  assert(calls.join(",") === "classes,homework,google-write", "unexpected synchronization order");
});

Deno.test("independent JWGL password is required even when UCloud password exists", () => {
  const env = {
    BUPT_USER: "test-user",
    BUPT_PASSWORD: "homework-password"
  };
  const read = key => env[key];
  const homework = schoolCredentials(read);
  assert(homework.password === "homework-password", "UCloud password should be preserved");
  try {
    academicCredentials(read);
    throw new Error("Expected missing independent secret");
  } catch (error) {
    assert(error.message === "Missing required secret: BUPT_JWGL_PASSWORD", "Wrong missing secret");
  }
  env.BUPT_JWGL_PASSWORD = "different-mobile-password";
  const mobile = academicCredentials(read);
  assert(mobile.password === "different-mobile-password", "Mobile password not selected");
  assert(homework.password !== mobile.password, "The two systems should accept separate passwords");
});

Deno.test("JWGL credentials rejection is classified without leaking password", async () => {
  const logs = [];
  const ok = await runSyncPlan({
    dryRun: true,
    fetchClasses: async () => { throw new Error("JWGL_CREDENTIALS_REJECTED"); },
    fetchHomework: async () => [],
    checkGoogle: async () => {},
    writeGoogle: async () => { throw new Error("write prohibited"); },
    log: message => logs.push(message)
  });
  assert(!ok, "Expected rejected school authentication");
  assert(logs.includes("Dry-run classes: credentials_rejected."), "Missing classification");
  assert(logs.includes("Dry-run homework: passed; count=0."), "Other sources should continue");
});
