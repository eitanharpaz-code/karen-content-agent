# Planning Source Routing Audit

Status: audit before further implementation.

## Why This Audit Exists

The first live smoke test showed that the planning source routing flow is not reliable enough yet.

Observed issues:
- The agent said: "השבוע חסר עוד ריל אחד בגאנט" even though there appear to be many reels planned this week.
- After "לא", the agent suggested a production item that was already published.
- After selecting item 1, the next "כן" fell into an unrelated draft-confirmation flow.
- The tone feels too CRM-like and too list-driven.
- The flow may bypass the priority system we already built.

No more feature code should be added before validating the flow against real sheet data.

## Current Flow As Implemented

### 1. Trigger

User sends one of:
- בואי נשלים את השבוע
- בואי נשלים פוסט לשבוע

Controller:
- `src/controllers/whatsapp.controller.ts`
- Calls `buildCurrentWeekPlanningSourceRoutingState`
- Stores pending question:
  - `questionType: planning_source_routing`
- Sends message from `buildPlanningSourceRoutingMessage`

### 2. Planning Health Diagnosis

Source:
- `src/services/planning-health.service.ts`
- Function: `computePlanningHealthSignals`

Input:
- Gantt items from `getGanttByDateRange`

Current logic:
- Start of week = Sunday.
- Current week = Sunday through Saturday.
- Reel target = 2 organic reels per week.
- Post target = 1 organic post per week.
- Collaboration does not count as organic.
- Published / cancelled / archive statuses do not count.

Outputs:
- `current_week_missing_reel`
- `current_week_missing_post`
- `next_week_empty_or_light`

Risk:
If the message "השבוע חסר עוד ריל אחד בגאנט" is wrong, the problem is before source routing. Possible causes:
- Wrong date range.
- Wrong sheet data read.
- Wrong content type parsing.
- Reels marked as story/story 1 and not counted.
- Collaboration filtering too broad.
- Status filtering too broad.
- Wrong timezone / week boundary.
- Reading a different sheet state than expected.

### 3. Source Routing State

Source:
- `src/services/planning-source-routing-data.service.ts`
- Function: `buildCurrentWeekPlanningSourceRoutingState`

It currently pulls:
- Gantt items for current week through next week.
- Approved content not in gantt.
- Production tasks with priority/category/contentType.
- Open idea bank items.

It builds:
- `approvedUnscheduled`
- `nearReadyProduction`
- `approvedNotStarted`
- `ideaBank`

Risk:
The current exclusion only considers gantt items returned by a limited date range. This can allow content that already appeared in the gantt earlier, including published content, to appear again as near-ready production.

### 4. Source Order

Current source order:
1. Approved content not in gantt.
2. Production content close to ready.
3. Approved content not started.
4. Idea bank.
5. New idea generation.

Required rule:
Each source must match the missing content type:
- Missing reel => only reel options.
- Missing post => only post options.
- Do not offer post ideas for missing reel.
- Do not offer reel ideas for missing post.

### 5. Reply Handling

Source:
- `src/services/planning-source-routing.service.ts`
- Function: `handlePlanningSourceRoutingReply`

Current behavior:
- כן: selects first option.
- Number: selects numbered option.
- Close name: selects matching option.
- לא: moves to next source.
- Idea bank selection does not jump straight to gantt.

Known bug:
After selection, controller clears `pendingQuestion`, so the next "כן" falls into another flow.

Required behavior:
After selecting an existing approved/production item:
- Store pending state:
  - `planning_source_selected`
- Then if user says כן:
  - suggest date.
  - move to `confirm_gantt_write`.
- Do not write to gantt before final confirmation.

For idea bank:
- Do not suggest gantt date.
- Next step should be approval / content creation flow.

## Priority System Integration

Existing priority system:
- `fetchPriorityItems`
- `getAllProductionTasksWithPriority`
- `selectMorningFocus`
- `formatWhatsImportantResponse`
- Morning brief
- Afternoon reminder
- Whats important / מה דחוף

