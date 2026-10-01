#!/usr/bin/env node
// A stand-in browser for the terminal's tests: opens the sign-in link it is given and follows the
// redirect to the home's callback, as the person's browser would. Never a real browser in a test.
const url = process.argv[2];
const first = await fetch(url, { redirect: "manual" });
const to = first.headers.get("location");
if (to) await (await fetch(to)).text();
