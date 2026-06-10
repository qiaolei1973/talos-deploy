import dotenv from "dotenv";
import path from "path";

// Load .env from project root (cwd may be server/ when run via workspace)
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
