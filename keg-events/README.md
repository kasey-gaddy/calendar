# KE&G Events

An employee-only event calendar. Employees browse events, RSVP, add events to Outlook, Google, or their phone, and sign up for email or text updates when an event changes. Admins post and edit events at `/admin.html`.

## What's in here

- `public/index.html`: the calendar employees see
- `public/admin.html`: where you post and edit events
- `public/manage.html`: the page behind "Cancel your RSVP" and "Stop these updates" links in emails and texts
- `netlify/functions/`: the back end (events, RSVPs, updates, calendar feed)
- `netlify/lib/`: shared code, including email through Microsoft Graph and texts through Azure Communication Services

Data is stored in Netlify Blobs. There's no database to set up.

## Deploy (GitHub, not drag and drop)

This site has server functions and one npm package, so Netlify has to build it. Drag-and-drop deploys skip that step and the API won't work.

1. Create a repo in the `kasey-gaddy` org, for example `keg-events`.
2. Unzip this folder. In the repo, use **Add file > Upload files** and drag in everything inside it, keeping the folder structure: `netlify.toml`, `package.json`, `README.md`, `public/`, `netlify/`. Commit.
3. In Netlify, choose **Add new site > Import an existing project > GitHub** and pick the repo. The settings come from `netlify.toml`, so you don't need to change anything. Deploy.
4. Add the environment variables below under **Site configuration > Environment variables**, then choose **Deploys > Trigger deploy** so they take effect.

## Environment variables

Required:

| Variable | What it is |
|---|---|
| `ADMIN_PASSWORD` | Password for `/admin.html`. Use something long. |
| `EMPLOYEE_CODE` | The code employees enter to see the calendar. It's also part of the calendar subscription link, so changing it breaks existing subscriptions. |

Email (Microsoft Graph):

| Variable | What it is |
|---|---|
| `GRAPH_TENANT_ID` | Your Entra tenant ID |
| `GRAPH_CLIENT_ID` | App registration client ID |
| `GRAPH_CLIENT_SECRET` | App registration client secret |
| `MAIL_SENDER` | Mailbox the emails come from, for example `events@kegtus.com` |

Texts (Azure Communication Services):

| Variable | What it is |
|---|---|
| `ACS_CONNECTION_STRING` | From the ACS resource, under Keys |
| `ACS_FROM_NUMBER` | Your verified sending number in `+18005551234` format |

Optional: `SITE_URL` if you put the site on a custom domain and want links in emails to use it. Netlify's primary URL is used otherwise.

If email or text settings are missing, the site still works. Those messages are skipped, and the admin page shows a warning.

## Email setup (Microsoft Graph)

1. In Entra ID, create an app registration (or reuse the one from the 90-day review system).
2. Under **API permissions**, add Microsoft Graph **Application** permission `Mail.Send` and grant admin consent.
3. Create a client secret.
4. Recommended: limit the app to the sender mailbox with an Exchange application access policy, so it can't send as anyone else.

## Text setup (Azure Communication Services)

Reuse the ACS resource and number from the 90-day review system if that registration is done. US texting needs a verified toll-free number or a registered 10DLC number before carriers deliver messages. ACS handles STOP replies automatically for toll-free numbers.

## How updates work

- **Calendar subscription.** "Add all events to my calendar" gives people a feed link. Their calendar app checks it for changes on its own. Apple and Outlook check every few hours. Google can take up to a day.
- **Single event.** The Outlook, Google, and phone buttons save a copy of one event. Copies don't update themselves, which is why the page asks people to turn on updates.
- **Change notices.** When you save an edit, people following that event (and anyone following all events) get an email or text if the time, place, cost, or name changed, or if you cancel it. Changes to the description alone don't send anything, unless you add a note.
- **RSVPs** turn on updates by default. Cancelling an RSVP turns them off.
- Every email has a "Stop these updates" link. Every text says "Reply STOP to opt out."

## Admin notes

- **Cancel event** keeps the event on the calendar marked as cancelled and notifies people. **Delete** removes it quietly, along with its RSVPs. Use cancel when people need to know.
- A new event can be announced to everyone following all events. The checkbox is off by default.
- "People" under the editor shows RSVPs, headcount with guests, who's following, and what happened with the last update. You can download RSVPs as a CSV.
- All times are Arizona time (no daylight saving). An event with a start time but no end time is treated as one hour long in calendar apps.

## Known limits

- The employee code is a shared password, not individual sign-in. Anyone with the code can see the calendar. Entra ID sign-in can be added later if needed.
- There's no online payment. The cost is shown on the event only.
- There are no recurring events. Post each one separately.
