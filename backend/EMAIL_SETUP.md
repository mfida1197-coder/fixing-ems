Enable Gmail API in Google Cloud and create an OAuth Web application. Configure the consent screen and allow both company accounts as test users while testing; complete Google's publishing/verification requirements for production.

Google references: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send.

Runtime requirement: Node.js 20 or newer for built-in fetch and bounded Google request timeouts. No new packages are required.

Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI in the backend environment. Register the exact redirect URI ending in /api/email/oauth/callback. Keep the existing 64-hex-character ENCRYPTION_KEY stable; it encrypts stored authorizations. CORS_ORIGIN must include the actual frontend origin.

Run `node node_modules/ts-node/dist/bin.js scripts/migrate-company-email.ts`. No Chat data is deleted. Required scopes: openid, email, https://www.googleapis.com/auth/gmail.send.

In Super Admin Settings → Company Email Accounts, enter the Super Password and connect Primary, choosing Account 1 in Google's chooser. Repeat for Secondary, choosing Account 2. Refresh connection status after each authorization. Sending always uses the selected slot's server-stored authorization. Primary receives employee request notifications.
