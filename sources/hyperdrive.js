const hyperdrive = require('hyperdrive')
const collect = require('stream-collector')
const p = require('path')

const multi = require('./util/multisource')

module.exports = function hyperdriveSource (handlers, opts) {
  if (opts.mount === false) {
    return hyperdriveSingle(handlers, opts)
  } else {
    return hyperdriveMounts(handlers, opts)
  }
}

function hyperdriveSingle (handlers, opts) {
  const {
    drive,
    maxBatch = 100,
    _mountInfo
  } = opts

  var key

  return { open, pull, transform }

  function open (next) {
    drive.ready(() => {
      drive.metadata.setMaxListeners(256)
      key = drive.key.toString('hex')
      drive.watch('/', handlers.onupdate)
      next()
    })
  }

  function pull (state, next) {
    const at = state || 0
    const to = Math.min(at + maxBatch, drive.version)
    if (to <= at) return next()
    const diffStream = drive.checkout(to).createDiffStream(at)
    collect(diffStream, (err, msgs) => {
      transform(msgs, msgs => {
        next(to, msgs, to < drive.version)
      })
    })
  }

  function transform (msgs, next) {
    for (const node of msgs) {
      if (_mountInfo) {
        node.name = p.join(_mountInfo.path, node.name)
        node.mountInfo = {
          key,
          path: _mountInfo.path
        }
        node.key = _mountInfo.key
      } else {
        node.key = key
      }
    }
    next(msgs)
  }
}

function hyperdriveMounts (handlers, opts) {
  const { pull, addSource } = multi(handlers, { open })
  const { drive } = opts

  return { pull, open, transform }

  function open (next) {
    drive.ready(() => {
      addSource(drive.key.toString('hex'), hyperdriveSingle, { drive }, next)
    })
  }

  function transform (msgs, next) {
    let pending = 1
    for (const node of msgs) {
      if (node.type === 'mount') {
        ++pending
        mountToSource(node, done)
      }
    }
    done()
    function done () {
      if (--pending === 0) next(msgs)
    }
  }

  function mountToSource (node, done) {
    const path = node.name
    drive.stat(path, (err, stat) => {
      if (err || !stat || !stat.mount) return done()
      const { key, hypercore } = stat.mount
      // TODO: Support hypercore mounts?
      if (hypercore) return done()

      const subdrive = hyperdrive(drive._corestore, key)
      subdrive.ready(() => {
        addSource(key.toString('hex'), hyperdriveSingle, {
          ...opts,
          drive: subdrive,
          _mountInfo: {
            key: node.key,
            path
          }
        })
        done()
      })
    })
  }
}
