"""Bounded serial text stream through Arduino CLI; no port opens at startup."""
from collections import deque
import codecs
import os
import subprocess
import threading


class SerialMonitor:
    MAX_TEXT = 200_000

    def __init__(self, command, terminate):
        self._command = command
        self._terminate = terminate
        self._control = threading.RLock()
        self._lock = threading.RLock()
        self._process = None
        self._thread = None
        self._generation = 0
        self._chunks = deque()
        self._characters = 0
        self._sequence = 0
        self._floor = 0
        self._port = ''
        self._baudrate = 9600
        self._error = ''

    @staticmethod
    def validate(port, baudrate):
        if not isinstance(port, str):
            raise ValueError('Choose a serial port before connecting.')
        port = port.strip()
        if not port or port.startswith('-') or len(port) > 250 or any(c in port for c in '\0\r\n'):
            raise ValueError('Choose a serial port before connecting.')
        if isinstance(baudrate, bool) or not isinstance(baudrate, int) or not 50 <= baudrate <= 4_000_000:
            raise ValueError('Baud rate must be an integer from 50 to 4000000.')
        return port

    def connect(self, port, baudrate):
        port = self.validate(port, baudrate)
        with self._control:
            with self._lock:
                if self._process and self._process.poll() is None and (port, baudrate) == (self._port, self._baudrate):
                    return self.read()
            command = self._command(['monitor', '--port', port, '--protocol', 'serial',
                                     '--config', 'baudrate=' + str(baudrate), '--quiet', '--raw'])
            self.disconnect()
            with self._lock:
                if port != self._port:
                    self.clear()
                self._port, self._baudrate, self._error = port, baudrate, ''
                self._generation += 1
                generation = self._generation
            # Keeping stdin open keeps CLI monitor alive. EOF makes it close the
            # port and its helper process, including when this backend exits.
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, bufsize=0, start_new_session=os.name != 'nt')
            with self._lock:
                self._process = process
            self._thread = threading.Thread(target=self._consume, args=(process, generation), daemon=True,
                                            name='arduino-serial-monitor')
            self._thread.start()
            return self.read()

    def _append(self, text, generation):
        if not text:
            return
        with self._lock:
            if generation != self._generation:
                return
            self._sequence += 1
            self._chunks.append((self._sequence, text))
            self._characters += len(text)
            while self._characters > self.MAX_TEXT and len(self._chunks) > 1:
                sequence, removed = self._chunks.popleft()
                self._floor = sequence
                self._characters -= len(removed)

    def _consume(self, process, generation):
        decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
        failure = ''
        try:
            while True:
                data = process.stdout.read(4096)
                if not data:
                    break
                self._append(decoder.decode(data), generation)
            self._append(decoder.decode(b'', final=True), generation)
            code = process.wait()
            failure = 'Serial connection closed.' if code == 0 else 'Serial monitor stopped. Check the serial log for details.'
        except (OSError, ValueError) as exc:
            failure = 'Serial monitor: ' + str(exc)
            self._terminate(process)
        finally:
            for pipe in (process.stdin, process.stdout):
                if pipe:
                    pipe.close()
            with self._lock:
                if self._process is process and generation == self._generation:
                    self._process = None
                    self._error = failure

    def disconnect(self, port=None):
        with self._control:
            with self._lock:
                if port is not None and port != self._port:
                    return self.read()
                process, thread = self._process, self._thread
                self._process = self._thread = None
                self._generation += 1
                self._error = ''
            if process:
                try:
                    if process.stdin:
                        process.stdin.close()
                    process.wait(timeout=2)
                except (OSError, subprocess.TimeoutExpired):
                    self._terminate(process)
            if thread and thread is not threading.current_thread():
                thread.join(timeout=2)
            return self.read()

    def clear(self):
        with self._lock:
            self._chunks.clear()
            self._characters = 0
            self._sequence += 1
            self._floor = self._sequence
            return self.read()

    def read(self, cursor=0):
        if isinstance(cursor, bool) or not isinstance(cursor, int) or cursor < 0:
            raise ValueError('Invalid serial log cursor.')
        with self._lock:
            reset = cursor < self._floor or cursor > self._sequence
            after = self._floor if reset else cursor
            return {'success': True, 'connected': self._process is not None and self._process.poll() is None,
                    'port': self._port, 'baudrate': self._baudrate, 'error': self._error,
                    'cursor': self._sequence, 'reset': reset,
                    'text': ''.join(text for sequence, text in self._chunks if sequence > after)}
