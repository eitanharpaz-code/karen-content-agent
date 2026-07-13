# Karen Content Agent — Master Handoff

עודכן: 12.7.2026
מסמך זה הוא המקור היחיד והקובע. הוא מחליף את כל גרסאות ה-Handoff הקודמות (כולל NEW_..._FINAL_2026-06-15_UPDATED_2026-06-20_FIXED.docx). ההיסטוריה המפורטת של סשנים ישנים נמצאת בגיט ובמסמכי docs/ — לא כאן. במקרה של סתירה: הקוד העדכני קובע.

## ויז'ן

יוצרת תוכן מתעוררת בבוקר, פותחת וואטסאפ, והסוכן כבר יודע מה יש לה, מה תקוע, מה צריך לקרות היום — בלי שהיא תפתח גיליון אחד. לטווח ארוך: כלי למנהלי סושיאל מרובים, כל אחד מנהל גאנט ותכנים עצמאי דרך וואטסאפ בלבד. הממשק הוא WhatsApp; Google Sheets הוא הזיכרון.

**שלב נוכחי:** קרן כפכפי היא הפיילוט הראשון, עובדת עם הכלי ביומיום.

## Stack טכני

- Node.js + TypeScript + Express
- Twilio WhatsApp Sandbox
- Claude API — שני מודלים: `CREATIVE_MODEL` (ברירת מחדל claude-sonnet-4-5) ליצירה/עריכה, `CLASSIFIER_MODEL` (ברירת מחדל claude-haiku-4-5) לסיווג ו-matching
- Google Sheets API — Service Account
- ngrok לטסטינג מקומי
- GitHub: eitanharpaz-code/karen-content-agent

## להפעלה

```
# טרמינל 1
npm run dev
# טרמינל 2
ngrok http 3000
```
לעדכן את ה-URL ב-Twilio Console → Sandbox settings → "When a message comes in": `https://YOUR-NGROK-URL/webhook/whatsapp`

**דיפלוי (מצב MVP):** אין סביבת production. הסוכן רץ מקומית על המחשב של איתן דרך ngrok בלבד — כשהמחשב/ngrok כבויים, הסוכן לא זמין לקרן וה-Daily Brief לא נשלח. אחסון אמיתי (Railway/Render/VPS) הוא תנאי מקדים ל-multi-user, לא לפני.

## משתני סביבה

חובה: `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`
מודלים (אופציונלי): `ANTHROPIC_MODEL`, `ANTHROPIC_CLASSIFIER_MODEL`, `ANTHROPIC_MATCHING_MODEL`
Daily Brief: `DAILY_BRIEF_ENABLED`, `DAILY_BRIEF_MORNING_TIME`, `DAILY_BRIEF_AFTERNOON_TIME`, `DAILY_BRIEF_TIMEZONE` (Asia/Jerusalem), `DAILY_BRIEF_TO`
אחר: `PORT`, `PENDING_STATE_TTL_MS` (ברירת מחדל 3 שעות), `ALLOW_LIVE_QA`, `ALLOW_PRODUCTION_TIMESTAMPS_MIGRATION`

## מבנה קבצים

