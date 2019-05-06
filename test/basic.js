var test = require('tape')
var ram = require('random-access-memory')
var kappa = require('..')

test('simple view', function (t) {
  var core = kappa(ram, { valueEncoding: 'json' })

  var sum = 0

  var sumview = {
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

  core.use('sum', sumview)

  core.writer('default', function (err, feed) {
    feed.append(1, function (err) {
      core.api.sum.get(function (err, value) {
        t.equals(1, value)
        t.end()
      })
    })
  })
})
