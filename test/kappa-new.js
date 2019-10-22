const tape = require('tape')
const { Kappa } = require('..')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const hypercoreSource = require('../sources/hypercore')
// const { runAll } = require('./lib/util')

function kappacore () {
  return new Kappa({ autoconnect: true, autostart: true })
}

tape('simple source', t => {
  const kappa = kappacore()

  const [source1, pushTo1] = makeSimpleSource()
  const [source2, pushTo2] = makeSimpleSource()

  kappa.source('s1', source1)
  kappa.source('s2', source2)

  kappa.use('view', {
    map (msgs, next) {
      console.log('[view:map]', msgs)
      next()
    }
  })

  kappa.use('other', {
    map (msgs, next) {
      console.log('[other:map]', msgs)
      next()
    }
  })

  pushTo1('one1')
  pushTo1('one2')
  setTimeout(() => {
    pushTo2('two1')
    pushTo2('two2')
  }, 100)

  console.log(kappa.flows.map(f => f.name))

  setTimeout(() => t.end(), 1000)
})

tape('hypercore source', t => {
  const kappa = kappacore()

  const core1 = hypercore(ram, { valueEncoding: 'utf8' })
  const core2 = hypercore(ram, { valueEncoding: 'utf8' })
  kappa.source('core1', hypercoreSource, { feed: core1 })
  kappa.source('core2', hypercoreSource, { feed: core2 })

  kappa.use('view', {
    map (msgs, next) {
      console.log('[view:map]', msgs)
      next()
    }
  })

  core1.append('one1')
  core1.append('one2')
  core2.append('two1')
  core2.append('two2')

  setTimeout(() => t.end(), 1000)
})

function makeSimpleSource () {
  const buf = []
  const listeners = []

  return [createSource, push]

  function createSource (handlers, opts) {
    listeners.push(handlers.onupdate)
    const maxBatch = opts.maxBatch || 2
    return {
      pull (state, next) {
        state = state || 0
        const end = Math.min(state + maxBatch, buf.length)
        const slice = buf.slice(state, end)
        next(end, slice, end < buf.length)
      }
    }
  }

  function push (value) {
    buf.push(value)
    listeners.forEach(onupdate => onupdate())
  }
}
