# image-peek

A mod (function hooks that run inside Claude Code) that shows the images you paste while they are still in the prompt box.

- Paste an image (`Ctrl+V`): a thumbnail of it appears above the prompt, one per `[Image #N]` in the box.
- Click the `🔍 #N` button under a thumbnail: the picture opens enlarged in a pane, with its pixel size.
- The thumbnails go away when the prompt is sent or the tag is deleted.

The thumbnail itself is not clickable (an `Image` element takes no `onPress`), hence the button under it.

## Needs

- Claude Code 2.1.289+ (hook modules).
- A terminal that draws kitty graphics: Ghostty, cmux (tested), kitty. Elsewhere the thumbnail shows its alt text.
- macOS: it reads the size with `sips`, and the clipboard fallback uses `osascript`.

## Install

```
/plugin install image-peek --marketplace shdennlin/agent-plugins
```

## How it works

- Claude Code writes a pasted image to `<tmp>/claude-<uid>/<project>/<session>/images/N.png` as soon as it is pasted. The mod reads the file from there, the terminal decodes it (`Image` with a `file` source), nothing is copied.
- A paste raises no `prompt.edit`, so the mod looks at the box every 300 ms with `$.prompt.read()` and follows the `[Image #N]` tags.
- If a tag stays without its file for about a second (Claude Code's store is off), the mod copies the clipboard's PNG to `/private/tmp/image-peek/<session>/N.png` and shows that.
- The band draws on top of whatever the plugins beneath it drew (`await next(e)`), so it sits beside other mods' bands such as `cut-input` instead of replacing them.

## Develop

```bash
claude plugin validate plugins/image-peek
claude plugin test plugins/image-peek
claude --plugin-dir ./plugins/image-peek   # lays .claude-plugin/types/ for tsc -p plugins/image-peek
```

## Known limits

- Only the draft is covered; images in already-sent messages get no preview.
- Pasting several images within a fraction of a second can attach the clipboard fallback to the wrong tag (only when the store is off).
- Paths assume macOS (`/private/tmp`, `sips`, `osascript`).
