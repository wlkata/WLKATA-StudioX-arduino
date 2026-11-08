const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),arg=process.argv.indexOf('--studiox-root'),host=arg<0?path.resolve(root,'../blockly'):process.argv[arg+1];
const Blockly=require(path.join(host,'node_modules/blockly'));require(path.join(host,'node_modules/blockly/blocks'));
Blockly.defineBlocksWithJsonArray(JSON.parse(fs.readFileSync(path.join(root,'blocks/blocks.json'))));
const context={Blockly,StudioXArduinoCppTypes:require('../frontend/cppTypes')};vm.runInNewContext(fs.readFileSync(path.join(root,'frontend/libraryBlocks.js'),'utf8'),context);
const mapping=require('../frontend/robotMapping');mapping.configure(JSON.parse(fs.readFileSync(path.join(root,'mappings/robot-blocks.json'))));const {compile}=require('../frontend/compiler');
const original={variables:[{id:'arm',name:'robot',type:''}],blocks:{languageVersion:0,blocks:[{type:'setup_robot',id:'setup',fields:{VARIABLE:{id:'arm'},MODEL:'Mirobot_UART',PORT:'COM9'},next:{block:{type:'robot_homing',id:'home',fields:{VARIABLE:'robot'},next:{block:{type:'robot_pump',id:'pump',fields:{VARIABLE:'robot',MODE:'1'}}}}}}]}};
const result=mapping.transform(original);
const workspace=new Blockly.Workspace();Blockly.serialization.workspaces.load(result.state,workspace);context.StudioXArduinoLibraryBlocks.observeWorkspace(workspace);
assert.strictEqual(workspace.getBlocksByType('arduino_class').length,1);assert.strictEqual(workspace.getBlocksByType('arduino_instance_call').length,4);
let generated=compile(Blockly.serialization.workspaces.save(workspace));assert.deepStrictEqual(generated.diagnostics,[]);assert.match(generated.code,/v_robot.homing\(\);\n\s*v_robot.waitIdle\(\)/);
const saved=Blockly.serialization.workspaces.save(workspace),copy=new Blockly.Workspace();Blockly.serialization.workspaces.load(saved,copy);context.StudioXArduinoLibraryBlocks.observeWorkspace(copy);
assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(copy)).diagnostics,[]);
const xml=new Blockly.Workspace();Blockly.Xml.domToWorkspace(Blockly.Xml.workspaceToDom(workspace),xml);context.StudioXArduinoLibraryBlocks.observeWorkspace(xml);
assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(xml)).diagnostics,[]);
assert.strictEqual(JSON.parse(xml.getBlocksByType('variables_set')[0].data).studioxRobotSetup.sourcePort,'COM9');
workspace.getVariableMap().renameVariable(workspace.getVariableMap().getVariableById('arm'),'arm');generated=compile(Blockly.serialization.workspaces.save(workspace));assert.match(generated.code,/Mirobot_UART v_arm/);assert.match(generated.code,/v_arm.setEndtPump/);
// Explicitly changing the declared class keeps matching method names.
const classBlock=workspace.getBlocksByType('arduino_class')[0];
classBlock.setFieldValue(classBlock.libraryOptions_.find(spec=>spec.owner==='E4_UART').id,'FUNC_NAME');
context.StudioXArduinoLibraryBlocks.refreshMethods(workspace);
assert.deepStrictEqual(workspace.getBlocksByType('arduino_instance_call').map(block=>block.saveExtraState().signature.name),['init','homing','waitIdle','setEndtPump']);
assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(workspace)).diagnostics,[]);
assert.match(compile(Blockly.serialization.workspaces.save(workspace)).code,/E4_UART v_arm/);
for(const ws of [workspace,copy,xml])ws.dispose();
// Joint mapping survives real Blockly JSON/XML restoration and variable rename.
for(const [model,count] of [['Mirobot_UART',6],['E4_UART',4]]) {
 const axes=Object.fromEntries(['X','Y','Z','A','B','C'].slice(0,count).map((axis,index)=>['AXIS_'+axis,{shadow:{type:'math_number',fields:{NUM:index+1}}}]));
 const source={variables:[{id:'joints',name:'jointRobot',type:''}],blocks:{languageVersion:0,blocks:[{type:'setup_robot',fields:{VARIABLE:{id:'joints'},MODEL:model},next:{block:{type:'write_angle',fields:{VARIABLE:'jointRobot',POSITION:'1'},inputs:axes}}}]}};
 const ws=new Blockly.Workspace();Blockly.serialization.workspaces.load(mapping.transform(source).state,ws);context.StudioXArduinoLibraryBlocks.observeWorkspace(ws);
 assert.strictEqual(ws.getBlocksByType('write_angle').length,0);
 const joint=ws.getBlocksByType('arduino_instance_call').find(block=>block.saveExtraState().signature.name==='moveJoints');
 assert.strictEqual(joint.saveExtraState().signature.owner,model);
 assert.strictEqual(joint.inputList.filter(input=>input.name.startsWith('ARG_')).length,count+1);
 for(const format of ['json','xml']) {
  const restored=new Blockly.Workspace();
  if(format==='json')Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(ws),restored);
  else Blockly.Xml.domToWorkspace(Blockly.Xml.workspaceToDom(ws),restored);
  context.StudioXArduinoLibraryBlocks.observeWorkspace(restored);
  restored.getVariableMap().renameVariable(restored.getVariableMap().getVariableById('joints'),'renamedJointRobot');
  const result=compile(Blockly.serialization.workspaces.save(restored));assert.deepStrictEqual(result.diagnostics,[]);
  assert.match(result.code,/v_renamedJointRobot.moveJoints\(\(bool\)\(true\)/);
  restored.dispose();
 }
 ws.dispose();
}
console.log('Mapped Blockly blocks passed: native definitions, JSON/XML restoration, offline method menus, source port annotation, homing pair, and rename-linked code.');
