import type { PendingQuestion } from '../services/confirmation.service';
import { isDraftCorrection, pickOfferedOption, matchOfferedOptions } from '../services/conversation-language.service';
import { resolvePendingTurn } from "../services/pending-turn-resolution.service";
import { parseSchedulingReply, extractReplyTime, requestedDraftAction, dateClarification } from "../services/scheduling-reply.service";
import { activateNewDraft, getSuspendedDrafts, resumeSuspendedDraft } from "../services/confirmation.service";
import type { DraftSummary } from "../types/content.types";
import { askClaudeForBridgeIntent } from "../services/bridge-intent.service";
import { getValue } from "../services/persistence.service";
import { computeScheduledReelGap } from "../services/planning-health.service";
import { askClaudeForStatusIntent, looksLikeStatusMention } from "../services/status-intent.service";
import { Request, Response } from "express";
import { sendWhatsAppMessage } from "../services/whatsapp.service";
import { createContentDraft, askClaudeForEdit } from "../services/content.service";
import { startRoutingTrace, finishRoutingTrace, withRoutingTrace, updateRoutingTrace, recordWriteOutcome } from "../services/routing-trace.service";
import { classifyMessageIntent, generateConversationalReply, isPureGreeting } from "../services/conversation-intent.service";
import { appendUserMessage, appendAgentMessage } from "../services/conversation-memory.service";
import {
  resolvePronounToRecentContent,
  looksLikePronounReference,
} from "../services/context-resolution.service";
import { fetchArchivableCandidates, findBestFuzzyIdeaMatch } from "../services/fuzzy-match.service";
import {
  humanizeDraftPreview,
  DEFAULT_NEW_DRAFT_COPY,
  DEFAULT_EDIT_COPY,
} from "../services/response-humanizer.service";
import {
  isConfirmationMessage,
  isRejectionMessage,
  isEditRequest,
  parseEditRequest,
  applyEditToDraft,
  displayPriority,
  displayTone,
  displayCategory,
  displayContentType,
  storePendingConfirmation,
  getPendingConfirmation,
  clearPendingConfirmation,
  storePendingQuestion,
  getPendingQuestion,
  clearPendingQuestion,
  isResetRequest,
  isNewIdeaCommand,
  getNewIdeaText,
  getNewIdeaContentType,
  isTrendCommand,
 isArchiveCommand,
  isBulkArchiveCommand,
  extractBulkArchiveItems,
  extractArchiveTarget,
  isViewArchiveCommand,
  isRestoreCommand,
  extractRestoreTarget,
  isApproveForProductionCommand,
  isGanttDateChange,
  extractGanttDateChange,
  isScheduleByDate,
  extractScheduleByDate,
  extractApproveTarget,
  classifyBridgeOfferAnswer,
  extractExplicitDateFromReply,
  getTrendText,
} from "../services/confirmation.service";
import {
  getExistingContentIds,
  generateContentId,
  saveContentIdea as sheets_saveContentIdea,
  findProductionTaskByName,
  updateProductionStatus as sheets_updateProductionStatus,
  updateDeadline as sheets_updateDeadline,
  findSimilarContentIdea,
 archiveContentIdea as sheets_archiveContentIdea,
  archiveContentByContentId as sheets_archiveContentByContentId,
  getArchiveList,
  restoreFromArchive as sheets_restoreFromArchive,
  getProductionStatusColumnIndex,
  getTasksMissingEdit,
  getTasksMissingFilmed,
  getTasksByCategory,
  getContentIdeaSummary,
  getTasksMissingCover,
  getTasksNotUploaded,
  getTasksEditedAndNotUploaded,
  getStuckTasks,
  searchTasksByKeyword,
 getAllProductionTasksWithPriority,
  getCategories,
findRowIndexByContentId,
approveContentForProduction as sheets_approveContentForProduction,
  updateGanttStatus as sheets_updateGanttStatus,
  getGanttNotPublished,
  getGanttReadyToUpload,
  getGanttThisWeek,
  getGanttByDateRange,
  findApprovedContentByName,
  addRowToGantt as sheets_addRowToGantt,
 sortGanttByDate as sheets_sortGanttByDate,
  updateGanttUploadTime as sheets_updateGanttUploadTime,
  isGanttDateTaken,
  findAvailableDatesInMonth,
  findSmartGanttDate,
  evaluateMonthFullForReel,
  getOrganicReelsInWeek,
  getAllProductionTasks,
  getContentNamesWithSummaries,
  lookupContentByName,
  getReelsBlockingDates,
  removePunctuationForMatching,
  updateGanttRowDate as sheets_updateGanttRowDate,
  getApprovedContentNotInGantt,
  getApprovedContentRows,
  saveFastTrackContent as sheets_saveFastTrackContent,
  getOpenContentIdeas,
  updateApprovedContentStatusById as sheets_updateApprovedContentStatusById,
  findGanttEntryByContentId,
  GanttDuplicateError,
} from "../services/sheets.service";
import type { ProductionTaskMatch } from "../services/sheets.service";
import {
 isProductionStatusUpdate,
  isDeadlineUpdate,
  extractDeadlineUpdate,
  detectStatusUpdate,
  getColumnName,
} from "../services/production-status.service";
import {
  detectVisibilityIntent,
  detectVisibilityIntentWithAI,
  extractSearchKeyword,
  extractStatusQueryTarget,
  formatTaskStatusResponse,
  formatVisibilityResponse,
  buildProductionOverviewItems,
  formatProductionOverview,
  isLikelyVisibilityQuery,
  isQuestionLikeMessage,
  extractPriorityFromQuery,
  formatWhatsImportantResponse,
  formatPriorityWhatsImportantResponse,
formatPriorityFilterResponse,
  extractCategoryAndStage,
 formatCategoryStageResponse,
formatGanttResponse,
  extractGanttWriteParams,
  formatGanttHolesResponse,
  formatOpenIdeasResponse,
} from "../services/visibility.service";
import {
  cleanIdeaPrefix,
  isContinuationMessage,
  isMetaConversation,
  hasIdeaConfidence,
  hasEditConfidence,
  generateClarificationPrompt,
} from "../utils/conversation-utils";
import { isThisWeek, normalizeUserDateInput, getHebrewDayName as getHebrewDayNameFromDate, parseDateFromSheet } from "../utils/date-utils";
import {
  fetchOverdueDecisionItems,
  fetchPriorityItems,
  markInteractionToday,
} from "../services/daily-brief.service";
import { detectOverdueDecisionIntent } from "../services/overdue-decision.service";
import { computePlanningHealthSignals } from "../services/planning-health.service";
import { buildCurrentWeekPlanningSourceRoutingState } from "../services/planning-source-routing-data.service";
import {
  buildPlanningSourceRoutingMessage,
  handlePlanningSourceRoutingReply,
  type PlanningSourceRoutingState,
} from "../services/planning-source-routing.service";
// Unified "which one did you mean?" question (5.8.2026 copywriter round).
// One builder for every ambiguity/no-match prompt, so the wording stays
// consistent everywhere. Two families:
//  - "found": several matches -> "מצאתי כמה X שמתאימים[ ל-Y]. לאיזה מהם התכוונת?"
//    (context overrides the tail, e.g. overdue uses "שאיחרו").
//  - "notFound": no exact match -> "לא מצאתי את Y בין ה-Z. התכוונת לאחד מאלה?"
// Options and an optional "כתבי תוכן חדש" line follow, with blank-line spacing.
const buildAmbiguityQuestion = (args: {
  kind: "found" | "notFound";
  itemType: "תכנים" | "רעיונות";
  options: string[];
  searchedName?: string;
  location?: string; // notFound: "בהפקה" | "בין הרעיונות השמורים" ...
  foundContext?: string; // found: overrides "שמתאימים", e.g. "שאיחרו"
  offerNew?: boolean; // append the "תוכן חדש" line
}): string => {
  const { kind, itemType, options, searchedName, location, foundContext, offerNew } = args;
  let header: string;
  if (kind === "found") {
    const tail = foundContext || "שמתאימים";
    const forName = searchedName ? ` ל"${searchedName}"` : "";
    header = `מצאתי כמה ${itemType} ${tail}${forName}. לאיזה מהם התכוונת?`;
  } else {
    const where = location ? ` ${location}` : "";
    const singular = itemType === "רעיונות" ? "הרעיון שביקשת" : "התוכן שביקשת";
    const what = searchedName ? `את "${searchedName}"` : `את ${singular}`;
    header = `לא מצאתי ${what}${where}. התכוונת לאחד מאלה?`;
  }
  const out = [header, "", ...options];
  if (offerNew) {
    out.push("", 'אם זה משהו חדש, פשוט תכתבי "תוכן חדש".');
  }
  return out.join("\n");
};

// Record the outcome of every controller-owned sheet mutation in this request.
const tracedWrite = <A extends unknown[], R>(name: string, fn: (...args:A)=>Promise<R>) => async (...args:A):Promise<R> => {
  try { const result=await fn(...args);recordWriteOutcome(name,"succeeded");return result; }
  catch(error) {recordWriteOutcome(name,"failed");throw error;}
};
const saveContentIdea = tracedWrite("saveContentIdea",sheets_saveContentIdea);
const updateProductionStatus = tracedWrite("updateProductionStatus",sheets_updateProductionStatus);
const updateDeadline = tracedWrite("updateDeadline",sheets_updateDeadline);
const archiveContentIdea = tracedWrite("archiveContentIdea",sheets_archiveContentIdea);
const archiveContentByContentId = tracedWrite("archiveContentByContentId",sheets_archiveContentByContentId);
const restoreFromArchive = tracedWrite("restoreFromArchive",sheets_restoreFromArchive);
const approveContentForProduction = tracedWrite("approveContentForProduction",sheets_approveContentForProduction);
const updateGanttStatus = tracedWrite("updateGanttStatus",sheets_updateGanttStatus);
const addRowToGantt = tracedWrite("addRowToGantt",sheets_addRowToGantt);
const sortGanttByDate = tracedWrite("sortGanttByDate",sheets_sortGanttByDate);
const updateGanttUploadTime = tracedWrite("updateGanttUploadTime",sheets_updateGanttUploadTime);
const updateGanttRowDate = tracedWrite("updateGanttRowDate",sheets_updateGanttRowDate);
const saveFastTrackContent = tracedWrite("saveFastTrackContent",sheets_saveFastTrackContent);
const updateApprovedContentStatusById = tracedWrite("updateApprovedContentStatusById",sheets_updateApprovedContentStatusById);

const safeSendWhatsAppMessage = async (to: string, message: string): Promise<void> => {
  // Record only replies accepted by Twilio, so failed sends cannot become
  // invisible context that Karen is assumed to have read.
  try {
    await sendWhatsAppMessage(to, message);
    appendAgentMessage(to, message);
    updateRoutingTrace({sendOutcome:"sent"});
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateRoutingTrace({sendOutcome:"failed"});
    console.error(`[WhatsApp] Failed to send message to ${to}: ${errorMessage}`);
  }
};


const blockDuplicateGanttWrite = async (
  sender: string,
  spreadsheetId: string,
  contentId: string
): Promise<boolean> => {
  const existing = await findGanttEntryByContentId(
    spreadsheetId,
    contentId
  );

  if (!existing) return false;

  clearPendingQuestion(sender);

  await safeSendWhatsAppMessage(
    sender,
    `"${existing.name || contentId}" כבר משובץ בגאנט ל-${existing.date}. לא הוספתי אותו שוב.`
  );

  return true;
};

