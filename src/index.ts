import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import autopilot from "../packages/pi-autopilot/src/index.js";
import budgets from "../packages/pi-budgets/src/index.js";
import codeIntel from "../packages/pi-code-intel/src/index.js";
import dashboard from "../packages/pi-dashboard/src/index.js";
import guard from "../packages/pi-guard/src/index.js";
import hooks from "../packages/pi-hooks/src/index.js";
import question from "../packages/pi-question/src/index.js";
import statusline from "../packages/pi-statusline/src/index.js";
import tasks from "../packages/pi-tasks/src/index.js";
import todos from "../packages/pi-todos/src/index.js";
import tools from "../packages/pi-tools/src/index.js";

// One entry for the git suite install; each package keeps its own manifest for
// standalone npm installs. Load order matches the previous `pi.extensions` list.
const EXTENSIONS = [
  statusline,
  guard,
  hooks,
  question,
  dashboard,
  tools,
  budgets,
  autopilot,
  todos,
  codeIntel,
  tasks,
] as const;

export default function (pi: ExtensionAPI): void {
  for (const register of EXTENSIONS) register(pi);
}
