/* Reuse general categories; Arduino owns its target-specific block organization. */
(function (root) {
  function build(source) {
    const toolbox = JSON.parse(JSON.stringify(source));
    const number = value => ({ shadow: { type: 'math_number', fields: { NUM: value } } });
    const pin = value => ({ shadow: { type: 'arduino_pin', fields: { PIN: value } } });
    const block = (type, inputs = {}, fields = {}) => ({ kind: 'block', type, inputs, fields });
    const group = (name, contents) => ({ kind: 'category', name, colour: '#00979D', contents });
    const pythonBlocks = new Set(['import_module', 'raw', 'python_with', 'function_call',
      'instance_function_call', 'library_function_call', 'library_constant']);
    function filter(items) {
      return (items || []).flatMap(item => {
        if (item.name === 'Python' || pythonBlocks.has(item.type)) return [];
        if (item.contents) {
          const contents = filter(item.contents);
          if (item.contents.length && !contents.length && !item.custom) return [];
          return [{ ...item, contents }];
        }
        return [item];
      });
    }
    toolbox.contents = filter(toolbox.contents).filter(item => item.name !== 'Arduino');
    toolbox.contents.push(group('Arduino', [
      group('Program', [block('arduino_setup'), block('arduino_loop')]),
      group('I/O', [
        block('arduino_pin'), block('arduino_builtin_led'), block('arduino_high_low'),
        block('arduino_pin_mode', { PIN: pin('13') }, { MODE: 'OUTPUT' }),
        block('arduino_digital_write', { PIN: pin('13') }, { LEVEL: 'HIGH' }),
        block('arduino_digital_write_value', { PIN: pin('13'), STATE: { shadow: { type: 'arduino_high_low', fields: { LEVEL: 'HIGH' } } } }),
        block('arduino_digital_read', { PIN: pin('2') }),
        block('arduino_analog_read', { PIN: pin('A0') }),
        block('arduino_analog_write', { PIN: pin('9'), VALUE: number(128) }),
        block('arduino_tone', { PIN: pin('8'), FREQUENCY: number(440), DURATION: number(1000) }),
        block('arduino_no_tone', { PIN: pin('8') }),
      ]),
      group('Libraries / C++', [block('arduino_include'), block('arduino_cpp_declaration'), block('arduino_cpp_statement'), block('arduino_cpp_expression')]),
      group('Timing', [block('arduino_delay', { MS: number(1000) }), block('arduino_millis')]),
      group('Serial', [block('arduino_serial_begin'), block('arduino_serial_print', { VALUE: { shadow: { type: 'text', fields: { TEXT: 'Hello' } } } })]),
    ]));
    return toolbox;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { build };
  root.StudioXArduinoToolbox = { build };
})(typeof window !== 'undefined' ? window : globalThis);
