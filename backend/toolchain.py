"""Pinned Arduino CLI downloads; all installation files belong to the extension."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

VERSION = '1.5.1'
CHECKSUMS = json.loads(Path(__file__).with_name('cli_checksums.json').read_text(encoding='utf-8'))


def platform_asset(system=None, machine=None):
    system = system or platform.system()
    machine = (machine or platform.machine()).lower()
    if machine in ('x86_64', 'amd64'): arch = '64bit'
    elif machine in ('arm64', 'aarch64'): arch = 'ARM64'
    elif machine in ('i386', 'i686', 'x86'): arch = '32bit'
    elif machine.startswith('armv7'): arch = 'ARMv7'
    elif machine.startswith('armv6'): arch = 'ARMv6'
    else: raise RuntimeError('Arduino CLI does not support this CPU: ' + machine)
    label = {'Darwin': 'macOS', 'Linux': 'Linux', 'Windows': 'Windows'}.get(system)
    extension = 'zip' if system == 'Windows' else 'tar.gz'
    filename = f'arduino-cli_{VERSION}_{label}_{arch}.{extension}'
    if filename not in CHECKSUMS:
        raise RuntimeError(f'No managed Arduino CLI for {system} {machine}. Configure an existing executable manually.')
    return filename


def digest(file):
    checksum = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): checksum.update(chunk)
    return checksum.hexdigest()


def installed_cli(home):
    home = Path(home)
    try:
        record = json.loads((home / 'cli-install.json').read_text(encoding='utf-8'))
        asset = platform_asset()
        filename = 'arduino-cli.exe' if platform.system() == 'Windows' else 'arduino-cli'
        executable = home / 'bin' / VERSION / asset.removeprefix(f'arduino-cli_{VERSION}_').replace('.tar.gz', '').replace('.zip', '') / filename
        if record['version'] == VERSION and record['asset'] == asset and executable.is_file() and digest(executable) == record['binarySha256']:
            return str(executable)
    except (OSError, ValueError, KeyError, RuntimeError):
        pass
    return None


def download(url, target, log):
    request = urllib.request.Request(url, headers={'User-Agent': 'WLKATA-StudioX-Arduino'})
    total = 0
    with urllib.request.urlopen(request, timeout=45) as response, Path(target).open('wb') as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk: break
            total += len(chunk)
            if total > 256 * 1024 * 1024: raise RuntimeError('Arduino CLI download exceeds the size limit.')
            output.write(chunk)
            if total // (5 * 1024 * 1024) != (total - len(chunk)) // (5 * 1024 * 1024):
                log(f'Downloaded {total // (1024 * 1024)} MB…')


def unpack(archive, asset, destination):
    """Read only the executable and license; never extract archive paths."""
    executable = 'arduino-cli.exe' if asset.endswith('.zip') else 'arduino-cli'
    names = {executable, 'LICENSE.txt', 'LICENSE'}
    found = False
    if asset.endswith('.zip'):
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                if member.filename not in names or member.is_dir(): continue
                if member.file_size > 256 * 1024 * 1024: raise RuntimeError('CLI file exceeds the size limit.')
                with bundle.open(member) as stream, (destination / member.filename).open('wb') as output:
                    shutil.copyfileobj(stream, output)
                found = found or member.filename == executable
    else:
        with tarfile.open(archive, 'r:gz') as bundle:
            for member in bundle:
                if member.name not in names or not member.isfile(): continue
                if member.size > 256 * 1024 * 1024: raise RuntimeError('CLI file exceeds the size limit.')
                with bundle.extractfile(member) as stream, (destination / member.name).open('wb') as output:
                    shutil.copyfileobj(stream, output)
                found = found or member.name == executable
    if not found: raise RuntimeError('The Arduino CLI archive contains no executable.')
    file = destination / executable
    file.chmod(0o755)
    return file


def install_cli(home, log=print):
    home = Path(home)
    existing = installed_cli(home)
    if existing:
        log(f'Arduino CLI {VERSION} is already installed.')
        return existing
    asset = platform_asset()
    home.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='cli-setup-', dir=home) as temporary:
        temporary = Path(temporary)
        archive = temporary / asset
        log(f'Downloading Arduino CLI {VERSION} ({asset})…')
        download(f'https://github.com/arduino/arduino-cli/releases/download/v{VERSION}/{asset}', archive, log)
        if digest(archive) != CHECKSUMS[asset]:
            raise RuntimeError('Arduino CLI checksum verification failed. Run Re-setup to retry.')
        staging = temporary / 'bin'
        staging.mkdir()
        executable = unpack(archive, asset, staging)
        result = subprocess.run([str(executable), 'version', '--format', 'json'], capture_output=True, text=True, timeout=15)
        if result.returncode or json.loads(result.stdout).get('VersionString') != VERSION:
            raise RuntimeError('The downloaded Arduino CLI could not be verified.')
        target = home / 'bin' / VERSION / asset.removeprefix(f'arduino-cli_{VERSION}_').replace('.tar.gz', '').replace('.zip', '')
        target.mkdir(parents=True, exist_ok=True)
        for file in staging.iterdir(): os.replace(file, target / file.name)
        executable = target / executable.name
        record = {'version': VERSION, 'asset': asset, 'binarySha256': digest(executable)}
        marker = temporary / 'cli-install.json'
        marker.write_text(json.dumps(record), encoding='utf-8')
        os.replace(marker, home / 'cli-install.json')
    log(f'Arduino CLI {VERSION} installed. Choose a board and install its board support from the Arduino tab.')
    return str(executable)
