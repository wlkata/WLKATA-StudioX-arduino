"""Arduino CLI jobs. Each compile owns an immutable sketch and output directory."""
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import uuid
from urllib.parse import urlparse
from toolchain import installed_cli

FQBN = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_.-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*(?::[A-Za-z0-9_=,.-]+)?$')
DEFAULT_BOARDS = [
    {'name': 'Arduino Uno', 'fqbn': 'arduino:avr:uno'},
    {'name': 'Arduino Nano', 'fqbn': 'arduino:avr:nano'},
    {'name': 'Arduino Nano (old bootloader)', 'fqbn': 'arduino:avr:nano:cpu=atmega328old'},
    {'name': 'Arduino Mega 2560', 'fqbn': 'arduino:avr:mega:cpu=atmega2560'},
]


def validate_board(value):
    if not isinstance(value, str) or len(value) > 200 or not FQBN.fullmatch(value):
        raise ValueError('Choose a valid Arduino board (FQBN).')
    return value


class ArduinoManager:
    def __init__(self, home=None):
        data_dir = Path(os.environ.get('STUDIOX_EXTENSION_DATA_DIR') or
                        Path.home() / '.wlkata-studiox' / 'extensions' / 'arduino' / '.data')
        self.home = Path(home or os.environ.get('STUDIOX_ARDUINO_HOME') or data_dir / 'toolchain')
        self._lock = threading.RLock()
        self._active = None
        self._jobs = {}
        self._cli_path = ''
        self._loaded = False

    def _load_settings(self):
        with self._lock:
            if self._loaded:
                return
            try:
                saved = json.loads((self.home / 'settings.json').read_text())
                value = saved.get('cliPath', '') if isinstance(saved, dict) else ''
                self._cli_path = value if isinstance(value, str) else ''
            except (OSError, ValueError, TypeError):
                pass
            self._loaded = True

    def cli(self):
        self._load_settings()
        candidate = self._cli_path or os.environ.get('STUDIOX_ARDUINO_CLI') or installed_cli(self.home) or shutil.which('arduino-cli')
        if not candidate:
            # macOS GUI apps do not always inherit Homebrew's shell PATH.
            candidate = next((str(path) for path in [Path('/opt/homebrew/bin/arduino-cli'), Path('/usr/local/bin/arduino-cli')]
                              if path.is_file()), None)
        if not candidate or not Path(candidate).is_file():
            raise RuntimeError('Arduino CLI was not found. Run Re-setup for Arduino in Settings → Extensions, or select an existing CLI below.')
        return str(candidate)

    def configure(self, cli_path):
        if not isinstance(cli_path, str):
            raise ValueError('CLI path must be text.')
        cli_path = cli_path.strip()
        if cli_path and (not Path(cli_path).is_absolute() or not Path(cli_path).is_file()):
            raise ValueError('Enter the full path to the arduino-cli executable.')
        with self._lock:
            if self._active:
                raise RuntimeError('Wait for the active operation before changing Arduino CLI.')
            self.home.mkdir(parents=True, exist_ok=True)
            (self.home / 'settings.json').write_text(json.dumps({'cliPath': cli_path}), encoding='utf-8')
            self._cli_path = cli_path
            self._loaded = True
        return {'success': True}

    def _config(self):
        self.home.mkdir(parents=True, exist_ok=True)
        config = self.home / 'arduino-cli.yaml'
        if not config.exists():
            # JSON is valid YAML. Quoted paths also work on Windows.
            config.write_text(json.dumps({'directories': {
                'data': str(self.home / 'data'), 'downloads': str(self.home / 'downloads'),
                'user': str(self.home / 'sketchbook'),
            }, 'build_cache': {'path': str(self.home / 'cache')},
                'updater': {'enable_notification': False}}), encoding='utf-8')
        return str(config)

    def _args(self, args):
        return [self.cli(), '--config-file', self._config(), *args]

    def _json(self, args):
        result = subprocess.run(self._args([*args, '--json']), capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise RuntimeError((result.stderr or result.stdout or 'Arduino CLI failed.').strip()[-4000:])
        try:
            return json.loads(result.stdout)
        except ValueError as exc:
            raise RuntimeError('Arduino CLI returned an unreadable response.') from exc

    def status(self):
        try:
            executable = self.cli()
            version = self._json(['version'])
            return {'success': True, 'available': True, 'cliPath': executable, 'version': version}
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
            return {'success': True, 'available': False, 'error': str(exc)}

    def boards(self):
        data = self._json(['board', 'listall'])
        known = {item['fqbn']: item for item in DEFAULT_BOARDS}
        for item in data.get('boards') or []:
            fqbn = item.get('fqbn')
            if isinstance(fqbn, str) and FQBN.fullmatch(fqbn):
                known[fqbn] = {'name': item.get('name') or fqbn, 'fqbn': fqbn}
        return {'success': True, 'boards': list(known.values())}

    def search_boards(self, query=''):
        if not isinstance(query, str) or len(query) > 200 or query.strip().startswith('-'):
            raise ValueError('Enter a board name of at most 200 characters.')
        with self._lock:
            if self._active:
                raise RuntimeError('Wait for the active operation before searching boards.')
            data = self._json(['core', 'search'] + ([query.strip()] if query.strip() else []))
        platforms = []
        for item in data.get('platforms') or []:
            latest = item.get('latest_version', '')
            release = (item.get('releases') or {}).get(latest) or {}
            platforms.append({'id': item['id'], 'name': release.get('name') or item['id'],
                              'version': latest, 'installedVersion': item.get('installed_version') or '',
                              'boards': [board['name'] for board in release.get('boards', [])],
                              'deprecated': bool(release.get('deprecated'))})
        return {'success': True, 'platforms': platforms[:200], 'total': len(platforms)}

    def board_sources(self, urls=None):
        with self._lock:
            config = Path(self._config())
            data = json.loads(config.read_text(encoding='utf-8'))
            if urls is not None:
                if self._active:
                    raise RuntimeError('Wait for the active operation before changing board sources.')
                if not isinstance(urls, list) or len(urls) > 20:
                    raise ValueError('Provide at most 20 board package URLs.')
                for url in urls:
                    parsed = urlparse(url) if isinstance(url, str) else None
                    if not parsed or len(url) > 2048 or parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
                        raise ValueError('Board package URLs must be HTTPS URLs without credentials or fragments.')
                data.setdefault('board_manager', {})['additional_urls'] = list(dict.fromkeys(urls))
                temporary = config.with_suffix('.tmp')
                temporary.write_text(json.dumps(data), encoding='utf-8')
                os.replace(temporary, config)
            return {'success': True, 'urls': data.get('board_manager', {}).get('additional_urls') or []}

    def refresh_board_index(self):
        return self._new_job('board-index', None, lambda job: self._run(job, ['core', 'update-index']))

    def install_platform(self, platform, version=''):
        if not isinstance(platform, str) or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*', platform):
            raise ValueError('Choose a valid board package.')
        if not isinstance(version, str) or len(version) > 80 or version and not re.fullmatch(r'[0-9][A-Za-z0-9_.+-]*', version):
            raise ValueError('Choose a valid board package version.')
        target = platform + ('@' + version if version else '')
        def install(job):
            self._run(job, ['core', 'update-index'])
            self._run(job, ['core', 'install', target])
        return self._new_job('core', None, install)

    def libraries(self):
        payload = self._json(['lib', 'list'])
        libraries = []
        for item in payload.get('installed_libraries') or []:
            library = item.get('library') or {}
            libraries.append({'name': library['name'], 'version': library.get('version', ''),
                              'installedVersion': library.get('version', ''),
                              'description': library.get('sentence', ''),
                              'headers': library.get('provides_includes') or [],
                              'architectures': library.get('architectures') or [],
                              'versions': [library.get('version', '')]})
        return {'success': True, 'libraries': sorted(libraries, key=lambda item: item['name'].lower())}

    def search_libraries(self, query):
        if not isinstance(query, str) or not query.strip() or len(query) > 200 or query.strip().startswith('-'):
            raise ValueError('Enter a library name of at most 200 characters.')
        # CLI may refresh the library index while searching. Serialize it with
        # installs and compilations, whose package files must stay stable.
        with self._lock:
            if self._active:
                raise RuntimeError('Wait for the active operation before searching libraries.')
            payload = self._json(['lib', 'search', query.strip(), '--omit-releases-details'])
            installed = {item['name']: item for item in self.libraries()['libraries']}
        libraries = []
        for item in payload.get('libraries') or []:
            latest = item.get('latest') or {}
            local = installed.get(item['name'], {})
            libraries.append({'name': item['name'], 'version': latest.get('version', ''),
                              'installedVersion': local.get('version', ''),
                              'description': latest.get('sentence', ''),
                              'headers': local.get('headers', []),
                              'architectures': latest.get('architectures') or [],
                              'versions': item.get('available_versions') or [latest.get('version', '')]})
        return {'success': True, 'libraries': libraries[:100], 'total': len(libraries)}

    def refresh_library_index(self):
        return self._new_job('library-index', None, lambda job: self._run(job, ['lib', 'update-index']))

    def install_library(self, name, version=''):
        if not isinstance(name, str) or not re.fullmatch(r'[\w][\w .+-]{0,199}', name):
            raise ValueError('Choose a valid Arduino library name.')
        if not isinstance(version, str) or len(version) > 80 or version and not re.fullmatch(r'[0-9][A-Za-z0-9_.+-]*', version):
            raise ValueError('Choose a valid library version.')
        target = name + ('@' + version if version else '')
        return self._new_job('library', None, lambda job: self._run(job, ['lib', 'install', target]))

    def ports(self):
        data = self._json(['board', 'list'])
        ports = []
        entries = data.get('detected_ports') or data.get('ports') or []
        for item in entries:
            port = item.get('port') or item
            address = port.get('address')
            protocol = port.get('protocol') or 'serial'
            if address and protocol == 'serial':
                ports.append({'address': address, 'label': port.get('label') or address,
                              'boards': item.get('matching_boards') or []})
        return {'success': True, 'ports': ports}

    def _append(self, job, line):
        with self._lock:
            job['log'].append(str(line).rstrip()[:8000])

    def _terminate(self, process):
        if process is None or process.poll() is not None:
            return
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=5)
            else:
                os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            try:
                if os.name != 'nt':
                    os.killpg(process.pid, signal.SIGKILL)
                else:
                    process.kill()
            except OSError:
                pass

    def _run(self, job, args, timeout=600):
        if job['cancel'].is_set():
            raise RuntimeError('Operation cancelled.')
        command = self._args(args)
        self._append(job, 'arduino-cli ' + ' '.join(args))
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, encoding='utf-8', errors='replace', bufsize=1,
                                   start_new_session=os.name != 'nt')
        with self._lock:
            job['process'] = process
        def consume():
            for line in process.stdout:
                self._append(job, line)
        reader = threading.Thread(target=consume, daemon=True)
        reader.start()
        try:
            if job['cancel'].is_set():
                self._terminate(process)
            code = process.wait(timeout=timeout)
            reader.join(timeout=2)
            if job['cancel'].is_set():
                raise RuntimeError('Operation cancelled.')
            if code:
                raise RuntimeError('Arduino CLI failed. See the operation log for details.')
        except subprocess.TimeoutExpired as exc:
            self._terminate(process)
            raise RuntimeError('Arduino operation timed out.') from exc
        finally:
            if process.stdout:
                process.stdout.close()
            with self._lock:
                job['process'] = None

    def _new_job(self, kind, board, work, keep=()):
        if board is not None:
            validate_board(board)
        # Resolve before accepting a job, so missing tooling is an immediate error.
        self.cli()
        with self._lock:
            if self._active:
                raise RuntimeError('Another Arduino operation is running.')
            while len(self._jobs) >= 20:
                oldest = next(key for key in self._jobs if key not in keep)
                previous = self._jobs.pop(oldest)
                if previous.get('folder'):
                    shutil.rmtree(previous['folder'], ignore_errors=True)
            identifier = uuid.uuid4().hex
            job = {'id': identifier, 'kind': kind, 'board': board, 'done': False,
                   'success': False, 'error': '', 'log': deque(maxlen=1500),
                   'cancel': threading.Event(), 'process': None, 'folder': None}
            self._jobs[identifier] = job
            self._active = identifier
        def run():
            try:
                work(job)
                if job['cancel'].is_set():
                    raise RuntimeError('Operation cancelled.')
                with self._lock:
                    job['success'] = True
            except Exception as exc:
                with self._lock:
                    job['error'] = str(exc)
                self._append(job, str(exc))
            finally:
                with self._lock:
                    job['done'] = True
                    self._active = None
        threading.Thread(target=run, name='arduino-' + kind, daemon=True).start()
        return {'success': True, 'jobId': identifier}

    def compile(self, source, board):
        if not isinstance(source, str) or not source.strip() or '\0' in source or len(source.encode('utf-8')) > 1024 * 1024:
            raise ValueError('Sketch must contain at most 1 MB of source text.')
        validate_board(board)
        def build(job):
            builds = self.home / 'builds'
            builds.mkdir(parents=True, exist_ok=True)
            folder = Path(tempfile.mkdtemp(prefix='compile-', dir=builds))
            sketch = folder / 'StudioXSketch'
            sketch.mkdir()
            (sketch / 'StudioXSketch.ino').write_text(source, encoding='utf-8')
            output = folder / 'output'
            output.mkdir()
            with self._lock:
                job.update(folder=str(folder), sketch=str(sketch), output=str(output),
                           sourceHash=hashlib.sha256(source.encode('utf-8')).hexdigest())
            self._run(job, ['compile', '--fqbn', board, '--build-path', str(folder / 'build'), '--output-dir', str(output), str(sketch)], timeout=180)
        return self._new_job('compile', board, build)

    def upload(self, compile_id, port):
        if not isinstance(compile_id, str):
            raise ValueError('Compile this workspace successfully before uploading.')
        if not isinstance(port, str) or not port.strip() or port.startswith('-') or '\0' in port or len(port) > 250:
            raise ValueError('Choose a valid serial port before uploading.')
        with self._lock:
            compiled = self._jobs.get(compile_id)
            if not compiled or compiled['kind'] != 'compile' or not compiled['done'] or not compiled['success']:
                raise ValueError('Compile this workspace successfully before uploading.')
            board = compiled['board']
            output = compiled['output']
            sketch = compiled['sketch']
            if not Path(output).is_dir():
                raise ValueError('The compiled sketch has expired. Compile again.')
        def send(job):
            self._run(job, ['upload', '--fqbn', board, '--port', port.strip(), '--input-dir', output, sketch], timeout=120)
        return self._new_job('upload', board, send, keep=(compile_id,))

    def install_core(self, board):
        validate_board(board)
        return self.install_platform(':'.join(board.split(':')[:2]))

    def job(self, identifier):
        with self._lock:
            job = self._jobs.get(identifier)
            if not job:
                raise ValueError('Arduino operation not found.')
            return {'success': True, **{key: job[key] for key in
                    ['id', 'kind', 'board', 'done', 'error']}, 'ok': job['success'],
                    'sourceHash': job.get('sourceHash'), 'log': list(job['log'])}

    def cancel(self, identifier):
        with self._lock:
            job = self._jobs.get(identifier)
            if not job or job['done']:
                return {'success': True}
            job['cancel'].set()
            process = job['process']
        self._terminate(process)
        return {'success': True}
