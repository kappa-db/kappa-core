const Kappa = require('./kappa')

module.exports = kappaClassic
module.exports.Kappa = Kappa

function kappaClassic (storage, opts = {}) {
  const multifeed = require('multifeed')
  const hypercore = require('hypercore')
  const multifeedSource = require('./sources/multifeed')

  const feeds = opts.multifeed || multifeed(hypercore, storage, opts)

  const kappa = new Kappa()

  kappa.source('multifeed', multifeedSource, { feeds })

  kappa.writer = feeds.writer.bind(feeds)
  kappa.feed = feeds.feed.bind(feeds)
  kappa.replicate = feeds.replicate.bind(feeds)
  kappa._logs = feeds

  return kappa
}
