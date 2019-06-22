# kappa-core

> kappa-core is a minimal peer-to-peer database, based on append-only logs and materialized views.

## Introduction

kappa-core is built on an abstraction called a [kappa architecture](kappa), or
"event sourcing". This differs from the traditional approach to databases, which
is centered on storing the latest value for each key in the database. You might
have a *table* like this:

|id|key|value|
|--|--|--|
|51387|soup|cold|
|82303|sandwich|warm|
|23092|berries|room temp|

If you wanted to change the value of `soup` to `warm`, you would *modify* the
entry with `id=51387` so that the table was now

|id|key|value|
|--|--|--|
|51387|soup|warm|
|82303|sandwich|warm|
|23092|berries|room temp|

This table now, once again, represents the current state of the data.

There are some consequences to this style of data representation:
1. historic data is lost
2. there is exactly one global truth for any datum
3. no verifiable authorship information
4. data is represented in a fixed way (changing this requires "table migrations")

In contrast, kappa architecture centers on a primitive called the "append-only
log" as its single source of truth.

An append-only log is a data structure that can only be added to. Each entry in
a log is addressable by its "sequence number" (starting at 0, then 1, 2, 3,
...). In the case of kappa-core, which uses [hypercore][hypercore] underneath,
each log is also identified by a cryptographic *public key*, which allows each
log entry to be digitally signed with that log's *private key*, certifying that
each entry in the log was indeed authored by the same person or device. A
single kappa-core database can have one, ten, or hundreds of append-only logs
comprising it.

kappa-core still uses tables like the above, though. However, instead of being
the source of truth, these tables are generated (or *materialized*) from the
log data, providing a *view* of the log data in a new or optimized context.
These are called *materialized views*.

The twin concepts of *append-only logs* and *materialized views* are the key
concepts of kappa-core. Any kappa-core database does only a few things:

1. define various materialized views that it finds useful
2. write data to append-only logs
3. query those views to retrieve useful information

Let's look at an example of how the traditional table from the beginning of
this section could be represented as a kappa architecture. The three initial
rows would begin as log entries first:

```
[
  {
    id: 51387,
    key: 'soup',
    value: 'cold'
  },
  {
    id: 82303,
    key: 'sandwich',
    value: 'warm'
  },
  {
    id: 23092,
    key: 'berries',
    value: 'room temp'
  }
]
```

These might be written to one log, or perhaps spread across several. They all
get fed into materialized views in a nondeterministic order anyway, so it
doesn't matter.

To produce a look-up table like before, a view might be defined like this:

```
when new log entry E:
  table.put(E.key, E.value)
```

This would map each `key` from the full set of log entries to its `value`,
producing this table:

|key|value|
|--|--|
|soup|cold|
|sandwich|warm|
|berries|room temp|

Notice `id` isn't present. We didn't need it, so we didn't bother writing it to
the view. It's still stored in each log entry it came from though.

Now let's say an entry like `{ id: 51387, key: 'soup', value: 'warm' }` is
written to a log. The view logic above the table dictates that the `key` is
mapped to the `value` for this view, so the a table would be produced:

|key|value|
|--|--|
|soup|warm|
|sandwich|warm|
|berries|room temp|

Like the traditional database, the table is mutated in-place to produce the new
current state. The difference is that this table was *derived* from immutable
log data, instead of being the truth source itself.

This is all very useful:
1. log entries are way easier to replicate over a network or USB keys than tables
2. the log entries are immutable, so they can be cached indefinitely
3. the log entries are digitally signed, so their authenticity can be trusted
4. views are derived, so they can be regenerated

\#4 is really powerful and worth examination: *views can be regenerated*. In
kappa-core, views are *versioned*: the view we just generated was version 1,
and was defined by the logic

```
when new log entry E:
  table.put(E.key, E.value)
```

What if we wanted to change this view at some point, to instead map the entry's
`id` to its `value`? Maybe like this:

```
when new log entry E:
  table.put(E.id, E.value)
```

With kappa-core, this would mean bumping the view's *version* to `2`.
kappa-core will purge the existing table, and regenerate it from scratch by
processing all of the entries in all of the logs all over again. This makes
views cheap, and also means *no table migrations*! Your data structures can
evolve as you program evolves, and peers won't need to worry about migrating to
new formats.

