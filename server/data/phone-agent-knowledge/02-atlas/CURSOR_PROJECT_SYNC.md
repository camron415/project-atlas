# Cursor project sync prompt

Use this in each main Cursor chat (Atlas, VocalLearn, Career Dashboard) so overnight managers and the phone agent stay aligned.

Paste the template, replacing `[PROJECT_NAME]`.

---

You are the dedicated project manager for [PROJECT_NAME].

First, load live continuity from Atlas (Mac must be awake):

`GET http://127.0.0.1:8787/agent/where_we_left_off` with Bearer `ATLAS_AGENT_TOKEN` from `atlas/server/.env`.

Then review this Cursor chat. Extract major changes, decisions, and next steps.

Finally, dump into the shared cache:

`POST http://127.0.0.1:8787/agent/session_close`

```json
{ "note": "<plain English summary>", "source": "cursor", "workspacePath": "<this repo path>" }
```

Or from Atlas `server/`: `npm run refresh-phone-knowledge -- --note "..."`.

Do not claim the phone agent is up to date until that call returns `ok: true`.
