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

    this.emit('flow', name)

    if (this.status !== Status.Paused) flow.open()

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
    let flows = Object.values(this.flows)
    let pending = flows.length
    if (!pending) done()
    // TODO: Propagate errors?
    flows.forEach(flow => flow.close(done))
    function done () {
      if (--pending === 0) cb()
    }
  }
}

class Flow extends EventEmitter {
  constructor (name, source, view, opts) {
    super()

    this.opts = opts
    this.name = name

    this._view = view
    this._source = source

    this.context = opts.context
    this.status = opts.status || Status.Ready

    // Assign view and source apis
    this.view = {}
    this.source = {}
    this.view.ready = cb => this.ready(cb)
    if (view.api) {
      for (let [key, value] of Object.entries(view.api)) {
        this.view[key] = bindFn(value, this, this.context)
      }
      delete view.api
    }
    if (source.api) {
      for (let [key, value] of Object.entries(source.api)) {
        this.source[key] = bindFn(value, this, this.context)
      }
      delete source.api
    }

    // Create the list of funtions through which messages run between pull and map.
    this._transform = new Pipeline()
    if (this._source.transform) this._transform.push(this._source.transform.bind(this._source))
    if (this.opts.transform) this._transform.push(this.opts.transform)
    if (this._view.transform) this._transform.push(this._view.transform.bind(this._view))
    if (this._view.filter) this._transform.push(this._view.filter.bind(this._view))

    this._opened = false
    this.open = thunky(this._open.bind(this))
  }

  get version () {
    return this._view.version || 1
  }

  _open (cb = noop) {
    if (this._opened) return cb()
    const self = this

    let pending = 1
    if (this._view.open) ++pending && this._view.open(this, onopen)
    if (this._source.open) ++pending && this._source.open(this, onopen)
    onopen()

    function onopen () {
      if (--pending !== 0) return
      if (self._source.fetchVersion) {
        self._source.fetchVersion((err, version) => {
          if (err) return ondone()
          if (!version) return self._source.storeVersion(self.version, ondone)
          if (version !== self.version) {
            self.reset(() => self._source.storeVersion(self.version, ondone))
          } else ondone()
        })
      } else ondone()
    }

    function ondone () {
      self._opened = true
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
      if (self._source.close) ++pending && self._source.close(cb)
      if (self._view.close) ++pending && self._view.close(cb)
      done()
      function done () {
        if (--pending !== 0) return
        self._closing = false
        self._opened = false
        cb()
      }
    }
  }

  ready (cb, waitForSource) {
    const self = this
    if (!this._opened) return this.open(() => this.ready(cb))

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
    if (!this._opened) return this.open()
    this._run()
  }

  reset (cb = noop) {
    const self = this
    this.pause()
    let pending = 1
    process.nextTick(() => {
      if (this._view.clearIndex) ++pending && this._view.clearIndex(done)
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
    if (!this._opened) return
    this.incomingUpdate = true
    process.nextTick(this._run.bind(this))
  }

  _run () {
    const self = this
    if (!this._opened) return
    if (this.status === Status.Running) return
    if (this.status === Status.Paused) return

    this.status = Status.Running

    this._source.pull(onbatch)

    function onbatch (result) {
      if (self.status === Status.Paused) return close()
      if (!result || !result.messages.length) return close(null, result)

      const { messages = [], finished, onindexed } = result

      // TODO: Handle timeout / error?
      self._transform.run(messages, messages => {
        if (!messages.length) return close(null, { messages, finished, onindexed })
        self._view.map(messages, () => {
          close(null, { messages, finished, onindexed })
        })
      })
    }

    function close (err, result) {
      if (err) self.emit('error', err)
      if (!result) return finish(true)
      const { messages, finished, onindexed } = result
      if (messages.length && self._view.indexed) {
        self._view.indexed(messages)
      }
      if (onindexed) onindexed(() => finish(finished))
      else finish(finished)
    }

    function finish (finished) {
      self.status = Status.Ready
      if (self._closing) return self.emit('ready')
      if (self.incomingUpdate || !finished) {
        self.incomingUpdate = false
        process.nextTick(self._run.bind(self))
      } else {
        self.emit('ready')
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
