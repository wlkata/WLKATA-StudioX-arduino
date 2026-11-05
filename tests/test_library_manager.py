import sys
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_backend


class LibraryManagerTests(unittest.TestCase):
    setUp=test_backend.BackendTests.setUp
    wait=test_backend.BackendTests.wait

    def test_search_and_installed_headers_follow_cli_schema(self):
        installed={'installed_libraries':[{'library':{'name':'Servo','version':'1.2.2','provides_includes':['Servo.h'],'architectures':['avr']}}]}
        search={'libraries':[{'name':'Servo','latest':{'version':'1.3.0','sentence':'Servo control','architectures':['avr']},'available_versions':['1.2.2','1.3.0']}]}
        with mock.patch.object(self.manager,'_json',side_effect=[search,installed]) as command:
            library=self.manager.search_libraries('Servo')['libraries'][0]
        self.assertEqual(library['version'],'1.3.0')
        self.assertEqual(library['installedVersion'],'1.2.2')
        self.assertEqual(library['headers'],['Servo.h'])
        self.assertEqual(library['versions'],['1.2.2','1.3.0'])
        self.assertEqual(command.call_args_list[0].args[0],['lib','search','Servo','--omit-releases-details'])

    def test_install_version_and_index_refresh(self):
        job=self.wait(self.manager.install_library('Adafruit GFX Library','1.11.9'))
        self.assertTrue(job['ok'],job)
        self.assertTrue(any('lib install Adafruit GFX Library@1.11.9' in line for line in job['log']))
        self.assertTrue(self.wait(self.manager.refresh_library_index())['ok'])
        for name in ['--bad','file:///tmp/x','Servo@1.0',None]:
            with self.assertRaises(ValueError):self.manager.install_library(name)
        for query in ['', ' --json',None]:
            with self.assertRaises(ValueError):self.manager.search_libraries(query)
        with self.assertRaises(ValueError):self.manager.install_library('Servo','--bad')

    def test_catalog_queries_wait_for_active_operations(self):
        self.manager._active='running'
        for call in [lambda:self.manager.search_libraries('Servo'),lambda:self.manager.search_boards('Pico')]:
            with self.assertRaisesRegex(RuntimeError,'active operation'):call()
        self.manager._active=None

    def test_library_api_returns_structured_results(self):
        from flask import Flask
        import main
        app=Flask('library-test');app.register_blueprint(main.blueprint)
        with mock.patch.object(main,'_manager',self.manager),app.test_client() as client:
            self.assertEqual(client.post('/libraries/search',json={'query':''}).status_code,400)
            response=client.post('/libraries/install',json={'name':'Servo','version':'1.3.0'}).get_json()
            self.assertTrue(self.wait(response)['ok'])
            self.assertFalse(client.post('/libraries/install',json={'name':'--bad'}).get_json()['success'])
