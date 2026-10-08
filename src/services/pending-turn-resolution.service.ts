import { isDraftCorrection, matchOfferedOptions } from './conversation-language.service';
import { askClaude, CLASSIFIER_MODEL } from './claude.service';
import { isConfirmationMessage, isRejectionMessage, isNewIdeaCommand, isEditRequest, parseEditRequest, classifyBridgeOfferAnswer, PendingQuestion } from './confirmation.service';
import type { DraftSummary } from '../types/content.types';
export type PendingTurnDecision = {kind:'answer_pending'|'edit_draft'|'new_idea'|'route_existing_command'}
 | {kind:'clarify';question:string};
export const resolvePendingTurn = async (text: string, question?: PendingQuestion, draft?: DraftSummary): Promise<PendingTurnDecision> => {
 if (isNewIdeaCommand(text)) return {kind:'new_idea'};
 if (draft && isDraftCorrection(text, `${draft.shortName} ${draft.summary} ${draft.originalUserInput}`)) return {kind:'edit_draft'};
 if (isConfirmationMessage(text) || isRejectionMessage(text)) return {kind:'answer_pending'};
 if (/^(עוד|הבא|תראי עוד|עוד רעיונות|\d{1,2})$/.test(text.trim())) return {kind:'answer_pending'};
 if (question?.questionType === 'gantt_upload_time' && /^(?:(?:בשעה\s*|ב[-־]?)?\d{1,4}(?::\d{2})?(?:\s+ביום\s+\S+)?|דלגי|דלג|אחר כך|לא עכשיו|בלי שעה|ללא שעה|אין שעה)[.!]?\s*$/.test(text.trim())) return {kind:'answer_pending'};
 const options = (question?.context?.options || []) as Array<{name?:string}|string>;
 if (Array.isArray(options) && matchOfferedOptions(text,options,o=>typeof o==='string'?o:o.name||'').length) return {kind:'answer_pending'};
 // Complete concept openings outrank loose field parsers; correction cues above
 // still handle "רילס במקום פוסט" with an active draft.
 if (/^(רעיון|סרטון|ריל(?:ס)?|פוסט|סטורי|טרנד)\s/.test(text.trim())) return {kind:'new_idea'};
 if (draft && parseEditRequest(text)) return {kind:'edit_draft'};
 const scheduleQuestion = /date|schedule|bridge|gantt_upload_time|confirm_gantt_write/.test(question?.questionType || '');
 if (scheduleQuestion && /^(?:הראשון|הראשונה|השני|השנייה|השניה|השלישי|השלישית|האחרון|האחרונה|(?:יום )?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)|היום|מחר|מחרתיים|בלי שעה|ללא שעה|אין שעה|בערב|בבוקר|בצהריים)[.!]?\s*$/.test(text.trim())) return {kind:'answer_pending'};

 if (['bridge_offer','trend_schedule'].includes(question?.questionType || '') && classifyBridgeOfferAnswer(text) !== 'unclear') return {kind:'answer_pending'};
 const questionMeaning: Record<string,string> = {
  gantt_upload_time:'באיזו שעה להעלות?', bridge_pick_date:'באיזה מהתאריכים שהוצעו לשבץ?', trend_schedule:'לקבוע תאריך לטרנד?', trend_awaiting_date:'איזה תאריך לקבוע לטרנד?', confirm_gantt_write:'לאשר את השיבוץ שהוצע?',
  offer_saved_list:'האם להציג את הרעיונות השמורים?', saved_list_pick:'איזה מהרעיונות שהוצגו לבחור?',
  bridge_offer:'האם לקבוע לרעיון שנשמר תאריך או להשאיר בלי תאריך?',
  draft_schedule_date:'איזה תאריך להציע בטיוטה לפני אישור שמירה?',
  schedule_date_clarification:'איזה תאריך תקין התכוונת לקבוע?',
 };
 const fallback: PendingTurnDecision = {kind:'clarify',question:draft?'התכוונת לשנות את הטיוטה או לפתוח רעיון חדש?':scheduleQuestion?'התכוונת לשיבוץ הרעיון הנוכחי או לרעיון חדש?':'זה רעיון חדש או בחירה מהרשימה?'};
 try {
  const result = (await askClaude(`סווגי הודעה ביחס להקשר. החזירי רק answer_pending, edit_draft, new_idea, route_existing_command או clarify.
שאלה פעילה: ${questionMeaning[question?.questionType || ''] || question?.questionType || 'הצגתי טיוטה ושאלתי אם לשמור אותה או לשנות אותה'}
הקשר הבחירה: ${JSON.stringify(question?.context || {})}
טיוטה: ${draft ? JSON.stringify({name:draft.shortName,summary:draft.summary,original:draft.originalUserInput}):'אין'}
הודעה: ${JSON.stringify(text)}
רעיון עצמאי חדש אינו בחירה ברשימה. ביקורת על פרט בטיוטה היא edit_draft. שאלה על גאנט או סטטוס היא route_existing_command. אין להשלים כוונה חסרה.
כללי שיחה: הטיוטה האחרונה היא ההקשר לתיקון קצר, גם בלי פועל הוראה. אל תדרשי ניסוח פורמלי. "לא מחבקת, מקשקשת", "בלי דוגמן", "כן אבל קצר יותר", "חברה שלי במקום אחותי", "מקשקשת ולא מחבקת", "אפשר יותר קליל?", "זה אמור להיות מצחיק" = edit_draft כאשר הן מתייחסות לטיוטה.
"לא" בלבד = answer_pending. "רילס במקום פוסט" = edit_draft כשיש טיוטה; "רילס על הטיול שלי" = new_idea. "כמה רעיונות שמורים?" = route_existing_command.
תשובה במספר, בשם חלקי, בסדר מילים אחר או בשגיאת כתיב קלה מתוך האפשרויות = answer_pending, לא רעיון חדש. כשיש כמה מועמדים אין לבחור אחד בעצמך.
אם יש טיוטה, העדיפי עריכה לתוספת או תיקון שקשורים אליה. נושא עצמאי אחר = new_idea. clarify רק כשבאמת אי אפשר להכריע, לא בגלל קיצור או ניסוח יומיומי.`,{model:CLASSIFIER_MODEL,withPersona:false})).trim().replace(/^```(?:\w+)?\s*|\s*```$/g,'').replace(/^["']|["']$/g,'').trim();
  if (['answer_pending','new_idea','route_existing_command'].includes(result)) return {kind:result as 'answer_pending'|'new_idea'|'route_existing_command'};
  if (result==='edit_draft' && draft) return {kind:'edit_draft'};
  return fallback;
 } catch { return fallback; }
};
