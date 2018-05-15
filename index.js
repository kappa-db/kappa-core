var hypercore = require('hypercore')
var multifeed = require('multifeed')
var indexer = require('multifeed-index')

module.exports = Kappa

function Kappa (storage, opts) {
  if (!(this instanceof Kappa)) return new Kappa(storage, opts)

  this._logs = multifeed(hypercore, storage, opts)
  this._indexes = {}

  this.api = {}
}

// TODO: support versions + checking to rebuild them
Kappa.prototype.use = function (name, view) {
  this._indexes[name] = indexer({
    log: this._logs,
    maxBatch: 10,
    batch: view.map
  })
  this.api[name] = {}
  for (var key in view.api) {
    this.api[name][key] = view.api[key].bind(this._indexes[name], this)
  }
}

Kappa.prototype.feed = function (name, cb) {
  this._logs.writer(name, cb)
}

Kappa.prototype.replicate = function (opts) {
  return this._logs.createReplicationStream(opts)
}
