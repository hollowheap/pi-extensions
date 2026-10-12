# pi-permissions

Checks file paths against allow/deny rules before file tools run. Registers no tools and changes no tool schemas; it only observes `tool_call` and blocks denied calls.

## Try it

```bash
pi -e ./packages/pi-permissions
```

## Install

```bash
pi install npm:@my-scope/pi-permissions
```

## Rules

Create `<project>/.pi/permissions.json`:

```json
{
  "rules": [
    "deny write *",
    "allow write artifacts/specs/*.md",
    "allow write artifacts/plan/*.md"
  ]
}
```

Each rule is `"effect verb pattern"` or `{ "effect", "verb", "pattern" }`. `effect` is `allow` or `deny`; `verb` is `read` or `write`. Rules apply in order and the last matching rule wins; nothing matching means deny. When a winning `allow` ties on specificity (pattern length without wildcards) with a matching `deny`, the deny wins.

Patterns match the whole path relative to the project root. `*` spans directories and `?` matches one character, so `*` alone matches everything and `artifacts/specs/*.md` matches `artifacts/specs/a.md`. Every path resolves against the project root first; paths escaping the root (`../`, absolute paths elsewhere) are always denied.

## Hooked tools

| tool | checked as |
|---|---|
| `write`, `edit` | `write` |
| `find`, `grep` (`fd`, `rg` aliases) | `read` |

Pi names its search tools `find` and `grep`; the `fd`/`rg` names are accepted too. `bash` is deliberately unchecked: it can still write outside allowed paths until bash rules exist. Other tools pass through untouched.

Without a rules file (or with an unreadable one) the extension warns once and allows everything, so fresh projects keep working until rules are written.
