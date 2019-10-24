module.exports = function multiSource (handlers, opts) {
  const sources = {}
  const updateWanted = new Set()

  return { pull, addSource, sources }

  function addSource (name, createSource, opts, cb) {
    if (sources[name]) return
    const handlers = {
      onupdate: onupdate.bind(onupdate, name)
    }
    const source = createSource(handlers, opts)
    source.name = name
    sources[name] = source
    source.open(() => {
      onupdate(name)
      if (cb) cb()
    })
  }

  function onupdate (name) {
    updateWanted.add(name)
    handlers.onupdate()
  }

  function pull (state, next) {
    state = state || {}
    if (!updateWanted.size) return next(state)

    let results = []
    let pending = updateWanted.size
    for (let name of updateWanted) {
      updateWanted.delete(name)
      sources[name].pull(state[name], done.bind(done, name))
    }
    function done (name, nextState, msgs, moreWork) {
      if (moreWork) updateWanted.add(name)
      if (msgs) results = results.concat(msgs)
      state[name] = nextState
      if (--pending === 0) next(state, results, updateWanted.size)
    }
  }
}
