---
type: Metric
title: Ember Index
description: A 0-100 score generated from oven temperature logs showing how
  stable the wood-fired oven's heat was overnight; a high score is bad.
tags:
  - bakehouse
  - oven
  - metric
  - nightwatch
status: stable
not:
  - term: a quality score where higher is better
    why: the Ember Index measures instability. A high score means the oven ran hot
      or unevenly.
    instead: "read a high Ember Index as a warning: risk of scorched crusts or
      undercooked loaves"
---
# Definition

The **Ember Index** is a score from **0 to 100**, generated from the wood-fired oven's temperature logs, that indicates how stable the oven's heat was overnight.

**Higher is worse.** A high score means the oven has been running hot or unevenly, risking scorched crusts or undercooked loaves. A spike is the signal people talk about ("last night's Ember Index spiked").

# How it is produced

The Index is logged and calculated overnight by [Nightwatch](/bakehouse/nightwtch.md) from its temperature probes. An overnight Nightwatch alert usually means the Ember Index has just spiked.

# What causes a spike

- Under- or over-proved dough from the [Kettle Process](/bakehouse/kettle-process.md) bakes unevenly, which shows up as a spike.
- The oven running hot or unevenly for other reasons.

# Downstream effects

- A poor overnight Ember Index (spoiled or scorched batches) can force that day's [Wheel](/wholesale-round/the-wheel.md) to be reshuffled. Affected [constellations](/wholesale-round/constellations.md) get delayed or substituted deliveries.
- [Michael](/shop-and-customer-line/michael.md), the phone assistant, can tell a retail caller whether last night's Ember Index affected today's bake.

# Test

This is a test edit.