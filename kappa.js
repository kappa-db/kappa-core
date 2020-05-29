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
    this.status = Status.Ready
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
    flow.on('state-update', state => this.emit('state-update', name, state))

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
    this._forEach(flow => flow.pause())
  }

  resume () {
    if (this.status !== Status.Paused) return
    this._forEach(flow => flow.resume())
    this.status = Status.Ready
  }

  reset (names, cb) {
    this._forEachAsync((flow, next) => {
      flow.reset(next)
    }, names, cb)
  }

  ready (names, cb) {
    this._forEachAsync((flow, next) => {
      flow.ready(next)
    }, names, cb)
  }

  close (cb) {
    this._forEachAsync((flow, next) => {
      flow.close(next)
    }, cb)
  }

  _forEach (fn, names) {
    if (typeof names === 'string') names = [names]
    if (!names) names = Object.keys(this.flows)
    for (const name of names) {
      if (!this.flows[name]) continue
      fn(this.flows[name])
    }
  }

  _forEachAsync (fn, names, cb) {
    if (typeof names === 'function') {
      cb = names
      names = null
    }
    cb = once(cb)
    let pending = 1
    this._forEach(flow => {
      ++pending
      fn(flow, done)
    }, names)
    done()
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

    this._context = opts.context
    this._status = opts.status || Status.Ready
    this._indexingState = {}

    // Assign view and source apis
    this.view = bindApi(view.api, this._context)
    this.view.ready = cb => this.ready(cb)
    this.source = bindApi(source.api, this._context)

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
    if (this._status === Status.Running) return this.once('ready', close)
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
        if (self._status === Status.Ready) process.nextTick(cb)
        else self.once('ready', cb)
      })
    }
  }

  pause () {
    this._status = Status.Paused
  }

  resume () {
    if (this._status !== Status.Paused) return
    this._status = Status.Ready
    if (!this.opened) return this.open()
    this._run()
  }

  reset (cb = noop) {
    const self = this
    const paused = this._status === Status.Paused
    this.pause()
    let pending = 1
    process.nextTick(() => {
      if (this._view.reset) ++pending && this._view.reset(done)
      if (this._source.reset) ++pending && this._source.reset(done)
      done()
    })
    function done () {
      if (--pending !== 0) return
      if (!paused) self.resume()
      cb()
    }
  }

  update () {
    if (!this.opened) return
    this.incomingUpdate = true
    process.nextTick(this._run.bind(this))
  }

  getState () {
    return { status: this._status, ...this._indexingState }
  }

  _run () {
    const self = this
    if (!this.opened) return
    if (this._status === Status.Running) return
    if (this._status === Status.Paused) return

    this._status = Status.Running

    this.emit('state-update', self.getState())

    this._source.pull(onbatch)

    function onbatch (result) {
      if (self._status === Status.Paused) return

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
        onindexed((err, _status) => {
          if (!err && _status) self._indexingState = Object.assign(self._indexingState, { error: null }, _status)
          finish(err, finished)
        })
      } else finish(null, finished)
    }

    function finish (err, finished = true) {
      if (err) {
        self._status = Status.Error
        self._indexingState.error = err
        self.emit('error', err)
      } else {
        self._status = Status.Ready
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

function bindApi (api, ...binds) {
  if (!api) return {}
  for (let [key, value] of Object.entries(api)) {
    if (typeof value !== 'function') continue
    api[key] = value.bind(api, ...binds)
  }
  return api
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
