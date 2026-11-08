/* Explicit StudioX block -> WLKATA Arduino API conversion, without executing code. */
(function (root) {
  const clone = value => JSON.parse(JSON.stringify(value));
  let config;
  function configure(value) {
    if (!value || value.schemaVersion !== 1 || !value.models || !value.rules) throw new Error('Unsupported robot mapping file.');
    config = clone(value);
  }
  function transform(source, destination = {}) {
    if (!config) throw new Error('Arduino robot mappings are not loaded.');
    const state = clone(source || {}), variables = state.variables || (state.variables = []);
    const target = destination.state || destination;
    const models = new Map(), conflicts = new Set(), converted = [], skipped = [];
    const robotTypes = new Set([...Object.keys(config.rules),'arduino_robot_setup']);
    const inactive = block => block.enabled === false || block.disabledReasons?.length > 0;
    const normalize = model => ({Mirobot:'Mirobot_UART',E4:'E4_UART',MT4:'MT4_UART'}[model] || model);
    function nameOf(value, list = variables) {
      if (value && typeof value === 'object') return list.find(v=>v.id===value.id)?.name || value.name;
      return list.find(v=>v.id===value)?.name || value;
    }
    function variable(name) {
      let found = variables.find(v=>v.name===name && !v.type);
      if (!found) {
        const existing = (target.variables || []).find(v=>v.name===name && !v.type);
        let id = existing?.id || 'arduino-map:' + name;
        while (variables.some(v=>v.id===id)) id += '_';
        found = {id,name,type:''};variables.push(found);
      }
      return {id:found.id,name:found.name,type:found.type || ''};
    }
    function walk(block, callback, scope = false, disabled = false) {
      if (!block) return;
      const nested = scope || /^procedures_def|^workflow_/.test(block.type);
      callback(block,nested,disabled || inactive(block));
      Object.values(block.inputs || {}).forEach(input=>{if(input.block)walk(input.block,callback,nested,disabled || inactive(block));});
      if (block.next?.block) walk(block.next.block,callback,scope,disabled);
    }
    // A destination declaration lets a selected Python command be pasted alone.
    for (const context of [target,state]) for (const block of context.blocks?.blocks || []) walk(block,(block,scope,disabled)=>{
      if (scope || disabled) return;
      let model;
      if (block.type === 'arduino_robot_setup') model=block.fields?.MODEL;
      else if (block.type === 'arduino_library_object') model=block.extraState?.signature?.owner;
      else if (block.type === 'variables_set') model=block.inputs?.VALUE?.block?.extraState?.signature?.constructor === true ? block.inputs.VALUE.block.extraState.signature.owner : null;
      if (model && config.models[model]) models.set(nameOf(block.fields?.VAR,context.variables || []),model);
    });
    const sourceModels = new Map();
    for (const block of state.blocks?.blocks || []) walk(block,(block,scope,disabled)=>{
      if (!['setup_robot','arduino_robot_setup'].includes(block.type) || scope || disabled) return;
      const name=nameOf(block.fields?.VARIABLE ?? block.fields?.VAR),model=normalize(block.fields?.MODEL);
      if (sourceModels.has(name) && sourceModels.get(name)!==model) conflicts.add(name);
      sourceModels.set(name,model);models.set(name,model);
    });
    function metadata(block,issue) {
      let data;
      try { data=JSON.parse(block.data); } catch (_) {}
      if (!data || typeof data!=='object' || Array.isArray(data)) data=block.data === undefined ? {} : {originalData:block.data};
      data.studioxArduinoMapping={sourceType:block.type,issue};
      block.data=JSON.stringify(data);
      skipped.push({type:block.type,id:block.id || '',reason:issue});
      return block;
    }
    function modelFor(block) {
      const name=nameOf(block.fields?.VARIABLE ?? block.fields?.VAR);
      if (!name || conflicts.has(name)) throw new Error('Robot variable has no unique setup/model.');
      const owner=models.get(name);
      if (!config.models[owner]) throw new Error(config.unmappedModels[owner] || 'Paste its setup too, or declare this robot variable as a verified Arduino class first.');
      return {name,owner,model:config.models[owner]};
    }
    const number = value => ({shadow:{type:'math_number',fields:{NUM:value}}});
    const boolean = value => ({shadow:{type:'logic_boolean',fields:{BOOL:value ? 'TRUE':'FALSE'}}});
    const text = value => ({shadow:{type:'text',fields:{TEXT:value}}});
    function input(block,name,fallback) { const value=block.inputs?.[name]; return value && (value.block || value.shadow) ? value : fallback; }
    function code(block,name,allowed) {
      const value=String(block.fields?.[name] ?? '');
      if (!allowed.includes(value)) throw new Error('Unrecognized ' + name + ' value; original block preserved.');
      return Number(value);
    }
    function apiCall(context,name,args = [],optional = false) {
      const signature=context.model.functions.find(f=>f.name===name && f.constructor!==true);
      if (!signature) throw new Error('No reviewed signature for ' + name + '.');
      return {type:'arduino_instance_call',fields:{VAR:variable(context.name)},
        extraState:{signature,options:context.model.functions.filter(f=>f.constructor!==true && !f.static),statement:true,optional},
        inputs:Object.fromEntries(args.map((argument,index)=>['ARG_'+index,argument]))};
    }
    function preserve(block,replacement) {
      for (const key of ['id','x','y','enabled','disabledReasons','collapsed','comment','icons','data']) if (block[key]!==undefined) replacement[key]=block[key];
      return replacement;
    }
    function convert(block,scope = false) {
      if (!block) return block;
      const originalType=block.type;
      const nested=scope || /^procedures_def|^workflow_/.test(block.type);
      for (const [name,input] of Object.entries(block.inputs || {})) {
        // The obsolete homing decoration never had standalone Python output.
        if (block.type==='robot_homing' && name==='WAIT' && input.block?.type==='robot_homing_wait' && !input.block.next) continue;
        if (input.block) input.block=convert(input.block,nested);
        if (input.shadow) input.shadow=convert(input.shadow,nested);
      }
      const following=block.next?.block ? convert(block.next.block,scope) : null;
      if (following) block.next={block:following};
      if (!robotTypes.has(originalType)) return block;
      const rule=config.rules[originalType==='arduino_robot_setup' ? 'setup_robot' : originalType];
      if (nested) return metadata(block,'Robot mapping inside Python functions/workflows needs explicit scope support.');
      if (rule.status!=='mapped') return metadata(block,rule.note || 'Mapping awaits confirmation.');
      try {
        let replacement;
        if (originalType==='robot_delay') {
          replacement={type:'arduino_delay',inputs:{MS:{block:{type:'math_arithmetic',fields:{OP:'MULTIPLY'},inputs:{A:input(block,'TIME',number(1)),B:number(1000)}}}}};
        } else {
          const context=modelFor(block);
          if (originalType==='setup_robot' || originalType==='arduino_robot_setup') {
            const signature=context.model.functions.find(f=>f.constructor===true);
            if (!signature) throw new Error('No reviewed constructor for ' + context.owner + '.');
            replacement={type:'variables_set',fields:{VAR:variable(context.name)},inputs:{VALUE:{block:{type:'arduino_class',
              extraState:{signature,options:Object.values(config.models).flatMap(model=>model.functions.filter(f=>f.constructor===true)),
                methods:Object.values(config.models).flatMap(model=>model.functions.filter(f=>f.constructor!==true))}}}},
              next:{block:originalType==='arduino_robot_setup' && block.inputs?.ADDRESS ? apiCall(context,'init',[block.inputs.ADDRESS],true) : apiCall(context,'init')}};
          } else if (originalType==='write_coordinate' || originalType==='write_angle') {
            const keys=context.model.axes;
            if (keys.some(key=>!block.inputs?.['AXIS_'+key] || !(block.inputs['AXIS_'+key].block || block.inputs['AXIS_'+key].shadow)) || Object.keys(block.inputs || {}).some(key=>key.startsWith('AXIS_')&&!keys.includes(key.slice(5)))) throw new Error('Axis inputs do not match the robot class; no axes were discarded or filled in.');
            const args=[boolean(code(block,'POSITION',['0','1'])===1),...keys.map(key=>block.inputs['AXIS_'+key])];
            replacement=originalType==='write_angle' ? apiCall(context,'moveJoints',args) : apiCall(context,'movePose',[number(code(block,'MOTION',['0','1','2'])),...args]);
          } else if (originalType==='robot_homing') {
            const wait=block.inputs?.WAIT?.block;
            if (wait && (wait.type!=='robot_homing_wait' || wait.next)) throw new Error('Custom legacy homing WAIT contents need review.');
            replacement=apiCall(context,'homing');replacement.next={block:apiCall(context,'waitIdle')};
          } else if (originalType==='robot_speed') replacement=apiCall(context,'setMotionSpeed',[input(block,'SPEED',number(0))]);
          else if (originalType==='robot_pump' || originalType==='robot_three_finger') replacement=apiCall(context,'setEndtPump',[number(code(block,'MODE',['0','1','2']))]);
          else if (originalType==='robot_gripper') replacement=apiCall(context,'setEndtGripper',[number(code(block,'MODE',['0','1','2']))]);
          else if (originalType==='robot_send_msg') {
            const message={block:{type:'text_join',extraState:{itemCount:2},inputs:{ADD0:input(block,'MESSAGE',text('')),ADD1:text('\r\n')}}};
            replacement=apiCall(context,'sendMsg',[message,boolean(false)],true);
          } else replacement=apiCall(context,rule.function);
        }
        // Every expanded operation inherits disabled state; none is activated by paste.
        let tail=replacement;
        while (tail) {
          if (block.enabled!==undefined) tail.enabled=block.enabled;
          if (block.disabledReasons) tail.disabledReasons=clone(block.disabledReasons);
          if (!tail.next?.block) break;
          tail=tail.next.block;
        }
        preserve(block,replacement);
        if (originalType==='setup_robot' || originalType==='arduino_robot_setup') {
          let data;
          try { data=JSON.parse(replacement.data); } catch (_) {}
          if (!data || typeof data!=='object' || Array.isArray(data)) data=replacement.data===undefined ? {} : {originalData:replacement.data};
          data.studioxRobotSetup={sourcePort:block.fields?.PORT || data.studioxRobotSetup?.sourcePort || ''};
          replacement.data=JSON.stringify(data);
        }
        if (following) tail.next={block:following};
        converted.push({type:originalType,id:block.id || '',target:replacement.type,function:rule.function});
        return replacement;
      } catch (error) { return metadata(block,error.message); }
    }
    if (state.blocks) state.blocks.blocks=(state.blocks.blocks || []).map(block=>convert(block));
    return {state,converted,skipped};
  }
  function flyout(entries,destination = {}) {
    if (!config) throw new Error('Arduino robot mappings are not loaded.');
    const state=destination.state || destination;
    let robot={name:'robot',owner:'Mirobot_UART'};
    function find(block,disabled=false) {
      if (!block) return;
      const inactive=disabled || block.enabled===false || block.disabledReasons?.length>0;
      if (!inactive && block.type==='variables_set') {
        const signature=block.inputs?.VALUE?.block?.extraState?.signature;
        if (signature?.constructor===true && config.models[signature.owner]) {
          const field=block.fields?.VAR;
          const name=(state.variables || []).find(v=>v.id===(field?.id || field))?.name || field?.name;
          if (name) robot={name,owner:signature.owner};
        }
      }
      if (!/^procedures_def|^workflow_/.test(block.type)) Object.values(block.inputs || {}).forEach(input=>find(input.block,inactive));
      find(block.next?.block,disabled);
    }
    (state.blocks?.blocks || []).forEach(block=>find(block));
    const model=config.models[robot.owner];
    const number=value=>({shadow:{type:'math_number',fields:{NUM:value}}});
    return (entries || []).map(entry=>{
      const rule=config.rules[entry.type];
      if (!rule) return clone(entry);
      if (rule.status!=='mapped') return {kind:'label',text:entry.type==='robot_conveyor' ? 'Conveyor: mapping pending' : 'Mapping pending: '+entry.type};
      const block={type:entry.type,fields:{VARIABLE:robot.name,MODEL:robot.owner,MODE:'1',MOTION:'0',POSITION:'0',...(entry.fields || {})},inputs:clone(entry.inputs || {})};
      if (entry.type==='setup_robot') block.fields.VARIABLE={id:'arduino-map:'+robot.name,name:robot.name,type:''};
      if (entry.type==='write_coordinate' || entry.type==='write_angle') block.inputs=Object.fromEntries(model.axes.map(axis=>['AXIS_'+axis,number(0)]));
      // A template supplies only fresh defaults; the live destination still
      // determines whether the declared variable exists when compiling.
      const setup={type:'setup_robot',fields:{VARIABLE:{id:'arduino-map:'+robot.name,name:robot.name,type:''},MODEL:robot.owner}};
      const input={variables:clone(state.variables || []),blocks:{languageVersion:0,blocks:[setup,block]}};
      const mapped=transform(input,state).state.blocks.blocks[1];
      return {kind:'block',...mapped};
    });
  }
  const api={configure,transform,flyout};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  root.StudioXArduinoRobotMapping=api;
})(typeof window!=='undefined'?window:globalThis);
