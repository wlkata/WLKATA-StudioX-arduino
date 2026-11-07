"""Local library snapshots are isolated from sources, installs, and other jobs."""
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_backend
from local_library import prepare_zip, validate_source
import local_library


class LocalLibraryTests(unittest.TestCase):
    setUp = test_backend.BackendTests.setUp
    wait = test_backend.BackendTests.wait

    def library(self):
        folder=self.root/'User source with spaces';(folder/'src').mkdir(parents=True)
        (folder/'library.properties').write_text('name=Local Test\nversion=1.0.0\narchitectures=*\n')
        (folder/'src/LocalTest.h').write_text('#pragma once\ninline int value() { return 42; }\n')
        (folder/'.git').mkdir();(folder/'.git/private').write_text('not installed')
        return folder

    def test_folder_snapshot_install_cleanup_and_environment(self):
        folder=self.library();original=(folder/'src/LocalTest.h').read_bytes()
        def install(job,args,**options):
            self.assertEqual(args[:3],['lib','install','--zip-path'])
            self.assertEqual(options['extra_env'],{'ARDUINO_LIBRARY_ENABLE_UNSAFE_INSTALL':'true'})
            with zipfile.ZipFile(args[3]) as archive:
                self.assertIn('Local_Test/src/LocalTest.h',archive.namelist())
                self.assertFalse(any('.git' in name for name in archive.namelist()))
                self.assertEqual(archive.read('Local_Test/src/LocalTest.h'),original)
        with mock.patch.object(self.manager,'_run',side_effect=install) as command:
            result=self.wait(self.manager.install_local_library(str(folder),'folder'))
        self.assertTrue(result['ok'],result);self.assertEqual(command.call_count,1)
        self.assertEqual((folder/'src/LocalTest.h').read_bytes(),original)
        self.assertEqual(list((self.manager.home/'imports').iterdir()),[])
        config=json.loads((self.manager.home/'arduino-cli.yaml').read_text()) if (self.manager.home/'arduino-cli.yaml').exists() else {}
        self.assertFalse(config.get('library',{}).get('enable_unsafe_install',False))

    def test_flat_zip_github_wrapper_and_legacy_headers(self):
        for wrapper in ['', 'Library-main/']:
            source=self.root/('flat.zip' if not wrapper else 'github.zip')
            with zipfile.ZipFile(source,'w') as archive:
                archive.writestr(wrapper+'Legacy.h','#pragma once\n')
            before=source.read_bytes()
            with tempfile.TemporaryDirectory(dir=self.root) as work:
                result=prepare_zip(source,'zip',work)
                with zipfile.ZipFile(result) as archive:self.assertTrue(any(name.endswith('/Legacy.h') for name in archive.namelist()))
            self.assertEqual(source.read_bytes(),before)

    def test_invalid_paths_and_non_library_are_rejected(self):
        for path,kind in [('relative','folder'),(None,'zip'),(str(self.root),'zip'),(str(self.root),'bad')]:
            with self.assertRaises(ValueError):validate_source(path,kind)
        source=self.root/'broken.zip';source.write_text('not a ZIP')
        for path,kind in [(source,'zip'),(self.root,'folder')]:
            with tempfile.TemporaryDirectory(dir=self.root) as work:
                with self.assertRaises(ValueError):prepare_zip(path,kind,work)

    def test_zip_paths_symlinks_duplicates_and_limits(self):
        for name in ['../escape.h','/absolute.h','C:/escape.h','Library/../../escape.h']:
            source=self.root/'bad.zip'
            with zipfile.ZipFile(source,'w') as archive:archive.writestr(name,'bad')
            with tempfile.TemporaryDirectory(dir=self.root) as work:
                with self.assertRaisesRegex(ValueError,'unsafe path'):prepare_zip(source,'zip',work)
        source=self.root/'link.zip'
        with zipfile.ZipFile(source,'w') as archive:
            member=zipfile.ZipInfo('Library/link');member.create_system=3;member.external_attr=(stat.S_IFLNK|0o777)<<16;archive.writestr(member,'/etc/passwd')
        with tempfile.TemporaryDirectory(dir=self.root) as work:
            with self.assertRaisesRegex(ValueError,'symbolic links'):prepare_zip(source,'zip',work)
        source=self.root/'large.zip'
        with zipfile.ZipFile(source,'w') as archive:archive.writestr('Lib.h','x'*30)
        with tempfile.TemporaryDirectory(dir=self.root) as work, mock.patch.object(local_library,'MAX_BYTES',10):
            with self.assertRaisesRegex(ValueError,'exceeds'):prepare_zip(source,'zip',work)
        with zipfile.ZipFile(source,'w') as archive:
            archive.writestr('Lib.h','one');archive.writestr('lib.h','two')
        with tempfile.TemporaryDirectory(dir=self.root) as work:
            with self.assertRaisesRegex(ValueError,'duplicate'):prepare_zip(source,'zip',work)

    def test_failed_cli_cancel_and_job_lock_preserve_source(self):
        folder=self.library()
        with mock.patch.object(self.manager,'_run',side_effect=RuntimeError('CLI failed')):
            result=self.wait(self.manager.install_local_library(str(folder),'folder'))
        self.assertFalse(result['ok']);self.assertEqual(list((self.manager.home/'imports').iterdir()),[])
        self.manager._active='other-job'
        with self.assertRaisesRegex(RuntimeError,'Another Arduino operation'):self.manager.install_local_library(str(folder),'folder')
        self.manager._active=None
        with tempfile.TemporaryDirectory(dir=self.root) as work:
            def cancelled():raise RuntimeError('Operation cancelled.')
            with self.assertRaisesRegex(RuntimeError,'cancelled'):prepare_zip(folder,'folder',work,cancelled)
        self.assertTrue((folder/'src/LocalTest.h').is_file())

    def test_http_local_install(self):
        from flask import Flask
        import main
        app=Flask('local-library-test');app.register_blueprint(main.blueprint)
        with mock.patch.object(main,'_manager',self.manager),app.test_client() as client:
            invalid=client.post('/libraries/install-local',json={'path':'relative','kind':'folder'})
            self.assertEqual(invalid.status_code,400)
            result=client.post('/libraries/install-local',json={'path':str(self.library()),'kind':'folder'}).get_json()
            self.assertTrue(self.wait(result)['ok'])
