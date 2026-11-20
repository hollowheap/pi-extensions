# `@hollowheap/ui`

Shared host-agnostic UI primitives for Pi extensions: box frames, Markdown
rendering, tabbed dialog content, surfaces, spinners, and widgets.

`TabbedContent` from `@hollowheap/ui/tabs` accepts labelled components. It
switches between them with Tab and Shift+Tab and forwards other keystrokes to
the active component. Compose it with a frame or use it inside an overlay.

`boxFrame` draws the configured border and paints the selected surface across
the whole frame. Host-aware dialogs, pickers, pagers, and progress overlays live
in `@hollowheap/pi-ui`.

`@hollowheap/ui/widget` supplies named widget providers, visibility state, and
shared row formatting. Providers register with `registerWidgetProvider`, which
returns a disposer. `mountWidgetProviders(ctx)` mounts every registered provider
using the configured frame and hide hint, and skips providers whose renderer
returns no lines. `toggleWidgets(name?)` flips one provider or all of them; the
mounted widget also toggles on left click.
