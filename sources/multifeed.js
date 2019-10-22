const hypercoreSource = require('./hypercore')

module.exports = function multifeedSource (handlers, opts) {
  const feeds = opts.feeds

  return { open, pull }

  function pull (state, next) {
    next(state)
  }

  function open (next) {
    feeds.ready(() => {
      let pending = feeds.feeds().length + 1
      feeds.feeds().forEach(feed => _onfeed(feed, done))
      feeds.on('feed', feed => _onfeed(feed))
      done()
      function done () {
        if (!--pending) next()
      }
    })
  }

  function _onfeed (feed, cb) {
    feed.ready(() => {
      const name = feed.key.toString('hex')
      handlers.onsource(name, hypercoreSource, { feed })
      if (cb) cb()
    })
  }
}
