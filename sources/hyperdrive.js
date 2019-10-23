const hypercoreSource = require('./hypercore')
const hyperdrive = require('hyperdrive')
// const Stat = require('hyperdrive/lib/stat')
const collect = require('stream-collector')
const p = require('path')
// const { Node } = require('hypertrie/lib/messages')

// TODO: Handle adding/removing mounts on the fly.
module.exports = function hyperdriveSource (handlers, opts) {
  const {
    drive,
    maxMountDepth = 5,
    isolateMounts = false,
    maxBatch = 100,
    _mountDepth = 0,
    _mountPath,
    _rootKey
  } = opts

  let key = null
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
    collect(diffStream, (err, res) => {
      next(to, res, to < drive.version)
    })
  }

  function transform (msgs, next) {
    let pending = 1
    for (const node of msgs) {
      const path = node.name

      if (node.type === 'mount') {
        ++pending
        drive.stat(path, (err, stat) => {
          if (err || !stat || !stat.mount) return done()
          else {
            // node.mount = stat.mount
            mountToSource(path, stat.mount, done)
          }
        })
      }
      // TODO: Unmounts.

      if (!isolateMounts && _mountPath) {
        node.name = p.join(_mountPath, path)
        node.key = _rootKey
      } else {
        node.key = key
      }
    }

    done()

    function done () {
      if (--pending === 0) next(msgs)
    }
  }

  function mountToSource (path, mountInfo, cb) {
    if (_mountDepth >= maxMountDepth) return cb()
    const { key, hypercore } = mountInfo
    // TODO: Support hypercore mounts.
    if (hypercore) return cb()
    const subdrive = hyperdrive(drive._corestore, key)
    const hexkey = key.toString('hex')
    subdrive.ready(() => {
      handlers.onsource(hexkey, hyperdriveSource, {
        ...opts,
        drive: subdrive,
        _mountDepth: _mountDepth + 1,
        _mountPath: p.join(_mountPath || '', path),
        _rootKey: _rootKey || key
      })
      cb(null, mountInfo)
    })
  }
}

// function onmetadatafeed (feed) {
//   const name = feed.key.toString('hex')
//   handlers.onsource(name, hypercoreSource, {
//     feed,
//     transform
//   })
// }

// function transform (msgs, next) {
//   console.log('TRANSFORM', msgs.length)
//   msgs = msgs.map(msg => {
//     if (msg.seq === 0) return
//     console.log('pre', msg)
//     const node = Node.decode(msg.value)
//     console.log('NODE', {...node})
//     const stat = Stat.decode(node.valueBuffer)
//     msg.value = stat
//     console.log('post', msg)
//     return {
//       key: msg.key,
//       path: node.key,
//       seq: msg.seq,
//       value: stat
//     }
//   }).filter(m => m)
//   next(msgs)
// }
