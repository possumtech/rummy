# LME Oracle Failure Forensics

Run: 2026-04-13T22-41-45Z, model: grok, split: longmemeval_oracle
Status: IN PROGRESS

Preamble changes this run:
- Added "If unknown, affirm you don't know" (unknown affirmation)
- Added pattern search hint ("<get path=\"known://*\">John Doe</get>")
- Added cross-reference instruction ("Include the paths of related entries...")
- Consolidated redundant filing line

Judge changes this run:
- "strict evaluator" → "Does the response demonstrate knowledge of the correct answer?"
- Added "Accept mathematical equivalences and alternative phrasings"
- YES/NO → PASS/FAIL

---

## Failures

### Row 16 — temporal-reasoning, sessions=2, 63s
**Q**: How long have I been working before I started my current job at NovaTech?
**Expected**: 4 years and 9 months
**Got**: "I don't have information on your work experience before NovaTech."
**Judge**: FAIL

**Analysis**: Answer required subtracting NovaTech tenure (4y3m) from total experience (9y) stated in sessions. Model affirmed unknown instead of doing the math. Previous run also failed this row — confabulated "Memory shows total experience: 4 years 3 months" without computing prior duration.

**Category**: Computation failure (data present, inference step missed). Not addressable via prompt tuning — model capability limit on arithmetic from stated facts.

**Unknown affirmation calibration**: This was arguably correctly classified as "unknown before NovaTech" since the model didn't synthesize the computation. The unknown affirmation replaced a confabulation with a refusal — neither correct, but the refusal is more honest.

**Scope note**: Out of scope for the base memory system. Rummy provides folksonomic storage and retrieval; deterministic arithmetic or date math is a plugin concern. Users wanting computational reliability can register a calculator or date-diff tool via the plugin architecture.

### Row 46 — temporal-reasoning, sessions=2, 48s
**Q**: Who did I meet first, the woman selling jam at the farmer's market or the tourist from Australia?
**Expected**: the woman selling jam at the farmer's market
**Got**: "You met the tourist from Australia first (mentioned in early anecdotes during Sydney trip planning). The jam seller was at the farmers market on Saturday (recent, second session)."
**Judge**: FAIL

**Analysis**: Previous run retrieval failure ("No info on meetings or sequence") turned into a temporal-reasoning error. The model found both entries via pattern search but got the chronology backwards. This is progress on the retrieval axis — the cross-linking/pattern-search worked — but hit the model's temporal inference ceiling.

**Category**: Temporal reasoning (model capability limit). Retrieval succeeded.

**Scope note**: Out of scope. Date comparison is a plugin concern.

### Row 53 — temporal-reasoning, sessions=2, 38s
**Q**: How many days had passed between the day I bought a gift for my brother's graduation ceremony and the day I bought a birthday gift for my best friend?
**Expected**: 7 days. 8 days also acceptable.
**Got**: "Brother's gift: 2023-03-08. No record of best friend's birthday gift date."
**Judge**: FAIL

**Analysis**: Model found brother's gift date but not best friend's. Either a retrieval miss or the data genuinely wasn't in the promoted entries. Did not attempt pattern search to locate best friend's gift date. The unknown affirmation is honest given what the model had in context, but missed the opportunity to search harder.

**Category**: Retrieval/search incompleteness — could benefit from a more aggressive "search before affirming unknown" prompt discipline.

### Row 60 — multi-session, sessions=3, 88s
**Q**: How many items of clothing do I need to pick up or return from a store?
**Expected**: 3
**Got**: "2: larger Zara boots (pickup), smaller Zara boots (return)."
**Judge**: FAIL

**Analysis**: First multi-session failure. Model aggregated across 2 of 3 sessions but missed a third clothing item. Either filed and then demoted too aggressively, or the third item was filed without a clothing-related path. Confident answer with specific details — not a search failure, more like an incomplete aggregation.

**Category**: Multi-session synthesis (partial) — the hard case cross-linking targets. Worth examining DB to see if the missed item was filed at all.

**DB check**: The third item WAS filed. The navy blue blazer appears in `known://user-items` with "dry cleaning pending" and has its own entry `known://clothing-care/blazer-navy`. Cross-links are correct. The model missed it at answer time because "dry cleaning pending" → "needs pickup from dry cleaner = store item" is a semantic inference it didn't make. Narrow interpretation of "store" limited aggregation to explicit retail (Zara).

