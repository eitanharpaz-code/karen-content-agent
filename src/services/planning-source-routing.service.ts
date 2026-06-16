export type PlanningContentType = "ריל" | "פוסט";

export type PlanningSourceKey =
  | "approvedUnscheduled"
  | "nearReadyProduction"
  | "approvedNotStarted"
  | "ideaBank"
  | "newIdea";

export type PlanningSourceOption = {
  contentId?: string;
  title: string;
  status?: string;
};

export type PlanningSourceRoutingInput = {
  signalMessage: string;
  missingContentType: PlanningContentType;
  approvedUnscheduled: PlanningSourceOption[];
  nearReadyProduction: PlanningSourceOption[];
  approvedNotStarted: PlanningSourceOption[];
  ideaBank: PlanningSourceOption[];
};

export type PlanningSourceRoutingState = PlanningSourceRoutingInput & {
  activeSource: PlanningSourceKey;
};

export type PlanningSourceRoutingReplyResult =
  | {
      action: "selected";
      option: PlanningSourceOption;
      message: string;
    }
  | {
      action: "next_source";
      state: PlanningSourceRoutingState;
      message: string;
    }
  | {
      action: "clarify";
      message: string;
    }
  | {
      action: "new_idea";
      message: string;
    };

const sourceOrder: PlanningSourceKey[] = [
  "approvedUnscheduled",
  "nearReadyProduction",
  "approvedNotStarted",
  "ideaBank",
  "newIdea",
];

const typeLabel = (contentType: PlanningContentType): string =>
  contentType === "ריל" ? "ריל" : "פוסט";

const ideaCta = (contentType: PlanningContentType): string =>
  contentType === "ריל" ? "תראי לי רעיונות לריל" : "תראי לי רעיונות לפוסט";

const newIdeaCta = (contentType: PlanningContentType): string =>
  contentType === "ריל" ? "בואי נחשוב על רעיון חדש לריל" : "בואי נחשוב על רעיון חדש לפוסט";

