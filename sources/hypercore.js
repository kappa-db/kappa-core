const State = require('./util/state')

module.exports = (...args) => new HypercoreSource(...args)

class HypercoreSource {
  constructor (opts = {}) {
    this.opts = opts
    this.feed = opts.feed
    this.maxBatch = opts.maxBatch || 50
  }

  open (flow, cb) {
    this.flow = flow
    this.state = new State({
      prefix: flow.name,
      box: this.opts.box
    })
    this.feed.on('append', () => flow.update())
    this.feed.on('download', () => flow.update())
    this.flow.update()
    this.state.putVersion(flow.version, cb)
  }

  pull (cb) {
    this.state.get((err, seq) => {
      if (err) return cb(err)
      return this._pull(seq, cb)
    })
  }

  _pull (at, next) {
    const self = this
    const feed = this.feed
    const len = feed.length
    const to = Math.min(len, at + this.maxBatch)

    if (!(to > at)) return next()

    if (!feed.has(at, to)) {
      return next({ finished: true })
    }

    feed.getBatch(at, to, { wait: false }, (err, res) => {
      if (err) return next()

      res = res.map((node, i) => ({
        key: feed.key.toString('hex'),
        seq: at + i,
        value: node
      }))

      next({
        messages: res,
        finished: to === len,
        onindexed (cb) {
          self.state.put(to, cb)
        }
      })
    })
  }
}
