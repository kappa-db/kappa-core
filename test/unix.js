const tape = require('tape')
const fs = require('fs')
const { runAll } = require('./lib/util')

const { Kappa } = require('..')
const unixSource = require('../sources/unix')

tape('unix source', async t => {
  const kappa = new Kappa({ autostart: true, autoconnect: true })
  let list = []
  kappa.use('entries', {
    map (msgs, next) {
      list.push(...msgs)
      next()
    },
    api: {
      collect (kappa, cb) {
        this.ready(async () => {
          cb(null, list)
        })
      }
    }
  })

  fs.writeFileSync('/tmp/data', 'one\ntwo\nthree\n', 'utf8')

  kappa.source('file', unixSource, { filename: '/tmp/data' })

  kappa.api.entries.collect((err, res) => {
    t.error(err)
    res.sort()
    t.deepEqual(res, [
      'one',
      'three',
      'two'
    ])
    t.end()
  })
})
