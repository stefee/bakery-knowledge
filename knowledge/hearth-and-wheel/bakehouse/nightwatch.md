---
type: System
title: Nightwatch
description: The overnight monitoring setup, temperature probes plus a duty baker, that watches the oven and proving cabinets, calculates the Ember Index, and flags anomalies in real time.
tags: [bakehouse, monitoring, alerts, overnight]
generated: { by: claude-code/claude-sonnet-5-5, at: 2026-09-29T10:22:51Z }
status: stable
not:
  - term: "a person or shift name only"
    why: "Nightwatch is the whole setup: the temperature probes and the duty baker together, not just the baker on duty."
    instead: "the probes plus the duty baker, as one monitoring system"
---

# Definition

**Nightwatch** is the bakery's overnight monitoring setup: **temperature probes plus a duty baker** that watch the wood-fired oven and the proving cabinets through the night.

# What it does

- **Logs temperatures** from the oven and proving cabinets.
- **Calculates the [Ember Index](/bakehouse/ember-index.md)** from the oven temperature logs.
- **Flags anomalies in real time.** A Nightwatch alert overnight usually means the Ember Index has just spiked.
- **Watches [Kettle Process](/bakehouse/kettle-process.md) batches** in the proving cabinets, flagging any that are under- or over-proving.

# Reading a Nightwatch alert

1. Check the Ember Index: an alert usually means it just spiked.
2. Check whether Kettle Process batches are under- or over-proving. Badly proved dough is a common cause of a spike.
3. If batches were spoiled or scorched, expect the day's [Wheel](/wholesale-round/the-wheel.md) to be reshuffled.

# Related

- [Ember Index](/bakehouse/ember-index.md): the score Nightwatch produces.
- [Kettle Process](/bakehouse/kettle-process.md): the proving Nightwatch monitors.
- [The Wheel](/wholesale-round/the-wheel.md): the delivery rotation that a bad night can disrupt.
