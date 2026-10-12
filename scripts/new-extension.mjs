// Scaffold a new extension package from packages/pi-hello.
// Usage: npm run new -- pi-<name>
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawName = process.argv[2];

if (!rawName || !/^pi-[a-z0-9-]+$/.test(rawName)) {
	console.error("Usage: npm run new -- pi-<name>  (lowercase, e.g. pi-recall)");
	process.exit(1);
}

const dest = join(root, "packages", rawName);
if (existsSync(dest)) {
	console.error(`packages/${rawName} already exists`);
	process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(join(root, "packages", "pi-hello", "src"), join(dest, "src"), {
	recursive: true,
});
for (const f of ["tsconfig.json", "README.md"]) {
	cpSync(join(root, "packages", "pi-hello", f), join(dest, f));
}

const scope = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
).name.startsWith("@")
	? null
	: "@my-scope";
const pkg = JSON.parse(
	readFileSync(join(root, "packages", "pi-hello", "package.json"), "utf8"),
);
pkg.name = `${scope}/${rawName}`;
pkg.version = "0.1.0";
pkg.description = `${rawName} Pi coding agent extension`;
writeFileSync(join(dest, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

// Register the new entrypoint in the root pi manifest (git-install-all path).
const rootPkgPath = join(root, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
const entry = `./packages/${rawName}/src/index.ts`;
rootPkg.pi ??= {};
rootPkg.pi.extensions ??= [];
if (!rootPkg.pi.extensions.includes(entry)) {
	rootPkg.pi.extensions.push(entry);
	writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
}

console.log(`Created packages/${rawName}. Try: pi -e ./packages/${rawName}`);
