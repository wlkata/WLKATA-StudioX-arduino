"""Serial monitoring uses a fake CLI process; no physical port is opened."""
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from arduino_manager import ArduinoManager

CLI = r'''
import sys, time
from pathlib import Path
args = sys.argv[1:]
def record(value):
    with Path(__file__).with_name('events.log').open('a') as file:
        file.write(value + '\n')
if 'monitor' in args:
    port = args[args.index('--port') + 1]
    baud = args[args.index('--config') + 1]
    if port == 'missing':
        print('Cannot open serial port: device missing', flush=True)
        sys.exit(2)
    record('open:' + port + ':' + baud)
    if port == 'bulk':
        sys.stdout.buffer.write(b'x' * 250000 + b'END')
        sys.stdout.buffer.flush()
    else:
        for data in [b'first\n', b'\xe2', b'\x82', b'\xac', b'partial']:
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
            time.sleep(.005)
    sys.stdin.buffer.read()
    record('close:' + port)
elif 'upload' in args:
    record('upload')
    print('uploaded', flush=True)
else:
    print('compiled', flush=True)
'''


class SerialMonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        cli = self.folder / 'cli.py'
        cli.write_text(CLI)
        self.manager = ArduinoManager(self.folder / 'tools')
        self.manager.configure(str(cli))
        original = self.manager._args
        patch = mock.patch.object(self.manager, '_args', side_effect=lambda args: [sys.executable, *original(args)])
        patch.start()
        self.addCleanup(patch.stop)
        # SerialMonitor stores the original bound method before patching.
        self.monitor = self.manager.serial_monitor
        self.monitor._command = self.manager._args
        self.addCleanup(self.monitor.disconnect)

    def wait(self, predicate):
        for _ in range(300):
            if predicate(): return
            time.sleep(.01)
        self.fail('Timed out waiting for serial/job state')

    def test_no_startup_port_and_invalid_input_never_spawns(self):
        with mock.patch('serial_monitor.subprocess.Popen') as spawn:
            self.assertFalse(self.monitor.read()['connected'])
            for port, baud in [('',9600),(' -p',9600),('x\nY',9600),('COM9',0),('COM9',True),('COM9',9600.5)]:
                with self.assertRaises(ValueError): self.manager.connect_monitor(port,baud)
            spawn.assert_not_called()

    def test_streams_partial_lines_utf8_and_cursor_without_duplicates(self):
        self.manager.connect_monitor('COM9',9600)
        self.wait(lambda: 'partial' in self.monitor.read()['text'])
        result = self.monitor.read()
        self.assertEqual(result['text'], 'first\n€partial')
        self.assertEqual(self.monitor.read(result['cursor'])['text'], '')
        process = self.monitor._process
        self.manager.connect_monitor('COM9',9600)
        self.assertIs(self.monitor._process, process, 'same connection must be reused')
        self.monitor.disconnect()
        self.assertEqual(process.returncode, 0, 'stdin EOF gracefully shuts down the monitor')
        self.assertFalse(self.monitor.read()['connected'])

    def test_baud_changes_close_old_port_and_new_port_resets_log(self):
        self.manager.connect_monitor('COM9',9600)
        self.wait(lambda: 'partial' in self.monitor.read()['text'])
        old = self.monitor._process
        self.manager.connect_monitor('COM9',115200)
        self.wait(lambda: 'baudrate=115200' in (self.folder/'events.log').read_text())
        self.assertIsNot(old, self.monitor._process)
        self.assertEqual(old.returncode, 0)
        events = (self.folder/'events.log').read_text().splitlines()
        self.assertLess(events.index('close:COM9'), events.index('open:COM9:baudrate=115200'))
        self.assertEqual(self.monitor.read()['baudrate'],115200)
        before = self.monitor.read()['cursor']
        self.manager.connect_monitor('COM10',57600)
        self.wait(lambda: 'partial' in self.monitor.read()['text'])
        self.assertTrue(self.monitor.read(before)['reset'])
        self.assertEqual(self.monitor.read()['text'], 'first\n€partial')

    def test_clear_and_bounded_history_discard_old_cursors(self):
        self.manager.connect_monitor('bulk',9600)
        self.wait(lambda: self.monitor.read()['text'].endswith('END'))
        result = self.monitor.read()
        self.assertLessEqual(len(result['text']),self.monitor.MAX_TEXT)
        self.assertTrue(result['reset'])
        cleared = self.monitor.clear()
        self.assertEqual(cleared['text'],'')
        self.assertTrue(self.monitor.read(result['cursor'])['reset'])
        self.assertEqual(self.monitor.read(cleared['cursor'])['text'],'')
        with self.assertRaises(ValueError): self.monitor.read(-1)

    def test_failed_port_becomes_disconnected_with_diagnostic(self):
        self.manager.connect_monitor('missing',9600)
        self.wait(lambda: bool(self.monitor.read()['error']))
        result = self.monitor.read()
        self.assertFalse(result['connected'])
        self.assertIn('device missing',result['text'])
        self.manager.connect_monitor('COM9',9600)
        self.wait(lambda: 'partial' in self.monitor.read()['text'])
        self.assertEqual(self.monitor.read()['error'],'')

    def test_upload_releases_monitor_before_cli_and_blocks_new_connects(self):
        started = self.manager.compile('void setup(){} void loop(){}','arduino:avr:uno')
        self.wait(lambda: self.manager.job(started['jobId'])['done'])
        self.manager.connect_monitor('COM9',9600)
        self.wait(lambda: 'partial' in self.monitor.read()['text'])
        upload = self.manager.upload(started['jobId'],'COM9')
        self.wait(lambda: self.manager.job(upload['jobId'])['done'])
        self.assertTrue(self.manager.job(upload['jobId'])['ok'])
        events = (self.folder/'events.log').read_text().splitlines()
        self.assertLess(events.index('close:COM9'),events.index('upload'))
        self.assertFalse(self.monitor.read()['connected'])
        self.manager._active = 'uploading'
        try:
            with self.assertRaises(RuntimeError): self.manager.connect_monitor('COM9',115200)
        finally: self.manager._active = None

    def test_http_serial_controls_and_validation(self):
        from flask import Flask
        import main
        app = Flask(__name__)
        app.register_blueprint(main.blueprint)
        with mock.patch.object(main,'_manager',self.manager),app.test_client() as client:
            self.assertEqual(client.post('/serial/connect',json={'port':'COM9','baudrate':0}).status_code,400)
            self.assertFalse(client.post('/serial/read',json={}).json['connected'])
            self.assertTrue(client.post('/serial/connect',json={'port':'COM9','baudrate':9600}).json['success'])
            self.wait(lambda: 'partial' in client.post('/serial/read',json={}).json['text'])
            self.assertEqual(client.post('/serial/clear').json['text'],'')
            self.assertFalse(client.post('/serial/disconnect').json['connected'])


if __name__ == '__main__': unittest.main()