Concern:
Planning Source Routing is currently a separate user-triggered flow. It does not clearly apply the priority ordering we already built.

Required clarification:
- Planning Health can create a CTA.
- But source suggestions should not ignore production priority completely.
- Existing P0/P1/P2 urgent items must still outrank planning alerts in:
  - Morning brief
  - Afternoon reminders
  - מה דחוף

Routing source lists should probably sort by:
1. Existing priority level / readiness.
2. Content type match.
3. Not already scheduled / not published.
4. Oldest or most actionable item.

## Copy / UX Concern

Current copy is too mechanical:
- "מצאתי 5 אפשרויות"
- "אפשר לענות במספר"
- "מקור הבא"

This is acceptable for MVP testing but not final UX.

Later copy pass should make it feel more like:
- The agent is helping Karen decide.
- Not a CRM list.
- Shorter, warmer, less operational.
- Still precise enough to prevent wrong writes.

## Required Audit Against Real Sheets

Before more implementation, verify real data.

### A. Gantt Current Week

Need to inspect:
- All rows in current week.
- Date.
- Content_ID.
- Content type.
- Collaboration.
- Status.
- Name.

Questions:
- Which rows should count as organic reels?
- Which rows should not count?
- Why did the agent think one reel is missing?

### B. Approved Content Not In Gantt

Need to inspect:
- Content_ID.
- Name.
- Status.
- Content type.
- Whether already exists anywhere in gantt.

Questions:
- Which approved items should appear in source 1?
- Which should be excluded?

### C. Production Tasks

Need to inspect:
- Content_ID.
- Name.
- filmed.
- edited.
- coverReady.
- contentType.
- priority.
- whether content exists anywhere in gantt.
- whether content is published.

Questions:
- Which tasks should appear as near-ready?
- Which are already published and must be excluded?
- Which are not actually relevant to the missing type?

### D. Idea Bank

Need to inspect:
- Content_ID.
- Idea.
- Status.
- Content type.

Questions:
- Which idea-bank items should appear only after approved/production sources are exhausted?
- Do idea-bank items require approval before gantt?

## Test Matrix Needed

Create or update tests for:

1. Current week has enough reels:
   - No `current_week_missing_reel`.

2. Current week missing reel:
   - Returns `current_week_missing_reel`.

3. Reels with collaboration:
   - Do not count as organic.

4. Published rows:
   - Do not count as active need.
   - But also should not reappear as source options.

5. Production task already in gantt anywhere:
   - Must not appear in near-ready source.

6. User says לא:
   - Moves to next valid source.
   - Does not claim "לא מצאתי" if user rejected the previous source.

7. User selects number:
   - Stores selected-source pending state.
   - Does not clear context.

8. User says כן after selected source:
   - Suggests date.
   - Moves to `confirm_gantt_write`.
   - Does not write to gantt.

9. Idea bank selection:
   - Does not suggest gantt date.
   - Routes to approval/content creation next step.

10. Missing reel:
   - Never offers post ideas.

11. Missing post:
   - Never offers reel ideas.

## Current Decision

Do not add more production behavior until:
- The current week diagnosis is verified against the real gantt.
- Published/already-scheduled exclusion is fixed.
- Selected-source pending state is designed.
- Priority integration is explicitly checked.

## Revised Planning Flow - 2026-06-17

### Scope

Planning routing checks next-week Gantt coverage, not current-week readiness.

Current week readiness belongs to priority / מה דחוף.
Next week coverage belongs to planning / דיילי בריף / גאנט קדימה.

### Coverage Rules

- Weekly organic target: 2 reels + 1 post.
- Published rows count as scheduled coverage.
- Cancelled / archived rows do not count.
- Collaboration content does not count as organic coverage.
- Any content already in Gantt must not appear again as a source option.

### Trigger Copy

Avoid saying "השבוע" when checking next week.

Preferred trigger/copy:
- "בואי נבדוק את הגאנט"
- "בואי נתכנן קדימה"
- "שבוע הבא חסר..."

