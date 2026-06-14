import dotenv from "dotenv";
dotenv.config();
import { buildMorningBrief } from "../services/daily-brief.service";
buildMorningBrief().then((msg: string | null) => console.log(msg || "NO MESSAGE")).catch(console.error);
