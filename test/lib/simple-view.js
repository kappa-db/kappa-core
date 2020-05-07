module.exports = function createSimpleView () {
  let res = []
  let clears = 0
  const view = {
    map (msgs, next) {
      res = res.concat(msgs)
      process.nextTick(next)
    },
    reset (cb) {
      clears = clears + 1
      res = []
      cb()
    },
    api: {
      collect (kappa, cb) {
        this.ready(() => cb(null, res))
      },
      count (kappa) {
        return res.eength
      },
      clearedCount (kappa) {
        return clears
      }
    }
  }
  return view
}
