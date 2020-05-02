const tape = require('tape')
const ram = require('random-access-memory')
const multifeed = require('multifeed')
const mem = require('level-mem')

const { Kappa } = require('..')
const createMultifeedSource = require('../sources/multifeed')
const { runAll } = require('./lib/util')

tape('multifeed', async t => {
  const feeds = multifeed(ram, { valueEncoding: 'json' })
  const kappa = new Kappa()
  const db = mem()

  kappa.use('sum', createMultifeedSource({ feeds, db }), createSumView())

  var feed1, feed2

  await runAll([
    cb => feeds.writer('default', (err, feed) => {
      t.error(err)
      feed1 = feed
      cb()
    }),
    cb => feeds.writer('second', (err, feed) => {
      t.error(err)
      feed2 = feed
      cb()
    }),
    cb => feed1.append(1, cb),
    cb => feed1.append(1, cb),
    cb => feed2.append(3, cb),
    cb => {
      kappa.view.sum.get(function (err, value) {
        t.error(err)
        t.equals(5, value)
        cb()
      })
    }
  ])

  t.end()
})

function createSumView () {
  let sum = 0
  const sumview = {
    api: {
      get: function (kappa, cb) {
        this.ready(function () {
          cb(null, sum)
        })
      }
    },
    map: function (msgs, next) {
      msgs.forEach(function (msg) {
        if (typeof msg.value === 'number') sum += msg.value
      })
      next()
    }
  }
  return sumview
}
