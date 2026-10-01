// A small terminal screen for the tests: it applies the bytes a program writes (text, the cursor
// moves and erases Ink uses, scrolling) to a grid, so a test can ask what is on the screen NOW,
// not merely whether some text was written at some point. A freeze shows as a screen that stops
// changing; a desync (Ink erasing by a line count that no longer matches) shows as rows that are
// wrong. Colours and modes are read past.
export class Screen {
  readonly cols: number;
  readonly height: number;
  grid: string[][];
  x = 0;
  y = 0;
  #wrap = false; // a character went in the last column: the next one wraps (as xterm defers it)
  #saved: [number, number] = [0, 0];
  #pending = "";

  constructor(cols: number, height: number) {
    this.cols = cols;
    this.height = height;
    this.grid = Array.from({ length: height }, () => this.#blank());
  }

  #blank(): string[] {
    return Array.from({ length: this.cols }, () => " ");
  }

  #lineFeed(): void {
    if (this.y === this.height - 1) {
      this.grid.shift();
      this.grid.push(this.#blank());
    } else this.y++;
  }

  #clampY(): void {
    this.y = Math.max(0, Math.min(this.height - 1, this.y));
  }

  feed(data: string): void {
    const s = this.#pending + data;
    this.#pending = "";
    let i = 0;
    while (i < s.length) {
      const c = s[i]!;
      if (c === "\x1b") {
        const next = s[i + 1];
        if (next === undefined) {
          this.#pending = s.slice(i);
          return;
        }
        if (next === "[") {
          const m = /^\x1b\[([0-9;?<>=!]*)([ -/]*)([@-~])/.exec(s.slice(i));
          if (!m) {
            if (/^\x1b\[[0-9;?<>=! -/]*$/.test(s.slice(i))) {
              this.#pending = s.slice(i); // a sequence split across reads
              return;
            }
            i += 2;
            continue;
          }
          this.#csi(m[1]!, m[3]!);
          i += m[0].length;
          continue;
        }
        if (next === "]") {
          const end = s.slice(i).search(/\x07|\x1b\\/);
          if (end < 0) {
            this.#pending = s.slice(i);
            return;
          }
          i += end + (s[i + end] === "\x07" ? 1 : 2);
          continue;
        }
        if (next === "7") this.#saved = [this.x, this.y];
        else if (next === "8") [this.x, this.y] = this.#saved;
        i += 2;
        continue;
      }
      i++;
      if (c === "\r") {
        this.x = 0;
        this.#wrap = false;
      } else if (c === "\n") {
        this.#lineFeed();
        this.#wrap = false;
      } else if (c === "\b") {
        this.x = Math.max(0, this.x - 1);
        this.#wrap = false;
      } else if (c === "\t") {
        this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
      } else if (c < " " || c === "\x7f") {
        // other controls: ignored
      } else {
        const code = c.charCodeAt(0);
        let ch = c;
        if (code >= 0xd800 && code < 0xdc00 && i < s.length) ch += s[i++]; // a surrogate pair is one character
        if (this.#wrap) {
          this.x = 0;
          this.#lineFeed();
          this.#wrap = false;
        }
        this.grid[this.y]![this.x] = ch;
        if (this.x === this.cols - 1) this.#wrap = true;
        else this.x++;
      }
    }
  }

  #csi(params: string, final: string): void {
    if (params.startsWith("?") || params.startsWith(">") || params.startsWith("<") || params.startsWith("=")) return; // modes
    const ns = params.split(";").map((p) => (p === "" ? NaN : Number(p)));
    const n = Number.isNaN(ns[0]!) ? 1 : Math.max(1, ns[0]!);
    const n0 = Number.isNaN(ns[0]!) ? 0 : ns[0]!;
    this.#wrap = false;
    switch (final) {
      case "A":
        this.y -= n;
        break;
      case "B":
        this.y += n;
        break;
      case "C":
        this.x = Math.min(this.cols - 1, this.x + n);
        break;
      case "D":
        this.x = Math.max(0, this.x - n);
        break;
      case "E":
        this.y += n;
        this.x = 0;
        break;
      case "F":
        this.y -= n;
        this.x = 0;
        break;
      case "G":
        this.x = Math.min(this.cols - 1, n - 1);
        break;
      case "H":
      case "f":
        this.y = (Number.isNaN(ns[0]!) ? 1 : ns[0]!) - 1;
        this.x = Math.min(this.cols - 1, (Number.isNaN(ns[1] ?? NaN) ? 1 : ns[1]!) - 1);
        break;
      case "J":
        if (n0 === 0) {
          this.grid[this.y]!.fill(" ", this.x);
          for (let r = this.y + 1; r < this.height; r++) this.grid[r] = this.#blank();
        } else if (n0 === 1) {
          for (let r = 0; r < this.y; r++) this.grid[r] = this.#blank();
          this.grid[this.y]!.fill(" ", 0, this.x + 1);
        } else for (let r = 0; r < this.height; r++) this.grid[r] = this.#blank();
        break;
      case "K":
        if (n0 === 0) this.grid[this.y]!.fill(" ", this.x);
        else if (n0 === 1) this.grid[this.y]!.fill(" ", 0, this.x + 1);
        else this.grid[this.y] = this.#blank();
        break;
      case "S":
        for (let k = 0; k < n; k++) {
          this.grid.shift();
          this.grid.push(this.#blank());
        }
        break;
      case "T":
        for (let k = 0; k < n; k++) {
          this.grid.pop();
          this.grid.unshift(this.#blank());
        }
        break;
      default:
        break; // colours (m) and the rest change no text
    }
    this.#clampY();
  }

  /** The visible rows, right-trimmed. */
  lines(): string[] {
    return this.grid.map((r) => r.join("").trimEnd());
  }

  text(): string {
    return this.lines().join("\n");
  }
}