```
src/
├── controllers/
│   └── whatsapp.controller.ts      ← ניתוב כל הודעה (~3,500 שורות; שינויים רק בסקריפט מאומת)
├── services/
│   ├── claude.service.ts           ← askClaude (persona אופציונלית) + askClaudeForMatching + פיצול מודלים
│   ├── content.service.ts          ← יצירת/עריכת דראפטים + parsePreviewCopy (עטיפת preview)
│   ├── confirmation.service.ts     ← דראפטים ושאלות ממתינות (עם TTL), parsing פקודות, Fast Lane
│   ├── sheets.service.ts           ← כל הגישה לגיליון + 4 פונקציות matching (דרך askClaudeForMatching)
│   ├── whatsapp.service.ts         ← שליחת Twilio (safeSendWhatsAppMessage)
│   ├── visibility.service.ts       ← שאילתות קריאה + מסווג AI (עם skipAI gate)
│   ├── production-status.service.ts← עדכוני הפקה + isDeadlineUpdate
│   ├── priority.service.ts         ← מנוע תעדוף משותף P0–P4 + PLANNING
│   ├── daily-brief.service.ts      ← Morning Brief / Afternoon Reminder
│   ├── scheduler.service.ts        ← node-cron ושליחה יזומה
│   ├── planning-health.service.ts / planning-source-routing*.ts ← בריאות תכנון ומסלול מקורות
│   ├── overdue-decision.service.ts ← החלטות overdue
│   ├── conversation-intent.service.ts ← סיווג intent (Haiku, בלי persona) + תגובות שיחה
│   ├── conversation-memory.service.ts ← היסטוריית שיחה לפרומפטים
│   ├── brief-humanizer.service.ts / response-humanizer.service.ts ← ניסוח פרסונה (ראו כללים)
│   ├── fuzzy-match.service.ts      ← התאמה מקומית ללא Claude
│   ├── persistence.service.ts      ← Stage G: כתיבה אטומית ל-data/agent-state.json
│   └── routing-trace.service.ts    ← שורת אבחון אחידה לכל הודעה
├── utils/  (conversation-utils, date-utils)
├── types/  (content, confirmation, production-status, claude-context)
├── test/   (~90 קבצי QA)
└── prompts/system-prompt.md        ← פרסונה; מצורף רק לקריאות creative
scripts/export-code-context.cjs     ← ייצוא מסמך קונטקסט (ראו "פתוח")
data/agent-state.json               ← state פרסיסטנטי (שורד restart)
```

## Google Sheets — מבנה (7 טאבים, אומת מול הגיליון החי 12.7.2026)

- **בנק רעיונות**: A=Content_ID, B=רעיון, C=סיכום, D=קטגוריה, E=טון רגשי, F=רמת עדיפות, G=דורש יום צילום?, H=שת"פ/חסות, I=סטטוס, J=הערות, K=timestamp, L=סוג תוכן
- **תכנים שאושרו**: A=Content_ID, B=שם התוכן, C=סיכום, D=קטגוריה, E=טון רגשי, F=רמת עדיפות, G=סטטוס, H=שת"פ/חסות, I=הערות, J=timestamp, K=סוג תוכן. (בכותרות הגיליון בפועל יש רווחים מובילים ושגיאת כתיב "סטטוסס" — **אומת בקוד 12.7**: כל הקריאות ב-sheets.service.ts פוזיציונליות (`row[N]`), כותרות רק מדולגות ולעולם לא נקראות בשמן. תיקון הכותרת בגיליון בטוח.)
- **משימות הפקה**: A=content_id, B=שם התוכן, C=צולם, D=נערך, E=קאבר מוכן, F=דדליין הפקה, G=הערות, H=ready_at, I=updated_at
- **קטגוריות** (registry): category_name, prefix, created_at, notes — נטען דינמית, ממוין מהארוך לקצר נגד התנגשויות substring. **רווקות ורווקים הן שתי שורות עם prefix משותף BCH — מכוון.**
- **ציר אירועים**: EVENT_ID, תאריך, אירוע, פוטנציאל תוכן, חובה לצלם, רמת עדיפות, תוכן קשור (content_ids מופרדים בפסיקים), הערות. **הטאב קיים ומאוכלס (9 אירועים) אבל הקוד עדיין לא קורא ממנו** — חיבורו הוא משימה פתוחה.
- **רעיונות בצד** (ארכיון): Content_ID, רעיון, קטגוריה, טון רגשי, הוק/פתיח, מתאים ל..., דורש יום צילום?, רמת עדיפות, סטטוס, שת"פ/חסות, הערות, תאריך העברה לארכיון. שים לב: סכמה שונה מבנק רעיונות (עמודות הוק/מתאים ל.../תאריך העברה).
- **גאנט תוכן**: A=content_id, B=תאריך, C=יום, D=פלטפורמה, E=סוג תוכן, F=שם התוכן/קונספט, G=נושא/פרק, H=רמת עדיפות, I=סטוריז תומכים, J=שת"פ/חסות, K=סטטוס, L=שעת העלאה, M=הערות, N=תאריך ושעת העלאה. ערכי סטטוס קשיחים: טרם תוכנן, בתכנון, מוכן, בזמן אמת, פורסם, בוטל. שדות B (טווחי תאריכים באירועים), D ("אינסטגרם + טיקטוק") ו-L ("לפי עלייה", "לאורך היום") מכילים גם טקסט חופשי — לא להניח פורמט קשיח.

