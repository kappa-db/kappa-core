const tape = require('tape')
const { Kappa } = require('..')
const hypercore = require('hypercore')
const mem = require('level-mem')
const ram = require('random-access-memory')
const hypercoreSource = require('../sources/hypercore')
const { runAll } = require('./lib/util')

tape('hypercore source', t => {
  const kappa = new Kappa()

  const core1 = hypercore(ram, { valueEncoding: 'json' })
  const statedb = mem()

  let res = []
  kappa.use('view', hypercoreSource({ feed: core1, db: statedb }), {
    map (msgs, next) {
      res = res.concat(msgs.map(msg => msg.value))
      next()
    },
    api: {
      collect (kappa, cb) {
        this.ready(() => cb(null, res))
      }
    }
  })

  core1.append(1)
  core1.append(2)
  core1.append(3)

  setImmediate(() => {
    kappa.view.view.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, [1, 2, 3])
      t.end()
    })
  })
})

tape('versions', t => {
  const feed = hypercore(ram, { valueEncoding: 'json' })
  const sourceState = mem()
  const viewState = mem()

  function createKappa (feed, version) {
    const kappa = new Kappa()
    const source = hypercoreSource({ feed, db: sourceState })
    const view = makeSimpleView(viewState, version)
    const opts = {
      transform (msgs, next) {
        next(msgs.map(msg => msg.value))
      }
    }
    kappa.use('foo', source, view, opts)
    return kappa
  }

  feed.append('a')
  feed.append('b')

  let kappa = createKappa(feed, 1)

  runAll([
    cb => setImmediate(cb),
    cb => {
      kappa.view.foo.collect((err, res) => {
        t.error(err)
        t.deepEqual(res, ['av1', 'bv1'], 'first round ok')
        cb()
      })
    },
    cb => {
      kappa.pause()
      kappa = createKappa(feed, 1)
      cb()
    },
    cb => {
      kappa.view.foo.collect((err, res) => {
        t.error(err)
        t.deepEqual(res, ['av1', 'bv1'], 'second round ok')
        cb()
      })
    },
    cb => {
      kappa.pause()
      kappa = createKappa(feed, 2)
      cb()
    },
    cb => {
      kappa.view.foo.collect((err, res) => {
        t.error(err)
        t.deepEqual(res, ['av2', 'bv2'], 'second round ok')
        cb()
      })
    },
    cb => t.end()
  ])
})

function makeSimpleView (db, version) {
  let clears = 0
  const view = {
    map (msgs, next) {
      msgs = msgs.map(str => {
        return str + 'v' + version
      })
      db.get('msgs', (err, value) => {
        if (err && !err.notFound) return next()
        value = value ? JSON.parse(value) : []
        value = value.concat(msgs)
        db.put('msgs', JSON.stringify(value), next)
      })
    },
    version,
    clearIndex (cb) {
      clears = clears + 1
      db.put('msgs', JSON.stringify([]), cb)
    },
    api: {
      collect (kappa, cb) {
        this.ready(() => {
          db.get('msgs', (err, value) => {
            cb(err, value ? JSON.parse(value) : [])
          })
        })
      },
      clearedCount (kappa) {
        return clears
      }
    }
  }
  return view
}
