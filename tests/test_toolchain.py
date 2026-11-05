"""Managed CLI setup uses mocked downloads; never installs system software."""
import hashlib
import io
import importlib.util
from types import SimpleNamespace
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest import mock
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import toolchain
from arduino_manager import ArduinoManager


class ToolchainTests(unittest.TestCase):
    def test_platform_mapping(self):
        for system, cpu, expected in [('Darwin','arm64','macOS_ARM64.tar.gz'),('Darwin','x86_64','macOS_64bit.tar.gz'),('Windows','AMD64','Windows_64bit.zip'),('Linux','aarch64','Linux_ARM64.tar.gz'),('Linux','armv7l','Linux_ARMv7.tar.gz')]:
            self.assertTrue(toolchain.platform_asset(system,cpu).endswith(expected))
        with self.assertRaises(RuntimeError): toolchain.platform_asset('UnknownOS','x86_64')

    def archive(self, target, binary=b'fake executable'):
        with tarfile.open(target, 'w:gz') as bundle:
            member=tarfile.TarInfo('arduino-cli');member.size=len(binary);bundle.addfile(member,io.BytesIO(binary))
            license=tarfile.TarInfo('LICENSE.txt');license.size=7;bundle.addfile(license,io.BytesIO(b'license'))
            malicious=tarfile.TarInfo('../escape');malicious.size=4;bundle.addfile(malicious,io.BytesIO(b'evil'))

    def test_download_verify_reuse_repair_and_manager_lookup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);archive=root/'test.tar.gz';self.archive(archive)
            asset='arduino-cli_1.5.1_Linux_64bit.tar.gz'
            def download(url,target,log): Path(target).write_bytes(archive.read_bytes())
            with mock.patch.object(toolchain,'platform_asset',return_value=asset), mock.patch.object(toolchain,'download',side_effect=download) as get, mock.patch.dict(toolchain.CHECKSUMS,{asset:toolchain.digest(archive)}), mock.patch.object(toolchain.subprocess,'run',return_value=mock.Mock(returncode=0,stdout=json.dumps({'VersionString':toolchain.VERSION}))):
                home=root/'toolchain'
                executable=Path(toolchain.install_cli(home,lambda _:None))
                self.assertTrue(executable.is_file());self.assertTrue(executable.stat().st_mode & 0o111)
                self.assertTrue((executable.parent/'LICENSE.txt').is_file())
                self.assertFalse((home/'escape').exists())
                toolchain.install_cli(home,lambda _:None);self.assertEqual(get.call_count,1)
                with mock.patch.dict(os.environ,{},clear=True): self.assertEqual(ArduinoManager(home).cli(),str(executable))
                executable.write_bytes(b'corrupt')
                self.assertIsNone(toolchain.installed_cli(home))
                toolchain.install_cli(home,lambda _:None);self.assertEqual(get.call_count,2)
                self.assertEqual(executable.read_bytes(),b'fake executable')

    def test_checksum_failure_preserves_existing_tools_and_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'keep').write_text('existing board packages')
            asset=toolchain.platform_asset()
            with mock.patch.object(toolchain,'download',side_effect=lambda url,target,log:Path(target).write_bytes(b'bad archive')):
                with self.assertRaisesRegex(RuntimeError,'checksum'): toolchain.install_cli(root,lambda _:None)
            self.assertEqual((root/'keep').read_text(),'existing board packages')
            self.assertFalse((root/'cli-install.json').exists())
            self.assertEqual([p.name for p in root.iterdir()],['keep'])

    def test_windows_zip_reads_only_expected_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);archive=root/'cli.zip';dest=root/'bin';dest.mkdir()
            with zipfile.ZipFile(archive,'w') as bundle:
                bundle.writestr('arduino-cli.exe',b'binary');bundle.writestr('../escape',b'evil')
            self.assertEqual(toolchain.unpack(archive,'Windows.zip',dest).read_bytes(),b'binary')
            self.assertFalse((root/'escape').exists())

    def test_setup_migrates_legacy_data_and_rewrites_configuration(self):
        spec=importlib.util.spec_from_file_location('arduino_setup',Path(__file__).resolve().parents[1]/'backend/setup.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary, mock.patch('pathlib.Path.home',return_value=Path(temporary)), mock.patch.object(module,'install_cli') as install:
            root=Path(temporary);legacy=root/'.wlkata-studiox/arduino';legacy.mkdir(parents=True)
            (legacy/'board-package').write_text('preserve')
            (legacy/'arduino-cli.yaml').write_text(json.dumps({'directories':{'data':str(legacy/'data')},'board_manager':{'additional_urls':['https://example.com/index.json']}}))
            data=root/'.wlkata-studiox/extensions/arduino/.data';data.mkdir(parents=True)
            ctx=SimpleNamespace(data_dir=data,log=lambda _:None)
            module.on_setup(ctx)
            self.assertFalse(legacy.exists())
            self.assertEqual((data/'toolchain/board-package').read_text(),'preserve')
            config=json.loads((data/'toolchain/arduino-cli.yaml').read_text())
            self.assertEqual(config['directories']['data'],str(data/'toolchain/data'))
            self.assertEqual(config['board_manager']['additional_urls'],['https://example.com/index.json'])
            module.on_setup(ctx)
            self.assertEqual(install.call_count,2)

    def test_storage_belongs_to_extension_and_cache_is_local(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.dict(os.environ,{'STUDIOX_EXTENSION_DATA_DIR':temporary},clear=True):
            manager=ArduinoManager()
            self.assertEqual(manager.home,Path(temporary)/'toolchain')
            config=json.loads(Path(manager._config()).read_text())
            self.assertEqual(config['build_cache']['path'],str(manager.home/'cache'))
            self.assertTrue(all(str(manager.home) in path for path in config['directories'].values()))


if __name__=='__main__':unittest.main()
