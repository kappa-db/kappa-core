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
    this.open = thunky(this._open.bind(this))
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
    view.name = name
    this.views[name] = view

    if (view.api) {
      this._assignApi(name, view.api)
    }

    if (this.opts.autoconnect) {
      Object.keys(this.sources).forEach(sourceName => this.connect(sourceName, name))
      this.on('source', sourceName => this.connect(sourceName, name))
    }

    this.emit('view', view.name, view)
  }

  /**
   * Register a stack of views in the kappa.
   *
   * All views will run together and in the order as passed in.
   * If the view has an API, set its name property.
   *
   * @param {string} name a unique name for this stack
   * @param {Array} views an array of view handler objects
   */
  useStack (name, views) {
    views.forEach(view => {
      if (view.name) this._assignApi(view.name, view.api)
    })

    this.use(name, new StackedView(views))
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
      for (const view of Object.values(this.views)) {
        this.connect(source.name, view.name)
      }
    }
  }

  ready (viewNames, cb) {
    if (!this._opened) return this.open(this.ready.bind(this, viewNames, cb))
    if (typeof viewNames === 'function') return this.ready(null, viewNames)
    if (typeof viewNames === 'string') viewNames = [viewNames]
    if (!viewNames) viewNames = Object.keys(this.views)

    // wait a tick
    process.nextTick(() => {
      let pending = viewNames.length
      viewNames.forEach(viewName => this._onViewIndexed(viewName, done))
      function done () {
        if (--pending === 0) cb()
      }
    })
  }

  _open (cb) {
    const self = this
    if (this.opts.autoconnect) this.connectAll()

    let pending = this.flows.length + 1
    this.flows.forEach(flow => flow.open(finish))
    finish()

    function finish () {
      if (--pending !== 0) return
      self._opened = true
      process.nextTick(cb)
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
    const flows = this.flowsByView(viewName)

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

  flowsByView (name) {
    return this.flows.filter(flow => {
      if (flow.view.name === name) return true
      if (flow.view.views) return !!flow.view.views.find(view => view.name === name)
      return false
    })
  }

  flowsBySource (name) {
    return this.flows.filter(flow => flow.source.name === name)
  }

  _onViewIndexed (name, cb) {
    const flows = this.flowsByView(name)
    let pending = flows.length + 1
    this.flows.forEach(flow => flow.ready(done))
    done()
    function done () {
      if (--pending === 0) cb()
    }
  }

  _assignApi (name, api = {}) {
    const self = this
    this.api[name] = {
      name,
      ready (cb) {
        self._onViewIndexed(name, cb)
      }
    }
    const context = this.opts.context || this
    for (let [key, value] of Object.entries(api)) {
      if (typeof value === 'function') value = value.bind(this.api[name], context)
      this.api[name][key] = value
    }
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

class StackedView {
  constructor (views) {
    this.views = views
  }

  open (cb) {
    const self = this
    next()
    function next (idx = 0) {
      if (idx === self.views.length) return cb()
      if (self.views[idx].open) self.views[idx].open(() => process.nextTick(next, idx + 1))
      else next(idx + 1)
    }
  }

  map (msgs, cb) {
    const self = this
    next()
    function next (idx = 0) {
      if (idx === self.views.length) return cb()
      applyView(self.views[idx], msgs, () => process.nextTick(next, idx + 1))
    }
  }

  clearIndex (cb) {
    let pending = this.views.length
    this.views.views.forEach(view => view.clearIndex ? view.clearIndex(done) : done())
    function done () { --pending === 0 && cb() }
  }

  get api () {
    return this.views.reduce((agg, view) => {
      agg[view.name] = view.api
      return agg
    }, {})
  }
}

class Flow extends EventEmitter {
  constructor (kappa, view, createSource, opts) {
    super()
    this.kappa = kappa
    this.view = view
    this.opts = opts

    const context = {
      onupdate: this._onupdate.bind(this),
      view
    }

    this.source = createSource(context, opts)
    if (!this.source.name) this.source.name = opts.name

    this.name = this.source.name + '~' + this.view.name

    this.status = Status.Ready
    this._opened = false
    this.open = thunky(this._open.bind(this))
  }

  _open (cb = noop) {
    if (this._opened) return cb()
    const self = this

    awaitAll([this.view, this.source], 'open', finish)

    function finish () {
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
    if (!msgs.length) cb(null, msgs)
    let prepare = [this.source.transform, this.opts.transform]
    runThrough(msgs, prepare, msgs => {
      applyView(this.view, msgs, () => cb(null, msgs))
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

function applyView (view, msgs, cb) {
  const prepare = [view.filter, view.transform]
  runThrough(msgs, prepare, (msgs) => {
    if (!msgs.length) return cb()
    view.map(msgs, cb)
  })
}

function runThrough (state, fns, final) {
  fns = fns.filter(f => f)
  next(state)
  function next (state) {
    const fn = fns.shift()
    if (!fn) return final(state)
    fn(state, nextState => {
      process.nextTick(next, nextState)
    })
  }
}

function awaitAll (objs, fn, args, cb) {
  if (typeof args === 'function') return awaitAll(objs, fn, [], args)
  objs = objs.filter(obj => obj[fn])
  let pending = objs.length
  if (!pending) return cb()
  args.push(done)
  objs.forEach(obj => obj[fn](...args))
  function done () {
    if (--pending === 0) cb()
  }
}

function noop () {}
