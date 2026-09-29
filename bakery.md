# Hackathon: Business Context for AI at Hearth & Wheel Bakery

## The Business (Overview)

Hearth & Wheel is a fictional independent bakery with two arms to its operation:

1. **A retail shop** selling bread, pastries, and coffee to walk-in customers.
2. **A wholesale bread round** supplying fresh bread daily to a network of local independent cafes.

The bakery bakes overnight using a wood-fired oven and traditional sourdough methods, then delivers wholesale orders each morning on a rotating schedule. Customers can also call the bakery directly, where they're greeted by "Michael," an AI-powered telephone assistant.

This is a fabricated business created purely for the purposes of a hackathon demo on providing business context to AI agents.

---

## Domain Concepts

### Domain 1: The Bakehouse
*Covers production — proving, baking, and overnight monitoring.*

#### The Kettle Process
The bakery's overnight sourdough routine. Starter is fed and left in a steam-kettle-humidified proving cabinet for roughly 14 hours before shaping and baking. Batches "in the Kettle Process" are still proving and not yet ready for the oven.

#### Ember Index
A 0–100 score generated from oven temperature logs, indicating how stable the wood-fired oven's heat has been overnight. A high score means the oven has been running hot or unevenly, risking scorched crusts or undercooked loaves.

#### Nightwatch
The overnight monitoring setup — temperature probes plus a duty baker — that watches the oven and proving cabinets through the night. Nightwatch logs temperatures, calculates the Ember Index, and flags anomalies in real time.

### Domain 2: The Wholesale Round
*Covers wholesale cafe customers, delivery routes, and account renewals.*

#### Constellations
The groupings used to organize wholesale cafe customers — by delivery route, not by size or order volume. For example, "Orion" might cover east-side cafes and "Lyra" the north-loop cafes.

#### The Wheel
The weekly delivery rotation board showing which constellations receive bread on which days, and in what delivery order.

#### Looming
The status of a wholesale account whose standing order is approaching renewal or renegotiation — e.g. a 3-month bread supply agreement that is "looming" for renewal.

### Domain 3: Shop & Customer Line

#### Michael
Hearth & Wheel's customer-facing AI telephone assistant. Michael is styled and voiced on TV presenter Michael McIntyre, and answers the bakery's public phone line — taking retail and wholesale enquiries, quoting order status, and fielding general questions from customers and cafe partners. He is not an internal staff tool; he is the voice customers hear when they call the shop.

---

## Cross-Domain Relationships

| Concept A | Concept B | Relationship |
|---|---|---|
| Kettle Process | Ember Index | Under- or over-proved dough from the Kettle Process bakes unevenly, showing up as a spike in the Ember Index. |
| Nightwatch | Ember Index | Nightwatch is what logs and calculates the Ember Index overnight — an alert usually means the Index just spiked. |
| Nightwatch | Kettle Process | Nightwatch also watches the proving cabinets, flagging Kettle Process batches that are under- or over-proving. |
| Ember Index | The Wheel | A poor overnight Ember Index (spoiled or scorched batches) can force that day's Wheel to be reshuffled — affected constellations get delayed or substituted. |
| Constellations | The Wheel | The Wheel schedules deliveries by constellation, not by individual cafe. |
| Looming | Constellations | A looming renewal always belongs to one account within a specific constellation. |
| Looming | The Wheel | A cafe that's looming for renewal is often flagged for an in-person visit during their next Wheel delivery slot. |
| Michael | Wholesale Round | When a cafe partner calls, Michael can quote whether their delivery is on this week's Wheel or whether their account is looming for renewal. |
| Michael | Bakehouse | When a retail customer calls asking about stock or delays, Michael can reference whether last night's Ember Index or Nightwatch affected today's bake. |

---

## Rationale

**Why a bakery?** Everyone intuitively understands baking, delivery rounds, and cafe customers — so the audience can follow the "plot" of the demo without needing domain expertise. This lets the hackathon audience focus on the AI mechanism (context injection via skills/MCP) rather than spending time understanding an unfamiliar industry.

**Why these concepts?** Each term is a plausible-sounding piece of business jargon (an index, a process, a rota, a nickname) that could exist in any small business — but none of them exist in any real bakery, so there is no risk of an LLM "getting lucky" from training data. This makes the before/after contrast unambiguous: any correct answer in the "after" demo can only have come from the injected knowledge base.

**Why three domains?** Three domains is small enough to explain on one slide (Bakehouse → Wholesale Round → Shop & Customer Line) while still allowing rich cross-domain relationships. The relationships are the real payload of the demo — they show that business context isn't just a glossary of terms, but a network of dependencies that only a connected knowledge base (not a flat FAQ) can capture.

**Why "Michael" as a customer-facing phone assistant?** It gives the demo a concrete, relatable product surface — a real customer calling in with a real question — rather than an abstract internal chatbot. It also lets the hackathon show that the *same* knowledge base can serve very different agent types: a phone assistant answering a customer, a coding agent helping an engineer, and an analyst-style agent answering a business question. That range is a good way to demonstrate that business context is reusable infrastructure, not a single-purpose script.

---

## Prompt Examples

These prompts reference invented terminology an LLM has no way to know without the knowledge base. They're grouped by the type of person or agent asking, to show that the same knowledge base serves very different roles and use cases across the business.

### Customer-facing (via Michael, the phone assistant)
> "Hi, I run a cafe on the north side — is my delivery still coming today, or has anything changed this week?"
*(Requires knowing the caller's cafe → Constellation → this week's Wheel schedule.)*

> "Is my bread order due for renewal soon?"
*(Requires knowing the account's Looming status.)*

### Software engineer (coding agent)
> "I'm designing the database schema for our ops system. We need tables to track constellations, wheel scheduling, ember index readings, and looming renewal status. Can you propose a relational structure with the key relationships between them?"
*(A coding agent without context will invent generic-sounding but wrong table structures, or ask what these terms mean instead of modeling them correctly.)*

> "Write an API endpoint that returns all cafes in a given constellation that are currently looming for renewal, sorted by their next Wheel delivery date."

> "We're building a Nightwatch alerting integration — what fields should the webhook payload include so downstream systems can update the Ember Index and reshuffle the Wheel automatically?"

### New starter / general staff (definitional questions)
> "What is looming, and how would I find out if a customer counts as looming?"

> "Someone mentioned the Kettle Process in a handover note — what does that actually involve?"

### Product / business development
> "How many times has Nightwatch fired in the last quarter, and did it correlate with any Wheel reshuffles?"

> "We're thinking of adding a fourth constellation — what would need to change about how the Wheel is scheduled?"

> "Draft a one-pager pitching a self-service portal where looming wholesale accounts can renew online — what data would it need from the Wholesale Round domain?"

### Data / analytics-style query
> "How many batches have had an Ember Index above 70 since the start of the year, and which constellations were affected on those days?"

> "What's the average time between a cafe first appearing as looming and their renewal being confirmed?"

### Cross-domain "hardest chain" example
> "Michael, walk me through this morning: any Nightwatch alerts, what that means for the Ember Index, whether the Kettle Process batches are affected, and who's looming on the Wheel this week."

Each of these is unanswerable — or will be confidently hallucinated or misinterpreted — by a vanilla LLM or coding agent with no business context. With the knowledge base loaded via skill/MCP, the agent can correctly trace the relationships between domains to produce a grounded, accurate answer — whether it's a customer on the phone, an engineer designing a schema, or someone simply asking what a term means.
