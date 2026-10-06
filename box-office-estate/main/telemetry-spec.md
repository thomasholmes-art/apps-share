# Telemetry spec: the box-office purchase path

Author:
Written at (elapsed):
Branch:

The spec has five fields, in this order and with these names, and is written before any source file is opened. They are the same five fields that module 02's day-zero agreement started and module 04's next-pull-request (next-PR) note completed.

---

## 1. Signals

<!-- Which of logs, metrics and traces this path emits, and why each one is on the list. In module 02 the accurate answer for a single service was logs only. If the answer here is all three, movement 4 is committed to producing all three. -->

## 2. Required fields

<!-- This field has two halves, and the second is the one most often left out. -->

**Every event on the order path carries:**

<!-- The field list. List each field by name rather than writing "the usual fields". -->

**Never emitted, in any signal:**

<!-- Four or more specific items that this application handles. "No personal data" is a policy sentence and cannot be checked by a script; a named pattern can. -->

## 3. The ID

<!-- Which identifier is generated, where, and on which outbound calls it is carried: one sentence with three clauses, naming the service and the boundary. If a service is linked to the others by something other than this identifier, state which service and what links it. -->

## 4. Attachment

<!-- How telemetry is turned on for each service, as the command or flag that does it, and where it is exported: mechanism, destination, protocol and version pin. -->

## 5. The question

<!-- The one question that a dashboard for this path must show the answer to, and the objective it supports. A usable question states a population, a threshold and a window. If any of the three is missing, whoever builds the panel has to come back and ask. -->

---

## One habit for the next build

<!-- Written at the end of the lab, after stating it aloud. One sentence, about the next new service rather than about this application. -->
