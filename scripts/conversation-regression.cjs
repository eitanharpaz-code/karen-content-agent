// Isolated controller replay. No SDK client or external request can be loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const root = process.cwd();
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'karen-conversation-'));
process.env.TS_NODE_PROJECT = path.join(root, 'tsconfig.json');
process.chdir(sandbox);
process.env.GOOGLE_SHEETS_ID = 'isolated-fixture';
require(path.join(root, 'node_modules/ts-node/register/transpile-only'));
let clock = Date.parse('2026-10-07T09:00:00Z');
const NativeDate = Date;
global.Date = class extends NativeDate { constructor(...args){ super(...(args.length?args:[clock])); } static now(){return clock;} };
const calls = []; const replies = []; const overrides = {};
const draft = text => ({ shortName: 'רעיון לבדיקה', summary: text, category: 'כללי', tone: 'מצחיק', priority: 'בינוני', contentType: 'ריל', originalUserInput: text });
const sheets = new Proxy({
 removePunctuationForMatching: s => s.replace(/["'׳״.,!?]/g, '').trim(),
 GanttDuplicateError: class extends Error {},
}, { get(target, name) {
 if (name in target) return target[name];
 return async (...args) => {
  calls.push({name, args});
  if (overrides[name]) return overrides[name](...args);
  const values = { findSimilarContentIdea:null, getExistingContentIds:[], generateContentId:'GEN900',
   isGanttDateTaken:{taken:false}, approveContentForProduction:{contentId:'GEN900'},
   findGanttEntryByContentId:null, addRowToGantt:'13/10/2026',
   evaluateMonthFullForReel:{isMonthFull:false,nextMonthDates:[],shiftableReels:[]},
   findAvailableDatesInMonth:['14/10/2026'],findSmartGanttDate:['14/10/2026'],getOpenContentIdeas:[],
   getGanttByDateRange:[],getReelsBlockingDates:[],getContentNamesWithSummaries:[] };
  if (name in values) return values[name];
  if (/^(save|update|sort|archive|restore)/.test(name)) return undefined;
  throw new Error('Unconfigured Sheets mock: '+String(name));
 };
}});
const oldLoad = Module._load;
Module._load = function(id, parent, main) {
 if (/(?:^|\/)fuzzy-match\.service$/.test(id)) return {fetchArchivableCandidates:async()=>[],findBestFuzzyIdeaMatch:async()=>null};
 if (/googleapis|@anthropic-ai|^twilio$/.test(id)) throw new Error('External SDK forbidden: '+id);
 if (/(?:^|\/)sheets\.service$/.test(id)) return sheets;
 if (/(?:^|\/)whatsapp\.service$/.test(id)) return {sendWhatsAppMessage:async(to,text)=>{replies.push(text);return {sid:'SMout'};}};
 if (/(?:^|\/)daily-brief\.service$/.test(id)) return {markInteractionToday:()=>{}};
 if (/(?:^|\/)claude\.service$/.test(id)) return { CLASSIFIER_MODEL:'mock',CREATIVE_MODEL:'mock',
  askClaude:async(prompt)=> overrides.classifier ? overrides.classifier(prompt) : 'new_idea', askClaudeForMatching:async()=>null };
 if (/(?:^|\/)content\.service$/.test(id)) return {
  createContentDraft:async text=>{if(overrides.create) return overrides.create(text); return draft(text);},
  askClaudeForEdit:async(d,text)=>{ if(overrides.edit) return overrides.edit(d,text); return {...d,summary:d.summary.replace(/ בחתונה/g,''),shortName:'סדרת סטייל'}; }
 };
 return oldLoad.apply(this,arguments);
};
const conf = require(path.join(root,'src/services/confirmation.service.ts'));
const persistence = require(path.join(root,'src/services/persistence.service.ts'));
const {handleWhatsAppWebhook} = require(path.join(root,'src/controllers/whatsapp.controller.ts'));
let n=0;
async function send(text,user='fixture',extra={}) {
 calls.length=0; replies.length=0;
 const response = {code:200,body:null,headers:{},status(c){this.code=c;this.statusCode=c;return this;},
  json(b){this.body=b;return this;},type(t){this.headers.type=t;return this;},send(b){this.body=b;return this;}};
 await handleWhatsAppWebhook({body:{From:user,Body:text,MessageSid:'SMtest'+(++n),...extra}},response);
 return response;
}
const writes=()=>calls.filter(c=>/^(save|addRow|update|approve|archive)/.test(c.name));
const originalClock = clock;
const tests=[]; const test=(name,fn)=>tests.push([name,fn]);
const idea='כל מיני דברים שעוברים לי בראש כשמסבירים לי דברים חשובים - רואים אותי מקשיבה וחושבת ושומעים קריינות של דברים רנדומלים';
test('new idea escapes list offer',async()=>{
 conf.storePendingQuestion('fixture',{questionType:'offer_saved_list',context:{}});
 await send(idea); assert.ok(conf.getPendingConfirmation('fixture')); assert.equal(writes().length,0);
 assert.ok(replies[0].includes(idea));
});
test('bare past date asks instead of writing',async()=>{
 conf.clearPendingConfirmation('fixture'); conf.storePendingQuestion('fixture',{questionType:'bridge_offer',context:{contentName:'ביזנס',askedIntentOnly:true,availableDates:['14/10/2026']}});
 await send('14.7'); assert.equal(writes().length,0); assert.match(replies[0],/עבר/);
});
test('style correction uses draft context',async()=>{
 conf.clearPendingQuestion('fixture');conf.storePendingConfirmation('fixture',draft('סדרת סטייל בחתונה'));
 await send('לא למה חתונה?');assert.ok(!conf.getPendingConfirmation('fixture').summary.includes('חתונה')); assert.equal(writes().length,0);
});

const dates = require(path.join(root,'src/services/scheduling-reply.service.ts'));
const bridge = () => conf.storePendingQuestion('fixture',{questionType:'bridge_offer',context:{contentName:'ביזנס',askedIntentOnly:true,availableDates:['14/10/2026']}});
test('new idea escapes list selection, implicit and explicit',async()=>{
 for(const text of [idea,'רעיון חדש: '+idea]){
 conf.clearPendingConfirmation('fixture');conf.storePendingQuestion('fixture',{questionType:'saved_list_pick',context:{options:[{contentId:'GEN1',name:'בייבי מכבי'}]}});
 await send(text);assert.match(conf.getPendingConfirmation('fixture').summary,/רנדומלים/);assert.equal(writes().length,0);
 }
});
test('declining date ends with no gap read or next question',async()=>{
 bridge();await send('בלי תאריך');assert.equal(conf.getPendingQuestion('fixture'),undefined);assert.equal(writes().length,0);
 assert.ok(!calls.some(c=>c.name==='getGanttByDateRange'));assert.equal(replies.length,1);assert.ok(!replies[0].includes('?'));
});
test('new draft parks old, survives restart and restores',async()=>{
 conf.storePendingConfirmation('fixture',draft('טיוטה א'));await send('רעיון חדש: סרטון ב');
 assert.equal(conf.getSuspendedDrafts('fixture').length,1);persistence.__reloadFromDiskForTests();
 await send('חזרי לטיוטה הקודמת');assert.equal(conf.getPendingConfirmation('fixture').summary,'טיוטה א');
 assert.equal(conf.getSuspendedDrafts('fixture').length,1);assert.equal(writes().length,0);
});
test('creation failure leaves previous draft and question intact',async()=>{
 conf.storePendingConfirmation('fixture',draft('ישן'));conf.storePendingQuestion('fixture',{questionType:'offer_saved_list'});
 overrides.create=()=>{throw Error('model failure');};await send('רעיון חדש: סרטון');delete overrides.create;
 assert.equal(conf.getPendingConfirmation('fixture').summary,'ישן');assert.equal(conf.getPendingQuestion('fixture').questionType,'offer_saved_list');
});
test('TTL parks draft, expires question and survives legacy state',async()=>{
 conf.storePendingConfirmation('fixture',draft('ישן'));conf.storePendingQuestion('fixture',{questionType:'offer_saved_list'});
 clock+=conf.PENDING_STATE_TTL_MS+1;assert.equal(conf.getPendingConfirmation('fixture'),undefined);assert.equal(conf.getPendingQuestion('fixture'),undefined);
 assert.equal(conf.getSuspendedDrafts('fixture')[0].draft.summary,'ישן');persistence.__reloadFromDiskForTests();assert.equal(conf.getSuspendedDrafts('fixture').length,1);
 persistence.setValue('pendingConfirmations','fixture',draft('legacy'));assert.equal(conf.getPendingConfirmation('fixture').summary,'legacy');
});
test('classification failure preserves active context',async()=>{
 conf.storePendingConfirmation('fixture',draft('ישן'));overrides.classifier=()=>{throw Error('offline');};await send('משהו אחר אולי');
 assert.equal(conf.getPendingConfirmation('fixture').summary,'ישן');assert.equal(writes().length,0);assert.match(replies[0],/טיוטה/);
});
test('clarification remembers original message',async()=>{
 conf.storePendingConfirmation('fixture',draft('ישן'));overrides.classifier=()=> 'clarify';await send('נושא שני');delete overrides.classifier;
 await send('רעיון חדש');assert.equal(conf.getPendingConfirmation('fixture').summary,'נושא שני');
});
test('preview presents format naturally without a technical field',async()=>{
 await send('רעיון חדש: רילס שרואים אותי מקשיבה');assert.ok(replies[0].includes('ככה הייתי שומרת את הרילס:'));assert.ok(!replies[0].includes('סוג:'));assert.ok(!replies[0].includes('רילס על רילס'));assert.match(replies[0],/לשמור ככה\?$/);
});
test('date forms are equivalent, past needs explicit acknowledgment',async()=>{
 for(const text of ['14.7','ב14.7','ב־14.7','14/7']){bridge();await send(text);assert.equal(writes().length,0);assert.match(replies[0],/עבר/);}
 await send('כן, לתאריך שעבר');assert.equal(calls.filter(c=>c.name==='addRowToGantt').length,1);assert.equal(calls.find(c=>c.name==='addRowToGantt').args[3],'14/07/2026');
});
test('invalid, negated and ambiguous dates never write',async()=>{
 for(const text of ['31.11','לא ב14.7','14.10 או 15.10']){bridge();await send(text);assert.equal(writes().length,0);assert.equal(conf.getPendingQuestion('fixture').questionType,'schedule_date_clarification');}
});
test('future date plus time writes once and does not ask time again',async()=>{
 bridge();await send('ב14.10 בשעה 18:00');assert.equal(calls.filter(c=>c.name==='addRowToGantt').length,1);
 assert.deepEqual(calls.find(c=>c.name==='updateGanttUploadTime').args,['isolated-fixture','ביזנס','14/10/2026','18:00']);
 assert.equal(conf.getPendingQuestion('fixture'),undefined);assert.ok(!replies[0].includes('באיזו שעה'));
});
test('positive alternative to negated date honored',async()=>{
 bridge();await send('לא ב14.7, ב15.10');assert.equal(calls.find(c=>c.name==='addRowToGantt').args[3],'15/10/2026');
});
test('date clarification accepts replacement without looping',async()=>{
 bridge();await send('לא ב14.7');await send('15.10');assert.equal(calls.find(c=>c.name==='addRowToGantt').args[3],'15/10/2026');
});
test('combined new idea save and schedule requires explicit preview scope',async()=>{
 await send('רעיון חדש: סרטון על קפה, לשבץ בגאנט ב14.10 בשעה 18:00');assert.equal(writes().length,0);assert.match(replies[0],/להעביר להפקה ולשבץ/);
 await send('כן');assert.equal(calls.filter(c=>c.name==='saveContentIdea').length,1);assert.equal(calls.filter(c=>c.name==='addRowToGantt').length,1);
 assert.equal(conf.getPendingConfirmation('fixture'),undefined);assert.equal(conf.getPendingQuestion('fixture'),undefined);
});
test('keep preference supplied with idea skips scheduling offer',async()=>{
 await send('רעיון חדש: סרטון על קפה, לשמור בלי תאריך');await send('כן');assert.equal(calls.filter(c=>c.name==='saveContentIdea').length,1);
 assert.equal(conf.getPendingQuestion('fixture'),undefined);assert.ok(!replies[0].includes('?'));assert.ok(!calls.some(c=>c.name==='findAvailableDatesInMonth'));
});
test('save-only trend approval never writes gantt',async()=>{
 await send('טרנד אמהות ובעלים');await send('כן');assert.equal(calls.filter(c=>c.name==='saveContentIdea').length,1);assert.equal(calls.filter(c=>c.name==='addRowToGantt').length,0);
});
test('save failure preserves draft for retry',async()=>{
 conf.storePendingConfirmation('fixture',draft('קפה'));overrides.saveContentIdea=()=>{throw Error('write failed');};await send('כן');assert.ok(conf.getPendingConfirmation('fixture'));
});
test('schedule failure after save cannot resave on yes',async()=>{
 await send('רעיון חדש: סרטון קפה לשבץ ב14.10');overrides.addRowToGantt=()=>{throw Error('write failed');};await send('כן');assert.equal(conf.getPendingConfirmation('fixture'),undefined);
 assert.match(replies[0],/נשמר.*השיבוץ לא הושלם/);delete overrides.addRowToGantt;await send('כן');assert.equal(calls.filter(c=>c.name==='saveContentIdea').length,0);
});
test('collision asks before replacing',async()=>{
 bridge();overrides.isGanttDateTaken=()=>({taken:true,existingName:'אחר',existingContentId:'GEN2'});await send('14.10');assert.equal(calls.filter(c=>c.name==='addRowToGantt').length,0);
 assert.equal(conf.getPendingQuestion('fixture').questionType,'gantt_collision');
});
test('duplicate gantt content is not inserted',async()=>{
 bridge();overrides.findGanttEntryByContentId=()=>({name:'ביזנס',date:'14/10/2026',contentId:'GEN900'});await send('14.10');assert.equal(calls.filter(c=>c.name==='addRowToGantt').length,0);
});
test('duplicate idea guard preserves old draft',async()=>{
 conf.storePendingConfirmation('fixture',draft('ישן'));overrides.findSimilarContentIdea=()=>({idea:'דומה'});await send('רעיון חדש: סרטון');assert.equal(conf.getPendingConfirmation('fixture').summary,'ישן');
 assert.equal(conf.getPendingQuestion('fixture').questionType,'confirm_duplicate');delete overrides.findSimilarContentIdea;await send('כן');assert.equal(conf.getSuspendedDrafts('fixture').length,1);
});
test('list acceptance and rejection remain local',async()=>{
 conf.storePendingQuestion('fixture',{questionType:'offer_saved_list'});overrides.getOpenContentIdeas=()=>[{contentId:'GEN1',idea:'בייבי מכבי',summary:'תיאור'}];await send('כן');assert.equal(conf.getPendingQuestion('fixture').questionType,'saved_list_pick');
 await send('לא');assert.equal(conf.getPendingQuestion('fixture'),undefined);assert.equal(writes().length,0);
});
test('unknown list reply never silently becomes yes',async()=>{
 conf.storePendingQuestion('fixture',{questionType:'offer_saved_list'});overrides.classifier=()=> 'answer_pending';await send('אולי');assert.ok(!calls.some(c=>c.name==='getOpenContentIdeas'));assert.match(replies[0],/להציג/);
});
test('date parser uses Jerusalem date and validates leap days',async()=>{
 assert.equal(dates.parseSchedulingReply('1.1',new NativeDate('2026-12-31T22:30:00Z')).date,'01/01/2027');
 assert.equal(dates.parseSchedulingReply('29.2.2027').kind,'invalid');assert.equal(dates.parseSchedulingReply('29.2.2028').kind,'valid');
});
test('webhook responds with valid empty XML on success',async()=>{
 const response=await send('ביטול');assert.equal(response.code,200);assert.equal(response.body,'<Response/>');assert.equal(response.headers.type,'text/xml');
});
test('webhook keeps invalid-input HTTP failure',async()=>{
 const response=await send('');assert.equal(response.code,400);assert.ok(response.body.error);
});
test('overlapping traces keep message and model correlation',async()=>{
 const trace = require(path.join(root,'src/services/routing-trace.service.ts'));
 const logs=[];const old=console.log;console.log=(...args)=>logs.push(args.join(' '));
 try{await Promise.all(['A','B'].map((sid,i)=>trace.withRoutingTrace('user','private',sid,async()=>{
   await new Promise(resolve=>setTimeout(resolve,i?1:15));trace.recordClaudeCall('model-'+sid,false);trace.finishRoutingTrace('done');
 })));}finally{console.log=old;}
 const results=logs.map(line=>JSON.parse(line.slice('[Routing Trace] '.length)));
 assert.equal(results.length,2);for(const r of results){assert.deepEqual(r.models,['model-'+r.messageSid]);assert.ok(!JSON.stringify(r).includes('private'));}
});

test('implicit fresh concept creates a draft',async()=>{
 await send('סרטון על סדר וניקיון בבית');assert.equal(conf.getPendingConfirmation('fixture').summary,'סרטון על סדר וניקיון בבית');assert.equal(writes().length,0);
});
test('story date inside new concept is not a scheduling command',async()=>{
 bridge();await send('רעיון חדש: סרטון על מה שקרה ב14.7');assert.ok(conf.getPendingConfirmation('fixture'));assert.equal(conf.getPendingQuestion('fixture'),undefined);assert.equal(writes().length,0);
});
test('historical combined draft asks once then permits explicit confirmation',async()=>{
 await send('רעיון חדש: סרטון קפה לשבץ ב14.7');assert.equal(writes().length,0);assert.equal(conf.getPendingQuestion('fixture').questionType,'draft_schedule_date');
 await send('כן, לתאריך שעבר');assert.equal(writes().length,0);assert.match(replies[0],/להעביר להפקה ולשבץ/);
 await send('כן');assert.equal(calls.filter(c=>c.name==='addRowToGantt').length,1);
});
test('invalid draft schedule can be corrected without repeating the idea',async()=>{
 await send('רעיון חדש: סרטון קפה לשבץ ב31.11');assert.equal(writes().length,0);await send('14.10 בשעה 18:00');
 assert.equal(conf.getPendingConfirmation('fixture').requestedAction.date,'14/10/2026');await send('כן');assert.equal(conf.getPendingQuestion('fixture'),undefined);
});
test('ordinal selection of stale offered date asks before approval',async()=>{
 conf.storePendingQuestion('fixture',{questionType:'bridge_pick_date',context:{contentName:'ביזנס',dates:['14/07/2026']}});
 await send('הראשון');assert.equal(writes().length,0);assert.match(replies[0],/עבר/);await send('14.10');assert.equal(calls.filter(c=>c.name==='addRowToGantt').length,1);
});
test('date and time in older confirmed scheduling flow are consumed together',async()=>{
 conf.storePendingQuestion('fixture',{questionType:'confirm_gantt_write',context:{contentId:'GEN900',contentName:'קפה',date:'14/10/2026',dayName:'רביעי'}});
 await send('ב15.10 בשעה 18:00');assert.equal(calls.filter(c=>c.name==='updateGanttUploadTime').length,1);assert.equal(conf.getPendingQuestion('fixture'),undefined);assert.ok(!replies[0].includes('באיזו שעה'));
});
test('declining trend scheduling leaves no new pending offer',async()=>{
 conf.storePendingQuestion('fixture',{questionType:'trend_schedule',context:{contentId:'TRD1',contentName:'טרנד',options:['14/10/2026']}});
 await send('לא');assert.equal(conf.getPendingQuestion('fixture'),undefined);assert.equal(replies.length,1);assert.ok(!replies[0].includes('?'));
});
test('ambiguous list name never picks the first item',async()=>{
 conf.storePendingQuestion('fixture',{questionType:'saved_list_pick',context:{options:[{contentId:'GEN1',name:'קפה בבית'},{contentId:'GEN2',name:'קפה בעבודה'}]}});
 await send('קפה');assert.equal(writes().length,0);assert.equal(conf.getPendingQuestion('fixture').questionType,'saved_list_pick');
});
test('numeric list selection works without classifying it as a new idea',async()=>{
 conf.storePendingQuestion('fixture',{questionType:'saved_list_pick',context:{options:[{contentId:'GEN1',name:'קפה בבית'}]}});
 await send('1');assert.ok(!conf.getPendingConfirmation('fixture'));assert.ok(calls.some(c=>c.name==='findSmartGanttDate'));assert.equal(writes().length,0);
});
test('pagination remains a list action',async()=>{
 conf.storePendingQuestion('fixture',{questionType:'saved_list_pick',context:{options:[{contentId:'GEN1',name:'ישן'}],offset:1}});
 overrides.getOpenContentIdeas=()=>[{contentId:'GEN1',idea:'ישן'},{contentId:'GEN2',idea:'חדש'}];await send('עוד');assert.equal(conf.getPendingQuestion('fixture').context.options[0].name,'חדש');assert.equal(writes().length,0);
});
test('state transition rolls back in memory on disk error',async()=>{
 conf.storePendingConfirmation('fixture',draft('ישן'));const rename=fs.renameSync;fs.renameSync=()=>{throw Error('disk failure');};
 try{assert.throws(()=>conf.activateNewDraft('fixture',draft('חדש')),/persist/);}finally{fs.renameSync=rename;}
 assert.equal(conf.getPendingConfirmation('fixture').summary,'ישן');assert.equal(conf.getSuspendedDrafts('fixture').length,0);
});
test('real content prompts preserve present request and original edit context',async()=>{
 const content=oldLoad.call(Module,path.join(root,'src/services/content.service.ts'),module,false);
 let prompt;
 overrides.classifier=p=>{prompt=p;return 'Short Name: סטייל\nCategory: כללי\nTone: מצחיק\nPriority: בינוני\nContent Type: ריל\nSummary: סדרת סטייל';};
 await content.createContentDraft('סדרת סטייל');assert.match(prompt,/אין להוסיף הקשר של חתונה/);assert.match(prompt,/הוראות שמירה ושיבוץ אינן חלק/);
 await content.askClaudeForEdit({...draft('סטייל בחתונה'),originalUserInput:'סדרת סטייל'},'לא למה חתונה?');assert.match(prompt,/הבקשה המקורית של קרן: סדרת סטייל/);assert.match(prompt,/להסיר הקשר/);
});
test('changing draft date updates approval proposal without creating a new idea',async()=>{
 await send('רעיון חדש: סרטון קפה לשבץ ב14.10');await send('15.10 בשעה 18:00');
 assert.equal(conf.getPendingConfirmation('fixture').requestedAction.date,'15/10/2026');assert.equal(conf.getSuspendedDrafts('fixture').length,0);assert.equal(writes().length,0);
});
test('explicit save without date after preview does not repeat confirmation',async()=>{
 await send('רעיון חדש: סרטון קפה');await send('לשמור בלי תאריך');
 assert.equal(calls.filter(c=>c.name==='saveContentIdea').length,1);assert.equal(conf.getPendingQuestion('fixture'),undefined);assert.equal(conf.getPendingConfirmation('fixture'),undefined);
});
test('new concept escapes a date clarification without losing old draft',async()=>{
 await send('רעיון חדש: קפה לשבץ ב31.11');await send('סרטון על טיול');assert.equal(conf.getPendingConfirmation('fixture').summary,'סרטון על טיול');assert.equal(conf.getSuspendedDrafts('fixture').length,1);
});
test('failed new idea with time never changes old scheduled upload time',async()=>{
 conf.storePendingQuestion('fixture',{questionType:'gantt_upload_time',context:{contentId:'GEN1',contentName:'ישן',date:'14/10/2026'}});
 overrides.create=()=>{throw Error('offline');};await send('רעיון חדש: סרטון בשעה 18:00');assert.equal(writes().length,0);
});
// Language matrix: real routing + state; controlled model replies isolate the
// classifier boundary. These are not live model-quality evaluations.
const language = require(path.join(root,'src/services/conversation-language.service.ts'));
const resolver = require(path.join(root,'src/services/pending-turn-resolution.service.ts'));
for (const text of ['לא מחבקת, מקשקשת','לא מחבקת אלא מקשקשת','מקשקשת ולא מחבקת','מקשקשת במקום מחבקת','התכונתי למקשקשת','כן, אבל בלי דוגמן','כן רק קצר יותר','אפשר יותר קליל?','פחות דרמטי','רילס במקום פוסט','תורידי את הדוגמן','בלי דוגמן','בעצם עם חברה','זה לא קשור לדוגמן']) {
 test('draft correction: '+text,async()=>{
  const prior={...draft('רואים אותי מחבקת דוגמן'),shortName:'איך אני מחבקת'};
  conf.storePendingConfirmation('fixture',prior);
  overrides.classifier=()=>{throw Error('local correction must not need classification');};
  let editInput;
  overrides.edit=(d,t)=>{editInput=t;return {...d,summary:'אני מקשקשת עם חברה',shortName:'איך אני מקשקשת'};};
  await send(text);
  assert.equal(conf.getPendingQuestion('fixture'),undefined);assert.equal(writes().length,0);
  assert.equal(conf.getSuspendedDrafts('fixture').length,0);assert.ok(conf.getPendingConfirmation('fixture'));
  // Some explicit field edits use the real local parser; all others use editor.
  assert.ok(editInput===text || conf.parseEditRequest(text));
 });
}
for (const text of ['כן אבל בלי דוגמן','כן, לא לשמור עדיין','כן אם תשני את השם','כן אבל לא למחוק','כן, אולי מחר']) {
 test('conditional yes never approves: '+text,async()=>{assert.equal(conf.isConfirmationMessage(text),false);});
}
for(const text of ['כן!','כן תודה','תשמרי בבקשה','סבבה','לשמור ככה.']) {
 test('natural bounded approval: '+text,async()=>{assert.equal(conf.isConfirmationMessage(text),true);});
}
const names=[{name:'איך אני מחבקת את החברה שלי',contentId:'A'},{name:'שדרוג לביזנס בירח דבש',contentId:'B'}];
for(const text of ['לביזנס שדרוג','את שדרוג לביזנס','שדרוג לביזס','השני','2','בואי נלך על שדרוג לביזנס']) {
 test('offered name selection: '+text,async()=>{
  conf.storePendingQuestion('fixture',{questionType:'saved_list_pick',context:{options:names}});
  overrides.classifier=()=>{throw Error('selection should be local');};await send(text);
  assert.equal(conf.getPendingQuestion('fixture').questionType,'bridge_pick_date');assert.equal(writes().length,0);assert.equal(conf.getPendingConfirmation('fixture'),undefined);
 });
}
for(const text of ['חיבוק','שדרוג לביזס']) {
 test('ambiguous offered match is never first-picked: '+text,async()=>{
  const options=text==='חיבוק'?[{name:'חיבוק עם חברה'},{name:'חיבוק עם אמא'}]:[{name:'שדרוג לביזנס בחופשה'},{name:'שדרוג לביזנס בירח דבש'}];
  assert.equal(language.pickOfferedOption(text,options,o=>o.name),undefined);
 });
}
test('single word typo and unrelated input never select an option',async()=>{
 for(const text of ['לביזס','רעיון','כן','חדש','חיבוק עם אמא'])assert.equal(language.pickOfferedOption(text,names,o=>o.name),undefined);
});
test('real WhatsApp correction reaches editor even during previous clarification',async()=>{
 conf.storePendingConfirmation('fixture',draft('רילס שבו אני מחבקת דוגמן'));
 conf.storePendingQuestion('fixture',{questionType:'context_turn_clarification',context:{originalText:'לא מחבקת, מקשקשת'}});
 overrides.edit=(d,t)=>({...d,summary:t});await send('לשנות את הטיוטה');
 assert.equal(conf.getPendingConfirmation('fixture').summary,'לא מחבקת, מקשקשת');assert.equal(conf.getPendingQuestion('fixture'),undefined);assert.equal(writes().length,0);
});
test('semantic fallback handles paraphrases and tolerates quoted enum',async()=>{
 let prompt;overrides.classifier=p=>{prompt=p;return '"edit_draft"';};
 assert.equal((await resolver.resolvePendingTurn('חברה שלי ולא אחותי',undefined,draft('חיבוק'))).kind,'edit_draft');
 assert.match(prompt,/לא מחבקת, מקשקשת/);assert.match(prompt,/חיבוק/);
});
test('failed or invalid semantic output retains clarification',async()=>{
 for(const result of ['{"kind":"invalid"}','not_a_decision']){overrides.classifier=()=>result;assert.equal((await resolver.resolvePendingTurn('הממ',undefined,draft('חיבוק'))).kind,'clarify');}
});
test('negation prefix is not a blanket scheduling rejection',async()=>{
 assert.equal(conf.classifyBridgeOfferAnswer('לא הבנתי מה האפשרויות'),'unclear');
 assert.equal(conf.classifyBridgeOfferAnswer('לא עכשיו'),'keep');
});
for(const [type,text] of [['ריל','רילס על חיבוקים'],['ריל','רואים אותי מקשיבה'],['פוסט','פוסט על סטייל'],['סטורי','שאלה לעוקבות']]){
 test('natural preview '+type+' '+text,async()=>{
  overrides.create=()=>({...draft(text),contentType:type});await send('רעיון חדש: '+text);
  assert.ok(!replies[0].includes('סוג:'));assert.ok(replies[0].includes(text));assert.ok(!replies[0].includes('על רילס'));
 });
}
test('creation prompt forbids turning example into model and adding a plot',async()=>{
 const content=oldLoad.call(Module,path.join(root,'src/services/content.service.ts'),module,false);let prompt;
 overrides.classifier=p=>{prompt=p;return 'Short Name: איך אני מחבקת\nContent Type: ריל\nSummary: איך אני מחבקת';};
 const result=await content.createContentDraft('רילס איך אני מחבקת דוגמא');
 assert.match(prompt,/אינו "מחבקת דוגמן"/);assert.match(prompt,/אין חובה להרחיב/);assert.equal(result.summary,'איך אני מחבקת');
});
for(const questionType of ['bridge_pick_date','gantt_upload_time','confirm_gantt_write','trend_schedule','trend_awaiting_date']) {
 test('implicit new idea escapes '+questionType,async()=>{
  conf.storePendingQuestion('fixture',{questionType,context:{contentId:'A',contentName:'רעיון קודם',date:'14/10/2026'}});
  overrides.classifier=()=> 'new_idea';
  await send('איך אני מחבקת ואיך החברה שלי מחבקת');
  assert.ok(conf.getPendingConfirmation('fixture'));assert.equal(writes().length,0);
  assert.equal(conf.getPendingQuestion('fixture'),undefined);
 });
}
for(const text of ['אל תשבצי ב14.10','לא לקבוע בתאריך 14.10','אל תשבצי אותו ב14.10']){
 test('negated scheduling language never writes: '+text,async()=>{
  bridge();await send(text);assert.equal(writes().length,0);assert.equal(conf.getPendingQuestion('fixture').questionType,'schedule_date_clarification');
 });
}
test('question about scheduling is not permission to schedule',async()=>{
 for(const text of ['לא הבנתי למה לשבץ','מה זה לשבץ','לשבץ אם יש זמן'])assert.equal(conf.classifyBridgeOfferAnswer(text),'unclear');
 assert.equal(conf.classifyBridgeOfferAnswer('אל תשבצי'),'keep');
});
test('natural correction after save does not become a new approval',async()=>{
 conf.storePendingConfirmation('fixture',draft('חיבוק עם דוגמן'));
 overrides.edit=(d)=>({...d,summary:'חיבוק עם חברה'});
 await send('כן, אבל בלי דוגמן');assert.equal(writes().length,0);assert.match(replies[0],/לשמור ככה/);
 await send('כן!');assert.equal(calls.filter(c=>c.name==='saveContentIdea').length,1);
});
test('editing while clarifying a date preserves the unfinished date question',async()=>{
 await send('רעיון חדש: חיבוק לשבץ ב31.11');
 overrides.edit=d=>({...d,summary:'חיבוק עם חברה'});await send('בעצם עם חברה');
 assert.equal(conf.getPendingQuestion('fixture').questionType,'draft_schedule_date');assert.equal(writes().length,0);assert.match(replies[0],/לאיזה תאריך/);
 await send('14.10');assert.equal(conf.getPendingConfirmation('fixture').approvalScope,'save_schedule');assert.equal(writes().length,0);
});
for(const text of ['בשעה 11','ב11 ביום שישי','1400','ב-11:00']){
 test('existing flexible upload time survives contextual routing: '+text,async()=>{
  conf.storePendingQuestion('fixture',{questionType:'gantt_upload_time',context:{contentId:'A',contentName:'חיבוק',date:'14/10/2026'}});
  overrides.classifier=()=>{throw Error('time must not call classifier');};await send(text);
  assert.equal(calls.filter(c=>c.name==='updateGanttUploadTime').length,1);assert.equal(conf.getPendingConfirmation('fixture'),undefined);
 });
}
test('legacy creation ignores long generated wrapping copy',async()=>{
 overrides.create=text=>({...draft(text),contentType:'פוסט',previewCopy:{intro:'הקדמה ארוכה',closingQuestion:'לשמור ככה, או שתרצי לשנות את השם, סוג התוכן או הכיוון?',changeLine:'ומה עוד?'}});
 await send('רעיון לפוסט קרוסלה: חמישה דברים שאני תמיד שוכחת לארוז לחופשה');
 assert.match(replies[0],/ככה הייתי שומרת את הפוסט/);assert.match(replies[0],/לשמור ככה\?$/);
 assert.equal((replies[0].match(/\?/g)||[]).length,1);assert.ok(!replies[0].includes('הקדמה ארוכה'));assert.equal(writes().length,0);
});
for(const text of ['מצחיק יותר','שיהיה מצחיק יותר','עם יותר הומור','אפשר שיהיה מצחיק יותר','פחות כבד']){
 test('style request rewrites prose via editor: '+text,async()=>{
  conf.storePendingConfirmation('fixture',draft('קרוסלה על שלושה דברים שאני שוכחת לארוז'));
  let edited=false;overrides.edit=(d,t)=>{assert.equal(t,text);edited=true;return {...d,summary:'קרוסלה על שלושה דברים שאני שוכחת לארוז. הזיכרון נשאר בבית.'};};
  await send(text);assert.ok(edited);assert.match(replies[0],/הזיכרון נשאר בבית/);assert.equal(writes().length,0);
 });
}
test('real editor prompt requires prose change and preserves metadata and constraints',async()=>{
 const content=oldLoad.call(Module,path.join(root,'src/services/content.service.ts'),module,false);let prompt;
 overrides.classifier=p=>{prompt=p;return 'Short Name: שלושה דברים\nCategory: כללי\nTone: מצחיק\nPriority: בינוני\nContent Type: פוסט\nSummary: שלושה דברים שאני שוכחת. הזיכרון נשאר בבית.';};
 const original={...draft('חמישה דברים שאני שוכחת לארוז'),contentType:'פוסט',approvalScope:'save_schedule',requestedAction:{kind:'schedule',date:'14/10/2026'}};
 const updated=await content.askClaudeForEdit(original,'בעצם שלושה דברים, ושיהיה מצחיק יותר');
 assert.match(prompt,/בקשת עריכה של הניסוח עצמו/);assert.match(prompt,/אל תמציאי מהם שלושת הדברים/);assert.match(prompt,/שדה בלבד/);
 assert.equal(updated.contentType,'פוסט');assert.equal(updated.approvalScope,'save_schedule');assert.deepEqual(updated.requestedAction,original.requestedAction);
});
(async()=>{let failed=0; for(const[name,fn]of tests){try{clock=originalClock;conf.clearPendingConfirmation('fixture');conf.clearPendingQuestion('fixture');persistence.deleteValue('suspendedDrafts','fixture');for(const key of Object.keys(overrides))delete overrides[key];await fn();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
 fs.rmSync(sandbox,{recursive:true,force:true});process.exitCode=failed?1:0;console.log(`${tests.length-failed}/${tests.length} passed`);
})();
