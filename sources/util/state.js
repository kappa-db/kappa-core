const Tinybox = require('tinybox')
const ram = require('random-access-memory')

module.exports = class SimpleState {
  constructor (opts = {}) {
    this.box = opts.box || new Tinybox(ram())
    this.prefix = opts.prefix
  }

  get _STATE () {
    return this.prefix + '!state'
  }

  get _VERSION () {
    return this.prefix + '!version'
  }

  prefix (prefix) {
    return new SimpleState({
      box: this.box,
      prefix: this.prefix + '/' + prefix
    })
  }

  get (cb) {
    getInt(this.box, this._STATE, cb)
  }

  put (seq, cb) {
    putInt(this.box, this._STATE, seq, cb)
  }

  putVersion (version, cb) {
    this.getVersion((err, lastVersion) => {
      if (err) return cb(err)
      if (version !== lastVersion) {
        this.version = version
        this.put(0, err => {
          if (err) cb(err)
          putInt(this.box, this._VERSION, version, cb)
        })
      }
    })
  }

  getVersion (cb) {
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
