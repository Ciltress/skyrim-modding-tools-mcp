# Composite tools where the protocol is the hard part

Inherited from the server this template was extracted from. There, editing an object took four
calls — lock, write, activate, unlock — and a composite tool was added that does the whole cycle and
releases the lock in a `finally`, on every path. The four steps stayed, for edits that need them apart.

The argument is about what an interface contains. Everything a caller had to know to drive the cycle
correctly was outside the schemas: the order of the calls, the lifetime of a lock handle, that the
lock was bound to the session, and that a failure halfway through still obliged an unlock. None of
that can be typed. It lived as prose in a guide, and a rule a model has to remember across four calls
is a rule it will sometimes not remember — with a failure that is not local, because an orphaned lock
on a shared system blocks other people.

[ADR-0001](0001-tool-count-is-a-cost.md) keeps the tool set small and says demand is the evidence for
adding a tool. A sequence whose *ordering and obligations* are the hard part is that evidence.

## Consequences

- The test is whether the ordering and obligations are the hard part, not whether several calls
  happen to be adjacent. This is not a licence to wrap every sequence.
- A composite tool must leave the backend no worse than it found it. Clean-up runs on every path, and
  a clean-up failure is reported rather than thrown over the result — it must not turn a successful
  write into an error, nor mask the failure that caused it.
- The steps stay available where they genuinely vary, and a small profile lists the composite instead
  of the steps, so the smallest client carries less and has less to get wrong.
