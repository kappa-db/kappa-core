module.exports = class SimpleState {
  constructor (opts = {}) {
    this.db = opts.db || new FakeDB()
    this._prefix = opts.prefix || ''
    this._STATE = this._prefix + '!state!'
    this._VERSION = this._prefix + '!version!'
    // Bind public methods so that they can be passed on directly.
    this.get = this.get.bind(this)
    this.put = this.put.bind(this)
    this.storeVersion = this.storeVersion.bind(this)
    this.fetchVersion = this.fetchVersion.bind(this)
  }

  prefix (prefix) {
    return new SimpleState({
      db: this.db,
      prefix: this._prefix + '/' + prefix
    })
  }

  reset (cb) {
  }

  get (name, cb) {
    if (!cb) return this.get('', name)
    const key = this._STATE + name
    getInt(this.db, key, cb)
  }

  put (name, seq, cb) {
    if (!cb) return this.put('', name, seq)
    const key = this._STATE + name
    putInt(this.db, key, seq, cb)
  }

  storeVersion (version, cb) {
    putInt(this.db, this._VERSION, version, cb)
  }

  fetchVersion (cb) {
    getInt(this.db, this._VERSION, cb)
  }
}

function getInt (db, key, cb) {
  db.get(key, (err, value) => {
    if (err && err.type !== 'NotFoundError') return cb(err)
    if (!value) return cb(null, 0)
    value = Number(value)
    cb(null, value)
  })
}

function putInt (db, key, int, cb) {
  const value = String(int)
  db.put(key, value, cb || noop)
}

function noop () {}

class FakeDB {
  constructor () {
    this.state = {}
  }

  put (key, value, cb) {
    this.state[key] = value
    process.nextTick(cb)
  }

  get (key, cb) {
    if (typeof this.state[key] === 'undefined') {
      const err = new Error('Key not found')
      err.type = 'NotFoundError'
      err.notFound = true
      process.nextTick(cb, err)
      cb(err)
    } else {
      process.nextTick(cb, null, this.state[key])
    }
  }
}
