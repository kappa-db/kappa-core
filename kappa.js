const thunky = require('thunky')
const { EventEmitter } = require('events')

const Status = {
  Ready: 0,
  Running: 1,
  Paused: 2
}

module.exports = class Kappa extends EventEmitter {
  /**
   * Create a kappa core.
   * @constructor
   */
  constructor (opts = {}) {
    super()
    this.opts = {
      autoconnect: true,
      autostart: true,
      ...opts
    }
    this.views = {}
    this.sources = {}
    this.api = {}
    this.flows = []
    this._flowsByName = {}
    this._states = {}
    this._status = Status.Ready
    this.ready = thunky(this._ready.bind(this))
  }

  /**
   * Register a view in the kappa.
   *
   * @param {string} name a unique name for this view
   * @param {object} view handlers object
   * @param {function(msgs, next)} view.map process messages
   * @param {function(msgs, next)} [view.filter] filter messages before map
   * @param {function(msgs, next)} [view.clearIndex] clear index
   */
  use (name, view) {
    const self = this
    view.name = name
    this.views[name] = view

    if (view.api) {
      this.api[name] = {
        ready (cb) {
          self.onViewIndexed(name, cb)
        }
      }
      for (let [key, value] of Object.entries(view.api)) {
        if (typeof value === 'function') value = value.bind(this.api[name], this)
        this.api[name][key] = value
      }
    }

    if (this.opts.autoconnect) {
      Object.keys(this.sources).forEach(sourceName => this.connect(sourceName, name))
      this.on('source', sourceName => this.connect(sourceName, name))
    }

    this.emit('view', view.name, view)
  }

  /**
   * Register a source in the kappa.
   *
   * @param {string} name a unique name for this source
   * @param {function} createSource source constructor
   * @param {opts} opts
   */
  source (name, createSource, opts = {}) {
    if (this.sources[name]) return
    opts.name = name
    this.sources[name] = { name, createSource, opts }

    if (this.opts.autoconnect) {
      Object.keys(this.views).forEach(viewName => this.connect(name, viewName))
      this.on('view', viewName => this.connect(name, viewName))
    }

    this.emit('source', name)
  }

  /**
   * Connect a source to a view. Creates a new flow.
   *
   * @param {string} sourceName
   * @param {string} viewName
   * @return {object} flow
   */
  connect (sourceName, viewName) {
    if (!this.views[viewName]) throw new Error('Unknown view: ' + viewName)
    if (!this.sources[sourceName]) throw new Error('Unknown source: ' + sourceName)

    const flowName = sourceName + '~' + viewName
    if (this._flowsByName[flowName]) return this._flowsByName[flowName]

    const view = this.views[viewName]
    const { createSource, opts } = this.sources[sourceName]

    const flow = new Flow(this, view, createSource, opts)

    this.flows.push(flow)
    this._flowsByName[flow.name] = flow

    if (this.opts.autostart) flow.open()

    this.emit('connect', sourceName, viewName)

    return flow
  }

  connectAll () {
    for (const source of Object.values(this.sources)) {
      if (source.parent) continue
      for (const view of Object.values(this.views)) {
        this.connect(source.name, view.name)
      }
    }
  }

  onViewIndexed (name, cb) {
    const flows = this._flowsByView(name).filter(f => !f.parent)
    let pending = flows.length + 1
    flows.forEach(flow => flow.ready(done))
    done()
    function done () {
      if (--pending === 0) cb()
    }
  }

  _ready (cb) {
    if (this.opts.autoconnect) this.connectAll()

    let pending = this.flows.length + 1
    this.flows.forEach(flow => flow.open(finish))
    finish()

    function finish () {
      if (--pending === 0) process.nextTick(cb)
    }
  }

  pause (cb) {
    this.status = Status.Paused
    this.flows.forEach(flow => flow.pause())
  }

  resume (cb) {
    if (this.status === Status.Paused) {
      this.flows.forEach(flow => flow.resume())
      this.status = Status.Ready
    }
  }

  clear (viewName, cb) {
    const view = this.views[viewName]
    if (!view) throw new Error('Unknown view: ' + viewName)
    const flows = this._flowsByView(viewName)

    flows.forEach(flow => flow.pause())
    let pending = flows.length + 1
    if (view.clearIndex) view.clearIndex(restartFlows)
    else restartFlows()

    function restartFlows () {
      flows.forEach(flow => flow.restart(finish))
      finish()
    }
    function finish () {
      if (--pending === 0 && cb) cb()
    }
  }

  _flowsByView (name) {
    return this.flows.filter(flow => flow.view.name === name)
  }

  _flowsBySource (name) {
    return this.flows.filter(flow => flow.source.name === name)
  }

  _fetchState (flow, cb) {
    // if (flow.view.fetchState) return flow.view.fetchState(flow, cb)
    cb(null, this._states[flow.name])
  }

  _storeState (flow, state, cb) {
    // if (flow.view.storeState) return flow.view.storeState(flow, state, cb)
    this._states[flow.name] = state
    cb()
  }
}

