#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const outputPath = path.join(root, "Karen_Content_Agent_Code_Context.md");

const requiredFiles = [
  "package.json",
  "tsconfig.json",
  "src/server.ts",
  "src/controllers/whatsapp.controller.ts",
  "src/services/daily-brief.service.ts",
  "src/services/priority.service.ts",
  "src/services/scheduler.service.ts",
  "src/services/sheets.service.ts",
  "src/services/production-status.service.ts",
  "src/services/whatsapp.service.ts",
  "src/utils/date-utils.ts",
];

const optionalFiles = [
  "src/test/priority-timestamps-test.ts",
  "src/test/priority-ready-age-test.ts",
  "src/test/priority-real-test.ts",
  "src/test/production-timestamps-test.ts",
  "src/test/brief-test.ts",
  "src/test/brief-send-test.ts",
];

const excludedNames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "production-timestamps-migration.ts",
]);

const allowedExtensions = new Set([".ts", ".tsx", ".js", ".cjs", ".json"]);

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAC[a-fA-F0-9]{32}\b/,
];

const normalize = (filePath) => filePath.split(path.sep).join("/");

const listRelevantTests = () => {
  const testDir = path.join(root, "src", "test");
  if (!fs.existsSync(testDir)) return [];

  return fs
    .readdirSync(testDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `src/test/${entry.name}`)
    .filter((file) => {
      const name = path.basename(file).toLowerCase();
      return (
        allowedExtensions.has(path.extname(file)) &&
        !excludedNames.has(path.basename(file)) &&
        /(brief|afternoon|morning|priority|timestamp)/.test(name)
      );
    });
};

const initialCandidates = [
  ...requiredFiles,
  ...optionalFiles,
  ...listRelevantTests(),
];

const included = [];
const missingRequired = [];
const missingOptional = [];
const seen = new Set();
const queue = [...new Set(initialCandidates)].sort();

const resolveLocalImport = (fromFile, importPath) => {
  if (!importPath.startsWith(".")) return null;

  const base = path.resolve(root, path.dirname(fromFile), importPath);
  const candidates = [
    base,
    ...[...allowedExtensions].map((extension) => `${base}${extension}`),
    ...[...allowedExtensions].map((extension) =>
      path.join(base, `index${extension}`)
    ),
  ];

  const match = candidates.find(
    (candidate) =>
      candidate.startsWith(`${root}${path.sep}`) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
  );

  return match ? normalize(path.relative(root, match)) : null;
};

while (queue.length > 0) {
  const relativePath = queue.shift();
  const normalizedPath = normalize(relativePath);
  if (seen.has(normalizedPath)) continue;
  seen.add(normalizedPath);

  const absolutePath = path.resolve(root, relativePath);
  const isRequired = requiredFiles.includes(relativePath);
  const isInitialOptional =
    optionalFiles.includes(relativePath) || listRelevantTests().includes(relativePath);

  if (
    !absolutePath.startsWith(`${root}${path.sep}`) ||
    excludedNames.has(path.basename(relativePath)) ||
    !allowedExtensions.has(path.extname(relativePath))
  ) {
    continue;
  }

  if (!fs.existsSync(absolutePath)) {
    if (isRequired) missingRequired.push(normalizedPath);
    else if (isInitialOptional) missingOptional.push(normalizedPath);
    continue;
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  const detectedSecret = secretPatterns.find((pattern) => pattern.test(content));

  if (detectedSecret) {
    console.error(`ABORTED: possible secret detected in ${normalizedPath}`);
    console.error("No context file was written.");
    process.exit(1);
  }

  included.push({ path: normalizedPath, content });

  const importPattern =
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
  let match;

  while ((match = importPattern.exec(content)) !== null) {
    const importedPath = match[1] || match[2];
    const resolved = resolveLocalImport(normalizedPath, importedPath);
    if (resolved && !seen.has(resolved)) queue.push(resolved);
  }
}

if (missingRequired.length > 0) {
  console.error("ABORTED: required files are missing:");
  for (const file of missingRequired) console.error(`- ${file}`);
  console.error("No context file was written.");
  process.exit(1);
}

const generatedAt = new Date().toISOString();
const sections = included.map(({ path: relativePath, content }) => {
  const extension = path.extname(relativePath).slice(1);
  return [
    `## File: \`${relativePath}\``,
    "",
    `\`\`\`${extension}`,
    content.trimEnd(),
    "```",
    "",
  ].join("\n");
});

const output = [
  "# Karen Content Agent - Code Context",
  "",
  `Generated: ${generatedAt}`,
  "",
  "This is a read-only snapshot of selected project files.",
  "It intentionally excludes environment files, credentials, dependencies, build output and the timestamp migration script.",
  "",
  "## Included Files",
  "",
  ...included.map(({ path: relativePath }) => `- \`${relativePath}\``),
  "",
  ...sections,
].join("\n");

fs.writeFileSync(outputPath, output, { encoding: "utf8", flag: "w" });

const size = fs.statSync(outputPath).size;
console.log(`Created: ${path.basename(outputPath)}`);
console.log(`Included files: ${included.length}`);
console.log(`Size: ${size.toLocaleString("en-US")} bytes`);

if (missingOptional.length > 0) {
  console.log("Optional files not found:");
  for (const file of missingOptional) console.log(`- ${file}`);
}

console.log("No project source files or Google Sheets data were modified.");
