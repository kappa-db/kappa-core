const tape = require('tape')
const { Kappa } = require('..')
const hypercore = require('hypercore')
const Tinybox = require('tinybox')
const ram = require('random-access-memory')
const hypercoreSource = require('../sources/hypercore')
const { runAll } = require('./lib/util')

tape('hypercore source', t => {
  const kappa = new Kappa()

  const core1 = hypercore(ram, { valueEncoding: 'json' })
  const state = new Tinybox(ram())

  let res = []
  kappa.use('view', hypercoreSource({ feed: core1, box: state }), {
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
  const sourceState = new Tinybox(ram())
  const viewState = new Tinybox(ram())

  function createKappa (feed, version) {
    const kappa = new Kappa()
    const source = hypercoreSource({ feed, box: sourceState })
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
  let kappa2

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
      db.get('msgs', (err, node) => {
        if (err) return next()
        let value = node && node.value ? JSON.parse(node.value) : []
        value = value.concat(msgs)
        db.put('msgs', JSON.stringify(value), next)
      })
    },
    version,
    clearIndex (cb) {
      clears = clears + 1
      db.put('msgs', JSON.stringify([], cb))
    },
    api: {
      collect (kappa, cb) {
        this.ready(() => {
          db.get('msgs', (err, node) => {
            cb(err, node ? JSON.parse(node.value) : [])
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
