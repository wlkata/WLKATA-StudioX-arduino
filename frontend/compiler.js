/* Blockly JSON -> a conservative Arduino C++ subset. No workspace mutation. */
(function (root) {
  'use strict';
  const expressions = new Set([
    'math_number', 'math_arithmetic', 'math_single', 'math_round', 'math_modulo', 'math_constant',
    'logic_boolean', 'logic_compare', 'logic_operation', 'logic_negate', 'logic_ternary',
    'variables_get', 'text', 'text_join', 'text_length', 'text_isEmpty',
    'arduino_digital_read', 'arduino_analog_read', 'arduino_millis', 'arduino_builtin_led', 'arduino_pin', 'arduino_high_low', 'arduino_cpp_expression',
  ]);
  const statements = new Set([
    'variables_set', 'math_change', 'text_append', 'text_print', 'controls_if',
    'controls_repeat_ext', 'controls_repeat', 'controls_whileUntil', 'controls_for', 'controls_flow_statements',
    'arduino_setup', 'arduino_loop', 'arduino_pin_mode', 'arduino_digital_write',
    'arduino_include', 'arduino_cpp_declaration', 'arduino_cpp_statement', 'arduino_analog_write', 'arduino_digital_write_value', 'arduino_tone', 'arduino_no_tone', 'arduino_delay', 'arduino_serial_print', 'arduino_serial_begin',
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
    for (const byte of new TextEncoder().encode(String(value))) {
      if (byte === 34 || byte === 92) out += '\\' + String.fromCharCode(byte);
      else if (byte >= 32 && byte <= 126) out += String.fromCharCode(byte);
      else out += '\\' + byte.toString(8).padStart(3, '0');
    }
    return out + '"';
  }

  function compile(snapshot) {
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
    const nativeGlobals = [];
    function error(block, message) {
      const key = (block && block.id || '') + ':' + message;
      if (!diagnosticKeys.has(key)) {
        diagnosticKeys.add(key);
        diagnostics.push({ blockId: block && block.id || '', type: block && block.type || '', message, severity: 'error' });
      }
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
    for (const { block } of nodes) if (['variables_get', 'variables_set', 'math_change', 'text_append', 'controls_for'].includes(block.type)) variable(block);
    function infer(block) {
      if (!block || disabled(block)) return null;
      if (block.type === 'variables_get') return variable(block).type;
      if (block.type === 'arduino_cpp_expression') return types[field(block, 'RETURN_TYPE')] ? field(block, 'RETURN_TYPE') : 'number';
      if (block.type === 'logic_ternary') return infer(child(block, 'THEN')) || infer(child(block, 'ELSE'));
      if (['logic_boolean', 'logic_compare', 'logic_operation', 'logic_negate', 'text_isEmpty', 'arduino_digital_read', 'arduino_high_low'].includes(block.type)) return 'boolean';
      if (['text', 'text_join'].includes(block.type)) return 'text';
      return expressions.has(block.type) ? 'number' : null;
    }
    for (let pass = 0; pass <= variables.size; pass++) {
      let changed = false;
      for (const { block } of nodes) {
        let kind;
        if (block.type === 'variables_set') kind = infer(child(block, 'VALUE'));
        else if (block.type === 'math_change' || block.type === 'controls_for') kind = 'number';
        else if (block.type === 'text_append') kind = 'text';
        else continue;
        const entry = variable(block);
        if (kind && !entry.type) { entry.type = kind; changed = true; }
        else if (kind && entry.type !== kind) error(block, 'Variable "' + entry.display + '" changes type. Arduino variables must keep one type.');
      }
      if (!changed) break;
    }
    for (const value of variables.values()) if (!value.type) value.type = 'number';
    for (const { block, parent } of nodes) {
      if (!expressions.has(block.type) && !statements.has(block.type)) {
        error(block, 'Unsupported Arduino block: ' + block.type + '. Robot, Python, lists, and Blockly functions are not supported in this version.');
      }
      if ((block.type === 'arduino_setup' || block.type === 'arduino_loop') && parent) {
        error(block, 'Place Arduino setup and loop blocks at the top level.');
      }
      if (block.type === 'arduino_serial_begin') hasSerialBegin = true;
      if (['arduino_include', 'arduino_cpp_declaration'].includes(block.type) && parent) error(block, 'Place library includes and C++ declarations at the top level.');
      if (block.type === 'arduino_include') {
        const header = String(field(block, 'HEADER', '')).trim();
        if (!/^[A-Za-z0-9_][A-Za-z0-9_./+-]*$/.test(header) || header.length > 200 || header.split('/').some(part => ['', '.', '..'].includes(part))) {
          error(block, 'Enter a header name such as Servo.h without quotes, angle brackets, or parent paths.');
        } else includes.add(header);
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
      if (expected && value.type !== expected) error(nested, input + ' needs ' + expected + ', but this value is ' + value.type + '.');
      return value;
    }
    function expr(block) {
      const number = code => ({ code, type: 'number' });
      const boolean = code => ({ code, type: 'boolean' });
      const text = code => ({ code, type: 'text' });
      const n = input => exprInput(block, input, 'number').code;
      const b = input => exprInput(block, input, 'boolean').code;
      switch (block.type) {
        case 'math_number': {
          const value = Number(field(block, 'NUM', 0));
          if (!Number.isFinite(value)) { error(block, 'Arduino numbers must be finite.'); return number('0'); }
          return number(String(value));
        }
        case 'logic_boolean': return boolean(field(block, 'BOOL', 'TRUE') === 'TRUE' ? 'true' : 'false');
        case 'variables_get': { const value = variable(block); return { code: value.cpp, type: value.type }; }
        case 'text': return text('String(' + cppString(field(block, 'TEXT', '')) + ')');
        case 'math_arithmetic': {
          const a = n('A'), c = n('B');
          const op = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/' }[field(block, 'OP')];
          if (field(block, 'OP') === 'POWER') return number('pow(' + a + ', ' + c + ')');
          if (!op) error(block, 'Unsupported arithmetic operation.');
          return number('((double)(' + a + ') ' + (op || '+') + ' (' + c + '))');
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
          if (a.type !== c.type) error(block, 'Compare values of the same type.');
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
          if (a.type !== c.type) error(block, 'Both ternary results must have the same type.');
          return { code: '(' + condition + ' ? ' + a.code + ' : ' + c.code + ')', type: a.type };
        }
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
        case 'arduino_millis': return number('millis()');
        case 'arduino_builtin_led': return number('LED_BUILTIN');
        case 'arduino_cpp_expression': {
          const type = field(block, 'RETURN_TYPE');
          if (!types[type]) error(block, 'Choose a C++ expression return type.');
          const code = nativeCode(block) || '0';
          return { code: type === 'text' ? 'String(' + code + ')' : '(' + code + ')', type: types[type] ? type : 'number' };
        }

        case 'arduino_pin': {
          const pin = String(field(block, 'PIN', '')).trim();
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
    const indent = depth => '  '.repeat(depth);
    function body(block, input, depth, loopDepth) { return chain(child(block, input), depth, loopDepth); }
    function chain(first, depth, loopDepth) {
      let code = '';
      for (let block = first; block; block = next(block)) {
        if (!disabled(block)) code += statement(block, depth, loopDepth);
      }
      return code;
    }
    function statement(block, depth, loopDepth) {
      const pad = indent(depth);
      const line = value => pad + value + '\n';
      const value = (input, expected, fallback) => exprInput(block, input, expected, fallback).code;
      const variableEntry = () => variable(block);
      switch (block.type) {
        case 'variables_set': {
          const target = variableEntry(), source = exprInput(block, 'VALUE');
          if (target.type !== source.type) error(block, 'Variable "' + target.display + '" must keep type ' + target.type + '.');
          return line(target.cpp + ' = ' + source.code + ';');
        }
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
            code += line((index ? 'else if' : 'if') + ' (' + value('IF' + index, 'boolean') + ') {') + body(block, 'DO' + index, depth + 1, loopDepth) + line('}');
            index++;
          }
          if (!index) error(block, 'An if block needs a condition.');
          if (block.inputs && block.inputs.ELSE) code += line('else {') + body(block, 'ELSE', depth + 1, loopDepth) + line('}');
          return code;
        }
        case 'controls_repeat_ext':
        case 'controls_repeat': {
          const count = block.type === 'controls_repeat' ? String(Number(field(block, 'TIMES', 0))) : value('TIMES', 'number');
          const id = ++sequence;
          return line('for (long sx_i_' + id + ' = 0, sx_n_' + id + ' = (long)(' + count + '); sx_i_' + id + ' < sx_n_' + id + '; ++sx_i_' + id + ') {') +
            body(block, 'DO', depth + 1, loopDepth + 1) + line('}');
        }
        case 'controls_whileUntil': {
          const condition = value('BOOL', 'boolean');
          const mode = field(block, 'MODE', 'WHILE');
          if (!['WHILE', 'UNTIL'].includes(mode)) error(block, 'Unsupported while/until mode.');
          return line('while (' + (mode === 'UNTIL' ? '!(' + condition + ')' : condition) + ') {') + body(block, 'DO', depth + 1, loopDepth + 1) + line('}');
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
            body(block, 'DO', depth + 2, loopDepth + 1) + indent(depth + 1) + '}\n' + line('}');
        }
        case 'controls_flow_statements': {
          const flow = field(block, 'FLOW');
          if (!loopDepth) error(block, 'Break and continue must be inside a loop.');
          if (!['BREAK', 'CONTINUE'].includes(flow)) error(block, 'Unsupported loop flow.');
          return line(flow === 'CONTINUE' ? 'continue;' : 'break;');
        }
        case 'arduino_pin_mode': {
          const mode = field(block, 'MODE');
          if (!['INPUT', 'OUTPUT', 'INPUT_PULLUP'].includes(mode)) error(block, 'Choose a valid pin mode.');
          return line('pinMode((uint8_t)(' + value('PIN', 'number') + '), ' + (['INPUT','OUTPUT','INPUT_PULLUP'].includes(mode) ? mode : 'INPUT') + ');');
        }
        case 'arduino_digital_write': {
          const level = field(block, 'LEVEL');
          if (!['HIGH', 'LOW'].includes(level)) error(block, 'Choose HIGH or LOW.');
          return line('digitalWrite((uint8_t)(' + value('PIN', 'number') + '), ' + (level === 'HIGH' ? 'HIGH' : 'LOW') + ');');
        }
        case 'arduino_include': case 'arduino_cpp_declaration': return '';
        case 'arduino_cpp_statement': return nativeCode(block).split('\n').map(code => line(code)).join('');
        case 'arduino_digital_write_value':
          return line('digitalWrite((uint8_t)(' + value('PIN', 'number') + '), (' + value('STATE', 'boolean') + ') ? HIGH : LOW);');
        case 'arduino_tone':
          return line('tone((uint8_t)(' + value('PIN', 'number') + '), (unsigned int)constrain(' + value('FREQUENCY', 'number') + ', 0, 65535), (unsigned long)max(0.0, (double)(' + value('DURATION', 'number') + ')));');
        case 'arduino_no_tone': return line('noTone((uint8_t)(' + value('PIN', 'number') + '));');
        case 'arduino_analog_write': return line('analogWrite((uint8_t)(' + value('PIN', 'number') + '), (int)constrain(' + value('VALUE', 'number') + ', 0, 255));');
        case 'arduino_delay': return line('delay((unsigned long)max(0.0, (double)(' + value('MS', 'number') + ')));');
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
    if (usesSerial && !hasSerialBegin) setup = '  Serial.begin(9600);\n' + setup;
    let globals = '';
    for (const value of variables.values()) globals += types[value.type] + ' ' + value.cpp + ' = ' + defaults[value.type] + ';\n';
    const modulo = nodes.some(item => item.block.type === 'math_modulo')
      ? 'static double studioxModulo(double a, double b) {\n  double r = fmod(a, b);\n  return r != 0 && ((r < 0) != (b < 0)) ? r + b : r;\n}\n\n' : '';
    const code = '// Generated by WLKATA StudioX Arduino.\n' + [...includes].map(header => '#include <' + header + '>\n').join('') + '\n' + modulo +
      nativeGlobals.map(code => code + '\n').join('') + (nativeGlobals.length ? '\n' : '') + globals + (globals ? '\n' : '') + 'void setup() {\n' + setup + '}\n\nvoid loop() {\n' + loop + '}\n';
    return { code, diagnostics, supportedBlockTypes: supportedBlockTypes.slice() };
  }
  const api = { compile, supportedBlockTypes, cppString };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.StudioXArduinoCompiler = api;
})(typeof window !== 'undefined' ? window : globalThis);
