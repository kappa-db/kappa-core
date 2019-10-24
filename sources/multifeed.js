const hypercoreSource = require('./hypercore')
const multi = require('./util/multisource')

module.exports = function multifeedSource (handlers, opts) {
  const { pull, addSource } = multi(handlers, { open })
  const multifeed = opts.feeds

  return { pull, open }

  function open (next) {
    multifeed.ready(() => {
      multifeed.feeds().forEach(feed => _onfeed(feed))
      multifeed.on('feed', feed => _onfeed(feed))
      next()
    })
  }

  function _onfeed (feed, cb) {
    feed.ready(() => {
      addSource(feed.key.toString('hex'), hypercoreSource, { feed })
    })
  }
}

// module.exports = function multifeedSource (handlers, opts) {
//   const multifeed = opts.feeds
//   const sources = {}
//   const pullwanted = new Set()

//   return { open, pull }

//   function pull (state = {}, next) {
//     if (!pullwanted.size) return next(state)

//     let messages = []
//     let pending = pullwanted.size
//     for (let key of pullwanted) {
//       pullwanted.delete(key)
//       sources[key].pull(state[key], finish.bind(finish, key))
//     }

//     function finish (key, nextState, msgs, moreWork) {
//       if (moreWork) pullwanted.add(key)
//       state[key] = nextState
//       if (msgs) messages = messages.concat(msgs)
//       if (--pending === 0) {
//         next(state, messages, pullwanted.size > 0)
//       }
//     }
//   }

//   function open (next) {
//     multifeed.ready(() => {
//       multifeed.feeds().forEach(feed => _onfeed(feed))
//       multifeed.on('feed', feed => _onfeed(feed))
//       next()
//     })
//   }

//   function _onfeed (feed, cb) {
//     feed.ready(() => {
//       const name = feed.key.toString('hex')
//       const source = hypercoreSource({ onupdate: () => _onfeedupdate(name) }, { feed })
//       sources[name] = source
//       source.open(() => {
//         _onfeedupdate(name)
//         if (cb) cb()
//       })
//     })
//   }

//   function _onfeedupdate (name) {
//     pullwanted.add(name)
//     handlers.onupdate()
//   }
// }
