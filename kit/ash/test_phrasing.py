#!/usr/bin/env python3
"""What the tutor must never do again: open every correct answer the same way."""
import random
import sys

import phrasing

FAILS = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  ' + detail}")
    if not ok:
        FAILS.append(name)


def main():
    print("phrasing")

    # The exact line from the 2026-09-17 lesson, and the substance behind it.
    got = phrasing.strip_opener("Spot on. 0 now points straight at the root.")
    check("P.1 spot on is removed", got == "0 now points straight at the root.", got)

    got = phrasing.strip_opener("Exactly right — the two roots get linked, not the items.")
    check("P.2 stacked praise is removed",
          got == "The two roots get linked, not the items.", got)

    got = phrasing.strip_opener("Yes! Nice one. That is the whole trick.")
    check("P.3 several openers in a row", got == "That is the whole trick.", got)

    got = phrasing.strip_opener("The root is 3.")
    check("P.4 substance is left alone", got == "The root is 3.", got)

    # A response that is nothing but praise must still say something.
    out = phrasing.acknowledge("Spot on!", True, random.Random(1))
    check("P.5 pure praise still answers", bool(out.strip()), repr(out))

    # Twenty correct answers in a row must not produce one repeated opener twenty times.
    phrasing.reset()
    rng = random.Random(7)
    outs = [phrasing.acknowledge("Spot on. The root is 3.", True, rng) for _ in range(20)]
    # A silent response is not an opener — it is the absence of one, and it is allowed to
    # be the most common thing the tutor does. Only the spoken acknowledgements are held
    # to the no-repetition rule.
    said = [next(a for a in phrasing.ACKS if o.startswith(a)) for o in outs
            if any(o.startswith(a) for a in phrasing.ACKS)]
    top = max((said.count(a) for a in set(said)), default=0)
    check("P.6 no acknowledgement dominates", top <= 3,
          f"most common appeared {top}/{len(said)}")
    check("P.7 some answers carry no praise at all",
          any(o.startswith("The root") for o in outs))
    check("P.8 never two identical acknowledgements back to back",
          all(a != b for a, b in zip(said, said[1:])))
    check("P.9 praise is the exception, not the rule", len(said) <= 13,
          f"{len(said)}/20 carried praise")

    # The voice says "write" for "right", so it stays out of the pool.
    check("P.11 no right as an opener",
          not any(a.lower().startswith("right") for a in phrasing.ACKS))

    # A wrong answer is a hint. Praising it teaches the learner that praise is noise.
    out = phrasing.acknowledge("Not quite - look at what 0 points at now.", False,
                               random.Random(3))
    check("P.12 wrong answers get no praise",
          not any(out.startswith(a) for a in phrasing.ACKS), out)

    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
