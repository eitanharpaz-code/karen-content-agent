import { normalizeUserDateInput } from '../utils/date-utils';
import type { DraftSummary } from '../types/content.types';

export type DateReply = { kind: 'valid' | 'past_needs_clarification'; date: string; explicitYear: boolean }
 | { kind: 'invalid' | 'negated' | 'absent' | 'ambiguous' };
export const israelToday = (now = new Date()): string => new Intl.DateTimeFormat('en-CA', {
 timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
const dateKey = (date: string): string => date.split('/').reverse().join('-');
export const parseSchedulingReply = (text: string, now = new Date()): DateReply => {
 const matches = [...text.matchAll(/(?<!\d)(\d{1,2}[./-]\d{1,2}(?:[./-](?:\d{4}|\d{2}))?)(?!\d)/g)];
 if (!matches.length) return {kind:'absent'};
 const positive = matches.filter(m => !/(?:לא|אל)\s+(?:(?:תשבצי|שבצי|לשבץ|לקבוע|תקבעי|בתאריך|את זה|אותו|אותה)\s+)*(?:ב|ל)?\s*[-־]?\s*$/.test(text.slice(Math.max(0, m.index! - 80), m.index)));
 if (!positive.length) return {kind:'negated'};
 if (positive.length !== 1) return {kind:'ambiguous'};
 const value = positive[0][1];
 const date = normalizeUserDateInput(value, Number(israelToday(now).slice(0,4)));
 if (!date) return {kind:'invalid'};
 return {kind: dateKey(date) < israelToday(now) ? 'past_needs_clarification':'valid', date,
  explicitYear: value.split(/[./-]/).length === 3};
};
export const extractReplyTime = (text: string): string | undefined => {
 const m = text.match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
 return m ? `${m[1].padStart(2,'0')}:${m[2]}` : undefined;
};
export const requestedDraftAction = (text: string): DraftSummary['requestedAction'] => {
 if (/בלי תאריך|ללא תאריך|לא לשבץ/.test(text)) return {kind:'keep'};
 if (!/לשבץ|שבצי|תשבצי|לקבוע|בגאנט|יעלה|להעלות|לעלות/.test(text)) return undefined;
 const result = parseSchedulingReply(text);
 if (result.kind === 'negated' || result.kind === 'absent') return undefined;
 return {kind:'schedule', ...(('date' in result) ? {date:result.date}:{}),
  time: extractReplyTime(text), rawDate:text};
};
export const dateClarification = (result: DateReply): string => result.kind === 'past_needs_clarification'
 ? `${result.date} כבר עבר. לאיזה תאריך התכוונת? אפשר גם לכתוב "כן, לתאריך שעבר" אם זו הכוונה.`
 : result.kind === 'negated' ? 'לא אשבץ בתאריך הזה. לאיזה תאריך התכוונת?'
 : result.kind === 'ambiguous' ? 'לאיזה מהתאריכים לשבץ?' : 'התאריך לא תקין. איזה תאריך לקבוע?';
