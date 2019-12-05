const hypercoreSource = require('./hypercore')
const mergePull = require('./util/merge-pull')

module.exports = function corestoreSource (opts) {
  const store = opts.store
  const sources = []
  let flow = null
  return {
    open (_flow, cb) {
      flow = _flow
      store.ready(() => {
        store.list().forEach(feed => _onfeed(feed))
        store.on('feed', feed => _onfeed(feed))
        cb()
      })
    },
    pull (next) {
      mergePull(sources, next)
    }
  }

  function _onfeed (feed, cb) {
    feed.ready(() => {
      const source = hypercoreSource({
        feed,
        box: opts.box,
        prefix: (opts.prefix || '') + flow.name + '!' + feed.key.toString('hex')
      })
      sources.push(source)
      source.open(flow, () => {
        flow.update()
        if (cb) cb()
      })
    })
  }
}
