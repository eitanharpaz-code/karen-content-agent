/** Shared, conservative language handling. Pure functions; no model or writes. */
export const normalizeConversationText = (text: string): string => text.normalize('NFKC')
 .replace(/[\u0591-\u05C7]/g, '').replace(/["'׳״]/g, '').replace(/[.,!?;:–—־-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** A correction cue is meaningful only with an active draft. Dates and commands
 * are still routed by the controller before this helper. Never infer an edit from
 * a bare "no", or infer approval from "yes, but ...". */
export const isDraftCorrection = (text: string, draftText: string): boolean => {
 const raw = text.trim();
 const value = normalizeConversationText(text);
 if (/^(?:(?:שיהיה|שזה יהיה|תעשי את זה|תעשה את זה|אפשר|אפשר שיהיה)\s+)?(?:מצחיק יותר|קליל יותר|טבעי יותר|מרגש יותר|עם הומור|עם יותר הומור|פחות כבד)[.!]?\s*$/.test(value)) return true;
 if (/^(?:כן\s+)?(?:אבל|בעצם|התכוונתי|התכונתי|התכוונתי לומר|התכוונתי ל|זה לא|לא לזה|לא ככה|במקום|תשני|תשנה|שני|תשאירי|תורידי|תוסיפי|להוסיף|להוריד|תחליפי|החליפי|קצרי|תקצרי|יותר|פחות|וגם)\s/.test(value)) return true;
 if (/^(?:אפשר|אולי) (?:שזה יהיה |לעשות את זה |לעשות |שיהיה )?(?:יותר|פחות|בלי|להוסיף|להוריד|לקצר)/.test(value)) return true;
 if (/^(?:רילס?|פוסט|סטורי|קרוסלה) (?:במקום|ולא|לא) (?:רילס?|פוסט|סטורי|קרוסלה)$/.test(value)) return true;
 if (/^(?:לא\s+)?למה\s/.test(value)) return true;
 if (/^(?:כן\s+)?(?:רק|בלי)\s/.test(value)) return true;
 // "לא מחבקת, מקשקשת", "לא נגעלת אלא לא אוהבת חיבוקים".
 const replacement = raw.match(/^לא\s+(.+?)(?:\s*[,;]\s*|\s+אלא\s+)(.+)$/);
 if (replacement && normalizeConversationText(draftText).includes(normalizeConversationText(replacement[1]))) return true;
 const reverse = value.match(/^(.+?) (?:ולא|במקום) (.+)$/);
 if (reverse && normalizeConversationText(draftText).includes(reverse[2])) return true;
 return false;
};

const distanceOne = (a: string, b: string): boolean => {
 if (a===b) return true;
 if (Math.min(a.length,b.length)<4 || Math.abs(a.length-b.length)>1) return false;
 if(a.length===b.length) {
  const diff=[...a].map((c,i)=>c===b[i]?-1:i).filter(i=>i>=0);
  return diff.length===1 || (diff.length===2 && diff[1]===diff[0]+1 && a[diff[0]]===b[diff[1]] && a[diff[1]]===b[diff[0]]);
 }
 const longer=a.length>b.length?a:b, shorter=a.length>b.length?b:a;
 for(let i=0;i<longer.length;i++) if(longer.slice(0,i)+longer.slice(i+1)===shorter)return true;
 return false;
};

/** Return all plausible candidates, never silently pick the first ambiguity.
 * Typo matching requires two query words, with at least one exact anchor.
 * No fuzzy destructive action lookup: callers use only already offered lists. */
export const matchOfferedOptions = <T>(text: string, options: T[], name: (item:T)=>string): T[] => {
 let query=normalizeConversationText(text);
 if(/^\d+$/.test(query)) return options[Number(query)-1]?[options[Number(query)-1]]:[];
 const ordinal:Record<string,number>={'הראשון':0,'הראשונה':0,'השני':1,'השנייה':1,'השניה':1,'השלישי':2,'השלישית':2,'האחרון':options.length-1,'האחרונה':options.length-1};
 const choice=query.replace(/^(?:את|אני רוצה את|בואי נלך על)\s+/,'');
 if(choice in ordinal)return options[ordinal[choice]]?[options[ordinal[choice]]]:[];
 query=query.replace(/^(?:אני רוצה את|בואי נלך על|נלך על|תבחרי את|זה על|זה עם|הרעיון על|הרעיון של|את)\s+/,'');
 if(!query || ['כן','לא','זה','ההוא','רעיון','רילס','ריל','פוסט','סטורי'].includes(query))return [];
 const exact=options.filter(o=>normalizeConversationText(name(o))===query);
 if(exact.length)return exact;
 const words=query.split(' ');
 return options.filter(o=>{
  const tokens=normalizeConversationText(name(o)).split(' ');
  if(words.every(w=>tokens.includes(w)))return true;
  return words.length>=2 && words.some(w=>tokens.includes(w)) && words.every(w=>tokens.some(t=>distanceOne(w,t)));
 });
};
export const pickOfferedOption = <T>(text:string, options:T[], name:(item:T)=>string):T|undefined => {
 const matches=matchOfferedOptions(text,options,name);return matches.length===1?matches[0]:undefined;
};
