import { Request, Response } from "express";
import { sendWhatsAppMessage } from "../services/whatsapp.service";
import { createContentDraft } from "../services/content.service";
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
  extractArchiveTarget,
  isViewArchiveCommand,
  isRestoreCommand,
  extractRestoreTarget,
  isApproveForProductionCommand,
  extractApproveTarget,
  getTrendText,
} from "../services/confirmation.service";
import {
  getExistingContentIds,
  generateContentId,
  saveContentIdea,
  findProductionTaskByName,
  updateProductionStatus,
  updateDeadline,
  findSimilarContentIdea,
 archiveContentIdea,
  getArchiveList,
  restoreFromArchive,
  getProductionStatusColumnIndex,
  getTasksMissingEdit,
  getTasksMissingFilmed,
  getTasksByCategory,
  getContentIdeaSummary,
  getTasksMissingCover,
  getTasksMissingCopy,
  getTasksNotUploaded,
  getTasksEditedAndNotUploaded,
  getStuckTasks,
  searchTasksByKeyword,
 getAllProductionTasksWithPriority,
  getCategories,
findRowIndexByContentId,
approveContentForProduction,
  updateGanttStatus,
  getGanttNotPublished,
  getGanttReadyToUpload,
  getGanttThisWeek,
  getGanttByDateRange,
  findApprovedContentByName,
  addRowToGantt,
 sortGanttByDate,
  updateGanttUploadTime,
  isGanttDateTaken,
  findAvailableDatesInMonth,
  updateGanttRowDate,
  getApprovedContentNotInGantt,
  saveFastTrackContent,
  getOpenContentIdeas,
  updateApprovedContentStatusById,
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
  extractSearchKeyword,
  extractStatusQueryTarget,
  formatTaskStatusResponse,
  formatVisibilityResponse,
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
import { isThisWeek, normalizeUserDateInput } from "../utils/date-utils";
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
const safeSendWhatsAppMessage = async (to: string, message: string): Promise<void> => {
  try {
    await sendWhatsAppMessage(to, message);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
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
    "- מה צריך שיבוץ לגאנט",
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
  } = {}
): string => {
  const introLines = Array.isArray(options.intro)
    ? options.intro
    : [options.intro || "יש פה כיוון טוב."];

  const lines = [
    ...introLines,
    "",
    options.previewLine || "ככה הייתי שומרת את זה כרגע:",
    "",
    `שם: ${draft.shortName}`,
    `קטגוריה: ${displayCategory(draft.category)}`,
  ];

  const shouldIncludeContentType = options.includeContentType ?? true;

  if (shouldIncludeContentType && draft.contentType) {
    lines.push(`סוג תוכן: ${displayContentType(draft.contentType)}`);
  }

  lines.push(
    `טון: ${displayTone(draft.tone)}`,
    `עדיפות: ${getDraftPriorityText(draft.priority)}`,
    "",
    "הכיוון בקצרה:",
    draft.summary
  );

  if (options.extraBeforeQuestion?.length) {
    lines.push("", ...options.extraBeforeQuestion);
  }

  lines.push(
    "",
    "לשמור ככה?",
    options.changeLine || "אפשר גם להגיד לי מה לשנות."
  );

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

  await updateApprovedContentStatusById(spreadsheetId, contentId, "פורסם");
  await updateGanttStatus(spreadsheetId, contentId, "פורסם");
};

export const handleWhatsAppWebhook = async (req: Request, res: Response) => {
  const sender = (req.body.From || req.body.from || "").toString();
  const incomingText = (req.body.Body || req.body.body || "").toString();

  if (!sender || !incomingText) {
    return res.status(400).json({
      error: "Missing Twilio WhatsApp sender or message body in webhook payload.",
    });
  }

  try {
    // ===== ROUTE DEBUG LOGS =====
    console.log(`\n[Route Debug] incomingText: "${incomingText}"`);

 // Mark interaction for afternoon reminder
    markInteractionToday(sender);

    // Check for pending question response (priority: before draft checks)
    const pendingQuestion = getPendingQuestion(sender);
    console.log(`[Route Debug] pendingQuestion: ${pendingQuestion ? JSON.stringify({ questionType: pendingQuestion.questionType }) : "null"}`);

      if (pendingQuestion?.questionType === "edit_or_new_clarification") {
        const isExplicitCommandWhileClarifying =
          isArchiveCommand(incomingText) ||
          isApproveForProductionCommand(incomingText) ||
          isRestoreCommand(incomingText) ||
          isDeadlineUpdate(incomingText);

        if (isExplicitCommandWhileClarifying) {
          clearPendingQuestion(sender);
          console.log(`[Route Debug] edit_or_new_clarification: explicit command detected, falling through`);
        } else {
        const rawAnswer = incomingText.trim().toLowerCase();
        const wantsEdit = ["לערוך", "לערוך את הנוכחי", "את הנוכחי", "הנוכחי", "עריכה"].some(
          (phrase) => rawAnswer.includes(phrase)
        );
        const wantsNew = ["לפתוח חדש", "חדש", "רעיון חדש"].some((phrase) => rawAnswer.includes(phrase));

        const draftForClarification = getPendingConfirmation(sender);

        if (wantsEdit && draftForClarification) {
          clearPendingQuestion(sender);
          const replyText = "בסדר, מה תרצי לשנות בכיוון הנוכחי?";
          await safeSendWhatsAppMessage(sender, replyText);
          return res.status(200).json({ status: "edit_clarification_resolved_edit", sender });
        }

        if (wantsNew) {
          clearPendingQuestion(sender);
          clearPendingConfirmation(sender);
          const replyText = "בסדר, עזבנו את הרעיון הקודם. תכתבי לי את הרעיון החדש.";
          await safeSendWhatsAppMessage(sender, replyText);
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

        await safeSendWhatsAppMessage(sender, replyText);
        return res.status(200).json({ status: "edit_or_new_clarification_still_unclear", sender });
        }
      }

      if (pendingQuestion?.questionType === "overdue_reschedule_date") {
        const { contentId, contentName } = pendingQuestion.context as any;
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
        const normalizedDate = normalizeUserDateInput(incomingText.trim());

        if (!normalizedDate) {
          await safeSendWhatsAppMessage(
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
          await safeSendWhatsAppMessage(
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

        await safeSendWhatsAppMessage(
          sender,
          `סגור, העברתי את "${contentName}" ל-${normalizedDate}.`
        );

        return res.status(200).json({
          status: "overdue_rescheduled",
          sender,
        });
      }

      if (pendingQuestion?.questionType === "planning_source_routing") {
        const state = pendingQuestion.context as PlanningSourceRoutingState;
        const result = handlePlanningSourceRoutingReply(state, incomingText);

        if (result.action === "next_source") {
          storePendingQuestion(sender, {
            questionType: "planning_source_routing",
            context: result.state,
          });

          await safeSendWhatsAppMessage(sender, result.message);

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

          await safeSendWhatsAppMessage(sender, result.message);

          return res.status(200).json({
            status: "planning_source_routing_clarify",
            sender,
          });
        }

        if (result.action === "new_idea" || result.action === "cancelled") {
          clearPendingQuestion(sender);
          await safeSendWhatsAppMessage(sender, result.message);

          return res.status(200).json({
            status: `planning_source_routing_${result.action}`,
            sender,
          });
        }

        if (result.action === "selected") {
          clearPendingQuestion(sender);

          if (result.source === "ideaBank") {
            await safeSendWhatsAppMessage(
              sender,
              [
                `סבבה, נתחיל מהרעיון "${result.option.title}".`,
                "",
                "זה עדיין מבנק הרעיונות, אז קודם צריך להפוך אותו לתוכן מאושר.",
                "השלב הבא הוא לאשר/להעביר אותו במסלול מהיר, ואז נוכל לשבץ אותו בגאנט.",
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

            await safeSendWhatsAppMessage(
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
            await safeSendWhatsAppMessage(
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
                suggestedDayName: ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][nextWeekStart.getDay()],
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
          const suggestedParts = suggestedDate.split("/");
          const suggestedDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][
            new Date(parseInt(suggestedParts[2]), parseInt(suggestedParts[1]) - 1, parseInt(suggestedParts[0])).getDay()
          ];

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

          await safeSendWhatsAppMessage(
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
      clearPendingQuestion(sender);
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      if (isConfirmationMessage(incomingText)) {
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
          await safeSendWhatsAppMessage(sender, `מעולה, הוספתי את "${shortNew}" ב-${newDate}.\nלא מצאתי חור פנוי אחר באותו חודש ל-"${existingName.split(/\s+/).slice(0, 6).join(" ")}" — אפשר לעדכן ידנית.\nבאיזו שעה לתכנן את ההעלאה?`);
          return res.status(200).json({ status: "gantt_collision_replaced_no_slot", sender });
        }

        const suggestedParts = suggested.split("/");
        const suggestedDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][new Date(parseInt(suggestedParts[2]), parseInt(suggestedParts[1]) - 1, parseInt(suggestedParts[0])).getDay()];
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
        await safeSendWhatsAppMessage(sender, `אעביר את "${shortExisting}" ל-${suggested} (יום ${suggestedDayName}). מאשרת?`);
        return res.status(200).json({ status: "gantt_collision_suggest_move", sender });
      }

      if (isRejectionMessage(incomingText)) {
        // קרן לא רוצה להחליף — מחפש מקום חדש ל-Y
        const available = await findAvailableDatesInMonth(spreadsheetId, newDate);
        const suggested = available[0];

        if (!suggested) {
          await safeSendWhatsAppMessage(sender, `לא מצאתי תאריך פנוי באותו חודש. תוכלי לבחור תאריך ידנית.`);
          return res.status(200).json({ status: "gantt_collision_no_slot", sender });
        }

        const suggestedParts = suggested.split("/");
        const suggestedDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][new Date(parseInt(suggestedParts[2]), parseInt(suggestedParts[1]) - 1, parseInt(suggestedParts[0])).getDay()];
        const shortNew = newContentName.split(/\s+/).slice(0, 6).join(" ");

        storePendingQuestion(sender, {
          questionType: "gantt_write_new_date",
          context: { newContentId, newContentName, suggestedDate: suggested, suggestedDayName, ganttStatus },
        });
        await safeSendWhatsAppMessage(sender, `הזמן הפנוי הקרוב הוא ${suggested} (יום ${suggestedDayName}). נכניס את "${shortNew}" שם?`);
        return res.status(200).json({ status: "gantt_collision_suggest_new_date", sender });
      }
    }

    if (pendingQuestion?.questionType === "gantt_move_existing") {
      const { newContentId, newContentName, newDate, newDayName, existingContentId, existingName, suggestedDate, suggestedDayName, ganttStatus } = pendingQuestion.context as any;
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const confirmedSuggestedDate = isConfirmationMessage(incomingText);
      const targetDate = confirmedSuggestedDate
        ? suggestedDate
        : normalizeUserDateInput(incomingText.trim());

      if (!targetDate) {
        await safeSendWhatsAppMessage(sender, "לא קלטתי תאריך תקין. אפשר לכתוב למשל 17.6, 17-6 או 17/6.");
        return res.status(200).json({ status: "gantt_move_invalid_date", sender });
      }

      clearPendingQuestion(sender);
      const targetParts = targetDate.split("/");
      const targetDayName = confirmedSuggestedDate ? suggestedDayName : ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][new Date(parseInt(targetParts[2]), parseInt(targetParts[1]) - 1, parseInt(targetParts[0])).getDay()];

      await updateGanttRowDate(spreadsheetId, existingContentId, targetDate, targetDayName);
      await addRowToGantt(spreadsheetId, newContentId, newContentName, newDate, newDayName, "", ganttStatus || "בתכנון");
      await sortGanttByDate(spreadsheetId);
      storePendingQuestion(sender, {
        questionType: "gantt_upload_time",
        context: { contentName: newContentName, date: newDate },
      });
      const shortExisting = existingName.split(/\s+/).slice(0, 6).join(" ");
      const shortNew = newContentName.split(/\s+/).slice(0, 6).join(" ");
      await safeSendWhatsAppMessage(sender, `מעולה! העברתי את "${shortExisting}" ל-${targetDate} והוספתי את "${shortNew}" ל-${newDate}.\nבאיזו שעה לתכנן את ההעלאה?`);
      return res.status(200).json({ status: "gantt_move_confirmed", sender });
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

  if (["ביטול", "עזבי", "עזוב", "לא משנה", "תבטלי"].includes(rawAnswer)) {
    clearPendingQuestion(sender);
    await safeSendWhatsAppMessage(sender, "סבבה, לא שיבצתי. אפשר לחזור לזה אחר כך.");
    return res.status(200).json({ status: "gantt_write_new_date_cancelled", sender });
  }

  if (isRejectionMessage(incomingText)) {
    storePendingQuestion(sender, {
      questionType: "gantt_write_new_date",
      context: originalContext,
    });

    await safeSendWhatsAppMessage(
      sender,
      [
        "בסדר, לא שיבצתי בתאריך הזה.",
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

    await safeSendWhatsAppMessage(
      sender,
      [
        `אין בעיה, נחזור לבחור תוכן אחר ל${monthName}.`,
        "",
        "מה עוד מחכה לשיבוץ:",
        displayList || "לא מצאתי כרגע תכנים נוספים לשיבוץ.",
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

      await safeSendWhatsAppMessage(
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

    targetDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][parsedTarget.getDay()];
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

  await safeSendWhatsAppMessage(
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
    
if (pendingQuestion?.questionType === "monthly_planning") {
  const { month, year, monthName, remainingContent } = pendingQuestion.context as any;

  // יציאה מתכנון חודש
  if (isRejectionMessage(incomingText) || ["סיימתי", "עצרי", "עצור", "זהו", "מספיק"].includes(incomingText.trim())) {
    clearPendingQuestion(sender);
    await safeSendWhatsAppMessage(sender, `סיימנו את תכנון ${monthName}. אפשר תמיד לחזור ולהוסיף עוד.`);
    return res.status(200).json({ status: "monthly_planning_done", sender });
  }

  // אם קרן ענתה כן - נתחיל מהתוכן הראשון שהצעתי
  if (isConfirmationMessage(incomingText)) {
    const firstContent = (remainingContent as any[])[0];

    if (!firstContent) {
      clearPendingQuestion(sender);
      await safeSendWhatsAppMessage(sender, `לא נשארו תכנים לשיבוץ ב${monthName}.`);
      return res.status(200).json({ status: "monthly_planning_no_remaining_content", sender });
    }

    const monthlySpreadsheetId = process.env.GOOGLE_SHEETS_ID!;
    const firstOfMonth = `01/${String(month).padStart(2, "0")}/${year}`;

    const available = await findAvailableDatesInMonth(monthlySpreadsheetId, firstOfMonth);

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
      await safeSendWhatsAppMessage(sender, `לא מצאתי תאריך פנוי קרוב ב${monthName}. אפשר לבחור תאריך ידנית.`);
      return res.status(200).json({ status: "monthly_planning_no_available_date", sender });
    }

    const suggestedDate = futureAvailable[0];
    const suggestedParts = suggestedDate.split("/");
    const suggestedDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][
      new Date(parseInt(suggestedParts[2]), parseInt(suggestedParts[1]) - 1, parseInt(suggestedParts[0])).getDay()
    ];

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

    await safeSendWhatsAppMessage(
      sender,
      [
        "מצאתי לו תאריך פנוי קרוב:",
        `${suggestedDate}, יום ${suggestedDayName}.`,
        "",
        `לשבץ את "${shortName}" לתאריך הזה?`,
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

    await safeSendWhatsAppMessage(
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
    const firstOfMonth = `01/${String(month).padStart(2, "0")}/${year}`;

    const available = await findAvailableDatesInMonth(monthlySpreadsheetId, firstOfMonth);

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
      await safeSendWhatsAppMessage(sender, `לא מצאתי תאריך פנוי קרוב ב${monthName}. אפשר לבחור תאריך ידנית.`);
      return res.status(200).json({ status: "monthly_planning_no_available_date_for_choice", sender });
    }

    const suggestedDate = futureAvailable[0];
    const suggestedParts = suggestedDate.split("/");
    const suggestedDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][
      new Date(parseInt(suggestedParts[2]), parseInt(suggestedParts[1]) - 1, parseInt(suggestedParts[0])).getDay()
    ];

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

    await safeSendWhatsAppMessage(
      sender,
      [
        "סבבה, נתחיל ממנו.",
        "",
        "מצאתי לו תאריך פנוי קרוב:",
        `${suggestedDate}, יום ${suggestedDayName}.`,
        "",
        `לשבץ את "${shortName}" לתאריך הזה?`,
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
    await safeSendWhatsAppMessage(
      sender,
      [
        "לא הבנתי איזה תוכן לשבץ.",
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
    await safeSendWhatsAppMessage(sender, `לא מצאתי את "${params.contentName}" בתכנים שאושרו. תנסי שוב.`);
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
    await safeSendWhatsAppMessage(sender, `ב-${params.date} כבר מתוכנן "${shortExisting}". תבחרי תאריך אחר.`);
    return res.status(200).json({ status: "monthly_planning_collision", sender });
  }

  const parsedDate = params.date.split("/");
  const dateObj = new Date(parseInt(parsedDate[2]), parseInt(parsedDate[1]) - 1, parseInt(parsedDate[0]));
  const dayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][dateObj.getDay()];

  await addRowToGantt(monthlySpreadsheetId, match.contentId, match.name, params.date, dayName);
  await sortGanttByDate(monthlySpreadsheetId);

  const updatedRemaining = (remainingContent as any[]).filter((c: any) => c.contentId !== match.contentId);

  if (updatedRemaining.length === 0) {
    clearPendingQuestion(sender);
    await safeSendWhatsAppMessage(sender, `נשמר. כל התכנים שובצו ב${monthName}.`);
    return res.status(200).json({ status: "monthly_planning_complete", sender });
  }

  storePendingQuestion(sender, { questionType: "monthly_planning", context: { month, year, monthName, remainingContent: updatedRemaining } });

  const remainingText = updatedRemaining.length === 1
    ? "תוכן אחד שעוד לא שובץ"
    : `${updatedRemaining.length} תכנים שעוד לא שובצו`;

  await safeSendWhatsAppMessage(sender, `נשמר. יש עוד ${remainingText}. על מה הבא?`);
  return res.status(200).json({ status: "monthly_planning_item_saved", sender });
}
    if (pendingQuestion?.questionType === "gantt_upload_time") {
      const { contentId, contentName, date, monthlyPlanning } = pendingQuestion.context as any;
      const rawTimeInput = incomingText.trim();

      const continueMonthlyPlanning = async (prefixMessage: string) => {
        if (!monthlyPlanning) {
          await safeSendWhatsAppMessage(sender, prefixMessage);
          return res.status(200).json({ status: "gantt_upload_time_done", sender });
        }

        const { month, year, monthName, remainingContent } = monthlyPlanning;

        const updatedRemaining = (remainingContent as any[]).filter(
          (c: any) => c.contentId !== contentId
        );

        if (updatedRemaining.length === 0) {
          clearPendingQuestion(sender);
          await safeSendWhatsAppMessage(
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

        await safeSendWhatsAppMessage(
          sender,
          [
            prefixMessage,
            "",
            `נשארו עוד ${updatedRemaining.length} תכנים שלא שובצו ב${monthName}.`,
            "",
            "מה עוד מחכה לשיבוץ:",
            displayList,
            "",
            "על מה הבא?",
            "אפשר לכתוב שם של תוכן מהרשימה.",
            "אם לא בא לך להמשיך עכשיו, כתבי: סיימתי",
          ].join("\n")
        );

        return res.status(200).json({ status: "monthly_planning_continue_after_upload_time", sender });
      };

      const skipUploadTime =
        isRejectionMessage(rawTimeInput) ||
        /^(דלגי|דלג|אחר כך|אח"כ|לא עכשיו|בלי שעה)$/i.test(rawTimeInput);

      if (skipUploadTime) {
        clearPendingQuestion(sender);
        return await continueMonthlyPlanning("בסדר, אפשר לעדכן שעה אחר כך ישירות בגיליון.");
      }

      const timeMatch = rawTimeInput.match(/^([01]?\d|2[0-3])(?::([0-5]\d))?$/);

      if (!timeMatch) {
        await safeSendWhatsAppMessage(
          sender,
          "לא קלטתי שעה תקינה. כתבי למשל 18:00 או 8:30. אם לא רוצה לקבוע שעה עכשיו, כתבי דלגי."
        );
        return res.status(200).json({ status: "gantt_upload_time_invalid", sender });
      }

      const normalizedUploadTime = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2] ?? "00"}`;

      clearPendingQuestion(sender);
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      await updateGanttUploadTime(spreadsheetId, contentName, date, normalizedUploadTime);

      const shortTimeName = contentName.split(/\s+/).slice(0, 6).join(" ");

      return await continueMonthlyPlanning(
        `מעולה, עדכנתי את שעת ההעלאה של "${shortTimeName}" ל-${normalizedUploadTime}.`
      );
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

  await safeSendWhatsAppMessage(
    sender,
    [
      `סבבה, השארתי את "${shortName}" בהפקה בלי תאריך עלייה.`,
      "",
      "זה יופיע כמשהו שצריך שיבוץ, כדי שלא ייפול בין הכיסאות.",
    ].join("\n")
  );

  return res.status(200).json({ status: "gantt_write_postponed", sender });
}

if (isRejectionMessage(incomingText)) {
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

        const available = await findAvailableDatesInMonth(spreadsheetId, date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const earliestGanttDate = new Date();
earliestGanttDate.setDate(earliestGanttDate.getDate() + 1);
earliestGanttDate.setHours(0, 0, 0, 0);

const alternatives = available
  .filter((candidateDate) => candidateDate !== date)
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
  })
  .slice(0, 5);

        if (alternatives.length === 0) {
          clearPendingQuestion(sender);
          await safeSendWhatsAppMessage(sender, "בסדר. לא מצאתי עוד תאריכים פנויים באותו חודש. אפשר לשבץ ידנית עם תאריך אחר.");
          return res.status(200).json({ status: "gantt_write_no_alternatives", sender });
        }

        const firstAlternative = alternatives[0];
        const firstParts = firstAlternative.split("/");
        const firstAlternativeDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][new Date(parseInt(firstParts[2]), parseInt(firstParts[1]) - 1, parseInt(firstParts[0])).getDay()];

        const optionsText = alternatives
          .map((candidateDate, index) => {
            const parts = candidateDate.split("/");
            const candidateDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getDay()];
            return `${index + 1}. ${candidateDate} (${candidateDayName})`;
          })
          .join("\n");

        storePendingQuestion(sender, {
          questionType: "gantt_write_new_date",
          context: {
          newContentId: contentId,
          newContentName: contentName,
          suggestedDate: firstAlternative,
          suggestedDayName: firstAlternativeDayName,
          alternatives,
          ganttStatus,
          monthlyPlanning,
        },
        });

        const shortName = contentName.split(/\s+/).slice(0, 6).join(" ");
        await safeSendWhatsAppMessage(
  sender,
  [
    `בסדר, לא שיבצתי ב-${date}.`,
    "אלה תאריכים פנויים באותו חודש:",
    optionsText,
    "",
    "אפשר לענות כן כדי לבחור את הראשון,",
    "לכתוב מספר מהרשימה,",
    "או לכתוב תאריך מלא.",
    "",
    "אם תרצי לבחור תוכן אחר מהרשימה, כתבי: תוכן אחר",
    "אם תרצי לעצור, כתבי: ביטול",
    "",
    `לתוכן: "${shortName}"`,
  ].join("\n")
);
        return res.status(200).json({ status: "gantt_write_alternatives_offered", sender });
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
          await safeSendWhatsAppMessage(sender, `ב-${date} כבר מתוכנן "${shortExisting}".\nרוצה שאכניס את "${shortNew}" במקומו ואעביר את "${shortExisting}" לתאריך אחר?`);
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

await safeSendWhatsAppMessage(
  sender,
  [
    `מעולה, הוספתי את "${shortConfirmName}" לגאנט ב-${date} (יום ${dayName}).`,
    productionDeadline ? `דדליין הפקה: ${productionDeadline}.` : "",
    "",
    "באיזו שעה לתכנן את ההעלאה?",
  ].filter(Boolean).join("\n")
);
        return res.status(200).json({ status: "gantt_write_confirmed", sender });
      }

      const shortName = contentName.split(/\s+/).slice(0, 6).join(" ");
      await safeSendWhatsAppMessage(
        sender,
        [
          `לא בטוחה אם לשבץ את "${shortName}" ב-${date}.`,
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

      if (isRejectionMessage(incomingText)) {
        clearPendingQuestion(sender);
        await safeSendWhatsAppMessage(sender, "בסדר, אפשר תמיד להוסיף תאריך אחר כך.");
        return res.status(200).json({ status: "deadline_skipped", sender });
      }

      const normalizedDeadline = normalizeUserDateInput(rawDeadline);
      const hasMonthName = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"].some(m => rawDeadline.includes(m));

      if (!normalizedDeadline && !hasMonthName) {
        await safeSendWhatsAppMessage(sender, "לא קלטתי תאריך תקין. אפשר לכתוב למשל 17.6, 17-6 או 17/6.");
        return res.status(200).json({ status: "deadline_invalid_date", sender });
      }

      const deadline = normalizedDeadline || rawDeadline;
      clearPendingQuestion(sender);

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
      if (spreadsheetId && contentId) {
        const rowIndex = await findRowIndexByContentId(spreadsheetId, contentId);
        if (rowIndex) {
          await updateDeadline(spreadsheetId, rowIndex, deadline);
          await safeSendWhatsAppMessage(sender, `מעולה, עדכנתי את הדדליין ל-${deadline}.`);
        } else {
          await safeSendWhatsAppMessage(sender, "לא מצאתי את המשימה בגיליון, אפשר לעדכן ידנית.");
        }
      }
      return res.status(200).json({ status: "deadline_set", sender });
    }
    if (pendingQuestion && isRejectionMessage(incomingText)) {
      clearPendingQuestion(sender);
      await safeSendWhatsAppMessage(sender, "אין בעיה, עזבתי את הרעיון.");
      return res.status(200).json({ status: "pending_question_rejected", sender });
    }
    if (pendingQuestion && isConfirmationMessage(incomingText)) {
     switch (pendingQuestion.questionType) {
        case "confirm_duplicate": {
          clearPendingQuestion(sender);
          const originalInput = pendingQuestion.context?.originalInput as string;
          if (!originalInput) {
            await safeSendWhatsAppMessage(sender, "משהו השתבש, נסי שוב.");
            return res.status(200).json({ status: "duplicate_context_missing", sender });
          }
          const draft = await createContentDraft(originalInput);
          const draftSummary = { ...draft, originalUserInput: originalInput };
          storePendingConfirmation(sender, draftSummary);
          const replyText = buildDraftPreviewMessage(draft);
          await safeSendWhatsAppMessage(sender, replyText);
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
        await safeSendWhatsAppMessage(sender, replyText);
        return res.status(200).json({ status: "trend_missing_text", sender });
      }

      const trendDraft = {
        shortName: trendText,
        category: "טרנד",
        tone: "טרנדי" as const,
        priority: "גבוה" as const,
        summary: trendText,
        originalUserInput: trendText,
      };
      storePendingConfirmation(sender, trendDraft);

      const replyText = buildDraftPreviewMessage(trendDraft, {
        intro: "מעולה, קלטתי את הטרנד.",
        previewLine: "ככה הייתי שומרת אותו כרגע:",
      });
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "trend_started", sender, draft: trendDraft });
    }
    if (isNewIdeaCommand(incomingText)) {
      const newIdeaText = getNewIdeaText(incomingText);
      const requestedContentType = getNewIdeaContentType(incomingText);
      clearPendingConfirmation(sender);

      if (!newIdeaText) {
        const replyText = "כדי לפתוח רעיון חדש, תשלחי לי למשל:\nרעיון חדש: ...\nאו:\nרעיון חדש לריל: ...\nרעיון חדש לפוסט: ...\nואני אמשיך משם.";
        await safeSendWhatsAppMessage(sender, replyText);
        return res.status(200).json({ status: "new_idea_command_missing_text", sender });
      }

      const draft = await createContentDraft(newIdeaText);
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
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "new_idea_started", sender, draft: draftSummary });
    }

    // Sprint 9: Reset commands clear the active draft and keep the session clean
    if (isResetRequest(incomingText)) {
      const pendingDraft = getPendingConfirmation(sender);
      clearPendingConfirmation(sender);

      const replyText = "אין בעיה, עזבנו את הרעיון הקודם ונמשיך הלאה.";
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "draft_reset", sender, hadPendingDraft: !!pendingDraft });
    }

    // Check if this is a confirmation response
    if (isConfirmationMessage(incomingText)) {
      const pendingDraft = getPendingConfirmation(sender);
      if (pendingDraft) {
        clearPendingConfirmation(sender);

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
              pendingDraft.contentType || "ריל"
            );

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

            const replyText = `מעולה, שמרתי את "${pendingDraft.shortName}" לתכנים שאושרו.\nID: ${contentId}`;
            await safeSendWhatsAppMessage(sender, replyText);

            if (futureAvailable.length > 0) {
              const suggested = futureAvailable[0];
              const parts = suggested.split("/");
              const suggestedDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getDay()];
              storePendingQuestion(sender, {
                questionType: "confirm_gantt_write",
                context: {
                  contentId,
                  contentName: pendingDraft.shortName,
                  date: suggested,
                  dayName: suggestedDayName,
                  ganttStatus: "מוכן",
                },
              });
              await safeSendWhatsAppMessage(sender, `מצאתי תאריך פנוי קרוב בגאנט:\n${suggested}, יום ${suggestedDayName}.\n\nלשבץ את "${pendingDraft.shortName}" לתאריך הזה?\nהסטטוס בגאנט יהיה "מוכן", כי הסרטון כבר צולם ונערך.\n\nאפשר לענות כן / לא.`);
            } else {
              await safeSendWhatsAppMessage(sender, "לא מצאתי תאריך פנוי החודש בגאנט. אפשר לשבץ ידנית.");
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
            console.log(`[Sprint 6 Workflow] ✅ PRIMARY SHEET (בנק רעיונות) write succeeded`);
          } catch (contentError) {
            const errorMessage = contentError instanceof Error ? contentError.message : "Unknown error";
            console.error(`[Sprint 6 Workflow] ❌ PRIMARY SHEET (בנק רעיונות) write FAILED: ${errorMessage}`);
            throw new Error(`Failed to save content idea: ${errorMessage}`);
          }

          // STEP 2: Production task created manually when content is approved for production
          const taskCreationFailed = false;

         // STEP 3: Send WhatsApp confirmation
          const replyText = [
            "מעולה, שמרתי את הרעיון בבנק הרעיונות.",
            "",
            `שם: ${pendingDraft.shortName}`,
            `מספר פנימי: ${contentId}`,
            "",
            "בשלב הזה הוא נשאר כרעיון פתוח, ועדיין לא נכנס להפקה.",
            "",
            "כדי לקדם אותו להפקה בהמשך, אפשר לכתוב:",
            `תוסיפי את ${pendingDraft.shortName} להפקה`,
          ].join("\n");

await safeSendWhatsAppMessage(sender, replyText);
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

          const replyText = "אישור התקבל אבל קרתה שגיאה בשמירה. אנא נסי שוב.";
          await safeSendWhatsAppMessage(sender, replyText);

          return res.status(500).json({
            status: "confirmed_but_save_failed",
            sender,
            error: errorMessage,
          });
        }
      } else {
        const replyText = "כרגע אין רעיון שממתין לאישור.\nאם יש לך רעיון חדש, תשלחי לי ונמשיך משם.";
        await safeSendWhatsAppMessage(sender, replyText);
        return res.status(200).json({ status: "no_pending", sender });
      }
    }

   // Check if this is an edit request
if (
  isEditRequest(incomingText) &&
  !isDeadlineUpdate(incomingText) &&
  !isProductionStatusUpdate(incomingText)
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

      const replyText = buildDraftPreviewMessage(updatedDraft, {
        intro: "קיבלתי, עדכנתי את הרעיון.",
        previewLine: "ככה הייתי שומרת את זה עכשיו:",
        changeLine: "אפשר גם להגיד לי מה עוד לשנות.",
      });

      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "draft_updated", sender, draft: updatedDraft });
    }

storePendingQuestion(sender, { questionType: "edit_or_new_clarification", context: {} });
    const clarificationPrompt = generateClarificationPrompt(true);
    await safeSendWhatsAppMessage(sender, clarificationPrompt);
    return res.status(200).json({ status: "edit_not_understood", sender });
  }
  const clarificationPrompt = generateClarificationPrompt(false);
  await safeSendWhatsAppMessage(sender, clarificationPrompt);
  return res.status(200).json({ status: "no_pending_for_edit", sender });
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
        await safeSendWhatsAppMessage(
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

      await safeSendWhatsAppMessage(
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
    const visibilityIntent = detectVisibilityIntent(incomingText);
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
          const target = extractStatusQueryTarget(incomingText);
          if (!target) {
            const replyText = "לא הצלחתי להבין על איזה תוכן רצית לבדוק סטטוס.\nנסי לכתוב: מה הסטטוס של...";
            await safeSendWhatsAppMessage(sender, replyText);
            return res.status(200).json({ status: "visibility_query_no_target", sender });
          }

          const matchResult = await findProductionTaskByName(spreadsheetId, target);
          if (!matchResult) {
            const replyText = "לא הצלחתי להבין על איזה תוכן רצית לבדוק סטטוס.\nנסי לכתוב: מה הסטטוס של...";
            await safeSendWhatsAppMessage(sender, replyText);
            return res.status(200).json({ status: "visibility_query_no_match", sender, target });
          }

          if ("ambiguous" in matchResult && matchResult.ambiguous) {
          const matchList = matchResult.matches.map((m: any) => formatTaskStatusResponse(m)).join("\n\n");
          const replyText = `מצאתי כמה תכנים דומים, הנה הסטטוס של כולם:\n\n${matchList}`;
          await safeSendWhatsAppMessage(sender, replyText);
          return res.status(200).json({ status: "visibility_query_ambiguous", sender, target, matches: matchResult.matches.length });
          }

          const exactMatch = matchResult as ProductionTaskMatch;
          const replyText = formatTaskStatusResponse(exactMatch);
          await safeSendWhatsAppMessage(sender, replyText);

          console.log(`[Sprint 10] ✅ Task status response sent for: ${exactMatch.row[1]}`);

          return res.status(200).json({
            status: "visibility_task_status",
            sender,
            intent: visibilityIntent,
            target,
            taskName: exactMatch.row[1],
          });
        }

        let tasks: any[] = [];
        switch (visibilityIntent) {
          case "ideas_list": {
            const ideas = await getOpenContentIdeas(spreadsheetId);
            const replyText = formatOpenIdeasResponse(ideas);
            await safeSendWhatsAppMessage(sender, replyText);
            return res.status(200).json({ status: "visibility_ideas_list", sender, intent: visibilityIntent, count: ideas.length });
          }
          case "edited_not_uploaded": {
            const readyItems = await getGanttReadyToUpload(spreadsheetId);

            if (readyItems.length === 0) {
              await safeSendWhatsAppMessage(sender, "אין כרגע תכנים שערוכים ומחכים לעלות.");
              return res.status(200).json({ status: "visibility_ready_to_upload_empty", sender, intent: visibilityIntent });
            }

            const lines = readyItems.slice(0, 5).map((item) => {
              const date = item.date ? ` — ${item.date}` : "";
              const time = item.uploadTime ? ` בשעה ${item.uploadTime}` : "";
              return `- ${item.name}${date}${time}`;
            });

            const suffix = readyItems.length > 5 ? `\n...ו${readyItems.length - 5} עוד` : "";
            const replyText = `כבר ערוך ומחכה לעלות:\n${lines.join("\n")}${suffix}`;

            await safeSendWhatsAppMessage(sender, replyText);
            return res.status(200).json({ status: "visibility_ready_to_upload", sender, intent: visibilityIntent });
          }
          case "missing_edit":
            tasks = await getTasksMissingEdit(spreadsheetId);
            break;
          case "missing_cover":
            tasks = await getTasksMissingCover(spreadsheetId);
            break;
          case "missing_copy":
            tasks = await getTasksMissingCopy(spreadsheetId);
            break;
          case "not_uploaded": {
            const ganttItems = await getGanttNotPublished(spreadsheetId);
            const replyText = formatGanttResponse(ganttItems, "עדיין לא פורסמו");
            await safeSendWhatsAppMessage(sender, replyText);
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
              await safeSendWhatsAppMessage(sender, "לא הצלחתי להבין איזו קטגוריה ושלב ביקשת. נסי לכתוב למשל: מה לא צולם בקפריסין");
              return res.status(200).json({ status: "visibility_query", sender });
            }
            const categoryTasks = await getTasksByCategory(spreadsheetId, extracted.category, extracted.stage);
            const replyText = formatCategoryStageResponse(categoryTasks, extracted.category, extracted.stage);
            await safeSendWhatsAppMessage(sender, replyText);
            return res.status(200).json({ status: "visibility_category_stage", sender });
          }
            case "content_summary": {
            const keyword = extractSearchKeyword(incomingText);
            if (!keyword) {
              await safeSendWhatsAppMessage(sender, "לא הצלחתי להבין על איזה סרטון את מדברת. תנסי שוב עם השם המדויק.");
              return res.status(200).json({ status: "visibility_query", sender });
            }
            const summary = await getContentIdeaSummary(spreadsheetId, keyword);
            if (!summary) {
              await safeSendWhatsAppMessage(sender, "לא מצאתי תוכן שמתאים למה שכתבת. תנסי עם שם קצת יותר מדויק.");
              return res.status(200).json({ status: "visibility_query", sender });
            }
            const replyText = `מצאתי את הסרטון\n"${summary.shortName}"\nהרעיון שלו:\n${summary.idea}`;
            await safeSendWhatsAppMessage(sender, replyText);
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
              await safeSendWhatsAppMessage(sender, "לא הצלחתי להבין איזה חודש. נסי לכתוב: בואי נתכנן את יולי");
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
              await safeSendWhatsAppMessage(sender, `כל התכנים שאושרו כבר משובצים ב${monthName}. אם תרצי להוסיף עוד, תוסיפי קודם לתכנים שאושרו.`);
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
  "מה עוד מחכה לשיבוץ:",
  `${displayList}${suffix}`,
  "",
  available.length > 0
    ? `יש מספיק חורים פנויים ב${monthName}.`
    : `לא מצאתי כרגע חורים פנויים ב${monthName}.`,
  "",
  firstSuggestion
    ? `הייתי מתחילה מ: "${firstSuggestion}".`
    : "אפשר לבחור תוכן ראשון לשיבוץ.",
  "",
 "אם מתאים להתחיל ממנו, תכתבי כן.",
"אפשר גם לכתוב שם של תוכן אחר מהרשימה.",
].join("\n");
            await safeSendWhatsAppMessage(sender, replyText);
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
  await safeSendWhatsAppMessage(sender, replyText);
  return res.status(200).json({ status: "visibility_gantt_holes", sender });
}
          case "gantt_write": {
            const params = extractGanttWriteParams(incomingText);
            if (!params) {
              const suppliedDate = incomingText.match(/\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?/)?.[0];

              if (suppliedDate && !normalizeUserDateInput(suppliedDate)) {
                await safeSendWhatsAppMessage(
                  sender,
                  `התאריך ${suppliedDate} לא תקין. אפשר לכתוב למשל 17.6, 17-6 או 17/6.`
                );
                return res.status(200).json({ status: "gantt_write_invalid_date", sender });
              }

              await safeSendWhatsAppMessage(sender, "לא הצלחתי להבין. נסי לכתוב למשל: תוסיפי את זוגיות בתקופת חתונה לגאנט ב-15/06");
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
            const dayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][dateObj.getDay()];

            if (!match) {
              await safeSendWhatsAppMessage(sender, `לא מצאתי תוכן בשם "${params.contentName}" בתכנים שאושרו. תבדקי את השם ותנסי שוב.`);
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
                await safeSendWhatsAppMessage(sender, `ב-${params.date} כבר מתוכנן "${shortExisting}".\nרוצה שאכניס את "${shortNew}" במקומו ואעביר את "${shortExisting}" לתאריך אחר?`);
                return res.status(200).json({ status: "gantt_collision_detected", sender });
              }

              await addRowToGantt(spreadsheetId, match.contentId, match.name, params.date, dayName);
              await sortGanttByDate(spreadsheetId);
              storePendingQuestion(sender, {
                questionType: "gantt_upload_time",
                context: { contentName: match.name, date: params.date },
              });
              const shortName = match.name.split(/\s+/).slice(0, 6).join(" ");
              await safeSendWhatsAppMessage(sender, `מעולה, הוספתי את "${shortName}" לגאנט ב-${params.date} (יום ${dayName}).\nבאיזו שעה לתכנן את ההעלאה?`);
              return res.status(200).json({ status: "gantt_write_success", sender });
            }

            // התאמה חלקית — שאל לאישור
            storePendingQuestion(sender, {
              questionType: "confirm_gantt_write",
              context: { contentId: match.contentId, contentName: match.name, date: params.date, dayName },
            });
            await safeSendWhatsAppMessage(sender, `לא מצאתי "${params.contentName}", האם התכוונת ל-"${match.name}"?`);
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
  await safeSendWhatsAppMessage(sender, replyText);
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

              await safeSendWhatsAppMessage(sender, replyText);

              return res.status(200).json({ status: "visibility_query", sender, intent: visibilityIntent });
            }
          case "priority_filter": {
            const priority = extractPriorityFromQuery(incomingText);
            if (!priority) {
              await safeSendWhatsAppMessage(sender, "איזו עדיפות תרצי לתת לזה?\nגבוה, בינוני או נמוך?");
              return res.status(200).json({ status: "visibility_query", sender });
            }
            const allTasks = await getAllProductionTasksWithPriority(spreadsheetId);
            const replyText = formatPriorityFilterResponse(allTasks, priority);
            await safeSendWhatsAppMessage(sender, replyText);
            return res.status(200).json({ status: "visibility_query", sender, intent: visibilityIntent });
          }
          default:
            tasks = [];
        }

        const replyText = formatVisibilityResponse(tasks, visibilityIntent);
        await safeSendWhatsAppMessage(sender, replyText);

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
        await safeSendWhatsAppMessage(sender, replyText);

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
      const overdueDecisionIntent = detectOverdueDecisionIntent(incomingText);

      if (overdueDecisionIntent) {
        const overdueItems = await fetchOverdueDecisionItems();
        const overdueItem = overdueItems[0];

        if (overdueItem) {
          const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
          const contentId = overdueItem.contentId;
          const contentName = overdueItem.displayTitle;

          if (overdueDecisionIntent.type === "published") {
            clearPendingQuestion(sender);
            await markOverdueItemPublished(spreadsheetId, contentId);

            await safeSendWhatsAppMessage(
              sender,
              `סגור, סימנתי ש-"${contentName}" עלה. הוא לא יופיע יותר כתזכורת איחור.`
            );

            return res.status(200).json({
              status: "overdue_published",
              sender,
            });
          }

          if (overdueDecisionIntent.type === "archive") {
            clearPendingQuestion(sender);
            await updateApprovedContentStatusById(
              spreadsheetId,
              contentId,
              "בוטל"
            );
            await updateGanttStatus(spreadsheetId, contentId, "בוטל");

            await safeSendWhatsAppMessage(
              sender,
              `סגור, סימנתי את "${contentName}" כבוטל. הוא לא יופיע יותר בתזכורות.`
            );

            return res.status(200).json({
              status: "overdue_archived",
              sender,
            });
          }

          if (overdueDecisionIntent.type === "undecided") {
            await safeSendWhatsAppMessage(
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

              await safeSendWhatsAppMessage(
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

              await safeSendWhatsAppMessage(
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

              await safeSendWhatsAppMessage(
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

            await safeSendWhatsAppMessage(
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
        await safeSendWhatsAppMessage(sender, "אין כרגע רעיונות בארכיון.");
        return res.status(200).json({ status: "archive_empty", sender });
      }
      const listText = archiveList.slice(0, 10).map((item) => `- ${item.idea.split(/\s+/).slice(0, 6).join(" ")}`).join("\n");
      const suffix = archiveList.length > 10 ? `\n...ו${archiveList.length - 10} עוד` : "";
      await safeSendWhatsAppMessage(sender, `הרעיונות שבצד:\n${listText}${suffix}`);
      return res.status(200).json({ status: "archive_listed", sender });
    }

    // Restore from archive
    if (isRestoreCommand(incomingText)) {
      const target = extractRestoreTarget(incomingText);
      if (!target) {
        await safeSendWhatsAppMessage(
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
        await safeSendWhatsAppMessage(sender, "לא מצאתי את הרעיון בארכיון. אפשר לשלוח שם קצת יותר מדויק וננסה שוב.");
        return res.status(200).json({ status: "restore_not_found", sender });
      }
      await safeSendWhatsAppMessage(sender, `מעולה, החזרתי את הרעיון "${result.restoredName}" לבנק הרעיונות.`);
      return res.status(200).json({ status: "restored", sender });
    }
    if (isApproveForProductionCommand(incomingText)) {
      const target = extractApproveTarget(incomingText);
      if (!target) {
        await safeSendWhatsAppMessage(
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

      let result;
      try {
        result = await approveContentForProduction(spreadsheetId, target);
      } catch (approveError) {
        await safeSendWhatsAppMessage(sender, "לא מצאתי את הרעיון. אפשר לשלוח שם קצת יותר מדויק וננסה שוב.");
        return res.status(200).json({ status: "approve_not_found", sender });
      }

      await safeSendWhatsAppMessage(sender, `מעולה, העברתי את "${result.name}" לתכנים שאושרו ופתחתי משימת הפקה.`);

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
        const parts = suggested.split("/");
        const suggestedDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getDay()];

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

        await safeSendWhatsAppMessage(
  sender,
  [
    "מצאתי לו חור פנוי קרוב בגאנט:",
    `${suggested}, יום ${suggestedDayName}.`,
    "",
    `לשבץ את "${result.name}" לתאריך הזה?`,
    "",
    "הוא ייכנס כבתכנון, כי עדיין צריך לסמן צילום, עריכה וקאבר.",
    "",
    "אפשר לענות כן או לא.",
  ].join("\n")
);
      } else {
        await safeSendWhatsAppMessage(sender, "לא מצאתי תאריך פנוי החודש בגאנט. אפשר לשבץ ידנית.");
      }

      return res.status(200).json({ status: "approved_for_production", sender });
    }
if (isArchiveCommand(incomingText)) {
      const target = extractArchiveTarget(incomingText);
      if (!target) {
        await safeSendWhatsAppMessage(
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
        await safeSendWhatsAppMessage(sender, "לא מצאתי את הרעיון. אפשר לשלוח שם קצת יותר מדויק וננסה שוב.");
        return res.status(200).json({ status: "archive_not_found", sender });
      }

      const replyText = `אין בעיה.\nשמרתי את הרעיון "${result.archivedName}" בצד למקרה שתרצי לחזור אליו.`;
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "archived", sender });
    }
      if (isDeadlineUpdate(incomingText)) {
      const deadlineUpdate = extractDeadlineUpdate(incomingText);
      if (!deadlineUpdate) {
        await safeSendWhatsAppMessage(
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
      await safeSendWhatsAppMessage(sender, clarificationPrompt);
      return res.status(200).json({ status: "question_clarification", sender });
    }


      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const matchResult = await findProductionTaskByName(spreadsheetId, deadlineUpdate.contentName);

      if (!matchResult) {
        await safeSendWhatsAppMessage(sender, "לא מצאתי את הסרטון. אפשר לשלוח שם קצת יותר מדויק וננסה שוב.");
        return res.status(200).json({ status: "deadline_update_no_match", sender });
      }

      if ("ambiguous" in matchResult && matchResult.ambiguous) {
        await safeSendWhatsAppMessage(sender, "מצאתי כמה סרטונים דומים. אפשר לשלוח שם קצת יותר מדויק כדי שאבחר את הנכון.");
        return res.status(200).json({ status: "deadline_update_ambiguous", sender });
      }

      const exactMatch = matchResult as ProductionTaskMatch;
      await updateDeadline(spreadsheetId, exactMatch.rowIndex, deadlineUpdate.deadline);

      const replyText = `עדכנתי. הדדליין של "${exactMatch.row[1]}" הוא עכשיו ${deadlineUpdate.deadline}.`;
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "deadline_updated", sender });
    }

    // ===== PRODUCTION STATUS UPDATE CHECK =====
    console.log(`[Route Debug] About to check isProductionStatusUpdate...`);
    // Sprint 7: Check if this is a production status update
    const isStatusUpdate = isProductionStatusUpdate(incomingText);
    console.log(`[Route Debug] isProductionStatusUpdate: ${isStatusUpdate}`);

    if (isStatusUpdate) {
      const statusUpdate = detectStatusUpdate(incomingText);
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

          const matchResult = explicitFastTrack
            ? null
            : await findProductionTaskByName(spreadsheetId, statusUpdate.contentName);

          if (!matchResult) {
            // Fast Track — תוכן לא קיים בהפקה, קרן צילמה ספונטנית
            const isReadyUpdate = statusUpdate.statusTypes.includes("filmed") || statusUpdate.statusTypes.includes("edited");
            if (isReadyUpdate) {
              const draft = await createContentDraft(statusUpdate.contentName);
              const draftSummary = { ...draft, originalUserInput: statusUpdate.contentName, isFastTrack: true };
              storePendingConfirmation(sender, draftSummary);
              const replyText = buildDraftPreviewMessage(draft, {
  intro: [
    "לא מצאתי את זה בהפקה - נראה שצילמת משהו ספונטני, יופי.",
    "",
    "יצרתי טיוטה לתוכן מהיר.",
  ],
  extraBeforeQuestion: [
    "אחרי אישור אכניס את זה ישר לתכנים שאושרו ואחפש לזה תאריך בגאנט.",
  ],
});

await safeSendWhatsAppMessage(sender, replyText);
return res.status(200).json({ status: "fast_track_draft_created", sender });
}

            const replyText = "לא בטוחה איזה תוכן רצית לעדכן.\nתכתבי לי שוב את שם הסרטון ונמשיך.";
            await safeSendWhatsAppMessage(sender, replyText);
            console.log(`[Sprint 7 Workflow] No production task found for: ${statusUpdate.contentName}`);
            return res.status(200).json({
              status: "status_update_no_match",
              sender,
              contentName: statusUpdate.contentName,
            });
          }

          if ("ambiguous" in matchResult && matchResult.ambiguous) {
            const replyText = "מצאתי כמה תכנים דומים.\nאיזה מהם התכוונת?";
            await safeSendWhatsAppMessage(sender, replyText);
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
            .map((statusType) => {
              const columnName = getColumnName(statusType);
              const columnIndex = getProductionStatusColumnIndex(columnName);
              return { statusType, columnName, columnIndex };
            })
            .filter((update) => update.columnIndex !== null) as { statusType: string; columnName: string; columnIndex: number }[];
            const uniqueUpdates = Array.from(
            new Map(statusUpdates.map((update) => [update.columnIndex, update])).values()
          );
          console.log(`[Sprint 7 Workflow] Found match: "${exactMatch.row[1]}" at row ${exactMatch.rowIndex}`);
          console.log(`[Sprint 7 Workflow] Updating status columns: ${uniqueUpdates.map((update) => update.columnName).join(", ")}`);

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
                await updateApprovedContentStatusById(spreadsheetId, contentId, approvedStatus);
              } catch (approvedStatusError) {
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
                await updateGanttStatus(spreadsheetId, contentId, "מוכן");
                console.log(`[Sprint 7 Workflow] ✅ Gantt status updated to מוכן for: ${contentId}`);
              } catch (ganttReadyError) {
                console.error(`[Sprint 7 Workflow] ⚠️ Failed to update gantt to ready: ${ganttReadyError}`);
              }
            }
          }

          // אם הועלה - עדכן גאנט ל"פורסם"
          if (statusUpdate.statusTypes.includes("uploaded")) {
            if (contentId) {
              try {
                await updateGanttStatus(spreadsheetId, contentId, "פורסם");
                console.log(`[Sprint 7 Workflow] ✅ Gantt status updated to פורסם for: ${contentId}`);
              } catch (ganttError) {
                console.error(`[Sprint 7 Workflow] ⚠️ Failed to update gantt: ${ganttError}`);
              }
            }
          }
          const contentNameDisplay = exactMatch.row[1] || statusUpdate.contentName;
          const isUploaded = statusUpdate.statusTypes.includes("uploaded");
          const replyText = isUploaded
            ? `מעולה!\nעדכנתי בגאנט ש"${contentNameDisplay}" עלה.`
            : `מעולה, עדכנתי את זה.\n"${contentNameDisplay}" סומן כ: ${uniqueUpdates.map((u) => u.columnName).join(", ")}`;
          await safeSendWhatsAppMessage(sender, replyText);

          console.log(`[Sprint 7 Workflow] ✅ Status update complete for: ${contentNameDisplay}\n`);

          return res.status(200).json({
            status: "status_updated",
            sender,
            contentName: contentNameDisplay,
            statusTypes: statusUpdate.statusTypes,
            columnNames: uniqueUpdates.map((update) => update.columnName),
          });
        } catch (statusError) {
          const errorMessage =
            statusError instanceof Error ? statusError.message : "Unknown error";
          console.error(`[Sprint 7 Workflow] ❌ Error updating status: ${errorMessage}\n`);

          const replyText = "קרתה שגיאה בעדכון הסטטוס. אנא נסי שוב בעוד רגע.";
          await safeSendWhatsAppMessage(sender, replyText);

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
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "visibility_unclear", sender });
    }

    // ===== FIX 3: Meta-conversation detection =====
    // Don't create content from meta-conversation messages
    const existingDraft = getPendingConfirmation(sender);
    console.log(`[Route Debug] pendingConfirmation: ${existingDraft ? "exists" : "null"}`);

    if (!existingDraft && isGeneralChatOrHelpMessage(incomingText)) {
      await safeSendWhatsAppMessage(sender, buildGeneralHelpResponse());
      return res.status(200).json({ status: "general_help", sender });
    }

    if (isMetaConversation(incomingText)) {
      if (existingDraft) {
        storePendingQuestion(sender, { questionType: "edit_or_new_clarification", context: {} });
      }
      const clarificationPrompt = generateClarificationPrompt(!!existingDraft);
      await safeSendWhatsAppMessage(sender, clarificationPrompt);
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
      await safeSendWhatsAppMessage(sender, replyText);
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

      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "draft_continuation_updated", sender, draft: updatedDraft });
    }

    // ===== FIX 5: Lightweight confidence gating =====
    // Check if message has minimum confidence to be treated as new idea
    const hasConfidence = hasIdeaConfidence(incomingText);
    console.log(`[Route Debug] hasIdeaConfidence: ${hasConfidence}`);

    if (!hasConfidence) {
      console.log(`[Route Debug] reached fallback: low_confidence_idea`);
      if (existingDraft) {
        storePendingQuestion(sender, { questionType: "edit_or_new_clarification", context: {} });
      }
      const clarificationPrompt = generateClarificationPrompt(!!existingDraft);
      await safeSendWhatsAppMessage(sender, clarificationPrompt);
      return res.status(200).json({ status: "low_confidence_idea", sender });
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
      const replyText = `שימי לב - מצאתי רעיון דומה שכבר קיים: "${similar.idea.substring(0, 50)}..." (${similar.contentId})
רוצה לשמור בכל זאת?`;
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "duplicate_found", sender });
    }

    // No duplicate - create draft normally
    const draft = await createContentDraft(cleanedUserInput);
    const draftSummary = {
      ...draft,
      originalUserInput: cleanedUserInput,
    };
    storePendingConfirmation(sender, draftSummary);
    const replyText = buildDraftPreviewMessage(draft);
    await safeSendWhatsAppMessage(sender, replyText);
    return res.status(200).json({ status: "draft_created", sender, draft: draftSummary });

  } catch (error) {
    if (error instanceof GanttDuplicateError) {
      clearPendingQuestion(sender);

      await safeSendWhatsAppMessage(
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
      await safeSendWhatsAppMessage(sender, "מצטערת, קרתה שגיאה. נסי שוב בעוד רגע.");
    } catch (sendError) {
      console.error("Failed to send error message:", sendError);
    }

    return res.status(500).json({ error: "Unable to process message.", details: message });
  }
};