**קטגוריות בפועל (registry, 12.7.2026):** קפריסין=CYP, שמלות=DRS, רווקות=BCH, רווקים=BCH, על החתונה=PRW, חתונה=WED, כללי=GEN, מכבי=MKB, מסחרי=MSK, טרנד=TRD, היריון=YRY. בנוסף שתי שורות בדיקה ("בדיקה qa_...", BDY/BD2) שנכתבו ע"י QA לגיליון החי — לניקוי.
ערכים קנוניים: טון = הסברתי/מצחיק/אותנטי/השראתי/טרנדי/רגשי; עדיפות = גבוה/בינוני/נמוך; Boolean = כן/לא. (בפועל בגיליון יש גם ערכי טון חופשיים היסטוריים כמו "רומנטי ואסטטי", "יפה" — הקוד סלחני בקריאה, קנוני בכתיבה.)

## זרימות עובדות (תמצית)

רעיון חדש → דראפט → עריכה אפשרית → אישור → בנק רעיונות. אישור להפקה ("תוסיפי את X להפקה") → תכנים שאושרו + משימת הפקה. עדכוני סטטוס (צולם/נערך/קאבר/פורסם). שאילתות גאנט וכתיבה לגאנט עם בדיקת התנגשות, תאריך חלופי, שעת העלאה ודדליין אוטומטי. Monthly Planning רציף. ארכיון: העברה/צפייה/שחזור. בדיקת כפילות לפני שמירה. Daily Brief 08:55 + תזכורת 17:00 (node-cron). "מה דחוף" / priority.

## כללי ארכיטקטורה קריטיים

- **visibility נבדק לפני production updates** — שינוי סדר שבר דברים בעבר. תוספת 12.7: מסווג ה-AI של visibility מדולג (skipAI) כשפקודה דטרמיניסטית תתפוס ממילא; ה-sync תמיד רץ.
- **כל mutation דורש אישור מפורש של קרן.**
- **State פרסיסטנטי (Stage G)** — דראפטים/שאלות/היסטוריה ב-`data/agent-state.json`, שורדים restart. **TTL של 3 שעות** על מצבים ממתינים (Stage H פנימי, 12.7) — מצב ישן פג בקריאה.
- **הפרדת persona**: קריאות creative (דראפט, עריכה, שיחה, humanizers) מקבלות את system-prompt.md; קריאות matching וסיווג — לא (`withPersona: false` / askClaudeForMatching). matching מחזיר null בכשל — **אין fallback של token overlap, לא להחזיר אותו**.
- **עטיפת ה-preview (Intro/ClosingQuestion/ChangeLine) נוצרת בתוך קריאת הדראפט/עריכה עצמה** (parsePreviewCopy + ברירות מחדל). קריאת humanizeDraftPreview יחידה נותרה במסלול העריכה המקומית בלבד — לא להוסיף קריאות humanizer חדשות אחרי קריאת AI קיימת.
- **עברית קנונית בכל מקום** — אין ערכים באנגלית פנימית.
- **שינויים כירורגיים בלבד** — לא refactor רחב בלי אישור.
- **Routing Trace**: כל הודעה משאירה שורת `[Routing Trace]` (handler, מספר קריאות Claude לפי tier, משך). מגבלה ידועה: מונה גלובלי — הודעות חופפות יערבבו ספירה.
- מזהי keyword מהודקים (אודיט 12.7): restore דורש הקשר ארכיון מפורש; deadline דורש פועל בטוקן מלא; ענף עריכה מחריג שאלות; "יצא"/"קלטתי"/"הקאבר" בודדים אינם סטטוס; "בצד" דורש פועל הנחה; "חדש" בודד אינו "לפתוח חדש". **לא לרופף בחזרה בלי דוגמה חיה.**

## אופי הסוכן

עברית נקבה ("לא בטוחה", "עדכנתי"), בלי אמוג'י, חם ואנושי ולא CRMי, לא מחליט בשביל קרן — שואל לפני שינוי. שאלת שפת ה-bot (נקודה 1 הישנה) נסגרה — הטון מיושם דרך system-prompt + humanizers; הפורמט המתויג (Short Name:...) הוא חוזה פנימי בין הפרומפט ל-parsing, לא טקסט שקרן רואה.

## שיטת עבודה (מחייבת)

