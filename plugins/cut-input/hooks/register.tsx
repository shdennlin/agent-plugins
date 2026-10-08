import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const hasText = atom({ plugin: 'cut-input', key: 'hasText' } as const, false)

export const register: Register = on => {
  // ctrl+shift+u cuts the whole draft, regardless of cursor position
  on('prompt.edit', async ($, e, next) => {
    const isKillAll = e.key?.ctrl === true && e.key.shift === true && e.key.key === 'u'

    if (isKillAll && e.text !== '') {
      const { isCopied } = await $.ui.copy({ text: e.text })

      if (!isCopied) {
        return next(e)
      }

      await update($, hasText, () => false)

      return { text: '', cursor: 0 }
    }

    const result = await next(e)

    await update($, hasText, () => result.text !== '')

    return result
  })

  on('prompt.fill', async ($, e, next) => {
    const result = await next(e)
    await update($, hasText, () => result.isFilled ? e.mode !== 'replace' || e.text !== '' : false)

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    update($, hasText, () => false).catch(() => {})

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, hasText))) {
      return next(e)
    }

    const { Box, Button } = $.ui.resolve(e)
    const below = await next(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box justifyContent="flex-end">
          <Button
            key="cut"
            label="✂ Cut input"
            onPress={async press => {
              const { text } = await $.prompt.read()

              if (text === '') {
                return
              }

              const { isCopied } = await $.ui.copy({ text, surface: press.surface })

              if (!isCopied) {
                $.ui.toast('Copy failed, input kept')
                return
              }

              await $.prompt.fill({ text: '' })
              await update($, hasText, () => false)
              $.ui.toast('Copied and cleared')
            }}
          />
        </Box>
      </Box>
    )
  })
}
