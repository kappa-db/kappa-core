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

  const source = {
    open (_flow, next) {
      flow = _flow
      next()
    },
    pull (next) {
      const max = buf.length
      const end = Math.min(state + maxBatch, max)
      const messages = buf.slice(state, end)
      next({
        messages,
        finished: end === max,
        onindexed (cb) {
          state = end
          cb()
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
          buf.push(value)
          if (flow) flow.update()
        }
      }
    }
  }

  return source
}
