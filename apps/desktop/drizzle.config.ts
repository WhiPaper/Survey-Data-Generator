import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./electron/main/persistence/schema.ts",
  out: "./drizzle",
});