Lastly, a kappa-core database is able to *replicate* itself to another
kappa-core database. The `replicate` API (below) returns a Node `Duplex`
stream. This stream can operate over any stream-compatible transport medium,
such as TCP, UTP, Bluetooth, a Unix pipe, or even audio waves sent over the
air! When two kappa-core databases replicate, they exchange the logs and the
entries in the logs, so that both sides end up with the same full set of log
entries. This will trigger your database's materialized views to process these
new entries to update themselves and reflect the latest state.

Because this is all built on [hypercore][hypercore], replication can be done
over an encrypted channel.

Thanks for reading! You can also try the [kappa-core
workshop](https://github.com/kappa-db/workshop) to use kappa-core yourself, or
get support and/or chat about development on

- IRC: #kappa-db on Freenode
- [Cabal](https://cabal.chat): #kappa-db on `cabal://0201400f1aa2e3076a3f17f4521b2cc41e258c446cdaa44742afe6e1b9fd5f82`

## Example

This example sets up an on-disk log store and an in-memory view store. The view
tallies the sum of all of the numbers in the logs, and provides an API for
getting that sum.

```js
var kappa = require('kappa-core')
var view = require('kappa-view')
var memdb = require('memdb')

// Store logs in a directory called "log". Store views in memory.
var core = kappa('./log', { valueEncoding: 'json' })
var store = memdb()

// View definition
var sumview = view(store, function (db) {

  // Called with a batch of log entries to be processed by the view.
  // No further entries are processed by this view until 'next()' is called.
  map: function (entries, next) {
    db.get('sum', function (err, value) {
      var sum
      if (err && err.notFound) sum = 0
      else if (err) return next(err)
      else sum = value
    })
    entries.forEach(function (entry) {
      if (typeof entry.value === 'number') sum += entry.value
    })
    db.put('sum', sum, next)
  }

  // Whatever is defined in the "api" object is publicly accessible
  api: {
    get: function (core, cb) {
      this.ready(function () {  // wait for all views to catch up
        cb(null, sum)
      })
    }
  },
})

// the api will be mounted at core.api.sum
core.use('sum', 1, sumview)  // name the view 'sum' and consider the 'sumview' logic as version 1

core.writer('default', function (err, writer) {
  writer.append(1, function (err) {
    core.api.sum.get(function (err, value) {
      console.log(value) // 1
    })
  })
})
```

## API

```js
var kappa = require('kappa-core')
```

### var core = kappa(storage, opts)

Create a new kappa-core database.

- `storage` is an instance of
  [random-access-storage](https://github.com/random-access-storage). If a string
  is given,
  [random-access-file](https://github.com/random-access-storage/random-access-storage)
  is used with the string as the filename.
- Valid `opts` include:
  - `valueEncoding`: a string describing how the data will be encoded.
  - `multifeed`: A preconfigured instance of [multifeed](https://github.com/kappa-db/multifeed)

### core.writer(name, cb)

Get or create a local writable log called `name`. If it already exists, it is
returned, otherwise it is created. A writer is an instance of
[hypercore](https://github.com/mafintosh/hypercore).

### var feed = multi.feed(key)

Fetch a log / feed by its **public key** (a `Buffer` or hex string).

### var feeds = core.feeds()

An array of all hypercores in the kappa-core. Check a feed's `key` to find the
one you want, or check its `writable` / `readable` properties.

Only populated once `core.ready(fn)` is fired.

### core.use(name[, version], view)

Install a view called `name` to the kappa-core instance. A view is an object of
the form

```js
// All are optional except "map"
{

  // Process each batch of entries
  map: function (entries, next) {
    entries.forEach(function (entry) {
      // ...
    })
    next()
  },

  // Your useful functions for users of this view to call
  api: {
    someSyncFunction: function (core) { return ... },
    someAsyncFunction: function (core, cb) { process.nextTick(cb, ...) }
  },

  // Save progress state so processing can resume on later runs of the program.
  // Not required if you're using the "kappa-view" module, which handles this for you.
  fetchState: function (cb) { ... },
  storeState: function (state, cb) { ... },
  clearState: function (cb) { ... }

  // Runs after each batch of entries is done processing and progress is persisted
  indexed: function (entries) { ... },
  
  // Number of entries to process in a batch
  maxBatch: 100,
}
```

**NOTE**: The kappa-core instance `core` is always passed as the fist parameter
in all of the `api` functions you define.

`version` is an integer that represents what version you want to consider the
view logic as. Whenever you change it (generally by incrementing it by 1), the
underlying data generated by the view will be wiped, and the view will be
regenerated again from scratch. This provides a means to change the logic or
data structure of a view over time in a way that is future-compatible.

The `fetchState`, `storeState`, and `clearState` functions are optional: they
tell the view where to store its state information about what log entries have
been indexed thus far. If not passed in, they will be stored in memory (i.e.
reprocessed on each fresh run of the program). You can use any backend you want
(like leveldb) to store the `Buffer` object `state`. If you use a module like
[kappa-view](https://github.com/kappa-db/kappa-view), it will handle state
management on your behalf.

`indexed` is an optional function to run whenever a new batch of entries have
been indexed and written to storage. Receives an array of entries.

### core.ready(viewNames, cb)

Wait until all views named by `viewNames` are caught up. e.g.

```
// one
core.ready('sum', function () { ... })

// or several
core.ready(['kv', 'refs', 'spatial'], function () { ... })
```

If viewNames is `[]` or not included, all views will be waited on.

### core.pause([viewNames], [cb])

Pause some or all of the views' indexing process. If no `viewNames` are given,
they will all be paused. `cb` is called once the views finish up any entries
they're in the middle of processing and are fully stopped.

### core.resume([viewNames])

Resume some or all paused views. If no `viewNames` is given, all views are
resumed.

### core.replicate([opts])

Create a duplex replication stream. `opts` are passed in to
[multifeed](https://github.com/kappa-db/multifeed)'s API of the same name.

### core.on('error', function (err) {})

Event emitted when an error within kappa-core has occurred. This is very
important to listen on, lest things suddenly seem to break and it's not
immediately clear why.

## Install

With [npm](https://npmjs.org/) installed, run

```
$ npm install kappa-core
```

## Useful helper modules

Here are some useful modules that play well with kappa-core for building
materialized views:

- [unordered-materialized-bkd](https://github.com/digidem/unordered-materialized-bkd): spatial index
- [unordered-materialized-kv](https://github.com/digidem/unordered-materialized-kv): key/value store
- [unordered-materialized-backrefs](https://github.com/digidem/unordered-materialized-backrefs): back-references

## Why?

kappa-core is built atop two major building blocks:

1. [hypercore][hypercore], which is used for (append-only) log storage
2. materialized views, which are built by traversing logs in potentially out-of-order sequence

hypercore provides some very useful superpowers:

1. all data is cryptographically associated with a writer's public key
2. partial replication: parts of logs can be selectively sync'd between peers,
instead of all-or-nothing, without loss of cryptographic integrity

Building views in arbitrary sequence is more challenging than when order is
known to be topographic or sorted in some way, but confers some benefits:

1. most programs are only interested in the latest values of data; the long tail
of history can be traversed asynchronously at leisure after the tips of the
logs are processed
2. the views are tolerant of partially available data. Many of the modules
listed in the section below depend on *topographic completeness*: all entries
referenced by an entry **must** be present for indexes to function. This makes
things like the equivalent to a *shallow clone* (think [git][git-shallow]),
where a small subset of the full dataset can be used and built on without
breaking anything.

## Acknowledgments

kappa-core is built atop ideas from a huge body of others' work:

- [flumedb][flumedb]
- [secure scuttlebutt](http://scuttlebutt.nz)
- [hypercore][hypercore]
- [hyperdb](https://github.com/mafintosh/hyperdb)
- [forkdb](https://github.com/substack/forkdb)
- [hyperlog](https://github.com/mafintosh/hyperlog)
- a harmonious meshing of ideas with @substack in the south of spain

## Further Reading

- [kappa architecture](http://kappa-architecture.com)

## License

ISC

[hypercore]: https://github.com/mafintosh/hypercore
[flumedb]: https://github.com/flumedb/flumedb
[git-shallow]: https://www.git-scm.com/docs/gitconsole.log(one#gitconsole.log(one---depthltdepthgt)
[kappa]: http://kappa-architecture.com
