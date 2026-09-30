#!/usr/bin/env node
// One-time helper: obtains a Google OAuth refresh token with read-only
// Calendar scope, for GOOGLE_REFRESH_TOKEN.
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-refresh-token.mjs
//
// The OAuth client must be of type "Desktop app". Keep the consent screen's
// publishing status on "In production": in "Testing", Google expires refresh
// tokens after 7 days.
import http from "node:http";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");
  process.exit(1);
}

const server = http.createServer();
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    access_type: "offline",
    prompt: "consent",
  }).toString();
  console.log(`Open this URL and approve access:\n\n${url}\n`);

  server.on("request", async (req, res) => {
    const code = new URL(req.url, redirectUri).searchParams.get("code");
    if (!code) {
      res.writeHead(400).end("Missing code");
      return;
    }
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const body = await tokenRes.json();
    if (!body.refresh_token) {
      res.writeHead(500).end("No refresh token returned; see terminal.");
      console.error(body);
      process.exit(1);
    }
    res.writeHead(200, { "Content-Type": "text/plain" }).end("Done. You can close this tab.");
    console.log(`GOOGLE_REFRESH_TOKEN=${body.refresh_token}`);
    server.close();
  });
});
