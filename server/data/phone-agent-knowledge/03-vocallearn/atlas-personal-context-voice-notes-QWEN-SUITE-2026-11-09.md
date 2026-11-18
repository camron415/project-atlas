# Qwen 3.7 Flash suite — 9 November 2026

Same prompts, two sides. Qwen always had forced web search (`agent`) on the Virginia key. The other side is what Kept or Atlas does now: Luna (`gpt-4.1-mini`) or Grok 4.3, and search only when that route already turns it on. Live Grok in the apps was not changed.

Clock given to Kept prompts: Monday, November 9, 2026, America/Denver.

## The list

| Id | Kind | Prompt | Today |
| --- | --- | --- | --- |
| easy-capital | General, easy | Capital of Japan, one sentence | Luna, search off |
| medium-interest | General, medium | Compound interest for a 12-year-old, four sentences | Luna, search off |
| hard-bill | General, hard | $30 plan, half-price second line, 10% tax | Grok, search off |
| hard-logic | General, hard | All bloops are razzies; all razzies are lazzies | Grok, search off |
| atlas-amazon | Atlas call | Release-day Amazon delivery window, Mountain Time | Grok, spoken, search off |
| atlas-next | Atlas call | Next test after hint generation is in the harness | Grok, spoken |
| atlas-words | Atlas call | Word count of the previous user line (14 words) | Grok, spoken |
| atlas-cheap | Atlas call | Is a cheap flash model enough if a harness checks facts | Grok, spoken |
| edu-sky | Kept harness | why is the sky blue | Grok, search off |
| edu-ruel | Kept harness | what is the golden ruel | Luna, search off |
| edu-bomb | Kept harness | brief history of the atomic bomb and nuclear energy | Grok, search off |
| live-ice | Kept harness | best ice cream in Salt Lake City | Grok, search on |
| live-byu | Kept harness | when is the next BYU game | Luna, search off, qualifier line |
| live-nintendo | Kept harness | Nintendo events this week | Grok, search on |
| kitchen | Kept harness | How do I make carbonara? | Luna, search off |
| live-weather | Kept harness | weather in Denver today | Luna, search off, qualifier line |

## Latency

Qwen first token was **0.69–1.01s** on 15 of 16. Denver weather, the one call that clearly used live pages, was **3.21s**.

Luna first token was **0.76–1.95s**. Grok first token was **2.4–5.7s**, and the ice-cream search was **12.9s** to the first token.

## Quality

| Id | Qwen | Current path |
| --- | --- | --- |
| easy-capital | Tokyo | Tokyo |
| medium-interest | Right idea, a bit long | Right idea, tighter |
| hard-bill | **$49.50**, steps shown | **$49.50** |
| hard-logic | Yes | Yes, with the reason |
| atlas-amazon | Guessed 6–8am | Guessed around 8am and said to check tracking |
| atlas-next | Suggested a crash test | Run the review suite |
| atlas-words | Said **6**. The line has **14** | **14** |
| atlas-cheap | Said a flash model is not enough | Said yes, the harness can catch facts |
| edu-sky | Rayleigh scattering, correct, long | Same fact, tighter |
| edu-ruel | Golden Rule, correct | Golden Rule, correct |
| edu-bomb | Fission, Manhattan Project, correct start | Same, and it reached Hiroshima |
| live-ice | Salt & Straw and Ben & Jerry’s, no sources | Named Sweetaly and cited Yelp |
| live-byu | Nov 14 vs **Boise State**, 7:30pm, Mountain West | Nov 14 vs **Boise State** |
| live-nintendo | No Direct this week, guessed a holiday sale | **Pikmin 4 Switch 2 Edition, Nov 12**, with sources |
| kitchen | Eggs, guanciale, pecorino | Same |
| live-weather | Sunny, high near **71°F** | Refused and said it did not have today’s weather |

Checked after the run: BYU hosts **Baylor** on Nov 14 at **1:30pm MT**, not Boise State. Denver’s forecast high that day was about **70°F** and sunny, so Qwen’s weather was close. The Pikmin release date Grok gave is a real Nov 12, 2026 release.

## What this means

Stable questions (facts, recipes, history, the bill, the logic line) are good enough on Qwen, and the start is faster than Grok. Luna is already fast on those, so the win there is cost, not speed.

Always-on search did not replace the qualifier. Weather got better. The BYU opponent was still wrong. Nintendo this week was worse than Grok’s own search. The word-count miss is the same class of error as the earlier bad phone-bill answer: a short exact question can still fail.

Do not point Kept or Atlas at this model yet. A later pass should keep search on only for live questions, and score sports, news, and “how many” before any swap.
