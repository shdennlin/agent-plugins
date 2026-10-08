import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const hasText = atom({ plugin: 'cut-input', key: 'hasText' } as const, false)

export const register: Register = on => {
  // ctrl+u / ctrl+k kill text in the composer; also put the killed span on the clipboard
  on('prompt.edit', async ($, e, next) => {
    const result = await next(e)
    const isKill = e.key?.ctrl === true && (e.key.key === 'u' || e.key.key === 'k')
    const killed = e.text.slice(e.start, e.end)

    if (isKill && e.inputText === '' && killed !== '') {
      await $.ui.copy({ text: killed })
    }

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
