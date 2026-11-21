// Only fixed categories may be logged; upstream error text can contain private data.
function failureCategory(service, error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (message.startsWith("Missing required secret:")) return "configuration_missing";
  if (service === "classes") {
    if (message === "JWGL_CREDENTIALS_REJECTED") return "credentials_rejected";
    if (message === "JWGL_VERIFICATION_REQUIRED") return "verification_required";
  }
  if (service === "homework") {
    if (message.startsWith("登录失败(-3):")) return "verification_required";
    if (message.startsWith("登录失败(3):")) return "credentials_rejected";
    if (message.startsWith("登录失败(-1):") || message.startsWith("登录失败(-2):")) return "login_page_unavailable";
    if (message.startsWith("登录失败(")) return "login_failed";
  }
  if (service === "google") {
    if (message.startsWith("Google OAuth token refresh failed")) return "token_exchange_failed";
    if (message.startsWith("Google API returned") || message === "Google read access unavailable") return "api_read_failed";
  }
  return "failed";
}

export function schoolCredentials(getEnv) {
  const user = getEnv("BUPT_USER");
  const password = getEnv("BUPT_PASSWORD");
  if (!user) throw new Error("Missing required secret: BUPT_USER");
  if (!password) throw new Error("Missing required secret: BUPT_PASSWORD");
  return { user, password };
}

export function academicCredentials(getEnv) {
  const user = getEnv("BUPT_USER");
  const password = getEnv("BUPT_JWGL_PASSWORD");
  if (!user) throw new Error("Missing required secret: BUPT_USER");
  if (!password) throw new Error("Missing required secret: BUPT_JWGL_PASSWORD");
  return { user, password };
}

export async function runSyncPlan({ dryRun, fetchClasses, fetchHomework, checkGoogle, writeGoogle, log }) {
  if (dryRun) {
    let passed = true;
    for (const [name, check] of [["classes", fetchClasses], ["homework", fetchHomework], ["google", checkGoogle]]) {
      log("Dry-run " + name + ": starting.");
      try {
        const result = await check();
        if (name === "classes" || name === "homework") {
          if (!Array.isArray(result)) throw new Error("Invalid school data");
          log("Dry-run " + name + ": passed; count=" + result.length + ".");
        } else {
          log("Dry-run " + name + ": passed.");
        }
      } catch (error) {
        passed = false;
        log("Dry-run " + name + ": " + failureCategory(name, error) + ".");
      }
    }
    log("DRY_RUN=true: no changes made to Google.");
    return passed;
  }

  // Do not write any Google data unless both school sources succeeded.
  log("Starting mobile academic system fetch.");
  const classes = await fetchClasses();
  log("Mobile academic system fetch completed; starting UCloud fetch.");
  const homework = await fetchHomework();
  log("BUPT fetched: " + classes.length + " course sessions, " + homework.length + " unfinished assignments. No personal content printed.");
  await writeGoogle(classes, homework);
  return true;
}
