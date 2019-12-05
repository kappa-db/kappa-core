const Tinybox = require('tinybox')
const ram = require('random-access-memory')

module.exports = class SimpleState {
  constructor (opts = {}) {
    this.box = opts.box || new Tinybox(ram())
    this.prefix = opts.prefix
  }

  get _STATE () {
    return this.prefix + '!state!'
  }

  get _VERSION () {
    return this.prefix + '!version!'
  }

  prefix (prefix) {
    return new SimpleState({
      box: this.box,
      prefix: this.prefix + '/' + prefix
    })
  }

  get (name, cb) {
    if (!cb) return this.get('', name)
    const key = this._STATE + name
    getInt(this.box, key, cb)
  }

  put (name, seq, cb) {
    if (!cb) return this.put('', name, seq)
    const key = this._STATE + name
    putInt(this.box, key, seq, cb)
  }

  storeVersion (version, cb) {
    putInt(this.box, this._VERSION, version, cb)
  }

  fetchVersion (cb) {
    getInt(this.box, this._VERSION, cb)
  }
}

function getInt (db, key, cb) {
  db.get(key, (err, node) => {
    if (err || !node) return cb(err, 0)
    const int = node.value.readInt32LE() || 0
    cb(null, int)
  })
}

function putInt (db, key, int, cb) {
  const buf = Buffer.allocUnsafe(4)
  buf.writeInt32LE(int)
  db.put(key, buf, cb || noop)
}

function noop () {}

// module.exports = class StatefulSource {
//   constructor (opts) {
//     this.state = new SimpleState(opts)
//   }

//   fetchVersion (cb) {
//     this.state.getVersion(cb)
//   }

//   storeVersion (version, cb) {
//     this.state.setVersion(version, cb)
//   }
// }
