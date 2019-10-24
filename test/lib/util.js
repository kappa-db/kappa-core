exports.runAll = function runAll (ops) {
  return new Promise((resolve, reject) => {
    runNext(ops.shift())
    function runNext (op) {
      op(err => {
        if (err) return reject(err)
        let next = ops.shift()
        if (!next) return resolve()
        return runNext(next)
      })
    }
  })
}

exports.replicate = function replicate (a, b, opts, cb) {
  if (typeof opts === 'function') return replicate(a, b, null, opts)
  if (!opts) opts = { live: true }
  const stream = a.replicate(true, opts)
  stream.pipe(b.replicate(false, opts)).pipe(stream)
  setImmediate(cb)
}