const normalizeGeneralChatText = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[!?.,…]/g, "")
    .replace(/[״"]/g, "")
    .replace(/\s+/g, " ");

const isGeneralChatOrHelpMessage = (text: string): boolean => {
  const raw = normalizeGeneralChatText(text);

  const exactGeneralMessages = [
    "היי",
    "הי",
    "שלום",
    "בוקר טוב",
    "צהריים טובים",
    "ערב טוב",
    "לילה טוב",
    "מה קורה",
    "מה נשמע",
    "מה העניינים",
    "מה המצב",
    "עזרה",
    "help",
    "מה אפשר לעשות",
    "מה את יודעת לעשות",
    "מה את יכולה לעשות",
    "איך משתמשים",
    "איך זה עובד",
    "מה הפקודות",
    "פקודות",
    "תזכירי לי מה אפשר לעשות",
  ];

  return exactGeneralMessages.includes(raw);
};

const buildGeneralHelpResponse = (): string =>
  [
    "אני פה :)",
    "",
    "אפשר לכתוב לי למשל:",
    "- מה דחוף",
    "- בואי נתכנן את יוני",
    "- יש לי רעיון ל...",
    "- תוסיפי את ... להפקה",
    "- צילמתי את ... / ערכתי את ...",
    "- מה צריך תאריך בגאנט",
    "",
    "מה בא לך לעשות?",
  ].join("\n");


const getDraftPriorityText = (priority: any): string => {
  const rawPriorityText = displayPriority(priority);

  if (rawPriorityText === "גבוה") return "גבוהה";
  if (rawPriorityText === "בינוני") return "בינונית";
  if (rawPriorityText === "נמוך") return "נמוכה";

  return rawPriorityText;
};

const buildDraftPreviewMessage = (
  draft: any,
  options: {
    intro?: string | string[];
    previewLine?: string;
    includeContentType?: boolean;
    extraBeforeQuestion?: string[];
    changeLine?: string;
    closingQuestion?: string;
  } = {}
): string => {
  // Copy polish (24.7.2026): the default opener ("יש פה כיוון טוב") said
  // nothing about the idea and just filled space. Callers that need a real
  // opener still pass one; without it the message starts with the content.
  const introLines = options.intro
    ? (Array.isArray(options.intro) ? options.intro : [options.intro])
    : [];

  // Draft preview simplification (21.7.2026): from the real conversation
  // logs, category/tone/priority are internal noise Karen never acts on —
  // and after retiring topical categories, "קטגוריה: כללי" on every draft is
  // pure clutter. Keep only what she cares about: name, content type, and the
  // direction. Category/tone/priority still live in the sheet, just not shown.
  const shouldIncludeContentType = options.includeContentType ?? true;
  const lines = [
    ...introLines,
    ...(introLines.length ? [""] : []),
    options.previewLine || (shouldIncludeContentType && draft.contentType ? `ככה הייתי שומרת את ה${displayContentType(draft.contentType)}:` : "ככה הייתי שומרת את הרעיון:"),
    "",
    `"${draft.shortName}"`,
    "",
    draft.summary,
  ];

  if (options.extraBeforeQuestion?.length) {
    lines.push("", ...options.extraBeforeQuestion);
  }

  // One closing line instead of two. The old pair ("לשמור ככה?" plus "אפשר גם
  // להגיד לי מה לשנות") never said WHAT could change, so Karen had to guess.
  if (draft.requestedAction?.kind === "schedule" && draft.requestedAction.date && draft.approvalScope === "save_schedule") {
    lines.push("", `שיבוץ: ${draft.requestedAction.date}${draft.requestedAction.time ? ` בשעה ${draft.requestedAction.time}` : ""}`);
  }
  lines.push(
    "",
    (draft.approvalScope === "save_schedule" ? "לשמור, להעביר להפקה ולשבץ כך?" : options.closingQuestion) ||
      "לשמור ככה?"
  );
  if (options.changeLine) lines.push(options.changeLine);

  return lines.join("\n");
};



const getHebrewDayName = (dateText: string): string => {
  const parts = dateText.split("/").map((part) => parseInt(part, 10));
  const [day, month, year] = parts;
  const fullYear = year < 100 ? 2000 + year : year;
  const date = new Date(fullYear, month - 1, day);

  return ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][
    date.getDay()
  ];
};

// Finds the nearest available Gantt date in the given month: tomorrow or
// later, earliest first. Returns null when the month has no future free
// slot. Extracted from two previously-duplicated blocks in the
// monthly_planning flow (the callers keep their own status responses).
const findNearestAvailableGanttDate = async (
  spreadsheetId: string,
  month: number,
  year: number
): Promise<{ date: string; dayName: string } | null> => {
  const firstOfMonth = `01/${String(month).padStart(2, "0")}/${year}`;
  const available = await findAvailableDatesInMonth(spreadsheetId, firstOfMonth);

  const earliestGanttDate = new Date();
  earliestGanttDate.setDate(earliestGanttDate.getDate() + 1);
  earliestGanttDate.setHours(0, 0, 0, 0);

  const futureAvailable = available
    .filter((candidateDate) => {
      const parts = candidateDate.split("/");
      const parsed = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      return parsed >= earliestGanttDate;
    })
    .sort((a, b) => {
      const aParts = a.split("/");
      const bParts = b.split("/");
      const aDate = new Date(parseInt(aParts[2]), parseInt(aParts[1]) - 1, parseInt(aParts[0]));
      const bDate = new Date(parseInt(bParts[2]), parseInt(bParts[1]) - 1, parseInt(bParts[0]));
      return aDate.getTime() - bDate.getTime();
    });

  if (futureAvailable.length === 0) {
    return null;
  }

  const date = futureAvailable[0];
  return { date, dayName: getHebrewDayName(date) };
};

const markOverdueItemPublished = async (
  spreadsheetId: string,
  contentId: string
): Promise<void> => {
  const rowIndex = await findRowIndexByContentId(spreadsheetId, contentId);

  if (rowIndex !== null) {
    for (const columnName of ["צולם", "נערך", "קאבר מוכן"]) {
      const columnIndex = getProductionStatusColumnIndex(columnName);
      if (columnIndex !== null) {
        await updateProductionStatus(spreadsheetId, rowIndex, columnIndex);
      }
    }
  }

  const approvedUpdated = await updateApprovedContentStatusById(spreadsheetId, contentId, "פורסם");
  if (!approvedUpdated) {
    throw new Error(`Failed to mark approved content as published for contentId: ${contentId}`);
  }

  const ganttUpdated = await updateGanttStatus(spreadsheetId, contentId, "פורסם");
  if (!ganttUpdated) {
    throw new Error(`Failed to mark gantt row as published for contentId: ${contentId}`);
  }
};

// Shared bank -> production -> gantt path; no second interpretation of approval.
const scheduleSavedContent = async (sender: string, contentName: string, date: string, time?: string, knownId?: string): Promise<string> => {
  const sid = process.env.GOOGLE_SHEETS_ID!;
  let contentId = knownId;
  try {
  if (!contentId) {
    const approved = await approveContentForProduction(sid,contentName);
    contentId = approved.contentId;
    recordWriteOutcome("approve","succeeded");
  }
  if (await blockDuplicateGanttWrite(sender,sid,contentId!)) return "gantt_duplicate_blocked";
  const collision = await isGanttDateTaken(sid,date);
  if (collision.taken) {
    storePendingQuestion(sender,{questionType:"gantt_collision",context:{newContentId:contentId,newContentName:contentName,newDate:date,newDayName:getHebrewDayName(date),
      existingContentId:collision.existingContentId,existingName:collision.existingName,ganttStatus:"בתכנון",uploadTime:time}});
    await safeSendWhatsAppMessage(sender,`העברתי את "${contentName}" להפקה, אבל ב-${date} כבר מתוכנן "${collision.existingName}". להחליף ולהעביר אותו לתאריך אחר?`);
    return "bridge_offer_explicit_collision";
  }
  clearPendingQuestion(sender);
  const deadline = await addRowToGantt(sid,contentId!,contentName,date,getHebrewDayName(date),"","בתכנון");
  recordWriteOutcome("gantt","succeeded");
  // Persist retry context before secondary writes. A failure must not resave the idea.
  storePendingQuestion(sender,{questionType:"gantt_upload_time",context:{contentId,contentName,date}});
  try { await sortGanttByDate(sid); } catch { recordWriteOutcome("sort","failed"); }
  if (time) {
    try { await updateGanttUploadTime(sid,contentName,date,time); clearPendingQuestion(sender); }
    catch { recordWriteOutcome("upload_time","failed"); await safeSendWhatsAppMessage(sender,`שיבצתי את "${contentName}" ל-${date}, אבל עדכון השעה לא הצליח. איזו שעה לקבוע?`); return "scheduled_time_failed"; }
  }
  await safeSendWhatsAppMessage(sender,[`שיבצתי את "${contentName}" ל-${date}${time?` בשעה ${time}`:""}.`,deadline?`הדדליין להפקה: ${deadline}.`:"",time?"":"באיזו שעה לתכנן את ההעלאה?"].filter(Boolean).join("\n"));
  return "bridge_offer_explicit_date";
  } catch (error) {
    recordWriteOutcome("schedule","failed");
    await safeSendWhatsAppMessage(sender,`"${contentName}" נשמר, אבל השיבוץ לא הושלם. אפשר לבדוק את הגאנט ולנסות שוב.`);
    return "saved_schedule_failed";
  }
};

const handleWhatsAppWebhookInternal = async (req: Request, res: Response) => {
  const sender = (req.body.From || req.body.from || "").toString();
  let incomingText = (req.body.Body || req.body.body || "").toString();
  let suppliedTime = extractReplyTime(incomingText);
  let initialPendingType: string | undefined;
  // Finalize an already-authorized schedule before sending its confirmation.
  // All older date routes can consume a time supplied in the same turn.
  async function sendTurnReply(to: string, text: string): Promise<void> {
    const pending = getPendingQuestion(to);
    if (suppliedTime && initialPendingType !== "gantt_upload_time" && pending?.questionType === "gantt_upload_time") {
      const ctx = pending.context as any;
      try {
        await updateGanttUploadTime(process.env.GOOGLE_SHEETS_ID!,ctx.contentName,ctx.date,suppliedTime);
        recordWriteOutcome("upload_time","succeeded");
        clearPendingQuestion(to);
        text = text.replace(/באיזו שעה לתכנן את ההעלאה\?/g,"").trim()+`\nשעת ההעלאה: ${suppliedTime}.`;
        if (ctx.monthlyPlanning) {
          const plan = ctx.monthlyPlanning;
          const remaining = plan.remainingContent.filter((item:any)=>item.contentId!==ctx.contentId);
          if (remaining.length) {
            storePendingQuestion(to,{questionType:"monthly_planning",context:{...plan,remainingContent:remaining}});
            text += `\nעל איזה תוכן לשבץ עכשיו?\n${remaining.map((item:any)=>item.name).join("\n")}`;
          }
        }
      } catch {
        recordWriteOutcome("upload_time","failed");
        text = text.replace(/באיזו שעה לתכנן את ההעלאה\?/g,"").trim()+"\nעדכון השעה לא הצליח. אפשר לשלוח את השעה שוב.";
      }
    }
    await safeSendWhatsAppMessage(to,text);
  }

  if (!sender || !incomingText) {
    return res.status(400).json({
      error: "Missing Twilio WhatsApp sender or message body in webhook payload.",
    });
  }

  try {
    // ===== ROUTE DEBUG LOGS =====
    console.log(`[Route Debug] messageSid: ${req.body.MessageSid || req.body.SmsMessageSid || "missing"}`);

    // Routing trace (audit Stage 2): every controller exit goes through
    // res.json({ status: ... }) — the status field IS the handler name. One
    // wrap here covers all exits with a uniform trace line (handler + Claude
    // call count + duration), no per-handler instrumentation needed.
    startRoutingTrace(sender, incomingText, req.body.MessageSid || req.body.SmsMessageSid);
    const originalResJson = res.json.bind(res);
    res.json = ((body: any) => {
      finishRoutingTrace(body?.status ?? body?.error, { pendingAfter: getPendingQuestion(sender)?.questionType });
      if (res.statusCode >= 400) return originalResJson(body);
      return res.type("text/xml").send("<Response/>");
    }) as Response["json"];

    // Phase A — conversation memory: log every inbound turn before routing
    // so downstream AI prompts see it as context. Outbound turns are logged
    // inside safeSendWhatsAppMessage.
    appendUserMessage(sender, incomingText);

    // Escape hatch: reset command clears pending confirmations and questions
    // so Karen can never get stuck in a modal state. Runs before any other
    // routing so it works even when a pendingQuestion has hijacked routing.
    const RESET_PATTERNS: RegExp[] = [
      /^\s*(ביטול|בטל|בטלי)\s*[,.!?]?\s*$/i,
      /^\s*(cancel|\/reset|reset|nvm|never\s*mind)\s*[,.!?]?\s*$/i,
      /^\s*(מחקי הכל|נקי הכל|תתחילי מהתחלה|start over)\s*[,.!?]?\s*$/i,
    ];
    if (RESET_PATTERNS.some((p) => p.test(incomingText))) {
      clearPendingConfirmation(sender);
      clearPendingQuestion(sender);
      await sendTurnReply(
        sender,
        "בסדר, ביטלתי את הפעולה הנוכחית."
      );
      return res.status(200).json({ status: "state_reset", sender });
    }

 // Mark interaction for afternoon reminder
    markInteractionToday(sender);

    // Check for pending question response (priority: before draft checks)
    let pendingQuestion = getPendingQuestion(sender);
    initialPendingType = pendingQuestion?.questionType;
    console.log(`[Route Debug] pendingQuestion: ${pendingQuestion ? JSON.stringify({ questionType: pendingQuestion.questionType }) : "null"}`);

    let acknowledgedPastDate: string | undefined;

    const conceptTurn = isNewIdeaCommand(incomingText) || isTrendCommand(incomingText) || /^(?:סרטון|רילס?|פוסט|סטורי)\s/.test(incomingText.trim()) || /רואים אותי/.test(incomingText);
    const activeDraft = getPendingConfirmation(sender);
    updateRoutingTrace({pendingBefore:pendingQuestion?.questionType});

    if (/^(?:חזרי|תחזרי|חזור|חזרה) (?:ל)?טיוטה/.test(incomingText.trim())) {
      const requestedName = incomingText.replace(/^(?:חזרי|תחזרי|חזור|חזרה) (?:ל)?טיוטה(?: הקודמת)?[: ]*/, "").trim();
      const matches = requestedName ? matchOfferedOptions(requestedName, getSuspendedDrafts(sender), item => item.draft.shortName) : [];
      if (requestedName && matches.length !== 1) {
        const options = getSuspendedDrafts(sender).map(item => ({id:item.id,name:item.draft.shortName}));
        storePendingQuestion(sender, {questionType:"resume_draft_pick",context:{options}});
        await sendTurnReply(sender, ["לאיזו טיוטה לחזור?", ...options.map((item,i) => `${i+1}. ${item.name}`)].join("\n"));
        return res.status(200).json({status:"resume_draft_choice",sender});
      }
      const resumed = resumeSuspendedDraft(sender, matches[0]?.id);
      await sendTurnReply(sender, resumed ? buildDraftPreviewMessage(resumed) : "אין כרגע טיוטה קודמת בצד.");
      return res.status(200).json({status:"draft_resumed",sender});
    }
    if (pendingQuestion?.questionType === "resume_draft_pick") {
      if (isRejectionMessage(incomingText)) { clearPendingQuestion(sender); await sendTurnReply(sender,"בסדר."); return res.status(200).json({status:"resume_cancelled",sender}); }
      if (!isNewIdeaCommand(incomingText)) {
        const options = pendingQuestion.context?.options as Array<{id:string;name:string}>;
        const chosen = pickOfferedOption(incomingText, options, item=>item.name);
        if (!chosen) { await sendTurnReply(sender,"אפשר לבחור במספר או בשם הטיוטה."); return res.status(200).json({status:"resume_unclear",sender}); }
        const resumed = resumeSuspendedDraft(sender,chosen.id);
        await sendTurnReply(sender,resumed?buildDraftPreviewMessage(resumed):"הטיוטה אינה זמינה.");
        return res.status(200).json({status:"draft_resumed",sender});
      }
    }

    // Restore the exact blocked operation, never infer a new mutation from "yes".
    if (pendingQuestion?.questionType === "schedule_date_clarification") {
      const ctx = pendingQuestion.context as any;
      if (isRejectionMessage(incomingText)) {
        clearPendingQuestion(sender); await sendTurnReply(sender,"סגור, לא שיבצתי.");
        return res.status(200).json({status:"date_clarification_cancelled",sender});
      }
      if (!conceptTurn && (parseSchedulingReply(incomingText).kind !== "absent" || isConfirmationMessage(incomingText) || isRejectionMessage(incomingText) || extractReplyTime(incomingText))) {
        const answer = parseSchedulingReply(incomingText);
        if (ctx.candidate && isConfirmationMessage(incomingText)) {
          acknowledgedPastDate = ctx.candidate;
          incomingText = ctx.originalText;
        } else if (answer.kind === "valid") {
          incomingText = ctx.pending ? answer.date : ctx.originalText.replace(/\d{1,2}[./-]\d{1,2}(?:[./-](?:\d{4}|\d{2}))?/g, answer.date);
          if (!/\d{1,2}[./-]\d{1,2}/.test(ctx.originalText)) incomingText = answer.date;
          suppliedTime = extractReplyTime(incomingText) || ctx.time;
        } else {
          await sendTurnReply(sender, dateClarification(answer));
          return res.status(200).json({status:"date_clarification_waiting",sender});
        }
        if (ctx.pending) storePendingQuestion(sender, ctx.pending); else clearPendingQuestion(sender);
        pendingQuestion = getPendingQuestion(sender);
      }
    }
    if (pendingQuestion?.questionType === "draft_schedule_date" && activeDraft && !conceptTurn && (parseSchedulingReply(incomingText).kind !== "absent" || isConfirmationMessage(incomingText) || isRejectionMessage(incomingText) || extractReplyTime(incomingText))) {
      const parsed = parseSchedulingReply(incomingText);
      const ctx = pendingQuestion.context as any;
      if (isRejectionMessage(incomingText)) {
        const changed: DraftSummary = {...activeDraft,requestedAction:{kind:"keep"},approvalScope:"save"};
        storePendingConfirmation(sender,changed);clearPendingQuestion(sender);
        await sendTurnReply(sender,buildDraftPreviewMessage(changed));
      } else if (parsed.kind === "valid" || (ctx.candidate && isConfirmationMessage(incomingText))) {
        const date = 'date' in parsed ? parsed.date : ctx.candidate;
        const changed: DraftSummary = {...activeDraft,requestedAction:{kind:"schedule",date,time:extractReplyTime(incomingText) || ctx.time,allowPast:!!ctx.candidate && isConfirmationMessage(incomingText)},approvalScope:"save_schedule"};
        storePendingConfirmation(sender,changed);clearPendingQuestion(sender);
        await sendTurnReply(sender,buildDraftPreviewMessage(changed));
      } else {
        if (parsed.kind === "past_needs_clarification") storePendingQuestion(sender,{questionType:"draft_schedule_date",context:{candidate:parsed.date,time:ctx.time}});
        await sendTurnReply(sender,dateClarification(parsed));
      }
      return res.status(200).json({status:"draft_date_resolved",sender});
    }
    // A date/preference replying to a draft updates its proposed action, not its summary.
    if (activeDraft && !pendingQuestion && !conceptTurn) {
      const keep = /בלי תאריך|ללא תאריך|לא לשבץ/.test(incomingText);
      const parsed = parseSchedulingReply(incomingText);
      if (keep) {
        const changed: DraftSummary = {...activeDraft,requestedAction:{kind:"keep"},approvalScope:"save"};
        storePendingConfirmation(sender,changed);
        if (/לשמור|^כן/.test(incomingText.trim())) incomingText = "כן";
        else {
          await sendTurnReply(sender,buildDraftPreviewMessage(changed));
          return res.status(200).json({status:"draft_keep_preference",sender});
        }
      } else if (parsed.kind !== "absent" && (activeDraft.requestedAction?.kind === "schedule" || /לשבץ|שבצי|תאריך|גאנט/.test(incomingText))) {
        if (parsed.kind === "valid") {
          const changed: DraftSummary = {...activeDraft,requestedAction:{kind:"schedule",date:parsed.date,time:suppliedTime || (activeDraft.requestedAction?.kind === "schedule" ? activeDraft.requestedAction.time:undefined)},approvalScope:"save_schedule"};
          storePendingConfirmation(sender,changed);
          await sendTurnReply(sender,buildDraftPreviewMessage(changed));
        } else {
          storePendingQuestion(sender,{questionType:"draft_schedule_date",context:{candidate:'date' in parsed?parsed.date:undefined,time:suppliedTime}});
          await sendTurnReply(sender,dateClarification(parsed));
        }
        return res.status(200).json({status:"draft_schedule_changed",sender});
      }
    }
    const schedulingQuestions = new Set(["bridge_offer","bridge_pick_date","confirm_gantt_write","gantt_write_new_date","gantt_move_existing","overdue_reschedule_date","trend_schedule","trend_awaiting_date","trend_make_room","month_full_move_date","gantt_date_change_collision","monthly_planning"]);
    if (!conceptTurn && ((pendingQuestion && schedulingQuestions.has(pendingQuestion.questionType)) || isScheduleByDate(incomingText) || isGanttDateChange(incomingText) || Boolean(extractGanttWriteParams(incomingText)))) {
      const directDate = isGanttDateChange(incomingText) ? extractGanttDateChange(incomingText)?.targetDate : undefined;
      const parsed = parseSchedulingReply(directDate || incomingText);
      if (parsed.kind !== "absent" && parsed.kind !== "valid" && !(parsed.kind === "past_needs_clarification" && parsed.date === acknowledgedPastDate)) {
        storePendingQuestion(sender,{questionType:"schedule_date_clarification",context:{originalText:incomingText,pending:pendingQuestion,
          candidate:parsed.kind === "past_needs_clarification"?parsed.date:undefined,time:suppliedTime}});
        await sendTurnReply(sender,dateClarification(parsed));
        return res.status(200).json({status:"schedule_date_needs_clarification",sender});
      }
    }

    if (activeDraft?.approvalScope === "save_schedule" && activeDraft.requestedAction?.kind === "schedule" && activeDraft.requestedAction.date && isConfirmationMessage(incomingText) && !pendingQuestion) {
      const checked = parseSchedulingReply(activeDraft.requestedAction.date);
      if (checked.kind === "past_needs_clarification" && !activeDraft.requestedAction.allowPast) {
        storePendingQuestion(sender,{questionType:"draft_schedule_date",context:{candidate:checked.date,time:activeDraft.requestedAction.time}});
        await sendTurnReply(sender,dateClarification(checked));
        return res.status(200).json({status:"draft_schedule_expired_date",sender});
      }
    }
    if (!conceptTurn && pendingQuestion && schedulingQuestions.has(pendingQuestion.questionType) && isConfirmationMessage(incomingText)) {
      const ctx = pendingQuestion.context as any;
      const candidate = ctx.date || ctx.newDate || ctx.suggestedDate;
      if (candidate && candidate !== acknowledgedPastDate) {
        const checked = parseSchedulingReply(candidate);
        if (checked.kind === "past_needs_clarification") {
          storePendingQuestion(sender,{questionType:"schedule_date_clarification",context:{originalText:incomingText,pending:pendingQuestion,candidate}});
          await sendTurnReply(sender,dateClarification(checked));
          return res.status(200).json({status:"suggested_date_expired",sender});
        }
      }
    }

    const guardChosenDate = async (date: string): Promise<boolean> => {
      const checked = parseSchedulingReply(date);
      if (checked.kind === "valid" || (checked.kind === "past_needs_clarification" && checked.date === acknowledgedPastDate)) return false;
      storePendingQuestion(sender,{questionType:"schedule_date_clarification",context:{originalText:incomingText,pending:pendingQuestion,
        candidate:'date' in checked?checked.date:undefined,time:suppliedTime}});
      await sendTurnReply(sender,dateClarification(checked));
      return true;
    };

    // Local answers first. Only ambiguous concept/edit turns use the contextual classifier.
    const contextFlows = new Set(["offer_saved_list","saved_list_pick","bridge_offer","schedule_date_clarification","draft_schedule_date","gantt_upload_time","bridge_pick_date","trend_schedule","trend_awaiting_date","confirm_gantt_write"]);
    const explicitNew = isNewIdeaCommand(incomingText) || isTrendCommand(incomingText);
    const otherCommand = Boolean(detectVisibilityIntent(incomingText)) || isArchiveCommand(incomingText) || isBulkArchiveCommand(incomingText) || isRestoreCommand(incomingText) || isApproveForProductionCommand(incomingText) || isDeadlineUpdate(incomingText) || isGanttDateChange(incomingText) || isScheduleByDate(incomingText) || isProductionStatusUpdate(incomingText);
    let decision;
    if (activeDraft && !explicitNew && !otherCommand && isDraftCorrection(incomingText, `${activeDraft.shortName} ${activeDraft.summary} ${activeDraft.originalUserInput}`)) decision = {kind:"edit_draft" as const};
    else if (explicitNew || (!otherCommand && !pendingQuestion && conceptTurn) || (!otherCommand && !pendingQuestion && !activeDraft && requestedDraftAction(incomingText) && !/^(?:לשמור\s+)?(?:בלי|ללא) תאריך[.!]?\s*$/.test(incomingText.trim()))) decision = {kind:"new_idea" as const};
    else if (!["context_turn_clarification","confirm_duplicate","resume_draft_pick"].includes(pendingQuestion?.questionType || "") && (activeDraft || (pendingQuestion && contextFlows.has(pendingQuestion.questionType))) && !otherCommand && !(pendingQuestion?.questionType === "gantt_upload_time" && (extractReplyTime(incomingText) || /^\d{1,2}$/.test(incomingText.trim()))) && !(pendingQuestion && schedulingQuestions.has(pendingQuestion.questionType) && parseSchedulingReply(incomingText).kind !== "absent")) {
      decision = await resolvePendingTurn(incomingText,pendingQuestion,activeDraft);
    }
    if (decision) updateRoutingTrace({routeReason:decision.kind});
    if (decision?.kind === "clarify") {
      storePendingQuestion(sender,{questionType:"context_turn_clarification",context:{originalText:incomingText,previous:pendingQuestion}});
      await sendTurnReply(sender,decision.question);
      return res.status(200).json({status:"context_turn_unclear",sender});
    }
    if (pendingQuestion?.questionType === "context_turn_clarification" && /^(?:רעיון חדש|חדש|לשנות|תיקון|עריכה|לשנות את הטיוטה|לתקן|את הטיוטה|תיקון לטיוטה|זה תיקון|כן לשנות)[.!]?$/.test(incomingText.trim())) {
      const ctx = pendingQuestion.context as any;
      decision = {kind:/חדש/.test(incomingText)?"new_idea":"edit_draft"};
      incomingText = ctx.originalText;
    }
    if (decision?.kind === "edit_draft" && activeDraft) {
      const edit = parseEditRequest(incomingText);
      const updated = edit && !isDraftCorrection(incomingText, `${activeDraft.shortName} ${activeDraft.summary} ${activeDraft.originalUserInput}`) ? applyEditToDraft(activeDraft,edit) : await askClaudeForEdit(activeDraft,incomingText,sender);
      if (!updated) { await sendTurnReply(sender,"מה לשנות בטיוטה?"); return res.status(200).json({status:"context_edit_unclear",sender}); }
      storePendingConfirmation(sender,updated);
      const dateQuestion = pendingQuestion?.questionType === "draft_schedule_date" ? pendingQuestion
        : pendingQuestion?.questionType === "context_turn_clarification" && (pendingQuestion.context?.previous as PendingQuestion | undefined)?.questionType === "draft_schedule_date"
          ? pendingQuestion.context?.previous as PendingQuestion : undefined;
      if (dateQuestion) {
        storePendingQuestion(sender,dateQuestion);
        const candidate = dateQuestion.context?.candidate as string | undefined;
        await sendTurnReply(sender,buildDraftPreviewMessage(updated,{intro:"עדכנתי.",closingQuestion:candidate
          ? dateClarification({kind:"past_needs_clarification",date:candidate,explicitYear:true})
          : "לאיזה תאריך לשבץ?"}));
      } else {
        clearPendingQuestion(sender);
        await sendTurnReply(sender,buildDraftPreviewMessage(updated,{intro:"עדכנתי."}));
      }
      return res.status(200).json({status:"context_draft_updated",sender});
    }
    if (decision?.kind === "new_idea") {
      const text = getNewIdeaText(incomingText) || getTrendText(incomingText) || incomingText;
      if (!text.trim() || /^(רעיון חדש|רעיון חדש:)\s*$/.test(text)) { await sendTurnReply(sender,"מה הרעיון החדש?"); return res.status(200).json({status:"new_idea_missing",sender}); }
      const similar = process.env.GOOGLE_SHEETS_ID ? await findSimilarContentIdea(process.env.GOOGLE_SHEETS_ID,text) : null;
      if (similar) {
        storePendingQuestion(sender,{questionType:"confirm_duplicate",context:{originalInput:text,requestedAction:requestedDraftAction(incomingText),isTrend:isTrendCommand(incomingText)}});
        await sendTurnReply(sender,`כבר שמור רעיון דומה: "${similar.idea}". לפתוח גם את הרעיון החדש?`);
        return res.status(200).json({status:"duplicate_found",sender});
      }
      const draft = await createContentDraft(text,sender);
      const summary: DraftSummary = {...draft,originalUserInput:text,
        contentType:getNewIdeaContentType(incomingText)||draft.contentType,
        ...(isTrendCommand(incomingText)?{category:"טרנד",priority:"גבוה" as const}:{}),
        requestedAction:requestedDraftAction(incomingText)};
      const parked = activateNewDraft(sender,summary);
      const action = summary.requestedAction;
      const parsed = action?.kind === "schedule" ? parseSchedulingReply(action.rawDate || action.date || "") : {kind:"absent" as const};
      if (action?.kind === "schedule" && parsed.kind !== "valid") {
        storePendingQuestion(sender,{questionType:"draft_schedule_date",context:{candidate:parsed.kind === "past_needs_clarification"?parsed.date:undefined,time:action.time}});
        await sendTurnReply(sender,buildDraftPreviewMessage(summary,{closingQuestion:dateClarification(parsed),extraBeforeQuestion:parked?["הטיוטה הקודמת נשארה בצד."]:[]}));
      } else {
        summary.approvalScope = action?.kind === "schedule"?"save_schedule":"save";
        storePendingConfirmation(sender,summary);
        await sendTurnReply(sender,buildDraftPreviewMessage(summary,{extraBeforeQuestion:parked?["הטיוטה הקודמת נשארה בצד."]:[]}));
      }
      return res.status(200).json({status:"context_new_draft",sender});
    }
    if (decision?.kind === "route_existing_command") { clearPendingQuestion(sender);pendingQuestion=undefined; }

    // Global escape hatch (23.7.2026). Every open question used to swallow
    // whatever Karen wrote next, so asking something else while a question was
    // pending left her stuck until the TTL expired. A question or an explicit
    // command is never an answer, so it clears the pending state and routes
    // normally. Confirmations and rejections are excluded: those ARE answers.
    if (pendingQuestion) {
      const looksLikeAnswer =
        isConfirmationMessage(incomingText) || isRejectionMessage(incomingText);
      const looksLikeSomethingElse =
        !looksLikeAnswer &&
        (isQuestionLikeMessage(incomingText) ||
          Boolean(detectVisibilityIntent(incomingText)) ||
          isArchiveCommand(incomingText) ||
          isBulkArchiveCommand(incomingText) ||
          isRestoreCommand(incomingText) ||
          isApproveForProductionCommand(incomingText) ||
          isDeadlineUpdate(incomingText) ||
          isGanttDateChange(incomingText) ||
          isTrendCommand(incomingText));

      // Modal flows that legitimately expect free text keep their turn.
      const MODAL_QUESTIONS = new Set([
        "gantt_upload_time",
        "monthly_planning",
        "bulk_archive_confirm",
        "month_full_choice",
        "month_full_pick_reel",
        "month_full_move_date",
        "approve_pick_idea",
        "saved_list_pick",
        "status_no_match_pick",
      ]);

      if (looksLikeSomethingElse && !MODAL_QUESTIONS.has(pendingQuestion.questionType)) {
        console.log(`[Route Debug] escape hatch: "${pendingQuestion.questionType}" cleared, routing the new request`);
        clearPendingQuestion(sender);
        pendingQuestion = undefined as any;
      }
    }

    // Bulk archive: awaiting confirmation of a list of matched ideas.
    // "כן" archives them all in sequence; anything else (except explicit
    // yes-adjacent phrases handled by isConfirmationMessage) cancels.
    if (pendingQuestion?.questionType === "bulk_archive_confirm") {
      type BulkItem = { contentId: string; source: "library" | "approved"; name: string };
      const context = pendingQuestion.context as
        | { items?: Array<BulkItem | string> }
        | undefined;
      // Defensive: earlier bulk-archive builds stored items as bare strings.
      // Any leftover state from that version is coerced here so we can
      // still finish the confirmation gracefully.
      const rawItems = Array.isArray(context?.items) ? (context!.items as any[]) : [];
      const items: BulkItem[] = rawItems.map((it) =>
        typeof it === "string"
          ? { contentId: "", source: "library" as const, name: it }
          : (it as BulkItem)
      );

      if (isConfirmationMessage(incomingText)) {
        clearPendingQuestion(sender);
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
        const archived: string[] = [];
        const failed: string[] = [];

        for (const item of items) {
          try {
            // Prefer exact-ID archive when we have contentId + source from
            // the fuzzy match. Falls back to name-based archive for stale
            // items from an older state format (which don't carry an id).
            const result = item.contentId
              ? await archiveContentByContentId(spreadsheetId, item.contentId, item.source)
              : await archiveContentIdea(spreadsheetId, item.name);
            if (result) archived.push(result.archivedName);
            else failed.push(item.name);
          } catch (err) {
            console.error(`[bulk_archive_confirm] archive failed for "${item.name}": ${err}`);
            failed.push(item.name);
          }
        }

        const lines: string[] = [];
        if (archived.length > 0) {
          lines.push(
            archived.length === 1
              ? `אין בעיה. שמרתי את "${archived[0]}" בצד.`
              : `אין בעיה. שמרתי בצד ${archived.length} רעיונות:`
          );
          if (archived.length > 1) {
            archived.forEach((name) => lines.push(`- ${name}`));
          }
        }
        if (failed.length > 0) {
          lines.push("");
          lines.push("לא הצלחתי להעביר את:");
          failed.forEach((name) => lines.push(`- ${name}`));
        }

        await sendTurnReply(sender, lines.join("\n"));
        return res.status(200).json({
          status: "bulk_archive_done",
          sender,
          archived,
          failed,
        });
      }

      if (isRejectionMessage(incomingText) || /^\s*(לא|בטל|ביטול)\s*[,.!?]?\s*$/i.test(incomingText)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "בסדר, לא מעבירה כלום.");
        return res.status(200).json({ status: "bulk_archive_cancelled", sender });
      }

      // Anything else — repeat the confirmation prompt, don't lose state.
      const promptLines = [
        `מחכה לאישור על ${items.length === 1 ? "הרעיון" : `${items.length} הרעיונות`} להעברה לארכיון.`,
        "לענות: כן / לא",
      ];
      await sendTurnReply(sender, promptLines.join("\n"));
      return res.status(200).json({ status: "bulk_archive_awaiting_confirmation", sender });
    }

      if (pendingQuestion?.questionType === "edit_or_new_clarification") {
        // A concrete edit request IS the answer (23.7.2026). Karen replies to
        // "edit or new?" by simply stating the edit ("תשני את הטון להומוריסטי"),
        // which used to leave her stuck in the clarification loop.
        const isExplicitCommandWhileClarifying =
          isArchiveCommand(incomingText) ||
          isApproveForProductionCommand(incomingText) ||
          isRestoreCommand(incomingText) ||
          isDeadlineUpdate(incomingText) ||
          isEditRequest(incomingText);

        if (isExplicitCommandWhileClarifying) {
          clearPendingQuestion(sender);
          console.log(`[Route Debug] edit_or_new_clarification: explicit command detected, falling through`);
        } else {
        const rawAnswer = incomingText.trim().toLowerCase();
        const wantsEdit = ["לערוך", "לערוך את הנוכחי", "את הנוכחי", "הנוכחי", "עריכה"].some(
          (phrase) => rawAnswer.includes(phrase)
        );
        // Audit F6: the bare word "חדש" was removed as a trigger — it matched
        // as a substring inside answers that actually ask to KEEP the draft
        // ("תשאירי את הרעיון אבל תני זווית חדשה"), silently discarding it.
        // Only explicit open-a-new-idea phrasings count.
        const wantsNew = ["לפתוח חדש", "רעיון חדש", "משהו חדש", "נתחיל חדש", "להתחיל חדש", "תתחילי חדש"].some((phrase) => rawAnswer.includes(phrase));

        // Natural confirmation phrases should also exit the clarification.
        // If Karen answers with something like "בעצם כן, בואי נשמור" she
        // wants to save the pending draft — the router shouldn't demand
        // the exact word "לערוך" or "חדש" to unlock this state.
        const wantsSave = [
          "בואי נשמור",
          "בוא נשמור",
          "תשמרי",
          "לשמור",
          "נשמור",
          "בעצם כן",
          "כן תשמרי",
          "כן שמרי",
          "אישור",
          "מאשרת",
        ].some((phrase) => rawAnswer.includes(phrase));

        const draftForClarification = getPendingConfirmation(sender);

        if (wantsSave && draftForClarification) {
          clearPendingQuestion(sender);
          console.log(`[Route Debug] edit_or_new_clarification: user confirmed save, falling through to confirmation handler`);
          // Fall through — the confirmation handler downstream will detect
          // the pending draft and the "yes" intent and save it.
        } else if (wantsEdit && draftForClarification) {
          clearPendingQuestion(sender);
          const replyText = "בסדר, מה תרצי לשנות בכיוון הנוכחי?";
          await sendTurnReply(sender, replyText);
          return res.status(200).json({ status: "edit_clarification_resolved_edit", sender });
        }

        if (wantsNew) {
          clearPendingQuestion(sender);
          clearPendingConfirmation(sender);
          const replyText = "בסדר, עזבנו את הרעיון הקודם. תכתבי לי את הרעיון החדש.";
          await sendTurnReply(sender, replyText);
          return res.status(200).json({ status: "edit_clarification_resolved_new", sender });
        }

        storePendingQuestion(sender, { questionType: "edit_or_new_clarification", context: {} });

        const replyText = [
          "לא בטוחה למה התכוונת.",
          "",
          "אפשר לענות:",
          "לערוך את הרעיון הנוכחי",
          "",
          "או:",
          "לפתוח רעיון חדש",
        ].join("\n");

        await sendTurnReply(sender, replyText);
        return res.status(200).json({ status: "edit_or_new_clarification_still_unclear", sender });
        }
      }

      if (pendingQuestion?.questionType === "overdue_pick_which") {
        // Karen picked which overdue item she meant, after we asked because
        // several were overdue. Complete the remembered action (currently only
        // "published") on the chosen item.
        const { action, options } = pendingQuestion.context as any;
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
        const rawAnswer = incomingText.trim();
        const normalizedAnswer = rawAnswer.toLowerCase();
        if (["ביטול", "בטלי", "עזבי", "עזוב", "לא עכשיו", "אחר כך", "אחכ", 'אח"כ'].includes(normalizedAnswer)) {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, "בסדר, השארתי את זה פתוח כרגע.");
          return res.status(200).json({ status: "overdue_pick_which_cancelled", sender });
        }
        // Resolve the pick to one of the offered titles: accept an exact-ish
        // name, or a 1-based number from the list.
        const opts: string[] = Array.isArray(options) ? options : [];
        let chosenTitle = "";
        const asNumber = parseInt(rawAnswer, 10);
        if (!isNaN(asNumber) && asNumber >= 1 && asNumber <= opts.length) {
          chosenTitle = opts[asNumber - 1];
        } else {
          // Exact match first, then a contains match either way, so Karen can
          // type the full title or a distinctive part of it.
          const answer = rawAnswer.trim();
          const exact = opts.find((o) => o.trim() === answer);
          if (exact) {
            chosenTitle = exact;
          } else {
            const partial = opts.find(
              (o) => o.includes(answer) || answer.includes(o.trim())
            );
            if (partial) chosenTitle = partial;
          }
        }
        if (!chosenTitle) {
          await sendTurnReply(
            sender,
            [
              "לא זיהיתי לאיזה מהם. אפשר לכתוב את השם המלא, או מספר מהרשימה:",
              "",
              ...opts,
            ].join("\n")
          );
          return res.status(200).json({ status: "overdue_pick_which_unclear", sender });
        }
        // Find the contentId for the chosen title from the live overdue list.
        const overdueNow = await fetchOverdueDecisionItems();
        const chosen = overdueNow.find(
          (it) => (it.displayTitle || "").toString().trim() === chosenTitle.trim()
        );
        if (!chosen) {
          clearPendingQuestion(sender);
          await sendTurnReply(
            sender,
            `כבר לא מצאתי את "${chosenTitle}" ברשימת האיחורים. ייתכן שהוא כבר טופל.`
          );
          return res.status(200).json({ status: "overdue_pick_which_gone", sender });
        }
        if (action === "published") {
          clearPendingQuestion(sender);
          await markOverdueItemPublished(spreadsheetId, chosen.contentId);
          await sendTurnReply(
            sender,
            `סימנתי ש-"${chosen.displayTitle}" עלה. הוא לא יופיע יותר בתזכורות האיחור.`
          );
          return res.status(200).json({ status: "overdue_pick_which_published", sender });
        }
        // Unknown action (should not happen for now): clear and fall through.
        clearPendingQuestion(sender);
      }
      if (pendingQuestion?.questionType === "overdue_reschedule_date") {
        const { contentId, contentName } = pendingQuestion.context as any;
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
        const rawAnswer = incomingText.trim();
        const normalizedAnswer = rawAnswer.toLowerCase();
        const isExplicitCommandWhileChoosingOverdueRescheduleDate =
          isArchiveCommand(incomingText) ||
          isApproveForProductionCommand(incomingText) ||
          isRestoreCommand(incomingText) ||
          isDeadlineUpdate(incomingText);

        if (isExplicitCommandWhileChoosingOverdueRescheduleDate) {
          clearPendingQuestion(sender);
          console.log(`[Route Debug] overdue_reschedule_date: explicit command detected, falling through`);
        } else {

        if (["ביטול", "בטלי", "עזבי", "עזוב", "לא עכשיו", "אחר כך", "אחכ", 'אח"כ'].includes(normalizedAnswer)) {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, "בסדר, לא מעבירה את התוכן כרגע.");
          return res.status(200).json({
            status: "overdue_reschedule_cancelled",
            sender,
          });
        }

        const normalizedDate = normalizeUserDateInput(rawAnswer);

        if (!normalizedDate) {
          await sendTurnReply(
            sender,
            "לא קלטתי תאריך. אפשר לכתוב למשל 18/6."
          );
          return res.status(200).json({
            status: "overdue_reschedule_invalid_date",
            sender,
          });
        }

        const collision = await isGanttDateTaken(spreadsheetId, normalizedDate);

        if (collision.taken && collision.existingContentId !== contentId) {
          await sendTurnReply(
            sender,
            `${normalizedDate} כבר תפוס על ידי "${collision.existingName}". לאיזה תאריך אחר להעביר?`
          );
          return res.status(200).json({
            status: "overdue_reschedule_date_taken",
            sender,
          });
        }

        clearPendingQuestion(sender);
        await updateGanttRowDate(
          spreadsheetId,
          contentId,
          normalizedDate,
          getHebrewDayName(normalizedDate)
        );
        await sortGanttByDate(spreadsheetId);

        await sendTurnReply(
          sender,
          `סגור, העברתי את "${contentName}" ל-${normalizedDate}.`
        );

        return res.status(200).json({
          status: "overdue_rescheduled",
          sender,
        });
        }
      }

      if (pendingQuestion?.questionType === "planning_source_routing") {
        const state = pendingQuestion.context as PlanningSourceRoutingState;
        const isExplicitCommandWhilePlanningSourceRouting =
          isArchiveCommand(incomingText) ||
          isApproveForProductionCommand(incomingText) ||
          isRestoreCommand(incomingText) ||
          isDeadlineUpdate(incomingText);

        if (isExplicitCommandWhilePlanningSourceRouting) {
          clearPendingQuestion(sender);
          console.log(`[Route Debug] planning_source_routing: explicit command detected, falling through`);
        } else {
        const result = handlePlanningSourceRoutingReply(state, incomingText);

        if (result.action === "next_source") {
          storePendingQuestion(sender, {
            questionType: "planning_source_routing",
            context: result.state,
          });

          await sendTurnReply(sender, result.message);

          return res.status(200).json({
            status: "planning_source_routing_next_source",
            sender,
          });
        }

        if (result.action === "clarify") {
          storePendingQuestion(sender, {
            questionType: "planning_source_routing",
            context: state,
          });

          await sendTurnReply(sender, result.message);

          return res.status(200).json({
            status: "planning_source_routing_clarify",
            sender,
          });
        }

        if (result.action === "new_idea" || result.action === "cancelled") {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, result.message);

          return res.status(200).json({
            status: `planning_source_routing_${result.action}`,
            sender,
          });
        }

        if (result.action === "selected") {
          clearPendingQuestion(sender);

          if (result.source === "ideaBank") {
            await sendTurnReply(
              sender,
              [
                `סבבה, נתחיל מהרעיון "${result.option.title}".`,
                "",
                "זה עדיין מבנק הרעיונות, אז קודם צריך להפוך אותו לתוכן מאושר.",
                "השלב הבא הוא לאשר/להעביר אותו במסלול מהיר, ואז נוכל להכניס אותו לגאנט.",
              ].join("\n")
            );

            return res.status(200).json({
              status: "planning_source_routing_idea_selected",
              sender,
            });
          }

          if (!result.option.contentId) {
            storePendingQuestion(sender, {
              questionType: "planning_source_routing",
              context: state,
            });

            await sendTurnReply(
              sender,
              "חסר לי Content ID לתוכן הזה. תבחרי פריט אחר מהרשימה או כתבי ביטול."
            );

            return res.status(200).json({
              status: "planning_source_routing_missing_content_id",
              sender,
            });
          }

          const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
          if (!spreadsheetId) {
            throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
          }

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const nextWeekStart = new Date(today);
          nextWeekStart.setDate(today.getDate() - today.getDay() + 7);
          nextWeekStart.setHours(0, 0, 0, 0);

          const nextWeekEnd = new Date(nextWeekStart);
          nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
          nextWeekEnd.setHours(23, 59, 59, 999);

          const formatDate = (date: Date): string =>
            `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;

          const seedDates = [formatDate(nextWeekStart)];
          if (nextWeekEnd.getMonth() !== nextWeekStart.getMonth()) {
            seedDates.push(formatDate(nextWeekEnd));
          }

          const availableBatches = await Promise.all(
            seedDates.map((seedDate) => findAvailableDatesInMonth(spreadsheetId, seedDate))
          );

          const availableDates = Array.from(new Set(availableBatches.reduce<string[]>((all, batch) => all.concat(batch), [])))
            .filter((candidateDate) => {
              const parts = candidateDate.split("/");
              const parsed = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
              parsed.setHours(0, 0, 0, 0);
              return parsed >= nextWeekStart && parsed <= nextWeekEnd;
            })
            .sort((a, b) => {
              const aParts = a.split("/");
              const bParts = b.split("/");
              const aDate = new Date(parseInt(aParts[2]), parseInt(aParts[1]) - 1, parseInt(aParts[0]));
              const bDate = new Date(parseInt(bParts[2]), parseInt(bParts[1]) - 1, parseInt(bParts[0]));
              return aDate.getTime() - bDate.getTime();
            });

          if (availableDates.length === 0) {
            await sendTurnReply(
              sender,
              [
                `בחרתי את "${result.option.title}", אבל לא מצאתי תאריך פנוי בשבוע הבא.`,
                "",
                "אפשר לכתוב תאריך ידנית, לבחור תוכן אחר, או לבטל.",
              ].join("\n")
            );

            storePendingQuestion(sender, {
              questionType: "gantt_write_new_date",
              context: {
                newContentId: result.option.contentId,
                newContentName: result.option.title,
                suggestedDate: formatDate(nextWeekStart),
                suggestedDayName: getHebrewDayNameFromDate(nextWeekStart),
                alternatives: [],
                ganttStatus: "בתכנון",
              },
            });

            return res.status(200).json({
              status: "planning_source_routing_no_next_week_dates",
              sender,
            });
          }

          const suggestedDate = availableDates[0];
          const suggestedDayName = getHebrewDayName(suggestedDate);

          storePendingQuestion(sender, {
            questionType: "gantt_write_new_date",
            context: {
              newContentId: result.option.contentId,
              newContentName: result.option.title,
              suggestedDate,
              suggestedDayName,
              alternatives: availableDates.slice(0, 5),
              ganttStatus: "בתכנון",
            },
          });

          await sendTurnReply(
            sender,
            [
              `סבבה, נלך על "${result.option.title}".`,
              "",
              `מצאתי תאריך פנוי בשבוע הבא: ${suggestedDate} (יום ${suggestedDayName}).`,
              "",
              "אפשר לענות כן, לכתוב תאריך אחר, לכתוב תוכן אחר, או ביטול.",
            ].join("\n")
          );

          return res.status(200).json({
            status: "planning_source_routing_date_suggested",
            sender,
          });
        }
        }
      }
    const duplicateSensitivePendingTypes = new Set([
      "gantt_collision",
      "gantt_move_existing",
      "gantt_write_new_date",
      "confirm_gantt_write",
    ]);

    if (
      pendingQuestion &&
      duplicateSensitivePendingTypes.has(pendingQuestion.questionType)
    ) {
      const context = pendingQuestion.context as any;
      const pendingContentId =
        context?.newContentId || context?.contentId;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      if (
        pendingContentId &&
        await blockDuplicateGanttWrite(
          sender,
          spreadsheetId,
          pendingContentId
        )
      ) {
        return res.status(200).json({
          status: "gantt_duplicate_blocked",
          sender,
        });
      }
    }
   if (pendingQuestion?.questionType === "gantt_collision") {
      const { newContentId, newContentName, newDate, newDayName, existingContentId, existingName, ganttStatus } = pendingQuestion.context as any;
      const isExplicitCommandWhileResolvingGanttCollision =
        isArchiveCommand(incomingText) ||
        isApproveForProductionCommand(incomingText) ||
        isRestoreCommand(incomingText) ||
        isDeadlineUpdate(incomingText);

      if (isExplicitCommandWhileResolvingGanttCollision) {
        clearPendingQuestion(sender);
        console.log(`[Route Debug] gantt_collision: explicit command detected, falling through`);
      } else {
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      if (isConfirmationMessage(incomingText)) {
        clearPendingQuestion(sender);
        // קרן רוצה להחליף — כניסת Y לתאריך, הזזת X למקום חדש
        const available = await findAvailableDatesInMonth(spreadsheetId, newDate);
        const suggested = available[0];

        if (!suggested) {
          await addRowToGantt(spreadsheetId, newContentId, newContentName, newDate, newDayName, "", ganttStatus || "בתכנון");
          await sortGanttByDate(spreadsheetId);
          storePendingQuestion(sender, {
            questionType: "gantt_upload_time",
            context: { contentName: newContentName, date: newDate },
          });
          const shortNew = newContentName.split(/\s+/).slice(0, 6).join(" ");
          await sendTurnReply(sender, `מעולה, הוספתי את "${shortNew}" ב-${newDate}.\nלא מצאתי חור פנוי אחר באותו חודש ל-"${existingName.split(/\s+/).slice(0, 6).join(" ")}". אפשר לעדכן ידנית.\nבאיזו שעה לתכנן את ההעלאה?`);
          return res.status(200).json({ status: "gantt_collision_replaced_no_slot", sender });
        }

        const suggestedDayName = getHebrewDayName(suggested);
        const shortExisting = existingName.split(/\s+/).slice(0, 6).join(" ");

        storePendingQuestion(sender, {
          questionType: "gantt_move_existing",
          context: {
            newContentId, newContentName, newDate, newDayName,
            existingContentId, existingName,
            suggestedDate: suggested, suggestedDayName,
            ganttStatus,
          },
        });
        await sendTurnReply(sender, `אעביר את "${shortExisting}" ל-${suggested} (יום ${suggestedDayName}). מאשרת?`);
        return res.status(200).json({ status: "gantt_collision_suggest_move", sender });
      }

      if (isRejectionMessage(incomingText)) {
        clearPendingQuestion(sender);
        // קרן לא רוצה להחליף — מחפש מקום חדש ל-Y
        const available = await findAvailableDatesInMonth(spreadsheetId, newDate);
        const suggested = available[0];

        if (!suggested) {
          await sendTurnReply(sender, `לא מצאתי תאריך פנוי באותו חודש. תוכלי לבחור תאריך ידנית.`);
          return res.status(200).json({ status: "gantt_collision_no_slot", sender });
        }

        const suggestedDayName = getHebrewDayName(suggested);
        const shortNew = newContentName.split(/\s+/).slice(0, 6).join(" ");

        storePendingQuestion(sender, {
          questionType: "gantt_write_new_date",
          context: { newContentId, newContentName, suggestedDate: suggested, suggestedDayName, ganttStatus },
        });
        await sendTurnReply(sender, `הזמן הפנוי הקרוב הוא ${suggested} (יום ${suggestedDayName}). נכניס את "${shortNew}" שם?`);
        return res.status(200).json({ status: "gantt_collision_suggest_new_date", sender });
      }

      const shortNew = newContentName.split(/\s+/).slice(0, 6).join(" ");
      const shortExisting = existingName.split(/\s+/).slice(0, 6).join(" ");

      await sendTurnReply(
        sender,
        [
          `לא בטוחה אם להחליף בין "${shortNew}" לבין "${shortExisting}".`,
          "",
          "אפשר לענות כן, לא, או לכתוב פקודה אחרת.",
        ].join("\n")
      );

      return res.status(200).json({ status: "gantt_collision_unclear", sender });
      }
    }

    if (pendingQuestion?.questionType === "gantt_move_existing") {
      const { newContentId, newContentName, newDate, newDayName, existingContentId, existingName, suggestedDate, suggestedDayName, ganttStatus } = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const isExplicitCommandWhileMovingExistingGanttItem =
        isArchiveCommand(incomingText) ||
        isApproveForProductionCommand(incomingText) ||
        isRestoreCommand(incomingText) ||
        isDeadlineUpdate(incomingText);

      if (isExplicitCommandWhileMovingExistingGanttItem) {
        clearPendingQuestion(sender);
        console.log(`[Route Debug] gantt_move_existing: explicit command detected, falling through`);
      } else {
      const confirmedSuggestedDate = isConfirmationMessage(incomingText);
      const targetDate = confirmedSuggestedDate
        ? suggestedDate
        : normalizeUserDateInput(incomingText.trim());

      if (!targetDate) {
        await sendTurnReply(sender, "לא קלטתי תאריך תקין. אפשר לכתוב למשל 17.6, 17-6 או 17/6.");
        return res.status(200).json({ status: "gantt_move_invalid_date", sender });
      }

      clearPendingQuestion(sender);
      const targetDayName = confirmedSuggestedDate ? suggestedDayName : getHebrewDayName(targetDate);

      await updateGanttRowDate(spreadsheetId, existingContentId, targetDate, targetDayName);
      await addRowToGantt(spreadsheetId, newContentId, newContentName, newDate, newDayName, "", ganttStatus || "בתכנון");
      await sortGanttByDate(spreadsheetId);
      storePendingQuestion(sender, {
        questionType: "gantt_upload_time",
        context: { contentName: newContentName, date: newDate },
      });
      const shortExisting = existingName.split(/\s+/).slice(0, 6).join(" ");
      const shortNew = newContentName.split(/\s+/).slice(0, 6).join(" ");
      await sendTurnReply(sender, `מעולה! העברתי את "${shortExisting}" ל-${targetDate} והוספתי את "${shortNew}" ל-${newDate}.\nבאיזו שעה לתכנן את ההעלאה?`);
      return res.status(200).json({ status: "gantt_move_confirmed", sender });
      }
    }

   if (pendingQuestion?.questionType === "gantt_write_new_date") {
  const {
    newContentId,
    newContentName,
    suggestedDate,
    suggestedDayName,
    ganttStatus,
    alternatives = [],
    monthlyPlanning,
  } = pendingQuestion.context as any;

  const originalContext = pendingQuestion.context;
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
  const rawAnswer = incomingText.trim();

  const isExplicitCommandWhileChoosingGanttDate =
    isArchiveCommand(incomingText) ||
    isApproveForProductionCommand(incomingText) ||
    isRestoreCommand(incomingText) ||
    isDeadlineUpdate(incomingText);

  if (isExplicitCommandWhileChoosingGanttDate) {
    clearPendingQuestion(sender);
    console.log(`[Route Debug] gantt_write_new_date: explicit command detected, falling through`);
  } else {

  if (["ביטול", "עזבי", "עזוב", "לא משנה", "תבטלי"].includes(rawAnswer)) {
    clearPendingQuestion(sender);
    await sendTurnReply(sender, "סבבה, לא הכנסתי. אפשר לחזור לזה אחר כך.");
    return res.status(200).json({ status: "gantt_write_new_date_cancelled", sender });
  }

  if (isRejectionMessage(incomingText)) {
    storePendingQuestion(sender, {
      questionType: "gantt_write_new_date",
      context: originalContext,
    });

    await sendTurnReply(
      sender,
      [
        "בסדר, לא הכנסתי בתאריך הזה.",
        "",
        "אפשר לכתוב תאריך אחר,",
        "לכתוב: תוכן אחר",
        "או לכתוב: ביטול",
      ].join("\n")
    );

    return res.status(200).json({ status: "gantt_write_new_date_rejected_date", sender });
  }

  if (["תוכן אחר", "תוכן אחר מהרשימה", "משהו אחר", "אחר"].includes(rawAnswer)) {
    let planningContext = monthlyPlanning;

    if (!planningContext) {
      const dateForPlanning = suggestedDate || alternatives[0];
      const parts = dateForPlanning.split("/");
      const month = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);

      const monthNamesByNumber: Record<number, string> = {
        1: "ינואר",
        2: "פברואר",
        3: "מרץ",
        4: "אפריל",
        5: "מאי",
        6: "יוני",
        7: "יולי",
        8: "אוגוסט",
        9: "ספטמבר",
        10: "אוקטובר",
        11: "נובמבר",
        12: "דצמבר",
      };

      const remainingContent = await getApprovedContentNotInGantt(spreadsheetId, month, year);

      planningContext = {
        month,
        year,
        monthName: monthNamesByNumber[month] || "החודש",
        remainingContent,
      };
    }

    const { month, year, monthName, remainingContent } = planningContext;

    storePendingQuestion(sender, {
      questionType: "monthly_planning",
      context: { month, year, monthName, remainingContent },
    });

    const displayList = (remainingContent as any[])
      .slice(0, 5)
      .map((c: any) => `- ${c.name.split(/\s+/).slice(0, 6).join(" ")}`)
      .join("\n");

    await sendTurnReply(
      sender,
      [
        `אין בעיה, נחזור לבחור תוכן אחר ל${monthName}.`,
        "",
        "מה עוד מחכה לתאריך:",
        displayList || "לא מצאתי כרגע תכנים נוספים שמחכים לתאריך.",
        "",
        "כתבי שם של תוכן מהרשימה.",
      ].join("\n")
    );

    return res.status(200).json({ status: "monthly_planning_back_to_content_choice", sender });
  }

  let targetDate = suggestedDate;
  let targetDayName = suggestedDayName;

  if (isConfirmationMessage(incomingText)) {
    targetDate = suggestedDate;
    targetDayName = suggestedDayName;
  } else {
    const numericChoice = /^\d+$/.test(rawAnswer) ? parseInt(rawAnswer, 10) : null;

    if (numericChoice !== null && alternatives[numericChoice - 1]) {
      targetDate = alternatives[numericChoice - 1];
    } else {
      targetDate = normalizeUserDateInput(rawAnswer) || "";
    }

    if (!targetDate) {
      storePendingQuestion(sender, {
        questionType: "gantt_write_new_date",
        context: originalContext,
      });

      await sendTurnReply(
        sender,
        [
          "לא קלטתי תאריך תקין.",
          "",
          "אפשר לענות במספר מהרשימה, למשל 1 או 2,",
          "או לכתוב תאריך מלא כמו 18/06/2026.",
          "",
          "אם תרצי לבחור תוכן אחר, כתבי: תוכן אחר",
          "אם תרצי לעצור, כתבי: ביטול",
        ].join("\n")
      );

      return res.status(200).json({ status: "gantt_write_new_date_invalid_date", sender });
    }

    const targetParts = targetDate.split("/");
    const parsedTarget = new Date(
      parseInt(targetParts[2]),
      parseInt(targetParts[1]) - 1,
      parseInt(targetParts[0])
    );

    targetDayName = getHebrewDayNameFromDate(parsedTarget);
  }

  clearPendingQuestion(sender);

  const productionDeadline = await addRowToGantt(
    spreadsheetId,
    newContentId,
    newContentName,
    targetDate,
    targetDayName,
    "",
    ganttStatus || "בתכנון"
  );

  await sortGanttByDate(spreadsheetId);

  storePendingQuestion(sender, {
    questionType: "gantt_upload_time",
    context: {
      contentId: newContentId,
      contentName: newContentName,
      date: targetDate,
      monthlyPlanning,
    },
  });

  const shortNew = newContentName.split(/\s+/).slice(0, 6).join(" ");

  await sendTurnReply(
    sender,
    [
      `מעולה, הוספתי את "${shortNew}" לגאנט ב-${targetDate} (יום ${targetDayName}).`,
      productionDeadline ? `דדליין הפקה: ${productionDeadline}.` : "",
      "",
      "באיזו שעה לתכנן את ההעלאה?",
    ].filter(Boolean).join("\n")
  );

  return res.status(200).json({ status: "gantt_write_new_date_confirmed", sender });
}
}
    
if (pendingQuestion?.questionType === "monthly_planning") {
  const { month, year, monthName, remainingContent } = pendingQuestion.context as any;

  // יציאה מתכנון חודש
  if (isRejectionMessage(incomingText) || ["סיימתי", "עצרי", "עצור", "זהו", "מספיק"].includes(incomingText.trim())) {
    clearPendingQuestion(sender);
    await sendTurnReply(sender, `סיימנו את תכנון ${monthName}. אפשר תמיד לחזור ולהוסיף עוד.`);
    return res.status(200).json({ status: "monthly_planning_done", sender });
  }

  // אם קרן ענתה כן - נתחיל מהתוכן הראשון שהצעתי
  if (isConfirmationMessage(incomingText)) {
    const firstContent = (remainingContent as any[])[0];

    if (!firstContent) {
      clearPendingQuestion(sender);
      await sendTurnReply(sender, `לא נשארו תכנים שמחכים לתאריך ב${monthName}.`);
      return res.status(200).json({ status: "monthly_planning_no_remaining_content", sender });
    }

    const monthlySpreadsheetId = process.env.GOOGLE_SHEETS_ID!;
    const nearest = await findNearestAvailableGanttDate(monthlySpreadsheetId, month, year);

    if (!nearest) {
      await sendTurnReply(sender, `לא מצאתי תאריך פנוי קרוב ב${monthName}. אפשר לבחור תאריך ידנית.`);
      return res.status(200).json({ status: "monthly_planning_no_available_date", sender });
    }

    const suggestedDate = nearest.date;
    const suggestedDayName = nearest.dayName;

   storePendingQuestion(sender, {
  questionType: "confirm_gantt_write",
  context: {
    contentId: firstContent.contentId,
    contentName: firstContent.name,
    date: suggestedDate,
    dayName: suggestedDayName,
    ganttStatus: "בתכנון",
    monthlyPlanning: {
      month,
      year,
      monthName,
      remainingContent,
    },
  },
});

    const shortName = firstContent.name.split(/\s+/).slice(0, 6).join(" ");

    await sendTurnReply(
      sender,
      [
        "מצאתי לו תאריך פנוי קרוב:",
        `${suggestedDate}, יום ${suggestedDayName}.`,
        "",
        `להכניס את "${shortName}" לתאריך הזה?`,
        "",
        "אפשר לענות כן או לא.",
      ].join("\n")
    );

    return res.status(200).json({ status: "monthly_planning_suggested_date", sender });
  }

  // אם קרן כתבה שם של תוכן אחר מהרשימה
  const normalizeMonthlyPlanningText = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/[״"]/g, "")
      .replace(/\s+/g, " ");

  const getContentDisplayName = (content: any): string =>
    (
      content.name ||
      content.idea ||
      content.shortName ||
      content.contentName ||
      ""
    )
      .toString()
      .trim();

  const monthlyPlanningVisibilityIntent = detectVisibilityIntent(incomingText);
  const monthlyPlanningLikelyVisibilityQuestion = isLikelyVisibilityQuery(incomingText);

  if (monthlyPlanningVisibilityIntent || monthlyPlanningLikelyVisibilityQuestion) {
    storePendingQuestion(sender, { questionType: "monthly_planning", context: { month, year, monthName, remainingContent } });

    await sendTurnReply(
      sender,
      [
        `אני עדיין בתוך תכנון ${monthName}, אז לא אשבץ את זה כתוכן.`,
        "",
        "כדי לא לשבש את התכנון, אפשר לבחור שם של תוכן מהרשימה או לכתוב שיבוץ מלא עם תאריך.",
        "",
        "אם רצית לצאת רגע ולבדוק סטטוס, כתבי סיימתי ואז שאלי אותי.",
      ].join("\n")
    );

    return res.status(200).json({ status: "monthly_planning_visibility_query_guarded", sender });
  }

  const normalizedChoice = normalizeMonthlyPlanningText(incomingText);

  const chosenContent = (remainingContent as any[]).find((content) => {
    const displayName = getContentDisplayName(content);

    if (!displayName) {
      return false;
    }

    const normalizedName = normalizeMonthlyPlanningText(displayName);
    const shortContentName = normalizedName.split(/\s+/).slice(0, 6).join(" ");

    const choiceWords = normalizedChoice.split(/\s+/).filter((word) => word.length > 1);
    const nameWords = normalizedName.split(/\s+/).filter(Boolean);
    const matchedWords = choiceWords.filter((word) => nameWords.includes(word));

    return (
      normalizedName.includes(normalizedChoice) ||
      normalizedChoice.includes(shortContentName) ||
      shortContentName.includes(normalizedChoice) ||
      (choiceWords.length > 0 && matchedWords.length === choiceWords.length) ||
      (choiceWords.length >= 3 && matchedWords.length >= 3)
    );
  });

  if (chosenContent) {
    const chosenContentName = getContentDisplayName(chosenContent);
    const monthlySpreadsheetId = process.env.GOOGLE_SHEETS_ID!;
    const nearest = await findNearestAvailableGanttDate(monthlySpreadsheetId, month, year);

    if (!nearest) {
      await sendTurnReply(sender, `לא מצאתי תאריך פנוי קרוב ב${monthName}. אפשר לבחור תאריך ידנית.`);
      return res.status(200).json({ status: "monthly_planning_no_available_date_for_choice", sender });
    }

    const suggestedDate = nearest.date;
    const suggestedDayName = nearest.dayName;

    storePendingQuestion(sender, {
      questionType: "confirm_gantt_write",
      context: {
        contentId: chosenContent.contentId,
        contentName: chosenContentName,
        date: suggestedDate,
        dayName: suggestedDayName,
        ganttStatus: "בתכנון",
        monthlyPlanning: {
          month,
          year,
          monthName,
          remainingContent,
        },
      },
    });

    const shortName = chosenContentName.split(/\s+/).slice(0, 6).join(" ");

    await sendTurnReply(
      sender,
      [
        "סבבה, נתחיל ממנו.",
        "",
        "מצאתי לו תאריך פנוי קרוב:",
        `${suggestedDate}, יום ${suggestedDayName}.`,
        "",
        `להכניס את "${shortName}" לתאריך הזה?`,
        "",
        "אפשר לענות כן או לא.",
      ].join("\n")
    );

    return res.status(200).json({ status: "monthly_planning_content_chosen", sender });
  }

  // אם קרן כתבה פקודת שיבוץ מלאה עם תאריך
  const params = extractGanttWriteParams(incomingText);
  if (!params) {
    storePendingQuestion(sender, { questionType: "monthly_planning", context: { month, year, monthName, remainingContent } });
    await sendTurnReply(
      sender,
      [
        "לא הבנתי איזה תוכן להכניס.",
        "",
        "אפשר לכתוב שם של תוכן מהרשימה, למשל:",
        "צילום שמלות",
        "",
        "או לכתוב שיבוץ מלא:",
        "תוסיפי את צילום שמלות לגאנט ב-17/06/2026",
      ].join("\n")
    );
    return res.status(200).json({ status: "monthly_planning_parse_error", sender });
  }

  const monthlySpreadsheetId = process.env.GOOGLE_SHEETS_ID!;
  const match = await findApprovedContentByName(monthlySpreadsheetId, params.contentName);

  if (!match) {
    storePendingQuestion(sender, { questionType: "monthly_planning", context: { month, year, monthName, remainingContent } });
    await sendTurnReply(sender, `לא מצאתי את "${params.contentName}" בתכנים שאושרו. תנסי שוב.`);
    return res.status(200).json({ status: "monthly_planning_not_found", sender });
  }

  if (
    await blockDuplicateGanttWrite(
      sender,
      monthlySpreadsheetId,
      match.contentId
    )
  ) {
    return res.status(200).json({
      status: "gantt_duplicate_blocked",
      sender,
    });
  }

  const collision = await isGanttDateTaken(monthlySpreadsheetId, params.date);
  if (collision.taken) {
    storePendingQuestion(sender, { questionType: "monthly_planning", context: { month, year, monthName, remainingContent } });
    const shortExisting = collision.existingName.split(/\s+/).slice(0, 6).join(" ");
    await sendTurnReply(sender, `ב-${params.date} כבר מתוכנן "${shortExisting}". תבחרי תאריך אחר.`);
    return res.status(200).json({ status: "monthly_planning_collision", sender });
  }

  const parsedDate = params.date.split("/");
  const dateObj = new Date(parseInt(parsedDate[2]), parseInt(parsedDate[1]) - 1, parseInt(parsedDate[0]));
  const dayName = getHebrewDayNameFromDate(dateObj);

  await addRowToGantt(monthlySpreadsheetId, match.contentId, match.name, params.date, dayName);
  await sortGanttByDate(monthlySpreadsheetId);

  const updatedRemaining = (remainingContent as any[]).filter((c: any) => c.contentId !== match.contentId);

  if (updatedRemaining.length === 0) {
    clearPendingQuestion(sender);
    await sendTurnReply(sender, `נשמר. כל התכנים שובצו ב${monthName}.`);
    return res.status(200).json({ status: "monthly_planning_complete", sender });
  }

  storePendingQuestion(sender, { questionType: "monthly_planning", context: { month, year, monthName, remainingContent: updatedRemaining } });

  const remainingText = updatedRemaining.length === 1
    ? "תוכן אחד שעוד לא שובץ"
    : `${updatedRemaining.length} תכנים שעוד לא שובצו`;

  await sendTurnReply(sender, `נשמר. יש עוד ${remainingText}. על מה הבא?`);
  return res.status(200).json({ status: "monthly_planning_item_saved", sender });
}
    if (pendingQuestion?.questionType === "gantt_upload_time") {
      const { contentId, contentName, date, monthlyPlanning } = pendingQuestion.context as any;
      const rawTimeInput = incomingText.trim();

      const continueMonthlyPlanning = async (prefixMessage: string) => {
        if (!monthlyPlanning) {
          await sendTurnReply(sender, prefixMessage);
          return res.status(200).json({ status: "gantt_upload_time_done", sender });
        }

        const { month, year, monthName, remainingContent } = monthlyPlanning;

        const updatedRemaining = (remainingContent as any[]).filter(
          (c: any) => c.contentId !== contentId
        );

        if (updatedRemaining.length === 0) {
          clearPendingQuestion(sender);
          await sendTurnReply(
            sender,
            [
              prefixMessage,
              "",
              `סגרנו את תכנון ${monthName}. כל התכנים מהרשימה שובצו.`,
            ].join("\n")
          );
          return res.status(200).json({ status: "monthly_planning_complete_after_upload_time", sender });
        }

        storePendingQuestion(sender, {
          questionType: "monthly_planning",
          context: {
            month,
            year,
            monthName,
            remainingContent: updatedRemaining,
          },
        });

        const displayList = updatedRemaining
          .slice(0, 5)
          .map((c: any) => `- ${c.name.split(/\s+/).slice(0, 6).join(" ")}`)
          .join("\n");

        await sendTurnReply(
          sender,
          [
            prefixMessage,
            "",
            `נשארו עוד ${updatedRemaining.length} תכנים שלא שובצו ב${monthName}.`,
            "",
            "מה עוד מחכה לתאריך:",
            displayList,
            "",
            "על מה הבא?",
            "אפשר לכתוב שם של תוכן מהרשימה.",
            "אם לא בא לך להמשיך עכשיו, כתבי: סיימתי",
          ].join("\n")
        );

        return res.status(200).json({ status: "monthly_planning_continue_after_upload_time", sender });
      };

      const isExplicitCommandWhileChoosingUploadTime =
        isArchiveCommand(incomingText) ||
        isApproveForProductionCommand(incomingText) ||
        isRestoreCommand(incomingText) ||
        isDeadlineUpdate(incomingText);

      if (isExplicitCommandWhileChoosingUploadTime) {
        clearPendingQuestion(sender);
        console.log(`[Route Debug] gantt_upload_time: explicit command detected, falling through`);
      } else {

      const skipUploadTime =
        isRejectionMessage(rawTimeInput) ||
        /^(דלגי|דלג|אחר כך|אח"כ|לא עכשיו|בלי שעה)$/i.test(rawTimeInput);

      if (skipUploadTime) {
        clearPendingQuestion(sender);
        return await continueMonthlyPlanning("בסדר, אפשר לעדכן שעה אחר כך ישירות בגיליון.");
      }

      // Flexible time extraction (21.7.2026): Karen writes "ב-11:00",
      // "בשעה 11:00", "ב11 ביום שישי" — all previously rejected because the
      // old regex required the whole message to be ONLY the number. Now we
      // extract the first HH or HH:MM occurrence from anywhere in the text.
      // Four-digit form first ("0400", "1830"): Karen writes it without a
      // colon, and the general pattern below rejects it because digits follow.
      const compactTime = rawTimeInput.match(/(?:^|[^\d])([01]\d|2[0-3])([0-5]\d)(?![\d:])/);
      const timeMatch = compactTime || rawTimeInput.match(/(?:^|[^\d])([01]?\d|2[0-3])(?::([0-5]\d))?(?![\d:])/);

      if (!timeMatch) {
        await sendTurnReply(
          sender,
          "לא קלטתי שעה תקינה. אפשר לכתוב פשוט את השעה — למשל 18:00, 8:30, או 11. אם לא רוצה לקבוע שעה עכשיו, כתבי דלגי."
        );
        return res.status(200).json({ status: "gantt_upload_time_invalid", sender });
      }

      const normalizedUploadTime = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2] ?? "00"}`;

      clearPendingQuestion(sender);
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      await updateGanttUploadTime(spreadsheetId, contentName, date, normalizedUploadTime);

      const shortTimeName = contentName.split(/\s+/).slice(0, 6).join(" ");

      return await continueMonthlyPlanning(
        `קבעתי את ההעלאה של "${shortTimeName}" ל-${normalizedUploadTime}.`
      );
      }
    }
    // Bridge (bank→gantt, step 1 — 12.7.2026): Karen just saved an idea and
    // was offered a nearby free gantt date. "Schedule" chains the two
    // EXISTING flows (approve-for-production + gantt write) with the agreed
    // date — no question is asked twice, and the existing upload-time and
    // collision flows take over from there. "Keep" leaves the idea in the
    // bank, full stop. See docs/feature-bank-to-gantt-bridge.md.
    // Gantt date-change collision follow-up (21.7.2026): Karen was told her
    // target date is taken and asked whether to find another. "כן" → nearest
    // free date in the month (step A: simple; the 2-per-week + 2-day-gap
    // smart logic is step B). A date in her reply → try that date directly.
    // Bank->production pick follow-up (21.7.2026): Karen was shown the open
    // ideas and replies with a name. Re-run approve on her pick. If it still
    // isn't found, re-offer once rather than looping silently.
    // Fast Lane trend scheduling follow-up (step 1 — 21.7.2026): Karen was
    // offered today/tomorrow for a trend. "היום"/"מחר"/"כן" → schedule the
    // first/second option; explicit date → use it; rejection → keep in bank.
    // Reuses approveContentForProduction + addRowToGantt + sort. A taken
    // reel-date is not overwritten (step 2 adds displacement).
    // Fast Lane make-room follow-up (step 2 — 21.7.2026): Karen picks which
    // organic reel to push. We move it to the nearest smart date and slot the
    // trend into the day the reel vacated (soonest slot). Single choice.
    // Fast Lane make-room follow-up (step 2, rebuilt 22.7.2026). Three modes:
    //  recommend  — one organic to move; "כן" executes, "לא" offers 3 dates.
    //  choose     — several organics; Karen names which to move.
    //  otherday   — all collab; "כן" schedules the trend on another day.
    // Status no-match follow-up (23.7.2026): Karen was shown what is actually
    // in production after her wording did not match. She either picks one of
    // the names, or says it is new and we fall through to the fast-track draft.
    if (pendingQuestion?.questionType === "status_no_match_pick") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const reply = incomingText.trim();

      // "תוכן חדש" (or a clear variant) → build the fast-track draft.
      if (/תוכן חדש|חדש לגמרי|זה חדש|משהו חדש/.test(reply)) {
        clearPendingQuestion(sender);
        const draft = await createContentDraft(ctx.attempted, sender);
        const draftSummary = { ...draft, originalUserInput: ctx.attempted, isFastTrack: true, statusTypes: ctx.statusTypes };
        storePendingConfirmation(sender, draftSummary);
        await sendTurnReply(
          sender,
          buildDraftPreviewMessage(draft, {
            intro: ["יופי, אז נוסיף אותו."],
            extraBeforeQuestion: [
              "אחרי אישור אכניס את זה ישר לתכנים שאושרו ואחפש לזה תאריך בגאנט.",
            ],
          })
        );
        return res.status(200).json({ status: "status_no_match_new_draft", sender });
      }

      // Otherwise: try to match her reply against the offered names.
      const picked = pickOfferedOption<string>(reply, ctx.options || [], name=>name);

      if (!picked) {
        await sendTurnReply(
          sender,
          buildAmbiguityQuestion({ kind: "notFound", itemType: "תכנים", location: "בין התכנים שבהפקה", options: ctx.options || [], offerNew: true })
        );
        return res.status(200).json({ status: "status_no_match_unclear", sender });
      }

      // Apply the original status update to the picked content.
      clearPendingQuestion(sender);
      const match = await findProductionTaskByName(spreadsheetId, picked);
      if (!match) {
        await sendTurnReply(sender, `משהו השתבש במציאת "${picked}". אפשר לנסות שוב.`);
        return res.status(200).json({ status: "status_no_match_lookup_failed", sender });
      }

      // findProductionTaskByName can return an ambiguous result; the picked
      // name came from our own list, so treat only a direct match as valid.
      if ("ambiguous" in (match as any)) {
        await sendTurnReply(sender, `נמצאו כמה תכנים בשם "${picked}". אפשר לכתוב את השם המלא?`);
        return res.status(200).json({ status: "status_no_match_ambiguous", sender });
      }
      const single = match as { rowIndex: number; row: string[] };

      // updateProductionStatus takes a column INDEX (C=3, D=4, E=5).
      const COLUMN_FOR_STATUS: Record<string, number> = {
        filmed: 3,
        edited: 4,
        cover_ready: 5,
      };
      const columnUpdates = (ctx.statusTypes || [])
        .map((st: any) => ({ statusType: st, columnIndex: COLUMN_FOR_STATUS[st], columnName: getColumnName(st) }))
        .filter((u: any) => typeof u.columnIndex === "number");

      for (const u of columnUpdates) {
        await updateProductionStatus(spreadsheetId, single.rowIndex, u.columnIndex);
      }
      const pickedContentId = (single.row?.[0] || "").toString().trim();
      if (pickedContentId) {
        try {
          await updateApprovedContentStatusById(spreadsheetId, pickedContentId, "ממתין לעריכה");
        } catch (syncError) {
          console.error(`[Status] approved-content sync skipped: ${syncError}`);
        }
      }

      const doneList = columnUpdates.map((u: any) => u.columnName).join(", ");
      await sendTurnReply(
        sender,
        `עדכנתי ש"${picked}" ${doneList.replace(/, ([^,]*)$/, " ו$1")}.`
      );
      return res.status(200).json({ status: "status_no_match_resolved", sender });
    }

    if (pendingQuestion?.questionType === "trend_make_room") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      const scheduleTrendAt = async (freedDate: string) => {
        try {
          await approveContentForProduction(spreadsheetId, ctx.contentName);
        } catch (e) {
          return false;
        }
        const dn = getHebrewDayName(freedDate);
        await addRowToGantt(spreadsheetId, ctx.contentId, ctx.contentName, freedDate, dn, "", "בתכנון");
        await sortGanttByDate(spreadsheetId);
        return true;
      };

      // ---- MODE: otherday (all blockers are collab) ----
      if (ctx.mode === "otherday") {
        if (isRejectionMessage(incomingText)) {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, `בסדר, "${ctx.contentName}" נשאר כרגע בלי תאריך. אם בא לך לתפוס אותו מאוחר יותר, כתבי לי.`);
          return res.status(200).json({ status: "trend_otherday_kept", sender });
        }
        const explicit = incomingText.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?/);
        // Only an explicit date or an actual yes may write to the sheet.
        // Anything else re-asks instead of assuming consent (23.7.2026).
        if (!explicit && !isConfirmationMessage(incomingText)) {
          await sendTurnReply(
            sender,
            `לא בטוחה אם לשבץ. אפשר לכתוב כן, תאריך אחר, או לא.`
          );
          return res.status(200).json({ status: "trend_otherday_unclear", sender });
        }
        const target = explicit ? normalizeUserDateInput(explicit[0]) : ctx.suggestedDate;
        if (!target) {
          await sendTurnReply(sender, `לא הצלחתי לקרוא את התאריך. אפשר לכתוב תאריך כמו 29/07/2026.`);
          return res.status(200).json({ status: "trend_otherday_bad_date", sender });
        }
        const ok = await scheduleTrendAt(target);
        clearPendingQuestion(sender);
        const dn = getHebrewDayName(target);
        await sendTurnReply(sender, ok
          ? [`סידרתי. הטרנד "${ctx.contentName}" נכנס ל-${target} (יום ${dn}).`, "", "כדאי לצלם ולערוך אותו מהר. אני אזכיר לך בבריף."].join("\n")
          : `משהו השתבש. "${ctx.contentName}" נשאר כרגע בלי תאריך. אפשר לנסות שוב.`);
        return res.status(200).json({ status: ok ? "trend_scheduled_otherday" : "trend_otherday_failed", sender });
      }

      // ---- MODE: recommend (one organic to move) ----
      if (ctx.mode === "recommend") {
        // "לא" → offer up to 3 alternative dates for the organic.
        if (isRejectionMessage(incomingText)) {
          const alts = (ctx.altDates || []).filter((d: string) => d !== ctx.suggestedDate).slice(0, 3);
          if (alts.length === 0) {
            clearPendingQuestion(sender);
            await sendTurnReply(sender, `אין לי כרגע תאריך חלופי פנוי. "${ctx.contentName}" נשאר כרגע בלי תאריך.`);
            return res.status(200).json({ status: "trend_recommend_no_alt", sender });
          }
          storePendingQuestion(sender, { questionType: "trend_make_room", context: { ...ctx, mode: "recommend_alt" } });
          await sendTurnReply(sender, [
            `הכול טוב. אפשר להעביר את "${ctx.organic.name}" לאחד מהתאריכים האלה:`,
            "",
            ...alts,
            "",
            `איזה מהם הכי מתאים לך?`,
          ].join("\n"));
          return res.status(200).json({ status: "trend_recommend_alts_offered", sender });
        }
        // "כן" / affirmative → execute the recommendation.
        const newDayName = getHebrewDayName(ctx.suggestedDate);
        await updateGanttRowDate(spreadsheetId, ctx.organic.contentId, ctx.suggestedDate, newDayName);
        const ok = await scheduleTrendAt(ctx.freedDate);
        clearPendingQuestion(sender);
        const freedDay = getHebrewDayName(ctx.freedDate);
        await sendTurnReply(sender, ok
          ? [`סידרתי:`, `• "${ctx.organic.name}" עבר ל-${ctx.suggestedDate} (יום ${newDayName}).`, `• הטרנד "${ctx.contentName}" נכנס ל-${ctx.freedDate} (יום ${freedDay}).`, "", "כדאי לצלם ולערוך את הטרנד מהר. אני אזכיר לך בבריף."].join("\n")
          : `הזזתי את "${ctx.organic.name}", אבל משהו השתבש בהכנסה לגאנט. אפשר לנסות שוב.`);
        return res.status(200).json({ status: ok ? "trend_recommended_done" : "trend_recommend_failed", sender });
      }

      // ---- MODE: recommend_alt (Karen chose an alternative date) ----
      if (ctx.mode === "recommend_alt") {
        const explicit = incomingText.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?/);
        const chosen = explicit ? normalizeUserDateInput(explicit[0]) : (ctx.altDates || []).find((d: string) => incomingText.includes(d));
        if (!chosen) {
          await sendTurnReply(sender, `לא זיהיתי תאריך. אפשר לכתוב אחד מהתאריכים שהצעתי, או תאריך משלך.`);
          return res.status(200).json({ status: "trend_recommend_alt_unclear", sender });
        }
        const dn = getHebrewDayName(chosen);
        await updateGanttRowDate(spreadsheetId, ctx.organic.contentId, chosen, dn);
        const ok = await scheduleTrendAt(ctx.freedDate);
        clearPendingQuestion(sender);
        const freedDay = getHebrewDayName(ctx.freedDate);
        await sendTurnReply(sender, ok
          ? [`סידרתי:`, `• "${ctx.organic.name}" עבר ל-${chosen} (יום ${dn}).`, `• הטרנד "${ctx.contentName}" נכנס ל-${ctx.freedDate} (יום ${freedDay}).`, "", "כדאי לצלם ולערוך את הטרנד מהר. אני אזכיר לך בבריף."].join("\n")
          : `הזזתי את "${ctx.organic.name}", אבל משהו השתבש בהכנסה לגאנט. אפשר לנסות שוב.`);
        return res.status(200).json({ status: ok ? "trend_recommended_alt_done" : "trend_recommend_alt_failed", sender });
      }

      // ---- MODE: choose (several organics) ----
      if (isRejectionMessage(incomingText)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, `בסדר, "${ctx.contentName}" נשאר כרגע בלי תאריך. אם בא לך לתפוס אותו, כתבי לי.`);
        return res.status(200).json({ status: "trend_choose_kept", sender });
      }
      const pick = incomingText.trim();
      const chosenReel = pickOfferedOption<any>(pick, ctx.reels || [], r=>r.name);
      if (!chosenReel) {
        const reelLines = (ctx.reels || []).map((r: any) => `"${r.name}"`).join("\n");
        await sendTurnReply(sender, [`לא זיהיתי איזה ריל. אפשר לכתוב את השם של אחד מאלה:`, "", reelLines].join("\n"));
        return res.status(200).json({ status: "trend_choose_unclear", sender });
      }
      const now = new Date();
      const firstOfMonth = `01/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
      const smartDates = await findSmartGanttDate(spreadsheetId, firstOfMonth, { forNewItemType: "ריל" });
      const freedDate = chosenReel.date;
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0,0,0,0);
      const futureSmartDates = smartDates.filter((d: string) => {
        const p = d.split("/"); return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])) >= tomorrow;
      });
      const newReelDate = futureSmartDates.find((d: string) => d !== freedDate) || futureSmartDates[0];
      if (!newReelDate) {
        await sendTurnReply(sender, `לא מצאתי תאריך פנוי להזיז אליו את "${chosenReel.name}". אפשר לנסות מאוחר יותר.`);
        return res.status(200).json({ status: "trend_choose_no_date", sender });
      }
      const newDayName = getHebrewDayName(newReelDate);
      await updateGanttRowDate(spreadsheetId, chosenReel.contentId, newReelDate, newDayName);
      const ok = await scheduleTrendAt(freedDate);
      clearPendingQuestion(sender);
      const freedDay = getHebrewDayName(freedDate);
      await sendTurnReply(sender, ok
        ? [`סידרתי:`, `• "${chosenReel.name}" עבר ל-${newReelDate} (יום ${newDayName}).`, `• הטרנד "${ctx.contentName}" נכנס ל-${freedDate} (יום ${freedDay}).`, "", "כדאי לצלם ולערוך את הטרנד מהר. אני אזכיר לך בבריף."].join("\n")
        : `הזזתי את "${chosenReel.name}", אבל משהו השתבש בהכנסה לגאנט. אפשר לנסות שוב.`);
      return res.status(200).json({ status: ok ? "trend_made_room" : "trend_choose_failed", sender });
    }

    // Trend date, written later (26.7.2026). After declining the immediate
    // slot the agent says "write me when", so a bare date has to land
    // somewhere. Anything that is not a date falls through to the escape hatch.
    if (pendingQuestion?.questionType === "trend_awaiting_date") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const explicit = incomingText.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?/);
      const chosen = explicit ? normalizeUserDateInput(explicit[0]) : null;

      if (!chosen) {
        await sendTurnReply(sender, "לא זיהיתי תאריך. אפשר לכתוב למשל 30/7.");
        return res.status(200).json({ status: "trend_awaiting_date_unclear", sender });
      }

      clearPendingQuestion(sender);
      let approveResult;
      try {
        approveResult = await approveContentForProduction(spreadsheetId, ctx.contentName);
      } catch (approveError) {
        await sendTurnReply(sender, `משהו השתבש בהעברה להפקה. אפשר לנסות שוב עם: תוסיפי את ${ctx.contentName} להפקה`);
        return res.status(200).json({ status: "trend_awaiting_date_approve_failed", sender });
      }

      const dn = getHebrewDayName(chosen);
      await addRowToGantt(spreadsheetId, approveResult.contentId, ctx.contentName, chosen, dn, "", "בתכנון");
      await sortGanttByDate(spreadsheetId);
      storePendingQuestion(sender, {
        questionType: "gantt_upload_time",
        context: { contentId: approveResult.contentId, contentName: ctx.contentName, date: chosen },
      });
      await sendTurnReply(
        sender,
        [`סגור, הכנסתי את "${ctx.contentName}" לגאנט ליום ${dn}, ${chosen}.`, "", "באיזו שעה לתכנן את ההעלאה?"].join("\n")
      );
      return res.status(200).json({ status: "trend_scheduled_later", sender });
    }

    if (pendingQuestion?.questionType === "trend_schedule") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      if (isRejectionMessage(incomingText)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender,"סגור, שמור בלי תאריך.");
        return res.status(200).json({ status: "trend_schedule_kept", sender });
      }

      let chosenDate: string | null = null;
      const explicit = incomingText.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?/);
      if (explicit) {
        chosenDate = normalizeUserDateInput(explicit[0]);
      } else if (incomingText.includes("מחר") && ctx.options.length > 1) {
        chosenDate = ctx.options[1];
      } else if (incomingText.includes("היום")) {
        chosenDate = ctx.options[0];
      } else if (isConfirmationMessage(incomingText)) {
        chosenDate = ctx.options[0];
      } else {
        // Anything that is not a date and not an actual yes must NOT write to
        // the sheet. "בסדר תודה" used to fall through here and schedule
        // silently (23.7.2026).
        const opts = ctx.options.map((d: string) => `${getHebrewDayName(d)}, ${d}`);
        await sendTurnReply(
          sender,
          ["לא בטוחה אם לשבץ. אפשר לכתוב אחד מאלה:", "", ...opts, "", "או לכתוב לא, ונשאיר את זה."].join("\n")
        );
        return res.status(200).json({ status: "trend_schedule_unclear", sender });
      }

      if (!chosenDate) {
        await sendTurnReply(sender, `לא הצלחתי לקרוא את התאריך. אפשר לכתוב היום, מחר, או תאריך כמו 29/07/2026.`);
        return res.status(200).json({ status: "trend_schedule_bad_date", sender });
      }

      if (await guardChosenDate(chosenDate)) return res.status(200).json({status:"chosen_date_needs_clarification",sender});
      const taken = (await isGanttDateTaken(spreadsheetId, chosenDate)).taken;
      if (taken && !ctx.isStory) {
        await sendTurnReply(sender, `ה-${chosenDate} כבר תפוס. אפשר לתת לי תאריך אחר קרוב, ואשבץ שם.`);
        return res.status(200).json({ status: "trend_schedule_taken", sender });
      }

      try {
        await approveContentForProduction(spreadsheetId, ctx.contentName);
      } catch (e) {
        await sendTurnReply(sender, `משהו השתבש. "${ctx.contentName}" נשאר כרגע בלי תאריך. אפשר לנסות שוב.`);
        return res.status(200).json({ status: "trend_schedule_approve_failed", sender });
      }
      const dn = getHebrewDayName(chosenDate);
      await addRowToGantt(spreadsheetId, ctx.contentId, ctx.contentName, chosenDate, dn, "", "בתכנון");
      await sortGanttByDate(spreadsheetId);
      clearPendingQuestion(sender);
      await sendTurnReply(
        sender,
        [`יאללה, הכנסתי את "${ctx.contentName}" לגאנט ל-${chosenDate} (יום ${dn}).`, "", "כדאי לצלם ולערוך מהר כדי לתפוס את הטרנד. אני אזכיר לך בבריף."].join("\n")
      );
      return res.status(200).json({ status: "trend_scheduled", sender });
    }

    if (pendingQuestion?.questionType === "approve_pick_idea") {
      if (isRejectionMessage(incomingText)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "בסדר, לא העברתי כלום. אפשר לחזור לזה מתי שבא לך.");
        return res.status(200).json({ status: "approve_pick_cancelled", sender });
      }
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      try {
        const picked = await approveContentForProduction(spreadsheetId, incomingText.trim());
        clearPendingQuestion(sender);
        await sendTurnReply(sender, `מעולה, העברתי את "${picked.name}" לתכנים שאושרו ופתחתי משימת הפקה.`);
        const now = new Date();
        const firstOfMonth = `01/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
        const available = await findSmartGanttDate(spreadsheetId, firstOfMonth, {});
        const earliest = new Date(); earliest.setDate(earliest.getDate() + 1); earliest.setHours(0,0,0,0);
        const future = available.filter((d) => { const p = d.split("/"); return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])) >= earliest; });
        if (future.length > 0) {
          const suggested = future[0];
          const dn = getHebrewDayName(suggested);
          storePendingQuestion(sender, {
            questionType: "confirm_gantt_write",
            context: { contentId: picked.contentId, contentName: picked.name, date: suggested, dayName: dn, ganttStatus: "בתכנון" },
          });
          await sendTurnReply(sender, [`מצאתי לו חור פנוי בגאנט: ${suggested}, יום ${dn}.`, "", `להכניס את "${picked.name}" לתאריך הזה?`].join("\n"));
        }
        return res.status(200).json({ status: "approve_pick_done", sender });
      } catch (pickError) {
        const openIdeas = await getOpenContentIdeas(spreadsheetId);
        const ideaLines = openIdeas.slice(0, 10).map((i: any) => `*${i.idea}*`).join("\n\n");
        await sendTurnReply(sender, [`עדיין לא מצאתי. אפשר לנסות שוב עם אחד מאלה:`, "", ideaLines].join("\n"));
        return res.status(200).json({ status: "approve_pick_retry", sender });
      }
    }

    if (pendingQuestion?.questionType === "gantt_date_change_collision") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      const explicitDate = incomingText.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?/);
      if (explicitDate) {
        const normalized = normalizeUserDateInput(explicitDate[0]);
        if (!normalized) {
          await sendTurnReply(sender, `לא הצלחתי לקרוא את התאריך. אפשר לכתוב אותו כמו 29/07/2026.`);
          return res.status(200).json({ status: "gantt_date_change_retry_bad_date", sender });
        }
        const clash = await isGanttDateTaken(spreadsheetId, normalized);
        if (clash.taken && clash.existingContentId !== ctx.contentId) {
          const shortExisting = clash.existingName.split(/\s+/).slice(0, 6).join(" ");
          await sendTurnReply(sender, `גם ה-${normalized} תפוס (${shortExisting}). אפשר לתת לי תאריך אחר, או לכתוב כן ואמצא פנוי.`);
          return res.status(200).json({ status: "gantt_date_change_still_taken", sender });
        }
        const dn = getHebrewDayName(normalized);
        await updateGanttRowDate(spreadsheetId, ctx.contentId, normalized, dn);
        await sortGanttByDate(spreadsheetId);
        clearPendingQuestion(sender);
        await sendTurnReply(sender, `הזזתי את "${ctx.contentName}" ל-${normalized} (יום ${dn}).`);
        return res.status(200).json({ status: "gantt_date_changed", sender });
      }

      if (isConfirmationMessage(incomingText)) {
        const now = new Date();
        const firstOfMonth = `01/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
        const available = await findAvailableDatesInMonth(spreadsheetId, firstOfMonth);
        const earliest = new Date(); earliest.setDate(earliest.getDate() + 1); earliest.setHours(0,0,0,0);
        const future = available.filter((d) => {
          const p = d.split("/"); return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])) >= earliest;
        });
        if (future.length === 0) {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, `לא מצאתי תאריך פנוי החודש. אפשר לתת לי תאריך ספציפי ואבדוק אותו.`);
          return res.status(200).json({ status: "gantt_date_change_no_free", sender });
        }
        const chosen = future[0];
        const dn = getHebrewDayName(chosen);
        await updateGanttRowDate(spreadsheetId, ctx.contentId, chosen, dn);
        await sortGanttByDate(spreadsheetId);
        clearPendingQuestion(sender);
        await sendTurnReply(sender, `מצאתי, הזזתי את "${ctx.contentName}" ל-${chosen} (יום ${dn}).`);
        return res.status(200).json({ status: "gantt_date_changed", sender });
      }

      if (isRejectionMessage(incomingText)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, `בסדר, השארתי את "${ctx.contentName}" בתאריך הנוכחי.`);
        return res.status(200).json({ status: "gantt_date_change_cancelled", sender });
      }

      await sendTurnReply(sender, `אפשר לענות כן (ואמצא תאריך פנוי), לתת לי תאריך אחר, או לכתוב ביטול.`);
      return res.status(200).json({ status: "gantt_date_change_collision_unclear", sender });
    }

    // Date pick after the intent question (23.7.2026). Karen writes dates in
    // many shapes: "24", "24/7", "יום שישי", "שישי", "הראשון". Match against
    // the offered list rather than demanding one format.
    // Offer to show what is already saved (23.7.2026). After Karen declines a
    // date, the agent tells her how many reels are still missing and offers to
    // show the waiting ideas. This handles her answer: no ends it, yes lists
    // up to six with a one-line description, and picking one continues into
    // the normal date flow.
    // Pick from the saved list (23.7.2026). Karen names one of the ideas, or
    // asks for more. Choosing one moves it into the normal date flow: offer
    // the free dates and let her choose, same as after a new idea.
    if (pendingQuestion?.questionType === "saved_list_pick") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const reply = incomingText.trim();

      if (isRejectionMessage(reply)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "סבבה, נשאיר את זה לאחר כך.");
        return res.status(200).json({ status: "saved_pick_declined", sender });
      }

      // "עוד" → show the next page.
      if (/^(עוד|הבא|תראי עוד|עוד רעיונות)$/.test(reply)) {
        try {
          const ideas = await getOpenContentIdeas(spreadsheetId);
          const offset = ctx.offset || 6;
          const next = ideas.slice(offset, offset + 6);
          if (!next.length) {
            await sendTurnReply(sender, "זה כל מה שיש כרגע. אפשר לבחור אחד מהרשימה.");
            return res.status(200).json({ status: "saved_pick_no_more", sender });
          }
          storePendingQuestion(sender, {
            questionType: "saved_list_pick",
            context: {
              options: next.map((i: any) => ({ contentId: i.contentId, name: i.idea, summary: i.summary })),
              allNames: ctx.allNames,
              offset: offset + 6,
            },
          });
          const lines: string[] = [];
          for (const i of next) {
            lines.push(`"${i.idea}"`);
            if (i.summary) lines.push(i.summary);
            lines.push("");
          }
          const more = ideas.length > offset + 6;
          const footer = more
            ? 'אפשר לבחור אחד בשם, או לכתוב "עוד" להמשך.'
            : "איזה מהם תרצי להכניס לגאנט?";
          await sendTurnReply(sender, ["ואלה הבאים:", "", ...lines, footer].join("\n"));
          return res.status(200).json({ status: "saved_pick_more_shown", sender });
        } catch (moreError) {
          console.error(`[Saved list] more failed: ${moreError}`);
          await sendTurnReply(sender, "לא הצלחתי להביא את ההמשך. אפשר לבחור מהרשימה שכבר הצגתי.");
          return res.status(200).json({ status: "saved_pick_more_failed", sender });
        }
      }

      // Match the reply against the offered names.
      const picked = pickOfferedOption<any>(reply, ctx.options || [], o=>o.name);

      if (!picked) {
        const names = (ctx.options || []).map((o: any) => `"${o.name}"`);
        await sendTurnReply(
          sender,
          ["לא זיהיתי איזה רעיון. אפשר לכתוב את השם של אחד מאלה:", "", ...names].join("\n")
        );
        return res.status(200).json({ status: "saved_pick_unclear", sender });
      }

      // Continue into the normal date flow.
      try {
        const now = new Date();
        const firstOfMonth = `01/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
        const smart = await findSmartGanttDate(spreadsheetId, firstOfMonth, { forNewItemType: "ריל" });
        const tomorrowD = new Date(); tomorrowD.setDate(tomorrowD.getDate() + 1); tomorrowD.setHours(0, 0, 0, 0);
        const futureDates = smart.filter((d: string) => {
          const p = d.split("/");
          return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])) >= tomorrowD;
        }).slice(0, 3);

        if (!futureDates.length) {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, "לא מצאתי תאריך פנוי קרוב. אפשר לנסות שוב מאוחר יותר.");
          return res.status(200).json({ status: "saved_pick_no_dates", sender });
        }

        storePendingQuestion(sender, {
          questionType: "bridge_pick_date",
          context: { contentId: picked.contentId, contentName: picked.name, dates: futureDates },
        });
        const lines = futureDates.map((d: string) => `${getHebrewDayName(d)}, ${d}`);
        await sendTurnReply(
          sender,
          [`מעולה, אלה התאריכים הפנויים הקרובים ל"${picked.name}":`, "", ...lines, "", "איזה תאריך מתאים לך?"].join("\n")
        );
        return res.status(200).json({ status: "saved_pick_dates_offered", sender });
      } catch (dateError) {
        console.error(`[Saved list] date lookup failed: ${dateError}`);
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "לא הצלחתי למצוא תאריכים כרגע. אפשר לנסות שוב עוד רגע.");
        return res.status(200).json({ status: "saved_pick_date_failed", sender });
      }
    }

    // Answer to the evening nudge about unfilmed content (23.7.2026).
    // She either leaves it where it is, or moves it. Moving reuses the
    // existing smart-date flow rather than inventing a new one.
    if (pendingQuestion?.questionType === "nudge_unfilmed_decision") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const reply = incomingText.trim();

      if (/להשאיר|משאיר|נשאיר|כמו שהוא|בסדר|סבבה/.test(reply)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "סגור, השארתי אותו איפה שהוא.");
        return res.status(200).json({ status: "nudge_kept_as_is", sender });
      }

      if (/להעביר|תעבירי|נעביר|להזיז|תזיזי|יום אחר|תאריך אחר/.test(reply)) {
        try {
          const now = new Date();
          const firstOfMonth = `01/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
          const smart = await findSmartGanttDate(spreadsheetId, firstOfMonth, { forNewItemType: "ריל" });
          const tomorrowD = new Date(); tomorrowD.setDate(tomorrowD.getDate() + 1); tomorrowD.setHours(0, 0, 0, 0);
          const dates = smart.filter((d: string) => {
            const p = d.split("/");
            return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])) >= tomorrowD;
          }).filter((d: string) => d !== ctx.date).slice(0, 3);

          if (!dates.length) {
            clearPendingQuestion(sender);
            await sendTurnReply(sender, "לא מצאתי תאריך פנוי קרוב להעביר אליו. אפשר לנסות מאוחר יותר.");
            return res.status(200).json({ status: "nudge_move_no_dates", sender });
          }

          storePendingQuestion(sender, {
            questionType: "bridge_pick_date",
            context: { contentId: ctx.contentId, contentName: ctx.contentName, dates, mode: "move" },
          });
          const lines = dates.map((d: string) => `${getHebrewDayName(d)}, ${d}`);
          await sendTurnReply(
            sender,
            [`בסדר. אלה התאריכים הפנויים הקרובים ל"${ctx.contentName}":`, "", ...lines, "", "איזה תאריך מתאים?"].join("\n")
          );
          return res.status(200).json({ status: "nudge_move_dates_offered", sender });
        } catch (moveError) {
          console.error(`[Nudge] move lookup failed: ${moveError}`);
          clearPendingQuestion(sender);
          await sendTurnReply(sender, "לא הצלחתי למצוא תאריכים כרגע. אפשר לנסות שוב עוד רגע.");
          return res.status(200).json({ status: "nudge_move_failed", sender });
        }
      }

      await sendTurnReply(sender, 'לא בטוחה מה התכוונת. להשאיר אותו איפה שהוא, או להעביר ליום אחר?');
      return res.status(200).json({ status: "nudge_decision_unclear", sender });
    }

    // Follow-up to "תזכיר לי את X" (23.7.2026). Three shapes, by what the
    // lookup found. Each one hands off to a flow that already exists rather
    // than building a parallel one.
    if (pendingQuestion?.questionType === "content_lookup_followup") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      let answer: "yes" | "no" | "unclear" = "unclear";
      if (isConfirmationMessage(incomingText)) answer = "yes";
      else if (isRejectionMessage(incomingText)) answer = "no";
      else {
        // Karen phrases this freely; ask Claude rather than saying we did not
        // understand. Same pattern as the date question.
        const claudeIntent = await askClaudeForBridgeIntent(incomingText);
        if (claudeIntent === "schedule") answer = "yes";
        else if (claudeIntent === "keep") answer = "no";
      }

      if (answer === "unclear") {
        await sendTurnReply(sender, "לא בטוחה מה התכוונת. אפשר לענות כן או לא.");
        return res.status(200).json({ status: "content_lookup_unclear", sender });
      }

      clearPendingQuestion(sender);

      if (answer === "no") {
        await sendTurnReply(sender, "סגור, הוא נשאר כרגע כמו שהוא.");
        return res.status(200).json({ status: "content_lookup_declined", sender });
      }

      // not_found: show what is saved, reusing the existing list handler.
      if (ctx.mode === "not_found") {
        // Show the list right here (24.7.2026). Storing offer_saved_list only
        // armed a handler that REACTS to an answer, so Karen got "מביאה את
        // הרשימה" and nothing followed until she said כן again.
        try {
          const ideas = await getOpenContentIdeas(spreadsheetId);
          if (!ideas.length) {
            await sendTurnReply(sender, "אין כרגע רעיונות שמחכים לתאריך.");
            return res.status(200).json({ status: "content_lookup_list_empty", sender });
          }
          const shown = ideas.slice(0, 6);
          const hasMore = ideas.length > 6;
          storePendingQuestion(sender, {
            questionType: "saved_list_pick",
            context: {
              options: shown.map((i: any) => ({ contentId: i.contentId, name: i.idea, summary: i.summary })),
              allNames: ideas.map((i: any) => i.idea),
              offset: 6,
            },
          });
          const listLines: string[] = [];
          for (const i of shown) {
            listLines.push(`"${i.idea}"`);
            if (i.summary && i.summary !== i.idea) listLines.push(i.summary);
            listLines.push("");
          }
          const footer = hasMore
            ? 'אפשר לבחור אחד מהם בשם, או לכתוב "עוד" ואציג לך את השאר.'
            : "איזה מהם תרצי להכניס לגאנט?";
          await sendTurnReply(
            sender,
            ["אלה הרעיונות שמחכים לתאריך:", "", ...listLines, footer].join("\n")
          );
          return res.status(200).json({ status: "content_lookup_list_shown", sender });
        } catch (listError) {
          console.error(`[Content lookup] list failed: ${listError}`);
          await sendTurnReply(sender, "לא הצלחתי להביא את הרשימה כרגע. אפשר לנסות שוב עוד רגע.");
          return res.status(200).json({ status: "content_lookup_list_failed", sender });
        }
      }

      // waiting: move it to production, then continue to the date offer below.
      // approveContentForProduction only writes the rows; the date offer lives
      // in the approve-COMMAND handler, not in the function itself, so stopping
      // here left the content in production with no date (fixed 24.7.2026).
      let lookupContentId = ctx.contentId;
      if (ctx.mode === "waiting") {
        try {
          const approved = await approveContentForProduction(spreadsheetId, ctx.contentName);
          // Use the id the approve step produced, not the bank one.
          if (approved?.contentId) lookupContentId = approved.contentId;
        } catch (approveError) {
          await sendTurnReply(sender, `משהו השתבש בהעברה להפקה. אפשר לנסות שוב עם: תוסיפי את ${ctx.contentName} להפקה`);
          return res.status(200).json({ status: "content_lookup_approve_failed", sender });
        }
        await sendTurnReply(sender, `מעולה, העברתי את "${ctx.contentName}" להפקה.`);
      }

      // in_production: offer concrete dates, same as the bridge.
      try {
        const now = new Date();
        const firstOfMonth = `01/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
        const smart = await findSmartGanttDate(spreadsheetId, firstOfMonth, { forNewItemType: "ריל" });
        const tomorrowD = new Date(); tomorrowD.setDate(tomorrowD.getDate() + 1); tomorrowD.setHours(0, 0, 0, 0);
        const dates = smart.filter((d: string) => {
          const p = d.split("/");
          return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])) >= tomorrowD;
        }).slice(0, 3);

        if (!dates.length) {
          await sendTurnReply(sender, "לא מצאתי תאריך פנוי קרוב. אפשר לנסות מאוחר יותר.");
          return res.status(200).json({ status: "content_lookup_no_dates", sender });
        }

        storePendingQuestion(sender, {
          questionType: "bridge_pick_date",
          context: { contentId: lookupContentId, contentName: ctx.contentName, dates, alreadyApproved: true },
        });
        const dateLines = dates.map((d: string) => `${getHebrewDayName(d)}, ${d}`);
        await sendTurnReply(
          sender,
          ["מעולה, אלה התאריכים הפנויים הקרובים:", "", ...dateLines, "", "איזה תאריך מתאים לך?"].join("\n")
        );
        return res.status(200).json({ status: "content_lookup_dates_offered", sender });
      } catch (dateError) {
        console.error(`[Content lookup] date lookup failed: ${dateError}`);
        await sendTurnReply(sender, "לא הצלחתי למצוא תאריכים כרגע. אפשר לנסות שוב עוד רגע.");
        return res.status(200).json({ status: "content_lookup_date_failed", sender });
      }
    }

    if (pendingQuestion?.questionType === "offer_saved_list") {
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      if (isRejectionMessage(incomingText)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "סבבה, נשאיר את זה לאחר כך.");
        return res.status(200).json({ status: "saved_list_declined", sender });
      }

      if (!isConfirmationMessage(incomingText)) {
        await sendTurnReply(sender,"להציג את הרעיונות השמורים, או שזה רעיון חדש?");
        return res.status(200).json({status:"saved_list_offer_unclear",sender});
      }

      try {
        const ideas = await getOpenContentIdeas(spreadsheetId);
        if (!ideas.length) {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, "אין כרגע רעיונות שמחכים לתאריך.");
          return res.status(200).json({ status: "saved_list_empty", sender });
        }

        const shown = ideas.slice(0, 6);
        const hasMore = ideas.length > 6;
        storePendingQuestion(sender, {
          questionType: "saved_list_pick",
          context: {
            options: shown.map((i: any) => ({ contentId: i.contentId, name: i.idea, summary: i.summary })),
            allNames: ideas.map((i: any) => i.idea),
            offset: 6,
          },
        });

        const lines: string[] = [];
        for (const i of shown) {
          lines.push(`"${i.idea}"`);
          if (i.summary) lines.push(i.summary);
          lines.push("");
        }

        const header = hasMore
          ? "אלה הרעיונות הראשונים שכבר שמורים ומחכים לתאריך:"
          : "אלה הרעיונות שכבר שמורים ומחכים לתאריך:";
        const footer = hasMore
          ? 'אפשר לבחור אחד מהם בשם, או לכתוב "עוד" ואציג לך את השאר.'
          : "איזה מהם תרצי להכניס לגאנט?";

        await sendTurnReply(sender, [header, "", ...lines, footer].join("\n"));
        return res.status(200).json({ status: "saved_list_shown", sender });
      } catch (listError) {
        console.error(`[Saved list] failed: ${listError}`);
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "לא הצלחתי להביא את הרשימה כרגע. אפשר לנסות שוב עוד רגע.");
        return res.status(200).json({ status: "saved_list_failed", sender });
      }
    }

    if (pendingQuestion?.questionType === "production_overview_schedule") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const noDateItems: Array<{ contentId: string; name: string }> = ctx.items || [];

      if (isRejectionMessage(incomingText)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "בסדר, נשאיר אותם כרגע בלי תאריך.");
        return res.status(200).json({ status: "production_overview_schedule_declined", sender });
      }

      if (isConfirmationMessage(incomingText)) {
        // Scope (28.7): schedule the FIRST item only. The full loop over the
        // rest belongs to the monthly-planning redesign. The item is already in
        // production (it has a production row, just no deadline/gantt entry), so
        // reuse bridge_pick_date with alreadyApproved, same as "תזכיר לי".
        const first = noDateItems[0];
        if (!first) {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, "לא נשאר תוכן בלי תאריך.");
          return res.status(200).json({ status: "production_overview_schedule_empty", sender });
        }
        const now = new Date();
        const firstOfMonth = `01/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
        const smart = await findSmartGanttDate(spreadsheetId, firstOfMonth, { forNewItemType: "ריל" });
        const tomorrowD = new Date(); tomorrowD.setDate(tomorrowD.getDate() + 1); tomorrowD.setHours(0, 0, 0, 0);
        const dates = smart.filter((d: string) => {
          const p = d.split("/");
          return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])) >= tomorrowD;
        }).slice(0, 3);
        // Month full: this month has no free future date. Instead of a dead
        // end, look into next month and offer those dates. The content is
        // already in production, so we reuse bridge_pick_date/alreadyApproved
        // (which only writes the gantt row, no re-approve). This is why we do
        // NOT reuse month_full_choice here — that flow is built around
        // approveContentForProduction, which throws for already-in-production
        // items (they are no longer in the idea bank).
        let scheduleDates = dates;
        let nextMonthNote = "";
        if (!scheduleDates.length) {
          const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          const nmFirst = `01/${String(nm.getMonth() + 1).padStart(2, "0")}/${nm.getFullYear()}`;
          const nmSmart = await findSmartGanttDate(spreadsheetId, nmFirst, { forNewItemType: "ריל" });
          scheduleDates = nmSmart.slice(0, 3);
          nextMonthNote = "החודש מלא, אז הצעתי תאריכים לחודש הבא.";
        }
        if (!scheduleDates.length) {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, "לא מצאתי תאריך פנוי קרוב, גם לא בחודש הבא. אפשר לנסות מאוחר יותר.");
          return res.status(200).json({ status: "production_overview_schedule_no_dates", sender });
        }
        storePendingQuestion(sender, {
          questionType: "bridge_pick_date",
          context: { contentId: first.contentId, contentName: first.name, dates: scheduleDates, alreadyApproved: true },
        });
        const dateLines = scheduleDates.map((d: string) => `${getHebrewDayName(d)}, ${d}`);
        const askLines = nextMonthNote
          ? [nextMonthNote, "", `מתי להכניס את "${first.name}" לגאנט?`, "", ...dateLines]
          : [`מתי להכניס את "${first.name}" לגאנט?`, "", ...dateLines];
        await sendTurnReply(sender, askLines.join("\n"));
        return res.status(200).json({ status: "production_overview_schedule_started", sender });
      }

      // Neither yes nor no: let the escape hatch / normal routing handle it by
      // clearing and falling through would lose the question; instead re-ask
      // gently once. (A real command would have been caught by the escape hatch.)
      await sendTurnReply(sender, "רוצה שנכניס אותם לגאנט? אפשר לענות כן או לא.");
      return res.status(200).json({ status: "production_overview_schedule_unclear", sender });
    }

    if (pendingQuestion?.questionType === "bridge_pick_date") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const dates: string[] = ctx.dates || [];
      const reply = incomingText.trim();

      if (isRejectionMessage(reply)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "סגור, השארתי אותו כרגע בלי תאריך.");
        return res.status(200).json({ status: "bridge_pick_date_kept", sender });
      }

      const ORDINALS: Record<string, number> = {
        "הראשון": 0, "ראשון שברשימה": 0, "הראשונה": 0,
        "השני": 1, "השנייה": 1, "השניה": 1,
        "השלישי": 2, "השלישית": 2,
      };

      let chosen: string | null = extractExplicitDateFromReply(reply);

      // 1. Full or partial numeric date: 24, 24/7, 24/07/2026
      const numMatch = reply.match(/(\d{1,2})(?:[./-](\d{1,2}))?(?:[./-](\d{2,4}))?/);
      if (numMatch && !chosen) {
        const day = parseInt(numMatch[1], 10);
        const month = numMatch[2] ? parseInt(numMatch[2], 10) : null;
        chosen = dates.find((d) => {
          const p = d.split("/");
          const dDay = parseInt(p[0], 10);
          const dMonth = parseInt(p[1], 10);
          return dDay === day && (month === null || dMonth === month);
        }) || null;
      }

      // 2. Ordinal reference to the list
      if (!chosen) {
        for (const [word, idx] of Object.entries(ORDINALS)) {
          if (reply.includes(word) && dates[idx]) { chosen = dates[idx]; break; }
        }
      }

      // 3. Hebrew day name
      if (!chosen) {
        chosen = dates.find((d) => {
          const dn = getHebrewDayName(d);
          return dn && (reply.includes(dn) || reply.includes(`יום ${dn}`));
        }) || null;
      }

      if (!chosen) {
        const lines = dates.map((d: string) => `${getHebrewDayName(d)}, ${d}`);
        await sendTurnReply(
          sender,
          ["לא זיהיתי איזה תאריך. אפשר לבחור אחד מאלה:", "", ...lines].join("\n")
        );
        return res.status(200).json({ status: "bridge_pick_date_unclear", sender });
      }

      if (await guardChosenDate(chosen)) return res.status(200).json({status:"chosen_date_needs_clarification",sender});
      clearPendingQuestion(sender);

      // Move mode: the content is already on the gantt, so just change its
      // date instead of approving and adding a new row.
      if (ctx.mode === "move") {
        const movedDayName = getHebrewDayName(chosen);
        await updateGanttRowDate(spreadsheetId, ctx.contentId, chosen, movedDayName);
        await sortGanttByDate(spreadsheetId);
        await sendTurnReply(
          sender,
          `סגור, העברתי את "${ctx.contentName}" ליום ${movedDayName}, ${chosen}.`
        );
        return res.status(200).json({ status: "gantt_date_moved", sender });
      }

      // Already in production (24.7.2026): arriving here from the content
      // lookup means the item was approved earlier in the flow. Approving
      // again fails, so skip straight to writing the gantt row.
      if (ctx.alreadyApproved) {
        const dn2 = getHebrewDayName(chosen);
        await addRowToGantt(spreadsheetId, ctx.contentId, ctx.contentName, chosen, dn2, "", "בתכנון");
        await sortGanttByDate(spreadsheetId);
        storePendingQuestion(sender, {
          questionType: "gantt_upload_time",
          context: { contentId: ctx.contentId, contentName: ctx.contentName, date: chosen },
        });
        await sendTurnReply(
          sender,
          [`מעולה, הכנסתי את "${ctx.contentName}" לגאנט ליום ${dn2}, ${chosen}.`, "", "באיזו שעה לתכנן את ההעלאה?"].join("\n")
        );
        return res.status(200).json({ status: "bridge_pick_date_done", sender });
      }

      let approveResult;
      try {
        approveResult = await approveContentForProduction(spreadsheetId, ctx.contentName);
      } catch (approveError) {
        await sendTurnReply(
          sender,
          `משהו השתבש בהעברה להפקה. אפשר לנסות שוב עם: תוסיפי את ${ctx.contentName} להפקה`
        );
        return res.status(200).json({ status: "bridge_pick_approve_failed", sender });
      }

      const chosenDayName = getHebrewDayName(chosen);
      const productionDeadline = await addRowToGantt(
        spreadsheetId,
        approveResult.contentId,
        ctx.contentName,
        chosen,
        chosenDayName,
        "",
        "בתכנון"
      );
      await sortGanttByDate(spreadsheetId);

      storePendingQuestion(sender, {
        questionType: "gantt_upload_time",
        context: { contentId: approveResult.contentId, contentName: ctx.contentName, date: chosen },
      });

      await sendTurnReply(
        sender,
        [
          `מעולה, הכנסתי את "${ctx.contentName}" לגאנט ליום ${chosenDayName}, ${chosen}.`,
          "",
          "באיזו שעה לתכנן את ההעלאה?",
        ].join("\n")
      );
      return res.status(200).json({ status: "bridge_pick_date_done", sender });
    }

    if (pendingQuestion?.questionType === "month_full_pick_reel") {
      const ctx = pendingQuestion.context as any;
      const reply = incomingText.trim();
      const shiftableReels: Array<any> = ctx.shiftableReels || [];
      // Pick by number (1-based) or by name substring.
      let picked: any = null;
      const numMatch = reply.match(/^(\d+)/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < shiftableReels.length) picked = shiftableReels[idx];
      }
      if (!picked) {
        picked = shiftableReels.find((r: any) => reply.length >= 2 && r.name.includes(reply)) || null;
      }
      if (!picked) {
        storePendingQuestion(sender, { questionType: "month_full_pick_reel", context: ctx });
        const reelLines = shiftableReels.map((r: any, i: number) => `${i + 1}. ${r.name}`);
        await sendTurnReply(sender, ["לא זיהיתי איזה תוכן. אפשר לענות במספר:", "", ...reelLines].join("\n"));
        return res.status(200).json({ status: "month_full_pick_reel_unclear", sender });
      }
      const nextMonthDates: string[] = ctx.nextMonthDates || [];
      if (nextMonthDates.length === 0) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "לא מצאתי תאריך פנוי להזיז אליו. אפשר לנסות שוב.");
        return res.status(200).json({ status: "month_full_move_no_dates", sender });
      }
      storePendingQuestion(sender, {
        questionType: "month_full_move_date",
        context: { contentId: ctx.contentId, contentName: ctx.contentName, movingReel: picked, dates: nextMonthDates },
      });
      const dateLines = nextMonthDates.map((d: string, i: number) => `${i + 1}. יום ${getHebrewDayName(d)}, ${d}`);
      await sendTurnReply(
        sender,
        [`לאיזה תאריך להעביר את ”${picked.name}”?`, "", ...dateLines, "", "אפשר לענות במספר או בתאריך."].join("\n")
      );
      return res.status(200).json({ status: "month_full_move_date_offered", sender });
    }

    if (pendingQuestion?.questionType === "month_full_move_date") {
      const ctx = pendingQuestion.context as any;
      const reply = incomingText.trim();
      const dates: string[] = ctx.dates || [];
      let chosen: string | null = null;
      const numMatch = reply.match(/(\d{1,2})(?:[./-](\d{1,2}))?/);
      if (numMatch && !numMatch[2] && parseInt(numMatch[1], 10) <= dates.length) {
        chosen = dates[parseInt(numMatch[1], 10) - 1] || null;
      }
      if (!chosen && numMatch) {
        const day = parseInt(numMatch[1], 10);
        const month = numMatch[2] ? parseInt(numMatch[2], 10) : null;
        chosen = dates.find((d) => {
          const p = d.split("/");
          return parseInt(p[0], 10) === day && (month === null || parseInt(p[1], 10) === month);
        }) || null;
      }
      // Also match a Hebrew day name against the offered dates ("שישי").
      if (!chosen) {
        chosen = dates.find((d) => reply.includes(getHebrewDayName(d))) || null;
      }
      if (!chosen) {
        storePendingQuestion(sender, { questionType: "month_full_move_date", context: ctx });
        const dateLines = dates.map((d: string) => `${getHebrewDayName(d)}, ${d}`);
        await sendTurnReply(sender, ["לא זיהיתי תאריך. אפשר:", "", ...dateLines].join("\n"));
        return res.status(200).json({ status: "month_full_move_date_unclear", sender });
      }
      clearPendingQuestion(sender);
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const movingReel = ctx.movingReel;
      const freedDate = movingReel.date;      // the slot the moved reel vacates
      const freedDayName = movingReel.dayName;
      const chosenDayName = getHebrewDayName(chosen);

      // Write 1: move the existing reel to its new date.
      try {
        await updateGanttRowDate(spreadsheetId, movingReel.contentId, chosen, chosenDayName);
      } catch (moveError) {
        await sendTurnReply(sender, `משהו השתבש בהזזת "${movingReel.name}". לא שיניתי כלום, אפשר לנסות שוב.`);
        return res.status(200).json({ status: "month_full_move_failed", sender });
      }

      // Verify the move actually landed before writing the new item, since
      // updateGanttRowDate returns void and no-ops silently if the row is gone.
      const moveVerified = await isGanttDateTaken(spreadsheetId, chosen);
      if (!moveVerified.taken || moveVerified.existingContentId !== movingReel.contentId) {
        await sendTurnReply(sender, `לא הצלחתי לאמת שההזזה של "${movingReel.name}" נשמרה. עצרתי כדי לא ליצור בלגן בגאנט. אפשר לנסות שוב.`);
        return res.status(200).json({ status: "month_full_move_unverified", sender });
      }

      // Write 2: place the new content in the freed slot.
      let approveResult;
      try {
        approveResult = await approveContentForProduction(spreadsheetId, ctx.contentId);
      } catch (approveError) {
        await sendTurnReply(sender, `הזזתי את "${movingReel.name}", אבל משהו השתבש בהעברת התוכן החדש להפקה. אפשר לנסות: תוסיפי את ${ctx.contentName} להפקה`);
        return res.status(200).json({ status: "month_full_move_approve_failed", sender });
      }
      const productionDeadline = await addRowToGantt(spreadsheetId, approveResult.contentId, ctx.contentName, freedDate, freedDayName, "", "בתכנון");
      await sortGanttByDate(spreadsheetId);
      storePendingQuestion(sender, {
        questionType: "gantt_upload_time",
        context: { contentId: approveResult.contentId, contentName: ctx.contentName, date: freedDate },
      });
      const shortNew = ctx.contentName.split(/\s+/).slice(0, 6).join(" ");
      const shortMoved = movingReel.name.split(/\s+/).slice(0, 6).join(" ");
      await sendTurnReply(
        sender,
        [
          `העברתי את ”${shortMoved}” ליום ${chosenDayName}, ${chosen}.`,
          `את ”${shortNew}” הכנסתי במקומו ליום ${freedDayName}, ${freedDate}.`,
          productionDeadline ? `הדדליין להפקה הוא ${productionDeadline}.` : "",
          "",
          "באיזו שעה לתכנן את ההעלאה?",
        ].filter(Boolean).join("\n")
      );
      return res.status(200).json({ status: "month_full_move_executed", sender });
    }

    if (pendingQuestion?.questionType === "month_full_choice") {
      const ctx = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const reply = incomingText.trim();
      const nextMonthDates: string[] = ctx.nextMonthDates || [];
      const contentId = ctx.contentId;
      const contentName = ctx.contentName;

      const saysNextMonth = ["1", "חודש הבא", "הבא", "לחודש הבא", "להכניס לחודש הבא", "תכניסי לחודש הבא"].some((p) => reply.includes(p));
      const saysNoDate = ["3", "בלי תאריך", "להשאיר", "להעביר להפקה", "הפקה בלי תאריך", "לא עכשיו"].some((p) => reply.includes(p));
      const saysMove = ["2", "להזיז", "להזיז תוכן", "לפנות מקום"].some((p) => reply.includes(p));

      // Branch 1: schedule next month — hand the 3 next-month dates to the
      // existing bridge_pick_date flow (no new write code).
      if (saysNextMonth) {
        if (nextMonthDates.length === 0) {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, "לא מצאתי תאריך פנוי גם בחודש הבא. התוכן נשאר בלי תאריך.");
          return res.status(200).json({ status: "month_full_next_month_empty", sender });
        }
        storePendingQuestion(sender, {
          questionType: "bridge_pick_date",
          context: { contentId, contentName, dates: nextMonthDates },
        });
        const lines = nextMonthDates.map((d: string, i: number) => `${i + 1}. יום ${getHebrewDayName(d)}, ${d}`);
        await sendTurnReply(
          sender,
          ["אלה התאריכים הפנויים הקרובים בחודש הבא:", "", ...lines, "", "איזה תאריך מתאים לך?"].join("\n")
        );
        return res.status(200).json({ status: "month_full_next_month_offered", sender });
      }

      // Branch 2: keep in production without a gantt date.
      if (saysNoDate) {
        clearPendingQuestion(sender);
        try {
          await approveContentForProduction(spreadsheetId, contentId);
        } catch (approveError) {
          await sendTurnReply(sender, `משהו השתבש בהעברה להפקה. אפשר לנסות שוב עם: תוסיפי את ${contentName} להפקה`);
          return res.status(200).json({ status: "month_full_keep_approve_failed", sender });
        }
        const shortName = contentName.split(/\s+/).slice(0, 6).join(" ");
        await sendTurnReply(sender, `העברתי את ”${shortName}” להפקה בלי תאריך. כשיתפנה מקום בגאנט, נוכל לקבוע לו אחד.`);
        return res.status(200).json({ status: "month_full_kept_no_date", sender });
      }

      // Branch 3: move existing content — show the shiftable reels and ask which.
      if (saysMove) {
        const shiftableReels: Array<any> = ctx.shiftableReels || [];
        if (shiftableReels.length === 0) {
          storePendingQuestion(sender, { questionType: "month_full_choice", context: ctx });
          await sendTurnReply(sender, "אין כרגע ריל אורגני שאפשר להזיז השבוע. אפשר לבחור חודש הבא או להשאיר בלי תאריך.");
          return res.status(200).json({ status: "month_full_no_shiftable", sender });
        }
        storePendingQuestion(sender, {
          questionType: "month_full_pick_reel",
          context: { contentId, contentName, nextMonthDates, shiftableReels },
        });
        const reelLines = shiftableReels.map((r: any, i: number) => `${i + 1}. ”${r.name}”\nיום ${r.dayName}, ${r.date}`);
        await sendTurnReply(
          sender,
          ["איזה רילס תרצי להזיז כדי לפנות מקום?", "", ...reelLines, "", "אפשר לענות במספר או בשם."].join("\n")
        );
        return res.status(200).json({ status: "month_full_pick_reel_offered", sender });
      }

      // Unclear: re-ask once.
      storePendingQuestion(sender, { questionType: "month_full_choice", context: ctx });
      await sendTurnReply(
        sender,
        ["לא הייתי בטוחה איזו אפשרות בחרת. אפשר לענות:", "", "1. תחילת החודש הבא", "2. להזיז רילס קיים", "3. להעביר להפקה בלי תאריך"].join("\n")
      );
      return res.status(200).json({ status: "month_full_choice_unclear", sender });
    }
    if (pendingQuestion?.questionType === "bridge_offer") {
      const { contentName, date, dayName, availableDates, askedIntentOnly } = pendingQuestion.context as any;
      // Escape hatch (extended 23.7.2026): Karen often asks something else
      // instead of answering. A question is never an answer to "set a date?",
      // so let visibility queries through as well, not just write commands.
      const isExplicitCommandDuringBridgeOffer =
        isArchiveCommand(incomingText) ||
        isApproveForProductionCommand(incomingText) ||
        isRestoreCommand(incomingText) ||
        isDeadlineUpdate(incomingText) ||
        Boolean(detectVisibilityIntent(incomingText)) ||
        isQuestionLikeMessage(incomingText);

      if (isExplicitCommandDuringBridgeOffer) {
        clearPendingQuestion(sender);
        console.log(`[Route Debug] bridge_offer: explicit command detected, falling through`);
      } else {
        let bridgeAnswer = extractExplicitDateFromReply(incomingText) ? "schedule" as const : classifyBridgeOfferAnswer(incomingText);
        // Karen phrases this freely ("עדיף לא", "בוא נחכה"). When the phrase
        // list cannot decide, ask Claude rather than replying "לא הבנתי".
        if (bridgeAnswer === "unclear") {
          const claudeIntent = await askClaudeForBridgeIntent(incomingText);
          if (claudeIntent !== "unclear") {
            bridgeAnswer = claudeIntent;
            console.log(`[Route Debug] bridge intent via Claude: ${claudeIntent}`);
          }
        }

        if (bridgeAnswer === "keep") {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, "סגור, שמור בלי תאריך.");
          return res.status(200).json({ status: "bridge_offer_kept", sender });
        }

        // bridge_offer explicit date honoured (26.7.2026): "תכניס אותו ב-20/8"
        // is schedule + a specific date. Before this the date was dropped and
        // our own list was offered instead. If the reply carries a date, write
        // it directly via the shared extractor (same chain as the plain
        // schedule branch below).
        if (bridgeAnswer === "schedule" && askedIntentOnly) {
          const explicitDate = extractExplicitDateFromReply(incomingText);
          if (explicitDate) {
            const result = await scheduleSavedContent(sender,contentName,explicitDate,suppliedTime);
            return res.status(200).json({ status: result, sender });
          }
          // Intent confirmed. Now offer concrete dates and let her choose.
          const dates: string[] = (availableDates || [date]).filter(Boolean);
          storePendingQuestion(sender, {
            questionType: "bridge_pick_date",
            context: { contentId: (pendingQuestion.context as any).contentId, contentName, dates },
          });
          const lines = dates.map((d: string) => `${getHebrewDayName(d)}, ${d}`);
          await sendTurnReply(
            sender,
            ["מעולה, אלה התאריכים הפנויים הקרובים:", "", ...lines, "", "איזה תאריך מתאים לך?"].join("\n")
          );
          return res.status(200).json({ status: "bridge_dates_offered", sender });
        }

        if (bridgeAnswer === "schedule") {
          clearPendingQuestion(sender);
          const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

          let approveResult;
          try {
            approveResult = await approveContentForProduction(spreadsheetId, contentName);
          } catch (approveError) {
            await sendTurnReply(
              sender,
              `משהו השתבש בהעברה להפקה. הרעיון נשאר כרגע בלי תאריך. אפשר לנסות שוב עם: תוסיפי את ${contentName} להפקה`
            );
            return res.status(200).json({ status: "bridge_offer_approve_failed", sender });
          }

          // Same chain as the confirm_gantt_write "yes" branch: collision
          // check → addRowToGantt → sort → existing upload-time question.
          const collision = await isGanttDateTaken(spreadsheetId, date);
          if (collision.taken) {
            const shortExisting = collision.existingName.split(/\s+/).slice(0, 6).join(" ");
            const shortNew = contentName.split(/\s+/).slice(0, 6).join(" ");
            storePendingQuestion(sender, {
              questionType: "gantt_collision",
              context: {
                newContentId: approveResult.contentId,
                newContentName: contentName,
                newDate: date,
                newDayName: dayName,
                existingContentId: collision.existingContentId,
                existingName: collision.existingName,
                ganttStatus: "בתכנון",
              },
            });
            await sendTurnReply(
              sender,
              `העברתי את "${shortNew}" להפקה, אבל בינתיים ב-${date} כבר נתפס "${shortExisting}".\nרוצה שאכניס את "${shortNew}" במקומו ואעביר את "${shortExisting}" לתאריך אחר?`
            );
            return res.status(200).json({ status: "bridge_offer_collision", sender });
          }

          const productionDeadline = await addRowToGantt(
            spreadsheetId,
            approveResult.contentId,
            contentName,
            date,
            dayName,
            "",
            "בתכנון"
          );

          await sortGanttByDate(spreadsheetId);

          storePendingQuestion(sender, {
            questionType: "gantt_upload_time",
            context: { contentId: approveResult.contentId, contentName, date },
          });

          const shortConfirmName = contentName.split(/\s+/).slice(0, 6).join(" ");
          await sendTurnReply(
            sender,
            [
              `מעולה, העברתי את "${shortConfirmName}" להפקה והכנסתי לגאנט ב-${date} (יום ${dayName}), כבתכנון.`,
              productionDeadline ? `דדליין הפקה: ${productionDeadline}.` : "",
              "",
              "באיזו שעה לתכנן את ההעלאה?",
            ].filter(Boolean).join("\n")
          );
          return res.status(200).json({ status: "bridge_offer_scheduled", sender });
        }

        // Unclear: re-ask once (refreshes the modal state and its TTL).
        storePendingQuestion(sender, { questionType: "bridge_offer", context: pendingQuestion.context });
        await sendTurnReply(
          sender,
          [
            "לא בטוחה מה התכוונת.",
            "",
            "רוצה לקבוע לו תאריך בגאנט, או להשאיר אותו כרגע בלי תאריך?",
          ].join("\n")
        );
        return res.status(200).json({ status: "bridge_offer_unclear", sender });
      }
    }

    if (pendingQuestion?.questionType === "confirm_gantt_write") {
      const { contentId, contentName, date, dayName, ganttStatus, monthlyPlanning } = pendingQuestion.context as any;
      const isExplicitCommandWhileConfirmingGanttWrite =
        isArchiveCommand(incomingText) ||
        isApproveForProductionCommand(incomingText) ||
        isRestoreCommand(incomingText) ||
        isDeadlineUpdate(incomingText);

      if (isExplicitCommandWhileConfirmingGanttWrite) {
        clearPendingQuestion(sender);
        console.log(`[Route Debug] confirm_gantt_write: explicit command detected, falling through`);
      } else {
const rawAnswer = incomingText.trim();

if (["לא עכשיו", "אחר כך", "אחכ", "אח\"כ", "בהמשך", "עזבי כרגע", "עזוב כרגע"].includes(rawAnswer)) {
  clearPendingQuestion(sender);
  const shortName = contentName.split(/\s+/).slice(0, 6).join(" ");

  await sendTurnReply(
    sender,
    [
      `סבבה, השארתי את "${shortName}" בהפקה בלי תאריך עלייה.`,
      "",
      "זה יופיע כמשהו שמחכה לתאריך, כדי שלא ייפול בין הכיסאות.",
    ].join("\n")
  );

  return res.status(200).json({ status: "gantt_write_postponed", sender });
}

if (isRejectionMessage(incomingText)) {
        // "לא" means: do not schedule now. Karen often prefers to leave content
        // in production without a gantt date, so we stop here instead of pushing
        // alternative dates at her. If she wants a different date she simply
        // gives one (handled by the explicit-date branch below).
        clearPendingQuestion(sender);
        const shortName = contentName.split(/\s+/).slice(0, 6).join(" ");
        await sendTurnReply(
          sender,
          `השארתי את "${shortName}" בהפקה בלי תאריך. כשתרצי, נוכל לקבוע לו אחד.`
        );
        return res.status(200).json({ status: "gantt_write_declined", sender });
      }
      if (isConfirmationMessage(incomingText)) {
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

        // בדיקת התנגשות גם בזרימת התאמה חלקית
        const collision = await isGanttDateTaken(spreadsheetId, date);
        if (collision.taken) {
          const shortExisting = collision.existingName.split(/\s+/).slice(0, 6).join(" ");
          const shortNew = contentName.split(/\s+/).slice(0, 6).join(" ");
          storePendingQuestion(sender, {
            questionType: "gantt_collision",
            context: {
              newContentId: contentId,
              newContentName: contentName,
              newDate: date,
              newDayName: dayName,
              existingContentId: collision.existingContentId,
              existingName: collision.existingName,
              ganttStatus,
            },
          });
          await sendTurnReply(sender, `ב-${date} כבר מתוכנן "${shortExisting}".\nרוצה שאכניס את "${shortNew}" במקומו ואעביר את "${shortExisting}" לתאריך אחר?`);
          return res.status(200).json({ status: "gantt_collision_detected", sender });
        }

        const productionDeadline = await addRowToGantt(
  spreadsheetId,
  contentId,
  contentName,
  date,
  dayName,
  "",
  ganttStatus || "בתכנון"
);

await sortGanttByDate(spreadsheetId);

storePendingQuestion(sender, {
  questionType: "gantt_upload_time",
  context: { contentId, contentName, date, monthlyPlanning },
});

const shortConfirmName = contentName.split(/\s+/).slice(0, 6).join(" ");
  const deadlineDayName = productionDeadline ? getHebrewDayName(productionDeadline) : "";

  const confirmLines = [`הכנסתי את "${shortConfirmName}" לגאנט ליום ${dayName}, ${date}.`, ""];
  if (productionDeadline) {
    confirmLines.push(`הדדליין להפקה הוא ${deadlineDayName}, ${productionDeadline}.`, "");
  }
  confirmLines.push("באיזו שעה לתכנן את ההעלאה?");
  await sendTurnReply(sender, confirmLines.join("\n"));
        return res.status(200).json({ status: "gantt_write_confirmed", sender });
      }

      // confirm_gantt_write explicit date honoured (26.7.2026): Karen answers
      // "תכניס אותו ב-20/8" — a yes plus a different date. Before this it fell
      // to unclear and a later "כן" wrote the original context date (silent
      // wrong-date bug). Honour the explicit date via the shared extractor.
      {
        const explicitDate = extractExplicitDateFromReply(incomingText);
        if (explicitDate) {
          const sid = process.env.GOOGLE_SHEETS_ID!;
          const newDay = getHebrewDayName(explicitDate);
          const collision = await isGanttDateTaken(sid, explicitDate);
          if (collision.taken) {
            const shortExisting = collision.existingName.split(/\s+/).slice(0, 6).join(" ");
            const shortNew = contentName.split(/\s+/).slice(0, 6).join(" ");
            storePendingQuestion(sender, {
              questionType: "gantt_collision",
              context: {
                newContentId: contentId,
                newContentName: contentName,
                newDate: explicitDate,
                newDayName: newDay,
                existingContentId: collision.existingContentId,
                existingName: collision.existingName,
                ganttStatus,
              },
            });
            await sendTurnReply(sender, `ב-${explicitDate} כבר מתוכנן "${shortExisting}".\nרוצה שאכניס את "${shortNew}" במקומו ואעביר את "${shortExisting}" לתאריך אחר?`);
            return res.status(200).json({ status: "confirm_gantt_write_collision", sender });
          }
          const pd = await addRowToGantt(sid, contentId, contentName, explicitDate, newDay, "", ganttStatus || "בתכנון");
          await sortGanttByDate(sid);
          storePendingQuestion(sender, {
            questionType: "gantt_upload_time",
            context: { contentId, contentName, date: explicitDate, monthlyPlanning },
          });
          const shortC = contentName.split(/\s+/).slice(0, 6).join(" ");
          await sendTurnReply(
            sender,
            [
              `הכנסתי את "${shortC}" לגאנט ליום ${newDay}, ${explicitDate}.`,
              pd ? `הדדליין להפקה הוא ${pd}.` : "",
              "",
              "באיזו שעה לתכנן את ההעלאה?",
            ].filter(Boolean).join("\n")
          );
          return res.status(200).json({ status: "confirm_gantt_write_explicit_date", sender });
        }
      }
      const shortName = contentName.split(/\s+/).slice(0, 6).join(" ");
      await sendTurnReply(
        sender,
        [
          `לא בטוחה אם להכניס את "${shortName}" ב-${date}.`,
          "",
          "אפשר לענות כן, לא, לא עכשיו, או לכתוב פקודה אחרת.",
        ].join("\n")
      );

      return res.status(200).json({ status: "confirm_gantt_write_unclear", sender });
      }
    }
    if (pendingQuestion?.questionType === "set_deadline") {
      const contentId = pendingQuestion.context?.contentId as string;
      const rawDeadline = incomingText.trim();
      const isExplicitCommandWhileSettingDeadline =
        isArchiveCommand(incomingText) ||
        isApproveForProductionCommand(incomingText) ||
        isRestoreCommand(incomingText) ||
        isDeadlineUpdate(incomingText);

      if (isExplicitCommandWhileSettingDeadline) {
        clearPendingQuestion(sender);
        console.log(`[Route Debug] set_deadline: explicit command detected, falling through`);
      } else {

      if (isRejectionMessage(incomingText)) {
        clearPendingQuestion(sender);
        await sendTurnReply(sender, "בסדר, אפשר תמיד להוסיף תאריך אחר כך.");
        return res.status(200).json({ status: "deadline_skipped", sender });
      }

      const normalizedDeadline = normalizeUserDateInput(rawDeadline);
      const hasMonthName = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"].some(m => rawDeadline.includes(m));

      if (!normalizedDeadline && !hasMonthName) {
        await sendTurnReply(sender, "לא קלטתי תאריך תקין. אפשר לכתוב למשל 17.6, 17-6 או 17/6.");
        return res.status(200).json({ status: "deadline_invalid_date", sender });
      }

      const deadline = normalizedDeadline || rawDeadline;
      clearPendingQuestion(sender);

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
      if (spreadsheetId && contentId) {
        const rowIndex = await findRowIndexByContentId(spreadsheetId, contentId);
        if (rowIndex) {
          await updateDeadline(spreadsheetId, rowIndex, deadline);
          await sendTurnReply(sender, `מעולה, עדכנתי את הדדליין ל-${deadline}.`);
        } else {
          await sendTurnReply(sender, "לא מצאתי את המשימה בגיליון, אפשר לעדכן ידנית.");
        }
      }
      return res.status(200).json({ status: "deadline_set", sender });
      }
    }
    if (pendingQuestion?.questionType === "confirm_duplicate") {
      const isExplicitCommandWhileConfirmingDuplicate =
        isArchiveCommand(incomingText) ||
        isApproveForProductionCommand(incomingText) ||
        isRestoreCommand(incomingText) ||
        isDeadlineUpdate(incomingText);

      if (isExplicitCommandWhileConfirmingDuplicate) {
        clearPendingQuestion(sender);
        console.log(`[Route Debug] confirm_duplicate: explicit command detected, falling through`);
      } else {
        if (isRejectionMessage(incomingText)) {
          clearPendingQuestion(sender);
          await sendTurnReply(sender, "סבבה, לא שמרתי את זה.");
          return res.status(200).json({ status: "duplicate_rejected", sender });
        }

        if (isConfirmationMessage(incomingText)) {
          clearPendingQuestion(sender);
          const originalInput = pendingQuestion.context?.originalInput as string;

          if (!originalInput) {
            await sendTurnReply(sender, "איבדתי רגע את ההקשר של הרעיון. תשלחי אותו שוב ונמשיך.");
            return res.status(200).json({ status: "duplicate_context_missing", sender });
          }

          const draft = await createContentDraft(originalInput, sender);
          const requestedAction = pendingQuestion.context?.requestedAction as DraftSummary['requestedAction'];
          const draftSummary: DraftSummary = { ...draft, originalUserInput: originalInput,requestedAction,
            ...(pendingQuestion.context?.isTrend ? {category:"טרנד",priority:"גבוה" as const} : {}),
            approvalScope: requestedAction?.kind === "schedule" && requestedAction.date && parseSchedulingReply(requestedAction.date).kind === "valid" ? "save_schedule":"save" };
          const parked = activateNewDraft(sender,draftSummary);
          if (requestedAction?.kind === "schedule" && draftSummary.approvalScope !== "save_schedule") {
            const parsed = parseSchedulingReply(requestedAction.rawDate || requestedAction.date || "");
            storePendingQuestion(sender,{questionType:"draft_schedule_date",context:{candidate:'date' in parsed?parsed.date:undefined,time:requestedAction.time}});
          }

          const replyText = buildDraftPreviewMessage(draft);
          await sendTurnReply(sender, replyText);

          return res.status(200).json({ status: "duplicate_confirmed_draft_created", sender });
        }

        await sendTurnReply(
          sender,
          [
            "לא בטוחה אם לשמור את הרעיון הזה למרות שהוא דומה לרעיון קיים.",
            "",
            "אפשר לענות כן, לא, או לכתוב פקודה אחרת.",
          ].join("\n")
        );

        return res.status(200).json({ status: "confirm_duplicate_unclear", sender });
      }
    }

    if (pendingQuestion && isRejectionMessage(incomingText)) {
      clearPendingQuestion(sender);
      await sendTurnReply(sender, "אין בעיה, עזבתי את הרעיון.");
      return res.status(200).json({ status: "pending_question_rejected", sender });
    }
    if (pendingQuestion && isConfirmationMessage(incomingText)) {
     switch (pendingQuestion.questionType) {
        case "confirm_duplicate": {
          clearPendingQuestion(sender);
          const originalInput = pendingQuestion.context?.originalInput as string;
          if (!originalInput) {
            await sendTurnReply(sender, "איבדתי רגע את ההקשר של הרעיון. תשלחי אותו שוב ונמשיך.");
            return res.status(200).json({ status: "duplicate_context_missing", sender });
          }
          const draft = await createContentDraft(originalInput, sender);
          const draftSummary = { ...draft, originalUserInput: originalInput };
          storePendingConfirmation(sender, draftSummary);
          const replyText = buildDraftPreviewMessage(draft);
          await sendTurnReply(sender, replyText);
          return res.status(200).json({ status: "duplicate_confirmed_draft_created", sender });
        }
      }
    }

    // Sprint 9: New idea command should clear existing draft and start a fresh one
    // Fast Lane: Trend content - quick save without full draft flow
    if (isTrendCommand(incomingText)) {
      const trendText = getTrendText(incomingText);
      clearPendingConfirmation(sender);

      if (!trendText) {
        const replyText = "לא בטוחה איזה טרנד רצית לשמור.\nאפשר לכתוב למשל:\nטרנד: שם הסרטון";
        await sendTurnReply(sender, replyText);
        return res.status(200).json({ status: "trend_missing_text", sender });
      }

      // Trends go through Claude like any other idea (24.7.2026). They used to
      // reuse Karen's raw text as both the name AND the summary, which produced
      // long unusable names and a duplicated line in the preview. Speed was the
      // reason; the cost was that trends looked worse than everything else.
      const trendBase = await createContentDraft(trendText, sender);
      const trendDraft = {
        ...trendBase,
        category: "טרנד",
        tone: "טרנדי" as const,
        priority: "גבוה" as const,
        originalUserInput: trendText,
      };
      storePendingConfirmation(sender, trendDraft);

      const replyText = buildDraftPreviewMessage(trendDraft, {
        intro: "מעולה, קלטתי את הטרנד.",
        previewLine: "ככה הייתי שומרת אותו כרגע:",
      });
      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "trend_started", sender, draft: trendDraft });
    }
    if (isNewIdeaCommand(incomingText)) {
      const newIdeaText = getNewIdeaText(incomingText);
      const requestedContentType = getNewIdeaContentType(incomingText);
      if (!newIdeaText) {
        const replyText = "כדי לפתוח רעיון חדש, תשלחי לי למשל:\nרעיון חדש: ...\nאו:\nרעיון חדש לריל: ...\nרעיון חדש לפוסט: ...\nואני אמשיך משם.";
        await sendTurnReply(sender, replyText);
        return res.status(200).json({ status: "new_idea_command_missing_text", sender });
      }

      const draft = await createContentDraft(newIdeaText, sender);
      const draftSummary = {
        ...draft,
        contentType: requestedContentType || draft.contentType,
        originalUserInput: newIdeaText,
      };
      storePendingConfirmation(sender, draftSummary);

      const replyText = buildDraftPreviewMessage(draftSummary, {
  intro: "יאללה, בניתי טיוטה לרעיון חדש.",
  includeContentType: true,
});
      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "new_idea_started", sender, draft: draftSummary });
    }

    // Sprint 9: Reset commands clear the active draft and keep the session clean
    if (isResetRequest(incomingText)) {
      const pendingDraft = getPendingConfirmation(sender);
      clearPendingConfirmation(sender);

      const replyText = "אין בעיה, עזבנו את הרעיון הקודם ונמשיך הלאה.";
      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "draft_reset", sender, hadPendingDraft: !!pendingDraft });
    }

    // Check if this is a confirmation response
    if (isConfirmationMessage(incomingText)) {
      const pendingDraft = getPendingConfirmation(sender);
      if (pendingDraft) {
        if (pendingDraft.requestedAction?.kind === "schedule") suppliedTime = pendingDraft.requestedAction.time;
        // Clear only after the primary write succeeds.
        // Write to Google Sheets
        try {
          const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
          if (!spreadsheetId) {
            throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
          }

          console.log(`\n[Sprint 6 Workflow] User confirmed content from ${sender}`);

          // Get existing IDs and generate new one based on category prefix registry
          const existingIds = await getExistingContentIds(spreadsheetId);
          const contentId = await generateContentId(
            spreadsheetId,
            pendingDraft.category,
            existingIds,
            !!pendingDraft.categoryExplicit
          );
          console.log(`[Sprint 6 Workflow] Generated Content_ID: ${contentId}`);
          // Fast Track — שמירה לתכנים שאושרו במקום בנק רעיונות
          if ((pendingDraft as any).isFastTrack) {
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();
            const timestamp = now.toISOString();

            await saveFastTrackContent(
              spreadsheetId,
              contentId,
              pendingDraft.shortName,
              pendingDraft.summary,
              pendingDraft.category,
              pendingDraft.tone,
              pendingDraft.priority,
              pendingDraft.contentType || "ריל",
              (pendingDraft as any).statusTypes || ["filmed", "edited"]
            );

            clearPendingConfirmation(sender);
            if (pendingDraft.requestedAction?.kind === "keep") {
              clearPendingQuestion(sender); await sendTurnReply(sender,"שמרתי בלי תאריך.");
              return res.status(200).json({status:"fast_track_kept",sender,contentId});
            }
            if (pendingDraft.approvalScope === "save_schedule" && pendingDraft.requestedAction?.kind === "schedule" && pendingDraft.requestedAction.date) {
              const result = await scheduleSavedContent(sender,pendingDraft.shortName,pendingDraft.requestedAction.date,pendingDraft.requestedAction.time,contentId);
              return res.status(200).json({status:result,sender,contentId});
            }

            // חפש חור פנוי בגאנט
            const firstOfMonth = `01/${String(month).padStart(2, "0")}/${year}`;
            const available = await findAvailableDatesInMonth(spreadsheetId, firstOfMonth);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const futureAvailable = available.filter((date) => {
              const parts = date.split("/");
              const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
              return d >= today;
            });

            const replyText = `שמרתי את "${pendingDraft.shortName}".`;
            await sendTurnReply(sender, replyText);

            // Month full: no free future date this month. Look into next month
            // and glide there instead of a dead end, same pattern as the
            // production_overview nudge. A note tells Karen why the dates jumped.
            let ftDates = futureAvailable;
            let ftNextMonthNote = "";
            if (ftDates.length === 0) {
              const nmDate = new Date(year, month, 1);
              const nmFirst = `01/${String(nmDate.getMonth() + 1).padStart(2, "0")}/${nmDate.getFullYear()}`;
              const nmAvailable = await findAvailableDatesInMonth(spreadsheetId, nmFirst);
              ftDates = nmAvailable.slice(0, 1);
              ftNextMonthNote = "אין מקום פנוי לרילס נוסף החודש, אז בדקתי את תחילת החודש הבא.\n\n";
            }
            if (ftDates.length > 0) {
              const suggested = ftDates[0];
              const suggestedDayName = getHebrewDayName(suggested);
              // Gantt status must reflect what Karen actually reported. Filmed
              // AND edited -> "מוכן" (ready to upload). Filmed only -> "בתכנון",
              // because it still needs editing. The message says the same.
              const ftStatusTypes: string[] = (pendingDraft as any).statusTypes || ["filmed", "edited"];
              const ftReady = ftStatusTypes.includes("filmed") && ftStatusTypes.includes("edited");
              const ftGanttStatus = ftReady ? "מוכן" : "בתכנון";
              const ftStatusLine = ftReady
                ? 'הסטטוס בגאנט יהיה "מוכן", כי הסרטון כבר צולם ונערך.'
                : 'הסטטוס בגאנט יהיה "בתכנון", כי הסרטון צולם אבל עדיין לא נערך.';
              storePendingQuestion(sender, {
                questionType: "confirm_gantt_write",
                context: {
                  contentId,
                  contentName: pendingDraft.shortName,
                  date: suggested,
                  dayName: suggestedDayName,
                  ganttStatus: ftGanttStatus,
                },
              });
              const choiceLine = "מתאים לך התאריך הזה? אפשר לענות כן, לכתוב תאריך אחר, או לא כדי להשאיר אותו בינתיים בלי תאריך.";
              await sendTurnReply(
                sender,
                [
                  `${ftNextMonthNote}מצאתי תאריך פנוי קרוב בגאנט:`,
                  `${suggestedDayName}, ${suggested}`,
                  "",
                  choiceLine,
                ].join("\n")
              );
            } else {
              await sendTurnReply(sender, "לא מצאתי תאריך פנוי קרוב, גם לא בחודש הבא. אפשר להכניס ידנית עם תאריך.");
            }

            return res.status(200).json({ status: "fast_track_saved", sender, contentId });
          }
          // STEP 1: Save to בנק רעיונות (Content Library) - PRIMARY SHEET
          try {
            await saveContentIdea(
              spreadsheetId,
              contentId,
              pendingDraft.shortName,
              pendingDraft.summary,
              pendingDraft.category,
              pendingDraft.tone,
              pendingDraft.priority,
              pendingDraft.contentType || "ריל"
            );
            recordWriteOutcome("idea","succeeded");
            console.log(`[Sprint 6 Workflow] ✅ PRIMARY SHEET (בנק רעיונות) write succeeded`);
          } catch (contentError) {
            const errorMessage = contentError instanceof Error ? contentError.message : "Unknown error";
            console.error(`[Sprint 6 Workflow] ❌ PRIMARY SHEET (בנק רעיונות) write FAILED: ${errorMessage}`);
            throw new Error(`Failed to save content idea: ${errorMessage}`);
          }

          clearPendingConfirmation(sender);
          if (pendingDraft.requestedAction?.kind === "keep") {
            clearPendingQuestion(sender);
            await sendTurnReply(sender,"שמרתי בלי תאריך.");
            return res.status(200).json({status:"confirmed_kept",sender,contentId});
          }
          if (pendingDraft.approvalScope === "save_schedule" && pendingDraft.requestedAction?.kind === "schedule" && pendingDraft.requestedAction.date) {
            const result = await scheduleSavedContent(sender,pendingDraft.shortName,pendingDraft.requestedAction.date,pendingDraft.requestedAction.time);
            return res.status(200).json({status:result,sender,contentId});
          }

          // STEP 2: Production task created manually when content is approved for production
          const taskCreationFailed = false;

         // STEP 3: Send WhatsApp confirmation.
          // Bridge (bank→gantt, step 1 — 12.7.2026): if a nearby gantt date
          // is free this month, the passive "here's the command" tail is
          // replaced with an active scheduling offer, managed as a
          // bridge_offer pendingQuestion. Same date-finding as the
          // approve-for-production flow (v1 scope: current month). If
          // nothing is free or the lookup fails — message unchanged, zero
          // noise.
          let bridgeOfferLine: string | null = null;

          // Fast Lane aggressive scheduling (step 1 — 21.7.2026): a trend is
          // time-critical; it shouldn't sit in the bank. If this draft is a
          // trend, offer today/tomorrow up front instead of the calm bridge
          // offer. Story = unbound by cadence → always offerable; reel = only
          // a free day. If both taken, fall through to the calm offer (the
          // full-week displacement flow is step 2).
          const isTrendDraft = pendingDraft.category === "טרנד";
          if (isTrendDraft) {
            try {
              const now = new Date();
              const day0 = new Date(now); day0.setHours(0,0,0,0);
              const day1 = new Date(now); day1.setDate(day1.getDate() + 1); day1.setHours(0,0,0,0);
              const fmt = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
              const todayDate = fmt(day0);
              const tomorrowDate = fmt(day1);

              const isStory = (pendingDraft.contentType || "") === "סטורי";
              const todayTaken = (await isGanttDateTaken(spreadsheetId, todayDate)).taken;
              const tomorrowTaken = (await isGanttDateTaken(spreadsheetId, tomorrowDate)).taken;

              const options: string[] = [];
              if (isStory || !todayTaken) options.push(todayDate);
              if (isStory || !tomorrowTaken) options.push(tomorrowDate);

              if (options.length > 0) {
                storePendingQuestion(sender, {
                  questionType: "trend_schedule",
                  context: { contentId, contentName: pendingDraft.shortName, options, isStory, todayDate, tomorrowDate },
                });
                // Label by the ACTUAL date, not list position — when today is
                // already taken, the first remaining option is tomorrow, and
                // calling it "היום" (position-based) would be wrong.
                const labelFor = (d: string) => (d === todayDate ? "היום" : d === tomorrowDate ? "מחר" : "");
                if (options.length === 1) {
                  const d = options[0];
                  const lbl = labelFor(d);
                  const when = lbl ? `${lbl} (${d})` : d;
                  bridgeOfferLine = `סגור! יש לך ${when} מקום פנוי. להכניס אותו לשם?`;
                } else {
                  const optLines2 = options
                    .map((d) => { const lbl = labelFor(d); return lbl ? `${lbl} (${d})` : d; })
                    .join(" או ");
                  bridgeOfferLine = `סגור! יש מקום פנוי ${optLines2}. לאיזה מהם להכניס אותו?`;
                }
              } else {
                // Fast Lane step 2 (21.7.2026): trend reel, today AND tomorrow
                // taken (week full). Offer to push an organic reel to make
                // room. Karen picks which; we auto-move it to the nearest smart
                // date and slot the trend into the freed day (single choice).
                // Which reels block today/tomorrow, flagged collab vs organic.
                const blockingReels = await getReelsBlockingDates(spreadsheetId, [todayDate, tomorrowDate]);
                const organicBlockers = blockingReels.filter((r) => !r.isCollab);
                const collabBlockers = blockingReels.filter((r) => r.isCollab);

                if (blockingReels.length > 0) {
                  // Human phrasing of what's occupying the days.
                  const occNames = blockingReels.map((r) => `"${r.name}"`).join(" ו-");
                  const dayWord = blockingReels.length === 1 ? "היום תפוס" : "היום ומחר תפוסים";

                  if (organicBlockers.length === 1) {
                    // MODE recommend: one organic to move, collab(s) stay put.
                    const org = organicBlockers[0];
                    const now = new Date();
                    const firstOfMonth = `01/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
                    const smart = await findSmartGanttDate(spreadsheetId, firstOfMonth, { forNewItemType: "ריל" });
                    const tomorrowD = new Date(); tomorrowD.setDate(tomorrowD.getDate() + 1); tomorrowD.setHours(0,0,0,0);
                    const futureSmart = smart.filter((d: string) => {
                      const p = d.split("/"); return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])) >= tomorrowD;
                    }).filter((d: string) => d !== org.date);
                    const suggestedDate = futureSmart[0];
                    if (suggestedDate) {
                      storePendingQuestion(sender, {
                        questionType: "trend_make_room",
                        context: {
                          contentId, contentName: pendingDraft.shortName,
                          mode: "recommend",
                          organic: org, collabs: collabBlockers,
                          suggestedDate, altDates: futureSmart.slice(0, 3),
                          freedDate: org.date,
                        },
                      });
                      const collabNote = collabBlockers.length > 0
                        ? `את "${collabBlockers[0].name}" עדיף להשאיר בתאריך שסגרנו מול המותג, `
                        : "";
                      bridgeOfferLine = [
                        `אין בעיה, אבל שנייה לפני זה,`,
                        `${dayWord} עם ${occNames}.`,
                        "",
                        `${collabNote}אז אני מציעה להעביר את "${org.name}" ל-${suggestedDate}, ולהכניס את הטרנד במקומו.`,
                        "",
                        `מתאים לך שאעשה את השינוי? (כן / לא)`,
                      ].join("\n");
                    }
                  } else if (organicBlockers.length > 1) {
                    // MODE choose: several organics — Karen picks which to move.
                    storePendingQuestion(sender, {
                      questionType: "trend_make_room",
                      context: {
                        contentId, contentName: pendingDraft.shortName,
                        mode: "choose", reels: organicBlockers,
                      },
                    });
                    const reelLines = organicBlockers.map((r) => `"${r.name}"`).join("\n");
                    bridgeOfferLine = [
                      `אין בעיה, אבל שנייה לפני זה,`,
                      `${dayWord} עם ${occNames}.`,
                      "",
                      `כדי לפנות מקום לטרנד, איזה מהם תרצי שאעביר?`,
                      "",
                      reelLines,
                    ].join("\n");
                  } else {
                    // MODE all-collab: nothing organic to move — offer another day.
                    const now = new Date();
                    const firstOfMonth = `01/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
                    const smart = await findSmartGanttDate(spreadsheetId, firstOfMonth, { forNewItemType: "ריל" });
                    const tomorrowD = new Date(); tomorrowD.setDate(tomorrowD.getDate() + 1); tomorrowD.setHours(0,0,0,0);
                    const futureSmart = smart.filter((d: string) => {
                      const p = d.split("/"); return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])) >= tomorrowD;
                    });
                    const altDate = futureSmart[0];
                    if (altDate) {
                      storePendingQuestion(sender, {
                        questionType: "trend_make_room",
                        context: {
                          contentId, contentName: pendingDraft.shortName,
                          mode: "otherday", suggestedDate: altDate, altDates: futureSmart.slice(0, 3),
                        },
                      });
                      bridgeOfferLine = [
                        `אין בעיה, אבל שנייה לפני זה,`,
                        `${dayWord} עם ${occNames}, ואלה שיתופי פעולה שסגורים מול מותגים אז עדיף לא להזיז אותם.`,
                        "",
                        `רוצה שאשבץ את הטרנד ל-${altDate}? (כן / לא)`,
                      ].join("\n");
                    }
                  }
                }
              }
            } catch (trendErr) {
              console.error(`[Fast Lane] aggressive schedule failed, falling back: ${trendErr}`);
            }
          }

          // Only run the calm bridge offer if the Fast Lane didn't already
          // produce an aggressive one above.
          if (!bridgeOfferLine) try {
            const bridgeNow = new Date();
            const bridgeFirstOfMonth = `01/${String(bridgeNow.getMonth() + 1).padStart(2, "0")}/${bridgeNow.getFullYear()}`;
            // Step B (21.7.2026): smart date suggestion. Cadence rules
            // (2 organic reels/week, 2-day gap) bind only organic reels;
            // findSmartGanttDate filters by the draft's content type and
            // falls back to the plain list if nothing qualifies.
            const bridgeAvailable = await findSmartGanttDate(spreadsheetId, bridgeFirstOfMonth, {
              forNewItemType: pendingDraft.contentType,
            });
            const bridgeEarliest = new Date();
            bridgeEarliest.setDate(bridgeEarliest.getDate() + 1);
            bridgeEarliest.setHours(0, 0, 0, 0);
            const bridgeFuture = bridgeAvailable.filter((candidateDate) => {
              const parts = candidateDate.split("/");
              const parsed = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
              return parsed >= bridgeEarliest;
            });
            if (bridgeFuture.length > 0) {
              const bridgeDate = bridgeFuture[0];
              const bridgeDayName = getHebrewDayName(bridgeDate);
              // Intent-first (23.7.2026): the old message merged two questions
              // ("schedule it?" and "on this date?"), so "לא" was ambiguous.
              // Now we ask only about intent; dates come in the next step.
              storePendingQuestion(sender, {
                questionType: "bridge_offer",
                context: {
                  contentId,
                  contentName: pendingDraft.shortName,
                  date: bridgeDate,
                  dayName: bridgeDayName,
                  availableDates: bridgeFuture.slice(0, 3),
                  askedIntentOnly: true,
                },
              });
              bridgeOfferLine = `רוצה לקבוע לו תאריך בגאנט עכשיו, או להשאיר אותו כרגע בלי תאריך?`;
            }
          } catch (bridgeError) {
            console.error(`[Bridge] free-date lookup failed, keeping passive tail: ${bridgeError}`);
          }

          // A trend runs forward — it shouldn't read as "saved to the bank".
          // Show the aggressive scheduling offer directly (the trend is still
          // saved to the bank silently, for tracking). Non-trend ideas keep
          // the normal "saved to bank" message.
          // month_full_choice offered (26.7.2026): before falling back to the
          // "no room" dead end, check whether the month is merely full for a new
          // organic reel. If so, and there is room next month or reels to shift,
          // offer Karen the choice instead of blocking.
          if (!bridgeOfferLine) {
            try {
              const evalNow = new Date();
              const evalRequested = `${String(evalNow.getDate()).padStart(2, "0")}/${String(evalNow.getMonth() + 1).padStart(2, "0")}/${evalNow.getFullYear()}`;
              const monthEval = await evaluateMonthFullForReel(spreadsheetId, evalRequested);
              if (monthEval.isMonthFull && (monthEval.nextMonthDates.length > 0 || monthEval.shiftableReels.length > 0)) {
                storePendingQuestion(sender, {
                  questionType: "month_full_choice",
                  context: {
                    contentId,
                    contentName: pendingDraft.shortName,
                    nextMonthDates: monthEval.nextMonthDates,
                    shiftableReels: monthEval.shiftableReels,
                  },
                });
                bridgeOfferLine = [
                  "אין כרגע מקום פנוי לרילס נוסף החודש.",
                  "מה תרצי לעשות?",
                  "",
                  "1. לקבוע לו תאריך בתחילת החודש הבא",
                  "2. להזיז רילס שכבר מתוכנן",
                  "3. להעביר אותו להפקה בלי תאריך",
                  "",
                  "אפשר לענות במספר או במילים.",
                ].join("\n");
              }
            } catch (monthFullError) {
              console.error(`[MonthFull] evaluation skipped: ${monthFullError}`);
            }
          }
          const replyText = (pendingDraft.category === "טרנד" && bridgeOfferLine)
            ? bridgeOfferLine
            : [
                // Copy polish (24.7.2026): "מעולה" added nothing, and the name
                // was just shown in the draft she is confirming. The no-date
                // branch used to teach a command; now it just states the fact.
                ...(bridgeOfferLine
                  ? ["שמרתי את הרעיון.", "", bridgeOfferLine]
                  : [
                      "שמרתי את הרעיון. כרגע אין מקום פנוי בגאנט, אז הוא נשאר בינתיים בלי תאריך.",
                    ]),
              ].join("\n");

await sendTurnReply(sender, replyText);
          console.log(`[Sprint 6 Workflow] ✅ WhatsApp confirmation sent`);

          console.log(`[Sprint 6 Workflow] ✅ COMPLETE: Content ${contentId} confirmed and saved\n`);

          return res.status(200).json({
            status: "confirmed_and_saved",
            sender,
            contentId,
            draft: pendingDraft,
            taskCreationFailed,
          });
        } catch (sheetError) {
          const errorMessage =
            sheetError instanceof Error ? sheetError.message : "Unknown error";
          console.error(`[Sprint 6 Workflow] ❌ CRITICAL ERROR: ${errorMessage}\n`);

          const replyText = "קיבלתי את האישור, אבל השמירה לא הצליחה. תנסי שוב עוד רגע.";
          await sendTurnReply(sender, replyText);

          return res.status(500).json({
            status: "confirmed_but_save_failed",
            sender,
            error: errorMessage,
          });
        }
      } else {
        const replyText = "כרגע אין רעיון שממתין לאישור.\nאם יש לך רעיון חדש, תשלחי לי ונמשיך משם.";
        await sendTurnReply(sender, replyText);
        return res.status(200).json({ status: "no_pending", sender });
      }
    }

   // Check if this is an edit request
   // Exclusions: isEditRequest fires on very loose indicators (e.g. "צריך",
   // "יהיה", "אני רוצה") so a message like "תעבירי לארכיון: 1. X — צריך
   // החלטה" was being mis-routed as an edit request and hijacked before the
   // archive handler could see it. Explicit other-command detectors take
   // precedence over the edit fallback.
// Audit F3: question-shaped messages are excluded too. With a pending
// draft open, "מה הסטטוס של הריל על קפריסין?" contains "ריל" and was
// swallowed here — triggering askClaudeForEdit on an unrelated draft
// instead of reaching the visibility handlers below. A question falls
// through to visibility routing; a genuine edit phrased as a question
// ("אפשר לשנות את הטון?") still gets edited later in the chain via the
// pending-draft askClaudeForEdit fallback (station 22), so nothing is
// lost — only mis-routing is prevented.
if (
  isEditRequest(incomingText) &&
  !isQuestionLikeMessage(incomingText) &&
  !isDeadlineUpdate(incomingText) &&
  !isProductionStatusUpdate(incomingText) &&
  !isArchiveCommand(incomingText) &&
  !isApproveForProductionCommand(incomingText) &&
  !isRestoreCommand(incomingText) &&
  !isGanttDateChange(incomingText)
) {
  const pendingDraft = getPendingConfirmation(sender);

  if (pendingDraft) {
    const edit = parseEditRequest(incomingText);

    if (edit) {
      let updatedDraft = applyEditToDraft(pendingDraft, edit);

      const editText = incomingText.trim();

      const explicitNameMatch = editText.match(
        /(?:השם\s+(?:יהיה|יהייה)|שם\s+(?:יהיה|יהייה)|תקראי לזה|תקרא לזה|קראי לזה|קרא לזה|שיקראו לזה)\s+(.+?)(?:,|\.|$)/i
      );

      if (explicitNameMatch?.[1]) {
        const cleanedName = explicitNameMatch[1]
          .trim()
          .replace(/^יהיה\s+/i, "")
          .replace(/^יהייה\s+/i, "")
          .replace(/^ל/i, "")
          .trim()
          .split(/\s+/)
          .slice(0, 6)
          .join(" ");

        if (cleanedName) {
          updatedDraft.shortName = cleanedName;
        }
      }

      const wantsFunny =
        editText.includes("יותר מצחיק") ||
        editText.includes("מצחיק") ||
        editText.includes("הומור") ||
        editText.includes("קליל") ||
        editText.includes("פחות כבד");

      if (wantsFunny) {
        updatedDraft.tone = "מצחיק" as any;

        if (editText.includes("פחות כבד") || editText.includes("קליל")) {
          const baseSummary = updatedDraft.summary
            .replace(/^תוכן על\s*/i, "")
            .replace(/^סרטון על\s*/i, "")
            .trim();

          updatedDraft.summary = `סרטון קליל ומצחיק על ${baseSummary}, עם יותר הומור עצמי ופחות תחושה כבדה.`;
        }
      }

      storePendingConfirmation(sender, updatedDraft);

      const previewCopy = await humanizeDraftPreview(updatedDraft, sender, "edit", incomingText);
      const replyText = buildDraftPreviewMessage(updatedDraft, {
        intro: previewCopy.intro,
        previewLine: "ככה הייתי שומרת את זה עכשיו:",
        closingQuestion: previewCopy.closingQuestion,
        changeLine: previewCopy.changeLine,
      });

      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "draft_updated", sender, draft: updatedDraft });
    }

    // AI fallback: hardcoded parser could not interpret this edit. Ask Claude
    // to apply the requested change onto the draft. Null result → fall through
    // to today's clarification prompt below (no crash).
    const aiEditedDraft = await askClaudeForEdit(pendingDraft, incomingText, sender);

    if (aiEditedDraft) {
      storePendingConfirmation(sender, aiEditedDraft);

      // Humanizer consolidation: the wrapping copy now arrives on the draft
      // itself, generated by the same askClaudeForEdit call — no second
      // Sonnet call. Defaults cover the rare parse miss.
      // FIXED_EDIT_COPY (24.7.2026): the AI edit path returned its own wrapping
      // lines ("טוב ככה?" / "תגידי אם יש משהו נוסף לשנות"), bypassing the copy
      // we settled on. Only the name and summary come from Claude.
      const aiPreviewCopy = DEFAULT_EDIT_COPY;
      const aiReplyText = buildDraftPreviewMessage(aiEditedDraft, {
        intro: aiPreviewCopy.intro,
        previewLine: "ככה הייתי שומרת את זה עכשיו:",
        closingQuestion: aiPreviewCopy.closingQuestion,
        changeLine: aiPreviewCopy.changeLine,
      });

      await sendTurnReply(sender, aiReplyText);
      return res.status(200).json({ status: "draft_updated_via_ai", sender, draft: aiEditedDraft });
    }

storePendingQuestion(sender, { questionType: "edit_or_new_clarification", context: {} });
    const clarificationPrompt = generateClarificationPrompt(true);
    await sendTurnReply(sender, clarificationPrompt);
    return res.status(200).json({ status: "edit_not_understood", sender });
  }
  // NEW_IDEA_BEATS_EDIT (24.7.2026): isEditRequest matches on very general
  // words ("יהיה", "אני רוצה", "צריך"), so a plain new idea like
  // "רעיון לסרטון על מה שלא יהיה אני מרוצה" landed here instead of becoming a
  // draft. With no draft open there is nothing to edit anyway, so if the
  // message reads like a new idea, let it through rather than asking Karen to
  // rephrase in a format we invented.
  if (hasIdeaConfidence(incomingText)) {
    console.log(`[Route Debug] no draft open and the message reads as a new idea, routing onward`);
  } else {
    const clarificationPrompt = generateClarificationPrompt(false);
    await sendTurnReply(sender, clarificationPrompt);
    return res.status(200).json({ status: "no_pending_for_edit", sender });
  }
  }
    const normalizedPlanningSourceText = incomingText.trim();

    if (
      normalizedPlanningSourceText === "בואי נבדוק את הגאנט" ||
      normalizedPlanningSourceText === "בוא נבדוק את הגאנט" ||
      normalizedPlanningSourceText === "בואי נתכנן קדימה" ||
      normalizedPlanningSourceText === "בואי נשלים את השבוע" ||
      normalizedPlanningSourceText === "בואי נשלים פוסט לשבוע" ||
      normalizedPlanningSourceText === "בואי נשלים פוסט לשבוע הבא"
    ) {
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

      if (!spreadsheetId) {
        throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
      }

      const state = await buildCurrentWeekPlanningSourceRoutingState(spreadsheetId);

      if (!state) {
        await sendTurnReply(
          sender,
          "לא מצאתי כרגע חוסר דחוף בגאנט של שבוע הבא."
        );

        return res.status(200).json({
          status: "planning_source_routing_no_gap",
          sender,
        });
      }

      storePendingQuestion(sender, {
        questionType: "planning_source_routing",
        context: state,
      });

      await sendTurnReply(
        sender,
        buildPlanningSourceRoutingMessage(state)
      );

      return res.status(200).json({
        status: "planning_source_routing_started",
        sender,
      });
    }

    // ===== VISIBILITY INTENT DETECTION =====
    console.log(`[Route Debug] About to detect visibility intent...`);
    // Audit F8: skip the AI visibility classifier when a deterministic
    // command handler later in this chain will catch the message anyway
    // (e.g. "תזכירי לי מה יש בארכיון" is a view-archive command, not a
    // pipeline question). Sync visibility detection still runs.
    const matchesDeterministicCommand =
      isViewArchiveCommand(incomingText) ||
      isRestoreCommand(incomingText) ||
      isApproveForProductionCommand(incomingText) ||
      isBulkArchiveCommand(incomingText) ||
      isArchiveCommand(incomingText) ||
      isDeadlineUpdate(incomingText) ||
      isProductionStatusUpdate(incomingText);
    const visibilityIntent = await detectVisibilityIntentWithAI(incomingText, {
      skipAI: matchesDeterministicCommand,
    });
    console.log(`[Route Debug] visibilityIntent: ${visibilityIntent || "null"}`);
    console.log(`[Route Debug] detectVisibilityIntent result: ${visibilityIntent || "null"}`);
    const questionLikeMessage = isQuestionLikeMessage(incomingText);
    const activePendingQuestion = getPendingQuestion(sender);
    console.log(`[Route Debug] questionLikeMessage: ${questionLikeMessage}`);

    // Sprint 10: Core rule - ANY visibilityIntent is read-only and must be handled before production updates
    // Exception: if monthly_planning is active, let the pending question handler take over
    if (visibilityIntent && activePendingQuestion?.questionType !== "monthly_planning") {
      try {
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
        if (!spreadsheetId) {
          throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
        }

        console.log(`[Sprint 10] Visibility query detected: ${visibilityIntent}`);

        if (visibilityIntent === "task_status") {
          // Rebuilt 23.7.2026. This used to search production only and answer
          // with a dry status line, so "תזכיר לי את X" on a waiting idea found
          // nothing. Now it searches the bank too, leads with the summary that
          // actually answers her, and offers the step that fits the state.
          const target = extractStatusQueryTarget(incomingText);
          if (!target) {
            await sendTurnReply(sender, "לא הצלחתי להבין על איזה תוכן שאלת. אפשר לכתוב את השם שלו.");
            return res.status(200).json({ status: "visibility_query_no_target", sender });
          }

          const found = await lookupContentByName(spreadsheetId, target);

          if (found.state === "not_found") {
            storePendingQuestion(sender, {
              questionType: "content_lookup_followup",
              context: { mode: "not_found" },
            });
            await sendTurnReply(
              sender,
              [`לא מצאתי תוכן בשם "${target}".`, "", "רוצה שאציג לך את התכנים ששמורים כרגע?"].join("\n")
            );
            return res.status(200).json({ status: "visibility_query_no_match", sender, target });
          }

          if (found.state === "ambiguous") {
            const names = (found.candidates || []).slice(0, 6).map((cd: any) => `"${cd.name}"`);
            await sendTurnReply(
              sender,
              buildAmbiguityQuestion({ kind: "found", itemType: "תכנים", options: names })
            );
            return res.status(200).json({ status: "visibility_query_ambiguous", sender, target });
          }

          // Karen says רילס, the sheet stores ריל (24.7.2026).
          const rawType = found.contentType || "ריל";
          const typeWord = rawType === "ריל" ? "רילס" : rawType;
          const headline = found.summary
            ? `"${found.name}" הוא ${typeWord} על ${found.summary}`
            : `"${found.name}" הוא ${typeWord}.`;

          if (found.state === "waiting") {
            storePendingQuestion(sender, {
              questionType: "content_lookup_followup",
              context: { mode: "waiting", contentId: found.contentId, contentName: found.name },
            });
            await sendTurnReply(
              sender,
              [headline, "", "הוא עדיין מחכה ולא עבר להפקה. רוצה להעביר אותו להפקה?"].join("\n")
            );
            return res.status(200).json({ status: "content_lookup_waiting", sender });
          }

          // Say what already happened and what is still missing.
          const productionLine =
            found.filmed === "כן" && found.edited === "כן"
              ? "הוא כבר צולם ונערך."
              : found.filmed === "כן"
                ? "הוא כבר צולם, ונשאר לערוך אותו."
                : "הוא עדיין מחכה לצילום.";

          const lookupLines = [headline, "", productionLine];
          if (found.deadline) lookupLines.push(`הדדליין להפקה הוא ${found.deadline}.`);

          if (found.state === "scheduled") {
            const when = found.ganttDayName
              ? `ביום ${found.ganttDayName}, ${found.ganttDate}`
              : `ב-${found.ganttDate}`;
            // The time appears only when it is actually set in the gantt.
            lookupLines.push(
              found.uploadTime
                ? `הוא מתוכנן לעלות ${when} בשעה ${found.uploadTime}.`
                : `הוא מתוכנן לעלות ${when}.`
            );
            await sendTurnReply(sender, lookupLines.join("\n"));
            return res.status(200).json({ status: "content_lookup_scheduled", sender });
          }

          storePendingQuestion(sender, {
            questionType: "content_lookup_followup",
            context: { mode: "in_production", contentId: found.contentId, contentName: found.name },
          });
          // One sentence that ties production state to the missing date, rather
          // than two separate "he still..." statements (24.7.2026).
          const noDateLine =
            found.filmed === "כן" && found.edited === "כן"
              ? "הוא כבר מוכן, אבל עדיין אין לו תאריך בגאנט. רוצה שנקבע לו אחד?"
              : found.filmed === "כן"
                ? "הוא כבר צולם, נשאר לערוך אותו ואין לו עדיין תאריך בגאנט. רוצה שנקבע לו תאריך?"
                : "הוא עדיין מחכה לצילום ואין לו תאריך בגאנט. רוצה שנמצא לו תאריך מתאים?";
          const noDateLines = [headline, ""];
          if (found.deadline) noDateLines.push(`הדדליין להפקה הוא ${found.deadline}.`, "");
          noDateLines.push(noDateLine);
          await sendTurnReply(sender, noDateLines.join("\n"));
          return res.status(200).json({ status: "content_lookup_in_production", sender });
        }

        let tasks: any[] = [];
        switch (visibilityIntent) {
          case "ideas_list": {
            const ideas = await getOpenContentIdeas(spreadsheetId);
            const replyText = formatOpenIdeasResponse(ideas);
            await sendTurnReply(sender, replyText);
            return res.status(200).json({ status: "visibility_ideas_list", sender, intent: visibilityIntent, count: ideas.length });
          }
          case "edited_not_uploaded": {
            const readyItems = await getGanttReadyToUpload(spreadsheetId);

            if (readyItems.length === 0) {
              await sendTurnReply(sender, "אין כרגע תכנים שערוכים ומחכים לעלות.");
              return res.status(200).json({ status: "visibility_ready_to_upload_empty", sender, intent: visibilityIntent });
            }

            const lines = readyItems.slice(0, 5).map((item) => {
              const date = item.date ? `, ${item.date}` : "";
              const time = item.uploadTime ? ` בשעה ${item.uploadTime}` : "";
              return `- ${item.name}${date}${time}`;
            });

            const suffix = readyItems.length > 5 ? `\n...ו${readyItems.length - 5} עוד` : "";
            const replyText = `כבר ערוך ומחכה לעלות:\n${lines.join("\n")}${suffix}`;

            await sendTurnReply(sender, replyText);
            return res.status(200).json({ status: "visibility_ready_to_upload", sender, intent: visibilityIntent });
          }
          case "missing_edit":
            tasks = await getTasksMissingEdit(spreadsheetId);
            break;
          case "missing_cover":
            tasks = await getTasksMissingCover(spreadsheetId);
            break;
          case "not_uploaded": {
            const ganttItems = await getGanttNotPublished(spreadsheetId);
            const replyText = formatGanttResponse(ganttItems, "עדיין לא פורסמו");
            await sendTurnReply(sender, replyText);
            return res.status(200).json({ status: "visibility_query", sender, intent: visibilityIntent });
          }
          case "stuck_workflow":
            tasks = await getStuckTasks(spreadsheetId);
            break;
            case "missing_filmed":
            tasks = await getTasksMissingFilmed(spreadsheetId);
            break;
            case "category_stage_filter": {
           const allCategories = await getCategories(spreadsheetId);
            const categoryNames = allCategories.map((c) => c.categoryName).sort((a, b) => b.length - a.length);
            const extracted = extractCategoryAndStage(incomingText, categoryNames);
            if (!extracted) {
              await sendTurnReply(sender, "לא הצלחתי להבין איזו קטגוריה ושלב ביקשת. נסי לכתוב למשל: מה לא צולם בקפריסין");
              return res.status(200).json({ status: "visibility_query", sender });
            }
            const categoryTasks = await getTasksByCategory(spreadsheetId, extracted.category, extracted.stage);
            const replyText = formatCategoryStageResponse(categoryTasks, extracted.category, extracted.stage);
            await sendTurnReply(sender, replyText);
            return res.status(200).json({ status: "visibility_category_stage", sender });
          }
            case "content_summary": {
            const keyword = extractSearchKeyword(incomingText);
            if (!keyword) {
              await sendTurnReply(sender, "לא הצלחתי להבין על איזה סרטון את מדברת. תנסי שוב עם השם המדויק.");
              return res.status(200).json({ status: "visibility_query", sender });
            }
            const summary = await getContentIdeaSummary(spreadsheetId, keyword);
            if (!summary) {
              await sendTurnReply(sender, "לא מצאתי תוכן שמתאים למה שכתבת. תנסי עם שם קצת יותר מדויק.");
              return res.status(200).json({ status: "visibility_query", sender });
            }
            const replyText = `מצאתי את הסרטון\n"${summary.shortName}"\nהרעיון שלו:\n${summary.idea}`;
            await sendTurnReply(sender, replyText);
            return res.status(200).json({ status: "visibility_content_summary", sender });
          }
          case "monthly_planning": {
            const monthNames: Record<string, number> = {
              "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4,
              "מאי": 5, "יוני": 6, "יולי": 7, "אוגוסט": 8,
              "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
            };
            const monthMatch = incomingText.match(/(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/);
            if (!monthMatch) {
              await sendTurnReply(sender, "לא הצלחתי להבין איזה חודש. נסי לכתוב: בואי נתכנן את יולי");
              return res.status(200).json({ status: "monthly_planning_parse_error", sender });
            }
            const monthName = monthMatch[1];
            const month = monthNames[monthName];
            const now = new Date();
            const year = month < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear();

            const [unscheduled, available] = await Promise.all([
              getApprovedContentNotInGantt(spreadsheetId, month, year),
              findAvailableDatesInMonth(spreadsheetId, `01/${String(month).padStart(2, "0")}/${year}`),
            ]);

            if (unscheduled.length === 0) {
              await sendTurnReply(sender, `כל התכנים שאושרו כבר משובצים ב${monthName}. אם תרצי להוסיף עוד, תוסיפי קודם לתכנים שאושרו.`);
              return res.status(200).json({ status: "monthly_planning_nothing_to_schedule", sender });
            }

            storePendingQuestion(sender, {
              questionType: "monthly_planning",
              context: {
                month,
                year,
                monthName,
                remainingContent: unscheduled,
              },
            });

            const displayItems = unscheduled.slice(0, 5);
const displayList = displayItems
  .map((c) => `- ${c.name.split(/\s+/).slice(0, 6).join(" ")}`)
  .join("\n");

const suffix = unscheduled.length > 5
  ? `\nועוד ${unscheduled.length - 5} תכנים שלא הצגתי כאן כדי לא להעמיס.`
  : "";

const firstSuggestion = displayItems[0]?.name
  ? displayItems[0].name.split(/\s+/).slice(0, 6).join(" ")
  : "";

const replyText = [
  `יש לך ${unscheduled.length} תכנים שאושרו ועדיין לא שובצו ב${monthName}.`,
  "",
  "מה עוד מחכה לתאריך:",
  `${displayList}${suffix}`,
  "",
  available.length > 0
    ? `יש מספיק ימים פנויים ב${monthName}.`
    : `לא מצאתי כרגע ימים פנויים ב${monthName}.`,
  "",
  firstSuggestion
    ? `הייתי מתחילה מ: "${firstSuggestion}".`
    : "אפשר לבחור תוכן ראשון להכניס.",
  "",
 "אם מתאים להתחיל ממנו, תכתבי כן.",
"אפשר גם לכתוב שם של תוכן אחר מהרשימה.",
].join("\n");
            await sendTurnReply(sender, replyText);
            return res.status(200).json({ status: "monthly_planning_started", sender });
          }
          case "gantt_holes": {
  const now = new Date();
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
  const currentYear = now.getFullYear();
  const firstOfMonth = `01/${currentMonth}/${currentYear}`;

  const available = await findAvailableDatesInMonth(spreadsheetId, firstOfMonth);

  const earliestGanttDate = new Date();
  earliestGanttDate.setDate(earliestGanttDate.getDate() + 1);
  earliestGanttDate.setHours(0, 0, 0, 0);

  const futureAvailable = available
    .filter((date) => {
      const parts = date.split("/");
      const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      return d >= earliestGanttDate;
    })
    .sort((a, b) => {
      const aParts = a.split("/");
      const bParts = b.split("/");
      const aDate = new Date(parseInt(aParts[2]), parseInt(aParts[1]) - 1, parseInt(aParts[0]));
      const bDate = new Date(parseInt(bParts[2]), parseInt(bParts[1]) - 1, parseInt(bParts[0]));
      return aDate.getTime() - bDate.getTime();
    });

  const replyText = formatGanttHolesResponse(futureAvailable);
  await sendTurnReply(sender, replyText);
  return res.status(200).json({ status: "visibility_gantt_holes", sender });
}
          case "gantt_write": {
            const params = extractGanttWriteParams(incomingText);
            if (!params) {
              const suppliedDate = incomingText.match(/\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?/)?.[0];

              if (suppliedDate && !normalizeUserDateInput(suppliedDate)) {
                await sendTurnReply(
                  sender,
                  `התאריך ${suppliedDate} לא תקין. אפשר לכתוב למשל 17.6, 17-6 או 17/6.`
                );
                return res.status(200).json({ status: "gantt_write_invalid_date", sender });
              }

              await sendTurnReply(sender, "לא הצלחתי להבין. נסי לכתוב למשל: תוסיפי את זוגיות בתקופת חתונה לגאנט ב-15/06");
              return res.status(200).json({ status: "gantt_write_parse_error", sender });
            }

            const match = await findApprovedContentByName(spreadsheetId, params.contentName);

            // חשב שם יום
            const parsedDate = params.date.split("/");
            const dateObj = new Date(
              parseInt(parsedDate[2]),
              parseInt(parsedDate[1]) - 1,
              parseInt(parsedDate[0])
            );
            const dayName = getHebrewDayNameFromDate(dateObj);

            if (!match) {
              await sendTurnReply(sender, `לא מצאתי תוכן בשם "${params.contentName}" בתכנים שאושרו. תבדקי את השם ותנסי שוב.`);
              return res.status(200).json({ status: "gantt_write_not_found", sender });
            }

            if (
              await blockDuplicateGanttWrite(
                sender,
                spreadsheetId,
                match.contentId
              )
            ) {
              return res.status(200).json({
                status: "gantt_duplicate_blocked",
                sender,
              });
            }

            if (match.exact) {
              // בדיקת התנגשות
              const collision = await isGanttDateTaken(spreadsheetId, params.date);
              if (collision.taken) {
                const shortExisting = collision.existingName.split(/\s+/).slice(0, 6).join(" ");
                const shortNew = match.name.split(/\s+/).slice(0, 6).join(" ");
                storePendingQuestion(sender, {
                  questionType: "gantt_collision",
                  context: {
                    newContentId: match.contentId,
                    newContentName: match.name,
                    newDate: params.date,
                    newDayName: dayName,
                    existingContentId: collision.existingContentId,
                    existingName: collision.existingName,
                  },
                });
                await sendTurnReply(sender, `ב-${params.date} כבר מתוכנן "${shortExisting}".\nרוצה שאכניס את "${shortNew}" במקומו ואעביר את "${shortExisting}" לתאריך אחר?`);
                return res.status(200).json({ status: "gantt_collision_detected", sender });
              }

              await addRowToGantt(spreadsheetId, match.contentId, match.name, params.date, dayName);
              await sortGanttByDate(spreadsheetId);
              storePendingQuestion(sender, {
                questionType: "gantt_upload_time",
                context: { contentName: match.name, date: params.date },
              });
              const shortName = match.name.split(/\s+/).slice(0, 6).join(" ");
              await sendTurnReply(sender, `מעולה, הוספתי את "${shortName}" לגאנט ב-${params.date} (יום ${dayName}).\nבאיזו שעה לתכנן את ההעלאה?`);
              return res.status(200).json({ status: "gantt_write_success", sender });
            }

            // התאמה חלקית — שאל לאישור
            storePendingQuestion(sender, {
              questionType: "confirm_gantt_write",
              context: { contentId: match.contentId, contentName: match.name, date: params.date, dayName },
            });
            await sendTurnReply(sender, `לא מצאתי "${params.contentName}", האם התכוונת ל-"${match.name}"?`);
            return res.status(200).json({ status: "gantt_write_confirm_needed", sender });
          }
          case "gantt_query": {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sevenDaysFromNow = new Date(today);
  sevenDaysFromNow.setDate(today.getDate() + 7);
  sevenDaysFromNow.setHours(23, 59, 59, 999);

  const ganttItems = await getGanttByDateRange(spreadsheetId, today, sevenDaysFromNow);
  const activeGanttItems = ganttItems.filter((item) => item.status !== "פורסם");

  const replyText = formatGanttResponse(activeGanttItems, "7 הימים הקרובים");
  await sendTurnReply(sender, replyText);
  return res.status(200).json({ status: "visibility_gantt", sender });
}
          case "category_search": {
            const keyword = extractSearchKeyword(incomingText);
            if (!keyword) {
              tasks = [];
            } else {
              tasks = await searchTasksByKeyword(spreadsheetId, keyword);
            }
            break;
          }
          case "whats_important": {
              const today = new Date();
              today.setHours(0, 0, 0, 0);

              const currentWeekStart = new Date(today);
              currentWeekStart.setDate(today.getDate() - today.getDay());

              const nextWeekEnd = new Date(currentWeekStart);
              nextWeekEnd.setDate(currentWeekStart.getDate() + 13);
              nextWeekEnd.setHours(23, 59, 59, 999);

              const [priorityItems, planningGanttItems] = await Promise.all([
                fetchPriorityItems(),
                getGanttByDateRange(spreadsheetId, currentWeekStart, nextWeekEnd),
              ]);
              const planningSignals = computePlanningHealthSignals(
                planningGanttItems,
                { anchorDate: today }
              );
              const replyText = formatPriorityWhatsImportantResponse(
                priorityItems,
                planningSignals
              );

              await sendTurnReply(sender, replyText);

              return res.status(200).json({ status: "visibility_query", sender, intent: visibilityIntent });
            }
          case "priority_filter": {
            const priority = extractPriorityFromQuery(incomingText);
            if (!priority) {
              await sendTurnReply(sender, "איזו עדיפות תרצי לתת לזה?\nגבוה, בינוני או נמוך?");
              return res.status(200).json({ status: "visibility_query", sender });
            }
            const allTasks = await getAllProductionTasksWithPriority(spreadsheetId);
            const replyText = formatPriorityFilterResponse(allTasks, priority);
            await sendTurnReply(sender, replyText);
            return res.status(200).json({ status: "visibility_query", sender, intent: visibilityIntent });
          }
          case "production_overview": {
            const [prodTasks, approvedRows] = await Promise.all([
              getAllProductionTasks(spreadsheetId),
              getApprovedContentRows(spreadsheetId),
            ]);
            const overviewItems = buildProductionOverviewItems(prodTasks, approvedRows);
            const poReply = formatProductionOverview(overviewItems);
            await sendTurnReply(sender, poReply);
            // If any items have no deadline, the reply ends with "רוצה שנכניס
            // אותם לגאנט?". Arm a pending question so a "כן" can start scheduling
            // them. Deadline-empty in the production tab means not-in-gantt
            // (every gantt write also writes a deadline), so no gantt cross-check
            // is needed. Scope (28.7): schedule the FIRST item only; the full
            // one-by-one loop belongs to the monthly-planning redesign.
            const poNoDate = overviewItems.filter((i) => !i.hasDeadline);
            if (poNoDate.length > 0) {
              storePendingQuestion(sender, {
                questionType: "production_overview_schedule",
                context: { items: poNoDate.map((i) => ({ contentId: i.contentId, name: i.name })) },
              });
            }
            return res.status(200).json({ status: "visibility_query", sender, intent: visibilityIntent });
          }
          default:
            tasks = [];
        }

        const replyText = formatVisibilityResponse(tasks, visibilityIntent);
        await sendTurnReply(sender, replyText);

        console.log(`[Sprint 10] ✅ Visibility query response sent`);

        return res.status(200).json({
          status: "visibility_query",
          sender,
          intent: visibilityIntent,
          taskCount: tasks.length,
        });
      } catch (visibilityError) {
        const errorMessage =
          visibilityError instanceof Error ? visibilityError.message : "Unknown error";
        console.error(`[Sprint 10] Error processing visibility query: ${errorMessage}`);

        const replyText = "קרתה שגיאה בעיבוד השאילתה. אנא נסי שוב בעוד רגע.";
        await sendTurnReply(sender, replyText);

        return res.status(500).json({
          status: "visibility_query_error",
          sender,
          error: errorMessage,
        });
      }
    }
// Archive - view list
// View archive list
    // Archive - move to archive
      // detectOverdueDecisionIntent's regex catches ANY message starting
      // with "תעבירי" as a potential reschedule intent, even when Karen is
      // actually trying to archive or approve for production. Explicit
      // command detectors take precedence — they can't misinterpret the
      // intent the way the loose reschedule regex can.
      const overdueDecisionIntent =
        isArchiveCommand(incomingText) ||
        isApproveForProductionCommand(incomingText) ||
        isRestoreCommand(incomingText)
          ? null
          : detectOverdueDecisionIntent(incomingText);

      // GANTT_MOVE_BEATS_OVERDUE (25.7.2026): "תעבירי את מימה ל27/7" is a full
      // move command, but the overdue branch matched it first and then failed
      // to parse the date, because its own regex assumes a short reply like
      // "לדחות ל27/7" and swallowed the content name as the date. The move flow
      // is the specific one, so it wins.
      if (overdueDecisionIntent && !isGanttDateChange(incomingText)) {
        const overdueItems = await fetchOverdueDecisionItems();
        // Ambiguity guard (5.8.2026): if several items are overdue and Karen
        // says just "עלה" (published), do not blindly mark the first one.
        // Ask which, remembering the action, then complete it on her pick.
        // For now only "published" gets this; reschedule/archive keep the
        // old single-item behaviour until we extend it.
        if (overdueItems.length > 1 && overdueDecisionIntent.type === "published") {
          const overdueOptions = overdueItems
            .map((it) => (it.displayTitle || "").toString().trim())
            .filter(Boolean)
            .slice(0, 6);
          storePendingQuestion(sender, {
            questionType: "overdue_pick_which",
            context: {
              action: "published",
              options: overdueOptions,
              rawMessage: incomingText,
            },
          });
          await sendTurnReply(
            sender,
            buildAmbiguityQuestion({ kind: "found", itemType: "תכנים", foundContext: "שאיחרו", options: overdueOptions })
          );
          return res.status(200).json({ status: "overdue_pick_which_asked", sender });
        }
        const overdueItem = overdueItems[0];

        if (overdueItem) {
          const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
          const contentId = overdueItem.contentId;
          const contentName = overdueItem.displayTitle;

          if (overdueDecisionIntent.type === "published") {
            clearPendingQuestion(sender);
            await markOverdueItemPublished(spreadsheetId, contentId);

            await sendTurnReply(
              sender,
              `סימנתי ש-"${contentName}" עלה. הוא לא יופיע יותר בתזכורות האיחור.`
            );

            return res.status(200).json({
              status: "overdue_published",
              sender,
            });
          }

          if (overdueDecisionIntent.type === "archive") {
            clearPendingQuestion(sender);
            const approvedCancelled = await updateApprovedContentStatusById(
              spreadsheetId,
              contentId,
              "בוטל"
            );
            if (!approvedCancelled) {
              throw new Error(`Failed to mark approved content as cancelled for contentId: ${contentId}`);
            }

            const ganttCancelled = await updateGanttStatus(spreadsheetId, contentId, "בוטל");
            if (!ganttCancelled) {
              throw new Error(`Failed to mark gantt row as cancelled for contentId: ${contentId}`);
            }

            await sendTurnReply(
              sender,
              `סימנתי את "${contentName}" כבוטל. הוא לא יופיע יותר בתזכורות.`
            );

            return res.status(200).json({
              status: "overdue_archived",
              sender,
            });
          }

          if (overdueDecisionIntent.type === "undecided") {
            await sendTurnReply(
              sender,
              [
                "אין בעיה. כדי לסגור את זה, אפשר לבחור אחת משלוש אפשרויות:",
                "* עלה",
                "* לדחות ל-18/6",
                "* לארכיון",
              ].join("\n")
            );

            return res.status(200).json({
              status: "overdue_decision_still_open",
              sender,
            });
          }

          if (overdueDecisionIntent.type === "reschedule") {
            if (!overdueDecisionIntent.dateText) {
              storePendingQuestion(sender, {
                questionType: "overdue_reschedule_date",
                context: { contentId, contentName },
              });

              await sendTurnReply(
                sender,
                `לאיזה תאריך להעביר את "${contentName}"?`
              );

              return res.status(200).json({
                status: "overdue_reschedule_ask_date",
                sender,
              });
            }

            const normalizedDate = normalizeUserDateInput(
              overdueDecisionIntent.dateText
            );

            if (!normalizedDate) {
              storePendingQuestion(sender, {
                questionType: "overdue_reschedule_date",
                context: { contentId, contentName },
              });

              await sendTurnReply(
                sender,
                "לא קלטתי תאריך. אפשר לכתוב למשל 18/6."
              );

              return res.status(200).json({
                status: "overdue_reschedule_invalid_date",
                sender,
              });
            }

            const collision = await isGanttDateTaken(
              spreadsheetId,
              normalizedDate
            );

            if (collision.taken && collision.existingContentId !== contentId) {
              storePendingQuestion(sender, {
                questionType: "overdue_reschedule_date",
                context: { contentId, contentName },
              });

              await sendTurnReply(
                sender,
                `${normalizedDate} כבר תפוס על ידי "${collision.existingName}". לאיזה תאריך אחר להעביר?`
              );

              return res.status(200).json({
                status: "overdue_reschedule_date_taken",
                sender,
              });
            }

            clearPendingQuestion(sender);
            await updateGanttRowDate(
              spreadsheetId,
              contentId,
              normalizedDate,
              getHebrewDayName(normalizedDate)
            );
            await sortGanttByDate(spreadsheetId);

            await sendTurnReply(
              sender,
              `סגור, העברתי את "${contentName}" ל-${normalizedDate}.`
            );

            return res.status(200).json({
              status: "overdue_rescheduled",
              sender,
            });
          }
        }
      }

      if (isViewArchiveCommand(incomingText)) {
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const archiveList = await getArchiveList(spreadsheetId);
      if (archiveList.length === 0) {
        await sendTurnReply(sender, "אין כרגע רעיונות בארכיון.");
        return res.status(200).json({ status: "archive_empty", sender });
      }
      const listText = archiveList.slice(0, 10).map((item) => `- ${item.idea.split(/\s+/).slice(0, 6).join(" ")}`).join("\n");
      const suffix = archiveList.length > 10 ? `\n...ו${archiveList.length - 10} עוד` : "";
      await sendTurnReply(sender, `הרעיונות שבצד:\n${listText}${suffix}`);
      return res.status(200).json({ status: "archive_listed", sender });
    }

    // Restore from archive
    if (isRestoreCommand(incomingText)) {
      const target = extractRestoreTarget(incomingText);
      if (!target) {
        await sendTurnReply(
          sender,
          [
            "לא בטוחה איזה רעיון להחזיר מהרשימה.",
            "",
            "אפשר לכתוב למשל:",
            "תחזירי את רעיון שמלות לרעיונות",
          ].join("\n")
        );
        return res.status(200).json({ status: "restore_parse_error", sender });
      }
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const result = await restoreFromArchive(spreadsheetId, target);
      if (!result) {
        await sendTurnReply(sender, "לא מצאתי את הרעיון בארכיון. אפשר לשלוח שם קצת יותר מדויק וננסה שוב.");
        return res.status(200).json({ status: "restore_not_found", sender });
      }
      await sendTurnReply(sender, `מעולה, החזרתי את הרעיון "${result.restoredName}" לבנק הרעיונות.`);
      return res.status(200).json({ status: "restored", sender });
    }
    if (isApproveForProductionCommand(incomingText)) {
      const target = extractApproveTarget(incomingText);
      if (!target) {
        await sendTurnReply(
          sender,
          [
            "לא בטוחה איזה רעיון להוסיף להפקה.",
            "",
            "אפשר לכתוב למשל:",
            "תוסיפי את רעיון שמלות להפקה",
          ].join("\n")
        );
        return res.status(200).json({ status: "approve_parse_error", sender });
      }
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      // Ambiguous-name check (name-recognition round B, 21.7.2026): before
      // approving, see how many bank ideas match Karen's (often shortened)
      // name. "מכבי" matches both "בת זוג של אוהד מכבי" and "בייבי מכבי" —
      // approveContentForProduction would silently pick the first. Instead,
      // if 2+ match, show ONLY those and ask which, reusing approve_pick_idea.
      // Exact-name matches are treated as unambiguous (she named it fully).
      try {
        const bankIdeas = await getOpenContentIdeas(spreadsheetId);
        const normalizedTarget = target.trim();
        const exactHit = bankIdeas.find((i: any) => (i.idea || "").trim() === normalizedTarget);
        if (!exactHit) {
          const partialMatches = bankIdeas.filter((i: any) =>
            (i.idea || "").includes(normalizedTarget) || normalizedTarget.includes((i.idea || "").trim())
          );
          if (partialMatches.length > 1) {
            storePendingQuestion(sender, {
              questionType: "approve_pick_idea",
              context: { attemptedName: target },
            });
            const lines = partialMatches.slice(0, 10).map((i: any) => `*${i.idea}*`).join("\n\n");
            await sendTurnReply(
              sender,
              buildAmbiguityQuestion({ kind: "found", itemType: "רעיונות", searchedName: target, options: [lines] })
            );
            return res.status(200).json({ status: "approve_ambiguous_pick", sender });
          }
        }
      } catch (ambiguityError) {
        console.error(`[Approve] ambiguity pre-check failed, proceeding normally: ${ambiguityError}`);
      }

      let result;
      try {
        result = await approveContentForProduction(spreadsheetId, target);
      } catch (approveError) {
        // Bank->production pick flow (priority 3 from live logs, 21.7.2026):
        // Karen refers to a bank idea by a shortened/approximate name and it
        // isn't found. Instead of "try a more exact name" (which made her
        // guess), show the open ideas and let her pick — she just replies
        // with a name and we approve that one. No duplicate is ever created.
        const openIdeas = await getOpenContentIdeas(spreadsheetId);
        if (openIdeas.length === 0) {
          await sendTurnReply(sender, `לא מצאתי את "${target}" ברעיונות השמורים, ואין כרגע רעיונות פתוחים להעביר.`);
          return res.status(200).json({ status: "approve_not_found_empty", sender });
        }
        storePendingQuestion(sender, {
          questionType: "approve_pick_idea",
          context: { attemptedName: target },
        });
        const ideaLines = openIdeas.slice(0, 10).map((i: any) => `*${i.idea}*`).join("\n\n");
        await sendTurnReply(
          sender,
          buildAmbiguityQuestion({ kind: "notFound", itemType: "רעיונות", searchedName: target, location: "בין הרעיונות השמורים", options: [ideaLines] })
        );
        return res.status(200).json({ status: "approve_pick_idea_offered", sender });
      }

      await sendTurnReply(sender, `מעולה, העברתי את "${result.name}" לתכנים שאושרו ופתחתי משימת הפקה.`);

      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const firstOfMonth = `01/${String(month).padStart(2, "0")}/${year}`;

      const available = await findAvailableDatesInMonth(spreadsheetId, firstOfMonth);
      const earliestGanttDate = new Date();
      earliestGanttDate.setDate(earliestGanttDate.getDate() + 1);
      earliestGanttDate.setHours(0, 0, 0, 0);

      const futureAvailable = available.filter((candidateDate) => {
      const parts = candidateDate.split("/");
      const parsed = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      return parsed >= earliestGanttDate;
      
    });

      if (futureAvailable.length > 0) {
        const suggested = futureAvailable[0];
        const suggestedDayName = getHebrewDayName(suggested);

        storePendingQuestion(sender, {
          questionType: "confirm_gantt_write",
          context: {
            contentId: result.contentId,
            contentName: result.name,
            date: suggested,
            dayName: suggestedDayName,
            ganttStatus: "בתכנון",
          },
        });

        await sendTurnReply(
  sender,
  [
    "מצאתי לו חור פנוי קרוב בגאנט:",
    `${suggested}, יום ${suggestedDayName}.`,
    "",
    `להכניס את "${result.name}" לתאריך הזה?`,
    "",
    "הוא ייכנס כבתכנון, כי עדיין צריך לסמן צילום, עריכה וקאבר.",
    "",
    "אפשר לענות כן או לא.",
  ].join("\n")
);
      } else {
        await sendTurnReply(sender, "לא מצאתי תאריך פנוי החודש בגאנט. אפשר להכניס ידנית.");
      }

      return res.status(200).json({ status: "approved_for_production", sender });
    }

    // Bulk archive — Karen sends "תעבירי לארכיון:" followed by a numbered
    // or bulleted list of ideas. Fires BEFORE the single-archive path so
    // the list-shape check wins for multi-item requests.
    if (isBulkArchiveCommand(incomingText)) {
      const items = extractBulkArchiveItems(incomingText);
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      // Local fuzzy match — zero Claude calls. One combined sheet read
      // pulls candidates from both בנק רעיונות and תכנים שאושרו, then
      // token-overlap scoring identifies each item. Fixes the earlier
      // live-test bug where Haiku defaulted to "1" and matched all list
      // items to the same first candidate. Also widens scope: approved
      // content is now archivable, not just fresh ideas.
      const candidates = await fetchArchivableCandidates(spreadsheetId);

      const matchResults = items.map((requested) => {
        const match = findBestFuzzyIdeaMatch(requested, candidates);
        return {
          requested,
          matched: match?.candidate.idea || null,
          contentId: match?.candidate.contentId || null,
          source: match?.candidate.source || null,
        };
      });

      const matched = matchResults.filter((r) => r.matched && r.contentId && r.source);
      const unmatched = matchResults.filter((r) => !r.matched);

      if (matched.length === 0) {
        await sendTurnReply(
          sender,
          [
            "לא הצלחתי לזהות אף אחד מהרעיונות ברשימה.",
            "",
            "אפשר לנסות עם שמות קצת יותר מדויקים, או לשלוח אותם אחד-אחד:",
            "תעבירי את [שם הרעיון] לארכיון",
          ].join("\n")
        );
        return res.status(200).json({ status: "bulk_archive_no_matches", sender });
      }

      // Store contentId + source per match so the follow-up "כן" archives
      // by exact contentId (avoids re-running fuzzy match on execute).
      storePendingQuestion(sender, {
        questionType: "bulk_archive_confirm",
        context: {
          items: matched.map((m) => ({
            contentId: m.contentId,
            source: m.source,
            name: m.matched,
          })),
        },
      });

      const lines: string[] = ["מצאתי את הרעיונות הבאים:"];
      matched.forEach((m, i) => {
        const sourceHint = m.source === "approved" ? " (בהפקה)" : "";
        lines.push(`${i + 1}. ${m.matched}${sourceHint}`);
      });
      if (unmatched.length > 0) {
        lines.push("");
        lines.push("לא הצלחתי לזהות:");
        unmatched.forEach((m) => {
          lines.push(`- ${m.requested}`);
        });
      }
      lines.push("");
      lines.push(
        matched.length === 1
          ? "להעביר אותו לארכיון? (כן / לא)"
          : `להעביר את כל ה-${matched.length} לארכיון? (כן / לא)`
      );

      await sendTurnReply(sender, lines.join("\n"));
      return res.status(200).json({
        status: "bulk_archive_confirm",
        sender,
        matched: matched.map((m) => ({ name: m.matched, source: m.source })),
        unmatched: unmatched.map((m) => m.requested),
      });
    }

if (isArchiveCommand(incomingText)) {
      const target = extractArchiveTarget(incomingText);
      if (!target) {
        await sendTurnReply(
        sender,
        [
          "לא בטוחה איזה רעיון לשמור בצד.",
          "",
          "אפשר לכתוב למשל:",
          "תעבירי את רעיון שמלות לארכיון",
        ].join("\n")
      );
        return res.status(200).json({ status: "archive_parse_error", sender });
      }

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const result = await archiveContentIdea(spreadsheetId, target);

      if (!result) {
        await sendTurnReply(sender, "לא מצאתי את הרעיון. אפשר לשלוח שם קצת יותר מדויק וננסה שוב.");
        return res.status(200).json({ status: "archive_not_found", sender });
      }

      const replyText = `אין בעיה.\nשמרתי את הרעיון "${result.archivedName}" בצד למקרה שתרצי לחזור אליו.`;
      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "archived", sender });
    }
      if (isDeadlineUpdate(incomingText)) {
      const deadlineUpdate = extractDeadlineUpdate(incomingText);
      if (!deadlineUpdate) {
        await sendTurnReply(
        sender,
        [
          "לא בטוחה איזה דדליין לעדכן.",
          "",
          "אפשר לכתוב למשל:",
          "תשני את הדדליין של סרטון שמלות ל-17/06",
        ].join("\n")
      );
        return res.status(200).json({ status: "deadline_update_parse_error", sender });
      }
    // Handle unsupported question-like messages (after visibilityIntent is ruled out)
      if (questionLikeMessage) {
      const hasDraftForClarification = !!getPendingConfirmation(sender);
      if (hasDraftForClarification) {
        storePendingQuestion(sender, { questionType: "edit_or_new_clarification", context: {} });
      }
      const clarificationPrompt = generateClarificationPrompt(hasDraftForClarification);
      await sendTurnReply(sender, clarificationPrompt);
      return res.status(200).json({ status: "question_clarification", sender });
    }


      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const matchResult = await findProductionTaskByName(spreadsheetId, deadlineUpdate.contentName);

      if (!matchResult) {
        await sendTurnReply(sender, "לא מצאתי את הסרטון. אפשר לשלוח שם קצת יותר מדויק וננסה שוב.");
        return res.status(200).json({ status: "deadline_update_no_match", sender });
      }

      if ("ambiguous" in matchResult && matchResult.ambiguous) {
        await sendTurnReply(sender, "מצאתי כמה סרטונים דומים. אפשר לשלוח שם קצת יותר מדויק כדי שאבחר את הנכון.");
        return res.status(200).json({ status: "deadline_update_ambiguous", sender });
      }

      const exactMatch = matchResult as ProductionTaskMatch;
      await updateDeadline(spreadsheetId, exactMatch.rowIndex, deadlineUpdate.deadline);

      const replyText = `עדכנתי. הדדליין של "${exactMatch.row[1]}" הוא עכשיו ${deadlineUpdate.deadline}.`;
      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "deadline_updated", sender });
    }

    // ===== GANTT DATE CHANGE (priority 1 from live logs, 21.7.2026) =====
    // Clean state here (all pending handled above), so a move verb + target
    // date means "move a scheduled item". Reuses findProductionTaskByName,
    // isGanttDateTaken, updateGanttRowDate + sortGanttByDate. On a taken
    // target it STOPS and asks — never auto-displaces (that's step B).
    // Schedule-by-date (11.8.2026): "ביזנס יעלה ב-20/8". Karen names a content
    // and a date. Behave by the content's actual state: already on that date →
    // just say so; on a different date → move it; not on the gantt → schedule
    // it fresh. Direct action, no confirmation — she already asked for it.
    // Placed before the move route and before the new-idea classifier.
    if (isScheduleByDate(incomingText)) {
      const parsed = extractScheduleByDate(incomingText);
      if (parsed) {
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
        const normalizedTarget = normalizeUserDateInput(parsed.targetDate);
        if (!normalizedTarget) {
          await sendTurnReply(sender, `לא הצלחתי לקרוא את התאריך "${parsed.targetDate}". אפשר לכתוב אותו כמו 20/08/2026.`);
          return res.status(200).json({ status: "schedule_by_date_bad_date", sender });
        }
        const matchResult = await findProductionTaskByName(spreadsheetId, parsed.contentName);
        if (!matchResult) {
          await sendTurnReply(sender, `לא מצאתי תוכן בשם "${parsed.contentName}". אפשר לבדוק מה יש עם: מה בהפקה`);
          return res.status(200).json({ status: "schedule_by_date_not_found", sender });
        }
        if ("ambiguous" in matchResult && matchResult.ambiguous) {
          await sendTurnReply(sender, "מצאתי כמה תכנים דומים. אפשר לשלוח שם קצת יותר מדויק כדי שאדע במה מדובר.");
          return res.status(200).json({ status: "schedule_by_date_ambiguous", sender });
        }
        const exactMatch = matchResult as ProductionTaskMatch;
        const targetContentId = (exactMatch.row[0] || "").toString().trim();
        const targetContentName = (exactMatch.row[1] || parsed.contentName).toString().trim();
        const targetDayName = getHebrewDayName(normalizedTarget);
        const ganttEntry = await findGanttEntryByContentId(spreadsheetId, targetContentId);
        // Case A: already on the gantt at exactly this date → nothing to do.
        if (ganttEntry && normalizeUserDateInput(ganttEntry.date) === normalizedTarget) {
          await sendTurnReply(sender, `"${targetContentName}" כבר משובץ ל-${normalizedTarget}.`);
          return res.status(200).json({ status: "schedule_by_date_already_there", sender });
        }
        // Collision check shared by both move and fresh-schedule: never displace.
        const collision = await isGanttDateTaken(spreadsheetId, normalizedTarget);
        if (collision.taken && collision.existingContentId !== targetContentId) {
          const shortExisting = collision.existingName.split(/\s+/).slice(0, 6).join(" ");
          await sendTurnReply(sender, `ה-${normalizedTarget} כבר תפוס על ידי "${shortExisting}", אז לא שיבצתי שם. אפשר לתת לי תאריך אחר.`);
          return res.status(200).json({ status: "schedule_by_date_collision", sender });
        }
        if (ganttEntry) {
          // Case B: on the gantt at a different date → move it.
          await updateGanttRowDate(spreadsheetId, targetContentId, normalizedTarget, targetDayName);
          await sendTurnReply(sender, `העברתי את "${targetContentName}" ל-${normalizedTarget}.`);
          return res.status(200).json({ status: "schedule_by_date_moved", sender });
        }
        // Case C: not on the gantt → schedule it fresh.
        await addRowToGantt(spreadsheetId, targetContentId, targetContentName, normalizedTarget, targetDayName);
        await sendTurnReply(sender, `שיבצתי את "${targetContentName}" ל-${normalizedTarget}.`);
        return res.status(200).json({ status: "schedule_by_date_scheduled", sender });
      }
    }
    if (isGanttDateChange(incomingText)) {
      const change = extractGanttDateChange(incomingText);
      if (change) {
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
        const normalizedTarget = normalizeUserDateInput(change.targetDate);
        if (!normalizedTarget) {
          await sendTurnReply(sender, `לא הצלחתי לקרוא את התאריך "${change.targetDate}". אפשר לכתוב אותו כמו 29/07/2026.`);
          return res.status(200).json({ status: "gantt_date_change_bad_date", sender });
        }

        const matchResult = await findProductionTaskByName(spreadsheetId, change.contentName);
        if (!matchResult) {
          await sendTurnReply(sender, `לא מצאתי בגאנט תוכן בשם "${change.contentName}". אפשר לבדוק מה יש עם: מה בגאנט`);
          return res.status(200).json({ status: "gantt_date_change_not_found", sender });
        }
        if ("ambiguous" in matchResult && matchResult.ambiguous) {
          await sendTurnReply(sender, "מצאתי כמה סרטונים דומים. אפשר לשלוח שם קצת יותר מדויק כדי שאבחר את הנכון.");
          return res.status(200).json({ status: "gantt_date_change_ambiguous", sender });
        }
        const exactMatch = matchResult as ProductionTaskMatch;
        const targetContentId = (exactMatch.row[0] || "").toString().trim();

        const ganttEntry = await findGanttEntryByContentId(spreadsheetId, targetContentId);
        if (!ganttEntry) {
          await sendTurnReply(sender, `"${change.contentName}" עדיין לא משובץ בגאנט, אז אין תאריך להזיז. אפשר להכניס אותו קודם.`);
          return res.status(200).json({ status: "gantt_date_change_not_scheduled", sender });
        }

        const collision = await isGanttDateTaken(spreadsheetId, normalizedTarget);
        if (collision.taken && collision.existingContentId !== targetContentId) {
          // Safe stop — never auto-displace. Offer to find another date.
          storePendingQuestion(sender, {
            questionType: "gantt_date_change_collision",
            context: { contentId: targetContentId, contentName: ganttEntry.name, targetDate: normalizedTarget },
          });
          const shortExisting = collision.existingName.split(/\s+/).slice(0, 6).join(" ");
          await sendTurnReply(
            sender,
            `ה-${normalizedTarget} כבר תפוס על ידי "${shortExisting}".\nרוצה שאמצא תאריך פנוי אחר קרוב? אפשר לענות כן, או לתת לי תאריך אחר.`
          );
          return res.status(200).json({ status: "gantt_date_change_collision", sender });
        }

        const targetDayName = getHebrewDayName(normalizedTarget);
        await updateGanttRowDate(spreadsheetId, targetContentId, normalizedTarget, targetDayName);
        await sortGanttByDate(spreadsheetId);
        await sendTurnReply(
          sender,
          `הזזתי את "${ganttEntry.name}" ל-${normalizedTarget} (יום ${targetDayName}).`
        );
        return res.status(200).json({ status: "gantt_date_changed", sender });
      }
    }

    // ===== PRODUCTION STATUS UPDATE CHECK =====
    console.log(`[Route Debug] About to check isProductionStatusUpdate...`);
    // Sprint 7: Check if this is a production status update
    let isStatusUpdate = isProductionStatusUpdate(incomingText);
    console.log(`[Route Debug] isProductionStatusUpdate: ${isStatusUpdate}`);

    // Claude fallback (23.7.2026): Karen also writes name-first and passively
    // ("ספרייט צולם", "סקויה עלה"). Regex guards for those proved brittle and
    // collided with questions ("מה עוד לא נערך"), so when the regex detector
    // finds nothing but the message mentions a status word, ask Claude one
    // bounded question. Fast path unchanged for normal phrasing.
    let claudeStatus: Awaited<ReturnType<typeof askClaudeForStatusIntent>> = null;
    if (!isStatusUpdate && looksLikeStatusMention(incomingText)) {
      try {
        const knownContent = await getContentNamesWithSummaries(process.env.GOOGLE_SHEETS_ID!);
        claudeStatus = await askClaudeForStatusIntent(incomingText, knownContent);
        if (claudeStatus?.isStatusUpdate) {
          isStatusUpdate = true;
          console.log(`[Route Debug] Claude status intent: name="${claudeStatus.contentName}" statuses=[${claudeStatus.statuses.join(", ")}]`);
        }
      } catch (statusIntentError) {
        console.error(`[Route Debug] status intent fallback failed: ${statusIntentError}`);
      }
    }


    if (isStatusUpdate) {
      const statusUpdate = detectStatusUpdate(incomingText) || (claudeStatus && claudeStatus.isStatusUpdate
        ? {
            statusType: (claudeStatus.statuses[0] === "cover" ? "cover_ready" : claudeStatus.statuses[0]) as any,
            statusTypes: claudeStatus.statuses.map((s: string) => (s === "cover" ? "cover_ready" : s)) as any,
            contentName: claudeStatus.contentName,
            rawMessage: incomingText,
          }
        : null);
      // Capture what Karen literally reported BEFORE gush A expands it, so
      // the daily-brief matching below compares against her real action.
      const reportedActionsRaw: string[] = statusUpdate ? [...statusUpdate.statusTypes] : [];
      // "ערכתי" implies "צולם": you cannot edit footage that was never shot.
      // If Karen reports only editing, mark filming too, so every downstream
      // step (the match list, the sheet update, the gantt) sees both.
      if (statusUpdate && statusUpdate.statusTypes.includes("edited") && !statusUpdate.statusTypes.includes("filmed")) {
        statusUpdate.statusTypes = ["filmed", ...statusUpdate.statusTypes];
      }
      console.log(`[Route Debug] detectStatusUpdate: ${statusUpdate ? `{ statusTypes: [${statusUpdate.statusTypes.join(", ")}], contentName: "${statusUpdate.contentName}" }` : "null"}`);
      if (statusUpdate) {
        try {
          const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
          if (!spreadsheetId) {
            throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
          }

          console.log(`\n[Sprint 7 Workflow] Status update detected: ${statusUpdate.statusTypes.join(", ")}`);
          console.log(`[Sprint 7 Workflow] Looking for content: "${statusUpdate.contentName}"`);

          // Find matching production task
          const explicitFastTrack = /(?:סרטון|תוכן|רעיון)\s+חדש|חדש\s+(?:על|עם)/.test(statusUpdate.rawMessage || incomingText);
          if (explicitFastTrack) {
            console.log(`[Fast Track] Explicit new content detected, skipping production matching for: "${statusUpdate.contentName}"`);
          }

          let matchResult = explicitFastTrack
            ? null
            : await findProductionTaskByName(spreadsheetId, statusUpdate.contentName);

          // Context resolution (name-recognition round, step A — 21.7.2026):
          // "ערכתי אותו גם" after "צילמתי את סקויה". If the extracted name is
          // just a pronoun and nothing matched, resolve it against the
          // conversation history (via Claude) and retry the lookup once. If
          // resolution fails, fall through to the normal ask-again path — we
          // never guess a wrong item.
          if (!matchResult && !explicitFastTrack && looksLikePronounReference(statusUpdate.contentName)) {
            const resolvedName = await resolvePronounToRecentContent(sender, statusUpdate.contentName);
            if (resolvedName) {
              console.log(`[Context] Resolved pronoun "${statusUpdate.contentName}" -> "${resolvedName}"`);
              const retry = await findProductionTaskByName(spreadsheetId, resolvedName);
              if (retry) {
                matchResult = retry;
                statusUpdate.contentName = resolvedName;
              }
            }
          }

          // Bare action tied to the daily brief (30.7.2026): Karen replies
          // "ערכתי" with no name, right after an afternoon brief that said
          // "ערוך את X". Resolve to the content the brief pointed at, but
          // ONLY when the brief is fresh (<= 2h) and the reported action
          // matches what the brief asked (edit->edit, film->film,
          // upload->verify-upload). A mismatch is left for the normal ask path.
          if (!matchResult && !explicitFastTrack && isProductionStatusUpdate(statusUpdate.contentName)) {
            type BriefItem = { contentId: string; title: string; action: string };
            const briefCtx = getValue<{ items: BriefItem[]; savedAt: string }>("briefContext", sender);
            const briefItems = briefCtx && Array.isArray(briefCtx.items) ? briefCtx.items : [];
            if (briefItems.length > 0 && briefCtx) {
              // Freshness window. Afternoon and morning briefs share this store;
              // 5h comfortably covers a morning brief answered later in the day.
              const ageMs = Date.now() - new Date(briefCtx.savedAt).getTime();
              const withinWindow = ageMs >= 0 && ageMs <= 5 * 60 * 60 * 1000;
              if (withinWindow) {
                // Keep only offered items whose action matches what Karen
                // actually reported (edit->edited, film->filmed,
                // verify-upload->uploaded), comparing against her raw report
                // (before gush A auto-adds filmed).
                const actionToReported: Record<string, string> = { film: "filmed", edit: "edited", "verify-upload": "uploaded" };
                const candidates = briefItems.filter((it) => {
                  const expected = actionToReported[it.action];
                  return expected ? reportedActionsRaw.includes(expected) : false;
                });
                if (candidates.length === 1) {
                  // Unambiguous: exactly one offered item matches the action.
                  console.log(`[Context] Bare status resolved via brief -> "${candidates[0].title}"`);
                  const retry = await findProductionTaskByName(spreadsheetId, candidates[0].title);
                  if (retry) {
                    matchResult = retry;
                    statusUpdate.contentName = candidates[0].title;
                  }
                } else if (candidates.length > 1) {
                  // Ambiguous: the brief offered several items for this action.
                  // Ask which one, reusing the existing status_no_match_pick flow.
                  const options = candidates.map((c) => c.title).filter(Boolean).slice(0, 6);
                  console.log(`[Context] Bare status ambiguous via brief (${options.length} candidates), asking`);
                  storePendingQuestion(sender, {
                    questionType: "status_no_match_pick",
                    context: {
                      attempted: statusUpdate.contentName,
                      rawMessage: incomingText,
                      statusTypes: statusUpdate.statusTypes,
                      options,
                    },
                  });
                  await sendTurnReply(
                    sender,
                    buildAmbiguityQuestion({ kind: "found", itemType: "תכנים", options })
                  );
                  return res.status(200).json({ status: "brief_bare_status_ambiguous", sender });
                }
              }
            }
          }
          if (!matchResult) {
            // Fast Track — תוכן לא קיים בהפקה, קרן צילמה ספונטנית
            const isReadyUpdate = statusUpdate.statusTypes.includes("filmed") || statusUpdate.statusTypes.includes("edited");

            // Ask before assuming it is new (23.7.2026). Karen reports on
            // content by partial or informal names; jumping straight to a new
            // fast-track draft created noise she then had to cancel. Show what
            // is actually in production and let her pick, or say it is new.
            if (isReadyUpdate) {
              try {
                const openTasks = await getAllProductionTasks(spreadsheetId);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const reported = statusUpdate.statusTypes; // e.g. ["filmed"], ["edited"], or both
                const pending = (openTasks || [])
                  .filter((t: any) => {
                    // Show a task only if it is still missing at least one of the
                    // steps Karen just reported (filming / editing) — no point
                    // offering a task that is already done on that step.
                    const missingReportedStep = reported.some((step: string) => (t as any)[step] !== "כן");
                    if (!missingReportedStep) return false;
                    // And only if its deadline has not passed. Empty deadline
                    // (not yet in the gantt) counts as still relevant.
                    const raw = (t.deadline || "").toString().trim();
                    if (!raw) return true;
                    const d = parseDateFromSheet(raw);
                    return !d || d >= today;
                  })
                  .map((t: any) => (t.taskName || "").toString().trim())
                  .filter(Boolean)
                  .slice(0, 6);

                if (pending.length > 0) {
                  storePendingQuestion(sender, {
                    questionType: "status_no_match_pick",
                    context: {
                      attempted: statusUpdate.contentName,
                      rawMessage: incomingText,
                      statusTypes: statusUpdate.statusTypes,
                      options: pending,
                    },
                  });
                  await sendTurnReply(
                    sender,
                    buildAmbiguityQuestion({ kind: "notFound", itemType: "תכנים", searchedName: statusUpdate.contentName, location: "בין התכנים שבהפקה", options: pending, offerNew: true })
                  );
                  return res.status(200).json({ status: "status_no_match_asked", sender });
                }
              } catch (pickError) {
                console.error(`[Sprint 7] no-match pick failed, falling back to fast track: ${pickError}`);
              }

              const draft = await createContentDraft(statusUpdate.contentName, sender);
              const draftSummary = { ...draft, originalUserInput: statusUpdate.contentName, isFastTrack: true, statusTypes: statusUpdate.statusTypes };
              storePendingConfirmation(sender, draftSummary);
              const replyText = buildDraftPreviewMessage(draft, {
  intro: [
    "לא מצאתי את זה בהפקה. נראה שצילמת משהו ספונטני.",
    "",
    "יצרתי טיוטה לתוכן מהיר.",
  ],
  extraBeforeQuestion: [
    "אחרי אישור אכניס את זה ישר לתכנים שאושרו ואחפש לזה תאריך בגאנט.",
  ],
});

await sendTurnReply(sender, replyText);
return res.status(200).json({ status: "fast_track_draft_created", sender });
}

            const replyText = "לא בטוחה איזה תוכן רצית לעדכן.\nתכתבי לי שוב את שם הסרטון ונמשיך.";
            await sendTurnReply(sender, replyText);
            console.log(`[Sprint 7 Workflow] No production task found for: ${statusUpdate.contentName}`);
            return res.status(200).json({
              status: "status_update_no_match",
              sender,
              contentName: statusUpdate.contentName,
            });
          }

          if ("ambiguous" in matchResult && matchResult.ambiguous) {
            const replyText = "מצאתי כמה תכנים דומים.\nאיזה מהם התכוונת?";
            await sendTurnReply(sender, replyText);
            console.log(`[Sprint 7 Workflow] Multiple or ambiguous matches for: ${statusUpdate.contentName}`);
            return res.status(200).json({
              status: "status_update_ambiguous",
              sender,
              contentName: statusUpdate.contentName,
            });
          }

          // Found exactly one match - update all detected statuses
         const exactMatch = matchResult as ProductionTaskMatch;
         const statusUpdates = statusUpdate.statusTypes
            .map((statusType: any) => {
              const columnName = getColumnName(statusType);
              const columnIndex = getProductionStatusColumnIndex(columnName);
              return { statusType, columnName, columnIndex };
            })
            .filter((update: any) => update.columnIndex !== null) as { statusType: string; columnName: string; columnIndex: number }[];
            const uniqueUpdates = Array.from(
            new Map(statusUpdates.map((update) => [update.columnIndex, update])).values()
          );
          console.log(`[Sprint 7 Workflow] Found match: "${exactMatch.row[1]}" at row ${exactMatch.rowIndex}`);
          console.log(`[Sprint 7 Workflow] Updating status columns: ${uniqueUpdates.map((update) => update.columnName).join(", ")}`);

          const secondaryUpdateFailures: string[] = [];
          const recordSecondaryUpdateFailure = (label: string) => {
            if (!secondaryUpdateFailures.includes(label)) {
              secondaryUpdateFailures.push(label);
            }
          };

    for (const update of uniqueUpdates) {
            if (update.columnName === "פורסם") continue; // לא קיים בטאב הפקה
            await updateProductionStatus(spreadsheetId, exactMatch.rowIndex, update.columnIndex);
          }

          const contentId = (exactMatch.row[0] || "").toString().trim();

          // עדכן סטטוס הפקתי בתכנים שאושרו לפי ההתקדמות במשימות הפקה
          if (contentId) {
            const approvedStatus = statusUpdate.statusTypes.includes("uploaded")
              ? "פורסם"
              : statusUpdate.statusTypes.includes("edited")
                ? "מוכן לעלייה"
                : statusUpdate.statusTypes.includes("filmed")
                  ? "ממתין לעריכה"
                  : null;

            if (approvedStatus) {
              try {
                const approvedUpdated = await updateApprovedContentStatusById(spreadsheetId, contentId, approvedStatus);
                if (!approvedUpdated) {
                  recordSecondaryUpdateFailure("תכנים שאושרו");
                }
              } catch (approvedStatusError) {
                recordSecondaryUpdateFailure("תכנים שאושרו");
                console.error(`[Sprint 7 Workflow] ⚠️ Failed to update approved content status: ${approvedStatusError}`);
              }
            }
          }

          // אם נערך - עדכן גאנט ל"מוכן"
          // אם הועלה/פורסם - לא מעדכנים כאן ל"מוכן", כי מיד אחר כך נעדכן ל"פורסם"
          if (
            statusUpdate.statusTypes.includes("edited") &&
            !statusUpdate.statusTypes.includes("uploaded")
          ) {
            if (contentId) {
              try {
                const ganttUpdated = await updateGanttStatus(spreadsheetId, contentId, "מוכן");
                if (ganttUpdated) {
                  console.log(`[Sprint 7 Workflow] ✅ Gantt status updated to מוכן for: ${contentId}`);
                } else {
                  recordSecondaryUpdateFailure("גאנט");
                }
              } catch (ganttReadyError) {
                recordSecondaryUpdateFailure("גאנט");
                console.error(`[Sprint 7 Workflow] ⚠️ Failed to update gantt to ready: ${ganttReadyError}`);
              }
            }
          }

          // אם הועלה - עדכן גאנט ל"פורסם"
          if (statusUpdate.statusTypes.includes("uploaded")) {
            if (contentId) {
              try {
                const ganttUpdated = await updateGanttStatus(spreadsheetId, contentId, "פורסם");
                if (ganttUpdated) {
                  console.log(`[Sprint 7 Workflow] ✅ Gantt status updated to פורסם for: ${contentId}`);
                } else {
                  recordSecondaryUpdateFailure("גאנט");
                }
              } catch (ganttError) {
                recordSecondaryUpdateFailure("גאנט");
                console.error(`[Sprint 7 Workflow] ⚠️ Failed to update gantt: ${ganttError}`);
              }
            }
          }
          const contentNameDisplay = exactMatch.row[1] || statusUpdate.contentName;
          const isUploaded = statusUpdate.statusTypes.includes("uploaded");
          const hasSecondaryFailures = secondaryUpdateFailures.length > 0;
          const replyText = hasSecondaryFailures
            ? `עדכנתי את משימות ההפקה של "${contentNameDisplay}", אבל לא הצלחתי להשלים עדכון ב: ${secondaryUpdateFailures.join(", ")}.\nכדאי לבדוק ידנית.`
            : isUploaded
              ? `מעולה!\nעדכנתי בגאנט ש"${contentNameDisplay}" עלה.`
              : `עדכנתי ש"${contentNameDisplay}" ${uniqueUpdates.map((u) => u.columnName).join(", ").replace(/, ([^,]*)$/, " ו$1")}.`;
          await sendTurnReply(sender, replyText);

          console.log(
            `[Sprint 7 Workflow] ✅ Status update complete for: ${contentNameDisplay}` +
              (hasSecondaryFailures ? ` with secondary failures: ${secondaryUpdateFailures.join(", ")}` : "") +
              "\n"
          );

          return res.status(200).json({
            status: hasSecondaryFailures ? "status_updated_with_secondary_failures" : "status_updated",
            sender,
            contentName: contentNameDisplay,
            statusTypes: statusUpdate.statusTypes,
            columnNames: uniqueUpdates.map((update) => update.columnName),
            secondaryUpdateFailures,
          });
        } catch (statusError) {
          const errorMessage =
            statusError instanceof Error ? statusError.message : "Unknown error";
          console.error(`[Sprint 7 Workflow] ❌ Error updating status: ${errorMessage}\n`);

          const replyText = "לא הצלחתי לעדכן את הסטטוס כרגע. תנסי שוב עוד רגע.";
          await sendTurnReply(sender, replyText);

          return res.status(500).json({
            status: "status_update_failed",
            sender,
            error: errorMessage,
          });
        }
      }
    }


    // If message looks like a visibility question but intent detection was unclear,
    // return a graceful fallback instead of progressing to draft creation.
    const likelyVQ = isLikelyVisibilityQuery(incomingText);
    console.log(`[Route Debug] visibilityIntent: ${visibilityIntent}`);
    console.log(`[Route Debug] isLikelyVisibilityQuery: ${likelyVQ}`);

    if (!visibilityIntent && likelyVQ) {
     const replyText = "לא הצלחתי להבין על איזה תוכן רצית לבדוק סטטוס.";
      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "visibility_unclear", sender });
    }

    // ===== FIX 3: Meta-conversation detection =====
    // Don't create content from meta-conversation messages
    const existingDraft = getPendingConfirmation(sender);
    console.log(`[Route Debug] pendingConfirmation: ${existingDraft ? "exists" : "null"}`);

    // Pure greeting / pleasantry intercept: runs BEFORE the hardcoded
    // general-help and meta-conversation branches so a bare "היי" or
    // "תודה" gets a short warm Claude reply instead of the fixed menu
    // or the "not sure I understood" clarification. Actual help requests
    // ("עזרה", "מה אפשר לעשות") don't match isPureGreeting, so they still
    // fall through to buildGeneralHelpResponse below.
    if (isPureGreeting(incomingText)) {
      const replyText = await generateConversationalReply(incomingText, sender);
      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "conversational_reply", sender, intent: "greeting" });
    }

    if (!existingDraft && isGeneralChatOrHelpMessage(incomingText)) {
      await sendTurnReply(sender, buildGeneralHelpResponse());
      return res.status(200).json({ status: "general_help", sender });
    }

    if (isMetaConversation(incomingText)) {
      if (existingDraft) {
        storePendingQuestion(sender, { questionType: "edit_or_new_clarification", context: {} });
      }
      const clarificationPrompt = generateClarificationPrompt(!!existingDraft);
      await sendTurnReply(sender, clarificationPrompt);
      return res.status(200).json({ status: "meta_conversation", sender });
    }

    const explicitIdeaMessage = [
      "יש לי רעיון",
      "רעיון חדש",
      "רעיון לסרטון",
      "חשבתי על רעיון",
      "יש לי קונספט",
      "קונספט חדש",
      "חשבתי על קונספט",
    ].some((marker) => incomingText.includes(marker));

    // An unsupported question must never fall through to new-idea creation.
    if (!visibilityIntent && questionLikeMessage && !explicitIdeaMessage) {
      const replyText = `הבנתי שזו שאלה ולא רעיון חדש, אבל לא בטוחה מה רצית לבדוק.

אפשר לכתוב למשל:
מה יש לי השבוע
מה בגאנט השבוע
מה דחוף
מה עדיין לא צולם`;
      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "question_clarification", sender });
    }

    // ===== FIX 2: Draft continuation handling =====
    // If draft exists and message looks like continuation, treat it as continuation
    const isContinuation = isContinuationMessage(incomingText);
    console.log(`[Route Debug] isContinuationMessage: ${isContinuation}`);

    if (existingDraft && isContinuation) {
      const continuationText = incomingText.trim();
      const cleanedContinuationText = continuationText
        .replace(/^(וגם|ו|אבל|בעצם|כאילו|הרעיון הוא|יותר בדיוק)\s*/i, "")
        .trim();

      const continuationValue = cleanedContinuationText || continuationText;
      const existingSummary = (existingDraft.summary || "").trim();

      const updatedDraft = {
        ...existingDraft,
        summary: existingSummary
          ? `${existingSummary}\nבנוסף: ${continuationValue}`
          : continuationValue,
      };

      storePendingConfirmation(sender, updatedDraft);

      const replyText = buildDraftPreviewMessage(updatedDraft, {
        intro: "קיבלתי, הוספתי את זה לכיוון של הרעיון.",
        previewLine: "ככה הייתי שומרת את זה עכשיו:",
        changeLine: "אפשר גם להגיד לי מה עוד לשנות.",
      });

      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "draft_continuation_updated", sender, draft: updatedDraft });
    }

    // ===== FIX 5: Lightweight confidence gating =====
    // Check if message has minimum confidence to be treated as new idea
    const messageIntent = await classifyMessageIntent(incomingText, sender);
    const hasConfidence = messageIntent === "new_idea";
    console.log(`[Route Debug] classifyMessageIntent: ${messageIntent} -> hasConfidence: ${hasConfidence}`);

    if (!hasConfidence) {
      console.log(`[Route Debug] reached fallback: low_confidence_idea`);
      if (existingDraft) {
        storePendingQuestion(sender, { questionType: "edit_or_new_clarification", context: {} });
      }
      const clarificationPrompt = generateClarificationPrompt(!!existingDraft);
      await sendTurnReply(sender, clarificationPrompt);
      return res.status(200).json({ status: "low_confidence_idea", sender });
    }

// AI edit fallback: if a draft is pending and the message wasn't matched by
    // any specific command upstream (including isEditRequest), try to interpret
    // it as an edit. Only fall through to "new idea" if Claude says it's not
    // an edit. This catches natural phrasings like "זה יותר דחוף ממה שחשבתי"
    // that don't contain any edit keyword but are clearly edit intents.
    {
      const pendingDraft = getPendingConfirmation(sender);
      if (pendingDraft) {
        const aiEditedDraft = await askClaudeForEdit(pendingDraft, incomingText, sender);
        if (aiEditedDraft) {
          storePendingConfirmation(sender, aiEditedDraft);
          // Humanizer consolidation: wrapping copy from the same edit call.
          // FIXED_EDIT_COPY (24.7.2026): the AI edit path returned its own wrapping
      // lines ("טוב ככה?" / "תגידי אם יש משהו נוסף לשנות"), bypassing the copy
      // we settled on. Only the name and summary come from Claude.
      const aiPreviewCopy = DEFAULT_EDIT_COPY;
          const aiReplyText = buildDraftPreviewMessage(aiEditedDraft, {
            intro: aiPreviewCopy.intro,
            previewLine: "ככה הייתי שומרת את זה עכשיו:",
            closingQuestion: aiPreviewCopy.closingQuestion,
            changeLine: aiPreviewCopy.changeLine,
          });
          await sendTurnReply(sender, aiReplyText);
          return res.status(200).json({ status: "draft_updated_via_ai", sender, draft: aiEditedDraft });
        }
      }
    }

    // Create new content draft
    const cleanedUserInput = cleanIdeaPrefix(incomingText);
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

    // Check for duplicates BEFORE creating draft
    const similar = spreadsheetId
      ? await findSimilarContentIdea(spreadsheetId, cleanedUserInput)
      : null;

    if (similar) {
      storePendingQuestion(sender, {
        questionType: "confirm_duplicate",
        context: { originalInput: cleanedUserInput },
      });
      const replyText = `שימי לב - מצאתי רעיון דומה שכבר קיים:
"${similar.idea.substring(0, 50)}..."

רוצה לשמור גם את הרעיון החדש?`;
      await sendTurnReply(sender, replyText);
      return res.status(200).json({ status: "duplicate_found", sender });
    }

    // No duplicate - create draft normally
    const draft = await createContentDraft(cleanedUserInput, sender);
    const draftSummary = {
      ...draft,
      originalUserInput: cleanedUserInput,
      requestedAction: requestedDraftAction(incomingText),
      approvalScope: "save" as const,
    };
    const hadPreviousDraft = activateNewDraft(sender, draftSummary);
    // Creation uses the same concise approval contract as the context route.
    // Generated wrapping copy must not reintroduce extra questions or actions.
    const replyText = buildDraftPreviewMessage(draftSummary, {
      extraBeforeQuestion: hadPreviousDraft ? ["הטיוטה הקודמת נשארה בצד."] : [],
    });
    await sendTurnReply(sender, replyText);
    return res.status(200).json({ status: "draft_created", sender, draft: draftSummary });

  } catch (error) {
    if (error instanceof GanttDuplicateError) {
      clearPendingQuestion(sender);

      await sendTurnReply(
        sender,
        `"${error.entry.name || error.entry.contentId}" כבר משובץ בגאנט ל-${error.entry.date}. לא הוספתי אותו שוב.`
      );

      return res.status(200).json({
        status: "gantt_duplicate_blocked",
        sender,
        contentId: error.entry.contentId,
        existingDate: error.entry.date,
      });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("WhatsApp webhook error:", message);

    try {
      await sendTurnReply(sender, "לא הצלחתי להשלים את זה כרגע. תנסי שוב עוד רגע.");
    } catch (sendError) {
      console.error("Failed to send error message:", sendError);
    }

    return res.status(500).json({ error: "Unable to process message.", details: message });
  }
};

export const handleWhatsAppWebhook = (req: Request, res: Response) => withRoutingTrace(
  (req.body.From || req.body.from || "").toString(),
  (req.body.Body || req.body.body || "").toString(),
  req.body.MessageSid || req.body.SmsMessageSid,
  () => handleWhatsAppWebhookInternal(req,res)
);
