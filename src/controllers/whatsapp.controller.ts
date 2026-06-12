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
  storePendingConfirmation,
  getPendingConfirmation,
  clearPendingConfirmation,
  storePendingQuestion,
  getPendingQuestion,
  clearPendingQuestion,
  isResetRequest,
  isNewIdeaCommand,
  getNewIdeaText,
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
import { isThisWeek } from "../utils/date-utils";

const safeSendWhatsAppMessage = async (to: string, message: string): Promise<void> => {
  try {
    await sendWhatsAppMessage(to, message);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WhatsApp] Failed to send message to ${to}: ${errorMessage}`);
  }
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

    // Check for pending question response (priority: before draft checks)
    const pendingQuestion = getPendingQuestion(sender);
    console.log(`[Route Debug] pendingQuestion: ${pendingQuestion ? JSON.stringify({ questionType: pendingQuestion.questionType }) : "null"}`);
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
      clearPendingQuestion(sender);
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      const targetDate = isConfirmationMessage(incomingText) ? suggestedDate : incomingText.trim();
      const targetParts = targetDate.split("/");
      const targetDayName = isConfirmationMessage(incomingText) ? suggestedDayName : ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][new Date(parseInt(targetParts[2]), parseInt(targetParts[1]) - 1, parseInt(targetParts[0])).getDay()];

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
      const { newContentId, newContentName, suggestedDate, suggestedDayName, ganttStatus, alternatives = [] } = pendingQuestion.context as any;
      const originalContext = pendingQuestion.context;
      clearPendingQuestion(sender);
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      const rawAnswer = incomingText.trim();
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
          targetDate = rawAnswer;
        }

        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(targetDate)) {
          storePendingQuestion(sender, {
            questionType: "gantt_write_new_date",
            context: originalContext,
          });
          await safeSendWhatsAppMessage(sender, "לא קלטתי תאריך תקין. אפשר לענות במספר מהרשימה, למשל 1 או 2, או לכתוב תאריך מלא כמו 18/06/2026.");
          return res.status(200).json({ status: "gantt_write_new_date_invalid_date", sender });
        }

        const targetParts = targetDate.split("/");
        const parsedTarget = new Date(parseInt(targetParts[2]), parseInt(targetParts[1]) - 1, parseInt(targetParts[0]));

        if (Number.isNaN(parsedTarget.getTime())) {
          storePendingQuestion(sender, {
            questionType: "gantt_write_new_date",
            context: originalContext,
          });
          await safeSendWhatsAppMessage(sender, "התאריך לא נראה תקין. תכתבי תאריך בפורמט 18/06/2026 או מספר מהרשימה.");
          return res.status(200).json({ status: "gantt_write_new_date_invalid_date", sender });
        }

        targetDayName = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][parsedTarget.getDay()];
      }

      await addRowToGantt(spreadsheetId, newContentId, newContentName, targetDate, targetDayName, "", ganttStatus || "בתכנון");
      await sortGanttByDate(spreadsheetId);
      storePendingQuestion(sender, {
        questionType: "gantt_upload_time",
        context: { contentName: newContentName, date: targetDate },
      });
      const shortNew = newContentName.split(/\s+/).slice(0, 6).join(" ");
      await safeSendWhatsAppMessage(sender, `מעולה, הוספתי את "${shortNew}" לגאנט ב-${targetDate} (יום ${targetDayName}).\nבאיזו שעה לתכנן את ההעלאה?`);
      return res.status(200).json({ status: "gantt_write_new_date_confirmed", sender });
    }
    if (pendingQuestion?.questionType === "monthly_planning") {
      const { month, year, monthName, remainingContent } = pendingQuestion.context as any;

      // בדוק אם קרן רוצה לצאת מהתכנון
      if (isRejectionMessage(incomingText) || ["סיימתי", "עצרי", "זהו", "מספיק"].includes(incomingText.trim())) {
        clearPendingQuestion(sender);
        await safeSendWhatsAppMessage(sender, `סיימנו את תכנון ${monthName}. אפשר תמיד לחזור ולהוסיף עוד.`);
        return res.status(200).json({ status: "monthly_planning_done", sender });
      }

      // בדוק אם זו פקודת gantt_write — חלץ שם ותאריך
      const params = extractGanttWriteParams(incomingText);
      if (!params) {
        // לא הובן — שמור את ה-context ושאל שוב
        storePendingQuestion(sender, { questionType: "monthly_planning", context: { month, year, monthName, remainingContent } });
        await safeSendWhatsAppMessage(sender, `לא הבנתי. נסי לכתוב למשל: תוסיפי את שמלה שלישית ל-3/07`);
        return res.status(200).json({ status: "monthly_planning_parse_error", sender });
      }

      const monthlySpreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const match = await findApprovedContentByName(monthlySpreadsheetId, params.contentName);
      if (!match) {
        storePendingQuestion(sender, { questionType: "monthly_planning", context: { month, year, monthName, remainingContent } });
        await safeSendWhatsAppMessage(sender, `לא מצאתי את "${params.contentName}" בתכנים שאושרו. תנסי שוב.`);
        return res.status(200).json({ status: "monthly_planning_not_found", sender });
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

      // הסר מהרשימה
      const updatedRemaining = (remainingContent as any[]).filter((c: any) => c.contentId !== match.contentId);

      if (updatedRemaining.length === 0) {
        clearPendingQuestion(sender);
        await safeSendWhatsAppMessage(sender, `נשמר. כל התכנים שובצו ב${monthName}.`);
        return res.status(200).json({ status: "monthly_planning_complete", sender });
      }

      storePendingQuestion(sender, { questionType: "monthly_planning", context: { month, year, monthName, remainingContent: updatedRemaining } });
      const remainingText = updatedRemaining.length === 1 ? "תוכן אחד שעוד לא שובץ" : `${updatedRemaining.length} תכנים שעוד לא שובצו`;
      await safeSendWhatsAppMessage(sender, `נשמר. יש עוד ${remainingText}. על מה הבא?`);
      return res.status(200).json({ status: "monthly_planning_item_saved", sender });
    }
    if (pendingQuestion?.questionType === "gantt_upload_time") {
      const { contentName, date } = pendingQuestion.context as any;
      const rawTimeInput = incomingText.trim();

      const skipUploadTime =
        isRejectionMessage(rawTimeInput) ||
        /^(דלגי|דלג|אחר כך|אח"כ|לא עכשיו|בלי שעה)$/i.test(rawTimeInput);

      if (skipUploadTime) {
        clearPendingQuestion(sender);
        await safeSendWhatsAppMessage(sender, "בסדר, אפשר לעדכן שעה אחר כך ישירות בגיליון.");
        return res.status(200).json({ status: "gantt_upload_time_skipped", sender });
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
      await safeSendWhatsAppMessage(sender, `מעולה, עדכנתי את שעת ההעלאה של "${shortTimeName}" ל-${normalizedUploadTime}.`);
      return res.status(200).json({ status: "gantt_upload_time_set", sender });
    }
    if (pendingQuestion?.questionType === "confirm_gantt_write") {
      const { contentId, contentName, date, dayName, ganttStatus } = pendingQuestion.context as any;
      clearPendingQuestion(sender);
      if (isRejectionMessage(incomingText)) {
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

        const available = await findAvailableDatesInMonth(spreadsheetId, date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const alternatives = available
          .filter((candidateDate) => candidateDate !== date)
          .filter((candidateDate) => {
            const parts = candidateDate.split("/");
            const parsed = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
            return parsed >= today;
          })
          .slice(0, 5);

        if (alternatives.length === 0) {
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
          },
        });

        const shortName = contentName.split(/\s+/).slice(0, 6).join(" ");
        await safeSendWhatsAppMessage(sender, `בסדר, לא שיבצתי ב-${date}.\nאלה תאריכים פנויים באותו חודש:\n${optionsText}\n\nאפשר לענות "כן" כדי לבחור את הראשון, לכתוב מספר מהרשימה, או לכתוב תאריך מלא מהרשימה.\nלתוכן: "${shortName}"`);
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

        await addRowToGantt(spreadsheetId, contentId, contentName, date, dayName, "", ganttStatus || "בתכנון");
        await sortGanttByDate(spreadsheetId);
        storePendingQuestion(sender, {
          questionType: "gantt_upload_time",
          context: { contentName, date },
        });
        const shortConfirmName = contentName.split(/\s+/).slice(0, 6).join(" ");
        await safeSendWhatsAppMessage(sender, `מעולה, הוספתי את "${shortConfirmName}" לגאנט ב-${date} (יום ${dayName}).\nבאיזו שעה לתכנן את ההעלאה?`);
        return res.status(200).json({ status: "gantt_write_confirmed", sender });
      }
    }
    if (pendingQuestion?.questionType === "set_deadline") {
      const contentId = pendingQuestion.context?.contentId as string;
      clearPendingQuestion(sender);
      const looksLikeDate = /\d/.test(incomingText) ||
        ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"].some(m => incomingText.includes(m));
      if (isRejectionMessage(incomingText) || !looksLikeDate) {
        await safeSendWhatsAppMessage(sender, "בסדר, אפשר תמיד להוסיף תאריך אחר כך.");
        return res.status(200).json({ status: "deadline_skipped", sender });
      }
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
      if (spreadsheetId && contentId) {
        const rowIndex = await findRowIndexByContentId(spreadsheetId, contentId);
        if (rowIndex) {
          await updateDeadline(spreadsheetId, rowIndex, incomingText.trim());
          await safeSendWhatsAppMessage(sender, `מעולה, עדכנתי את הדדליין ל-${incomingText.trim()}.`);
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
          const replyText = `יש פה כיוון טוב.
שם קצר: ${draft.shortName}
קטגוריה: ${displayCategory(draft.category)}
טון: ${displayTone(draft.tone)}
עדיפות: ${displayPriority(draft.priority)}
סיכום: ${draft.summary}
זה בסדר? אשר כדי לשמור או אמור לי מה לשנות.`;
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
        const replyText = "לא בטוחה שהבנתי איזה טרנד התכוונת.\nנסי לכתוב: טרנד: שם הסרטון";
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

const replyText = `מעולה, הטרנד נשמר.
שם: ${trendText}
קטגוריה: טרנד
עדיפות: גבוהה

לשמור?`;
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "trend_started", sender, draft: trendDraft });
    }
    if (isNewIdeaCommand(incomingText)) {
      const newIdeaText = getNewIdeaText(incomingText);
      clearPendingConfirmation(sender);

      if (!newIdeaText) {
        const replyText = "רוצה לפתוח רעיון חדש?\nתשלחי לי:\nרעיון חדש: ...\nואני אמשיך משם.";
        await safeSendWhatsAppMessage(sender, replyText);
        return res.status(200).json({ status: "new_idea_command_missing_text", sender });
      }

      const draft = await createContentDraft(newIdeaText);
      const draftSummary = {
        ...draft,
        originalUserInput: newIdeaText,
      };
      storePendingConfirmation(sender, draftSummary);

      const replyText = `יאללה, פתחתי רעיון חדש.

שם קצר: ${draft.shortName}
קטגוריה: ${displayCategory(draft.category)}
טון: ${displayTone(draft.tone)}
עדיפות: ${displayPriority(draft.priority)}
סיכום: ${draft.summary}

זה בסדר? אשר כדי לשמור או אמור לי מה לשנות.`;
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
              pendingDraft.priority
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
              pendingDraft.priority
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
          const replyText = `מעולה, שמרתי את הרעיון.\nID: ${contentId}`;
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
          const updatedDraft = applyEditToDraft(pendingDraft, edit);
          storePendingConfirmation(sender, updatedDraft);

          // Send updated draft summary
          const replyText = `קיבלתי, עדכנתי את הרעיון.

שם קצר: ${updatedDraft.shortName}
קטגוריה: ${displayCategory(updatedDraft.category)}
טון: ${displayTone(updatedDraft.tone)}
עדיפות: ${displayPriority(updatedDraft.priority)}
סיכום: ${updatedDraft.summary}

זה בסדר עכשיו?`;
          await safeSendWhatsAppMessage(sender, replyText);
          return res.status(200).json({ status: "draft_updated", sender, draft: updatedDraft });
        } else {
          // FIX 4: Better clarification response for unclear edits
          const clarificationPrompt = generateClarificationPrompt(true);
          await safeSendWhatsAppMessage(sender, clarificationPrompt);
          return res.status(200).json({ status: "edit_not_understood", sender });
        }
      } else {
        const clarificationPrompt = generateClarificationPrompt(false);
        await safeSendWhatsAppMessage(sender, clarificationPrompt);
        return res.status(200).json({ status: "no_pending_for_edit", sender });
      }
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

            const displayList = unscheduled.slice(0, 5).map((c) => `- ${c.name.split(/\s+/).slice(0, 6).join(" ")}`).join("\n");
            const suffix = unscheduled.length > 5 ? `\n...ו${unscheduled.length - 5} עוד` : "";
            const replyText = `יש לך ${unscheduled.length} תכנים מוכנים שעוד לא שובצו ב${monthName}:\n${displayList}${suffix}\n\nיש ${available.length} תאריכים פנויים ב${monthName}.\nעל איזה תוכן תרצי להתחיל?`;
            await safeSendWhatsAppMessage(sender, replyText);
            return res.status(200).json({ status: "monthly_planning_started", sender });
          }
          case "gantt_holes": {
            const now = new Date();
            const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
            const currentYear = now.getFullYear();
            const firstOfMonth = `01/${currentMonth}/${currentYear}`;
            const available = await findAvailableDatesInMonth(spreadsheetId, firstOfMonth);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const futureAvailable = available.filter((date) => {
              const parts = date.split("/");
              const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
              return d >= today;
            });
            const replyText = formatGanttHolesResponse(futureAvailable);
            await safeSendWhatsAppMessage(sender, replyText);
            return res.status(200).json({ status: "visibility_gantt_holes", sender });
          }
          case "gantt_write": {
            const params = extractGanttWriteParams(incomingText);
            if (!params) {
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
            const now = new Date();
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay() + 1);
            startOfWeek.setHours(0, 0, 0, 0);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            endOfWeek.setHours(23, 59, 59, 999);
            const ganttItems = await getGanttByDateRange(spreadsheetId, startOfWeek, endOfWeek);
            const replyText = formatGanttResponse(ganttItems, "השבוע");
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

const tenDaysFromNow = new Date(today);
tenDaysFromNow.setDate(today.getDate() + 10);
tenDaysFromNow.setHours(23, 59, 59, 999);

const [allTasks, ganttUpcoming] = await Promise.all([
  getAllProductionTasksWithPriority(spreadsheetId),
  getGanttByDateRange(spreadsheetId, today, tenDaysFromNow),
]);

const productionById = new Map(
  allTasks.map((task) => [task.contentId, task])
);

const thisWeek = ganttUpcoming
  .filter((item) => item.status !== "פורסם")
  .map((item) => {
    const productionTask = productionById.get(item.contentId);
    const ganttStatus = item.status || "";

    const ganttLooksReady =
      ganttStatus === "מוכן" ||
      ganttStatus === "פורסם" ||
      ganttStatus === "בזמן אמת";

    const fallbackProductionStatus = ganttLooksReady ? "כן" : "לא";

    return {
      contentId: item.contentId,
      taskName: item.name,
      needsText: productionTask?.needsText || "לא",
      filmed: productionTask?.filmed || fallbackProductionStatus,
      edited: productionTask?.edited || fallbackProductionStatus,
      coverReady: productionTask?.coverReady || fallbackProductionStatus,
      copyReady: productionTask?.copyReady || "כן",
      uploaded: item.status === "פורסם" ? "כן" : "לא",
      deadline: item.date,
      uploadTime: item.uploadTime || "",
      notes: item.notes || productionTask?.notes || "",
      priority: item.priority || productionTask?.priority || "בינוני",
      category: productionTask?.category || "",
      isTrend: item.contentId?.startsWith("TRD-") || productionTask?.isTrend || false,
      deadlineDate: null,
      deadlineDayName: item.day,
    };
  });
const highNotUploaded: any[] = [];
const stuck = allTasks.filter((t) => t.filmed === "כן" && t.edited !== "כן" && !t.isTrend);
const trends = allTasks.filter((t) => t.isTrend && t.uploaded !== "כן");

const notFilmedThisWeek = thisWeek
  .filter((item) => item.filmed !== "כן")
  .map((item) => ({
    taskName: item.taskName,
    deadlineDayName: item.deadlineDayName,
  }));
            const replyText = formatWhatsImportantResponse(highNotUploaded, stuck, trends, thisWeek, notFilmedThisWeek);
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
        await safeSendWhatsAppMessage(sender, "לא הצלחתי להבין איזה רעיון להחזיר. נסי לכתוב: תחזרי את [שם הרעיון] לרעיונות");
        return res.status(200).json({ status: "restore_parse_error", sender });
      }
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const result = await restoreFromArchive(spreadsheetId, target);
      if (!result) {
        await safeSendWhatsAppMessage(sender, "לא מצאתי את הרעיון בארכיון. תנסי עם שם קצת יותר מדויק.");
        return res.status(200).json({ status: "restore_not_found", sender });
      }
      await safeSendWhatsAppMessage(sender, `מעולה, החזרתי את הרעיון "${result.restoredName}" לבנק הרעיונות.`);
      return res.status(200).json({ status: "restored", sender });
    }
    if (isApproveForProductionCommand(incomingText)) {
      const target = extractApproveTarget(incomingText);
      if (!target) {
        await safeSendWhatsAppMessage(sender, "לא הצלחתי להבין איזה רעיון להוסיף להפקה. נסי לכתוב: תוסיפי את [שם הרעיון] להפקה");
        return res.status(200).json({ status: "approve_parse_error", sender });
      }
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

      let result;
      try {
        result = await approveContentForProduction(spreadsheetId, target);
      } catch (approveError) {
        await safeSendWhatsAppMessage(sender, "לא מצאתי את הרעיון. נסי עם שם קצת יותר מדויק או עם Content_ID.");
        return res.status(200).json({ status: "approve_not_found", sender });
      }

      await safeSendWhatsAppMessage(sender, `מעולה, העברתי את "${result.name}" לתכנים שאושרו ופתחתי משימת הפקה.`);

      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const firstOfMonth = `01/${String(month).padStart(2, "0")}/${year}`;

      const available = await findAvailableDatesInMonth(spreadsheetId, firstOfMonth);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const futureAvailable = available.filter((candidateDate) => {
        const parts = candidateDate.split("/");
        const parsed = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        return parsed >= today;
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

        await safeSendWhatsAppMessage(sender, `מצאתי תאריך פנוי קרוב בגאנט:\n${suggested}, יום ${suggestedDayName}.\n\nלשבץ את "${result.name}" לתאריך הזה?\nהסטטוס בגאנט יהיה "בתכנון", כי הסרטון עדיין לא סומן כמוכן לעלייה.\n\nאפשר לענות כן / לא.`);
      } else {
        await safeSendWhatsAppMessage(sender, "לא מצאתי תאריך פנוי החודש בגאנט. אפשר לשבץ ידנית.");
      }

      return res.status(200).json({ status: "approved_for_production", sender });
    }
if (isArchiveCommand(incomingText)) {
      const target = extractArchiveTarget(incomingText);
      if (!target) {
        await safeSendWhatsAppMessage(sender, "לא הצלחתי להבין איזה רעיון לשמור בצד. נסי לכתוב: תעבירי את [שם הרעיון] לארכיון");
        return res.status(200).json({ status: "archive_parse_error", sender });
      }

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const result = await archiveContentIdea(spreadsheetId, target);

      if (!result) {
        await safeSendWhatsAppMessage(sender, "לא מצאתי את הרעיון. תנסי עם שם קצת יותר מדויק.");
        return res.status(200).json({ status: "archive_not_found", sender });
      }

      const replyText = `אין בעיה.\nשמרתי את הרעיון "${result.archivedName}" בצד למקרה שתרצי לחזור אליו.`;
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "archived", sender });
    }
if (isDeadlineUpdate(incomingText)) {
      const deadlineUpdate = extractDeadlineUpdate(incomingText);
      if (!deadlineUpdate) {
        await safeSendWhatsAppMessage(sender, "לא הצלחתי להבין. נסי לכתוב: תשני את הדדליין של [שם הסרטון] ל-[תאריך]");
        return res.status(200).json({ status: "deadline_update_parse_error", sender });
      }
    // Handle unsupported question-like messages (after visibilityIntent is ruled out)
    if (questionLikeMessage) {
      const clarificationPrompt = generateClarificationPrompt(!!getPendingConfirmation(sender));
      await safeSendWhatsAppMessage(sender, clarificationPrompt);
      return res.status(200).json({ status: "question_clarification", sender });
    }


      const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
      const matchResult = await findProductionTaskByName(spreadsheetId, deadlineUpdate.contentName);

      if (!matchResult) {
        await safeSendWhatsAppMessage(sender, "לא מצאתי את הסרטון. תנסי עם שם קצת יותר מדויק.");
        return res.status(200).json({ status: "deadline_update_no_match", sender });
      }

      if ("ambiguous" in matchResult && matchResult.ambiguous) {
        await safeSendWhatsAppMessage(sender, "מצאתי כמה סרטונים דומים. תנסי עם שם יותר מדויק.");
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
              const replyText = `לא מצאתי את "${statusUpdate.contentName}" בהפקה — נראה שצילמת ספונטנית, יופי!

יצרתי דראפט:
שם קצר: ${draft.shortName}
קטגוריה: ${displayCategory(draft.category)}
טון: ${displayTone(draft.tone)}
עדיפות: ${displayPriority(draft.priority)}
סיכום: ${draft.summary}

אחרי אישור אכניס ישירות לתכנים שאושרו ואחפש תאריך בגאנט. זה בסדר?`;
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
    if (isMetaConversation(incomingText)) {
      const clarificationPrompt = generateClarificationPrompt(!!existingDraft);
      await safeSendWhatsAppMessage(sender, clarificationPrompt);
      return res.status(200).json({ status: "meta_conversation", sender });
    }

    // ===== FIX 2: Draft continuation handling =====
    // If draft exists and message looks like continuation, treat it as continuation
    const isContinuation = isContinuationMessage(incomingText);
    console.log(`[Route Debug] isContinuationMessage: ${isContinuation}`);

    if (existingDraft && isContinuation) {
      // Treat as edit/continuation context
      const replyText = `זה דווקא יכול להתחבר ממש טוב.

רעיון עדכון:
שם קצר: ${existingDraft.shortName}
קטגוריה: ${displayCategory(existingDraft.category)}
טון: ${displayTone(existingDraft.tone)}
עדיפות: ${displayPriority(existingDraft.priority)}
סיכום: ${existingDraft.summary}

זה בסדר? או תרצי לשנות משהו?`;
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "continuation_acknowledged", sender, draft: existingDraft });
    }

    // ===== FIX 5: Lightweight confidence gating =====
    // Check if message has minimum confidence to be treated as new idea
    const hasConfidence = hasIdeaConfidence(incomingText);
    console.log(`[Route Debug] hasIdeaConfidence: ${hasConfidence}`);

    if (!hasConfidence) {
      console.log(`[Route Debug] reached fallback: low_confidence_idea`);
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
    const replyText = `יש פה כיוון טוב.
שם קצר: ${draft.shortName}
קטגוריה: ${displayCategory(draft.category)}
טון: ${displayTone(draft.tone)}
עדיפות: ${displayPriority(draft.priority)}
סיכום: ${draft.summary}
זה בסדר? אשר כדי לשמור או אמור לי מה לשנות.`;
    await safeSendWhatsAppMessage(sender, replyText);
    return res.status(200).json({ status: "draft_created", sender, draft: draftSummary });

  } catch (error) {
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
