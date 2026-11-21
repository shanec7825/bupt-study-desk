import { loadClasses, loadHomework } from "./bupt.mjs";
import { googleAccessToken, syncGoogle, verifyGoogleReadAccess } from "./google.mjs";
import { runSyncPlan, schoolCredentials, academicCredentials } from "./sync_plan.mjs";

import { buildStudySnapshot, publishStudySnapshot } from "./study_site.mjs";

const dryRun = Deno.env.get("DRY_RUN") === "true";
const requiredGoogle = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];
async function getGoogleToken() {
  for (const key of requiredGoogle) {
    if (!Deno.env.get(key)) throw new Error("Missing required secret: " + key);
  }
  return googleAccessToken(...requiredGoogle.map(key => Deno.env.get(key)));
}
const serviceToken = Deno.env.get("BUPT_SITE_SERVICE_TOKEN");
const ingestSecret = Deno.env.get("BUPT_SITE_INGEST_SECRET");
const siteOrigin = Deno.env.get("BUPT_SITE_ORIGIN");
const autopull = !dryRun && Boolean(siteOrigin && serviceToken && ingestSecret);
let study;
let homeworkRead;
let syncReport;
let syncPassed = false;
try {
  syncPassed = await runSyncPlan({
    dryRun,
    fetchClasses: () => {
      const { user, password } = academicCredentials(key => Deno.env.get(key));
      return loadClasses(user, password);
    },
    fetchHomework: async () => {
      const { user, password } = schoolCredentials(key => Deno.env.get(key));
      homeworkRead = await loadHomework(user, password, Deno.env.get("BUPT_OCR_TOKEN"), autopull ? pending=>{study=pending;} : null);
      return homeworkRead;
    },
    checkGoogle: async () => verifyGoogleReadAccess(await getGoogleToken()),
    writeGoogle: async (classes, homework) => {
      console.log("Starting Google OAuth token exchange.");
      const token = await getGoogleToken();
      console.log("Google OAuth token exchange completed; starting Google sync.");
      syncReport = await syncGoogle(token, classes, homework);
      console.log("Sync complete (counts only): " + JSON.stringify(syncReport));
      console.log("Notice: missing/removed school items are NOT deleted or auto-completed in Google.");
    },
    log: message => console.log(message),
  });
} catch (error) {
  // Do not write upstream response objects, URLs with passwords, auth headers or tokens to logs.
  console.error("BUPT sync failed; check credentials, network, captcha, API structure and Google OAuth.");
  if (error?.message?.startsWith("Missing required secret: ")) console.error(error.message);
}
try {
  const studyData = study ? await study : null;
  const payload = buildStudySnapshot({studyData,dryRun, passed:syncPassed, homework:homeworkRead, report:syncReport,
    repository:Deno.env.get("GITHUB_REPOSITORY"), runId:Deno.env.get("GITHUB_RUN_ID"), attempt:Deno.env.get("GITHUB_RUN_ATTEMPT"), at:new Date().toISOString()});
  const sent = await publishStudySnapshot({payload,siteOrigin,serviceToken,ingestSecret});
  console.log("Study Site: " + sent + ".");
} catch {
  console.log("Study Site: failed.");
}
if (!syncPassed) Deno.exit(1);

