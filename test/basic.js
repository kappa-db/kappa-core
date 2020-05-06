const tape = require('tape')
const { Kappa } = require('..')
const { runAll } = require('./lib/util')

tape('simple source', t => {
  const kappa = new Kappa()

  kappa.use('view1', createSimpleSource(), createSimpleView())
  kappa.use('view2', createSimpleSource(), createSimpleView())
  kappa.source.view1.push(1)
  kappa.source.view1.push(2)
  kappa.source.view2.push(3)
  kappa.source.view2.push(4)

  runAll([
    cb => kappa.view.view1.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, [1, 2])
      cb()
    }),
    cb => kappa.view.view2.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, [3, 4])
      cb()
    }),
    cb => t.end()
  ])
})

tape('finished handling', t => {
  const kappa = new Kappa()
  t.plan(5)

  let msgs = ['a', 'b', 'c']
  let i = 0
  kappa.use('foo', {
    pull (next) {
      let finished
      if (i !== msgs.length - 1) finished = false
      next({
        messages: [msgs[i]],
        finished,
        onindexed: (cb) => {
          t.pass('onindexed ' + i)
          i = i + 1
          cb()
        }
      })
    }
  }, createSimpleView())

  runAll([
    cb => kappa.view.foo.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, ['a', 'b', 'c'])
      cb()
    }),
    cb => t.end()
  ])
})

tape('error on pull', t => {
  const kappa = new Kappa()
  let msgs = ['a']
  let i = 0
  kappa.use('foo', {
    pull (next) {
      if (i === 1) return next({ error: new Error('pull error') })
      if (i > 1) t.fail('pull after error')
      next({
        messages: msgs,
        finished: false,
        onindexed: (cb) => {
          t.pass('onindexed ' + i)
          i++
          cb()
        }
      })
    }
  }, createSimpleView())
  kappa.once('error', err => {
    t.equal(err.message, 'pull error')
    t.equal(kappa.flows.foo.getState().status, 'error')
    t.end()
  })
})

tape('error on map', t => {
  const kappa = new Kappa()
  kappa.use('foo', createSimpleSource(), {
    map (messages, next) {
      next(new Error('map error'))
    }
  })
  kappa.source.foo.push('a')
  kappa.once('error', err => {
    t.equal(err.message, 'map error')
    t.equal(kappa.flows.foo.getState().status, 'error')
    t.end()
  })
  kappa.ready(() => {
    t.fail('no ready on error')
  })
})

tape('state update', t => {
  const kappa = new Kappa()
  const foo = kappa.use('foo', createSimpleSource(), createSimpleView())
  let state
  foo.on('state-update', newState => {
    state = newState
  })
  foo.source.push([1, 2])
  process.nextTick(() => {
    foo.source.push([3, 4])
  })
  runAll([
    cb => setTimeout(cb, 0),
    cb => foo.view.collect((err, res) => {
      t.error(err, 'no error')
      t.deepEqual(res, [1, 2, 3, 4], 'result matches')
      t.deepEqual(state, {
        status: 'ready',
        error: null,
        totalBlocks: 4,
        indexedBlocks: 4,
        prevIndexedBlocks: 2
      }, 'state matches')
      t.deepEqual(state, foo.getState())
      cb()
    }),
    cb => {
      kappa.once('error', err => {
        t.equal(err.message, 'bad')
        process.nextTick(cb)
      })
      foo.source.error(new Error('bad'))
    },
    cb => {
      t.equal(state.status, 'error')
      t.equal(state.error.message, 'bad')
      t.equal(foo.getState().status, 'error')
      t.equal(foo.getState().error.message, 'bad')
      cb()
    },
    cb => t.end()
  ])
})

tape('reset', t => {
  const kappa = new Kappa()
  const foo = kappa.use('foo', createSimpleSource(), createSimpleView())
  foo.source.push(1)
  foo.source.push(2)
  foo.source.push(3)
  runAll([
    cb => foo.view.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, [1, 2, 3])
      t.equal(kappa.view.foo.clearedCount(), 0)
      cb()
    }),
    cb => {
      kappa.reset('foo', cb)
    },
    cb => foo.view.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, [1, 2, 3])
      t.equal(kappa.view.foo.clearedCount(), 1)
      cb()
    }),
    cb => t.end()
  ])
})

tape('open close', t => {
  t.plan(5)
  const kappa = new Kappa()
  let i = 0
  kappa.use('foo', {
    pull (next) {
      t.pass('pull')
      return next({
        messages: [++i, ++i],
        finished: true,
        onindexed (cb) {
          t.pass('onindexed')
          cb()
        }
      })
    },
    open (flow, cb) {
      t.pass('open')
      cb()
    },
    close (cb) {
      t.pass('close')
      cb()
    }
  }, createSimpleView())

  runAll([
    cb => kappa.ready(cb),
    cb => kappa.close(cb),
    cb => {
      t.pass('closed!')
      cb()
    }
  ])
})

tape('open error', t => {
  const kappa = new Kappa()
  kappa.use('foo', {
    open (flow, cb) {
      cb(new Error('open error'))
    },
    pull (next) { next() }
  }, createSimpleView())
  kappa.use('bar', {
    open (flow, cb) {
      cb()
    },
    pull (next) { next() }
  }, createSimpleView())
  kappa.on('error', err => {
    t.equal(err.message, 'open error')
    t.equal(kappa.flows.foo.opened, false)
    t.equal(kappa.flows.bar.opened, true)
    t.end()
  })
})

tape('fetch version error', t => {
  const kappa = new Kappa()
  kappa.use('foo', {
    fetchVersion (cb) {
      cb(new Error('fetch version error'))
    },
    pull (next) { next() }
  }, createSimpleView())
  kappa.on('error', err => {
    t.equal(err.message, 'fetch version error')
    t.equal(kappa.flows.foo.opened, false)
    t.end()
  })
})

function createSimpleView () {
  let res = []
  let clears = 0
  const view = {
    map (msgs, next) {
      res = res.concat(msgs)
      next()
    },
    reset (cb) {
      clears = clears + 1
      res = []
      cb()
    },
    api: {
      collect (kappa, cb) {
        this.ready(() => cb(null, res))
      },
      clearedCount (kappa) {
        return clears
      }
    }
  }
  return view
}

function createSimpleSource (opts = {}) {
  const buf = []
  const maxBatch = opts.maxBatch || 10
  let flow = null
  let state = 0
  let error = null

  const source = {
    open (_flow, next) {
      flow = _flow
      next()
    },
    pull (next) {
      if (error) return next({ error })
      const max = buf.length
      const end = Math.min(state + maxBatch, max)
      const messages = buf.slice(state, end)
      const lastState = state
      next({
        messages,
        finished: end === max,
        onindexed (cb) {
          state = end
          cb(null, {
            totalBlocks: buf.length,
            indexedBlocks: end,
            prevIndexedBlocks: lastState
          })
        }
      })
    },
    reset (next) {
      state = 0
      next()
    },
    get api () {
      return {
        push (kappa, value) {
          if (!Array.isArray(value)) value = [value]
          buf.push(...value)
          if (flow) flow.update()
        },
        error (kappa, err) {
          error = err
          if (flow) flow.update()
        }
      }
    }
  }

  return source
}
