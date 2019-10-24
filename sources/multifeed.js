const hypercoreSource = require('./hypercore')
const multi = require('./util/multisource')

module.exports = function multifeedSource (handlers, opts) {
  const { pull, addSource } = multi(handlers)
  const multifeed = opts.feeds

  return { pull, open }

  function open (next) {
    multifeed.ready(() => {
      multifeed.feeds().forEach(feed => _onfeed(feed))
      multifeed.on('feed', feed => _onfeed(feed))
      next()
    })
  }

  function _onfeed (feed, cb) {
    feed.ready(() => {
      addSource(feed.key.toString('hex'), hypercoreSource, { feed })
    })
  }
}
