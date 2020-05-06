const thunky = require('thunky')
const { EventEmitter } = require('events')

const Status = {
  Ready: 'ready',
  Running: 'running',
  Paused: 'paused',
  Error: 'error'
}

module.exports = class Kappa extends EventEmitter {
  /**
   * Create a kappa core.
   * @constructor
   */
  constructor (opts = {}) {
    super()
    this.flows = {}
    // APIs
    this.view = {}
    this.source = {}
  }

  // This is here for backwards compatibility.
  get api () { return this.view }

  use (name, source, view, opts = {}) {
    opts.status = opts.status || this.status
    opts.context = opts.context || this
    const flow = new Flow(name, source, view, opts)
    this.flows[name] = flow
    this.view[name] = flow.view
    this.source[name] = flow.source
    flow.on('error', err => this.emit('error', err, flow))

    if (this.status !== Status.Paused) {
      process.nextTick(() => flow.open(err => {
        if (err) this.emit('error', err)
      }))
    }

    this.emit('flow', name)
    return flow
  }

  pause () {
    this.status = Status.Paused
    Object.values(this.flows).forEach(flow => flow.pause())
  }

  resume () {
    if (this.status !== Status.Paused) return
    Object.values(this.flows).forEach(flow => flow.resume())
    this.status = Status.Ready
  }

  reset (name, cb) {
    const flow = this.flows[name]
    if (!flow) return cb(new Error('Unknown flow: ' + name))
    flow.reset(cb)
  }

  ready (names, cb) {
    if (typeof names === 'function') return this.ready(null, names)
    if (typeof names === 'string') names = [names]
    if (!names) names = Object.keys(this.flows)
    if (!names.length) return cb()
    cb = once(cb)

    let pending = names.length
    for (const name of names) {
      const flow = this.flows[name]
      if (!flow) return cb(new Error('Unknown flow: ' + name))
      flow.ready(done)
    }
    function done () {
      if (--pending === 0) cb()
    }
  }

  close (cb) {
    cb = once(cb)
    let flows = Object.values(this.flows)
    let pending = flows.length
    if (!pending) return done()
    flows.forEach(flow => flow.close(done))
    function done (err) {
      if (err) return cb(err)
      if (--pending === 0) cb()
    }
  }
}

class Flow extends EventEmitter {
  constructor (name, source, view, opts) {
    super()

    this.opts = opts
    this.name = name

    if (!view.version) view.version = 1

    // TODO: Backward-compatibility only. Remove.
    if (view.clearIndex && !view.reset) {
      view.reset = view.clearIndex.bind(view)
    }

    this._view = view
    this._source = source

    this.context = opts.context
    this.status = opts.status || Status.Ready
    this._indexingState = {}

    // Assign view and source apis
    this.view = {}
    this.source = {}
    this.view.ready = cb => this.ready(cb)
    if (view.api) {
      for (let [key, value] of Object.entries(view.api)) {
        this.view[key] = bindFn(value, this, this.context)
      }
    }
    if (source.api) {
      for (let [key, value] of Object.entries(source.api)) {
        this.source[key] = bindFn(value, this, this.context)
      }
    }

    // Create the list of funtions through which messages run between pull and map.
    this._transform = new Pipeline()
    if (this._source.transform) this._transform.push(this._source.transform.bind(this._source))
    if (this.opts.transform) this._transform.push(this.opts.transform)
    if (this._view.transform) this._transform.push(this._view.transform.bind(this._view))

    this.opened = false
    this.open = thunky(this._open.bind(this))
  }

  get version () {
    return this._view.version
  }

  _open (cb = noop) {
    if (this.opened) return cb()
    const self = this
    let done = false
    let pending = 1
    if (this._view.open) ++pending && this._view.open(this, onopen)
    if (this._source.open) ++pending && this._source.open(this, onopen)
    onopen()

    function onopen (err) {
      if (err) return ondone(err)
      if (--pending !== 0) return
      if (!self._source.fetchVersion) return ondone()

      self._source.fetchVersion((err, version) => {
        if (err) return ondone(err)
        if (!version) {
          self._source.storeVersion(self.version, ondone)
        } else if (version !== self.version) {
          self.reset(() => {
            self._source.storeVersion(self.version, ondone)
          })
        } else {
          ondone()
        }
      })
    }

    function ondone (err) {
      if (done) return
      done = true
      if (err) return cb(err)
      self.opened = true
      self._run()
      cb()
    }
  }

