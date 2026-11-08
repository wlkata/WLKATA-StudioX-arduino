/* Reuse general categories; Arduino owns its target-specific block organization. */
(function (root) {
  const cppTypes = root.StudioXArduinoCppTypes || require('./cppTypes');
  function build(source, catalog = { libraries: [] }) {
    const toolbox = JSON.parse(JSON.stringify(source));
    const number = value => ({ shadow: { type: 'math_number', fields: { NUM: value } } });
    const pin = value => ({ shadow: { type: 'arduino_pin', fields: { PIN: value } } });
    const block = (type, inputs = {}, fields = {}) => ({ kind: 'block', type, inputs, fields });
    const group = (name, contents) => ({ kind: 'category', name, colour: '#00979D', contents });
    function shadow(parameter) {
      const raw = parameter.default || '';
      if (parameter.kind === 'cpp' && !raw) return null;
      const numeric = Number(raw.replace(/[uUlLfF]+$/, ''));
      if (parameter.kind === 'number' && (!raw || Number.isFinite(numeric))) return number(raw ? numeric : 0);
      if (parameter.kind === 'boolean' && (!raw || ['true','false'].includes(raw))) return {shadow:{type:'logic_boolean',fields:{BOOL:raw === 'false' ? 'FALSE' : 'TRUE'}}};
      if (parameter.kind === 'text' && (!raw || /^".*"$/.test(raw))) {
        let value = '';
        try { value = raw ? cppTypes.textField(JSON.parse(raw)) : ''; } catch (_) {}
        return {shadow:{type:'text',fields:{TEXT:value}}};
      }
      return {shadow:{type:'arduino_cpp_expression',fields:{CODE:raw || '0',RETURN_TYPE:parameter.kind === 'cpp' ? 'cpp' : parameter.kind}}};
    }
    function signatureBlock(type, signature) {
      const inputs = {};
      if (type !== 'arduino_library_object_ref' && type !== 'arduino_library_constant') {
        (signature.parameters || []).forEach((parameter,index) => { if (!parameter.optional) { const value = shadow(parameter); if (value) inputs['ARG_'+index] = value; } });
      }
      return {kind:'block',type,extraState:{signature},inputs,disabled:signature.supported === false};
    }
    function headerContents(header) {
      const contents = [];
      function combined(type, options) {
        if (!options.length) return;
        const signature = options.find(item => item.supported !== false) || options[0];
        const entry = signatureBlock(type, signature);
        entry.extraState.options = options;
        // Individual unsupported choices report diagnostics instead of disabling
        // the whole dropdown when other signatures are usable.
        entry.disabled = false;
        contents.push(entry);
      }
      const functions = (header.functions || []).map(cppTypes.signature);
      combined('arduino_class', functions.filter(spec => spec.constructor === true));
      const classes = contents.find(item => item.type === 'arduino_class');
      if (classes) classes.extraState.methods = functions.filter(spec => spec.owner && !spec.static && spec.constructor !== true);
      combined('arduino_library_value', functions.filter(spec => spec.constructor !== true && (!spec.owner || spec.static)));
      combined('arduino_instance_call', functions.filter(spec => spec.constructor !== true && spec.owner && !spec.static));
      combined('arduino_library_constant', header.constants || []);
      if (!contents.length) contents.push({kind:'label',text:'No public function declarations in this header.'});
      if (header.parseErrors) contents.push({kind:'label',text:'Some declarations could not be parsed; Advanced C++ remains available.'});
      return contents;
    }
    const pythonBlocks = new Set(['import_module', 'raw', 'python_with', 'function_call',
      'instance_function_call', 'library_function_call', 'library_constant', 'workflow_run', 'workflow_slot']);
    function filter(items) {
      return (items || []).flatMap(item => {
        if (['Python', 'Workflows'].includes(item.name) || pythonBlocks.has(item.type) || String(item.type || '').startsWith('workflow_')) return [];
        if (['Robot','Accessories'].includes(item.name)) {
          const category={...item,custom:item.name==='Robot' ? 'ARDUINO_ROBOT' : 'ARDUINO_ACCESSORIES'};
          delete category.contents;
          return [category];
        }
        if (item.contents) {
          const contents = filter(item.contents);
          if (item.contents.length && !contents.length && !item.custom) return [];
          if (item.name === 'Text') contents.unshift({kind:'label',text:'Escapes: \\t tab, \\n newline, \\\\ backslash'});
          return [{ ...item, contents }];
        }
        return [item];
      });
    }
    toolbox.contents = filter(toolbox.contents).filter(item => item.name !== 'Arduino');
    toolbox.contents.push(group('Arduino', [
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
      group('Libraries / C++', [
        group('Manage libraries', [{kind:'button',text:'Install / manage libraries…',callbackkey:'ARDUINO_MANAGE_LIBRARIES'}]),
        ...(catalog.error ? [group('Library browser status', [{kind:'label',text:catalog.error}])] : []),
        ...(catalog.warnings && catalog.warnings.length ? [group('Library browser notes', catalog.warnings.map(text => ({kind:'label',text})))] : []),
        ...(catalog.libraries || []).map(library => group(library.name, library.headers.map(header =>
          group(header.name, headerContents(header))))),
        group('Advanced C++', [block('arduino_include'), block('arduino_cpp_declaration'), block('arduino_cpp_statement'), block('arduino_cpp_expression')]),
      ]),
      group('Timing', [block('arduino_delay', { MS: number(1000) }), block('arduino_millis')]),
      group('Serial', [block('arduino_serial_begin'), block('arduino_serial_print', { VALUE: { shadow: { type: 'text', fields: { TEXT: 'Hello' } } } })]),
    ]));
    return toolbox;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { build };
  root.StudioXArduinoToolbox = { build };
})(typeof window !== 'undefined' ? window : globalThis);
