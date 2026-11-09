/* Check printed bytes with a real C++ compiler, not only generated spelling. */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync} = require('child_process');
const {compile, cppString} = require('../frontend/compiler');
const {build} = require('../frontend/toolbox');
const cppTypes = require('../frontend/cppTypes');
let id = 0;
const block = (type, fields = {}, inputs = {}, extraState) => ({type,id:'escapes-' + id++,fields,
  inputs:Object.fromEntries(Object.entries(inputs).map(([name, block]) => [name,{block}])),
  ...(extraState ? {extraState} : {})});
const text = value => block('text', {TEXT:value});
const print = value => block('arduino_serial_print', {NEWLINE:'FALSE'}, {VALUE:value});
const cases = [
  [String.raw`left\tright`, 'left\tright'],
  [String.raw`line1\nline2\r`, 'line1\nline2\r'],
  [String.raw`literal\\t`, String.raw`literal\t`],
  [String.raw`C:\\temp\\file.txt`, String.raw`C:\temp\file.txt`],
  [String.raw`\q\x41`, String.raw`\q\x41`],
  [String.raw`\"hello\" it\'s`, '"hello" it\'s'],
  ['trailing\\', 'trailing\\'],
  ['actual\t\ncharacters', 'actual\t\ncharacters'],
  [String.raw`\a\b\f\v`, '\x07\b\f\v'],
  [String.raw`中文\t🙂`, '中文\t🙂'],
  [String.raw`"); Serial.print("oops"); //\n`, '"); Serial.print("oops"); //\n'],
  [String.raw`before\0after`, 'before']
];
let expected = '';
const statements = cases.map(([input, output], index) => {
  if (index % 2) { expected += output + '\n'; return block('text_print', {}, {TEXT:text(input)}); }
  expected += output;
  return print(text(input));
});
const joined = block('text_join', {}, {ADD0:text(String.raw`join\t`),ADD1:text(String.raw`end\n`)}, {itemCount:2});
statements.push(print(joined)); expected += 'join\tend\n';
statements.push(block('variables_set',{VAR:{id:'message'}},{VALUE:text(String.raw`stored\t`)}));
statements.push(block('text_append',{VAR:{id:'message'}},{TEXT:text(String.raw`\nappended`)}));
statements.push(print(block('variables_get',{VAR:{id:'message'}}))); expected += 'stored\t\nappended';
for (const [name, type] of [['capture','const char *'],['captureString','String']]) {
  const spec = {header:'StringFixture.h',library:'Test',qualifiedName:name,name,owner:'',constructor:false,
    parameters:[{name:'text',type,kind:'text'}],returnType:'void',returnKind:'void',supported:true};
  statements.push(block('arduino_library_call',{}, {ARG_0:text(String.raw`library\tvalue\n`)},{signature:spec}));
  expected += 'library\tvalue\n';
}
for (let i = 0; i < statements.length - 1; i++) statements[i].next = {block:statements[i + 1]};
const state = {variables:[{id:'message',name:'message'}],blocks:{blocks:[block('arduino_setup',{}, {DO:statements[0]}),block('arduino_loop')]}};
const original = JSON.stringify(state), result = compile(state);
assert.deepStrictEqual(result.diagnostics, []);
assert.strictEqual(JSON.stringify(state), original, 'escape decoding must not alter workspace data');
assert.ok(result.code.includes(String.raw`String("left\tright")`));
assert.ok(result.code.includes(String.raw`String("literal\\t")`));
assert.strictEqual(cppString('\\t'), '"\\\\t"', 'the low-level encoder still quotes literal values');
assert.strictEqual(cppString('\t'), '"\\t"');
assert.strictEqual(cppString('\0' + '7'), '"\\0007"', 'NUL uses three octal digits to avoid consuming following digits');
assert.strictEqual(cppTypes.textField(String.raw`\t`), String.raw`\\t`);
assert.strictEqual(cppTypes.textField('\t'), String.raw`\t`);
const source = {kind:'categoryToolbox',contents:[{kind:'category',name:'Text',contents:[{kind:'block',type:'text'}]}]};
const sourceBefore = JSON.stringify(source);
assert.match(build(source).contents.find(item=>item.name==='Text').contents[0].text, /Escapes/);
assert.strictEqual(JSON.stringify(source),sourceBefore,'Arduino hints do not modify the shared Python toolbox');

const folder = fs.mkdtempSync(path.join(os.tmpdir(),'studiox-text-escapes-'));
try {
  fs.writeFileSync(path.join(folder,'Arduino.h'), `#pragma once
#include <string>
class String {
public:
  std::string value;
  String(const char *s=""):value(s){}
  String(const std::string &s):value(s){}
  String operator+(const String &s)const{return String(value+s.value);}
  String &operator+=(const String &s){value+=s.value;return *this;}
};
struct SerialClass {
  std::string output;
  void begin(int){}
  void print(const String &s){output+=s.value;}
  void print(const char *s){output+=s;}
  void println(const String &s){print(s);output+='\\n';}
};
extern SerialClass Serial;
`);
  fs.writeFileSync(path.join(folder,'StringFixture.h'), '#pragma once\ninline void capture(const char *s){Serial.print(s);}\ninline void captureString(String s){Serial.print(s);}\n');
  const file = path.join(folder,'program.cpp'), binary = path.join(folder,'program');
  fs.writeFileSync(file,'#include <cstdio>\n' + result.code + '\nSerialClass Serial;\nint main(){setup();for(unsigned char c:Serial.output)std::printf("%02x",c);}\n');
  execFileSync('c++',['-std=c++11','-I',folder,file,'-o',binary],{stdio:'pipe'});
  const bytes = execFileSync(binary,[],{encoding:'utf8'});
  assert.strictEqual(bytes,Buffer.from(expected,'utf8').toString('hex'));
} finally {fs.rmSync(folder,{recursive:true,force:true});}
console.log('Text escapes passed: actual printed bytes, Print/Serial print, joins, variables, char*/String arguments, literal and unknown backslashes, Unicode, quote injection, NUL boundaries, and workspace/toolbox preservation.');
