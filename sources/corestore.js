const hypercoreSource = require('./hypercore')
const multi = require('./util/multisource')

module.exports = function corestoreSource (handlers, opts) {
  const store = opts.store
  const { pull, addSource } = multi(handlers)

  return { open, pull }

  function open (next) {
    store.ready(() => {
      store.list().forEach(feed => _onfeed(feed))
      store.on('feed', feed => _onfeed(feed))
      next()
    })
  }

  function _onfeed (feed, cb) {
    feed.ready(() => {
      addSource(feed.key.toString('hex'), hypercoreSource, { feed })
    })
  }
}
