const tape = require('tape')
const { Kappa } = require('..')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const hypercoreSource = require('../sources/hypercore')

tape('stacked views run in order', t => {
  const kappa = new Kappa()
  const core = hypercore(ram, { valueEncoding: 'json' })
  kappa.source('core', hypercoreSource, { feed: core })

  let first = 0
  let second = 0
  let firstOpn, secondOpn
  const stack = [
    {
      name: 'first',
      open (cb) {
        t.equal(secondOpn, undefined, 'first opens first')
        firstOpn = true
        cb()
      },
      map (msgs, next) {
        kappa.api.second.count((count) => {
          t.equal(count, first, 'first ran first')
          first = first + msgs.length
          next()
        })
      },
      api: {
        count (kappa, cb) { process.nextTick(cb, first) }
      }
    },
    {
      name: 'second',
      open (cb) {
        t.equal(firstOpn, true, 'second opens last')
        secondOpn = true
        cb()
      },
      map (msgs, next) {
        kappa.api.first.count((count) => {
          t.equal(count, second + msgs.length, 'second ran second')
          second = second + msgs.length
          next()
        })
      },
      api: {
        count (kappa, cb) { process.nextTick(cb, second) }
      }
    }
  ]

  kappa.useStack('stack', stack)

  core.append([1, 2, 3])
  setTimeout(() => {
    core.append([1, 2, 3])
    kappa.ready(() => {
      t.equal(first, 6)
      t.equal(second, 6)
      t.end()
    })
  }, 10)
})

tape('stacked view linked kv', t => {
  const kappa = new Kappa()
  const core = hypercore(ram, { valueEncoding: 'json' })
  kappa.source('core', hypercoreSource, { feed: core })
  const core2 = hypercore(ram, { valueEncoding: 'json' })
  kappa.source('core2', hypercoreSource, { feed: core2 })

  const links = {}
  const keys = {}
  const ops = []
  kappa.useStack('stack', [
    {
      name: 'links',
      map (msgs, next) {
        msgs.forEach(msg => {
          const id = toId(msg)
          if (msg.value.links) msg.value.links.forEach(l => (links[l] = true))
          const currentLinks = kappa.api.links.get(msg.value.key)
          keys[msg.value.key] = [...currentLinks, id]
        })
        next()
      },
      api: {
        isLinked (kappa, msg) {
          return !!links[toId(msg)]
        },
        get (kappa, key) {
          return keys[key] || []
        }
      }
    },
    {
      name: 'ops',
      map (msgs, next) {
        msgs.forEach(msg => {
          let op
          if (kappa.api.links.isLinked(msg)) {
            op = 'outdated'
          } else if (kappa.api.links.get(msg.value.key).length > 1) {
            op = 'update'
          } else {
            op = 'create'
          }
          ops.push({ op, value: msg.value, id: toId(msg), idx: ops.length })
        })
        next()
      },
      api: {
        log (kappa) {
          return ops
        }
      }
    }
  ])

  readyAll([core, core2], () => {
    core.append({ key: 'earth', value: 'best' })
    core.append({ key: 'mars', value: 'red', links: [core2.key.toString('hex') + '@0'] })
    core.append({ key: 'earth', value: 'burned', links: [core.key.toString('hex') + '@0'] })

    setTimeout(() => {
      core2.append({ key: 'mars', value: 'hotter' })
      core2.append({ key: 'earth', value: 'fuuuu' })
    }, 0)

    setTimeout(() => {
      kappa.ready('ops', () => {
        let log = kappa.api.ops.log()
        t.equal(log.filter(l => l.op === 'create').length, 2, 'two creations')
        t.equal(log.filter(l => l.op === 'update').length, 2, 'two updates')
        t.equal(log.filter(l => l.op === 'outdated').length, 1, 'one outdated')
        t.end()
      })
    }, 10)
  })
})

function toId (msg) {
  return msg.key + '@' + msg.seq
}

function readyAll (cores, cb) {
  let pending = cores.length
  cores.forEach(core => core.ready(() => (--pending === 0 && cb())))
}
