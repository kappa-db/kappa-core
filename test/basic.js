const tape = require('tape')
const { Kappa } = require('..')
const { runAll } = require('./lib/util')

tape('simple source', t => {
  const kappa = new Kappa()

  kappa.use('view1', makeSimpleSource(), makeSimpleView())
  kappa.use('view2', makeSimpleSource(), makeSimpleView())
  kappa.api.view1.source.push(1)
  kappa.api.view1.source.push(2)
  kappa.api.view2.source.push(3)
  kappa.api.view2.source.push(4)

  runAll([
    cb => kappa.api.view1.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, [1, 2])
      cb()
    }),
    cb => kappa.api.view2.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, [3, 4])
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

function makeSimpleSource (opts = {}) {
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
