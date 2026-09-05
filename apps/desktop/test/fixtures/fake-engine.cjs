const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const mode = args[0] === "hang" || args[0] === "fail" ? args.shift() : "success";

if (mode === "hang") {
  setInterval(() => undefined, 1000);
  return;
}

if (mode === "fail") {
  console.error("fake engine failure");
  process.exit(3);
}

const workIndex = args.indexOf("--work-dir");
const workDir = workIndex >= 0 ? args[workIndex + 1] : undefined;
if (!workDir) process.exit(4);

fs.mkdirSync(workDir, { recursive: true });
fs.writeFileSync(
  path.join(workDir, "report.json"),
  JSON.stringify({
    status: "ok",
    kind: "smoke",
    rowCount: 2,
    columnCount: 3,
    dependencies: { pandas: "test" },
    capabilities: {
      parquet: true,
      sdvGaussianCopula: true,
      scipyMilp: true,
      sdmetricsQualityReport: true,
    },
  }),
);
process.stdout.write(JSON.stringify({ type: "complete" }) + "\n");
