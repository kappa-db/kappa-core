module.exports = function hypercoreSource (handlers, opts) {
  const maxBatch = opts.maxBatch || 50
  const feed = opts.feed

  return { open, start }

  function open (next) {
    feed.ready(function () {
      feed.on('append', handlers.onupdate)
      feed.on('download', handlers.onupdate)
      next()
    })
  }

  function start (state, next) {
    const at = state || 0
    const to = Math.min(feed.length, at + maxBatch)
    if (!(to > at)) return next(at)
    if (!feed.has(at, to)) {
      return next(at)
    }
    feed.getBatch(at, to, { wait: false }, (err, res) => {
      if (err) return handlers.onerror(err)
      res = res.map((node, i) => ({
        key: feed.key.toString('hex'),
        seq: at + i,
        value: node
      }))
      next(to, res, to < feed.length)
    })
  }
}
