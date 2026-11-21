// Run on your own computer ONCE. Never run this in GitHub Actions.
const [mode, credentialsPath, repo, ...extra] = Deno.args;
if (extra.length || (mode && (mode !== "--github" || !credentialsPath || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo??"")))) {
  throw new Error("Usage: google_oauth.mjs [--github <local OAuth client JSON> <owner/repo>]");
}
const github = mode === "--github";
let clientId, clientSecret;
if (github) {
  // Read only the explicit path. Never print the JSON or errors containing it.
  try {
    const json = JSON.parse(await Deno.readTextFile(credentialsPath));
    const client = json.web;
    clientId = client?.client_id;
    clientSecret = client?.client_secret;
    if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId ?? "") ||
        !/^[A-Za-z0-9._-]+$/.test(clientSecret ?? "")) throw new Error();
  } catch {
    throw new Error("Use the downloaded Google OAuth Web application client JSON.");
  }
  let check;
  try {
    check = await new Deno.Command("gh", {
      args: ["secret", "list", "--repo", repo], stdin: "null",
      stdout: "null", stderr: "null",
    }).output();
  } catch {
    throw new Error("GitHub CLI (gh) was not available.");
  }
  if (!check.success) throw new Error("Run gh auth login with access to your sync repository.");
} else {
  clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
}

async function storeGoogleSecrets(refreshToken) {
  if (!/^[A-Za-z0-9._~+\/=\-]+$/.test(refreshToken)) {
    throw new Error("Unexpected token format");
  }
  const cli = new Deno.Command("gh", {
    args: ["secret", "set", "--repo", repo, "--env-file", "-"],
    stdin: "piped", stdout: "null", stderr: "null",
  }).spawn();
  const writer = cli.stdin.getWriter();
  try {
    await writer.write(new TextEncoder().encode(
      "GOOGLE_CLIENT_ID=" + clientId + "\n" +
      "GOOGLE_CLIENT_SECRET=" + clientSecret + "\n" +
      "GOOGLE_REFRESH_TOKEN=" + refreshToken + "\n",
    ));
  } finally {
    await writer.close();
  }
  if (!(await cli.status).success) throw new Error("GitHub secret update failed");
}
if (!clientId || !clientSecret) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET locally");
const redirect = "http://127.0.0.1:8765/callback";
const state = Array.from(crypto.getRandomValues(new Uint8Array(16)),
  x => x.toString(16).padStart(2, "0")).join("");
const params = new URLSearchParams({
  client_id: clientId, redirect_uri: redirect, response_type: "code",
  scope: "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks",
  access_type: "offline", prompt: "consent", state
});
const authURL = "https://accounts.google.com/o/oauth2/v2/auth?" + params;
const controller = new AbortController();
let finished = false;
console.log("Open this URL in YOUR browser and approve access:\n" + authURL);
console.log("The browser will return to " + redirect);
Deno.serve({ hostname: "127.0.0.1", port: 8765, signal: controller.signal,
  onListen() {} }, async req => {
  const url = new URL(req.url);
  if (url.pathname !== "/callback") return new Response("Not found", { status: 404 });
  if (finished || url.searchParams.get("state") !== state) {
    return new Response("State verification failed", { status: 400 });
  }
  finished = true;
  const code = url.searchParams.get("code");
  if (!code) {
    setTimeout(() => controller.abort(), 500);
    return new Response("Authorization not granted. No GitHub changes were made.", { status: 400 });
  }
  let receivedToken = false;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, code,
        redirect_uri: redirect, grant_type: "authorization_code"
      })
    });
    if (!tokenResponse.ok) throw new Error("HTTP " + tokenResponse.status);
    const data = await tokenResponse.json();
    if (!data.refresh_token) throw new Error("Google did not return a refresh token");
    receivedToken = true;
    if (github) {
      await storeGoogleSecrets(data.refresh_token);
      console.log("Saved Google credentials to GitHub Actions Secrets for " + repo + ".");
      console.log("Next: run Sync BUPT to Google with dry_run=true.");
    } else {
      console.log("\nGOOGLE_REFRESH_TOKEN (copy ONLY to GitHub Actions Secret):\n" + data.refresh_token);
      console.log("\nNever share this token in chat, commits, issues or workflow logs.");
    }
    setTimeout(() => controller.abort(), 500);
    return new Response("Authorization complete. Return to your local terminal.");
  } catch {
    setTimeout(() => controller.abort(), 500);
    Deno.exitCode = 1;
    console.error(receivedToken && github
      ? "Google authorization succeeded, but GitHub did not confirm all secret updates. Check gh access and rerun before syncing."
      : "OAuth token exchange failed. Check the redirect URI and OAuth client.");

    return new Response("Authorization failed, check terminal.", { status: 500 });
  }
});