**Refined category**: Semantic aggregation narrowness (model capability). Retrieval and filing both succeeded. This is the model's interpretation of "store" in the question, not a memory system fault.

### Row 65 — multi-session, sessions=4, 101s
**Q**: How many plants did I acquire in the last month?
**Expected**: 3
**Got**: "2 (peace lily + 1 succulent, ~05/07)"
**Judge**: FAIL

**Analysis**: `known://user/plants` contains: "add basil... Snake ~1mo sister thriving... Existing: peace lily+succ(spring2023 nursery..." — so the 3 acquired plants are basil (recent), snake plant (~1mo from sister), and arguably peace lily+succulent counted together or not. Model picked the spring 2023 nursery purchase (too old) and missed basil and snake plant.

**DB check**: All plants are filed and cross-linked. The failure is at answer-time temporal filtering — "acquired in the last month" requires the model to read scattered date markers and filter correctly.

**Category**: Temporal aggregation with filter — data retrieved correctly, filter applied wrong. Could benefit from better date-structure in summaries or an acquisition-date-specific path hierarchy (e.g. `user/plants/acquired/2023-05/basil`).

### Row 74 — multi-session, sessions=5, 64s
**Q**: What is the total amount I spent on luxury items in the past few months?
**Expected**: $2,500
**Got**: "Known luxury spends: $1,200 Gucci + $800 gown = $2,000 total."
**Judge**: FAIL

**Analysis**: The model filed `known://user/luxury-total` during ingestion with its own computation: "$1,200 Gucci + $800 gown = $2,000. **No other specifics tracked**." Self-aware that accounting might be incomplete. At answer time, gave the confident $2,000 total without hedging or searching for additional items.

**DB check**: $500 item wasn't filed, meaning either ingestion missed it or the sessions used different phrasing not matched to "luxury." The model's caveat about "no other specifics" should have triggered more aggressive search.

**Category**: Confidence calibration under self-acknowledged incompleteness. The unknown affirmation pattern didn't fire because the model had *some* data — just not all of it. Worth considering prompt guidance on "if the data might be incomplete, qualify the answer."

### Row 75 — multi-session, sessions=5, 191s
**Q**: How many hours have I spent playing games in total?
**Expected**: 140 hours
**Got**: "45 hours total reported: TLOU2 (30h), Hyper Light Drifter (5h), Celeste (10h). No other playtimes recorded."
**Judge**: FAIL

**Analysis**: Same pattern as row 74. Model confidently aggregated 3 games' playtimes (45h) while explicitly noting "No other playtimes recorded." 95 hours of gaming data either not filed during ingestion or not surfaced at answer time. Sessions=5 suggests multiple ingestion sessions with playtime data that wasn't fully captured.

**Category**: Incomplete aggregation with self-acknowledged uncertainty — confident total despite meta-awareness of gaps.

### Row 82 — multi-session, sessions=4, 74s
**Q**: How many properties viewed before Brookside townhouse offer?
**Expected**: 4 (bungalow, Cedar Creek, 1-bed condo, 2-bed condo)
**Got**: "2 properties: Cedar Creek (Feb 1, out of budget) and 2-bed condo (Feb 15, rejected Feb 17)."
**Judge**: FAIL

**Analysis**: Aggregation undercount — model captured 2 of 4 properties. The bungalow and 1-bed condo weren't surfaced. Same incomplete-aggregation pattern.

### Row 84 — multi-session, sessions=3, unclear time
**Q**: Hours of jogging and yoga last week?
**Expected**: 0.5 hours
**Got**: "0 hours, based on logged data."
**Judge**: FAIL

**Analysis**: Model said 0 hours. Expected 0.5. Short exercise session missed or not filed with fitness tags.

### Row 86 — multi-session, sessions=4, 123s
**Q**: Which grocery store did I spend the most money at in the past month?
**Expected**: Thrive Market
**Got**: "Walmart ($120 on 2023-05-16)"
**Judge**: FAIL

**Analysis**: Picked single large Walmart trip over Thrive Market (likely multiple trips aggregating to more). Another aggregation failure — didn't sum across multiple Thrive Market visits.

