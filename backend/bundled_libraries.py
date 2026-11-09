"""Read-only Arduino library copies shipped with this extension."""
from pathlib import Path

LIBRARY_ROOT = Path(__file__).resolve().parents[1] / 'libraries'


def libraries():
    result = []
    for folder in sorted(LIBRARY_ROOT.iterdir()):
        if not folder.is_dir():
            continue
        properties = folder / 'library.properties'
        metadata = {}
        if properties.is_file():
            for line in properties.read_text(encoding='utf-8').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    key, value = line.split('=', 1)
                    metadata[key.strip()] = value.strip()
        # PinChangeInt predates the library.properties convention.
        if folder.name == 'PinChangeInt':
            metadata.update(name='PinChangeInt', version='2.19-beta', architectures='avr',
                            sentence='Pin-change interrupts for supported AVR boards.')
        if folder.name == 'SimpleTimer':
            metadata.update(name='SimpleTimer',version='unversioned',architectures='*',
                            sentence='Cooperative software timers from the BlockFactory distribution.')
        if folder.name == 'SCoop':
            metadata.update(name='SCoop',version='1.2',architectures='avr',
                            sentence='Cooperative tasks from the BlockFactory distribution.')
        source = folder / 'src' if (folder / 'src').is_dir() else folder
        headers = metadata.get('includes', '').split(',') if metadata.get('includes') else [path.name for path in sorted(source.glob('*.h'))]
        result.append({'name': metadata.get('name', folder.name), 'version': metadata.get('version', ''),
                       'sentence': metadata.get('sentence', ''),
                       'architectures': metadata.get('architectures', '*').split(','),
                       'provides_includes': [name.strip() for name in headers],
                       'install_dir': str(folder), 'source_dir': str(source), 'bundled': True})
    return result


def combine(installed):
    """Use the shipped copies consistently in the browser and compiler."""
    bundled = libraries()
    names = {item['name'] for item in bundled}
    return bundled + [item['library'] for item in installed
                      if item.get('library', {}).get('name') not in names]
