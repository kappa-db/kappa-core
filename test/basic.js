const tape = require('tape')
const { Kappa } = require('..')
const { runAll } = require('./lib/util')

tape('simple source', t => {
  const kappa = new Kappa()

  const [source1, pushTo1] = makeSimpleSource()
  const [source2, pushTo2] = makeSimpleSource()
  kappa.source('s1', source1)
  kappa.source('s2', source2)
  kappa.use('view1', makeSimpleView())
  kappa.use('view2', makeSimpleView())

  pushTo1(1)
  pushTo1(2)
  pushTo2(3)
  pushTo2(4)

  runAll([
    cb => kappa.api.view1.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, [1, 2, 3, 4])
      cb()
    }),
    cb => kappa.api.view2.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, [1, 2, 3, 4])
      cb()
    }),
    cb => t.end()
  ])
})

function makeSimpleView () {
  let res = []
  const view = {
    map (msgs, next) {
      res = res.concat(msgs)
      next()
    },
    api: {
      collect (kappa, cb) {
        this.ready(() => cb(null, res))
      }
    }
  }
  return view
}

function makeSimpleSource () {
  const buf = []
  const listeners = []

  return [createSource, push]

  function createSource (handlers, opts) {
    listeners.push(handlers.onupdate)
    const maxBatch = opts.maxBatch || 2
    return {
      pull (state, next) {
        state = state || 0
        const end = Math.min(state + maxBatch, buf.length)
        const slice = buf.slice(state, end)
        next(end, slice, end < buf.length)
      }
    }
  }

  function push (value) {
    buf.push(value)
    listeners.forEach(onupdate => onupdate())
  }
}
