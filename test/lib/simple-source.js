module.exports = (opts) => new SimpleSource(opts)

class SimpleSource {
  constructor (opts = {}) {
    this.buf = opts.data || []
    this.cursor = 0
    this.flow = null
    this.error = null
    this.maxBatch = opts.maxBatch || 10
  }

  open (flow, next) {
    this.flow = flow
    next()
  }

  pull (next) {
    if (this.error) return next({ error: this.error })
    const len = this.buf.length
    const end = Math.min(this.cursor + this.maxBatch, len)
    const messages = this.buf.slice(this.cursor, end)
    const lastState = this.cursor
    next({
      messages,
      finished: end === len,
      onindexed: cb => {
        this.cursor = end
        cb(null, {
          totalBlocks: this.buf.length,
          indexedBlocks: end,
          prevIndexedBlocks: lastState
        })
      }
    })
  }

  reset (cb) {
    this.cursor = 0
    cb()
  }

  get api () {
    const self = this
    return {
      push (kappa, value) {
        if (!Array.isArray(value)) value = [value]
        self.buf.push(...value)
        if (self.flow) self.flow.update()
      },
      error (kappa, err) {
        self.error = err
        if (self.flow) self.flow.update()
      }
    }
  }
}
