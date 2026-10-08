# cut-input

A mod (function hooks that run inside Claude Code) that copies the prompt box to the system clipboard and clears it.

- **Ctrl+U / Ctrl+K**: the text they kill from the composer is also copied to the clipboard. With the cursor at the end of a one-line draft, Ctrl+U cuts the whole draft.
- **✂ Cut input** button: shown above the prompt, right-aligned, only while the box has text. Click it to copy the whole draft and clear the box. Gone again once the box is empty or the prompt is sent.

If the copy fails the draft is kept and a toast says so.

The button joins the band above the prompt instead of replacing it: it draws what the plugins beneath it drew and adds itself, so mods such as `image-peek` keep their own band (0.1.0 hid them; fixed in 0.1.1).

## Install

```
/plugin install cut-input --marketplace shdennlin/agent-plugins
```

Needs Claude Code 2.1.289+ (hook modules).

## Develop

```bash
claude plugin validate plugins/cut-input
claude plugin test plugins/cut-input
claude --plugin-dir ./plugins/cut-input   # lays .claude-plugin/types/ for tsc -p plugins/cut-input
```
