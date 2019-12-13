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

    // wait a tick
    process.nextTick(() => {
      let pending = names.length
      for (const name of names) {
        const flow = this.flows[name]
        if (!flow) return cb(new Error('Unknown flow: ' + name))
        flow.ready(done)
      }
      function done () {
        if (--pending === 0) cb()
      }
    })
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

  ready (cb) {
    if (!this._opened) return this.open(() => this.ready(cb))
    if (this.status === Status.Ready) process.nextTick(cb)
    else this.once('ready', cb)
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
    if (!this._opened) throw new Error('Flow is not opened.')
    if (this.status === Status.Running) return
    if (this.status === Status.Paused) return

    this.status = Status.Running

    this._source.pull(onbatch)

    function onbatch (result) {
      if (self.status === Status.Paused) return close()
      if (!result || !result.messages.length) return close(null, result)

      const { messages = [], finished, onindexed } = result

      let steps = [
        self._source.transform,
        self.opts.transform,
        self._view.transform,
        self._view.filter
      ]

      runThrough(messages, steps, messages => {
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
      if (self.incomingUpdate || !finished) {
        self.incomingUpdate = false
        process.nextTick(self._run.bind(self))
      } else {
        self.emit('ready')
      }
    }
  }
}

function bindFn (value, ...binds) {
  if (typeof value === 'function') value = value.bind(...binds)
  return value
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
