"""Tooling jobs are tested against a fake CLI, never an Arduino board."""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from arduino_manager import ArduinoManager, validate_board


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cli = self.root / 'arduino-cli'
        self.cli.write_text('''#!/usr/bin/env python3
import json, sys, time
args = sys.argv[1:]
if 'slow' in args:
    print('waiting', flush=True)
    time.sleep(30)
if 'fail' in args:
    print('compiler diagnostic', flush=True)
    sys.exit(2)
if 'version' in args:
    print(json.dumps({'VersionString':'test'}))
elif 'listall' in args:
    print(json.dumps({'boards':[{'name':'Custom board','fqbn':'vendor:arch:custom'}]}))
elif 'list' in args:
    print(json.dumps({'detected_ports':[{'port':{'address':'COM9','protocol':'serial','label':'Test port'}}, {'port':{'address':'network','protocol':'network'}}]}))
else:
    print('CLI success: ' + json.dumps(args), flush=True)
''')
        self.cli.chmod(0o755)
        self.manager = ArduinoManager(self.root / 'data')
        self.manager.configure(str(self.cli))
        original_args = self.manager._args
        patcher = mock.patch.object(self.manager, '_args', side_effect=lambda args: [sys.executable, *original_args(args)])
        patcher.start()
        self.addCleanup(patcher.stop)

    def wait(self, started):
        identifier = started['jobId']
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            result = self.manager.job(identifier)
            if result['done']:
                return result
            time.sleep(0.01)
        self.fail('Job timed out')

    def test_status_boards_and_ports(self):
        self.assertTrue(self.manager.status()['available'])
        self.assertTrue(any(board['fqbn'] == 'vendor:arch:custom' for board in self.manager.boards()['boards']))
        self.assertEqual([port['address'] for port in self.manager.ports()['ports']], ['COM9'])
        saved = json.loads((self.manager.home / 'arduino-cli.yaml').read_text())
        self.assertTrue(saved['directories']['data'].startswith(str(self.manager.home)))

    def test_compile_has_immutable_source_and_upload_uses_its_board_and_artifacts(self):
        started = self.manager.compile('void setup() {}\nvoid loop() {}', 'arduino:avr:uno')
        result = self.wait(started)
        self.assertTrue(result['ok'], result)
        self.assertEqual(len(result['sourceHash']), 64)
        original = self.manager._jobs[result['id']]
        self.assertEqual((Path(original['sketch']) / 'StudioXSketch.ino').read_text(), 'void setup() {}\nvoid loop() {}')
        uploaded = self.wait(self.manager.upload(result['id'], 'COM9'))
        self.assertTrue(uploaded['ok'], uploaded)
        command = '\n'.join(uploaded['log'])
        self.assertIn('arduino:avr:uno', command)
        self.assertIn('--input-dir', command)
        self.assertIn(original['output'], command)
        self.assertIn('COM9', command)

    def test_upload_without_successful_compile_is_rejected(self):
        with self.assertRaises(ValueError):
            self.manager.upload('missing', 'COM9')
        failed = self.manager._new_job('compile', 'arduino:avr:uno', lambda job: self.manager._run(job, ['fail']))
        self.assertFalse(self.wait(failed)['ok'])
        with self.assertRaises(ValueError):
            self.manager.upload(failed['jobId'], 'COM9')

    def test_missing_cli_is_actionable_and_cannot_start_jobs(self):
        with mock.patch.object(self.manager, 'cli', side_effect=RuntimeError('Arduino CLI was not found')):
            self.assertFalse(self.manager.status()['available'])
            with self.assertRaises(RuntimeError):
                self.manager.compile('void setup() {}', 'arduino:avr:uno')

    def test_reject_invalid_board_source_port_and_cli_path(self):
        for board in ['uno', '--fqbn', 'arduino:avr:uno; echo bad', None]:
            with self.assertRaises(ValueError):
                validate_board(board)
        for source in ['', None, '\0', 'x' * (1024 * 1024 + 1)]:
            with self.assertRaises(ValueError):
                self.manager.compile(source, 'arduino:avr:uno')
        for port in ['', '--bad', '\0', None]:
            with self.assertRaises(ValueError):
                self.manager.upload('missing', port)
        with self.assertRaises(ValueError):
            self.manager.configure('relative/arduino-cli')

    def test_core_install_updates_index_then_installs_selected_platform(self):
        result = self.wait(self.manager.install_core('arduino:avr:uno'))
        self.assertTrue(result['ok'], result)
        self.assertIn('core update-index', result['log'][0])
        self.assertTrue(any('core install arduino:avr' in line for line in result['log']))

    def test_cancel_terminates_job_and_releases_operation_lock(self):
        started = self.manager._new_job('compile', 'arduino:avr:uno', lambda job: self.manager._run(job, ['slow']))
        try:
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline and self.manager._jobs[started['jobId']]['process'] is None:
                time.sleep(0.01)
            with self.assertRaises(RuntimeError):
                self.manager.compile('void setup() {}', 'arduino:avr:uno')
            with self.assertRaises(RuntimeError):
                self.manager.configure(str(self.cli))
        finally:
            self.manager.cancel(started['jobId'])
        result = self.wait(started)
        self.assertFalse(result['ok'])
        self.assertIn('cancelled', result['error'])
        self.assertTrue(self.wait(self.manager.compile('void setup() {}', 'arduino:avr:uno'))['ok'])

    def test_timeout_releases_operation_lock_and_preserves_log(self):
        result = self.wait(self.manager._new_job('compile', 'arduino:avr:uno', lambda job: self.manager._run(job, ['slow'], timeout=0.05)))
        self.assertFalse(result['ok'])
        self.assertIn('timed out', result['error'])
        self.assertIsNone(self.manager._active)

    def test_history_is_bounded_and_keeps_artifact_selected_for_upload(self):
        compiled = self.wait(self.manager.compile('void setup() {}', 'arduino:avr:uno'))
        for _ in range(19):
            self.wait(self.manager._new_job('core', 'arduino:avr:uno', lambda job: None))
        self.assertTrue(self.wait(self.manager.upload(compiled['id'], 'COM9'))['ok'])
        self.assertLessEqual(len(self.manager._jobs), 20)
        self.assertIn(compiled['id'], self.manager._jobs)

    def test_http_errors_are_structured_and_jobs_poll_without_running_hardware(self):
        from flask import Flask
        import main
        app = Flask('arduino-test')
        app.register_blueprint(main.blueprint)
        with mock.patch.object(main, '_manager', self.manager), app.test_client() as client:
            invalid = client.post('/compile', json={'code': 'code', 'board': '../bad'})
            self.assertEqual(invalid.status_code, 400)
            self.assertFalse(invalid.get_json()['success'])
            started = client.post('/compile', json={'code': 'void setup() {}', 'board': 'arduino:avr:uno'}).get_json()
            self.assertTrue(self.wait(started)['ok'])
            self.assertTrue(client.get('/jobs/' + started['jobId']).get_json()['ok'])
            self.assertFalse(client.post('/upload', json={'compileId': 'missing', 'port': 'COM9'}).get_json()['success'])


if __name__ == '__main__':
    unittest.main()
