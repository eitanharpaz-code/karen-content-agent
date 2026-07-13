// Routing trace — Stage 2 of the routing audit plan.
//
// Goal: one uniform log line per inbound WhatsApp message that answers the
// two diagnostic questions from the audit:
//   1. Which handler caught the message? (the `status` field every controller
//      exit already returns via res.json)
//   2. How many Claude calls did it cost, on which model tier?
//
// This turns Karen's real usage into concrete routing examples — the missing
// evidence for validating the audit fixes and for the future decision about
// Claude-based intent routing.
//
// Design notes:
// - Claude calls are counted via recordClaudeCall(), invoked from
//   claude.service.ts (askClaude + askClaudeForMatching). The counter is
//   module-level and reset at trace start. Karen is a single pilot user and
//   messages are processed one at a time in practice; if two messages ever
//   overlap, counts may mix between their trace lines — acceptable for a
//   diagnostic log, noted here for honesty.
// - No behavior changes: this module only observes and logs.

type ClaudeCallRecord = {
  model: string;
  withPersona: boolean;
};

type ActiveTrace = {
  sender: string;
  text: string;
  startedAt: number;
  claudeCalls: ClaudeCallRecord[];
};

let activeTrace: ActiveTrace | null = null;

export const startRoutingTrace = (sender: string, text: string): void => {
  activeTrace = {
    sender,
    text,
    startedAt: Date.now(),
    claudeCalls: [],
  };
};

// Called from claude.service.ts on every outgoing Claude call.
export const recordClaudeCall = (model: string, withPersona: boolean): void => {
  if (!activeTrace) return;
  activeTrace.claudeCalls.push({ model, withPersona });
};

const summarizeCalls = (calls: ClaudeCallRecord[]): string => {
  if (calls.length === 0) return "none";
  const byModel = new Map<string, number>();
  for (const call of calls) {
    const tier = call.model.includes("haiku")
      ? "haiku"
      : call.model.includes("sonnet")
        ? "sonnet"
        : call.model;
    byModel.set(tier, (byModel.get(tier) || 0) + 1);
  }
  return Array.from(byModel.entries())
    .map(([tier, count]) => `${tier}:${count}`)
    .join(", ");
};

export const finishRoutingTrace = (handlerStatus: string | undefined): void => {
  if (!activeTrace) return;
  const trace = activeTrace;
  activeTrace = null;

  const durationMs = Date.now() - trace.startedAt;
  const textPreview =
    trace.text.length > 60 ? `${trace.text.slice(0, 60)}…` : trace.text;

  console.log(
    `[Routing Trace] handler=${handlerStatus || "unknown"} ` +
      `claudeCalls=${trace.claudeCalls.length} (${summarizeCalls(trace.claudeCalls)}) ` +
      `durationMs=${durationMs} text="${textPreview}"`
  );
};
