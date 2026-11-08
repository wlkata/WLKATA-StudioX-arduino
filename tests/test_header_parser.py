import sys
from pathlib import Path
import tempfile
import unittest
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from header_parser import parse_header, value_kind
from arduino_manager import ArduinoManager

HEADER = '''
#pragma once
#define MODE_READY 3
namespace devices {
class Meter {
public:
  Meter(int pin = 2);
  void write(int value);
  void write(int value, bool wait);
  int read() const;
  static bool available();
  const char *name();
  void buffer(int &out, const char *label);
private:
  void secret();
  class Hidden { public: void hiddenMethod(); };
};
extern Meter meter;
int sample(int pin = 0);
template<class T> T convert(T value);
enum class Mode { OFF, ON };
}
'''


class HeaderParserTests(unittest.TestCase):
    def test_declared_cpp_return_types_and_arduino_aliases(self):
        result = parse_header('''class ColorSensor { public:
          int8_t begin(void);
          boolean ready(void);
          void enable(boolean enabled);
          const uint16_t count();
          int8_t *buffer();
        };''', 'ColorSensor.h', 'ColorSensor')
        methods = {item['name']: item for item in result['functions']}
        self.assertEqual(methods['begin']['returnType'], 'int8_t')
        self.assertEqual(methods['begin']['returnKind'], 'number')
        self.assertEqual(methods['ready']['returnKind'], 'boolean')
        self.assertEqual(methods['enable']['parameters'][0]['kind'], 'boolean')
        self.assertEqual(methods['count']['returnKind'], 'number')
        self.assertEqual(methods['buffer']['returnKind'], 'cpp')
        for cpp_type in ['int8_t', 'uint8_t', 'int64_t', 'unsigned', 'std::uint16_t', 'const size_t']:
            with self.subTest(cpp_type=cpp_type):
                self.assertEqual(value_kind(cpp_type), 'number')

    def test_public_methods_overloads_namespaces_parameters_and_instances(self):
        result=parse_header(HEADER,'Meter.h','Devices')
        self.assertFalse(result['parseErrors'])
        functions=result['functions']
        self.assertEqual(len([item for item in functions if item['name']=='write']),2)
        self.assertFalse(any(item['name'] in ('secret','Hidden','hiddenMethod') for item in functions))
        constructor=next(item for item in functions if item['constructor'])
        self.assertEqual(constructor['owner'],'devices::Meter')
        self.assertEqual(constructor['parameters'][0]['default'],'2')
        self.assertTrue(constructor['parameters'][0]['optional'])
        read=next(item for item in functions if item['name']=='read')
        self.assertEqual(read['returnKind'],'number')
        self.assertEqual(read['instances'][0]['qualifiedName'],'devices::meter')
        self.assertTrue(next(item for item in functions if item['name']=='available')['static'])
        self.assertEqual(next(item for item in functions if item['name']=='name')['returnKind'],'text')
        buffer=next(item for item in functions if item['name']=='buffer')
        self.assertEqual([item['kind'] for item in buffer['parameters']],['cpp','text'])
        template=next(item for item in functions if item['name']=='convert')
        self.assertFalse(template['supported']);self.assertIn('templates',template['reason'])
        self.assertIn('devices::Mode::ON',[item['qualifiedName'] for item in result['constants']])
        self.assertIn('MODE_READY',[item['qualifiedName'] for item in result['constants']])

    def test_implicit_constructor_private_constructor_and_conditionals(self):
        result=parse_header('class Utility { Utility(); public: static int read(); }; struct Data { int value(); }; #if BOARD\nint special();\n#endif','Test.h','Test')
        self.assertFalse(any(item['constructor'] and item['owner']=='Utility' for item in result['functions']))
        self.assertTrue(any(item['constructor'] and item['owner']=='Data' for item in result['functions']))
        separate=parse_header('#if BOARD_A\nint boardOnly();\n#endif','Conditional.h','Test')
        self.assertTrue(separate['functions'][0]['conditions'])

    def test_catalog_reads_real_headers_and_keeps_working_without_board_core(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);source=folder/'src';source.mkdir();(source/'Meter.h').write_text(HEADER)
            manager=ArduinoManager(folder/'tools')
            payload={'installed_libraries':[{'library':{'name':'Devices','version':'1.0','install_dir':str(folder),'source_dir':str(source),'provides_includes':['Meter.h']}}]}
            with mock.patch.object(manager,'_json',return_value=payload):
                catalog=manager.library_catalog('arduino:avr:uno')
                again=manager.library_catalog('arduino:avr:uno')
            self.assertEqual(catalog,again)
            self.assertTrue(catalog['libraries'][0]['headers'][0]['functions'])
            self.assertEqual(len(manager._header_cache),1)
            with mock.patch.object(manager,'_json',side_effect=[RuntimeError('Core not installed'),payload]):
                fallback=manager.library_catalog('arduino:avr:uno')
            self.assertEqual(fallback['warnings'],['Core not installed'])
            self.assertTrue(fallback['libraries'])
            manager._active='compile'
            with self.assertRaisesRegex(RuntimeError,'active operation'):manager.library_catalog()


if __name__=='__main__':unittest.main()
