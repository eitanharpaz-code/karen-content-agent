import { Request, Response } from "express";
import { sendWhatsAppMessage } from "../services/whatsapp.service";
import { createContentDraft } from "../services/content.service";
import {
  isConfirmationMessage,
  isEditRequest,
  parseEditRequest,
  applyEditToDraft,
  displayPriority,
  displayTone,
  displayCategory,
  storePendingConfirmation,
  getPendingConfirmation,
  clearPendingConfirmation,
  isResetRequest,
  isNewIdeaCommand,
  getNewIdeaText,
  isTrendCommand,
  getTrendText,
} from "../services/confirmation.service";
import {
  getExistingContentIds,
  generateContentId,
  saveContentIdea,
  createProductionTask,
  findProductionTaskByName,
  updateProductionStatus,
  getProductionStatusColumnIndex,
  getTasksMissingEdit,
  getTasksMissingCover,
  getTasksMissingCopy,
  getTasksNotUploaded,
  getTasksEditedAndNotUploaded,
  getStuckTasks,
  searchTasksByKeyword,
  getAllProductionTasksWithPriority,
} from "../services/sheets.service";
import type { ProductionTaskMatch } from "../services/sheets.service";
import {
  isProductionStatusUpdate,
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

          // STEP 1: Save to בנק רעיונות (Content Library) - PRIMARY SHEET
          try {
            await saveContentIdea(
              spreadsheetId,
              contentId,
              pendingDraft.originalUserInput,
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

          // STEP 2: Create production task in משימות הפקה (DERIVED SHEET)
          let taskCreationFailed = false;
          try {
            await createProductionTask(
              spreadsheetId,
              contentId,
              pendingDraft.shortName
            );
            console.log(`[Sprint 6 Workflow] ✅ DERIVED SHEET (משימות הפקה) write succeeded`);
          } catch (taskError) {
            const errorMessage = taskError instanceof Error ? taskError.message : "Unknown error";
            console.error(`[Sprint 6 Workflow] ⚠️  DERIVED SHEET (משימות הפקה) write FAILED: ${errorMessage}`);
            taskCreationFailed = true;
            // Continue - content was saved but task creation failed
          }

          // STEP 3: Send WhatsApp confirmation
          if (taskCreationFailed) {
            const replyText = `הרעיון נשמר בהצלחה.\nID: ${contentId}\n\nהערה: קרתה שגיאה בטיפול היומי אך הרעיון שמור.`;
            await safeSendWhatsAppMessage(sender, replyText);
            console.log(`[Sprint 6 Workflow] ⚠️  WhatsApp confirmation sent (with warning about task creation failure)`);
          } else {
           const replyText = `מעולה, שמרתי את הרעיון.\nID: ${contentId}`;
            await safeSendWhatsAppMessage(sender, replyText);
            console.log(`[Sprint 6 Workflow] ✅ WhatsApp confirmation sent`);
          }

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
    if (isEditRequest(incomingText)) {
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

    const visibilityIntent = detectVisibilityIntent(incomingText);
    const questionLikeMessage = isQuestionLikeMessage(incomingText);

    // Sprint 10: Core rule - ANY visibilityIntent is read-only and must be handled before production updates
    if (visibilityIntent) {
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
          case "edited_not_uploaded":
            tasks = await getTasksEditedAndNotUploaded(spreadsheetId);
            break;
          case "missing_edit":
            tasks = await getTasksMissingEdit(spreadsheetId);
            break;
          case "missing_cover":
            tasks = await getTasksMissingCover(spreadsheetId);
            break;
          case "missing_copy":
            tasks = await getTasksMissingCopy(spreadsheetId);
            break;
          case "not_uploaded":
            tasks = await getTasksNotUploaded(spreadsheetId);
            break;
          case "stuck_workflow":
            tasks = await getStuckTasks(spreadsheetId);
            break;
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
            const allTasks = await getAllProductionTasksWithPriority(spreadsheetId);
            const highNotUploaded = allTasks.filter((t) => t.priority === "גבוה" && t.uploaded !== "כן" && !t.isTrend);
            const stuck = allTasks.filter((t) => t.filmed === "כן" && t.edited !== "כן" && !t.isTrend);
            const trends = allTasks.filter((t) => t.isTrend && t.uploaded !== "כן");
            const thisWeek = allTasks.filter((t) => t.deadlineDate !== null && isThisWeek(t.deadline) && t.uploaded !== "כן");
            const replyText = formatWhatsImportantResponse(highNotUploaded, stuck, trends, thisWeek);
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

    // Handle unsupported question-like messages (after visibilityIntent is ruled out)
    if (questionLikeMessage) {
      const clarificationPrompt = generateClarificationPrompt(!!getPendingConfirmation(sender));
      await safeSendWhatsAppMessage(sender, clarificationPrompt);
      return res.status(200).json({ status: "question_clarification", sender });
    }

    // Sprint 7: Check if this is a production status update
    if (isProductionStatusUpdate(incomingText)) {
      const statusUpdate = detectStatusUpdate(incomingText);
      if (statusUpdate) {
        try {
          const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
          if (!spreadsheetId) {
            throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
          }

          console.log(`\n[Sprint 7 Workflow] Status update detected: ${statusUpdate.statusTypes.join(", ")}`);
          console.log(`[Sprint 7 Workflow] Looking for content: "${statusUpdate.contentName}"`);

          // Find matching production task
          const matchResult = await findProductionTaskByName(spreadsheetId, statusUpdate.contentName);

          if (!matchResult) {
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
          const statusUpdates = statusUpdate.statusTypes.map((statusType) => {
            const columnName = getColumnName(statusType);
            const columnIndex = getProductionStatusColumnIndex(columnName);
            if (!columnIndex) {
              throw new Error(`Invalid column name: ${columnName}`);
            }
            return { statusType, columnName, columnIndex };
          });

          const uniqueUpdates = Array.from(
            new Map(statusUpdates.map((update) => [update.columnIndex, update])).values()
          );

          console.log(`[Sprint 7 Workflow] Found match: "${exactMatch.row[1]}" at row ${exactMatch.rowIndex}`);
          console.log(`[Sprint 7 Workflow] Updating status columns: ${uniqueUpdates.map((update) => update.columnName).join(", ")}`);

          for (const update of uniqueUpdates) {
            await updateProductionStatus(spreadsheetId, exactMatch.rowIndex, update.columnIndex);
          }

          const contentNameDisplay = exactMatch.row[1] || statusUpdate.contentName;
          const columnList = uniqueUpdates.map((update) => update.columnName).join(", ");
          const replyText = `מעולה, עדכנתי את זה.\n"${contentNameDisplay}" סומן כ: ${columnList}`;
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

    // Sprint 10: Check if this is a visibility query (read-only)
    if (visibilityIntent) {
      try {
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
        if (!spreadsheetId) {
          throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
        }

        console.log(`[Sprint 10] Visibility query detected: ${visibilityIntent}`);

        let tasks: any[] = [];
        switch (visibilityIntent) {
          case "edited_not_uploaded":
            tasks = await getTasksEditedAndNotUploaded(spreadsheetId);
            break;
          case "missing_edit":
            tasks = await getTasksMissingEdit(spreadsheetId);
            break;
          case "missing_cover":
            tasks = await getTasksMissingCover(spreadsheetId);
            break;
          case "missing_copy":
            tasks = await getTasksMissingCopy(spreadsheetId);
            break;
          case "not_uploaded":
            tasks = await getTasksNotUploaded(spreadsheetId);
            break;
          case "stuck_workflow":
            tasks = await getStuckTasks(spreadsheetId);
            break;
          case "category_search": {
            const keyword = extractSearchKeyword(incomingText);
            if (!keyword) {
              tasks = [];
            } else {
              tasks = await searchTasksByKeyword(spreadsheetId, keyword);
            }
            break;
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
    // If message looks like a visibility question but intent detection was unclear,
    // return a graceful fallback instead of progressing to draft creation.
    if (!visibilityIntent && isLikelyVisibilityQuery(incomingText)) {
     const replyText = "לא הצלחתי להבין על איזה תוכן רצית לבדוק סטטוס.";
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "visibility_unclear", sender });
    }

    // ===== FIX 3: Meta-conversation detection =====
    // Don't create content from meta-conversation messages
    const existingDraft = getPendingConfirmation(sender);
    if (isMetaConversation(incomingText)) {
      const clarificationPrompt = generateClarificationPrompt(!!existingDraft);
      await safeSendWhatsAppMessage(sender, clarificationPrompt);
      return res.status(200).json({ status: "meta_conversation", sender });
    }

    // ===== FIX 2: Draft continuation handling =====
    // If draft exists and message looks like continuation, treat it as continuation
    if (existingDraft && isContinuationMessage(incomingText)) {
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
    if (!hasIdeaConfidence(incomingText)) {
      const clarificationPrompt = generateClarificationPrompt(!!existingDraft);
      await safeSendWhatsAppMessage(sender, clarificationPrompt);
      return res.status(200).json({ status: "low_confidence_idea", sender });
    }

    // Create new content draft
    // FIX 1: Clean conversational prefixes before creating draft
    const cleanedUserInput = cleanIdeaPrefix(incomingText);
    const draft = await createContentDraft(cleanedUserInput);

    // Store pending confirmation with cleaned input
    const draftSummary = {
      ...draft,
      originalUserInput: cleanedUserInput,
    };
    storePendingConfirmation(sender, draftSummary);

    // Format response
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
