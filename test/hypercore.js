const tape = require('tape')
const { Kappa } = require('..')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const hypercoreSource = require('../sources/hypercore')

tape('hypercore source', t => {
  const kappa = new Kappa()

  const core1 = hypercore(ram, { valueEncoding: 'json' })
  const core2 = hypercore(ram, { valueEncoding: 'json' })
  kappa.source('core1', hypercoreSource, { feed: core1 })
  kappa.source('core2', hypercoreSource, { feed: core2 })

  let res = []
  kappa.use('view', {
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
  core2.append(2)
  core1.append(3)

  setImmediate(() => {
    kappa.api.view.collect((err, res) => {
      t.error(err)
      t.deepEqual(res, [1, 2, 3])
      t.end()
    })
  })
})
