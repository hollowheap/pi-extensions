import { formatTodoWidget } from "../../extensions/pi-todos/src/todos.ts";

const todos = [
  ...Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    text: `done-${index + 1}`,
    done: true,
    priority: "high" as const,
  })),
  { id: 11, text: "open-high", done: false, priority: "high" as const },
  { id: 12, text: "open-low", done: false, priority: "low" as const },
];

const lines = formatTodoWidget(todos, [], [], { width: 60 }) ?? [];
console.log(lines.join("\n"));
console.log(
  "OPEN_VISIBLE=",
  lines.some((line) => line.includes("open-")),
);