1. אבחון והצעה בשפה פשוטה → **אישור מפורש של איתן לפני כל קוד**.
2. שינוי כירורגי אחד בכל פעם. איתן מריץ את כל הפקודות בעצמו ומדביק פלט.
3. **העברת קוד**: קבצים חדשים ב-heredoc (`cat > file << 'EOF'`); שינויים בקבצים קיימים בסקריפט python עם אימות מלא לפני נגיעה (ABORT אם ההחלפה לא נמצאת בדיוק פעם אחת). לא דרך הורדות מהדפדפן. אימות grep אחרי כל החלפה.
4. `npx tsc --noEmit` + קובץ QA ייעודי לכל שינוי + הרצת רגרסיה על ה-QA הקיימים → commit (מדויק, לעולם לא `git add .`) → כשרלוונטי בדיקה חיה בוואטסאפ.
5. עדכון Handoff בסוף סשן, לא באמצע. `git push` בסוף כל סשן — 73 קומיטים ישבו מקומית בלי גיבוי עד 12.7.

## פקודות QA

תמיד: `npx tsc --noEmit`.
סוויטת הליבה העדכנית (12.7): `stage-h-ttl-qa`, `restore-command-f1-qa`, `deadline-update-f2-qa`, `edit-branch-question-guard-f3-qa`, `status-tokens-f4-qa`, `humanizer-consolidation-qa`, `final-batch-qa`, `claude-matching-function-qa` — כולם `npx ts-node --transpile-only src/test/<name>.ts`. טסטים ממוקּקים שנעצרים על מפתח: להריץ עם `ANTHROPIC_API_KEY=dummy`.
ותיקים שימושיים: `npm run test:sprint-6`, `npm run test:sprint-10`, `full-flow-qa`, `edge-cases-qa`, `persistence-qa`, `priority-qa`, `planning-source-routing-test`. יש ~90 קבצי טסט — לפני כתיבת טסט חדש לבדוק אם קיים.

## מצב שלבים — נכון ל-12.7.2026

**הושלם:** Stage B (Brief/Reminder + priority) · Stage D (structured urgency) · Stage E (הקשחת matching, null בכשל) · F0/F0b/F0c (תיקוני שפה ו-state) · Stage G (persistence) · Stage 2A+2B (claude-context.types + askClaudeForMatching מחווט בכל 4 פונקציות ה-matching) · Category Collision · contentType backfill · Architecture Audit מלא · **אודיט ניתוב 12.7 + תיקוני F0–F8** (TTL, restore, deadline, ענף עריכה, טוקני סטטוס, הבהרת עריכה/חדש, ארכיון, skipAI) · **איחוד humanizer** · **מסווגים בלי persona** · **הידוק פרומפט הכפילות** (אומת חי) · **Routing Trace**.

**שים לב לבלבול שמות:** "Stage H" בתכנון הישן = ציר אירועים; הקומיט "Stage H" מ-12.7 = TTL. מעכשיו: ציר אירועים ו-multi-user נקראים בשמם, בלי מספור.

## פתוח לסשנים הבאים (סדר מומלץ)

