# Workbench design
## Authority
Chinese operating interface. Code-led implementation delegated by parent; remaining direction choices inferred from existing architecture and task. No visual concept approved by human; the interface needs live acceptance.
## Visual system
Cool daylight surfaces, blue actions, dark blue text. A compact persistent navigation anchors independent jobs; main content uses readable lists, inline disclosure, and two-column work areas. Typography uses platform Chinese sans fonts, a fixed scale, and monospace only for identifiers or source. Shadows only for transient feedback.
## Interaction
Every mutation waits for server success; errors remain recoverable via credentials and refresh. Admin token exists only in page memory. No simulated success states. Upload shows exact submitted content, review explicitly chooses approve or reject. Building is asynchronous and requires refresh to see completed versions.
## Responsive
Sidebar becomes horizontal navigation below 680px. Forms and workspace columns stack. Long identifiers wrap; tables and code remain scrollable. Keyboard focus and reduced-motion preferences are respected.
## Surface mode
Operate. The primary path is upload → review → content → bundle → build → list → sync Git → install → new-session evidence.
