/* Blockly JSON -> a conservative Arduino C++ subset. No workspace mutation. */
(function (root) {
  'use strict';
  const cppTypes = root.StudioXArduinoCppTypes || require('./cppTypes');
  const boardPins = root.StudioXArduinoBoardPins || require('./boardPins');
  const expressions = new Set([
    'math_number', 'math_arithmetic', 'math_single', 'math_round', 'math_modulo', 'math_constant',
    'math_trig','math_random_int','math_random_float','math_constrain','logic_null',
    'arduino_remainder','arduino_bitwise','arduino_bit_not','arduino_increment_value','arduino_square',
    'arduino_sizeof','arduino_min_max','arduino_random_int','arduino_map',
    'logic_boolean', 'logic_compare', 'logic_operation', 'logic_negate', 'logic_ternary',
    'variables_get', 'arduino_address_of', 'text', 'text_join', 'text_length', 'text_isEmpty',
    'arduino_interrupt_pin', 'arduino_pulse_in', 'arduino_pulse_in_timeout', 'arduino_digital_read', 'arduino_analog_read', 'arduino_millis', 'arduino_builtin_led', 'arduino_pin', 'arduino_high_low', 'arduino_cpp_expression', 'arduino_type', 'arduino_class', 'arduino_instance_call', 'arduino_library_value', 'arduino_library_object_ref', 'arduino_library_constant',
  ]);
  const statements = new Set([
    'variables_set', 'math_change', 'arduino_variable_operation', 'arduino_random_seed', 'text_append', 'text_print', 'controls_if',
    'arduino_end_program','arduino_do_while','arduino_switch','arduino_timer2_configure','arduino_timer2_start','arduino_timer2_stop',
    'arduino_timer_every','arduino_timer_callback','arduino_timer_schedule','arduino_interrupts','arduino_no_interrupts',
    'arduino_task','arduino_task_yield','arduino_task_sleep',
    'controls_repeat_ext', 'controls_repeat', 'controls_whileUntil', 'controls_for', 'controls_flow_statements',
    'arduino_setup', 'arduino_loop', 'arduino_pin_mode', 'arduino_digital_write',
    'arduino_soft_pwm_write', 'arduino_soft_pwm_stop', 'arduino_button_event', 'arduino_attach_interrupt',
    'arduino_detach_interrupt', 'arduino_attach_pin_change_interrupt', 'arduino_detach_pin_change_interrupt', 'arduino_shift_out',
    'arduino_include', 'arduino_cpp_declaration', 'arduino_cpp_statement', 'arduino_library_call', 'arduino_library_object', 'arduino_analog_write', 'arduino_digital_write_value', 'arduino_tone', 'arduino_no_tone', 'arduino_delay', 'arduino_serial_print', 'arduino_serial_begin',
  ]);
  const types = { number: 'double', boolean: 'bool', text: 'String' };
  const defaults = { number: '0', boolean: 'false', text: 'String("")' };
  const supportedBlockTypes = [...expressions, ...statements];
  function child(block, input) {
    const connection = block.inputs && block.inputs[input];
    return connection && (connection.block || connection.shadow) || null;
  }
  function next(block) { return block.next && (block.next.block || block.next.shadow) || null; }
  function disabled(block) { return block.enabled === false || Array.isArray(block.disabledReasons) && block.disabledReasons.length > 0; }
  function field(block, name, fallback) {
    return block.fields && block.fields[name] !== undefined ? block.fields[name] : fallback;
  }
  function cppString(value) {
    let out = '"';
    const controls = {7:'\\a',8:'\\b',9:'\\t',10:'\\n',11:'\\v',12:'\\f',13:'\\r'};
    for (const byte of new TextEncoder().encode(String(value))) {
      if (controls[byte]) out += controls[byte];
      else if (byte === 34 || byte === 92) out += '\\' + String.fromCharCode(byte);
      else if (byte >= 32 && byte <= 126) out += String.fromCharCode(byte);
      else out += '\\' + byte.toString(8).padStart(3, '0');
    }
    return out + '"';
  }

  function textLiteral(value) {
    const escapes = {n:'\n',r:'\r',t:'\t',a:'\x07',b:'\b',f:'\f',v:'\v','0':'\0','\\':'\\','"':'"',"'":"'"};
    // Decode only named escapes, then quote the resulting value normally.
    // One pass makes \\t literal while \t becomes a tab. Unknown escapes stay literal.
    const decoded = String(value).replace(/\\([nrtabfv0\\"'])/g, (_, key) => escapes[key]);
    return cppString(decoded);
  }

  const nativeTypes = {int:'number',long:'number','unsigned int':'number','unsigned long':'number',
    float:'number',double:'number',char:'number',byte:'number',uint8_t:'number',uint16_t:'number',uint32_t:'number',bool:'boolean',String:'text'};
  function compile(snapshot, options = {}) {
    const state = snapshot && snapshot.state || snapshot || {};
    const roots = (state.blocks && state.blocks.blocks || []).slice().sort((a, b) =>
      (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
    const diagnostics = [];
    const diagnosticKeys = new Set();
    const nodes = [];
    const variableNames = new Map((state.variables || []).map(variable => [variable.id, variable.name]));
    const variables = new Map();
    let sequence = 0;
    let usesSerial = false;
    let hasSerialBegin = false;
    const includes = new Set(['Arduino.h', 'math.h']);
    const mathHelpers = new Map();
    const nativeGlobals = [];
    const callbacks = [];
    const pinSetups = new Map();
    const buttons = new Map();
    const interruptVariables = new Set();
    let usesSoftPWM = false;
    let usesPulseIn = false;
    let usesTimer2 = false;
    let usesSimpleTimer = false;
    let usesTasks = false;
    let inTask = false;
    const everyTimers = new Map(), timedActions = new Map(), tasks = new Map();
    const automaticSetup = [], taskDeclarations = [], taskDefinitions = [];
    const libraryObjects = new Map();
    const signatures = new Map();
    function error(block, message) {
      const key = (block && block.id || '') + ':' + message;
      if (!diagnosticKeys.has(key)) {
        diagnosticKeys.add(key);
        diagnostics.push({ blockId: block && block.id || '', type: block && block.type || '', message, severity: 'error' });
      }
    }
    function addHeader(block, header) {
      if (typeof header !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_./+-]*$/.test(header) || header.length > 200 || header.split('/').some(part => ['', '.', '..'].includes(part))) {
        error(block, 'Enter a header name such as Servo.h without quotes, angle brackets, or parent paths.');
      } else includes.add(header);
    }
    const isObject = kind => typeof kind === 'string' && kind.startsWith('object:') && cppName(kind.slice(7));
    const cppType = kind => isObject(kind) ? kind.slice(7) : types[kind];
    const cppName = value => typeof value === 'string' && /^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*$/.test(value);
    function signature(block) {
      if (signatures.has(block)) return signatures.get(block);
      const spec = cppTypes.signature(block.extraState && block.extraState.signature);
      if (!spec || !cppName(spec.qualifiedName) || spec.owner && !cppName(spec.owner) || !Array.isArray(spec.parameters || []) || (spec.parameters || []).length > 16) {
        error(block, 'Choose this library block again from the library/header toolbox. Its signature is missing or invalid.');
        return null;
      }
      if (spec.supported === false) error(block, spec.reason || 'This declaration requires Advanced C++.');
      addHeader(block, spec.header);
      signatures.set(block, spec);
      return spec;
    }
    function objectVariable(block, spec) {
      const saved = field(block, 'VAR', null);
      const id = saved && typeof saved === 'object' ? saved.id : saved;
      const display = variableNames.get(id) || saved && saved.name;
      if (!id || !display) { error(block, 'Choose a library object.'); return { id: '', display: '', cpp: 'missing_object' }; }
      return { id, display, cpp: 'obj_' + String(display).replace(/[^A-Za-z0-9_]/g, '_') };
    }
    function resolveObject(block, spec) {
      const variable = objectVariable(block, spec);
      const created = libraryObjects.get(variable.id);
      if (created && created.spec.owner === spec.owner) return created.cpp;
      const assigned = variables.get(variable.id);
      if (assigned && assigned.type === 'object:' + spec.owner) return assigned.cpp;
      if (assigned && assigned.hasSet) { error(block, 'Variable ' + variable.display + ' is not declared as ' + spec.owner + '.'); return assigned.cpp; }
      const global = (spec.instances || []).find(item => item.name === variable.display && cppName(item.qualifiedName));
      if (global) return global.qualifiedName;
      error(block, 'Create a ' + spec.owner + ' object named ' + (variable.display || 'this object') + ' before using this block.');
      return variable.cpp;
    }
    function walk(block, parent) {
      if (!block) return;
      if (!disabled(block)) {
        nodes.push({ block, parent });
        for (const input of Object.keys(block.inputs || {})) walk(child(block, input), block);
      }
      walk(next(block), parent);
    }
    roots.forEach(block => walk(block, null));
    function slot(block, maximum=16) {
      const id=String(field(block,'ID','1'));
      if (!/^\d+$/.test(id) || Number(id)<1 || Number(id)>maximum) {error(block,'Choose a number from 1 to '+maximum+'.');return '1';}
      return String(Number(id));
    }
    for (const {block,parent} of nodes) {
      const map={arduino_timer_every:everyTimers,arduino_timer_callback:timedActions,arduino_task:tasks}[block.type];
      if (!map) continue;
      if (parent) error(block,'Place timer/action/task definitions at the top level, beside Setup and Loop.');
      const id=slot(block,block.type==='arduino_task' ? 8 : 16);
      if (map.has(id)) error(block,'This '+block.type.replace('arduino_','').replaceAll('_',' ')+' number is already defined.');
      else map.set(id,block);
    }
    if (everyTimers.size>10) error(null,'SimpleTimer supports at most 10 active timers.');
    const timer2Configurations=nodes.filter(item=>item.block.type==='arduino_timer2_configure');
    if (timer2Configurations.length>1) for (const {block} of timer2Configurations) error(block,'Use only one hardware timer configuration per program.');
    for (const {block,parent} of nodes) {
      if (!block.type.startsWith('arduino_library_') && !['arduino_class','arduino_instance_call'].includes(block.type)) continue;
      const spec = signature(block);
      if (block.type === 'arduino_library_object' && spec) {
        if (parent) error(block, 'Place library object creation at the top level.');
        if (spec.constructor !== true || !cppName(spec.owner)) error(block, 'Choose a library constructor.');
        const variable = objectVariable(block, spec);
        if (libraryObjects.has(variable.id)) error(block, 'This library object is already created. Choose another object variable.');
        let cpp = variable.cpp;
        if ([...libraryObjects.values()].some(item => item.cpp === cpp)) cpp += '_' + libraryObjects.size;
        libraryObjects.set(variable.id, { ...variable, cpp, block, spec });
      }
    }

    function variable(block) {
      const saved = field(block, 'VAR', null);
      const id = saved && typeof saved === 'object' ? saved.id : saved;
      if (!id) { error(block, 'Choose a variable.'); return { cpp: 'invalid_variable', type: 'number' }; }
      if (!variables.has(id)) {
        const display = variableNames.get(id) || saved.name || 'item';
        let stem = String(display).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40) || 'item';
        let cpp = 'v_' + stem;
        if ([...variables.values()].some(value => value.cpp === cpp)) cpp += '_' + variables.size;
        variables.set(id, { cpp, type: null, display });
      }
      return variables.get(id);
    }
    function addressObject(block) {
      const saved = field(block, 'VAR', null);
      return libraryObjects.get(saved && typeof saved === 'object' ? saved.id : saved);
    }
    for (const { block } of nodes) if (['variables_get', 'variables_set', 'arduino_address_of', 'math_change', 'arduino_variable_operation', 'arduino_increment_value', 'text_append', 'controls_for'].includes(block.type)) {
      if (block.type === 'arduino_address_of' && addressObject(block)) continue;
      const entry = variable(block); if (block.type === 'variables_set') entry.hasSet = true;
    }
    function declarationInfo(block) {
      if (!block || disabled(block)) return null;
      if (block.type === 'arduino_type') {
        const name = field(block, 'TYPE', 'int');
        if (!Object.prototype.hasOwnProperty.call(nativeTypes, name)) { error(block, 'Choose a supported C++ variable type.'); return null; }
        return {type:nativeTypes[name], nativeType:name};
      }
      if (block.type === 'arduino_class' || block.type === 'arduino_library_value' && block.extraState?.signature?.constructor === true) {
        const spec = signature(block);
        if (!spec || spec.constructor !== true || !cppName(spec.owner)) { error(block, 'Choose a class constructor.'); return null; }
        return {type:'object:' + spec.owner, nativeType:spec.owner, spec, source:block};
      }
      return null;
    }
    // Type/class values are declaration markers, never runtime allocations.
    for (const {block,parent} of nodes) {
      if (block.type !== 'variables_set') continue;
      const declaration = declarationInfo(child(block, 'VALUE'));
      if (!declaration) continue;
      const entry = variable(block);
      if (entry.declaration || libraryObjects.has(field(block,'VAR')?.id || field(block,'VAR'))) error(block, 'Declare each variable only once.');
      if (parent && parent.type !== 'arduino_setup') error(block, 'Place declarations at the top level or directly inside Setup.');
      entry.declaration = declaration; entry.type = declaration.type;
      entry.declarationBlock = block;
    }
    function infer(block) {
      if (!block || disabled(block)) return null;
      if (block.type === 'variables_get') return variable(block).type;
      if (['arduino_library_object_ref', 'arduino_address_of','logic_null'].includes(block.type)) return 'cpp';
      if (block.type === 'arduino_type') return declarationInfo(block)?.type;
      if (block.type === 'arduino_class') return declarationInfo(block)?.type;
      if (['arduino_library_value','arduino_instance_call'].includes(block.type)) {
        const spec = signature(block);
        return spec && spec.constructor === true ? 'object:' + spec.owner : spec?.returnKind || 'cpp';
      }
      if (block.type === 'arduino_library_constant') return signature(block)?.kind || 'cpp';
      if (block.type === 'arduino_cpp_expression') return field(block, 'RETURN_TYPE') === 'cpp' ? 'cpp' : types[field(block, 'RETURN_TYPE')] ? field(block, 'RETURN_TYPE') : 'number';
      if (block.type === 'logic_ternary') {
        const a=infer(child(block,'THEN')),b=infer(child(block,'ELSE'));
        return [a,b].every(kind=>['number','boolean'].includes(kind)) && a!==b ? 'number' : a || b;
      }
      if (['logic_boolean', 'logic_compare', 'logic_operation', 'logic_negate', 'text_isEmpty', 'arduino_digital_read', 'arduino_high_low'].includes(block.type)) return 'boolean';
      if (['text', 'text_join'].includes(block.type)) return 'text';
      return expressions.has(block.type) ? 'number' : null;
    }
    for (let pass = 0; pass <= variables.size; pass++) {
      let changed = false;
      for (const { block } of nodes) {
        let kind;
        if (block.type === 'variables_set') kind = infer(child(block, 'VALUE'));
        else if (['math_change','controls_for','arduino_variable_operation','arduino_increment_value'].includes(block.type)) kind = 'number';
        else if (block.type === 'text_append') kind = 'text';
        else continue;
        if (kind && !types[kind] && !isObject(kind)) { error(block, 'This C++ value cannot be stored in a standard Blockly variable. Use a constructor for object variables.'); kind = null; }
        const entry = variable(block);
        if (kind && !entry.type) { entry.type = kind; changed = true; }
        else if (kind && entry.type !== kind) error(block, 'Variable "' + entry.display + '" changes type. Arduino variables must keep one type.');
      }
      if (!changed) break;
    }
    for (const value of variables.values()) {
      if (!value.type) value.type = 'number';
      if (isObject(value.type) && !value.declaration) error(null, 'Declare class variable "' + value.display + '" with a class value before assigning or using it.');
    }
    for (const { block, parent } of nodes) {
      if (!expressions.has(block.type) && !statements.has(block.type)) {
        let issue;
        try { issue=JSON.parse(block.data || '{}').studioxArduinoMapping?.issue; } catch (_) {}
        error(block,issue ? 'Not mapped: ' + block.type + '. ' + issue : 'Unsupported Arduino block: ' + block.type + '. This block has no Arduino mapping.');
      }
      if ((block.type === 'arduino_setup' || block.type === 'arduino_loop') && parent) {
        error(block, 'Place Arduino setup and loop blocks at the top level.');
      }
      if (block.type === 'arduino_button_event' && parent) error(block, 'Place button event blocks at the top level, beside Setup and Loop.');
      if (block.type === 'arduino_serial_begin') hasSerialBegin = true;
      if (['arduino_include', 'arduino_cpp_declaration'].includes(block.type) && parent) error(block, 'Place library includes and C++ declarations at the top level.');
      if (block.type === 'arduino_include') {
        const header = String(field(block, 'HEADER', '')).trim();
        addHeader(block, header);
      }
      if (block.type === 'arduino_cpp_declaration') nativeGlobals.push(nativeCode(block));

    }
    for (const wrapper of ['arduino_setup', 'arduino_loop']) {
      const found = nodes.filter(item => item.block.type === wrapper);
      if (found.length > 1) found.forEach(item => error(item.block, 'Use only one ' + wrapper.replace('arduino_', '') + ' block.'));
    }
    function nativeCode(block) {
      const code = String(field(block, 'CODE', '')).trim();
      if (!code || code.length > 8192 || code.includes('\0')) {
        error(block, 'Enter C++ code of at most 8192 characters without null bytes.');
        return '';
      }
      return code;
    }
    function exprInput(block, input, expected, fallback) {
      const nested = child(block, input);
      if (!nested || disabled(nested)) {
        if (fallback !== undefined) return { code: fallback, type: expected || 'number' };
        error(block, 'Connect a value to ' + input + '.');
        return { code: defaults[expected] || '0', type: expected || 'number' };
      }
      const value = expr(nested);
      const numericCondition=expected==='boolean' && value.type==='number' && ['logic_operation','logic_negate','logic_ternary'].includes(block.type);
      if (expected && value.type !== expected && !numericCondition) error(nested, input + ' needs ' + expected + ', but this value is ' + value.type + '.');
      return value;
    }
    function mathHelper(name,code) {mathHelpers.set(name,code);return name;}
    function integerInput(block,input) {
      const evaluated=exprInput(block,input,'number'),value=evaluated.code,nested=child(block,input);
      if (nested?.type==='math_number') {
        const literal=Number(field(nested,'NUM'));
        if (Number.isInteger(literal) && literal>=-2147483648 && literal<=2147483647) return String(literal);
      }
      const nativeType=String(evaluated.cppType || '').replace(/\b(const|volatile|constexpr)\b/g,'').replace(/\s+/g,' ').trim().replace(/^std::/,'');
      // Preserve known integral values before AVR's double/float conversion can
      // round away low bits. Only floating/untyped expressions need truncation.
      if (/^(?:(?:signed )?(?:char|short(?: int)?|int|long(?: int)?)|int(?:8|16|32)_t|byte|uint(?:8|16)_t)$/.test(nativeType)) return value;
      includes.add('stdint.h');
      if (/^(?:(?:unsigned(?: char| short(?: int)?| int| long(?: int)?| long long(?: int)?)?)|uint(?:32|64)_t|size_t)$/.test(nativeType)) {
        const name=mathHelper('studioxUnsignedInteger',`static int32_t studioxUnsignedInteger(uint64_t value) {
  return value > (uint64_t)INT32_MAX ? INT32_MAX : (int32_t)value;
}`);
        return name+'('+value+')';
      }
      if (/^(?:int64_t|(?:signed )?long long(?: int)?)$/.test(nativeType)) {
        const name=mathHelper('studioxSignedInteger',`static int32_t studioxSignedInteger(int64_t value) {
  return value < INT32_MIN ? INT32_MIN : value > INT32_MAX ? INT32_MAX : (int32_t)value;
}`);
        return name+'('+value+')';
      }
      const name=mathHelper('studioxInteger',`static int32_t studioxInteger(double value) {
  if (isnan(value)) return 0;
  if (value >= 2147483647.0) return INT32_MAX;
  if (value <= -2147483648.0) return INT32_MIN;
  return (int32_t)value;
}`);
      return name+'('+value+')';
    }
    function bitInput(block,input) {
      const value=exprInput(block,input,'number'),nested=child(block,input);
      if(nested?.type==='math_number' && Number.isSafeInteger(Number(field(nested,'NUM')))) {
        const bits=Number(field(nested,'NUM')) | 0;
        if(bits===-2147483648) {includes.add('stdint.h');return 'INT32_MIN';}
        return String(bits);
      }
      const nativeType=String(value.cppType || '').replace(/\b(const|volatile|constexpr)\b/g,'').trim();
      if(nativeType && cppTypes.category(nativeType)==='number' && !/\b(float|double)\b/.test(nativeType)) return '(int32_t)('+value.code+')';
      includes.add('stdint.h');
      const fn=mathHelper('studioxBits',`static int32_t studioxBits(double value) {
  if (!isfinite(value)) return 0;
  double bits = fmod(trunc(value), 4294967296.0);
  return bits < 0 ? (int32_t)(0U - (uint32_t)(-bits)) : (int32_t)(uint32_t)bits;
}`);
      return fn+'('+value.code+')';
    }
    function libraryArguments(block, spec) {
      const optional = !!(block.extraState && block.extraState.optional);
      return (spec.parameters || []).flatMap((parameter, index) => {
        if (parameter.optional && !optional) return [];
        const kind = parameter.kind;
        if (!['number', 'boolean', 'text', 'cpp'].includes(kind)) { error(block, 'Unsupported library parameter type.'); return ['0']; }
        const argument = exprInput(block, 'ARG_' + index, kind === 'cpp' ? null : kind);
        const code = argument.code;
        if (kind === 'cpp') return [code];
        if (kind === 'text') {
          const source = child(block, 'ARG_' + index);
          if (parameter.type.includes('*') && source?.type === 'text') return [textLiteral(field(source, 'TEXT', ''))];
          if (parameter.type.includes('std::string')) return ['std::string(String(' + code + ').c_str())'];
          return [parameter.type.includes('*') ? 'String(' + code + ').c_str()' : 'String(' + code + ')'];
        }
        if (!/^[A-Za-z_][A-Za-z0-9_: ]*$/.test(parameter.type || '')) { error(block, 'Use Advanced C++ for this parameter type.'); return [code]; }
        return ['(' + parameter.type + ')(' + code + ')'];
      });
    }
    function libraryCall(block) {
      const spec = signature(block);
      if (!spec) return '0';
      if (spec.constructor === true) { error(block, 'Connect this constructor value to a set variable block.'); return '0'; }
      const callee = spec.owner && !spec.static ? resolveObject(block, spec) + '.' + spec.name : spec.qualifiedName;
      if (spec.owner && !spec.static && !cppName(spec.name)) { error(block, 'Invalid library method name.'); return '0'; }
      return callee + '(' + libraryArguments(block, spec).join(', ') + ')';
    }
    function expr(block) {
      const number = (code,cppType) => ({ code, type: 'number',...(cppType ? {cppType} : {}) });
      const boolean = code => ({ code, type: 'boolean' });
      const text = code => ({ code, type: 'text' });
      const n = input => exprInput(block, input, 'number').code;
      const b = input => exprInput(block, input, 'boolean').code;
      switch (block.type) {
        case 'math_number': {
          const value = Number(field(block, 'NUM', 0));
          if (!Number.isFinite(value)) { error(block, 'Arduino numbers must be finite.'); return number('0'); }
          if(value===-2147483648) {includes.add('stdint.h');return number('INT32_MIN','int32_t');}
          if(Number.isInteger(value) && value>2147483647 && value<=4294967295) return number(String(value)+'UL','uint32_t');
          const code=String(value);
          return number(Number.isInteger(value) && (value < -2147483648 || value>4294967295) && !/[eE]/.test(code) ? code+'.0' : code);
        }
        case 'logic_boolean': return boolean(field(block, 'BOOL', 'TRUE') === 'TRUE' ? 'true' : 'false');
        case 'variables_get': { const value = variable(block); return { code: value.cpp, type: value.type, cppType:value.declaration?.nativeType || cppType(value.type) }; }
        case 'arduino_address_of': {
          const object = addressObject(block);
          if (object) return {code: '&' + object.cpp, type: 'cpp', cppType: object.spec.owner + ' *'};
          const value = variable(block);
          return {code: '&' + value.cpp, type: 'cpp', cppType: (value.declaration?.nativeType || cppType(value.type)) + ' *'};
        }
        case 'text': return text('String(' + textLiteral(field(block, 'TEXT', '')) + ')');
        case 'math_arithmetic': {
          const a = n('A'), c = n('B');
          const op = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/' }[field(block, 'OP')];
          if (field(block, 'OP') === 'POWER') return number('pow(' + a + ', ' + c + ')');
          if (!op) error(block, 'Unsupported arithmetic operation.');
          return number('((double)(' + a + ') ' + (op || '+') + ' (' + c + '))');
        }
        case 'arduino_remainder': {
          const a=integerInput(block,'A'),c=integerInput(block,'B'),divisor=child(block,'B');
          if(divisor?.type==='math_number' && Number(field(divisor,'NUM'))===0)error(block,'Integer remainder needs a nonzero divisor.');
          includes.add('stdint.h');
          const fn=mathHelper('studioxRemainder',`static int32_t studioxRemainder(int32_t a, int32_t b) {
  return b == 0 || (a == INT32_MIN && b == -1) ? 0 : a % b;
}`);
          return number(fn+'('+a+', '+c+')','int32_t');
        }
        case 'arduino_bitwise': {
          const op=choice(block,'OP',['AND','OR','XOR','SHL','SHR']),a=bitInput(block,'A'),c=['SHL','SHR'].includes(op) ? integerInput(block,'B') : bitInput(block,'B');
          if(['AND','OR','XOR'].includes(op))return number('('+a+' '+{AND:'&',OR:'|',XOR:'^'}[op]+' '+c+')','int32_t');
          const shift=child(block,'B');
          if(shift?.type==='math_number' && (!Number.isInteger(Number(field(shift,'NUM'))) || Number(field(shift,'NUM'))<0 || Number(field(shift,'NUM'))>31))error(block,'Shift count must be a whole number from 0 to 31.');
          includes.add('stdint.h');
          const name=op==='SHL' ? 'studioxShiftLeft' : 'studioxShiftRight';
          mathHelper(name,'static int32_t '+name+'(int32_t value, int32_t shift) {\n  return shift < 0 || shift > 31 ? 0 : '+(op==='SHL' ? '(int32_t)((uint32_t)value << shift)' : '(value >> shift)')+';\n}');
          return number(name+'('+a+', '+c+')','int32_t');
        }
        case 'arduino_bit_not': return number('(~('+bitInput(block,'NUM')+'))','int32_t');
        case 'arduino_increment_value': {
          const target=variable(block),op=choice(block,'OP',['INC','DEC']);
          if(target.type!=='number')error(block,'Increment/decrement requires a numeric variable.');
          return number('('+(op==='INC' ? '++' : '--')+target.cpp+')');
        }
        case 'arduino_square': return number('pow('+n('NUM')+', 2)');
        case 'arduino_sizeof': {
          const operand=child(block,'VALUE');
          if(operand?.type==='arduino_type') {
            const type=declarationInfo(operand);
            return number('sizeof('+(type?.nativeType || 'int')+')');
          }
          return number('sizeof('+exprInput(block,'VALUE').code+')');
        }
        case 'arduino_min_max': return number((choice(block,'OP',['MIN','MAX'])==='MIN' ? 'fmin' : 'fmax')+'('+n('A')+', '+n('B')+')');
        case 'arduino_random_int': return number('random('+integerInput(block,'FROM')+', '+integerInput(block,'TO')+')');
        case 'math_random_int': {
          const a=integerInput(block,'FROM'),c=integerInput(block,'TO');includes.add('stdint.h');
          const fn=mathHelper('studioxRandomInclusive',`static int32_t studioxRandomInclusive(int32_t low, int32_t high) {
  if (low > high) { int32_t value = low; low = high; high = value; }
  uint32_t span = (uint32_t)high - (uint32_t)low + 1U;
  uint32_t threshold = span ? (uint32_t)(-span) % span : 0;
  uint32_t sample;
  do { sample = ((uint32_t)random(65536L) << 16) | (uint32_t)random(65536L); } while (sample < threshold);
  return (int32_t)((uint32_t)low + (span ? sample % span : sample));
}`);
          return number(fn+'('+a+', '+c+')','int32_t');
        }
        case 'math_random_float': return number('(random(16777216L) / 16777216.0)');
        case 'math_constrain': {
          const v=n('VALUE'),lo=n('LOW'),hi=n('HIGH'),lower=child(block,'LOW'),upper=child(block,'HIGH');
          if(lower?.type==='math_number' && upper?.type==='math_number' && Number(field(lower,'NUM'))>Number(field(upper,'NUM')))error(block,'The lower constrain limit must not exceed the upper limit.');
          const fn=mathHelper('studioxConstrain',`static double studioxConstrain(double value, double low, double high) {
  if (low > high) { double bound = low; low = high; high = bound; }
  return value < low ? low : value > high ? high : value;
}`);
          return number(fn+'('+v+', '+lo+', '+hi+')');
        }
        case 'arduino_map': {
          const mode=choice(block,'MODE',['INT','FLOAT']),names=['VALUE','FROM_LOW','FROM_HIGH','TO_LOW','TO_HIGH'];
          const args=names.map(input=>mode==='INT' ? integerInput(block,input) : n(input));
          const low=child(block,'FROM_LOW'),high=child(block,'FROM_HIGH');
          if(low?.type==='math_number' && high?.type==='math_number' && (mode==='INT' ? Math.trunc(Number(field(low,'NUM')))===Math.trunc(Number(field(high,'NUM'))) : Number(field(low,'NUM'))===Number(field(high,'NUM'))))error(block,'The input range endpoints must differ.');
          if(mode==='INT') {
            includes.add('stdint.h');
            const fn=mathHelper('studioxMapInteger',`static int32_t studioxMapInteger(int32_t value, int32_t inLow, int32_t inHigh, int32_t outLow, int32_t outHigh) {
  return inLow == inHigh ? 0 : map(value, inLow, inHigh, outLow, outHigh);
}`);
            return number(fn+'('+args.join(', ')+')');
          }
          const fn=mathHelper('studioxMapDecimal',`static double studioxMapDecimal(double value, double inLow, double inHigh, double outLow, double outHigh) {
  return inLow == inHigh ? 0 : (value - inLow) * (outHigh - outLow) / (inHigh - inLow) + outLow;
}`);
          return number(fn+'('+args.join(', ')+')');
        }
        case 'math_trig': {
          const value=n('NUM'),op=choice(block,'OP',['SIN','COS','TAN','ASIN','ACOS','ATAN']);
          return number(op.length===3 ? op.toLowerCase()+'(('+value+') * DEG_TO_RAD)' : '('+op.toLowerCase()+'('+value+') * RAD_TO_DEG)');
        }
        case 'math_modulo': return number('studioxModulo(' + n('DIVIDEND') + ', ' + n('DIVISOR') + ')');
        case 'math_single': {
          const value = n('NUM');
          const op = field(block, 'OP');
          if (op === 'NEG') return number('(-(' + value + '))');
          if (op === 'POW10') return number('pow(10, ' + value + ')');
          const fn = { ROOT: 'sqrt', ABS: 'fabs', LN: 'log', LOG10: 'log10', EXP: 'exp' }[op];
          if (!fn) error(block, 'Unsupported math operation.');
          return number((fn || 'fabs') + '(' + value + ')');
        }
        case 'math_round': {
          const fn = { ROUND: 'round', ROUNDUP: 'ceil', ROUNDDOWN: 'floor' }[field(block, 'OP')];
          if (!fn) error(block, 'Unsupported rounding operation.');
          return number((fn || 'round') + '(' + n('NUM') + ')');
        }
        case 'math_constant': {
          const constant = { PI: '3.141592653589793', E: '2.718281828459045', GOLDEN_RATIO: '1.618033988749895', SQRT2: '1.4142135623730951', SQRT1_2: '0.7071067811865476' }[field(block, 'CONSTANT')];
          if (!constant) error(block, 'This math constant is not supported on Arduino.');
          return number(constant || '0');
        }
        case 'logic_compare': {
          const a = exprInput(block, 'A'), c = exprInput(block, 'B');
          if (!cppTypes.comparable(a.type, c.type)) error(block, 'Cannot compare ' + (a.cppType || a.type) + ' with ' + (c.cppType || c.type) + '.');
          const op = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' }[field(block, 'OP')];
          if (!op) error(block, 'Unsupported comparison.');
          return boolean('(' + a.code + ' ' + (op || '==') + ' ' + c.code + ')');
        }
        case 'logic_operation': {
          const op = { AND: '&&', OR: '||' }[field(block, 'OP')];
          if (!op) error(block, 'Unsupported logic operation.');
          return boolean('(' + b('A') + ' ' + (op || '&&') + ' ' + b('B') + ')');
        }
        case 'logic_negate': return boolean('(!(' + b('BOOL') + '))');
        case 'logic_ternary': {
          const condition = b('IF'), a = exprInput(block, 'THEN'), c = exprInput(block, 'ELSE');
          const scalar=[a.type,c.type].every(type=>['number','boolean'].includes(type));
          if (a.type !== c.type && !scalar) error(block, 'Both ternary results must have compatible types.');
          return { code: '(' + condition + ' ? ' + a.code + ' : ' + c.code + ')', type: scalar && a.type!==c.type ? 'number' : a.type };
        }
        case 'logic_null': return {code:'nullptr',type:'cpp',cppType:'std::nullptr_t'};
        case 'text_join': {
          const count = Number(block.extraState && block.extraState.itemCount || 0);
          const values = [];
          for (let index = 0; index < count; index++) values.push('String(' + exprInput(block, 'ADD' + index, null, 'String("")').code + ')');
          return text('(String("")' + values.map(value => ' + ' + value).join('') + ')');
        }
        case 'text_length': return number('(' + exprInput(block, 'VALUE', 'text').code + ').length()');
        case 'text_isEmpty': return boolean('((' + exprInput(block, 'VALUE', 'text').code + ').length() == 0)');
        case 'arduino_digital_read': return boolean('(digitalRead((uint8_t)(' + n('PIN') + ')) == HIGH)');
        case 'arduino_analog_read': return number('analogRead((uint8_t)(' + n('PIN') + '))');
        case 'arduino_pulse_in': case 'arduino_pulse_in_timeout': {
          const pin = pinInput(block, 'PIN', 'INPUT');
          const level = choice(block, 'LEVEL', ['HIGH', 'LOW']);
          const timeout = block.type === 'arduino_pulse_in_timeout'
            ? ', (unsigned long)constrain((double)(' + n('TIMEOUT') + '), 0.0, 4294967295.0)' : '';
          if (pin.fixed) return number('pulseIn(' + pin.code + ', ' + level + timeout + ')');
          usesPulseIn = true;
          return number('studioxPulseIn((uint8_t)(' + pin.code + '), ' + level + timeout + ')');
        }
        case 'arduino_millis': return number(choice(block,'UNIT',['MS','US']) === 'US' ? 'micros()' : 'millis()');
        case 'arduino_builtin_led': return number('LED_BUILTIN');
        case 'arduino_type': case 'arduino_class':
          error(block, 'Connect this type/class value directly to a set variable block to declare it.');
          return {code:'0',type:'cpp'};
        case 'arduino_instance_call':
        case 'arduino_library_value': {
          const spec = signature(block);
          if (!spec) return number('0');
          if (spec.constructor === true) {
            if (!cppName(spec.owner)) { error(block, 'Choose a valid constructor.'); return {code:'0',type:'cpp'}; }
            error(block, 'Connect this class value directly to a set variable block to declare it.');
            return {code:'0',type:'object:' + spec.owner};
          }
          if (spec.returnKind === 'void') error(block, 'This library function does not return a value.');
          let code = libraryCall(block);
          if (spec.returnKind === 'text') code = spec.returnType.includes('std::string') ? 'String((' + code + ').c_str())' : 'String(' + code + ')';
          return { code, type: spec.returnKind || 'cpp', cppType: spec.returnType };
        }
        case 'arduino_library_object_ref': {
          const spec = signature(block);
          return {code: spec ? resolveObject(block, spec) : '0', type: 'cpp'};
        }
        case 'arduino_library_constant': {
          const spec = signature(block);
          return {code: spec ? (spec.kind === 'text' ? 'String(' + spec.qualifiedName + ')' : spec.qualifiedName) : '0', type: spec && spec.kind || 'cpp'};
        }

        case 'arduino_cpp_expression': {
          const type = field(block, 'RETURN_TYPE');
          if (!types[type] && type !== 'cpp') error(block, 'Choose a C++ expression return type.');
          const code = nativeCode(block) || '0';
          return { code: type === 'text' ? 'String(' + code + ')' : '(' + code + ')', type: type === 'cpp' ? 'cpp' : types[type] ? type : 'number' };
        }

        case 'arduino_interrupt_pin': case 'arduino_pin': {
          const pin = String(field(block, 'PIN', '')).trim();
          if (block.type === 'arduino_interrupt_pin' && (pin === '?' || options.board && !boardPins.interruptPins(options.board))) {
            error(block, options.board && !boardPins.interruptPins(options.board)
              ? 'Hardware-interrupt pins are not listed for this board. Check the board pinout and replace this dropdown with a pin value.'
              : 'Choose a hardware-interrupt pin for the selected board.');
            return number('0');
          }
          if (/^(?:[0-9]{1,3})$/.test(pin) && Number(pin) <= 255) return number(String(Number(pin)));
          if (/^A(?:[0-9]|[12][0-9]|3[01])$/.test(pin)) return number(pin);
          error(block, 'Use a pin number from 0 to 255 or a board analog label such as A0.');
          return number('0');
        }
        case 'arduino_high_low': {
          const level = field(block, 'LEVEL');
          if (!['HIGH', 'LOW'].includes(level)) error(block, 'Choose HIGH or LOW.');
          return boolean(level === 'HIGH' ? 'true' : 'false');
        }

        default:
          error(block, 'Unsupported Arduino value: ' + block.type + '.');
          return number('0');
      }
    }
    function choice(block, name, options) {
      const selected = field(block, name, options[0]);
      if (!options.includes(selected)) { error(block, 'Choose a valid ' + name.toLowerCase().replace('_', ' ') + '.'); return options[0]; }
      return selected;
    }
    function pinInput(block, input, mode) {
      const nested = child(block, input);
      const code = exprInput(block, input, 'number').code;
      const literal = nested?.type === 'math_number' ? Number(field(nested, 'NUM')) : null;
      const fixed = nested && !disabled(nested) && (['arduino_pin','arduino_interrupt_pin','arduino_builtin_led'].includes(nested.type) ||
        nested.type === 'math_number' && Number.isInteger(literal) && literal >= 0 && literal <= 255);
      // BlockFactory keeps one startup mode per fixed pin; the last implicit
      // request wins. Explicit pin-mode blocks still run where they are placed.
      const unresolved = nested?.type === 'arduino_interrupt_pin' && (field(nested,'PIN') === '?' ||
        options.board && !boardPins.interruptPins(options.board));
      if (fixed && !unresolved && ['arduino_attach_interrupt','arduino_detach_interrupt'].includes(block.type)) {
        const pins = boardPins.interruptPins(options.board);
        if (pins && !pins.includes(code)) error(block, 'Pin ' + code + ' is not a hardware-interrupt pin for this board. Choose ' + pins.join(', ') + '.');
      }
      if (fixed && !unresolved && mode) pinSetups.set(code, mode);
      return {code, fixed, mode};
    }
    function pinCall(pins, depth, call) {
      const pad = indent(depth);
      if (pins.every(pin => pin.fixed)) return pad + call(pins.map(pin => pin.code)) + ';\n';
      // A runtime pin expression must be evaluated once, after any assignments
      // preceding the block. Only these dynamic inputs need a local temporary.
      const inner = indent(depth+1);
      let declarations = '';
      const args = pins.map((pin,index) => {
        if (pin.fixed) return pin.code;
        const name = 'sx_pin_' + index;
        declarations += inner + 'const uint8_t ' + name + ' = (uint8_t)(' + pin.code + ');\n' +
          inner + 'pinMode(' + name + ', ' + pin.mode + ');\n';
        return name;
      });
      return pad + '{\n' + declarations + inner + call(args) + ';\n' + pad + '}\n';
    }
    function callback(block, interrupt, name = 'sx_handler_' + ++sequence) {
      // Interrupt callbacks start a new function, so outer loops cannot supply
      // a break/continue target. Scalar variables they access must be volatile.
      if (interrupt) {
        function mark(current) {
          if (!current) return;
          if (!disabled(current)) {
            if (['variables_get','variables_set','math_change','arduino_variable_operation','arduino_increment_value','controls_for','arduino_address_of'].includes(current.type)) {
              interruptVariables.add(variable(current));
            }
            Object.keys(current.inputs || {}).forEach(input => mark(child(current,input)));
          }
          mark(next(current));
        }
        mark(child(block,'DO'));
      }
      const taskContext=inTask;inTask=false;
      let code;
      try {code=body(block,'DO',1,0);} finally {inTask=taskContext;}
      callbacks.push({name, code});
      return name;
    }
    const indent = depth => '  '.repeat(depth);
    function body(block, input, depth, loopDepth, switchDepth=0) { return chain(child(block, input), depth, loopDepth, switchDepth); }
    function chain(first, depth, loopDepth, switchDepth=0) {
      let code = '';
      for (let block = first; block; block = next(block)) {
        if (!disabled(block)) code += statement(block, depth, loopDepth, switchDepth);
      }
      return code;
    }
    function timingArgument(block,input,type='unsigned long',maximum=4294967295) {
      const code=exprInput(block,input,'number').code;
      const nested=child(block,input),literal=nested?.type==='math_number' ? Number(field(nested,'NUM')) : NaN;
      return Number.isInteger(literal) && literal>=0 && literal<=maximum ? String(literal) :
        '('+type+')constrain((double)('+code+'), 0.0, '+maximum+'.0)';
    }
    function caseCode(block,input) {
      const nested=child(block,input),value=exprInput(block,input);
      if (nested?.type==='math_number') {
        const literal=Number(field(nested,'NUM'));
        if (!Number.isInteger(literal) || literal < -2147483648 || literal>2147483647) error(nested,'Case values must be 32-bit integer constants.');
        return {code:value.code,key:String(literal)};
      }
      if (nested?.type==='logic_boolean') return {code:value.code,key:field(nested,'BOOL')==='TRUE' ? '1' : '0'};
      if (!['arduino_library_constant','arduino_cpp_expression'].includes(nested?.type)) error(block,'Each case needs an integer constant; use a number, library constant, or constant C++ expression.');
      return {code:'(long)('+value.code+')',key:value.code};
    }
    function statement(block, depth, loopDepth, switchDepth=0) {
      const pad = indent(depth);
      const line = value => pad + value + '\n';
      const value = (input, expected, fallback) => exprInput(block, input, expected, fallback).code;
      const variableEntry = () => variable(block);
      switch (block.type) {
        case 'variables_set': {
          const target = variableEntry();
          if (declarationInfo(child(block, 'VALUE'))) return '';
          const source = exprInput(block, 'VALUE');
          if (target.type !== source.type) error(block, 'Variable "' + target.display + '" must keep type ' + target.type + '.');
          return line(target.cpp + ' = ' + source.code + ';');
        }
        case 'arduino_variable_operation': {
          const target=variable(block),op=choice(block,'OP',['ADD','SUB','MUL','DIV']),amount=value('VALUE','number');
          if(target.type!=='number')error(block,'Compound assignment requires a numeric variable.');
          const divisor=child(block,'VALUE');
          if(op==='DIV' && divisor?.type==='math_number' && Number(field(divisor,'NUM'))===0)error(block,'Division needs a nonzero divisor.');
          return line(target.cpp+' '+{ADD:'+=',SUB:'-=',MUL:'*=',DIV:'/='}[op]+' '+amount+';');
        }
        case 'arduino_random_seed': return line('randomSeed('+value('NUM','number')+');');
        case 'math_change': {
          const target = variableEntry();
          if (target.type !== 'number') error(block, 'Change requires a numeric variable.');
          return line(target.cpp + ' += ' + value('DELTA', 'number') + ';');
        }
        case 'text_append': {
          const target = variableEntry();
          if (target.type !== 'text') error(block, 'Append requires a text variable.');
          return line(target.cpp + ' += String(' + value('TEXT') + ');');
        }
        case 'controls_if': {
          let code = '', index = 0;
          while (block.inputs && block.inputs['IF' + index]) {
            code += line((index ? 'else if' : 'if') + ' (' + value('IF' + index, 'boolean') + ') {') + body(block, 'DO' + index, depth + 1, loopDepth, switchDepth) + line('}');
            index++;
          }
          if (!index) error(block, 'An if block needs a condition.');
          if (block.inputs && block.inputs.ELSE) code += line('else {') + body(block, 'ELSE', depth + 1, loopDepth, switchDepth) + line('}');
          return code;
        }
        case 'arduino_end_program': return line('while (true) {}');
        case 'arduino_do_while': {
          const mode=choice(block,'MODE',['WHILE','UNTIL']),condition=value('BOOL','boolean');
          return line('do {')+body(block,'DO',depth+1,loopDepth+1,switchDepth)+
            line('} while ('+(mode==='UNTIL' ? '!('+condition+')' : condition)+');');
        }
        case 'arduino_switch': {
          const count=Number(block.extraState?.caseCount ?? 2),hasDefault=block.extraState?.hasDefault !== false;
          if (!Number.isInteger(count) || count<1 || count>16) error(block,'Use between 1 and 16 switch cases.');
          const subject=exprInput(block,'VALUE');
          if (!['number','boolean','cpp'].includes(subject.type)) error(block,'Switch requires an integer value.');
          const selector=child(block,'VALUE');
          const integerLiteral=selector?.type==='math_number' && Number.isInteger(Number(field(selector,'NUM')));
          const selected=integerLiteral || subject.type==='boolean' ? subject.code : '(long)('+subject.code+')';
          let code=line('switch ('+selected+') {');
          const seen=new Set();
          for (let index=0;index<Math.max(1,Math.min(16,count || 2));index++) {
            const item=caseCode(block,'CASE'+index);
            if(seen.has(item.key))error(block,'Switch case values must be unique.');seen.add(item.key);
            code+=indent(depth+1)+'case '+item.code+': {\n'+body(block,'DO'+index,depth+2,loopDepth,switchDepth+1)+indent(depth+2)+'break;\n'+indent(depth+1)+'}\n';
          }
          if(hasDefault)code+=indent(depth+1)+'default: {\n'+body(block,'DEFAULT',depth+2,loopDepth,switchDepth+1)+indent(depth+2)+'break;\n'+indent(depth+1)+'}\n';
          return code+line('}');
        }
        case 'controls_repeat_ext':
        case 'controls_repeat': {
          const count = block.type === 'controls_repeat' ? String(Number(field(block, 'TIMES', 0))) : value('TIMES', 'number');
          const id = ++sequence;
          return line('for (long sx_i_' + id + ' = 0, sx_n_' + id + ' = (long)(' + count + '); sx_i_' + id + ' < sx_n_' + id + '; ++sx_i_' + id + ') {') +
            body(block, 'DO', depth + 1, loopDepth + 1, switchDepth) + line('}');
        }
        case 'controls_whileUntil': {
          const condition = value('BOOL', 'boolean');
          const mode = field(block, 'MODE', 'WHILE');
          if (!['WHILE', 'UNTIL'].includes(mode)) error(block, 'Unsupported while/until mode.');
          return line('while (' + (mode === 'UNTIL' ? '!(' + condition + ')' : condition) + ') {') + body(block, 'DO', depth + 1, loopDepth + 1, switchDepth) + line('}');
        }
        case 'controls_for': {
          const target = variableEntry();
          if (target.type !== 'number') error(block, 'For loops require a numeric variable.');
          const from = value('FROM', 'number'), to = value('TO', 'number'), by = value('BY', 'number');
          const stepBlock = child(block, 'BY');
          if (stepBlock && stepBlock.type === 'math_number' && Number(field(stepBlock, 'NUM')) === 0) error(block, 'For-loop step must not be zero.');
          const id = ++sequence, prefix = 'sx_for_' + id;
          return line('{') + indent(depth + 1) + 'double ' + prefix + '_from = ' + from + ', ' + prefix + '_to = ' + to + ', ' + prefix + '_step = fabs(' + by + ');\n' +
            indent(depth + 1) + 'bool ' + prefix + '_up = ' + prefix + '_from <= ' + prefix + '_to;\n' +
            indent(depth + 1) + 'for (' + target.cpp + ' = ' + prefix + '_from; ' + prefix + '_step > 0 && (' + prefix + '_up ? ' + target.cpp + ' <= ' + prefix + '_to : ' + target.cpp + ' >= ' + prefix + '_to); ' + target.cpp + ' += ' + prefix + '_up ? ' + prefix + '_step : -' + prefix + '_step) {\n' +
            body(block, 'DO', depth + 2, loopDepth + 1, switchDepth) + indent(depth + 1) + '}\n' + line('}');
        }
        case 'controls_flow_statements': {
          const flow = field(block, 'FLOW');
          if (!loopDepth && (flow !== 'BREAK' || !switchDepth)) error(block, 'Break must be inside a loop or switch; continue must be inside a loop.');
          if (!['BREAK', 'CONTINUE'].includes(flow)) error(block, 'Unsupported loop flow.');
          return line(flow === 'CONTINUE' ? 'continue;' : 'break;');
        }
        case 'arduino_pin_mode': {
          const mode = field(block, 'MODE');
          if (!['INPUT', 'OUTPUT', 'INPUT_PULLUP'].includes(mode)) error(block, 'Choose a valid pin mode.');
          const pin = pinInput(block, 'PIN');
          const code = pin.fixed ? pin.code : '(uint8_t)(' + pin.code + ')';
          return line('pinMode(' + code + ', ' + (['INPUT','OUTPUT','INPUT_PULLUP'].includes(mode) ? mode : 'INPUT') + ');');
        }
        case 'arduino_digital_write': {
          const level = field(block, 'LEVEL');
          if (!['HIGH', 'LOW'].includes(level)) error(block, 'Choose HIGH or LOW.');
          return line('digitalWrite((uint8_t)(' + value('PIN', 'number') + '), ' + (level === 'HIGH' ? 'HIGH' : 'LOW') + ');');
        }
        case 'arduino_soft_pwm_write': case 'arduino_soft_pwm_stop': {
          includes.add('SoftPWM.h'); usesSoftPWM = true;
          const pin = pinInput(block, 'PIN').code;
          return line(block.type === 'arduino_soft_pwm_stop'
            ? 'SoftPWMEnd(' + pin + ');'
            : 'SoftPWMSet(' + pin + ', constrain(' + value('VALUE','number') + ', 0, 255));');
        }
        case 'arduino_button_event': {
          includes.add('OneButton.h');
          const pinBlock = child(block,'PIN');
          if (!pinBlock || !['arduino_pin','arduino_interrupt_pin','arduino_builtin_led','math_number'].includes(pinBlock.type)) {
            error(block, 'Button events need a fixed pin: use a pin, built-in LED pin, or whole number block.');
          }
          if (pinBlock?.type === 'math_number') {
            const pin = Number(field(pinBlock,'NUM'));
            if (!Number.isInteger(pin) || pin < 0 || pin > 255) error(block, 'Button pin must be a whole number from 0 to 255.');
          }
          const pin = value('PIN','number');
          const active = choice(block, 'ACTIVE_LEVEL', ['LOW','HIGH']);
          const event = choice(block, 'EVENT', ['attachClick','attachDoubleClick','attachLongPressStart','attachDuringLongPress','attachLongPressStop']);
          let button = buttons.get(pin);
          if (!button) { button = {name:'sx_button_' + (buttons.size + 1), pin, active, events:new Map()}; buttons.set(pin,button); }
          if (button.active !== active) error(block, 'Events for the same button pin must use the same pressed level.');
          if (button.events.has(event)) error(block, 'This button pin already has a handler for this event.');
          const handler = callback(block, false);
          button.events.set(event, handler);
          return '';
        }
        case 'arduino_attach_interrupt': case 'arduino_attach_pin_change_interrupt': {
          const pinChange = block.type === 'arduino_attach_pin_change_interrupt';
          if (pinChange) includes.add('PinChangeInt.h');
          const mode = choice(block,'MODE',['RISING','FALLING','CHANGE']);
          const pin = pinInput(block, 'PIN', pinChange ? 'INPUT' : 'INPUT_PULLUP');
          const handler = callback(block, true);
          return pinCall([pin], depth, ([code]) => (pinChange ? 'PCintPort::attachInterrupt(' + code :
            'attachInterrupt(digitalPinToInterrupt(' + code + ')') + ', ' + handler + ', ' + mode + ')');
        }
        case 'arduino_detach_interrupt': case 'arduino_detach_pin_change_interrupt': {
          const pinChange = block.type === 'arduino_detach_pin_change_interrupt';
          if (pinChange) includes.add('PinChangeInt.h');
          const pin = pinInput(block, 'PIN', 'INPUT');
          return pinCall([pin], depth, ([code]) => pinChange ? 'PCintPort::detachInterrupt(' + code + ')' :
            'detachInterrupt(digitalPinToInterrupt(' + code + '))');
        }
        case 'arduino_shift_out': {
          const order = choice(block,'ORDER',['LSBFIRST','MSBFIRST']);
          const data = pinInput(block, 'DATA_PIN', 'OUTPUT');
          const clock = pinInput(block, 'CLOCK_PIN', 'OUTPUT');
          const byte = value('VALUE','number');
          return pinCall([data,clock], depth, ([dataPin,clockPin]) =>
            'shiftOut(' + dataPin + ', ' + clockPin + ', ' + order + ', ' + byte + ')');
        }
        case 'arduino_include': case 'arduino_cpp_declaration': return '';
        case 'arduino_library_object': return '';
        case 'arduino_instance_call':
        case 'arduino_library_value':
          if (!block.extraState?.statement && signature(block)?.returnKind !== 'void') { error(block, 'Connect this value block to a statement before compiling.'); return ''; }
          if (signature(block)?.constructor === true) { error(block, 'Connect the constructor to a set variable block.'); return ''; }
          return line(libraryCall(block) + ';');
        case 'arduino_library_call': return line(libraryCall(block) + ';');
        case 'arduino_cpp_statement': return nativeCode(block).split('\n').map(code => line(code)).join('');
        case 'arduino_digital_write_value':
          return line('digitalWrite((uint8_t)(' + value('PIN', 'number') + '), (' + value('STATE', 'boolean') + ') ? HIGH : LOW);');
        case 'arduino_tone':
          return line('tone((uint8_t)(' + value('PIN', 'number') + '), (unsigned int)constrain(' + value('FREQUENCY', 'number') + ', 0, 65535), (unsigned long)max(0.0, (double)(' + value('DURATION', 'number') + ')));');
        case 'arduino_no_tone': return line('noTone((uint8_t)(' + value('PIN', 'number') + '));');
        case 'arduino_analog_write': return line('analogWrite((uint8_t)(' + value('PIN', 'number') + '), (int)constrain(' + value('VALUE', 'number') + ', 0, 255));');
        case 'arduino_delay': {
          const unit=choice(block,'UNIT',['MS','US']);
          return line((unit==='US' ? 'delayMicroseconds' : 'delay')+'('+timingArgument(block,'MS',unit==='US' ? 'unsigned int' : 'unsigned long',unit==='US' ? 65535 : 4294967295)+');');
        }
        case 'arduino_timer2_configure': {
          includes.add('MsTimer2.h');usesTimer2=true;
          const interval=timingArgument(block,'INTERVAL');
          const handler=callback(block,true,'sx_hardware_timer');
          return line('MsTimer2::set('+interval+', '+handler+');');
        }
        case 'arduino_timer2_start': case 'arduino_timer2_stop':
          includes.add('MsTimer2.h');usesTimer2=true;
          if(block.type==='arduino_timer2_start' && !timer2Configurations.length)error(block,'Configure the hardware timer before starting it.');
          return line(block.type==='arduino_timer2_start' ? 'MsTimer2::start();' : 'MsTimer2::stop();');
        case 'arduino_timer_every': {
          includes.add('SimpleTimer.h');usesSimpleTimer=true;
          const name='sx_every_'+slot(block),interval=timingArgument(block,'INTERVAL','long',2147483647);
          callback(block,false,name);automaticSetup.push('  sx_timer.setInterval('+interval+', '+name+');\n');return '';
        }
        case 'arduino_timer_callback':
          includes.add('SimpleTimer.h');usesSimpleTimer=true;
          callback(block,false,'sx_action_'+slot(block));return '';
        case 'arduino_timer_schedule': {
          includes.add('SimpleTimer.h');usesSimpleTimer=true;
          const id=slot(block);
          if(!timedActions.has(id))error(block,'Define scheduled action '+id+' before scheduling it.');
          return line('sx_timer.setTimer('+timingArgument(block,'INTERVAL','long',2147483647)+', sx_action_'+id+', '+timingArgument(block,'COUNT','int',32767)+');');
        }
        case 'arduino_interrupts': return line('interrupts();');
        case 'arduino_no_interrupts': return line('noInterrupts();');
        case 'arduino_task': {
          includes.add('SCoop.h');usesTasks=true;
          const name='sx_task_'+slot(block,8),previous=inTask;inTask=true;
          let setupBody,loopBody;
          try {setupBody=body(block,'SETUP',1,0);loopBody=body(block,'LOOP',1,0);} finally {inTask=previous;}
          taskDeclarations.push('defineTask('+name+')\n');
          taskDefinitions.push('void '+name+'::setup() {\n'+setupBody+'}\n\nvoid '+name+'::loop() {\n'+loopBody+'}\n\n');return '';
        }
        case 'arduino_task_yield':
          includes.add('SCoop.h');usesTasks=true;return line(inTask ? 'yield();' : 'mySCoop.yield();');
        case 'arduino_task_sleep':
          includes.add('SCoop.h');usesTasks=true;
          if(!inTask)error(block,'Place task sleep inside a cooperative task.');
          return line('sleep('+timingArgument(block,'MS','long',2147483647)+');');
        case 'text_print': usesSerial = true; return line('Serial.println(' + value('TEXT') + ');');
        case 'arduino_serial_print': {
          usesSerial = true;
          return line('Serial.' + (field(block, 'NEWLINE', 'TRUE') === 'TRUE' ? 'println' : 'print') + '(' + value('VALUE') + ');');
        }
        case 'arduino_serial_begin': {
          const baud = Number(field(block, 'BAUD', 9600));
          if (!Number.isInteger(baud) || baud < 300 || baud > 2000000) error(block, 'Choose a baud rate between 300 and 2000000.');
          return line('Serial.begin(' + (Number.isInteger(baud) ? baud : 9600) + ');');
        }
        case 'arduino_setup': case 'arduino_loop':
          error(block, 'Place this entry block at the top level.'); return '';
        default:
          if (expressions.has(block.type)) error(block, 'Connect this value block to a statement before compiling.');
          return line('// Unsupported block: ' + String(block.type).replace(/[^a-zA-Z0-9_]/g, '_'));
      }
    }
    let setup = '', loop = '';
    for (const block of roots) {
      if (disabled(block)) { setup += chain(next(block), 1, 0); continue; }
      if (block.type === 'arduino_setup') setup += body(block, 'DO', 1, 0);
      else if (block.type === 'arduino_loop') loop += body(block, 'DO', 1, 0);
      else setup += chain(block, 1, 0);
    }
    if (!roots.length) error(null, 'Add blocks to the workspace before compiling.');
    if (usesSoftPWM) {
      setup = '  SoftPWMBegin();\n' + setup;
      for (const {block} of nodes) if (['arduino_tone','arduino_no_tone'].includes(block.type)) {
        error(block, 'Software PWM and tone controls both use Timer2 on AVR boards. Use them in separate programs.');
      }
    }
    if (usesTimer2 && usesSoftPWM) error(null,'MsTimer2 and software PWM both use Timer2 on Uno/Mega. Use one timer owner per program.');
    if (usesTimer2) for (const {block} of nodes) if (['arduino_tone','arduino_no_tone'].includes(block.type)) error(block,'MsTimer2 and tone controls both use Timer2 on Uno/Mega.');
    if (usesSimpleTimer) {
      setup+=automaticSetup.join('');loop='  sx_timer.run();\n'+loop;
    }
    if (usesTasks) {setup+='  mySCoop.start();\n';loop='  mySCoop.yield();\n'+loop;}
    let buttonGlobals = '', buttonSetup = '', buttonLoop = '';
    for (const button of buttons.values()) {
      const activeLow = button.active === 'LOW' ? 'true' : 'false';
      buttonGlobals += 'OneButton ' + button.name + '(' + button.pin + ', ' + activeLow + ', ' + activeLow + ');\n';
      for (const [event,handler] of button.events) buttonSetup += '  ' + button.name + '.' + event + '(' + handler + ');\n';
      buttonLoop += '  ' + button.name + '.tick();\n';
    }
    setup = buttonSetup + setup;
    loop = buttonLoop + loop;
    if (usesSerial && !hasSerialBegin) setup = '  Serial.begin(9600);\n' + setup;
    setup = [...pinSetups].map(([pin,mode]) => '  pinMode(' + pin + ', ' + mode + ');\n').join('') + setup;
    let globals = '', classGlobals = '';
    function staticArgument(block) {
      if (!block) return;
      const allowed = block.type === 'text' || block.type.startsWith('math_') || block.type.startsWith('logic_') ||
        ['arduino_library_constant','arduino_cpp_expression','arduino_address_of','arduino_builtin_led','arduino_pin','arduino_interrupt_pin','arduino_high_low'].includes(block.type);
      if (block.type==='arduino_sizeof') return;
      const pureNative=['arduino_bitwise','arduino_bit_not','arduino_square','arduino_min_max','arduino_remainder','arduino_map','logic_null'].includes(block.type);
      if ((!allowed && !pureNative) || ['math_random_int','math_random_float'].includes(block.type)) error(block, 'Class declaration arguments must be constant values or C++ expressions available before Setup.');
      Object.keys(block.inputs || {}).forEach(name => staticArgument(child(block,name)));
    }
    for (const value of variables.values()) {
      if (isObject(value.type)) {
        const declaration = value.declaration;
        if (!declaration) continue;
        Object.keys(declaration.source.inputs || {}).forEach(name => staticArgument(child(declaration.source,name)));
        const args = libraryArguments(declaration.source, declaration.spec);
        classGlobals += value.declaration.nativeType + ' ' + value.cpp + (args.length ? '(' + args.join(', ') + ')' : '') + ';\n';
      } else {
        globals += (interruptVariables.has(value) && ['number','boolean'].includes(value.type) ? 'volatile ' : '') + (value.declaration?.nativeType || cppType(value.type)) + ' ' + value.cpp + ' = ' + defaults[value.type] + ';\n';
      }
    }
    const modulo = nodes.some(item => item.block.type === 'math_modulo')
      ? 'static double studioxModulo(double a, double b) {\n  double r = fmod(a, b);\n  return r != 0 && ((r < 0) != (b < 0)) ? r + b : r;\n}\n\n' : '';
    let objectGlobals = '';
    for (const object of libraryObjects.values()) {
      const args = libraryArguments(object.block, object.spec);
      objectGlobals += object.spec.owner + ' ' + object.cpp + (args.length ? '(' + args.join(', ') + ')' : '') + ';\n';
    }
    const pulseHelper = usesPulseIn ? 'static unsigned long studioxPulseIn(uint8_t pin, uint8_t level, unsigned long timeout = 1000000UL) {\n  pinMode(pin, INPUT);\n  return pulseIn(pin, level, timeout);\n}\n\n' : '';
    const callbackCode = callbacks.map(handler => 'void ' + handler.name + '();\n').join('') +
      callbacks.map(handler => 'void ' + handler.name + '() {\n' + handler.code + '}\n\n').join('');
    const avrOnly = ['SoftPWM.h','PinChangeInt.h','MsTimer2.h','SCoop.h'].some(header => includes.has(header))
      ? '#if !defined(ARDUINO_ARCH_AVR)\n#error "These bundled hardware timer, software PWM, pin-change interrupt, and task blocks require a supported AVR board."\n#endif\n' : '';
    const code = '// Generated by WLKATA StudioX Arduino.\n' + avrOnly + [...includes].map(header => '#include <' + header + '>\n').join('') + '\n' + modulo + [...mathHelpers.values()].map(code=>code+'\n\n').join('') + pulseHelper +
      globals + (globals ? '\n' : '') + nativeGlobals.map(code => code + '\n').join('') + (nativeGlobals.length ? '\n' : '') + classGlobals + (classGlobals ? '\n' : '') + objectGlobals + (objectGlobals ? '\n' : '') + buttonGlobals + (buttonGlobals ? '\n' : '') + (usesSimpleTimer ? 'SimpleTimer sx_timer;\n\n' : '') + taskDeclarations.join('') + callbackCode + taskDefinitions.join('') + 'void setup() {\n' + setup + '}\n\nvoid loop() {\n' + loop + '}\n';
    return { code, diagnostics, supportedBlockTypes: supportedBlockTypes.slice() };
  }
  const api = { compile, supportedBlockTypes, cppString, nativeTypes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.StudioXArduinoCompiler = api;
})(typeof window !== 'undefined' ? window : globalThis);
