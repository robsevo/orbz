# Connecting Google and Microsoft accounts (PLAN 4.2)

Orbs connects a person's Google or Microsoft account by that provider's own sign-in (OAuth with
PKCE), from the home straight to the provider. Nobody sits in between. One sign-in gives the home:

- the account's **mail**: read, with replies kept in Drafts and never sent (IMAP with the token, XOAUTH2);
- the account's **calendar**: read only (Google Calendar, or Microsoft Graph, where Teams' meetings are).

Passwords no longer work for either provider's mail:

- Outlook.com ended passwords and app passwords for IMAP on 2024-09-16, and Microsoft 365 had
  ended them before that.
- Google ended password-only IMAP and CalDAV for Workspace on 2025-03-14.

So each provider needs an **app registered with it**, and the home is given the app's client ID. Until
it has one, "Connect Google" or "Connect Microsoft" says so, and nothing starts.

Teams keeps no calendar of its own: its meetings are in the Microsoft account's Outlook calendar.
Slack keeps none either: it shows the Google or Outlook calendar it is linked to.

## Where the home reads the client IDs

Either of these works:

- `<data>/oauth-clients.json`:
  ```json
  { "google": { "id": "….apps.googleusercontent.com", "secret": "GOCSPX-…" },
    "microsoft": { "id": "00000000-0000-0000-0000-000000000000" } }
  ```
- the environment: `ORBS_GOOGLE_CLIENT_ID`, `ORBS_GOOGLE_CLIENT_SECRET` and `ORBS_MICROSOFT_CLIENT_ID`.

A desktop app's Google "secret" is not secret, which is how Google issues it for installed apps. Each
account's own refresh token is a secret: it is kept in the keychain (`account:<name>:refresh`).

## Google (Gmail and Google Calendar)

1. At console.cloud.google.com, create a project (for example "Orbs").
2. Under APIs & Services, enable the **Google Calendar API**. IMAP needs no API turned on.
3. Under Google Auth Platform:
   - Branding: the app's name and a support email.
   - Audience: External.
   - Data access: add the scopes `openid`, `email`, `https://mail.google.com/` and
     `https://www.googleapis.com/auth/calendar.readonly`.
4. Choose how it is published:
   - **Testing** works for up to 100 named test users, but their sign-ins lapse after 7 days.
   - **In production** without verification shows "Google hasn't verified this app" and allows 100
     users.
   - Past 100 users, Google's verification is needed, with a security assessment, because
     `mail.google.com` is a restricted scope.
5. Under Clients, create a client of type **Desktop app**, and copy its client ID and secret.

The sign-in comes back to `http://127.0.0.1:<port>/callback`. A desktop client accepts any loopback port.

## Microsoft (Outlook, Microsoft 365, Teams' calendar)

1. At entra.microsoft.com, go to App registrations and create a new registration (for example
   "Orbs"). For supported account types, choose **any organizational directory and personal
   Microsoft accounts**.
2. Under Authentication, add a platform of type **Mobile and desktop applications**, with the
   redirect URI `http://localhost/callback`. Microsoft matches localhost on any port.
3. Under API permissions, add these delegated permissions:
   - Microsoft Graph: `openid`, `email`, `offline_access`, `Calendars.Read`.
   - Office 365 Exchange Online (under "APIs my organization uses"): `IMAP.AccessAsUser.All`.
4. Copy the **Application (client) ID**. A public client needs no secret.

A work account's administrator may have to consent to these permissions for their organization,
and may have IMAP turned off for the mailbox.

## What is checked here, and what is not

`packages/home/test/accounts.test.ts` runs every step against stand-ins for both providers:

- the address the browser is sent to;
- PKCE;
- the state check and a refused sign-in;
- the refresh token kept and rolled;
- mail by token, with Gmail's own drafts folder;
- the calendars shown in Google, and Graph's UTC times;
- disconnecting.

A real sign-in to Google or Microsoft can only be tried once the apps above are registered.
