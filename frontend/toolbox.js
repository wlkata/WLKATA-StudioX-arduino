/* Reuse general categories; Arduino owns its target-specific block organization. */
(function (root) {
  const cppTypes = root.StudioXArduinoCppTypes || require('./cppTypes');
  const boardPins = root.StudioXArduinoBoardPins || require('./boardPins');
  // Follow BlockFactory's order for equivalents; keep additional blocks last.
  const categoryOrder = ['Loops', 'Math', 'Logic', 'Text', 'Lists', 'Variables', 'Functions', 'Robot', 'Accessories'];
  const blockOrder = {
    Loops: ['controls_whileUntil', 'controls_for', 'controls_flow_statements'],
    Math: ['math_number','math_arithmetic','arduino_remainder','arduino_bitwise','math_trig','math_single','arduino_bit_not','arduino_increment_value','arduino_variable_operation','math_round','arduino_square','arduino_sizeof','arduino_min_max','arduino_random_seed','arduino_random_int','math_random_int','math_constrain','arduino_map'],
    Logic: ['logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean', 'logic_null', 'logic_ternary'],
    Text: ['text', 'text_join', 'text_indexOf', 'text_getSubstring', 'text_changeCase', 'text_trim', 'text_length', 'text_charAt'],
    Lists: ['lists_create_with', 'lists_length', 'lists_getIndex', 'lists_setIndex'],
    Robot: ['setup_robot', 'robot_wait_idle', 'robot_send_msg', 'robot_homing', 'robot_zero', 'write_coordinate', 'write_angle', 'robot_speed'],
    Accessories: ['robot_gripper', 'robot_pump', 'robot_three_finger', 'robot_conveyor'],
  };
  function ordered(items, names, key) {
    const rank = new Map(names.map((name, index) => [name, index]));
    return items.slice().sort((a, b) => (rank.get(key(a)) ?? names.length) - (rank.get(key(b)) ?? names.length));
  }
  function orderBlocks(category, contents) {
    const names = blockOrder[category];
    if (!names) return contents.slice();
    const blocks = ordered(contents.filter(item => item.kind === 'block'), names, item => item.type);
    let index = 0;
    // Labels, buttons and existing separators keep their positions.
    return contents.map(item => item.kind === 'block' ? blocks[index++] : item);
  }
  function build(source, catalog = { libraries: [] }, board = boardPins.defaultBoard) {
    const toolbox = JSON.parse(JSON.stringify(source));
    const number = value => ({ shadow: { type: 'math_number', fields: { NUM: value } } });
    const pin = value => ({ shadow: { type: 'arduino_pin', fields: { PIN: value } } });
    const interruptPins = boardPins.interruptPins(board);
    const interruptPin = () => ({shadow:{type:'arduino_interrupt_pin',fields:{PIN:interruptPins?.[0] || '?'}}});
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
          const contents = orderBlocks(item.name, filter(item.contents));
          if (item.contents.length && !contents.length && !item.custom) return [];
          if (item.name === 'Text') contents.unshift({kind:'label',text:'Escapes: \\t tab, \\n newline, \\\\ backslash'});
          return [{ ...item, contents }];
        }
        return [item];
      });
    }
    toolbox.contents = filter(toolbox.contents).filter(item => item.name !== 'Arduino');
    function enrich(name, defaults) {
      let category=toolbox.contents.find(item=>item.name===name);
      if (!category) {category={kind:'category',name,colour:name==='Math' ? '#5C68A6' : '#5C81A6',contents:[]};toolbox.contents.push(category);}
      for (const entry of defaults) {
        const existing=category.contents.find(item=>item.kind==='block' && item.type===entry.type);
        if (existing) existing.inputs={...entry.inputs,...existing.inputs};
        else category.contents.push(entry);
      }
      category.contents=orderBlocks(name,category.contents);
    }
    enrich('Math',[
      block('math_number'),block('math_arithmetic',{A:number(1),B:number(1)}),
      block('arduino_remainder',{A:number(5),B:number(2)}),block('arduino_bitwise',{A:number(0),B:number(0)}),
      block('math_trig',{NUM:number(45)}),block('math_single',{NUM:number(9)}),block('arduino_bit_not',{NUM:number(0)}),
      block('arduino_increment_value'),block('arduino_variable_operation',{VALUE:number(1)}),
      block('math_round',{NUM:number(3.5)}),block('arduino_square',{NUM:number(2)}),
      block('arduino_sizeof',{VALUE:{shadow:{type:'arduino_type',fields:{TYPE:'int'}}}}),
      block('arduino_min_max',{A:number(1),B:number(2)}),
      block('arduino_random_seed',{NUM:{shadow:{type:'arduino_millis'}}}),
      block('arduino_random_int',{FROM:number(1),TO:number(100)}),block('math_random_int',{FROM:number(1),TO:number(100)}),
      block('math_constrain',{VALUE:number(50),LOW:number(1),HIGH:number(100)}),
      block('arduino_map',{VALUE:number(50),FROM_LOW:number(1),FROM_HIGH:number(100),TO_LOW:number(1),TO_HIGH:number(1000)}),
      block('math_modulo',{DIVIDEND:number(5),DIVISOR:number(2)}),block('math_random_float'),
    ]);
    enrich('Logic',[
      block('logic_compare',{A:number(1),B:number(1)}),
      block('logic_operation',{A:{shadow:{type:'logic_boolean',fields:{BOOL:'TRUE'}}},B:{shadow:{type:'logic_boolean',fields:{BOOL:'FALSE'}}}}),
      block('logic_negate',{BOOL:{shadow:{type:'logic_boolean',fields:{BOOL:'FALSE'}}}}),block('logic_boolean'),block('logic_null'),
      block('logic_ternary',{IF:{shadow:{type:'logic_boolean',fields:{BOOL:'TRUE'}}},THEN:number(1),ELSE:number(0)}),
    ]);
    toolbox.contents=ordered(toolbox.contents,categoryOrder,item=>item.name);
    if (toolbox.contents.length) toolbox.contents.push({kind: 'sep'});
    toolbox.contents.push(
      group('I/O', [
        block('arduino_high_low'),
        block('arduino_digital_write_value', { PIN: pin('13'), STATE: { shadow: { type: 'arduino_high_low', fields: { LEVEL: 'HIGH' } } } }),
        block('arduino_digital_read', { PIN: pin('2') }),
        block('arduino_analog_write', { PIN: pin('9'), VALUE: number(128) }),
        block('arduino_analog_read', { PIN: pin('A0') }),
        block('arduino_soft_pwm_write', { PIN: pin('4'), VALUE: number(128) }),
        block('arduino_soft_pwm_stop', { PIN: pin('4') }),
        block('arduino_button_event', { PIN: pin('2') }),
        block('arduino_attach_interrupt', { PIN: interruptPin() }),
        block('arduino_detach_interrupt', { PIN: interruptPin() }),
        block('arduino_attach_pin_change_interrupt', { PIN: pin('10') }),
        block('arduino_detach_pin_change_interrupt', { PIN: pin('10') }),
        block('arduino_pulse_in', { PIN: pin('7') }),
        block('arduino_pulse_in_timeout', { PIN: pin('7'), TIMEOUT: number(1000000) }),
        block('arduino_pin_mode', { PIN: pin('13') }, { MODE: 'OUTPUT' }),
        block('arduino_shift_out', { VALUE: number(0), DATA_PIN: pin('11'), CLOCK_PIN: pin('12') }),
        block('arduino_pin'), block('arduino_builtin_led'),
        block('arduino_tone', { PIN: pin('8'), FREQUENCY: number(440), DURATION: number(1000) }),
        block('arduino_no_tone', { PIN: pin('8') }),
      ]),
      // Shared control blocks remain in their original Loops/Logic categories.
      group('Control', [
        block('arduino_end_program'),
        block('arduino_do_while',{BOOL:{shadow:{type:'logic_boolean',fields:{BOOL:'TRUE'}}}}),
        block('arduino_delay',{MS:number(1000)}),
        block('arduino_switch',{VALUE:number(1),CASE0:number(1),CASE1:number(2)}),
        block('arduino_millis'),
        block('arduino_timer2_configure',{INTERVAL:number(500)}),
        block('arduino_timer2_start'),block('arduino_timer2_stop'),
        block('arduino_timer_every',{INTERVAL:number(1000)}),
        block('arduino_timer_callback'),
        block('arduino_timer_schedule',{INTERVAL:number(1000),COUNT:number(1)}),
        block('arduino_interrupts'),block('arduino_no_interrupts'),
        block('arduino_task'),block('arduino_task_yield'),block('arduino_task_sleep',{MS:number(1000)}),
      ]),
      group('Serial', [block('arduino_serial_begin'), block('arduino_serial_print', { VALUE: { shadow: { type: 'text', fields: { TEXT: 'Hello' } } } })]),
      group('Libraries / C++', [
        group('Manage libraries', [{kind:'button',text:'Install / manage libraries…',callbackkey:'ARDUINO_MANAGE_LIBRARIES'}]),
        ...(catalog.error ? [group('Library browser status', [{kind:'label',text:catalog.error}])] : []),
        ...(catalog.warnings && catalog.warnings.length ? [group('Library browser notes', catalog.warnings.map(text => ({kind:'label',text})))] : []),
        ...(catalog.libraries || []).map(library => group(library.name, library.headers.map(header =>
          group(header.name, headerContents(header))))),
        group('Advanced C++', [block('arduino_include'), block('arduino_cpp_declaration'), block('arduino_cpp_statement'), block('arduino_cpp_expression')]),
      ]),
    );
    return toolbox;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { build, orderBlocks };
  root.StudioXArduinoToolbox = { build, orderBlocks };
})(typeof window !== 'undefined' ? window : globalThis);
