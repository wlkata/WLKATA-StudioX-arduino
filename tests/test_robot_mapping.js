const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),mapping=require('../frontend/robotMapping'),{compile}=require('../frontend/compiler');
const config=JSON.parse(fs.readFileSync(path.join(root,'mappings/robot-blocks.json')));mapping.configure(config);
let serial=0;
const number=n=>({shadow:{type:'math_number',id:'n'+serial++,fields:{NUM:n}}});
const source=(type,fields={},inputs={})=>({type,id:'source'+serial++,fields,inputs});
const robot=(type,fields={},inputs={})=>source(type,{VARIABLE:'robot',...fields},inputs);
const setup=(name='robot',model='Mirobot_UART',port='VirtualMirobot')=>source('setup_robot',{VARIABLE:{id:name,name,type:''},MODEL:model,PORT:port});
const state=(...roots)=>({variables:[{id:'robot',name:'robot',type:''}],blocks:{languageVersion:0,blocks:roots}});
function chain(...blocks){blocks.forEach((block,index)=>{if(index<blocks.length-1)block.next={block:blocks[index+1]};});return blocks[0];}
const axes=count=>Object.fromEntries(['X','Y','Z','A','B','C'].slice(0,count).map((axis,index)=>['AXIS_'+axis,number(index+1)]));
function collect(state,type){const found=[];function walk(b){if(!b)return;if(b.type===type)found.push(b);Object.values(b.inputs || {}).forEach(i=>walk(i.block || i.shadow));walk(b.next?.block);}state.blocks.blocks.forEach(walk);return found;}
const original=state(chain(setup(),robot('robot_homing'),robot('robot_zero'),robot('robot_speed',{}, {SPEED:number(55)}),robot('write_coordinate',{MOTION:'2',POSITION:'1'},axes(6)),robot('robot_wait_idle'),robot('robot_pump',{MODE:'1'}),robot('robot_gripper',{MODE:'2'}),robot('robot_three_finger',{MODE:'0'}),robot('robot_send_msg',{}, {MESSAGE:{block:{type:'text',fields:{TEXT:'G90'}}}}),source('robot_delay',{}, {TIME:number(1.5)})));
const before=JSON.stringify(original),result=mapping.transform(original);
assert.strictEqual(JSON.stringify(original),before,'source workspace stays unchanged');assert.strictEqual(result.converted.length,11);assert.deepStrictEqual(result.skipped,[]);
const generated=compile(result.state);assert.deepStrictEqual(generated.diagnostics,[]);
assert.match(generated.code,/Mirobot_UART v_robot;/);
assert.match(generated.code,/v_robot.init\(\);/);
assert.ok(!/sx_bus_|RS485AssicMaster |\.begin\(/.test(generated.code),'setup only declares and initializes the corresponding robot class');
assert.strictEqual(result.state.blocks.blocks[0].type,'variables_set');
assert.strictEqual(result.state.blocks.blocks[0].inputs.VALUE.block.type,'arduino_class');
assert.match(generated.code,/v_robot.homing\(\);\n\s*v_robot.waitIdle\(\);/);
assert.match(generated.code,/v_robot.setMotionSpeed\(\(float\)\(55\)\)/);
assert.match(generated.code,/v_robot.movePose\(\(uint8_t\)\(2\), \(bool\)\(true\), \(float\)\(1\)/);
assert.match(generated.code,/v_robot.setEndtPump\(\(uint8_t\)\(1\)\)/);
assert.match(generated.code,/v_robot.setEndtGripper\(\(uint8_t\)\(2\)\)/);
assert.match(generated.code,/v_robot.setEndtPump\(\(uint8_t\)\(0\)\)/);
assert.match(generated.code,/\\015\\012/);assert.match(generated.code,/sendMsg\(.*false/s);
assert.match(generated.code,/1.5\) \* \(1000/);
assert.ok(!/VirtualMirobot|StudioXObject|new Control/.test(generated.code));
// E4 is converted only when explicitly identified; combined E4/MT4 stays pending.
const e4=mapping.transform(state(chain(setup('robot','E4_UART'),robot('write_coordinate',{MOTION:'0',POSITION:'0'},axes(4)))));
assert.deepStrictEqual(compile(e4.state).diagnostics,[]);assert.match(compile(e4.state).code,/E4_UART v_robot/);
for(const model of ['MT4_UART','Harobot_UART','Miromax_UART']) {
 const pending=mapping.transform(state(chain(setup('robot',model),robot('robot_speed',{}, {SPEED:number(20)}))));
 assert.strictEqual(pending.skipped.length,2);assert.ok(pending.state.blocks.blocks[0].type==='setup_robot');
 assert.ok(compile(pending.state).diagnostics.some(d=>/Not mapped/.test(d.message)));
}
// A command-only paste can bind to an existing destination robot declaration.
const target=result.state;const command=mapping.transform(state(robot('robot_pump',{MODE:'2'})),target);
assert.strictEqual(command.converted.length,1);assert.deepStrictEqual(command.skipped,[]);
assert.strictEqual(command.state.blocks.blocks[0].fields.VAR.name,'robot');
const missing=mapping.transform(state(robot('robot_zero')));assert.strictEqual(missing.skipped.length,1);
// Old saved Arduino workspaces can mix native declarations with raw Robot blocks.
const savedMixed=JSON.parse(JSON.stringify(target));savedMixed.blocks.blocks.push(robot('robot_zero'));
const restoredMixed=mapping.transform(savedMixed);
assert.strictEqual(restoredMixed.converted.length,1);assert.deepStrictEqual(restoredMixed.skipped,[]);
assert.deepStrictEqual(compile(restoredMixed.state).diagnostics,[]);
// Mismatched joint/path APIs and incomplete axes are preserved, never guessed.
for(const block of [robot('write_angle',{POSITION:'0'},axes(6)),robot('robot_conveyor',{MOTION:'1',POSITION:'1'},{D:number(10)}),robot('write_coordinate',{MOTION:'0',POSITION:'0'},axes(4))]) {
 const pending=mapping.transform(state(block),target);assert.strictEqual(pending.skipped.length,1);assert.strictEqual(pending.state.blocks.blocks[0].type,block.type);
}
const emptyAxes=axes(6);emptyAxes.AXIS_Z={};
const incomplete=mapping.transform(state(robot('write_coordinate',{MOTION:'0',POSITION:'0'},emptyAxes)),target);
assert.strictEqual(incomplete.skipped.length,1,'empty axis inputs must not turn into generated zero defaults');
assert.strictEqual(incomplete.state.blocks.blocks[0].type,'write_coordinate');
const emptyDelay=mapping.transform(state(source('robot_delay',{}, {TIME:{}})));
assert.deepStrictEqual(compile(emptyDelay.state).diagnostics,[]);
// Delays work without a robot; disabled expanded homing stays fully disabled.
assert.strictEqual(mapping.transform(state(source('robot_delay',{}, {TIME:number(2)}))).state.blocks.blocks[0].type,'arduino_delay');
const home=robot('robot_homing');home.enabled=false;home.disabledReasons=['MANUALLY_DISABLED'];
const disabled=mapping.transform(state(home),target).state.blocks.blocks[0];assert.strictEqual(disabled.enabled,false);assert.strictEqual(disabled.next.block.enabled,false);
// Python function parameters must never be rebound to workspace-global robots.
const scoped=mapping.transform(state(source('procedures_defnoreturn',{}, {STACK:{block:robot('robot_zero')}})),target);
assert.strictEqual(scoped.skipped.length,1);assert.match(scoped.skipped[0].reason,/scope support/);
// Source data survives, including data that isn't JSON.
const withData=setup();withData.data='user annotation';const annotated=mapping.transform(state(withData)).state.blocks.blocks[0];
assert.strictEqual(JSON.parse(annotated.data).originalData,'user annotation');
// Each imported robot is a corresponding plain class variable with init().
const multiple=state(chain(setup('left'),setup('right'),robot('robot_zero',{VARIABLE:'right'})));multiple.variables=[{id:'left',name:'left'},{id:'right',name:'right'}];
const multi=mapping.transform(multiple);const multiCode=compile(multi.state);assert.deepStrictEqual(multiCode.diagnostics,[]);assert.match(multiCode.code,/Mirobot_UART v_left;/);assert.match(multiCode.code,/Mirobot_UART v_right;/);assert.match(multiCode.code,/v_left.init\(\)/);assert.match(multiCode.code,/v_right.init\(\)/);assert.match(multiCode.code,/v_right.zero/);
// Robot/Accessories flyouts generate native blocks using the same mapping.
const entries=[{kind:'block',type:'setup_robot'},{kind:'block',type:'robot_homing'},{kind:'block',type:'robot_speed'},{kind:'block',type:'write_coordinate'},{kind:'block',type:'write_angle'},{kind:'block',type:'robot_pump'}];
const flyout=mapping.flyout(entries);
assert.deepStrictEqual(flyout.map(entry=>entry.type || entry.kind),['variables_set','arduino_instance_call','arduino_instance_call','arduino_instance_call','label','arduino_instance_call']);
assert.strictEqual(flyout[0].next.block.extraState.signature.name,'init');
assert.strictEqual(flyout[1].next.block.extraState.signature.name,'waitIdle');
const e4Flyout=mapping.flyout([{kind:'block',type:'write_coordinate'}],e4.state);
assert.strictEqual(e4Flyout[0].extraState.signature.owner,'E4_UART');
assert.strictEqual(Object.keys(e4Flyout[0].inputs).length,6,'fresh E4 toolbox template has path, mode and four axes');
const legacy=mapping.transform(state({type:'arduino_robot_setup',fields:{VAR:{id:'robot'},MODEL:'Mirobot_UART',UART:'Serial1'}}));
assert.strictEqual(legacy.state.blocks.blocks[0].type,'variables_set');
assert.deepStrictEqual(compile(legacy.state).diagnostics,[]);
if(process.argv[2] && !process.argv[2].startsWith('--'))fs.writeFileSync(process.argv[2],generated.code);
console.log('Robot mapping passed: all reviewed operations, plain class initialization, native toolbox entries, model/axis guards, G05 path, homing wait, units, terminators, accessories, selected pastes, disabled/scope preservation, multiple robots, and pending mappings.');
