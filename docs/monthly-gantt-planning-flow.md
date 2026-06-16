# Monthly Gantt Planning Flow

Status: planning document. This file does not change runtime behavior.

## Goal

Add a Planning Health layer above the existing priority queue.

The current priority queue answers: from the content already scheduled or in production, what needs action now?

Planning Health answers: is the gantt itself healthy, what is missing this week or next week, and where should Karen continue from.

## Content Targets

- 2 organic reels per week.
- 1 organic post every 7-10 days.
- A post can be a carousel or a regular static post.
- Prefer variation between carousel and regular post when possible.
- Collaborations do not count toward the organic content quota.
- Collaborations still belong in the gantt, but on a separate path.
- Do not require a full month to be planned at once.
- At the start of a month, build at least the first week.
- Near the end of a month, remind Karen to start planning the next month.

## Planning Health Signals

- current_week_missing_reel: current week has fewer than target organic reels.
- current_week_missing_post: current or near 7-10 day window is missing an organic post.
- next_week_empty_or_light: next week is empty or too light.
- approved_content_without_gantt: approved content exists but is not scheduled.
- end_of_month_next_month_not_started: next month has not been started near month end.
- start_of_month_first_week_missing: first week is not planned at month start.
- collab_pending_context: a collaboration exists but posting mode is unclear.

## Priority Order

1. Active P0.
2. Overdue upload decision.
3. P1-P2.
4. Critical Planning Health.
5. P3-P4.
6. Regular Planning Health.
7. Regular PLANNING.

Planning Health must not outrank active P0, overdue upload decisions, or P1/P2 production work.

## Morning Brief

Morning stays short.

If execution priority exists, execution remains the main focus and at most one Planning Health signal appears as background.

If no active P0/P1 exists and a critical planning gap exists, Planning Health may become the main focus.

Example background copy:
- ברקע: השבוע חסר עוד ריל אחד בגאנט.
- אפשר לכתוב: בואי נשלים את השבוע

## Afternoon Reminder

Afternoon remains short.

Order:
1. Ready P0 due today and not confirmed uploaded.
2. First-day overdue upload decision when no interaction happened.
3. Planning Health only when no stronger reminder exists.
4. Do not send planning reminders if Karen already discussed planning or gantt that day.

## "מה דחוף"

This is the best place for a broader view.

It should include execution priorities, overdue decisions, and Planning Health in the correct order.

It should still end with one clear next action and natural reply options.

## Planning Source Routing

When a planning gap exists, route Karen to the next useful source:

1. Approved content without gantt.
2. Production content close to ready.
3. Idea bank.
4. New ideation.
5. Collaboration clarification.

The agent should not only say that something is missing. It should also guide Karen to the next source of action.

## User Reply Endpoints

Every CTA suggested by the agent should also work proactively when Karen asks.

Examples:
- מה חסר בגאנט השבוע?
- מה חסר לשבוע הבא?
- מה חסר לחודש?
- מה מאושר ולא שובץ?
- שבצי את [שם] ל-[תאריך]
- בואי נשלים את השבוע
- בואי נשלים את השבוע הבא
- תראי לי רעיונות לריל
- תראי לי רעיונות לפוסט
- בואי נחשוב על רעיונות לריל
- מה הכי קרוב להיות מוכן?
- מה צריך צילום?
- מה צריך עריכה?
- זה קולאב
- בית העסק מעלה
- קרן מעלה
- זה שת"פ

CTA copy needs a dedicated copy pass before final implementation.

## Data Requirements

MVP should use existing sheets:
- גאנט תוכן
- תכנים שאושרו
- משימות הפקה
- בנק רעיונות

No new sheet is required for MVP.

Future optional fields:
- weekly reel target
- post cadence
- preferred days
- post subtype: carousel or regular post
- collaboration posting mode

## MVP Scope

Included:
- detect missing reel this week
- detect missing post in current or near window
- detect next week empty or light
- route to approved content, production, or idea bank
- show short morning signal
- show afternoon signal only when nothing more urgent exists
- integrate into "מה דחוף"
- never write to gantt without Karen confirmation
- never write to gantt without a real content_id

Not included:
- fully automatic monthly scheduling
- complex day/time optimization
- new settings sheet
- full collaboration management

## Tests Needed

- week with 2 reels and a post has no planning alert
- week missing reel has a planning alert
- week missing post has a planning alert
- next week empty/light has a planning alert
- collaboration does not count toward organic quota
- active P0 outranks planning
- overdue upload decision outranks planning
- P1/P2 outrank planning
- critical planning outranks P3/P4
- morning shows at most one planning signal
- afternoon planning is suppressed when a stronger reminder exists
- "מה דחוף" includes Planning Health in the correct order
- agent does not write gantt without confirmation
- agent does not write gantt without usable content_id
