import dotenv from "dotenv";
import { askClaude } from "../services/claude.service";

dotenv.config();

const main = async () => {
  try {
    const response = await askClaude("שלום, איך אוכל לעזור היום?");
    console.log("Claude response:\n", response);
  } catch (error) {
    console.error("Error during Claude test:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

main();
