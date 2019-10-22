var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter
var hypercore = require('hypercore')
var multifeed = require('multifeed')
var indexer = require('multifeed-index')

module.exports = Kappa

function Kappa (storage, opts) {
  if (!(this instanceof Kappa)) return new Kappa(storage, opts)
  if (!opts) opts = {}

  this._logs = opts.multifeed || multifeed(hypercore, storage, opts)
  this._indexes = {}

  this.api = {}
}

inherits(Kappa, EventEmitter)

Kappa.prototype.use = function (name, version, view) {
  var self = this
  if (typeof version !== 'number') {
    view = version
    version = undefined
  }
  var idx = indexer(Object.assign({}, view, {
    log: this._logs,
    version: version,
    maxBatch: view.maxBatch || 10,
    batch: view.map
  }))
  idx.on('error', function (err) {
    self.emit('error', err)
  })
  if (view.indexed) idx.on('indexed', view.indexed)
  this._indexes[name] = idx
  this.api[name] = {}
  this.api[name].ready = idx.ready.bind(idx)
  for (var key in view.api) {
    if (typeof view.api[key] === 'function') this.api[name][key] = view.api[key].bind(idx, this)
    else this.api[name][key] = view.api[key]
  }
}

Kappa.prototype.feeds = function () {
  return this._logs.feeds()
}

Kappa.prototype.ready = function (viewNames, cb) {
  if (typeof viewNames === 'function') {
    cb = viewNames
    viewNames = []
  }

  if (typeof viewNames === 'string') viewNames = [viewNames]
  if (viewNames.length === 0) {
    viewNames = Object.keys(this._indexes)
  }

  var pending = viewNames.length + 1
  var self = this
  this._logs.ready(function () {
    for (var i = 0; i < viewNames.length; i++) {
      self._indexes[viewNames[i]].ready(done)
    }
    done()
  })

  function done () {
    if (!--pending) cb()
  }
}

Kappa.prototype.pause = function (viewNames, cb) {
  if (typeof viewNames === 'function') {
    cb = viewNames
    viewNames = []
  }
  cb = cb || noop

  if (!viewNames) viewNames = []
  if (typeof viewNames === 'string') viewNames = [viewNames]
  if (viewNames.length === 0) {
    viewNames = Object.keys(this._indexes)
  }

  var pending = viewNames.length + 1
  var self = this
  this._logs.ready(function () {
    for (var i = 0; i < viewNames.length; i++) {
      self._indexes[viewNames[i]].pause(done)
    }
    done()
  })

  function done () {
    if (!--pending) cb()
  }
}

Kappa.prototype.resume = function (viewNames) {
  if (!viewNames) viewNames = []
  if (typeof viewNames === 'string') viewNames = [viewNames]
  if (viewNames.length === 0) {
    viewNames = Object.keys(this._indexes)
  }

  var self = this
  this._logs.ready(function () {
    for (var i = 0; i < viewNames.length; i++) {
      self._indexes[viewNames[i]].resume()
    }
  })
}

Kappa.prototype.writer = function (name, cb) {
  this._logs.writer(name, cb)
}

Kappa.prototype.feed = function (key) {
  return this._logs.feed(key)
}

Kappa.prototype.replicate = function (opts) {
  return this._logs.replicate(opts)
}

function noop () {}