class Flow extends EventEmitter {
  constructor (kappa, view, createSource, opts) {
    super()
    this.kappa = kappa
    this.view = view
    this.opts = opts

    this.source = createSource({
      onupdate: this._onupdate.bind(this)
    }, opts, this.kappa)
    if (!this.source.name) this.source.name = opts.name

    this.name = this.source.name + '~' + this.view.name
    this.parent = opts.parent

    this.status = Status.Ready
    this._opened = false
    this.open = thunky(this._open.bind(this))
  }

  _open (cb = noop) {
    if (this._opened) return cb()
    const self = this

    let pending = 1
    if (this.view.open) ++pending && this.view.open(finish)
    if (this.source.open) ++pending && this.source.open(finish)
    finish()

    function finish () {
      if (--pending !== 0) return
      self._opened = true
      self._run()
      cb()
    }
  }

  ready (cb = noop) {
    const self = this

    if (!this._opened) return this.open(() => this.ready(cb))

    if (self.status === Status.Ready) process.nextTick(cb)
    else self.once('ready', cb)
  }

  pause () {
    this.status = Status.Paused
  }

  resume () {
    if (this.status !== Status.Paused) return
    this.status = Status.Ready
    if (!this._opened) this.open()
    else this._run()
  }

  restart (cb = noop) {
    this.pause()
    process.nextTick(() => {
      this.kappa._storeState(this, null, () => {
        this.resume()
        cb()
      })
    })
  }

  _onupdate () {
    if (!this._opened) return
    this.incomingUpdate = true
    process.nextTick(this._run.bind(this))
  }

  _onbatch (msgs, cb) {
    let steps = [
      this.source.transform,
      this.view.filter,
      this.view.transform
    ].filter(f => f)
    runAll(msgs, steps, msgs => {
      if (!msgs.length) cb(null, msgs)
      else this.view.map(msgs, () => cb(null, msgs))
    })
  }

  _run () {
    const self = this
    if (!this._opened) throw new Error('Flow is not opened.')
    if (this.status === Status.Running) return
    if (this.status === Status.Paused) return

    this.status = Status.Running

    this.kappa._fetchState(this, (err, state) => {
      if (err) return close(err)
      this.source.pull(state, onbatch)
    })

    function onbatch (nextState, msgs, workMore) {
      msgs = msgs || []
      if (self.status === Status.Paused) return close()
      self._onbatch(msgs, (err, msgs) => {
        if (err) return close(err)
        self.kappa._storeState(self, nextState, err => {
          close(err, msgs, workMore)
        })
      })
    }

    function close (err, msgs, workMore) {
      if (err) self.kappa.emit(err, this)
      else if (msgs.length && self.view.indexed) {
        self.view.indexed(msgs)
      }
      self.status = Status.Ready
      if (self.incomingUpdate || workMore) {
        self.incomingUpdate = false
        process.nextTick(self._run.bind(self))
      } else {
        self.emit('ready')
      }
    }
  }
}

function runAll (state, fns, final) {
  next(state)
  function next (state) {
    const fn = fns.shift()
    if (!fn) return final(state)
    fn(state, nextState => {
      process.nextTick(next, nextState)
    })
  }
}

function noop () {}
