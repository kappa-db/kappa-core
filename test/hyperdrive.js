const tape = require('tape')
const ram = require('random-access-memory')
const hyperdrive = require('hyperdrive')
const corestore = require('corestore')
const { runAll } = require('./lib/util')

const { Kappa } = require('..')
const hyperdriveSource = require('../sources/hyperdrive')

tape('hyperdrive source', async t => {
  const cstore = corestore(ram)
  const drive1 = hyperdrive(cstore)
  const drive2 = hyperdrive(cstore)
  const drive3 = hyperdrive(cstore)

  const kappa = new Kappa({ autostart: true, autoconnect: true })
  let list = []
  kappa.use('files', {
    map (msgs, next) {
      list.push(...msgs)
      next()
    },
    api: {
      collect (kappa, cb) {
        this.ready(async () => {
          console.log('KIST', list)
          const res = list.map(node => `${node.type} ${node.name}`)
          cb(null, res)
        })
      }
    }
  })

  kappa.source('drive', hyperdriveSource, { drive: drive1, fileContentPromise: true })

  await runAll([
    cb => drive1.ready(cb),
    cb => drive2.ready(cb),
    cb => drive3.ready(cb),

    cb => drive1.mount('in2', drive2.key, cb),
    cb => drive2.mount('in3', drive3.key, cb),

    cb => drive1.writeFile('hello', Buffer.from('world1'), cb),
    cb => drive2.writeFile('hello', Buffer.from('world2'), cb),
    cb => drive3.writeFile('hello', Buffer.from('world3'), cb),

    cb => drive1.unlink('hello', cb)
  ])

  kappa.api.files.collect((err, res) => {
    t.error(err)
    res.sort()
    t.deepEqual(res, [
      'del hello',
      'mount in2',
      // TODO: I don't know why "mount in2" is here two times.
      'mount in2',
      'mount in2/in3',
      'put hello',
      'put in2/hello',
      'put in2/in3/hello'
    ])
    console.log('res', res)
    t.end()
  })
})
