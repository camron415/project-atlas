# Voice Agent Builder — Mac tool URLs (Funnel live)

Base URL: `https://macbook-air-de-camron.tail5f7dec.ts.net`

**Auth header on every tool:**
```
Authorization: Bearer 6807085e083478cf21933852993fae38
```
Content-Type: `application/json`

| Tool name | Method | Full URL | Example body |
|---|---|---|---|
| `search_context` | POST | `https://macbook-air-de-camron.tail5f7dec.ts.net/agent/search_context` | `{"query":"latest Halo VocalLearn","limit":8}` |
| `where_we_left_off` | GET | `https://macbook-air-de-camron.tail5f7dec.ts.net/agent/where_we_left_off` | _(no body)_ |
| `mark_applied` | POST | `https://macbook-air-de-camron.tail5f7dec.ts.net/agent/mark_applied` | `{"company":"Acme","role":"Junior SWE"}` |
| `generate_packet` | POST | `https://macbook-air-de-camron.tail5f7dec.ts.net/agent/generate_packet` | `{"company":"Compass","role":"Junior Frontend Developer","url":"https://..."}` |
| `write_standup_decisions` | POST | `https://macbook-air-de-camron.tail5f7dec.ts.net/agent/write_standup_decisions` | `{"summary":"...","decisions":[{"project":"vocallearn","text":"..."}]}` |
| `save_call_summary` | POST | `https://macbook-air-de-camron.tail5f7dec.ts.net/agent/save_call_summary` | `{"project":"atlas","title":"Phone standup","summary":"...","action_items":["..."]}` |

`generate_packet` writes resume/cover PDFs under `career-dashboard/public/resume-exports/applications/<date>-.../`. Only call after Camron confirms a company/role.

## Builder tool description tip
In each tool’s **Description**, add: “Do not ask the user for fields — infer from conversation. Defaults: project=atlas.”

`where_we_left_off` description: “Call at the start of any Halo/VocalLearn/status question. Returns this week’s dumps. Beats HANDOFF.md.”
`search_context` description: “Live Mac search. Prefer the `latest` field over HANDOFF/ROADMAP hits.”

After changing tools or instructions → **Publish** again.
