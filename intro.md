# Introduction

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
...). In the case of kappa-core, which uses [hypercore](https://github.com/hypercore-protocol/hypercore) underneath,
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

- IRC: #kappa-core on Freenode