### Row 87 — multi-session, sessions=3, 52s
**Q**: How much more did I spend on accommodations per night in Hawaii compared to Tokyo?
**Expected**: $270
**Got**: "Maui: >$300/night. Tokyo cost unknown; difference can't be calculated."
**Judge**: FAIL

**Analysis**: Found Hawaii accommodation cost, reported Tokyo as unknown. Either Tokyo cost wasn't filed or wasn't surfaced via pattern search. Model correctly declined the subtraction since it lacked one operand — but didn't search harder for Tokyo cost.

### Row 99 — multi-session, sessions=5, 182s
**Q**: How many musical instruments do I currently own?
**Expected**: 4 (Strat, Yamaha acoustic, Pearl drums, Korg piano)
**Got**: "5 instruments: 2 guitars, piano, drums set, ukulele."
**Judge**: FAIL

**Analysis**: Over-count (most aggregation failures under-counted). Model included a ukulele that shouldn't have been in the "currently own" set. Either the sessions mentioned a ukulele in a non-ownership context (e.g., gifted to someone, sold, desired) or the model hallucinated. First over-count of the run.

### Row 102 — multi-session, sessions=3, unclear time
**Q**: Days in December participating in faith-related activities?
**Expected**: 3
**Got**: 2
**Judge**: FAIL

**Analysis**: Off-by-one under-count, like rows 60, 65, 74, 75, 82.

### Row 103 — multi-session, sessions=3
**Q**: How many kitchen items did I replace or fix?
**Expected**: 5 (faucet, mat, toaster, coffee maker, shelves)
**Got**: "4: toaster oven (replace), faucet (replace), shelves (fix), coffee maker (replace)."
**Judge**: FAIL

**Analysis**: Off-by-one. Missed the kitchen mat. Same pattern.

### Row 108 — multi-session, sessions=3, 94s
**Q**: How many rare items do I have in total?
**Expected**: 99
**Got**: "100 rare items total: 5 books + 1 vase + 25 coins + 12 figurines + 57 records."
**Judge**: FAIL

**Analysis**: Math is correct (5+1+25+12+57=100). One of the subtotals is off by 1 — likely filed one extra item during ingestion. Interesting case: aggregation was thorough, subtotal was slightly wrong.

### Row 111 — multi-session, sessions=2, short
**Q**: How many online courses have I completed in total?
**Expected**: 5
**Got**: "Exact total unknown: some Coursera + 2 edX."
**Judge**: FAIL

**Analysis**: Unknown affirmation triggered when a specific number was expected. The model declined to count rather than searching harder for Coursera count. Could indicate the unknown knob is slightly too aggressive, or data was ambiguous.

### Row 114 — multi-session, sessions=3, 82s
**Q**: How many total pieces of writing completed since starting three weeks ago?
**Expected**: 23
**Got**: "22 total: 17 poems + 5 short stories (challenge likely included)."
**Judge**: FAIL

**Analysis**: Off-by-one. Same pattern.

### Row 120 — multi-session
**Q**: Days traveling in Hawaii and Seattle total?
**Expected**: "Not enough. Hawaii was 10 days but Seattle wasn't mentioned."
**Got**: "Don't know Hawaii or Seattle trip durations from records."
**Judge**: FAIL

**Analysis**: Unknown affirmation fired, but too tersely. Model said "don't know either" instead of acknowledging Hawaii was known (10 days) and Seattle was missing. Judge rejected for completeness, not correctness.

### Row 121 — multi-session
**Q**: Years in formal education HS to Master's?
**Expected**: "Not enough. You mentioned HS (4), PCC (2), UCLA (4) but didn't mention Master's"
**Got**: "No Master's completed per records. HS to BS: 10 years (2010-2020)."
**Judge**: FAIL

**Analysis**: Same pattern — unknown affirmation fired, answer was substantively correct but more terse than expected. Judge too strict on format.

### Row 123 — knowledge-update, sessions=2
**Q**: How many Korean restaurants tried?
**Expected**: four
**Got**: "3 Korean restaurants"
**Judge**: FAIL

**Analysis**: Off-by-one aggregation.

### Row 135 — knowledge-update, sessions=2
**Q**: How many engineers at new role start + now?
**Expected**: "4 engineers at start, 5 now"
**Got**: "Unknown when started; now lead 5 engineers (group of 6 total)."
**Judge**: FAIL

