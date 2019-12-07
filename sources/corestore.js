const hypercoreSource = require('./hypercore')
const { mergePull, mergeReset } = require('./util/merge')
const SimpleState = require('./util/state')

module.exports = function corestoreSource (opts) {
  const state = opts.state || new SimpleState(opts)
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
    reset (next) {
      mergeReset(sources, next)
    },
    fetchVersion: state.fetchVersion,
    storeVersion: state.storeVersion,
    api: {
      feed (kappa, key) {
        return store.get({ key })
      }
    }
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
