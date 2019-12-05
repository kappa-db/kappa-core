const SimpleState = require('./util/state')

module.exports = (...args) => new HypercoreSource(...args)

class HypercoreSource {
  constructor (opts = {}) {
    this.feed = opts.feed
    this.maxBatch = opts.maxBatch || 50
    this.state = opts.state || new SimpleState(opts)
  }

  open (flow, cb) {
    this.flow = flow
    this.feed.on('append', () => flow.update())
    this.feed.on('download', () => flow.update())
    this.feed.ready(cb)
  }

  fetchVersion (cb) {
    this.state.fetchVersion(cb)
  }

  storeVersion (version, cb) {
    this.state.storeVersion(version, cb)
  }

  reset (cb) {
    this.state.set(0, cb)
  }

  get name () {
    return this.feed.key.toString('hex')
  }

  pull (cb) {
    this.state.get(this.name, (err, seq) => {
      if (err) return cb(err)
      return this._pull(seq, cb)
    })
  }

  reset (cb) {
    this.state.put(this.name, 0, cb)
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
          self.state.put(self.name, to, cb)
        }
      })
    })
  }
}
