const hypercoreSource = require('./hypercore')
const mergePull = require('./util/merge-pull')
const SimpleState = require('./util/state')

module.exports = function multifeedSource (opts) {
  const state = new SimpleState(opts)
  const feeds = opts.feeds
  const sources = []

  return {
    open (flow, next) {
      feeds.ready(() => {
        feeds.feeds().forEach(feed => onfeed(flow, feed))
        feeds.on('feed', feed => onfeed(flow, feed))
        next()
      })
    },
    pull (next) {
      mergePull(sources, next)
    },
    reset (cb) {
      let pending = sources.length
      sources.forEach(source => source.reset(done))
      function done () {
        if (--pending === 0) cb()
      }
    },
    fetchVersion (cb) { state.fetchVersion(cb) },
    storeVersion (version, cb) { state.storeVersion(version, cb) }
  }

  function onfeed (flow, feed, cb) {
    const source = hypercoreSource({
      feed,
      state
    })
    sources.push(source)
    source.open(flow, () => {
      flow.update()
      if (cb) cb()
    })
  }
}
