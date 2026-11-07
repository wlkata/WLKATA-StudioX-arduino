/* Plain declarations must support classes without default/copy constructors. */
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process');
const {compile}=require('../frontend/compiler');
let id=0;const number=value=>({type:'math_number',id:'n'+id++,fields:{NUM:value}});
const ctor={id:'ctor',header:'Counter.h',library:'Test',owner:'Counter',qualifiedName:'Counter',name:'Counter',constructor:true,returnKind:'void',supported:true,parameters:[{name:'value',type:'int',kind:'number'}]};
const verify={...ctor,id:'verify',constructor:false,qualifiedName:'Counter::verify',name:'verify'};
const instance={type:'arduino_class',id:'class',extraState:{signature:ctor},inputs:{ARG_0:{block:number(7)}}};
const setter={type:'variables_set',id:'declare',fields:{VAR:{id:'counter'}},inputs:{VALUE:{block:instance}}};
const call={type:'arduino_instance_call',id:'call',fields:{VAR:{id:'counter'}},extraState:{signature:verify,statement:true},inputs:{ARG_0:{block:number(7)}}};
setter.next={block:call};
const native={type:'arduino_cpp_declaration',id:'native',fields:{CODE:`
int objectCreated=0;
class Counter {
  int value_;
public:
  Counter() = delete;
  Counter(const Counter&) = delete;
  Counter& operator=(const Counter&) = delete;
  explicit Counter(int value) : value_(value) { ++objectCreated; }
  void verify(int expected) { assert(value_ == expected); }
};`}};
const state={variables:[{id:'counter',name:'counter'}],blocks:{languageVersion:0,blocks:[native,{type:'arduino_setup',id:'setup',inputs:{DO:{block:setter}}},{type:'arduino_loop',id:'loop',inputs:{DO:{block:JSON.parse(JSON.stringify(call))}}}]}};
state.blocks.blocks[2].inputs.DO.block.id='loopcall';
const output=compile(state);assert.deepStrictEqual(output.diagnostics,[]);
assert.match(output.code,/Counter v_counter\(\(int\)\(7\)\);/);
assert.match(output.code,/v_counter.verify\(\(int\)\(7\)\);/);
assert.ok(!/StudioXObject|new Control|references|\.get\(\)/.test(output.code));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studiox-declarations-'));
try {
 const source='#include <cassert>\n'+output.code.replace(/^#include.*$/gm,'')+'\nint main(){setup();loop();loop();assert(objectCreated==1);}\n';
 fs.writeFileSync(path.join(temp,'program.cpp'),source);
 execFileSync('c++',['-std=c++11','-Wall','-Wextra',path.join(temp,'program.cpp'),'-o',path.join(temp,'program')],{stdio:'pipe'});
 execFileSync(path.join(temp,'program'),[],{stdio:'pipe'});
} finally {fs.rmSync(temp,{recursive:true,force:true});}
const duplicate=JSON.parse(JSON.stringify(state));duplicate.blocks.blocks.push(JSON.parse(JSON.stringify(setter)));
assert.ok(compile(duplicate).diagnostics.some(d=>/Declare each variable only once/.test(d.message)));
const loopDecl=JSON.parse(JSON.stringify(state));loopDecl.blocks.blocks[1].inputs.DO.block=call;loopDecl.blocks.blocks[2].inputs.DO.block=setter;
assert.ok(compile(loopDecl).diagnostics.some(d=>/directly inside Setup/.test(d.message)));
const runtimeArg=JSON.parse(JSON.stringify(state));runtimeArg.blocks.blocks[1].inputs.DO.block.inputs.VALUE.block.inputs.ARG_0.block={type:'arduino_millis',id:'runtime'};
assert.ok(compile(runtimeArg).diagnostics.some(d=>/constant values/.test(d.message)));
console.log('Plain class declarations passed: native globals, constructor arguments, no default/copy constructor, direct methods, one initialization, duplicate/loop declarations, and runtime argument diagnostics.');
