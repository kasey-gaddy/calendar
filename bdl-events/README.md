# BDL Events

An events calendar for Blue Diamond Legacy employees across KE&G and Maddux. Employees sign in with their employee ID and name, see only the events meant for them, RSVP, add events to Outlook, Google, or their phone, and get email or text updates when something changes. Admins post events, manage the employee roster, and see who viewed, RSVP'd, and added each event, at `/admin.html`.

## Deploy

This site has server functions, so Netlify has to build it from GitHub. Drag-and-drop won't work.

- **Replacing the KE&G version in the same repo:** delete the old files in GitHub, then upload everything inside this folder so `netlify.toml` sits at the top level. Netlify redeploys on its own.
- **Starting fresh:** create a new repo, upload the contents of this folder, and import it in Netlify (Add new site > Import an existing project > GitHub).

Data from the KE&G version doesn't carry over. Events, RSVPs, and followers from it were tied to the old shared-code sign-in.

## Environment variables

| Variable | Required | What it is |
|---|---|---|
| `ADMIN_PASSWORD` | Yes | Password for `/admin.html` |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `MAIL_SENDER` | For email | Microsoft Graph app registration with `Mail.Send` application permission, and the mailbox emails come from |
| `ACS_CONNECTION_STRING`, `ACS_FROM_NUMBER` | For texts | Azure Communication Services connection string and verified sending number (`+18005551234`) |
| `SITE_URL` | No | Custom domain for links in emails, if you use one |

`EMPLOYEE_CODE` from the KE&G version is no longer used. You can delete it.

After adding or changing variables, go to Deploys > Trigger deploy > Deploy site.

## First-time setup

1. Sign in at `/admin.html`.
2. Go to **Employees** and upload your roster (Excel or CSV).
3. Check the column matches in the preview, then import.
4. Post a test event, sign in on the main page as yourself, and try it.

## Employee roster

**Upload columns.** Employee ID, first name, and last name are required. A single full-name column also works; "Last, First" and "First Last" are both understood. Optional: preferred name, company, email, mobile, division, office. Column names don't need to match exactly. The upload screen guesses, and you can change any match before importing.

**Company.** Values like "KE&G Construction," "KEG," "Maddux & Sons," and "Blue Diamond Legacy" are cleaned up to KE&G, Maddux, and BDL. If a file has no company column (for example, a Maddux-only export), choose "Company for rows without one" before importing.

**Re-uploading.**
- New IDs are added.
- Existing people are updated.
- Blank cells never erase what's already on file.
- People missing from the file are left alone.

**Leaving employees.** To block someone who's left, edit them and turn off access, or remove them. Either way their past RSVPs stay in reports.

**Leading zeros.** Excel often drops them, so 00123 and 123 are treated as the same ID.

## Sign-in

Employees enter their employee ID, first name, and last name. Matching ignores capitals, accents, spaces, hyphens, and apostrophes. The first name can be the legal first name, the first word of it ("Mary" for "Mary Ann"), or the preferred name if the roster has one. After 8 wrong tries on an ID, sign-in for that ID pauses for 15 minutes. People stay signed in for 180 days on a device.

This is lighter than a real password. Coworkers may know each other's IDs. It's fine for an events calendar but shouldn't be reused for anything sensitive.

## Who sees an event

Each event is set to one of these:
- **Everyone**
- **Certain companies:** any mix of KE&G, Maddux, and BDL
- **Invited people only:** pick from a searchable list filtered by company or division, or paste a list of IDs

Visibility controls everything: the calendar, the personal calendar feed, RSVPs, and who gets updates.

## Reports

**Per event.** Under the editor, "People" shows:
- how many can see it,
- who viewed it (and how many times),
- who RSVP'd and their guest count,
- who added it to a calendar (Outlook, Google, or phone),
- who's following updates.

Filter to "Haven't viewed" or "Haven't RSVP'd" to find people to nudge.

**Downloads.**
- **Download RSVPs as CSV** gives the RSVP list.
- **Download Excel** gives two sheets: RSVPs, and everyone with their activity.

**All events.** The Reports tab compares every event side by side, with Excel and CSV downloads. The Employees tab has its own roster download.

**Tracking limits.** A "view" is counted each time a signed-in employee opens the event. "Added to calendar" means they clicked one of the buttons; the site can't confirm they finished saving it in their calendar app.

## How updates work

- **Personal feed.** "Add all events to my calendar" gives each person their own feed link with only their events. Calendar apps check it every few hours (Google can take up to a day).
- **Single event.** The single-event buttons save a copy that doesn't update itself, so the page asks people to turn on updates.
- **What triggers an update.** Editing the time, place, cost, or name, or cancelling, notifies people following that event and people following all events who can see it. Description-only edits don't send anything unless you add a note.
- **Opting out.** Every email has a "Stop these updates" link. Texts say "Reply STOP to opt out."

## Known limits

- One shared admin password. Named admins can be added later.
- No online payment. Cost is shown only.
- No recurring events.
