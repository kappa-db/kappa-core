const test = require('tape')
const ram = require('random-access-memory')
const kappa = require('..')
const { runAll } = require('./lib/util')

test('multifeed', async t => {
  const core = kappa(ram, { valueEncoding: 'json' })

  function createSumView () {
    let sum = 0
    const sumview = {
      api: {
        get: function (core, cb) {
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

  core.use('sum', createSumView())

  var feed1, feed2

  await runAll([
    cb => core.writer('default', (err, feed) => (feed1 = feed, cb())),
    cb => core.writer('second', (err, feed) => (feed2 = feed, cb())),
    cb => feed1.append(1, cb),
    cb => feed1.append(1, cb),
    cb => feed2.append(3, cb),
    cb => {
      core.api.sum.get(function (err, value) {
        t.equals(5, value)
        cb()
      })
    }
  ])

  const core2 = kappa(ram, { valueEncoding: 'json' })

  t.end()
})

function replicate (a, b, opts, cb) {
  if (typeof opts === 'function') return replicate(a, b, null, cb)
  if (!opts) opts = { live: true }
  const stream = a.replicate(opts)
  stream.pipe(b.replicate(opts)).pipe(stream)
  setImmediate(cb)
}