const normalizeText = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[״"׳']/g, "")
    .replace(/[.,:;!?]/g, "")
    .replace(/\s+/g, " ");

const getOptionsForSource = (
  input: PlanningSourceRoutingInput,
  source: PlanningSourceKey
): PlanningSourceOption[] => {
  switch (source) {
    case "approvedUnscheduled":
      return input.approvedUnscheduled;
    case "nearReadyProduction":
      return input.nearReadyProduction;
    case "approvedNotStarted":
      return input.approvedNotStarted;
    case "ideaBank":
      return input.ideaBank;
    case "newIdea":
      return [];
  }
};

const firstAvailableSource = (input: PlanningSourceRoutingInput): PlanningSourceKey => {
  const source = sourceOrder.find((candidate) => {
    if (candidate === "newIdea") return true;
    return getOptionsForSource(input, candidate).length > 0;
  });

  return source || "newIdea";
};

const nextAvailableSource = (
  input: PlanningSourceRoutingInput,
  currentSource: PlanningSourceKey
): PlanningSourceKey => {
  const currentIndex = sourceOrder.indexOf(currentSource);
  const remainingSources = sourceOrder.slice(currentIndex + 1);
  const source = remainingSources.find((candidate) => {
    if (candidate === "newIdea") return true;
    return getOptionsForSource(input, candidate).length > 0;
  });

  return source || "newIdea";
};

const formatOptions = (options: PlanningSourceOption[]): string =>
  options
    .slice(0, 5)
    .map((option, index) => {
      const status = option.status ? ` - ${option.status}` : "";
      return `${index + 1}. ${option.title}${status}`;
    })
    .join("\n");

const formatChoiceInstructions = (contentType: PlanningContentType): string =>
  [
    "אפשר לענות במספר, בשם התוכן, או לכתוב:",
    "* לא",
    `* ${ideaCta(contentType)}`,
  ].join("\n");

const buildMessageForSource = (
  input: PlanningSourceRoutingInput,
  source: PlanningSourceKey
): string => {
  const contentType = typeLabel(input.missingContentType);

  if (source === "approvedUnscheduled") {
    return [
      input.signalMessage,
      "",
      `הדרך הכי מהירה היא להתחיל מ${contentType} שכבר אושר אבל עדיין לא שובץ בגאנט.`,
      "",
      `מצאתי ${input.approvedUnscheduled.length} אפשרויות:`,
      formatOptions(input.approvedUnscheduled),
      "",
      formatChoiceInstructions(input.missingContentType),
    ].join("\n");
  }

  if (source === "nearReadyProduction") {
    return [
      input.signalMessage,
      "",
      `לא מצאתי ${contentType} שאושר ועדיין לא שובץ בגאנט.`,
      "הדבר הבא שהייתי בודקת הוא מה הכי קרוב להיות מוכן.",
      "",
      `מצאתי ${input.nearReadyProduction.length} אפשרויות:`,
      formatOptions(input.nearReadyProduction),
      "",
      formatChoiceInstructions(input.missingContentType),
    ].join("\n");
  }

  if (source === "approvedNotStarted") {
    return [
      input.signalMessage,
      "",
      `לא מצאתי ${contentType} שכמעט מוכן להשלים איתו את הגאנט.`,
      `אפשר להתחיל מ${contentType} שאושר אבל עדיין לא התחילו עליו.`,
      "",
      `מצאתי ${input.approvedNotStarted.length} אפשרויות:`,
      formatOptions(input.approvedNotStarted),
      "",
      formatChoiceInstructions(input.missingContentType),
    ].join("\n");
  }

  if (source === "ideaBank") {
    return [
      input.signalMessage,
      "",
      `לא מצאתי ${contentType} מאושר או כמעט מוכן שמתאים להשלים איתו את הגאנט.`,
      `אפשר להתחיל מבנק הרעיונות ל${contentType}.`,
      "",
      `מצאתי ${input.ideaBank.length} אפשרויות:`,
      formatOptions(input.ideaBank),
      "",
      formatChoiceInstructions(input.missingContentType),
    ].join("\n");
  }

  return [
    input.signalMessage,
    "",
    "לא מצאתי משהו קיים שמתאים להשלים איתו את החוסר בגאנט.",
    "",
    `אפשר להתחיל מרעיון חדש ל${contentType}.`,
    "רוצה שאציע 3 כיוונים?",
    "",
    "אפשר לענות:",
    `* ${newIdeaCta(input.missingContentType)}`,
  ].join("\n");
};

export const createPlanningSourceRoutingState = (
  input: PlanningSourceRoutingInput
): PlanningSourceRoutingState => ({
  ...input,
  activeSource: firstAvailableSource(input),
});

export const buildPlanningSourceRoutingMessage = (
  input: PlanningSourceRoutingInput
): string => buildMessageForSource(input, firstAvailableSource(input));

const findOptionByReply = (
  replyText: string,
  options: PlanningSourceOption[]
): PlanningSourceOption | "ambiguous" | null => {
  const normalizedReply = normalizeText(replyText);
  const numericChoice = parseInt(normalizedReply, 10);

  if (!Number.isNaN(numericChoice) && numericChoice >= 1 && numericChoice <= options.length) {
    return options[numericChoice - 1];
  }

  const matches = options.filter((option) => {
    const normalizedTitle = normalizeText(option.title);
    const replyWords = normalizedReply.split(" ").filter((word) => word.length > 1);
    const titleWords = normalizedTitle.split(" ").filter(Boolean);
    const matchedWords = replyWords.filter((word) => titleWords.includes(word));

    return (
      normalizedTitle.includes(normalizedReply) ||
      normalizedReply.includes(normalizedTitle) ||
      (replyWords.length >= 2 && matchedWords.length === replyWords.length)
    );
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return "ambiguous";

  return null;
};

const buildSelectedMessage = (option: PlanningSourceOption): string =>
  [
    `סבבה, נלך על "${option.title}".`,
    "",
    "רוצה שאציע תאריך פנוי בגאנט השבוע?",
  ].join("\n");

export const handlePlanningSourceRoutingReply = (
  state: PlanningSourceRoutingState,
  replyText: string
): PlanningSourceRoutingReplyResult => {
  const normalizedReply = normalizeText(replyText);
  const activeOptions = getOptionsForSource(state, state.activeSource);

  if (["לא", "לא תודה", "עזבי", "עזוב"].includes(normalizedReply)) {
    const nextSource = nextAvailableSource(state, state.activeSource);
    const nextState: PlanningSourceRoutingState = {
      ...state,
      activeSource: nextSource,
    };

    if (nextSource === "newIdea") {
      return {
        action: "new_idea",
        message: buildMessageForSource(nextState, nextSource),
      };
    }

    return {
      action: "next_source",
      state: nextState,
      message: buildMessageForSource(nextState, nextSource),
    };
  }

  if (["כן", "כן תודה", "סבבה", "יאללה"].includes(normalizedReply)) {
    const firstOption = activeOptions[0];

    if (!firstOption) {
      return {
        action: "new_idea",
        message: buildMessageForSource(state, "newIdea"),
      };
    }

    return {
      action: "selected",
      option: firstOption,
      message: buildSelectedMessage(firstOption),
    };
  }

  const matchedOption = findOptionByReply(replyText, activeOptions);

  if (matchedOption === "ambiguous") {
    return {
      action: "clarify",
      message: "מצאתי כמה אפשרויות דומות. תכתבי מספר מהרשימה כדי שאבחר נכון.",
    };
  }

  if (matchedOption) {
    return {
      action: "selected",
      option: matchedOption,
      message: buildSelectedMessage(matchedOption),
    };
  }

  return {
    action: "clarify",
    message: [
      "לא הצלחתי להבין איזו אפשרות לבחור.",
      "",
      "אפשר לענות במספר, בשם התוכן, או לכתוב לא כדי לעבור לאפשרות הבאה.",
    ].join("\n"),
  };
};