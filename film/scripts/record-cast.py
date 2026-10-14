#!/usr/bin/env python3
"""
Records a real terminal run as an asciicast v2 file, with its real timing.

The command runs in a pseudo-terminal of a fixed size, exactly as it would in a terminal window;
every chunk it prints is stamped with the time it arrived. Nothing is typed or edited: the prompt
and the command line are shown as run, then the command's own output.

  python3 scripts/record-cast.py <cols> <rows> <out.cast> <cwd> <command> [args...]
"""
import fcntl
import json
import os
import pty
import select
import struct
import sys
import termios
import time

cols, rows, out, cwd, cmd = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5:]
prompt = '\x1b[1;36mkova\x1b[0m \x1b[1;33m' + os.path.basename(cwd.rstrip('/')) + '\x1b[0m $ '

events = []
start = time.monotonic()


def emit(data: str) -> None:
    events.append([round(time.monotonic() - start, 6), 'o', data])


emit(prompt)
time.sleep(0.8)
shown = cmd[2] if len(cmd) >= 3 and cmd[0] in ('sh', 'zsh', 'bash') and cmd[1] == '-c' else ' '.join(cmd)
emit(shown + '\r\n')

pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    os.chdir(cwd)
    os.environ['TERM'] = 'xterm-256color'
    os.environ['COLUMNS'] = str(cols)
    os.environ['LINES'] = str(rows)
    os.execvp(cmd[0], cmd)

status = 0
while True:
    ready, _, _ = select.select([fd], [], [], 0.1)
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b''
        if not data:
            break
        text = data.decode('utf-8', 'replace')
        emit(text)
        sys.stdout.write(text)
        sys.stdout.flush()
_, status = os.waitpid(pid, 0)
emit('\r\n' + prompt)

with open(out, 'w') as f:
    header = {'version': 2, 'width': cols, 'height': rows, 'timestamp': int(time.time()), 'env': {'TERM': 'xterm-256color', 'SHELL': '/bin/zsh'}}
    f.write(json.dumps(header) + '\n')
    for e in events:
        f.write(json.dumps(e) + '\n')
print(f'\n[recorded {len(events)} chunks over {events[-1][0]:.1f}s, exit {os.waitstatus_to_exitcode(status)}]', file=sys.stderr)
sys.exit(os.waitstatus_to_exitcode(status))
