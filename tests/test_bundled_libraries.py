"""Shipped library sources work without installing copies into user storage."""
import sys
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_backend
import bundled_libraries


class BundledLibraryTests(unittest.TestCase):
    setUp=test_backend.BackendTests.setUp
    wait=test_backend.BackendTests.wait

    def test_copies_keep_versions_sources_and_licenses(self):
        libraries={item['name']:item for item in bundled_libraries.libraries()}
        self.assertEqual({name:item['version'] for name,item in libraries.items()},
                         {'OneButton':'2.0.1','SoftPWM':'1.0.1','PinChangeInt':'2.19-beta','MsTimer2':'1.1','SimpleTimer':'unversioned','SCoop':'1.2'})
        for name,license in [('OneButton','LICENSE'),('SoftPWM','LICENSE.txt'),('PinChangeInt','gpl.txt'),('MsTimer2','MsTimer2.cpp'),('SimpleTimer','SimpleTimer.h'),('SCoop','COPYING')]:
            folder=Path(libraries[name]['install_dir'])
            self.assertTrue((folder/license).is_file())
            self.assertTrue((Path(libraries[name]['source_dir'])/(name+'.h')).is_file())

    def test_catalog_and_installed_list_use_shipped_versions(self):
        payload={'installed_libraries':[{'library':{'name':'OneButton','version':'99.0.0'}},
                                        {'library':{'name':'Custom','version':'1.0','provides_includes':['Custom.h']}}]}
        with mock.patch.object(self.manager,'_json',return_value=payload):
            installed=self.manager.libraries()['libraries']
            catalog=self.manager.library_catalog('arduino:avr:uno')['libraries']
        button=next(item for item in installed if item['name']=='OneButton')
        self.assertEqual(button['version'],'2.0.1')
        self.assertTrue(button['bundled'])
        self.assertEqual(len([item for item in installed if item['name']=='OneButton']),1)
        self.assertTrue(any(item['name']=='Custom' for item in installed))
        for name in ['OneButton','SoftPWM','PinChangeInt']:
            library=next(item for item in catalog if item['name']==name)
            self.assertTrue(library['headers'],name)

    def test_compile_uses_bundled_directory_without_copying_to_sketchbook(self):
        result=self.wait(self.manager.compile('void setup() {}\nvoid loop() {}','arduino:avr:uno'))
        self.assertTrue(result['ok'],result)
        command='\n'.join(result['log'])
        self.assertIn('--libraries '+str(bundled_libraries.LIBRARY_ROOT),command)
        for library in bundled_libraries.libraries():
            self.assertIn('--library '+library['install_dir'],command)
        self.assertFalse((self.manager.home/'sketchbook'/'libraries'/'OneButton').exists())

    def test_search_marks_bundled_libraries_as_included(self):
        with mock.patch.object(self.manager,'_json',side_effect=[{'libraries':[{'name':'OneButton','latest':{'version':'99.0.0'}}]},{}]):
            item=self.manager.search_libraries('OneButton')['libraries'][0]
        self.assertTrue(item['bundled'])
        self.assertEqual(item['installedVersion'],'2.0.1')
