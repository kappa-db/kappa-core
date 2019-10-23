var fs = require('fs')

module.exports = function unixSource (handlers, opts) {
  const maxBatch = opts.maxBatch || 50
  const filename = opts.filename
  let fd
  let buf = Buffer.alloc(8)

  // TODO: Maybe to this in the flow class, passing on opts?
  const transform = opts.transform

  return { open, pull, transform }

  function open (next) {
    fs.open(filename, 'r', (err, theFd) => {
      fd = theFd
      next()
    })
  }

  function pull (state, next) {
    const at = state || 0

    console.log('reading at', at)
    fs.read(fd, buf, 0, buf.length, at, (err, read, data) => {
      // XXX: does next() handle errors?
      if (err) return next(err)

      var lines = data.slice(0, read).toString('utf-8').split('\n')
      if (!lines) {
        return next(at, null, false)
      }

      // last line is incomplete; drop it
      if (lines[lines.length-1] === '') lines.pop()

      lines = lines.slice(0, maxBatch)

      // TODO: use an fs watcher to see if the file has changed
      // XXX: will an open file fd pick up appends to the file, or does it need to be reopened?

      let bytesRead = lines.join('\n').length + 1
      console.log('bytesRead', bytesRead)

      // check if we read the whole thing
      let moreToRead = true
      fs.stat(opts.filename, (err, info) => {
        if (info.size === at + bytesRead) moreToRead = false

        next(at + bytesRead, lines, moreToRead)
      })
    })
  }
}
