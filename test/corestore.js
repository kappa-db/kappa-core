const tape = require('tape')
const { Kappa } = require('..')
const Corestore = require('corestore')
const ram = require('random-access-memory')
const corestoreSource = require('../sources/corestore')

tape('corestore source', t => {
  const kappa = new Kappa()

  const store = new Corestore(ram)
  store.ready(() => {
    const core1 = store.default({ valueEncoding: 'json' })
    const core2 = store.get({ valueEncoding: 'json' })

    let res = []
    kappa.use('view', corestoreSource({ store }), {
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
      kappa.view.view.collect((err, res) => {
        t.error(err)
        t.deepEqual(res.sort(), [1, 2, 3])
        t.end()
      })
    })
  })
})
