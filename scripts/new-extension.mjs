// Scaffold a new extension package from inline templates.
// Usage: npm run new -- pi-<name>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawName = process.argv[2];

if (!rawName || !/^pi-[a-z0-9-]+$/.test(rawName)) {
  console.error("Usage: npm run new -- pi-<name>  (lowercase, e.g. pi-recall)");
  process.exit(1);
}

const dest = join(root, "extensions", rawName);
if (existsSync(dest)) {
  console.error(`extensions/${rawName} already exists`);
  process.exit(1);
}

mkdirSync(join(dest, "src"), { recursive: true });

const scope = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).name.startsWith("@")
  ? null
  : "@hollowheap";
const command = rawName.replace(/^pi-/, "");
const pkg = {
  name: `${scope}/${rawName}`,
  version: "0.1.0",
  type: "module",
  description: `${rawName} Pi coding agent extension`,
  license: "MIT",
  engines: { node: ">=22.19.0" },
  keywords: ["pi-package"],
  files: ["index.ts", "src", "README.md"],
  pi: { extensions: ["./index.ts"] },
  peerDependencies: {
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    typebox: "*",
  },
};
writeFileSync(join(dest, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync(
  join(dest, "tsconfig.json"),
  `${JSON.stringify({ extends: "../../tsconfig.base.json", include: ["index.ts", "src/**/*.ts"] }, null, 2)}\n`,
);
writeFileSync(
  join(dest, "index.ts"),
  'export { default } from "./src/index.js";\n',
);
writeFileSync(
  join(dest, "README.md"),
  `# ${rawName}\n\n${pkg.description}.\n\n## Try it\n\n\`\`\`bash\npi -e ./extensions/${rawName}\n\`\`\`\n\n## Install\n\n\`\`\`bash\npi install npm:${pkg.name}\n\`\`\`\n`,
);
writeFileSync(
  join(dest, "src", "index.ts"),
  `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\n\nexport default function (pi: ExtensionAPI) {\n  pi.registerCommand("${command}", {\n    description: "${rawName} example command",\n    handler: async (_args, ctx) => {\n      ctx.ui.notify("${rawName} ready", "info");\n    },\n  });\n}\n`,
);
writeFileSync(
  join(dest, "src", "index.test.ts"),
  `import { describe, expect, it, vi } from "vitest";\nimport extension from "./index.js";\n\ndescribe("${rawName} extension", () => {\n  it("registers the /${command} command", () => {\n    const pi = { registerCommand: vi.fn() };\n    extension(pi as never);\n    expect(pi.registerCommand).toHaveBeenCalledTimes(1);\n    expect(pi.registerCommand.mock.calls[0][0]).toBe("${command}");\n  });\n});\n`,
);

try {
  execFileSync("npx", ["biome", "check", "--write", dest], {
    cwd: root,
    stdio: "ignore",
  });
} catch {
  console.error(
    `formatting failed; run: npx biome check --write ./extensions/${rawName}`,
  );
}

// Register the new entrypoint in the root pi manifest (git-install-all path).
const rootPkgPath = join(root, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
const entry = `./extensions/${rawName}/index.ts`;
rootPkg.pi ??= {};
rootPkg.pi.extensions ??= [];
if (!rootPkg.pi.extensions.includes(entry)) {
  rootPkg.pi.extensions.push(entry);
  writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
}

console.log(
  `Created extensions/${rawName}. Try: pi -e ./extensions/${rawName}`,
);