  close (cb) {
    const self = this
    this.pause()
    this._closing = true
    if (this.status === Status.Running) return this.once('ready', close)
    else close()
    function close () {
      let pending = 1
      if (self._source.close) ++pending && self._source.close(done)
      if (self._view.close) ++pending && self._view.close(done)
      done()
      function done () {
        if (--pending !== 0) return
        self._closing = false
        self.opened = false
        cb()
      }
    }
  }

  ready (cb) {
    const self = this
    if (!this.opened) return this.open(() => this.ready(cb))

    setImmediate(() => {
      if (this.source.ready) this.source.ready(onsourceready)
      else if (this._source.ready) this._source.ready(onsourceready)
      else onsourceready()
    })

    function onsourceready () {
      process.nextTick(() => {
        if (self.status === Status.Ready) process.nextTick(cb)
        else self.once('ready', cb)
      })
    }
  }

  pause () {
    this.status = Status.Paused
  }

  resume () {
    if (this.status !== Status.Paused) return
    this.status = Status.Ready
    if (!this.opened) return this.open()
    this._run()
  }

  reset (cb = noop) {
    const self = this
    this.pause()
    let pending = 1
    process.nextTick(() => {
      if (this._view.reset) ++pending && this._view.reset(done)
      if (this._source.reset) ++pending && this._source.reset(done)
      done()
    })
    function done () {
      if (--pending !== 0) return
      self.resume()
      cb()
    }
  }

  update () {
    if (!this.opened) return
    this.incomingUpdate = true
    process.nextTick(this._run.bind(this))
  }

  getState () {
    return { status: this.status, ...this._indexingState }
  }

  _run () {
    const self = this
    if (!this.opened) return
    if (this.status === Status.Running) return
    if (this.status === Status.Paused) return

    this.status = Status.Running

    this.emit('state-update', self.getState())

    this._source.pull(onbatch)

    function onbatch (result) {
      if (self.status === Status.Paused) return

      if (!result) return close()
      let { error, messages, finished, onindexed } = result
      if (error) return close(error)
      if (!messages) return close()

      messages = messages.filter(m => m)
      if (!messages.length) return close()

      self._transform.run(messages, messages => {
        if (!messages.length) return close()
        // TODO: Handle timeout?
        self._view.map(messages, err => {
          close(err, messages, finished, onindexed)
        })
      })
    }

    function close (err, messages, finished, onindexed) {
      if (err) return finish(err)
      if (messages && messages.length && self._view.indexed) {
        self._view.indexed(messages)
      }
      if (onindexed) {
        onindexed((err, status) => {
          if (!err && status) self._indexingState = Object.assign(self._indexingState, { error: null }, status)
          finish(err, finished)
        })
      } else finish(null, finished)
    }

    function finish (err, finished = true) {
      if (err) {
        self.status = Status.Error
        self._indexingState.error = err
        self.emit('error', err)
      } else {
        self.status = Status.Ready
      }

      if (self._closing) return self.emit('ready')

      if (!err && (self.incomingUpdate || !finished)) {
        self.incomingUpdate = false
        process.nextTick(self._run.bind(self))
      } else {
        self.emit('state-update', self.getState())
        if (!err) self.emit('ready')
      }
    }
  }
}

// Utils

function bindFn (value, ...binds) {
  if (typeof value === 'function') value = value.bind(...binds)
  return value
}

class Pipeline {
  constructor () {
    this.fns = []
  }

  push (fn) {
    this.fns.push(fn)
  }

  run (messages, final) {
    runThrough(messages, this.fns, final)
  }
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

function noop () {}

function once (fn) {
  let called = false
  return (...args) => {
    if (called) return
    called = true
    fn(...args)
  }
}