1. **ניתוח Routing Traces** אחרי שבוע–שבועיים של לוגים חיים — אימות תיקוני האודיט וחומר להחלטות.
2. **גרסת "מפה" רזה ל-export-code-context.cjs** — המסמך המלא ~100K טוקנים לשיחה; לייצר מצב רשימת קבצים+פונקציות+תפקידים בלי גוף קוד, ולהחריג node_modules מהייצוא.
3. **באג מאושר — רשימת קטגוריות hardcoded בפרומפטים**: `content.service.ts` (פרומפט דראפט שורה ~56 ופרומפט עריכה ~202) מונה 8 קטגוריות בעוד ה-registry החי מכיל 11 — **מכבי, מסחרי והיריון בלתי נראות ליצירת דראפטים**; רעיון חדש בנושא היריון יקוטלג שגוי. אומת מול הגיליון 12.7. התיקון: להזרים את הרשימה הדינמית (שכבר נטענת) לפרומפטים.
4. **Content-type inference** — הסקה/הבהרה של פוסט/ריל/סטורי כשרעיון חדש לא מציין.
5. **F5 מהאודיט** (נפתר חלקית ע"י TTL): "טוב"/"בסדר" כאישור — לשקול חלון זמן קצר מהצגת הטיוטה.
6. **ניתוב מבוסס Claude** (Stage F הישן) — רק אחרי הצטברות דוגמאות אמיתיות מה-traces + scoping + guardrails. רוב "בעיות הזיהוי" בעבר היו באגים בקוד, לא חולשת AI.
7. **ציר אירועים** — הטאב קיים ומאוכלס, הקוד לא קורא ממנו · **multi-user support**.
8. **היגיינת נתונים בגיליון (לא קוד):** למחוק את שתי שורות "בדיקה qa_..." מטאב הקטגוריות; ליישר שורות ארכיון ישנות ב"רעיונות בצד" שעמודותיהן הוסטו (סכמות מעורבות מתקופות שונות, כולל BCH-004 כפול); לתקן את כותרת "סטטוסס" (בטוח — אומת שהקריאה פוזיציונלית).
9. **החלטת מוצר — פקיעת דראפטים:** יישור בין ה-Spec (תזכורת אחרי 48 שעות → dormant) לבין המימוש (TTL שקט של 3 שעות). אופציה: תזכורת עדינה לפני פקיעה. ראו "חלוקת אמת בין המסמכים".
10. **עדכון ה-Master Spec** — שלושת התיקונים המפורטים בסעיף "חלוקת אמת בין המסמכים".
11. **אחסון production** — תנאי מקדים ל-multi-user (כרגע ngrok מקומי בלבד).
12. ניקויים נדחים בקוד: `getHebrewDayName()` helper (~13 lookups); דדופליקציית `findNearestAvailableGanttDate`.

## מה לא לפתוח מחדש

Daily Brief / Reminder — קיימים והוקשחו. Stage D — סגור. contentType backfill — audit נקי. שפת ה-bot — נסגרה. token-overlap fallback — הוסר בכוונה, לא להחזיר. לא למחוק שורות overdue אוטומטית — דורשות החלטה. הודעות ארוכות מאוד עם תווים מיוחדים עלולות ליפול במגבלות Twilio — ידוע.

## חלוקת אמת בין המסמכים

- **docs/HANDOFF.md (המסמך הזה)** = אמת המימוש. מתעדכן כל סשן. מה עובד, מה פתוח, איך עובדים.
- **Master Specification** = אמת המוצר: ויז'ן, פילוסופיה, scope, ישויות, זרימות רצויות. משתנה לעיתים רחוקות. **לא מנהל סטטוס מימוש** — סעיפי המימוש שבו (23–24, עד 20.6.2026) בטלים ומוחלפים במסמך הזה; זו הייתה סיבת הריקבון של שני המסמכים.
- **מצב ה-Spec נכון ל-12.7.2026:** הליבה המוצרית (סעיפים 1–22) תקפה. נדרשות שלוש תיקונים ממוקדים, טרם בוצעו: (1) סעיפים 9+13 טוענים "state ב-RAM, נמחק ב-restart, persistence מתוכנן" — שגוי, Stage G הושלם; (2) **פער מוצרי לתשומת לב**: ה-Spec מגדיר שדראפט נשאר פתוח עד approval/ביטול, עם תזכורת אחרי 48 שעות ומעבר ל-dormant — בפועל מומש TTL של 3 שעות שמפקיע בשקט, בלי תזכורת. שני המנגנונים לא זהים; נדרשת החלטת מוצר (האם להוסיף תזכורת לפני פקיעה?); (3) להחליף את סעיפים 23–24 בהפניה ל-HANDOFF.

## פתיחת שיחה חדשה עם AI

לצרף: המסמך הזה (docs/HANDOFF.md) + המשימה הספציפית + הקבצים הרלוונטיים בלבד (לא את מסמך הקונטקסט המלא עד שתיבנה גרסת המפה). לשינוי מוצרי — גם את ה-Master Specification. לעולם לא לצרף: .env, מפתחות API, private key, auth tokens — מספיק לציין אילו משתנים קיימים.
בסוף שיחה: סיכום (קבצים ששונו, מה תוקן, טסטים שעברו, known issues, מה נשאר) → מתמזג למסמך הזה, לא נערם כסעיף תאריך חדש. פעם בכמה סשנים לדחוס — המסמך הקודם צמח ל-3,000 שורות של היסטוריה והפסיק לתפקד כ-handoff.
