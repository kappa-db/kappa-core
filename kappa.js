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
      autostart: true,
      ...opts
    }
    this.api = {}
    this.flows = {}
    this.open = thunky(this._open.bind(this))
  }

  use (name, source, view, opts = {}) {
    opts.name = name
    const flow = new Flow(this, { source, view, opts, status: this.status })
    this.flows[name] = flow
    this._assignApi(name, flow)
    if (this.opts.autostart) flow.open()
    this.emit('view', name)
    return flow
  }

  _open (cb) {
    const flows = Object.values(this.flows)
    let pending = flows.length
    Object.values(flows).forEach(flow => {
      flow.open(() => {
        if (--pending === 0) cb()
      })
    })
  }

  pause () {
    this.status = Status.Paused
    const flows = Object.values(this.flows)
    flows.forEach(flow => flow.pause())
  }

  resume () {
    const flows = Object.values(this.flows)
    if (this.status === Status.Paused) {
      flows.forEach(flow => {
        flow.resume()
      })
      this.status = Status.Ready
    }
  }

  reset (name, cb) {
    const flow = this.flows[name]
    if (!flow) return cb(new Error('Unknown flow: ' + name))
    flow.reset(cb)
  }

  ready (viewNames, cb) {
    if (typeof viewNames === 'function') return this.ready(null, viewNames)
    if (typeof viewNames === 'string') viewNames = [viewNames]
    if (!viewNames) viewNames = Object.keys(this.flows)

    // wait a tick
    process.nextTick(() => {
      let pending = viewNames.length
      viewNames.forEach(viewName => this._onViewIndexed(viewName, done))
      function done () {
        if (--pending === 0) cb()
      }
    })
  }

  _onViewIndexed (name, cb) {
    const flow = this.flows[name]
    if (!flow) return cb(new Error('Unknown view: ' + name))
    flow.ready(cb)
  }

  _assignApi (name, flow) {
    this.api[name] = {
      name,
      ready (cb) {
        flow.ready(cb)
      }
    }
    const context = this.opts.context || this
    if (flow.view.api) {
      for (let [key, value] of Object.entries(flow.view.api)) {
        if (typeof value === 'function') value = value.bind(this.api[name], context)
        this.api[name][key] = value
      }
    }

    if (flow.source.api) {
      this.api[name].source = {}
      for (let [key, value] of Object.entries(flow.source.api)) {
        if (typeof value === 'function') value = value.bind(this.api[name], context)
        this.api[name].source[key] = value
      }
    }
  }
}

class Flow extends EventEmitter {
  constructor (kappa, { source, view, opts = {}, status }) {
    super()

    this.opts = opts
    this.kappa = kappa
    this.name = opts.name
    this.view = view
    this.source = source

    this.status = status || Status.Ready
    this._opened = false
    this.open = thunky(this._open.bind(this))
  }

  get version () {
    return this.view.version
  }

  _open (cb = noop) {
    if (this._opened) return cb()
    const self = this
    let pending = 1
    if (this.view.open) ++pending && this.view.open(this, done)
    if (this.source.open) ++pending && this.source.open(this, done)
    done()

    function done () {
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

  reset (cb = noop) {
    const self = this
    this.pause()
    process.nextTick(() => {
      if (this.view.clearIndex) this.view.clearIndex(reset)
      else reset()
    })
    function reset () {
      self.source.reset(() => {
        self.resume()
        cb()
      })
    }
  }

  update () {
    if (!this._opened) return
    this.incomingUpdate = true
    process.nextTick(this._run.bind(this))
  }

  _onbatch (msgs, cb) {
    if (!msgs.length) return cb(null, msgs)
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

    this.source.pull(onbatch)

    function onbatch (result) {
      if (!result) return close()
      if (self.status === Status.Paused) return close()
      const { messages = [], finished, onindexed } = result
      self._onbatch(messages, (err, messages) => {
        if (err) return close(err)
        close(null, { messages, finished, onindexed })
      })
    }

    function close (err, result) {
      if (err) self.kappa.emit('error', err, this)
      if (!result) return finish(true)
      const { messages, finished, onindexed } = result
      if (messages.length && self.view.indexed) {
        self.view.indexed(messages)
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

// function awaitAll (objs, fn, args, cb) {
//   if (typeof args === 'function') return awaitAll(objs, fn, [], args)
//   objs = objs.filter(obj => obj[fn])
//   let pending = objs.length
//   if (!pending) return cb()
//   args.push(done)
//   objs.forEach(obj => obj[fn](...args))
//   function done () {
//     if (--pending === 0) cb()
//   }
// }

function noop () {}
