exports.mergePull = function (sources, next) {
  if (!sources.length) return next()
  let results = []
  let pending = sources.length
  sources.forEach(source => source.pull(onresult))
  function onresult (result) {
    if (result) results.push(result)
    if (--pending === 0) onfinish()
  }
  function onfinish () {
    if (!results.length) return next()
    let messages = []
    let finished = true
    for (let result of results) {
      if (result.messages) messages = messages.concat(result.messages)
      if (!result.finished) finished = false
    }
    next({
      messages,
      finished,
      onindexed
    })
  }
  function onindexed (cb) {
    let fns = results.map(r => r.onindexed).filter(f => f)
    if (!fns.length) return cb()
    let pending = fns.length
    fns.forEach(fn => fn(done))
    function done () {
      if (--pending === 0) cb()
    }
  }
}

exports.mergeReset = function (sources, cb) {
  let pending = sources.length
  sources.forEach(source => source.reset(done))
  function done () {
    if (--pending === 0) cb()
  }
}
