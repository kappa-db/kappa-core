module.exports = function createSimpleSource (opts = {}) {
  const buf = []
  const maxBatch = opts.maxBatch || 10
  let flow = null
  let state = 0
  let error = null

  const source = {
    open (_flow, next) {
      flow = _flow
      next()
    },
    pull (next) {
      if (error) return next({ error })
      const max = buf.length
      const end = Math.min(state + maxBatch, max)
      const messages = buf.slice(state, end)
      const lastState = state
      next({
        messages,
        finished: end === max,
        onindexed (cb) {
          state = end
          cb(null, {
            totalBlocks: buf.length,
            indexedBlocks: end,
            prevIndexedBlocks: lastState
          })
        }
      })
    },
    reset (next) {
      state = 0
      next()
    },
    get api () {
      return {
        push (kappa, value) {
          if (!Array.isArray(value)) value = [value]
          buf.push(...value)
          if (flow) flow.update()
        },
        error (kappa, err) {
          error = err
          if (flow) flow.update()
        }
      }
    }
  }

  return source
}
