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

if (args[0] === "synthesize") {
  const jobIndex = args.indexOf("--job");
  const jobPath = jobIndex >= 0 ? args[jobIndex + 1] : undefined;
  if (!jobPath) process.exit(5);
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
  const reportPath = path.resolve(path.dirname(jobPath), job.report_json);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      status: "success",
      kind: "synthesize",
      sourceCount: 2,
      syntheticCount: 2,
      finalCount: 4,
      candidatePoolCount: 20,
      target: {
        kind: "mean",
        column: "target_score",
        value: 4.5,
        minimum: 1,
        maximum: 5,
      },
      shareTargets: [],
      conditionalShareTargets: [
        {
          id: "conditional:group-1:q-checkbox:A",
          populationColumn: "q_0",
          optionColumn: "q_1",
          value: 0.75,
        },
      ],
      achieved: {
        mean: 4.5,
        absoluteError: 0,
        exact: true,
        bestPossibleMean: 4.5,
        bestPossibleAbsoluteError: 0,
        shares: [],
        conditionalShares: [
          {
            id: "conditional:group-1:q-checkbox:A",
            value: 0.75,
            share: 0.75,
            numeratorCount: 3,
            denominatorCount: 4,
            absoluteError: 0,
            exact: true,
          },
        ],
      },
      validation: { finalCount: true, conditionalShareTargets: true },
      quality: { sdmetricsScore: 0.9, warning: null },
      dependencies: { pandas: "test" },
    }),
  );
  process.stdout.write(JSON.stringify({ type: "complete" }) + "\n");
  return;
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
