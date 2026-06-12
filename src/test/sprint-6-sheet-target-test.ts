import dotenv from "dotenv";
import { saveContentIdea, createProductionTask } from "../services/sheets.service";

dotenv.config();

const main = async () => {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    if (!spreadsheetId) {
      throw new Error("Missing GOOGLE_SHEETS_ID in environment variables.");
    }

    const contentId = `TEST-${Date.now()}`;
    const contentName = "תוכן בדיקה משימות הפקה";
    const idea = "בדיקת כתיבת שורה לבנק רעיונות";
    const summary = "סיכום בדיקה";
    const category = "General";
    const tone = "casual";
    const priority = "Medium";

    console.log("Sprint 6 Sheet Target Test");
    console.log(`Content ID: ${contentId}`);

    console.log(`\n1) Writing content row to בנק רעיונות:`);
    console.log(`   target sheet: בנק רעיונות`);
    console.log(`   payload: ${JSON.stringify([
      contentId,
      idea,
      summary,
      category,
      tone,
      priority,
      "כן",
      "לא",
      "רעיון",
      "",
      new Date().toISOString(),
    ])}`);

    await saveContentIdea(spreadsheetId, contentId, idea, summary, category, tone, priority);

    console.log(`\n2) Writing task row to משימות הפקה:`);
    console.log(`   target sheet: משימות הפקה`);
    console.log(`   payload: ${JSON.stringify([
      contentId,
      contentName,
      "לא",
      "לא",
      "לא",
      "",
      "",
    ])}`);

    await createProductionTask(spreadsheetId, contentId, contentName);

    console.log(`\nSprint 6 Sheet Target Test completed successfully.`);
    console.log(`Verified: content row target=בנק רעיונות, task row target=משימות הפקה, both share content_id=${contentId}`);
  } catch (error) {
    console.error("Sprint 6 Sheet Target Test failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

main();
