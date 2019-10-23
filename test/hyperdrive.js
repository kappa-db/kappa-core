const tape = require('tape')
const ram = require('random-access-memory')
const hyperdrive = require('hyperdrive')
const corestore = require('corestore')
const { runAll } = require('./lib/util')
const crypto = require('hypercore-crypto')

const { Kappa } = require('..')
const hyperdriveSource = require('../sources/hyperdrive')

tape('hyperdrive source', async t => {
  const cstore = corestore(ram)
  var drive1, drive2, drive3, driveB, kappa, kappaB

  await runAll([
    // init all the drives
    cb => {
      const keyPair = crypto.keyPair()
      drive1 = hyperdrive(cstore, keyPair.publicKey, { keyPair })
      drive1.ready(cb)
    },
    cb => {
      const keyPair = crypto.keyPair()
      drive2 = hyperdrive(cstore, keyPair.publicKey, { keyPair })
      drive2.ready(cb)
    },
    cb => {
      const keyPair = crypto.keyPair()
      drive3 = hyperdrive(cstore, keyPair.publicKey, { keyPair })
      drive3.ready(cb)
    },

    // open first kappa
    cb => {
      kappa = new Kappa()
      kappa.use('files', makeFilesView())
      kappa.source('drive', hyperdriveSource, { drive: drive1 })
      kappa.pause()
      cb()
    },

    // mounts and writeFiles
    cb => drive1.writeFile('hello1', Buffer.from('world1'), cb),
    cb => drive2.writeFile('hello2', Buffer.from('world2'), cb),
    cb => drive3.writeFile('hello3', Buffer.from('world3'), cb),
    cb => drive1.mount('in2', drive2.key, cb),
    cb => drive2.mount('in3', drive3.key, cb),
    cb => drive1.unlink('hello1', cb),

    // pause the kappa so that intermediate diffs are skipped
    // in a real-world scenario the views would have be aware
    // of the linear, but not synonym history of hyperdrives
    // (when using the diff iterator)
    cb => {
      kappa.resume()
      cb()
    },

    // open second (remote) drive
    cb => {
      driveB = hyperdrive(ram, drive1.key)
      driveB.ready(cb)
    },

    // init second (remote) kappa
    cb => {
      kappaB = new Kappa()
      kappaB.use('files', makeFilesView())
      kappaB.source('drive', hyperdriveSource, { drive: driveB })
      cb()
    },

    // replicate the local and remote drives
    cb => {
      replicate(drive1, driveB)
      setTimeout(cb, 300)
    },
  ])

  const expected = [
    'mount in2',
    'mount in2/in3',
    'put in2/hello2',
    'put in2/in3/hello3'
  ]

  kappa.api.files.collect((err, res) => {
    t.error(err)
    res.sort()
    t.deepEqual(res, expected, 'original kappa matches')
    kappaB.api.files.collect((err, res) => {
      t.error(err)
      res.sort()
      t.deepEqual(res, expected, 'replicated kappa matches')
      t.end()
    })
  })
})

function makeFilesView () {
  let list = []
  return {
    map (msgs, next) {
      list.push(...msgs)
      next()
    },
    api: {
      collect (kappa, cb) {
        this.ready(async () => {
          const res = list.map(node => `${node.type} ${node.name}`)
          cb(null, res)
        })
      }
    }
  }
}

function replicate (a, b) {
  const stream = a.replicate(true, { live: true })
  stream.pipe(b.replicate(false, { live: true })).pipe(stream)
}
