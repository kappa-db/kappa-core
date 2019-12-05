const hypercoreSource = require('./hypercore')
const mergePull = require('./util/merge-pull')

module.exports = function multifeedSource (opts) {
  const multifeed = opts.feeds
  const box = opts.box
  let flow
  const sources = []

  return { pull, open }

  function open (_flow, next) {
    flow = _flow
    multifeed.ready(() => {
      multifeed.feeds().forEach(feed => _onfeed(feed))
      multifeed.on('feed', feed => _onfeed(feed))
      next()
    })
  }

  function pull (next) {
    mergePull(sources, next)
  }

  function _onfeed (feed, cb) {
    feed.ready(() => {
      const source = hypercoreSource({
        feed,
        box,
        prefix: feed.key.toString('hex')
      })
      sources.push(source)
      source.open(flow, cb)
    })
  }
}
