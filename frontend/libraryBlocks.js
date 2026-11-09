/* Loaded before workspace restoration so dynamic calls survive files and clipboard. */
(function (root) {
  // This definition script loads before workspace restoration. StudioX runs it
  // in Electron; resolve the shared helper relative to the extension asset.
  const cppTypes = root.StudioXArduinoCppTypes || require(require('url').fileURLToPath(new URL('cppTypes.js', document.currentScript.src)));
  root.StudioXArduinoCppTypes = cppTypes;
  const boardPins = root.StudioXArduinoBoardPins || (typeof require === 'function' && typeof document !== 'undefined'
    ? require(require('url').fileURLToPath(new URL('boardPins.js', document.currentScript.src))) : null);
  if (boardPins) { root.StudioXArduinoBoardPins = boardPins; boardPins.register(Blockly); }
  const controlBlocks = root.StudioXArduinoControlBlocks || (typeof require === 'function' && typeof document !== 'undefined'
    ? require(require('url').fileURLToPath(new URL('controlBlocks.js', document.currentScript.src))) : null);
  if (controlBlocks) { root.StudioXArduinoControlBlocks=controlBlocks;controlBlocks.register(Blockly); }
  const clone = value => value ? JSON.parse(JSON.stringify(value)) : null;
  const check = kind => ({ number: 'Number', boolean: 'Boolean', text: 'String' }[kind] || null);
  const types = ['arduino_class', 'arduino_instance_call', 'arduino_library_call', 'arduino_library_value', 'arduino_library_object', 'arduino_library_object_ref', 'arduino_library_constant'];
  const optionKey = (spec, index) => spec.id || spec.qualifiedName + ':' + index;
  const isClass = block => block.type === 'arduino_class' || block.type === 'arduino_library_value' && block.librarySpec_?.constructor === true;
  const isInstance = block => block.type === 'arduino_instance_call';
  const isConstant = block => block.type === 'arduino_library_constant';
  const isLegacyObject = block => ['arduino_library_object', 'arduino_library_object_ref'].includes(block.type);
  function menuOptions(block, options) {
    const names = options.map(spec => (isInstance(block) ? spec.name : spec.qualifiedName) || spec.name || '…');
    const count = name => names.filter(value => value === name).length;
    const seen = new Map();
    return options.map((spec, index) => {
      const name = names[index], overload = (seen.get(name) || 0) + 1;
      seen.set(name, overload);
      const label = name + (count(name) > 1 ? ' (overload ' + overload + ')' : '') +
        (spec.supported === false ? ' (Advanced C++)' : '');
      return [label, optionKey(spec,index)];
    });
  }
  function argumentDefault(parameter) {
    const raw = parameter.default || '';
    if (parameter.kind === 'number' && (!raw || Number.isFinite(Number(raw)))) return {type:'math_number',fields:{NUM:raw ? Number(raw) : 0}};
    if (parameter.kind === 'boolean' && (!raw || ['true','false'].includes(raw))) return {type:'logic_boolean',fields:{BOOL:raw === 'true' ? 'TRUE' : 'FALSE'}};
    if (parameter.kind === 'text' && (!raw || /^".*"$/.test(raw))) {
      try { return {type:'text',fields:{TEXT:raw ? cppTypes.textField(JSON.parse(raw)) : ''}}; } catch (_) {}
    }
    return raw ? {type:'arduino_cpp_expression',fields:{CODE:raw,RETURN_TYPE:parameter.kind}} : null;
  }
  function updateParameters(block) {
    const spec = block.librarySpec_;
    const parameters = !spec || ['arduino_library_object_ref', 'arduino_library_constant'].includes(block.type) ? [] : spec.parameters || [];
    const wanted = new Map(parameters.flatMap((parameter, index) => parameter.optional && !block.libraryOptional_ ? [] : [['ARG_' + index, parameter]]));
    block.inputList.slice().forEach(input => {
      if (!input.name.startsWith('ARG_')) return;
      const parameter = wanted.get(input.name);
      if (!parameter || input.libraryParameter_ !== parameter.name + ':' + parameter.type) block.removeInput(input.name);
    });
    for (const [name, parameter] of wanted) {
      if (block.getInput(name)) continue;
      const input = block.appendValueInput(name).setCheck(check(parameter.kind)).appendField(parameter.name + ' (' + parameter.type + ')');
      input.libraryParameter_ = parameter.name + ':' + parameter.type;
      const value = argumentDefault(parameter);
      if (value) input.connection.setShadowState(value);
    }
    // Keep argument order when an overload adds an optional middle input.
    const order = [...wanted.keys()];
    for (let index = order.length - 2; index >= 0; index--) block.moveInputBefore(order[index], order[index + 1]);
  }
  function setMode(block, statement) {
    if (isClass(block)) { block.setOutput(true, 'ArduinoType'); block.libraryStatement_ = false; return; }
    if (isConstant(block) || isLegacyObject(block)) return;
    if (statement) {
      if (block.outputConnection) { block.unplug(false); block.setOutput(false); }
      block.setPreviousStatement(true); block.setNextStatement(true);
    } else {
      if (block.previousConnection || block.nextConnection) {
        block.unplug(true);
        if (block.nextConnection && block.nextConnection.isConnected()) block.nextConnection.disconnect();
        block.setPreviousStatement(false); block.setNextStatement(false);
      }
      const spec = block.librarySpec_;
      block.setOutput(true, spec && spec.constructor !== true ? check(spec.returnKind) : null);
    }
    block.libraryStatement_ = statement;
  }
  function refreshShape(block) {
    const spec = block.librarySpec_;
    const needsObject = !isInstance(block) && spec && (isLegacyObject(block) || spec.constructor !== true && spec.owner && !spec.static);
    if (!needsObject && block.getInput('OBJECT')) block.removeInput('OBJECT');
    if (needsObject && !block.getInput('OBJECT')) {
      const owner = spec.owner.split('::').pop();
      const instance = spec.constructor !== true && (spec.instances || [])[0];
      const name = instance ? instance.name : owner[0].toLowerCase() + owner.slice(1) + '1';
      // All ordinary variables are available, matching Variables → set/get.
      // Keep typed legacy variables selectable for saved workspaces.
      block.appendDummyInput('OBJECT').appendField(block.type === 'arduino_library_object' ? 'create as' : 'on')
        .appendField(new Blockly.FieldVariable(name, null, null, ''), 'VAR');
      block.moveInputBefore('OBJECT', block.inputList[1] && block.inputList[1].name || null);
    }
    const hasOptional = spec && !isConstant(block) && (spec.parameters || []).some(parameter => parameter.optional);
    if (!hasOptional && block.getInput('OPTIONS')) block.removeInput('OPTIONS');
    if (hasOptional && !block.getInput('OPTIONS')) {
      const optional = new Blockly.FieldCheckbox(block.libraryOptional_ ? 'TRUE' : 'FALSE');
      block.appendDummyInput('OPTIONS').appendField('optional arguments').appendField(optional, 'OPTIONAL');
      optional.setValidator(value => {
        const update = () => { block.libraryOptional_ = value === 'TRUE'; updateParameters(block); };
        if (block.libraryLoading_) update(); else recordShape(block, update);
        return value;
      });
    }
    if (block.getField('OPTIONAL') && block.getFieldValue('OPTIONAL') !== (block.libraryOptional_ ? 'TRUE' : 'FALSE')) block.setFieldValue(block.libraryOptional_ ? 'TRUE' : 'FALSE', 'OPTIONAL');
    updateParameters(block);
    if (isConstant(block)) block.setOutput(true, check(spec && spec.kind));
    else if (!isLegacyObject(block)) setMode(block, spec && spec.constructor === true ? false : spec && spec.returnKind === 'void' ? true : block.libraryStatement_);
    block.setTooltip(spec ? (spec.label || spec.qualifiedName) + (spec.reason ? '\n' + spec.reason : '') +
      (spec.conditions && spec.conditions.length ? '\nBoard conditions: ' + spec.conditions.join('; ') : '') +
      '\nDeclared in ' + spec.library + ' / ' + spec.header : 'Choose a library function.');
  }
  function recordShape(block, action) {
    const before = JSON.stringify(block.saveExtraState());
    action();
    const after = JSON.stringify(block.saveExtraState());
    if (before !== after && Blockly.Events.isEnabled()) Blockly.Events.fire(new Blockly.Events.BlockChange(block, 'mutation', null, before, after));
  }
  for (const type of types) {
    Blockly.Blocks[type] = {
      init: function () {
        this.librarySpec_ = null; this.libraryOptions_ = []; this.libraryMethods_ = []; this.libraryOptional_ = false;
        this.libraryStatement_ = type === 'arduino_library_call';
        this.setColour('#00979D'); this.setInputsInline(false);
        if (['arduino_class','arduino_instance_call','arduino_library_value','arduino_library_constant','arduino_library_object_ref'].includes(type)) this.setOutput(true);
        else if (type === 'arduino_library_call') { this.setPreviousStatement(true); this.setNextStatement(true); }
        const dropdown = new Blockly.FieldDropdown([['…','...']]);
        const title = this.appendDummyInput('TITLE').appendField(isConstant(this) ? 'constant' : type === 'arduino_class' ? 'class' : type === 'arduino_library_object_ref' ? 'object' : 'call');
        if (isInstance(this)) {
          const variable = new Blockly.FieldVariable('item', null, null, '');
          title.appendField(variable, 'VAR').appendField('.');
          variable.setValidator(id => { if (!this.libraryLoading_) refreshInstance(this,id); return id; });
        }
        title.appendField(dropdown, isConstant(this) ? 'CONST_NAME' : 'FUNC_NAME');
        dropdown.setValidator(value => {
          if (this.libraryLoading_) return value;
          const spec = this.libraryOptions_.find((item,index) => optionKey(item,index) === value);
          if (!spec || spec === this.librarySpec_) return value;
          recordShape(this, () => { this.librarySpec_ = spec; this.libraryOptional_ = false; this.libraryStatement_ = spec.constructor !== true && spec.returnKind === 'void'; refreshShape(this); });
          return value;
        });
        if (typeof root.installTypeaheadOnDropdown === 'function') root.installTypeaheadOnDropdown(dropdown);
      },
      customContextMenu: function (items) {
        if (isClass(this) || isConstant(this) || isLegacyObject(this) || !this.librarySpec_ || this.librarySpec_.constructor === true || this.librarySpec_.returnKind === 'void') return;
        items.push({text:this.libraryStatement_ ? 'Use as value' : 'Use as statement',enabled:true,
          callback:() => {
            const previous=Blockly.Events.getGroup();Blockly.Events.setGroup(previous || true);
            try { recordShape(this,()=>setMode(this,!this.libraryStatement_)); }
            finally { Blockly.Events.setGroup(previous); }
          }});
      },
      saveExtraState: function () {
        const defaults = {};
        for (const input of this.inputList) {
          const child = input.name.startsWith('ARG_') && input.connection && input.connection.targetBlock();
          if (child && child.isShadow()) defaults[input.name] = Blockly.serialization.blocks.save(child, {addNextBlocks:false,saveIds:false});
        }
        return {signature:clone(this.librarySpec_),options:clone(this.libraryOptions_),methods:clone(this.libraryMethods_),optional:this.libraryOptional_,statement:this.libraryStatement_,defaults};
      },
      loadExtraState: function (state) {
        this.libraryLoading_ = true;
        try {
          const saved = cppTypes.signature(clone(state && state.signature));
          this.libraryMethods_ = (clone(state && state.methods) || []).map(cppTypes.signature);
          this.libraryOptions_ = (clone(state && state.options) || (saved ? [saved] : [])).map(cppTypes.signature);
          let index = saved ? this.libraryOptions_.findIndex(item => JSON.stringify(item) === JSON.stringify(saved)) : 0;
          if (index < 0) { this.libraryOptions_.push(saved); index=this.libraryOptions_.length-1; }
          this.librarySpec_ = this.libraryOptions_[index] || null;
          this.libraryOptional_ = !!(state && state.optional);
          this.libraryStatement_ = state && state.statement !== undefined ? !!state.statement : type === 'arduino_library_call';
          const dropdown=this.getField(isConstant(this) ? 'CONST_NAME' : 'FUNC_NAME');
          dropdown.setOptions(this.libraryOptions_.length ? menuOptions(this, this.libraryOptions_) : [['…','...']]);
          if (this.librarySpec_) dropdown.setValue(optionKey(this.librarySpec_,index));
          refreshShape(this);
          for (const [name, value] of Object.entries(state && state.defaults || {})) {
            const input = this.getInput(name);
            if (input && input.connection && (!input.connection.targetBlock() || input.connection.targetBlock().isShadow())) input.connection.setShadowState(clone(value));
          }
        } finally { this.libraryLoading_ = false; }
      },
      mutationToDom: function () {
        const element = Blockly.utils.xml.createElement('mutation');element.setAttribute('library',JSON.stringify(this.saveExtraState()));return element;
      },
      domToMutation: function (element) { this.loadExtraState(JSON.parse(element.getAttribute('library') || '{}')); },
    };
  }
  const catalogs = new WeakMap();
  function variableClass(workspace, id) {
    for (const setter of workspace.getBlocksByType('variables_set', false)) {
      if (!setter.isEnabled() || setter.getFieldValue('VAR') !== id) continue;
      let parent = setter.getParent(), active = true;
      while (parent) { if (!parent.isEnabled()) active = false; parent = parent.getParent(); }
      const value = setter.getInputTargetBlock('VALUE');
      if (active && value && value.isEnabled() && isClass(value) && value.librarySpec_) return {owner:value.librarySpec_.owner, library:value.librarySpec_.library, methods:value.libraryMethods_ || []};
      if (active && value && value.isEnabled()) return {owner:'',methods:[]};
    }
    for (const object of workspace.getBlocksByType('arduino_library_object', false)) {
      if (object.isEnabled() && object.getFieldValue('VAR') === id && object.librarySpec_) return {owner:object.librarySpec_.owner,library:object.librarySpec_.library,methods:object.libraryMethods_ || []};
    }
    const model = workspace.getVariableMap().getVariableById(id);
    const catalog = catalogs.get(workspace) || [];
    const global = model && catalog.find(spec => (spec.instances || []).some(instance => instance.name === model.getName()));
    return global ? {owner:global.owner,library:global.library,methods:[]} : null;
  }
  function refreshInstance(block, id = block.getFieldValue('VAR')) {
    if (block.libraryLoading_ || block.isDisposed()) return;
    const declared = variableClass(block.workspace, id);
    // Keep an unresolved call intact when its declaration is temporarily removed
    // or disabled. The compiler reports it; restoring the declaration restores
    // its menu without discarding the chosen method or argument blocks.
    if (!declared) return;
    const methods = [...declared.methods, ...block.libraryOptions_, ...(catalogs.get(block.workspace) || [])]
      .filter(spec => spec.owner === declared.owner && (!declared.library || spec.library === declared.library) && spec.constructor !== true && !spec.static);
    const options = [...new Map(methods.map(spec => [cppTypes.functionKey(spec),cppTypes.signature(spec)])).values()];
    if (JSON.stringify(options) === JSON.stringify(block.libraryOptions_)) return;
    recordShape(block, () => {
      const previous = block.librarySpec_;
      block.libraryOptions_ = options;
      const selected = options.findIndex(spec => previous && optionKey(spec,0) === optionKey(previous,0));
      const sameSignature = options.findIndex(spec => previous && cppTypes.functionKey(spec) === cppTypes.functionKey(previous));
      const sameMethod = selected >= 0 ? selected : sameSignature >= 0 ? sameSignature : options.findIndex(spec=>previous && spec.name===previous.name);
      const index = sameMethod >= 0 ? sameMethod : Math.max(0,options.findIndex(spec=>spec.supported !== false));
      block.librarySpec_ = options[index] || null;
      if (sameMethod < 0) {
        block.libraryOptional_ = false;
        block.libraryStatement_ = block.librarySpec_?.returnKind === 'void';
      }
      block.libraryLoading_ = true;
      try {
        const dropdown=block.getField('FUNC_NAME');
        dropdown.setOptions(options.length ? menuOptions(block, options) : [['select a declared class variable','...']]);
        if (options.length) dropdown.setValue(optionKey(options[index],index));
        refreshShape(block);
      } finally { block.libraryLoading_ = false; }
    });
  }
  function refreshMethods(workspace) {
    workspace.getBlocksByType('arduino_instance_call', false).forEach(block => refreshInstance(block));
  }
  function observeWorkspace(workspace) {
    cppTypes.configureWorkspace(workspace);
    const listener = event => {
      if (event.isUiEvent) return;
      const previous = Blockly.Events.getGroup();
      Blockly.Events.setGroup(event.group || previous || true);
      try { refreshMethods(workspace); } finally { Blockly.Events.setGroup(previous); }
    };
    workspace.addChangeListener(listener);
    refreshMethods(workspace);
  }
  function setCatalog(workspace,catalog) {
    if (catalog.error) return;
    const functions = (catalog.libraries || []).flatMap(library => library.headers.flatMap(header => header.functions || [])).map(cppTypes.signature);
    catalogs.set(workspace,functions);
    refreshMethods(workspace);
  }
  root.StudioXArduinoLibraryBlocks = {types,observeWorkspace,setCatalog,refreshMethods};
})(typeof window !== 'undefined' ? window : globalThis);