**Analysis**: Got the "now" number (5) correctly, declined on "at start." Partially correct but judge rejected whole.

### Row 168 — knowledge-update, sessions=2
**Q**: Where planning to stay for birthday trip to Hawaii?
**Expected**: Oahu
**Got**: "No stay/accommodation info in memory for Hawaii birthday trip."
**Judge**: FAIL

**Analysis**: Retrieval/search failure. Either not filed or not located.

### Row 171 — knowledge-update, sessions=2, 65s
**Q**: Previous personal best time for charity 5K?
**Expected**: 27 minutes 45 seconds
**Got**: "26:30"
**Judge**: FAIL

**Analysis**: Wrong fact — different time than expected. Model retrieved a time but not the correct one. Either the sessions mentioned multiple times and model picked wrong, or hallucinated.

### Row 182 — knowledge-update, sessions=2
**Q**: Vehicle model currently working on?
**Expected**: Ford F-150 pickup truck
**Got**: "Ford Mustang Shelby GT350R scale model."
**Judge**: FAIL

**Analysis**: Knowledge-update failure — question asks about *current* state but model answered with earlier/previous project. Either cross-linking didn't update, or model didn't use turn attributes to prefer fresher information. The preamble says "prefer more recent information if conflicts exist" but that instruction didn't fire here.

### Row 193 — knowledge-update, sessions=2
**Q**: How many engineers do I lead when I just started my new role as Software Engineer Manager?
**Expected**: Not enough — mentioned "Senior Software Engineer" not "Software Engineer Manager"
**Got**: "You lead 5 engineers."
**Judge**: FAIL

**Analysis**: Trick question (role mismatch). Model confabulated an answer instead of catching the mismatched role title. Unknown affirmation should have fired.

### Row 199 — knowledge-update, sessions=2, 105s
**Q**: Where do I currently keep my old sneakers?
**Expected**: in a shoe rack in my closet
**Got**: "In closet, taking up space (per 05/26; planned shoe rack 05/26-27)."
**Judge**: FAIL

**Analysis**: Close miss. Got "closet" correct but added "taking up space" and noted "planned shoe rack" as future. Expected answer conflated the rack as current. Either the sessions didn't disambiguate when the rack was installed, or model didn't use turn/date to pick latest state.

## Single-Session-Preference Block — Systematic Mismatch

Starting at row 200, the question type changes to "preference characterization" — the expected answer is a narrative of what the user would prefer, not a recall of facts.

### Rows 202, 203, 207 — single-session-preference, sessions=1
**Examples**:
- Row 202 Q: "Recommend recent publications?" Expected: narrative "The user would prefer AI-in-healthcare papers, specifically deep learning medical imaging". Got: "Medical AI pubs/confs recommendations registered" (status)
- Row 203 Q: "Suggest a Miami hotel?" Expected: narrative "User prefers hotels with ocean views, rooftop pools". Got: "No Miami hotel info in memory" (unknown affirmation)
- Row 207 Q: "Kitchen cleaning tips?" Expected: narrative tying to user's specific setup. Got: generic cleaning tips.

**Analysis**: The rummy preamble optimizes for filing and retrieving facts. It doesn't train the model to articulate user preferences back from a session. The model ingests the user's preferences as facts, then when asked "what would you recommend?" it responds as an assistant (with recommendations) rather than as a profiler (with characterizations).

**Category**: Task-type mismatch. The benchmark is testing preference articulation; the system is designed for memory. Separable capability — not addressable through memory improvements.

### Rows 217, 220, 221, 224, 225, 228, 229 — more single-session-preference failures
Continuing pattern. Model gives helpful advice/recommendations; judge expects narrative preference characterization.

### Rows 232, 233 — single-session-assistant block begins (new mismatch?)
- Row 232: "I'm going back to our previous conversation about the children's book" — asks about specific session detail, model said "unknown"
- Row 233: "I was wondering if you could recommend a restaurant in Orlando" — model gave single recommendation

**Analysis**: Single-session-assistant tests whether the model can recall/reconstruct specific details from the session. Some of these may be genuine retrieval failures. Row 232 specifically asked about a Plesiosaur's color from a children's book image — possibly requires deep single-session recall the model missed.
