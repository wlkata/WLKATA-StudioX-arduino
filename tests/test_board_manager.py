import json
import sys
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_backend


class BoardManagerTests(unittest.TestCase):
    setUp = test_backend.BackendTests.setUp
    wait = test_backend.BackendTests.wait
    def test_search_returns_uninstalled_boards_and_latest_package(self):
        payload={'platforms':[{'id':'arduino:mbed_rp2040','latest_version':'4.3.1','installed_version':'','releases':{'4.3.1':{'name':'Arduino Mbed RP2040','boards':[{'name':'Raspberry Pi Pico'}]}}}]}
        with mock.patch.object(self.manager,'_json',return_value=payload) as command:
            result=self.manager.search_boards('pico')
        self.assertEqual(command.call_args.args[0],['core','search','pico'])
        self.assertEqual(result['platforms'][0]['boards'],['Raspberry Pi Pico'])
        self.assertEqual(result['platforms'][0]['installedVersion'],'')
        self.assertEqual(result['platforms'][0]['version'],'4.3.1')
        with self.assertRaises(ValueError):self.manager.search_boards('--bad')

    def test_sources_preserve_storage_settings_and_reject_invalid_urls(self):
        url='https://example.com/package_index.json'
        self.assertEqual(self.manager.board_sources([url,url])['urls'],[url])
        self.assertEqual(self.manager.board_sources()['urls'],[url])
        config=json.loads((self.manager.home/'arduino-cli.yaml').read_text())
        self.assertEqual(config['directories']['data'],str(self.manager.home/'data'))
        for urls in ['url',['file:///tmp/board'],['https://user:pass@example.com/index'],[None]]:
            with self.assertRaises(ValueError):self.manager.board_sources(urls)
        self.assertEqual(self.manager.board_sources()['urls'],[url])

    def test_install_uninstalled_package_uses_selected_version(self):
        result=self.wait(self.manager.install_platform('arduino:mbed_rp2040','4.3.1'))
        self.assertTrue(result['ok'],result)
        self.assertTrue(any('core install arduino:mbed_rp2040@4.3.1' in line for line in result['log']))
        self.assertTrue(self.wait(self.manager.refresh_board_index())['ok'])
        for platform in ['--bad','arduino:avr:uno',None]:
            with self.assertRaises(ValueError):self.manager.install_platform(platform)
        with self.assertRaises(ValueError):self.manager.install_platform('arduino:avr','--bad')
