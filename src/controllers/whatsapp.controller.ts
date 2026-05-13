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
} from "../services/confirmation.service";
import {
  getExistingContentIds,
  generateContentId,
  saveContentIdea,
  createProductionTask,
  findProductionTaskByName,
  updateProductionStatus,
  getProductionStatusColumnIndex,
} from "../services/sheets.service";
import type { ProductionTaskMatch } from "../services/sheets.service";
import {
  isProductionStatusUpdate,
  detectStatusUpdate,
  getColumnName,
} from "../services/production-status.service";

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

          // Get existing IDs and generate new one based on category
          const existingIds = await getExistingContentIds(spreadsheetId);
          const contentId = generateContentId(pendingDraft.category, existingIds);
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
            const replyText = `הרעיון נשמר בהצלחה.\nID: ${contentId}`;
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
        const replyText = "לא מצאתי רעיון ממתין לאישור. מה הרעיון החדש שלך?";
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
          const replyText = `הבנתי. עדכנתי את הרעיון.

שם קצר: ${updatedDraft.shortName}
קטגוריה: ${displayCategory(updatedDraft.category)}
טון: ${displayTone(updatedDraft.tone)}
עדיפות: ${displayPriority(updatedDraft.priority)}
סיכום: ${updatedDraft.summary}

זה בסדר עכשיו?`;
          await safeSendWhatsAppMessage(sender, replyText);
          return res.status(200).json({ status: "draft_updated", sender, draft: updatedDraft });
        } else {
          const replyText = "לא הצלחתי להבין את העריכה. אנא נסח אותה ברור יותר או אשר את הרעיון הנוכחי.";
          await safeSendWhatsAppMessage(sender, replyText);
          return res.status(200).json({ status: "edit_not_understood", sender });
        }
      } else {
        const replyText = "אין רעיון ממתין לעריכה. מה הרעיון החדש שלך?";
        await safeSendWhatsAppMessage(sender, replyText);
        return res.status(200).json({ status: "no_pending_for_edit", sender });
      }
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
            const replyText = "לא מצאתי תוכן מתאים לעדכון. אנא נסי שוב עם שם ברור יותר.";
            await safeSendWhatsAppMessage(sender, replyText);
            console.log(`[Sprint 7 Workflow] No production task found for: ${statusUpdate.contentName}`);
            return res.status(200).json({
              status: "status_update_no_match",
              sender,
              contentName: statusUpdate.contentName,
            });
          }

          if ("ambiguous" in matchResult && matchResult.ambiguous) {
            const replyText = "מצאתי כמה תכנים דומים, איזה מהם התכוונת?\nנסי שנית עם שם ברור יותר.";
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
          const replyText = `עודכן בהצלחה - "${contentNameDisplay}" סומן כ: ${columnList}`;
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

    // Sprint 6: Check if there's already a pending confirmation
    const existingDraft = getPendingConfirmation(sender);
    if (existingDraft) {
      const replyText = "יש לך רעיון ממתין לאישור. אשר אותו קודם או שלח רעיון חדש.";
      await safeSendWhatsAppMessage(sender, replyText);
      return res.status(200).json({ status: "pending_exists", sender });
    }

    // Create new content draft
    const draft = await createContentDraft(incomingText);

    // Store pending confirmation
    const draftSummary = {
      ...draft,
      originalUserInput: incomingText,
    };
    storePendingConfirmation(sender, draftSummary);

    // Format response
    const replyText = `הרעיון שלך נשמע טוב.

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
