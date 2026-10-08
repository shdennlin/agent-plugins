import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

const PANE = 'image-peek'
const THUMB_COLS = 16
const THUMB_ROWS = 6
const RETRIES = 12

const tags = atom({ plugin: 'image-peek', key: 'tags' } as const, [])
const selected = atom({ plugin: 'image-peek', key: 'selected' } as const, null)

let imagesDir: string | null = null
const sizes = new Map<string, { w: number; h: number }>()
const snapped = new Set<number>()
const missingFor = new Map<number, number>() // polls a tag has gone without its file
let retries = 0
let isWaiting = false

// The folder Claude Code stores pasted images in: <tmp>/claude-<uid>/<project>/<session>/images
async function dirOf($: Engine): Promise<string | null> {
  if (imagesDir !== null) return imagesDir
  const uid = (await $.process.run(['id', '-u'])).stdout.trim()
  const session = await $.session.id()
  const root = `/private/tmp/claude-${uid}`
  for (const project of await $.fs.list(root)) {
    const dir = `${root}/${project.name}/${session}/images`
    if (await $.fs.exists(dir)) {
      imagesDir = dir
      return dir
    }
  }
  return null
}

async function cacheOf($: Engine, n: number): Promise<string> {
  const session = await $.session.id()
  return `/private/tmp/image-peek/${session}/${n}.png`
}

async function fileOf($: Engine, n: number): Promise<string | null> {
  const dir = await dirOf($)
  if (dir !== null && (await $.fs.exists(`${dir}/${n}.png`))) return `${dir}/${n}.png`
  const cached = await cacheOf($, n)
  return (await $.fs.exists(cached)) ? cached : null
}

// Fallback for a paste whose file Claude Code has not written: copy the clipboard's PNG.
async function snapshot($: Engine, n: number) {
  const file = await cacheOf($, n)
  await $.process.run(['mkdir', '-p', file.slice(0, file.lastIndexOf('/'))])
  await $.process.run([
    'osascript',
    '-e', 'set d to (the clipboard as «class PNGf»)',
    '-e', `set f to open for access POSIX file "${file}" with write permission`,
    '-e', 'set eof f to 0',
    '-e', 'write d to f',
    '-e', 'close access f',
  ])
}

async function sizeOf($: Engine, file: string) {
  const known = sizes.get(file)
  if (known) return known
  const out = (await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', file])).stdout
  const w = Number(/pixelWidth: (\d+)/.exec(out)?.[1] ?? 0)
  const h = Number(/pixelHeight: (\d+)/.exec(out)?.[1] ?? 0)
  const size = w > 0 && h > 0 ? { w, h } : { w: 4, h: 3 }
  sizes.set(file, size)
  return size
}

// Fit a picture into maxCols x maxRows cells, keeping its aspect (a cell is about 1:2).
function fit(size: { w: number; h: number }, maxCols: number, maxRows: number) {
  const ratio = size.w / size.h / 0.5
  let columns = maxCols
  let rows = Math.round(columns / ratio)
  if (rows > maxRows) {
    rows = maxRows
    columns = Math.round(rows * ratio)
  }
  return { columns: Math.max(1, Math.min(255, columns)), rows: Math.max(1, Math.min(255, rows)) }
}

const sameTags = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i])

// Look at the box on a timer (a paste raises no prompt.edit). The band is redrawn only when the
// tags change, never on a plain edit.
async function syncTags($: Engine) {
  const { text } = await $.prompt.read()
  const found = [...text.matchAll(/\[Image #(\d+)\]/g)].map(m => Number(m[1]))
  const old = await read($, tags)

  for (const n of found) {
    if (snapped.has(n)) continue
    if ((await fileOf($, n)) !== null) {
      missingFor.delete(n)
      continue
    }
    const polls = (missingFor.get(n) ?? 0) + 1
    missingFor.set(n, polls)
    if (polls >= 4) {
      snapped.add(n)
      await snapshot($, n)
    }
  }

  if (!sameTags(old, found)) {
    await update($, tags, () => found)
  }

  // A file that was missing at the last draw: redraw once it is there.
  if (isWaiting && retries < RETRIES) {
    retries += 1
    const files = await Promise.all(found.map(n => fileOf($, n)))
    if (files.every(f => f !== null)) {
      isWaiting = false
      $.ui.invalidate('ui.render')
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(300, () => {
      void syncTags($)
    })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    update($, tags, () => []).catch(() => {})
    update($, selected, () => null).catch(() => {})
    $.ui.close({ id: PANE }).catch(() => {})
    retries = 0

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, tags)
    if (e.surface !== 'terminal' || e.props.hasSurvey || list.length === 0) {
      return next(e)
    }

    const { Box, Text, Image, Button } = $.ui.resolve(e)
    const below = await next(e)
    const items = await Promise.all(
      list.map(async n => {
        const file = await fileOf($, n)
        return { n, file, size: file ? await sizeOf($, file) : null }
      }),
    )
    isWaiting = items.some(i => i.file === null)

    const room = Math.max(2, Math.min(THUMB_ROWS, e.props.maxRows - 5))
    const cols = Math.max(6, Math.min(THUMB_COLS, Math.floor(e.props.bodyColumns / items.length) - 4))

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row">
          {items.map(({ n, file, size }) => (
            <Box flexDirection="column" alignItems="center" borderStyle="round" borderDimColor>
              {file && size ? (
                <Image key={`img-${n}`} source={{ file, format: 'png' }} {...fit(size, cols, room)} alt={`Image #${n}`} />
              ) : (
                <Text dimColor>loading…</Text>
              )}
              <Text dimColor>#{n}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="row">
          {items.map(({ n }) => (
            <Button
              key={`open-${n}`}
              label={`🔍 #${n}`}
              onPress={async () => {
                await update($, selected, () => n)
                await $.ui.open({ id: PANE, title: `Image #${n}`, focus: true })
              }}
            />
          ))}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const n = await read($, selected)
    const { Box, Text, Image } = $.ui.resolve(e)
    const file = n === null ? null : await fileOf($, n)

    if (n === null || file === null) {
      return <Text dimColor>No image.</Text>
    }

    const size = await sizeOf($, file)
    const box = fit(size, Math.max(8, (e.viewport?.columns ?? 80) - 6), Math.max(4, (e.viewport?.rows ?? 24) - 6))

    return (
      <Box flexDirection="column">
        <Image key={`big-${n}`} source={{ file, format: 'png' }} {...box} alt={`Image #${n}`} />
        <Text dimColor>
          #{n} · {size.w}×{size.h}px
        </Text>
      </Box>
    )
  })
}