Old phrase "בואי נשלים את השבוע" may remain as an alias only if the response clearly says it is checking next week.

### Source Selection

The user must select content by:
- number
- content name

Do not let "כן" select the first option. It is ambiguous.

If the user answers "כן" while seeing a list, reply that they should choose a number or content name.

### Source Types

These sources can move toward scheduling:
- approvedUnscheduled
- nearReadyProduction
- approvedNotStarted

These sources cannot be scheduled directly:
- ideaBank

Idea-bank selection should route to approval / fastlane first.

### Date Flow

After selecting schedulable content:
1. Suggest an available next-week date.
2. User can approve, provide another date, choose another content, or cancel.
3. On approval, write to Gantt using the existing Gantt flow.
4. After writing, confirm the date.
5. Then ask for upload time using the existing upload-time flow.

### Rejection Flow

If user says "לא" to a proposed date, do not cancel the whole flow.

Ask:
- write another date
- choose another content
- cancel

Cancellation should use the existing "ביטול" command.

### Full Gantt Case

If next week is already full:
- Say there is no required gap.
- Offer to check the following week.
- Offer to add anyway.
- Offer to replace existing content.
- Replacement recommendation should be based on schedule/readiness/context, not the legacy priority column.

### Priority Column

The manual priority column should not drive planning decisions.

Operational ordering should be based on:
- upload date
- deadline proximity
- production readiness
- whether content is already scheduled
- whether content is organic or collaboration

Keep the column as legacy metadata for now, but do not use it as the main ranking rule.

## Gantt Scheduling Flow Map - 2026-06-18

### Two Business Flows

There are two separate business flows that both use the same technical Gantt write handler.

#### 1. Approved / Fastlane Content Scheduling

Goal: a specific content item already exists and the system asks whether to place it in the Gantt.

Flow:
1. Content is approved or created through fastlane.
2. The system suggests an available Gantt date.
3. User can approve, reject, provide another date, or cancel.
4. On approval, the system writes the item to `גאנט תוכן`.
5. After the write, the system asks for upload time.
6. If the user does not schedule now, the content still remains available through approved content / production priority.

This flow answers: "I have this content, where should it go?"

#### 2. Forward Gantt Gap Filling

Goal: next week is missing required organic coverage, such as a post or reel.

Flow:
1. Planning health detects a forward Gantt gap.
2. `מה דחוף` / Daily Brief exposes the gap with CTA: `בואי נבדוק את הגאנט`.
3. Planning routing identifies the missing type: post or reel.
4. Collaboration content does not count toward organic coverage.
5. Source order:
   - approved unscheduled content
   - near-ready production
   - approved not started
   - idea bank only as approval / fastlane source, not direct Gantt scheduling
6. After a schedulable source is selected, the flow hands off to the shared Gantt date handler.
7. The shared handler writes to Gantt and asks for upload time.

This flow answers: "There is a gap, what is the best content to fill it?"

### Shared Technical Handler

Both flows may use `gantt_write_new_date`.

Required behavior:
- `כן` confirms the suggested date.
- A valid date chooses a different date.
- A number can choose from alternatives.
- `לא` rejects only the suggested date and asks for another date / another content / cancel.
- `תוכן אחר` returns to content selection.
- `ביטול` cancels scheduling.
- On write, use `addRowToGantt`.
- After writing, ask for upload time through `gantt_upload_time`.

### Current Audit Findings

Closed:
- Planning health checks next-week coverage.
- Missing post/reel CTA uses `בואי נבדוק את הגאנט`.
- `contentType` is stored in idea bank and approved content.
- Manual data backfill is complete.
- Planning source routing now finds `WED-005` as the approved unscheduled post for the current missing-post gap.
- Planning source routing no longer repeats the same `contentId` in `approvedUnscheduled` and `approvedNotStarted`.
- Fastlane preserves `contentType` when saving directly to approved content.

Open / watch:
- Stage D is still separate:
  - P0 ready-late spam bypass decision.
  - Empty `contentId` bug.
  - Old unpublished rows creating too many P0 items.
