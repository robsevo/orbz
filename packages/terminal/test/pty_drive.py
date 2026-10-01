"""Runs a command in a real pseudo-terminal, for the terminal's tests (PLAN 1.9_t).

    python pty_drive.py COLS ROWS -- COMMAND [ARGS...]

What the command draws comes out on stdout, byte for byte. What arrives on stdin is typed into
the terminal. The window size is set in the child before it starts, so the first frame is
already laid out at that size. When the command exits, its exit code is passed on. Stdlib only:
the kit's own Python runs it, so it works on a machine that has no Python of its own.
"""

import fcntl
import os
import pty
import select
import struct
import sys
import termios


def main() -> int:
    cols, rows = int(sys.argv[1]), int(sys.argv[2])
    if sys.argv[3] != "--":
        raise SystemExit("usage: pty_drive.py COLS ROWS -- COMMAND [ARGS...]")
    cmd = sys.argv[4:]
    pid, master = pty.fork()
    if pid == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        os.execvp(cmd[0], cmd)
    stdin_open = True
    while True:
        fds = [master] + ([0] if stdin_open else [])
        ready, _, _ = select.select(fds, [], [], 0.5)
        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError:  # EIO: the child closed the terminal
                data = b""
            if not data:
                break
            os.write(1, data)
        if 0 in ready:
            data = os.read(0, 65536)
            if not data:
                stdin_open = False
            else:
                os.write(master, data)
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    sys.exit(main())
