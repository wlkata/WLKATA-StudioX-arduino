"""Create an immutable, bounded Arduino library ZIP from a selected local source."""
from pathlib import Path, PurePosixPath
import re
import os
import stat
import zipfile

MAX_BYTES = 200 * 1024 * 1024
MAX_FILES = 10000
IGNORED = {'.git', '.svn', '__pycache__', '__MACOSX', '.DS_Store'}


def validate_source(source, kind):
    if kind not in ('folder', 'zip'):
        raise ValueError('Choose a library folder or ZIP file.')
    if not isinstance(source, str) or not source or '\0' in source or not Path(source).is_absolute():
        raise ValueError('Choose an absolute path using the library file picker.')
    source = Path(source).resolve()
    if kind == 'folder' and not source.is_dir():
        raise ValueError('The selected library folder does not exist.')
    if kind == 'zip' and (not source.is_file() or source.suffix.lower() != '.zip'):
        raise ValueError('Choose an existing .zip library file.')
    if kind == 'zip' and source.stat().st_size > MAX_BYTES:
        raise ValueError('The library ZIP exceeds 200 MB.')
    return source


def prepare_zip(source, kind, work, check_cancel=lambda: None):
    """Never extract paths outside work, follow symlinks, or alter source files."""
    if kind == 'folder' and Path(work).resolve().is_relative_to(source.resolve()):
        raise ValueError('Select the library folder itself, outside the toolchain import directory.')
    snapshot = Path(work) / 'snapshot'
    snapshot.mkdir()
    total = count = 0

    def copy(stream, target):
        nonlocal total, count
        count += 1
        if count > MAX_FILES:
            raise ValueError('The library contains more than 10000 files.')
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as output:
            while True:
                check_cancel()
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError('The unpacked library exceeds 200 MB.')
                output.write(chunk)

    def ignored(parts):
        return any(part in IGNORED or part.startswith('._') for part in parts)

    if kind == 'folder':
        for directory, children, files in os.walk(source, followlinks=False):
            check_cancel()
            children[:] = [name for name in children if not ignored([name])]
            for name in children + files:
                file = Path(directory) / name
                relative = file.relative_to(source)
                if ignored(relative.parts):
                    continue
                if file.is_symlink():
                    raise ValueError('Library folders must not contain symbolic links: ' + str(relative))
                if file.is_file():
                    with file.open('rb') as stream:
                        copy(stream, snapshot / relative)
    else:
        try:
            with zipfile.ZipFile(source) as archive:
                if len(archive.infolist()) > MAX_FILES:
                    raise ValueError('The library ZIP contains more than 10000 entries.')
                seen = set()
                for member in archive.infolist():
                    check_cancel()
                    name = member.filename.replace('\\', '/')
                    parts = name.rstrip('/').split('/')
                    if name.startswith('/') or any(part in ('', '.', '..') or ':' in part for part in parts):
                        raise ValueError('Library ZIP contains an unsafe path: ' + name)
                    if stat.S_ISLNK(member.external_attr >> 16):
                        raise ValueError('Library ZIP must not contain symbolic links.')
                    if ignored(parts) or member.is_dir():
                        continue
                    key = '/'.join(parts).casefold()
                    if key in seen:
                        raise ValueError('Library ZIP contains duplicate file paths.')
                    seen.add(key)
                    if member.file_size + total > MAX_BYTES:
                        raise ValueError('The unpacked library exceeds 200 MB.')
                    with archive.open(member) as stream:
                        copy(stream, snapshot.joinpath(*PurePosixPath(name).parts))
        except (zipfile.BadZipFile, RuntimeError) as error:
            if isinstance(error, RuntimeError) and str(error) == 'Operation cancelled.':
                raise
            raise ValueError('Could not read library ZIP: ' + str(error)) from error

    def has_headers(folder):
        return any(file.is_file() and file.suffix.lower() in ('.h', '.hpp')
                   for base in (folder, folder / 'src') if base.is_dir() for file in base.iterdir())

    library = snapshot
    # Accept flat ZIPs and the single wrapper folder used by GitHub downloads.
    for _ in range(4):
        if (library / 'library.properties').is_file() or has_headers(library):
            break
        children = [entry for entry in library.iterdir() if entry.is_dir()]
        if len(children) != 1:
            raise ValueError('Select one Arduino library containing library.properties or public header files.')
        library = children[0]
    else:
        raise ValueError('Could not find an Arduino library in the selected source.')
    if not has_headers(library):
        raise ValueError('The selected library has no public .h or .hpp files in its root or src folder.')

    # Stable root name for flat archives and legacy libraries without metadata.
    folder_name = source.stem if kind == 'zip' else source.name
    properties = library / 'library.properties'
    if properties.is_file():
        if properties.stat().st_size > 1024 * 1024:
            raise ValueError('library.properties is too large.')
        for line in properties.read_text(encoding='utf-8-sig').splitlines():
            key, separator, value = line.partition('=')
            if separator and key.strip() == 'name' and value.strip():
                folder_name = value.strip()
                break
    folder_name = re.sub(r'[^A-Za-z0-9_.-]', '_', folder_name).strip('._-')[:63] or 'LocalLibrary'
    if not folder_name[0].isalnum():
        folder_name = 'Local_' + folder_name
    archive_path = Path(work) / 'library.zip'
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(library.rglob('*')):
            check_cancel()
            if file.is_file():
                archive.write(file, folder_name + '/' + file.relative_to(library).as_posix())
    return archive_path
