var kappa = require('.')
var hypercore = require('hypercore')

var core = kappa('./log', { valueEncoding: 'json' })

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

// the api will be mounted at core.api.sum
core.use('sum', sumview)

core.writer('default', function (err, feed) {
  feed.append(1, function (err) {
    core.api.sum.get(function (err, value) {
      console.log(value) // 1
    })
  })
})
