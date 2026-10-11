// The reverse engineer's reading, on a thread of its own (read.ts readOffThread): one ask in, one answer out.
import { parentPort, workerData } from "node:worker_threads";
import { answer, type Ask } from "./read.ts";

parentPort?.postMessage(answer(workerData as Ask));
