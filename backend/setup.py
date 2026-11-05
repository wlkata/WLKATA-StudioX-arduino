"""Install native tools during extension setup, before backend activation."""
import json
from pathlib import Path
import shutil
from toolchain import install_cli


def on_setup(ctx):
    home = ctx.data_dir / 'toolchain'
    # Move data produced by development builds that used a top-level directory.
    expected = Path.home() / '.wlkata-studiox' / 'extensions' / 'arduino' / '.data'
    legacy = Path.home() / '.wlkata-studiox' / 'arduino'
    if ctx.data_dir.resolve() == expected.resolve() and legacy.is_dir() and not legacy.is_symlink() and not home.exists():
        ctx.log('Moving existing Arduino tools into extension storage…')
        shutil.move(str(legacy), str(home))
        config = home / 'arduino-cli.yaml'
        if config.is_file():
            try:
                value = json.loads(config.read_text(encoding='utf-8'))
            except ValueError:
                # Keep an edited YAML configuration as a backup.
                config.rename(home / 'arduino-cli.legacy.yaml')
            else:
                value['directories'] = {key: str(home / folder) for key, folder in
                                        [('data', 'data'), ('downloads', 'downloads'), ('user', 'sketchbook')]}
                value['build_cache'] = {'path': str(home / 'cache')}
                config.write_text(json.dumps(value), encoding='utf-8')
    install_cli(home, ctx.log)
