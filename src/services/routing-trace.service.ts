import { AsyncLocalStorage } from 'node:async_hooks';
type ActiveTrace = { sender:string; messageSid?:string; startedAt:number; finished:boolean;
 claudeCalls:Array<{model:string;withPersona:boolean}>; writes:Array<{operation:string;outcome:string}>;
 pendingBefore?:string;pendingAfter?:string;routeReason?:string;sendOutcome?:string };
const traces = new AsyncLocalStorage<ActiveTrace>();
const makeTrace = (sender:string,messageSid?:string):ActiveTrace => ({sender,messageSid,startedAt:Date.now(),finished:false,claudeCalls:[],writes:[]});
export const withRoutingTrace = <T>(sender:string,_text:string,messageSid:string|undefined,fn:()=>T):T => traces.run(makeTrace(sender,messageSid),fn);
export const startRoutingTrace = (sender:string,_text:string,messageSid?:string):void => {
 if (!traces.getStore()) traces.enterWith(makeTrace(sender,messageSid));
};
export const updateRoutingTrace = (fields:Partial<Pick<ActiveTrace,'pendingBefore'|'pendingAfter'|'routeReason'|'sendOutcome'>>):void => {
 const trace=traces.getStore(); if(trace) Object.assign(trace,fields);
};
export const recordWriteOutcome = (operation:string,outcome:string):void => {traces.getStore()?.writes.push({operation,outcome});};
export const recordClaudeCall = (model:string,withPersona:boolean):void => {traces.getStore()?.claudeCalls.push({model,withPersona});};
export const finishRoutingTrace = (handlerStatus:string|undefined,fields:Partial<Pick<ActiveTrace,'pendingAfter'>>={}):void => {
 const trace=traces.getStore();if(!trace || trace.finished)return;trace.finished=true;
 Object.assign(trace,fields);
 console.log('[Routing Trace] '+JSON.stringify({messageSid:trace.messageSid,handler:handlerStatus||'unknown',
  pendingBefore:trace.pendingBefore,pendingAfter:trace.pendingAfter,reason:trace.routeReason,
  claudeCalls:trace.claudeCalls.length,models:trace.claudeCalls.map(c=>c.model),durationMs:Date.now()-trace.startedAt,
  writes:trace.writes,sendOutcome:trace.sendOutcome}));
};
