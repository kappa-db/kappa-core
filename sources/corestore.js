const hypercoreSource = require('./hypercore')
const mergePull = require('./util/merge-pull')
const SimpleState = require('./util/state')

module.exports = function corestoreSource (opts) {
  const state = new SimpleState(opts)
  const store = opts.store
  const sources = []
  return {
    open (flow, cb) {
      store.ready(() => {
        store.list().forEach(feed => _onfeed(flow, feed))
        store.on('feed', feed => _onfeed(flow, feed))
        cb()
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

  function _onfeed (flow, feed, cb) {
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
