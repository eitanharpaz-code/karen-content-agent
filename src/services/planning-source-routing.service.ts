export type PlanningContentType = "ריל" | "פוסט";

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

const typeLabel = (contentType: PlanningContentType): string =>
  contentType === "ריל" ? "ריל" : "פוסט";

const ideaCta = (contentType: PlanningContentType): string =>
  contentType === "ריל" ? "תראי לי רעיונות לריל" : "תראי לי רעיונות לפוסט";

const newIdeaCta = (contentType: PlanningContentType): string =>
  contentType === "ריל" ? "בואי נחשוב על רעיון חדש לריל" : "בואי נחשוב על רעיון חדש לפוסט";

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

export const buildPlanningSourceRoutingMessage = (
  input: PlanningSourceRoutingInput
): string => {
  const contentType = typeLabel(input.missingContentType);

  if (input.approvedUnscheduled.length > 0) {
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

  if (input.nearReadyProduction.length > 0) {
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

  if (input.approvedNotStarted.length > 0) {
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

  if (input.ideaBank.length > 0) {
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